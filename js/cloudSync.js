/**
 * TakeoffCloudSync — the pure decisions behind project cloud sync.
 *
 * js/cloud.js does the IO (Supabase select/upsert); everything that decides
 * *whether* a copy may be replaced lives here so it can be unit-tested in Node
 * without a network or an account (cloudSync.test.js). The cloud project is
 * production and cannot be signed into from a dev machine, so this module is
 * the only place these rules are actually exercised.
 *
 * The model: two devices hold copies of one project row. Each device also
 * remembers the remote `updated_at` it last reconciled with for that row
 * ("last seen" — device-local, in TakeoffStorage). That stamp is the common
 * ancestor: a local copy no newer than it has no unsynced work, so it is safe
 * to replace. Anything else is a real divergence, and the rule then is keep
 * both — the row keeps the newer copy and the loser is written back as a
 * separate project named "<name> (conflict — <time>)". Nothing is overwritten
 * silently and nothing asks the estimator to resolve a merge mid-bid.
 *
 * It also holds the rest of the sync decisions that must be right without a
 * test account: which project a fresh device should open after signing in,
 * which projects are too empty to push at all, whether a delete has travelled
 * (tombstones), and whether the account has consented to sharing book
 * corrections.
 *
 * Dual browser/Node. No state, no IO.
 */
const TakeoffCloudSync = (function () {
  const CONFLICT_SUFFIX_RE = /\s*\(conflict — [^)]*\)\s*$/;

  function ms(iso) {
    return Date.parse(iso) || 0;
  }

  /**
   * Do two project payloads hold the same bid? Everything the project
   * document carries counts — name, rates, the job's details and the
   * manifest — or a change to one of them reads as "already in sync" and is
   * quietly lost.
   */
  function sameContent(a, b) {
    if (!a || !b) return false;
    return (
      (a.name || '') === (b.name || '') &&
      (Number(a.laborRate) || 0) === (Number(b.laborRate) || 0) &&
      (a.taxRate == null ? '' : String(a.taxRate)) === (b.taxRate == null ? '' : String(b.taxRate)) &&
      (a.plansUrl || '') === (b.plansUrl || '') &&
      JSON.stringify(a.details || {}) === JSON.stringify(b.details || {}) &&
      JSON.stringify(a.manifest || []) === JSON.stringify(b.manifest || [])
    );
  }

  /**
   * "<name> (conflict — Sep 7, 2:14 PM)" in the device's own local time, so
   * the estimator can tell the two copies apart in the project list. Never
   * nests: a name that already carries a conflict stamp gets the new one.
   */
  function conflictName(name, savedAt, nowFn) {
    const base = String(name || 'Untitled project').replace(CONFLICT_SUFFIX_RE, '');
    const when = new Date(ms(savedAt) || (nowFn ? nowFn() : Date.now()));
    let stamp;
    try {
      stamp = when.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch (_) {
      stamp = when.toISOString();
    }
    return `${base} (conflict — ${stamp})`;
  }

  /**
   * Sync-down: what to do with a remote row against the local copy.
   *   in-sync          — same bid on both sides; just record what we saw
   *   adopt            — take the remote copy (the local one has no unsynced work)
   *   adopt-keep-local — take the remote copy, but keep the local one as a
   *                      separate project (both sides changed)
   *   push             — the local copy is ahead; send it up
   *   push-keep-remote — the local copy is ahead but the remote changed too;
   *                      keep the remote as a separate project, then send ours
   */
  function decideProjectSync(local, remote, lastSeenRemoteAt) {
    if (!remote) return { action: local ? 'push' : 'in-sync' };
    if (!local) return { action: 'adopt' };
    if (sameContent(local, remote)) return { action: 'in-sync' };

    const localT = ms(local.savedAt);
    const remoteT = ms(remote.savedAt);
    const seenT = ms(lastSeenRemoteAt);

    if (remoteT > localT) {
      // Safe only when the local copy is the one we pulled and nobody has
      // touched it since. With no "last seen" stamp (a device that synced
      // before this was tracked) we cannot prove that, so we keep a copy.
      const localIsUnchangedPull = seenT > 0 && localT <= seenT;
      if (localIsUnchangedPull) return { action: 'adopt' };
      return { action: 'adopt-keep-local', keepName: conflictName(local.name, local.savedAt) };
    }

    // Local is at least as new. If the remote also moved since we last saw it,
    // that is another device's work — keep it rather than overwrite it.
    if (seenT > 0 && remoteT > seenT) {
      return { action: 'push-keep-remote', keepName: conflictName(remote.name, remote.savedAt) };
    }
    return { action: 'push' };
  }

  /**
   * Push precondition: called with the row as it stands on the server right
   * before we would overwrite it.
   *   push        — safe: no row, or the row is still the one we last saw
   *   in-sync     — the server already holds this bid; nothing to send
   *   fork-remote — the row changed since we last saw it and differs from
   *                 ours: keep the server's copy as a separate project first,
   *                 then push ours
   */
  function decideProjectPush(local, remote, lastSeenRemoteAt) {
    if (!remote) return { action: 'push' };
    if (sameContent(local, remote)) return { action: 'in-sync' };
    const remoteT = ms(remote.savedAt);
    const seenT = ms(lastSeenRemoteAt);
    if (seenT > 0 && remoteT <= seenT) return { action: 'push' };
    return { action: 'fork-remote', keepName: conflictName(remote.name, remote.savedAt) };
  }

  // --- Starter projects (T2-13) ---------------------------------------
  // Boot mints an empty project with one description-less row. It is not a
  // bid: it must never be pushed to the cloud (it lands in every other
  // device's switcher as junk), and on a fresh device it is exactly what
  // should step aside when the account's real bids arrive.

  /** Does this manifest hold a row anyone typed into? (top level + children) */
  function hasDescribedRow(manifest) {
    for (const item of Array.isArray(manifest) ? manifest : []) {
      if (!item) continue;
      if (String(item.description || '').trim()) return true;
      for (const child of Array.isArray(item.children) ? item.children : []) {
        if (child && String(child.description || '').trim()) return true;
      }
    }
    return false;
  }

  /** An untouched starter: no row carries a description. */
  function isStarterProject(project) {
    return !project || !hasDescribedRow(project.manifest);
  }

  /** A project earns a cloud row once it holds a described row. */
  function shouldPushNewProject(project) {
    return !isStarterProject(project);
  }

  /**
   * Which project should be open after a sync? Signing in on a new device
   * lands on the starter minted at boot, whose id can never match a remote
   * row — so the estimator sees an empty table with a checkmark on it.
   * Returns the id to switch to, or null to stay put.
   *   - stay put if the open project holds real work
   *   - otherwise take the most recently updated remote bid that holds work
   */
  function pickProjectToOpen(currentProject, candidates) {
    if (!isStarterProject(currentProject)) return null;
    const withWork = (candidates || []).filter((p) => p && p.id && hasDescribedRow(p.manifest));
    if (!withWork.length) return null;
    let best = null;
    for (const p of withWork) {
      if (p.id === (currentProject && currentProject.id)) return null; // already open
      if (!best || ms(p.savedAt) > ms(best.savedAt)) best = p;
    }
    return best ? best.id : null;
  }

  // --- Tombstones (T2-14) ----------------------------------------------
  // A delete has to travel, or the next device re-uploads its index entry and
  // the bid comes back. The record lives in the account's takeoff_store under
  // 'deleted' — no schema change, and it covers assemblies, which have no
  // table of their own.

  function emptyTombstones() {
    return { v: 1, projects: {}, assemblies: {} };
  }

  function normalizeTombstones(row) {
    const out = emptyTombstones();
    if (!row || typeof row !== 'object') return out;
    for (const kind of ['projects', 'assemblies']) {
      const src = row[kind];
      if (!src || typeof src !== 'object') continue;
      for (const id of Object.keys(src)) {
        if (typeof src[id] === 'string') out[kind][id] = src[id];
      }
    }
    return out;
  }

  /** Record `id` as deleted at `atIso`. Returns a new map. */
  function withTombstone(map, kind, id, atIso) {
    const next = normalizeTombstones(map);
    if (!id) return next;
    const at = atIso || new Date().toISOString();
    if (!next[kind][id] || ms(at) > ms(next[kind][id])) next[kind][id] = at;
    return next;
  }

  /** Drop `id`'s tombstone (it was recreated deliberately). Returns a new map. */
  function withoutTombstone(map, kind, id) {
    const next = normalizeTombstones(map);
    delete next[kind][id];
    return next;
  }

  /**
   * Is this row deleted? A copy saved *after* the delete wins — that is
   * someone deliberately working on it again, not a resurrection.
   */
  function isTombstoned(map, kind, id, rowUpdatedAt) {
    const at = map && map[kind] ? map[kind][id] : null;
    if (!at) return false;
    if (!rowUpdatedAt) return true;
    return ms(rowUpdatedAt) <= ms(at);
  }

  /**
   * Assemblies merge as a union by id (local wins on collision) minus
   * anything deleted on any device. Assemblies carry no timestamps, so a
   * tombstone is final for that id.
   */
  function mergeAssemblies(remote, local, tombstones) {
    const byId = new Map();
    for (const a of Array.isArray(remote) ? remote : []) if (a && a.id) byId.set(a.id, a);
    for (const a of Array.isArray(local) ? local : []) if (a && a.id) byId.set(a.id, a);
    for (const id of Array.from(byId.keys())) {
      if (isTombstoned(tombstones, 'assemblies', id, null)) byId.delete(id);
    }
    return Array.from(byId.values());
  }

  /** Ids present in `before` and gone from `after`. */
  function removedIds(before, after) {
    const has = new Set((Array.isArray(after) ? after : []).map((a) => a && a.id).filter(Boolean));
    return (Array.isArray(before) ? before : [])
      .map((a) => a && a.id)
      .filter((id) => id && !has.has(id));
  }

  // --- Sharing consent (T2-12) -----------------------------------------
  // Consent belongs to the account, not the browser: two devices must agree,
  // and it must not outlive a session on a shared machine.

  function readShareConsent(row) {
    return !!(row && row.v === 1 && row.on === true);
  }

  function shareConsentRow(on, nowIso) {
    return { v: 1, on: !!on, at: nowIso || new Date().toISOString() };
  }

  // --- Promoted catalog parts are not corrections (X4) -------------------
  // Copying a supply-house catalog part into the book marks the row
  // `userAdded`, which is what the corrections diff keys "new part" off. Left
  // alone, the shared book learns the supply house's own catalog price back
  // (often with zero hours beside it) as if an estimator had proposed it.
  // A promotion becomes worth sharing the moment a person puts a number on
  // it — a quote from a supply house, a price typed in by hand, or hours —
  // and until then it is just an echo of a catalog everyone already has.

  /**
   * A promoted catalog row nobody has quoted or costed yet: added by the user,
   * every price on it came in with the catalog import, and no hours.
   *
   * The hours test is what catches a hand edit, because `updateLaborBookRow`
   * deliberately does not stamp `edited` on a `userAdded` row (there is no
   * shipped default to compare it with) — so on these rows the numbers
   * themselves are the only evidence of a person.
   */
  function isUnquotedPromotion(row) {
    if (!row || !row.userAdded) return false;
    const offers = Array.isArray(row.offers) ? row.offers : [];
    const imported = offers.filter((o) => o && o.by === 'import');
    if (!imported.length) return false; // a hand-built row, not a promotion
    if (imported.length !== offers.length) return false; // somebody quoted it
    if ((Number(row.labor) || 0) !== 0) return false; // somebody costed it
    const history = Array.isArray(row.history) ? row.history : [];
    if (history.some((h) => h && h.by !== 'import')) return false;
    return true;
  }

  // --- Lid-close flush (X15) --------------------------------------------
  // A tab closing kills its in-flight XHRs, so the last queued push can die
  // with it while the header still shows a checkmark. `fetch(keepalive)`
  // survives the page, at the cost of a 64 KiB budget shared by every
  // keepalive request in flight (headers included). This builds the requests;
  // js/cloud.js only fires them. Anything that does not fit is deferred —
  // the caller sends those the ordinary way and they may not make it, which
  // is exactly today's behaviour.

  const KEEPALIVE_BUDGET = 60000; // of the browser's 64 KiB, leaving header room

  function byteLength(str) {
    try {
      return new TextEncoder().encode(str).length;
    } catch (_) {
      return String(str).length * 2; // worst case; only a budget check
    }
  }

  /**
   * The PostgREST requests that would flush `values` (takeoff_store rows) and
   * `projects` at page-hide, using the session's own access token.
   *
   * Upsert semantics match the ordinary path exactly: store rows go up as a
   * merge-duplicates upsert on the table's primary key, and a project goes
   * through the same `takeoff_upsert_project` guard, so a lid-close can never
   * overwrite work another device did. Without that function (005 unapplied)
   * projects are deferred rather than blind-upserted.
   *
   * @param {object} opts
   *   baseUrl, apiKey, accessToken, userId — the live session's credentials
   *   values   {key: value} — pending takeoff_store rows
   *   projects [{project, expectedUpdatedAt}] — pending project documents
   *   rpcAvailable — is takeoff_upsert_project there?
   *   maxBytes — override the keepalive budget (tests)
   * @returns {{requests: Array, deferred: Array}} requests are
   *   {what, url, options} — fetch(url, options) and nothing else.
   */
  function buildKeepalivePushes(opts) {
    const o = opts || {};
    const values = o.values || {};
    const projects = Array.isArray(o.projects) ? o.projects : [];
    const requests = [];
    const deferred = [];
    const all = [
      ...Object.keys(values).map((key) => ({ kind: 'store', key })),
      ...projects.map((p) => ({ kind: 'project', id: p && p.project && p.project.id })),
    ];
    if (!o.baseUrl || !o.apiKey || !o.accessToken || !o.userId) return { requests, deferred: all };

    const headers = {
      apikey: o.apiKey,
      Authorization: `Bearer ${o.accessToken}`,
      'Content-Type': 'application/json',
    };
    const budget = typeof o.maxBytes === 'number' ? o.maxBytes : KEEPALIVE_BUDGET;
    let spent = 0;
    const add = (what, url, body, extraHeaders) => {
      const json = JSON.stringify(body);
      const size = byteLength(json);
      if (size > budget || spent + size > budget) {
        deferred.push(what);
        return;
      }
      spent += size;
      requests.push({
        what,
        url,
        options: { method: 'POST', headers: { ...headers, ...(extraHeaders || {}) }, body: json, keepalive: true },
      });
    };

    for (const key of Object.keys(values)) {
      add(
        { kind: 'store', key },
        `${o.baseUrl}/rest/v1/takeoff_store`,
        [{ user_id: o.userId, key, value: values[key] }],
        { Prefer: 'resolution=merge-duplicates,return=minimal' }
      );
    }
    for (const entry of projects) {
      const project = entry && entry.project;
      if (!project || !project.id) continue;
      const what = { kind: 'project', id: project.id, updatedAt: project.savedAt };
      if (!o.rpcAvailable) {
        deferred.push(what);
        continue;
      }
      add(what, `${o.baseUrl}/rest/v1/rpc/takeoff_upsert_project`, {
        p_id: project.id,
        p_name: project.name,
        p_data: o.projectPayload ? o.projectPayload(project) : { manifest: project.manifest, laborRate: project.laborRate },
        p_updated_at: project.savedAt,
        p_expected_updated_at: entry.expectedUpdatedAt || null,
      });
    }
    return { requests, deferred };
  }

  return {
    isUnquotedPromotion,
    buildKeepalivePushes,
    sameContent,
    conflictName,
    decideProjectSync,
    decideProjectPush,
    hasDescribedRow,
    isStarterProject,
    shouldPushNewProject,
    pickProjectToOpen,
    emptyTombstones,
    normalizeTombstones,
    withTombstone,
    withoutTombstone,
    isTombstoned,
    mergeAssemblies,
    removedIds,
    readShareConsent,
    shareConsentRow,
  };
})();

// Node (unit tests); inert in the browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TakeoffCloudSync;
}
