/**
 * TakeoffCloud — optional Supabase-backed sync for projects, the Labor &
 * Price Book, and saved assemblies.
 *
 * The app stays local-first: TakeoffStorage (localStorage) remains the
 * synchronous source the app boots from. When signed in, this module
 *   - pulls on sign-in: book conflicts resolve by newest savedAt; projects
 *     (takeoff_projects, schema-aligned with Count Tooling) merge as a
 *     union by id, and a project changed on two devices keeps BOTH copies
 *     (js/cloudSync.js decides; the loser becomes its own project named
 *     "<name> (conflict — <time>)"); assemblies merge as a union by id,
 *   - pushes on every save (TakeoffStorage notifies via onBookSaved /
 *     onProjectSaved / onAssembliesSaved), debounced; pending pushes flush
 *     when the tab hides, and again at pagehide/beforeunload as keepalive
 *     fetches, which outlive the page (js/cloudSync.js builds those).
 *
 * Signed out (or with supabase-js unavailable) the app behaves exactly as
 * before. Auth: email + password, or a 6-digit emailed code that also creates the
 * account. A signed-in account can set or change its own password here, and
 * "Forgot your password?" sends a reset link back to this page (that link is
 * the only thing needing a redirect URL — see supabase/README.md).
 *
 * Roles (user < admin < dev) come from takeoff_profiles.
 *
 * Cloud rows: public.takeoff_projects (one row per project; data holds
 * manifest, laborRate, taxRate, plansUrl, details, importedFrom, archived),
 * public.takeoff_store (user_id, key, value jsonb), all under row-level
 * security scoping every operation to auth.uid() = user_id.
 * takeoff_store keys: 'book', 'assemblies', 'share' (sharing consent),
 * 'deleted' (tombstones for projects + assemblies) and the legacy
 * pre-projects 'workspace' row that sign-in migrates once.
 *
 * Deletes: a deleted project or assembly is recorded under 'deleted' with the
 * time. Every device honours that record — otherwise the next device to sync
 * re-uploads its own copy and the bid comes back.
 *
 * Shared-book corrections (opt-in): after each book push, a consenting
 * user's Parts-book diff (TakeoffState.getBookCorrections) is upserted into
 * public.takeoff_suggestions; the admin account reviews it via
 * js/suggestionsReview.js. Opting out deletes the user's shared rows. The
 * consent itself is an account row, not a browser flag: two devices agree,
 * either can withdraw, and it does not outlive a session on a shared machine.
 */
const TakeoffCloud = (function () {
  const SUPABASE_URL = 'https://awjcdxqhvgnqsrlnoyxr.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_vMFyQ4I0LqZD6yhfoF_Zbw_9MsPoC9G'; // publishable key — safe to ship; RLS enforces access
  const TABLE = 'takeoff_store';
  const PROJECTS_TABLE = 'takeoff_projects';
  const SUGGESTIONS_TABLE = 'takeoff_suggestions';
  const ADMIN_EMAIL = 'stephen@pipetexas.com'; // legacy fallback while takeoff_profiles is unapplied; RLS enforces the real access
  const LEGACY_SHARE_KEY = 'takeoff-share-corrections'; // pre-account device flag; cleared on load
  const PUSH_DEBOUNCE_MS = 1200;

  let client = null;
  let session = null;
  let profileRole = null; // 'user' | 'admin' | 'dev' — from takeoff_profiles
  let syncedThisLoad = false;
  let suppressPush = false; // true while adopting remote data locally
  let lastSyncedAt = null;
  let status = 'signedOut'; // disabled | signedOut | syncing | synced | error
  let statusDetail = '';
  let pendingEmail = ''; // email a code was sent to (modal state)
  let authMethod = null; // 'password' | 'code' — how this session signed in
  let recoveryMode = false; // arrived on a "choose a new password" link
  const pushTimers = {};
  const pendingValues = {};

  // Sharing consent lives with the account (takeoff_store key 'share'), not
  // with the browser: two devices have to agree, opting out has to work from
  // either of them, and consent must not outlive a session on a shared
  // machine. Signed out there is no consent at all.
  let shareConsent = false;
  let shareConsentLoaded = false;

  // Deletes travel as a record in takeoff_store (key 'deleted') — no schema
  // change, and assemblies (which have no table) are covered too.
  let tombstones = TakeoffCloudSync.emptyTombstones();
  let lastAssemblyIds = [];

  const escapeHtml = (s) => (typeof TakeoffUtils !== 'undefined' ? TakeoffUtils.escapeHtml(s) : String(s));

  try {
    if (typeof supabase !== 'undefined' && SUPABASE_URL && !SUPABASE_KEY.startsWith('__')) {
      client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }
  } catch (err) {
    console.warn('Takeoff: cloud sync unavailable', err);
  }
  if (!client) status = 'disabled';

  function isSignedIn() {
    return !!session;
  }

  // When this device last reconciled with the cloud (null until it has).
  // The project switcher shows it beside its own "Saved …" line.
  function getLastSyncedAt() {
    return lastSyncedAt;
  }

  function getEmail() {
    return session?.user?.email || null;
  }

  // Where js/events.js posts telemetry: the same project, the same publishable
  // key, so the URL and the key live in exactly one file. The user id and token
  // are present only while signed in — signed-out events are anonymous.
  function getEndpoint() {
    return {
      url: SUPABASE_URL,
      key: SUPABASE_KEY,
      userId: session?.user?.id || null,
      token: session?.access_token || null,
    };
  }

  function setStatus(next, detail) {
    status = next;
    statusDetail = detail || '';
    updateUi();
  }

  // Anything written locally but not yet accepted by the cloud. The checkmark
  // must not appear while this is non-zero — that window is exactly the
  // lid-close moment (J11-F13).
  function pendingCount() {
    return Object.keys(pendingValues).length + Object.keys(pendingProjects).length;
  }

  // "synced" only once nothing is queued; otherwise we are still syncing.
  function setSyncedIfSettled() {
    lastSyncedAt = new Date();
    setStatus(pendingCount() ? 'syncing' : 'synced');
  }

  // --- Sync ---

  async function syncDown() {
    if (!client || !session) return;
    setStatus('syncing');
    const { data, error } = await client.from(TABLE).select('key,value').in('key', ['book', 'assemblies', 'workspace', 'share', 'deleted']);
    if (error) {
      setStatus('error', error.message);
      return;
    }
    const remote = Object.fromEntries((data || []).map((r) => [r.key, r.value]));

    // What this account has consented to, and what it has deleted anywhere.
    shareConsent = TakeoffCloudSync.readShareConsent(remote.share);
    shareConsentLoaded = true;
    tombstones = TakeoffCloudSync.normalizeTombstones(remote.deleted);

    // Book: newest savedAt wins. A legacy pre-projects 'workspace' row
    // stands in for a missing 'book' row (its book half); the row itself is
    // left untouched as a backup.
    const legacyWs = !remote.book && remote.workspace && remote.workspace.v === 1 ? remote.workspace : null;
    const remoteBook = remote.book && remote.book.v === 1
      ? remote.book
      : legacyWs && legacyWs.laborBook
        ? { v: 1, savedAt: legacyWs.savedAt, laborBook: legacyWs.laborBook, laborBookMeta: legacyWs.laborBookMeta || null }
        : null;
    const localBook = TakeoffStorage.loadBook();
    const localT = localBook ? Date.parse(localBook.savedAt) || 0 : 0;
    const remoteT = remoteBook ? Date.parse(remoteBook.savedAt) || 0 : 0;
    if (remoteBook && remoteT > localT) {
      suppressPush = true;
      try {
        TakeoffStorage.saveBook(remoteBook);
        TakeoffState.adoptBook(remoteBook);
      } finally {
        suppressPush = false;
      }
    } else if (localBook && localT > 0 && localT > remoteT) {
      queuePush('book', localBook, { immediate: true });
    }

    // Assemblies: union by id (local entries win on id collision), minus
    // anything deleted on any device — a union alone brings a deleted
    // assembly back from whichever machine still holds it.
    const localAsm = TakeoffStorage.loadAssemblies();
    const remoteAsm = Array.isArray(remote.assemblies) ? remote.assemblies : [];
    const merged = TakeoffCloudSync.mergeAssemblies(remoteAsm, localAsm, tombstones);
    lastAssemblyIds = merged.map((a) => a.id);
    const changedLocally = merged.length !== localAsm.length;
    const changedRemotely = merged.length !== remoteAsm.length;
    if (changedLocally) {
      suppressPush = !changedRemotely;
      try {
        TakeoffState.setAssemblies(merged); // persists via TakeoffStorage → pushes if suppressPush is false
      } finally {
        suppressPush = false;
      }
    } else if (changedRemotely) {
      queuePush('assemblies', merged, { immediate: true });
    }

    await syncProjects(legacyWs);

    setSyncedIfSettled();
    pushSuggestions();
    // A role given to this account elsewhere arrives on the next sync, not
    // the next sign-in.
    fetchProfileRole();
    if (typeof TakeoffApp !== 'undefined') TakeoffApp.render();
  }

  // --- Projects sync (takeoff_projects; schema mirrors Count Tooling's
  //     projects table). Sign-in merges as a union by id; per row, the
  //     decisions live in js/cloudSync.js and rest on the remote updated_at
  //     this device last saw (takeoff-cloud-seen), never on the clock alone —
  //     a copy that diverged is kept beside the winner, never overwritten.
  //     Missing table (SQL not applied yet) disables project sync gracefully. ---

  let projectsTableAvailable = true;
  let projectsTableWarned = false;
  const pendingProjects = {}; // id -> project payload
  const projectPushTimers = {};

  // Per project, the remote updated_at this device last reconciled with.
  // js/cloudSync.js uses it to tell "the copy I pulled" from "work another
  // device did", which is what keeps a push from silently overwriting a bid.
  let remoteSeen = null;

  function seenMap() {
    if (!remoteSeen) remoteSeen = TakeoffStorage.loadRemoteSeen();
    return remoteSeen;
  }

  function getSeen(id) {
    return seenMap().projects[id] || null;
  }

  function setSeen(id, updatedAt) {
    if (!updatedAt) return;
    const map = seenMap();
    if (map.projects[id] === updatedAt) return;
    map.projects[id] = updatedAt;
    TakeoffStorage.saveRemoteSeen(map);
  }

  function forgetSeen(id) {
    const map = seenMap();
    if (!(id in map.projects)) return;
    delete map.projects[id];
    TakeoffStorage.saveRemoteSeen(map);
  }

  /**
   * Keep a project copy that would otherwise be overwritten as its own
   * project in the same account (no dialog, nothing to resolve — both bids
   * simply exist). Returns the copy. The index entry is written straight away
   * — a kept copy must be in the project list even if nothing else saves —
   * and also added to `idx`, the caller's copy of the index when it holds one
   * it is about to save, so that save does not drop it again.
   */
  function keepConflictCopy(project, name, idx) {
    const copy = {
      v: 1,
      id: TakeoffStorage.generateProjectId(),
      savedAt: project.savedAt || new Date().toISOString(),
      name,
      manifest: Array.isArray(project.manifest) ? project.manifest : [],
      laborRate: typeof project.laborRate === 'number' ? project.laborRate : 0,
      taxRate: typeof project.taxRate === 'number' ? project.taxRate : undefined,
      plansUrl: typeof project.plansUrl === 'string' && project.plansUrl ? project.plansUrl : undefined,
      details: project.details && typeof project.details === 'object' ? project.details : undefined,
    };
    TakeoffStorage.saveProjectLocalOnly(copy);
    const entry = { id: copy.id, name: copy.name, createdAt: copy.savedAt, updatedAt: copy.savedAt };
    const loaded = TakeoffStorage.loadProjectsIndex() || { v: 1, currentId: null, projects: [] };
    if (!loaded.projects.some((p) => p.id === copy.id)) loaded.projects.push(entry);
    TakeoffStorage.saveProjectsIndex(loaded);
    if (idx && !idx.projects.some((p) => p.id === copy.id)) idx.projects.push({ ...entry });
    queueProjectPush(copy, { immediate: true });
    return copy;
  }

  function noteProjectsError(error) {
    const msg = (error && error.message) || '';
    if ((error && error.code === '42P01') || /does not exist|Could not find the table|schema cache/i.test(msg)) {
      projectsTableAvailable = false;
      if (!projectsTableWarned) {
        projectsTableWarned = true;
        console.warn('Takeoff: takeoff_projects table not found — project cloud sync is off until the SQL migration is applied (supabase/001_takeoff_projects.sql).');
      }
    } else {
      setStatus('error', msg);
    }
  }

  // The cloud row's `data` holds the project document minus its identity, so
  // everything the local document carries (rates, the job's details, where a
  // shared copy came from) survives a round trip.
  function rowToProject(r) {
    const d = r.data || {};
    const project = {
      v: 1,
      id: r.id,
      savedAt: r.updated_at,
      name: r.name || 'Untitled project',
      manifest: Array.isArray(d.manifest) ? d.manifest : [],
      laborRate: typeof d.laborRate === 'number' ? d.laborRate : 0,
    };
    if (typeof d.taxRate === 'number') project.taxRate = d.taxRate;
    // the CountTooling plans link the counts came from (set by the import)
    if (typeof d.plansUrl === 'string' && d.plansUrl) project.plansUrl = d.plansUrl;
    if (d.details && typeof d.details === 'object') project.details = d.details;
    if (d.importedFrom && typeof d.importedFrom === 'object') project.importedFrom = d.importedFrom;
    // a bid closed out on one device is closed out on all of them
    if (d.archived === true) {
      project.archived = true;
      if (typeof d.archivedAt === 'string') project.archivedAt = d.archivedAt;
    }
    return project;
  }

  function projectPayload(project) {
    const payload = { manifest: project.manifest, laborRate: project.laborRate };
    if (typeof project.taxRate === 'number') payload.taxRate = project.taxRate;
    if (typeof project.plansUrl === 'string' && project.plansUrl) payload.plansUrl = project.plansUrl;
    if (project.details && typeof project.details === 'object') payload.details = project.details;
    if (project.importedFrom && typeof project.importedFrom === 'object') payload.importedFrom = project.importedFrom;
    if (project.archived === true) {
      payload.archived = true;
      if (typeof project.archivedAt === 'string') payload.archivedAt = project.archivedAt;
    }
    return payload;
  }

  async function syncProjects(legacyWs) {
    if (!projectsTableAvailable) return;
    const { data, error } = await client.from(PROJECTS_TABLE).select('id,name,data,updated_at');
    if (error) {
      noteProjectsError(error);
      return;
    }
    const allRows = data || [];
    // A row this account deleted on another device, re-uploaded by a third
    // device that never heard about it: honour the delete and clear the row.
    const remoteRows = [];
    for (const r of allRows) {
      if (TakeoffCloudSync.isTombstoned(tombstones, 'projects', r.id, r.updated_at)) {
        client.from(PROJECTS_TABLE).delete().eq('id', r.id).then(() => {});
      } else {
        remoteRows.push(r);
      }
    }
    const remoteById = new Map(remoteRows.map((r) => [r.id, r]));
    const idx = TakeoffStorage.loadProjectsIndex() || { v: 1, currentId: null, projects: [] };
    let indexChanged = false;
    const current = TakeoffState.getCurrentProject();
    const pushed = new Set(); // ids already sent up in this pass
    const openable = []; // projects this device could switch to after the sync

    // Index entries for projects deleted elsewhere leave the list here too
    // (the open project is never dropped underneath the estimator).
    const survivors = idx.projects.filter((p) => {
      if (p.id === current.id) return true;
      const local = TakeoffStorage.loadProject(p.id);
      if (!TakeoffCloudSync.isTombstoned(tombstones, 'projects', p.id, local && local.savedAt)) return true;
      TakeoffStorage.deleteProjectLocalOnly(p.id);
      forgetSeen(p.id);
      return false;
    });
    if (survivors.length !== idx.projects.length) {
      idx.projects = survivors;
      indexChanged = true;
    }

    for (const r of remoteRows) {
      const remoteProject = rowToProject(r);
      const localData = TakeoffStorage.loadProject(r.id);
      const localEntry = idx.projects.find((p) => p.id === r.id);
      const decision = TakeoffCloudSync.decideProjectSync(localData, remoteProject, getSeen(r.id));

      if (decision.action === 'adopt-keep-local' && localData) {
        pushed.add(keepConflictCopy(localData, decision.keepName, idx).id);
        indexChanged = true;
        noteConflict(`“${localData.name}” was also changed on another device. Your version on this device is saved as “${decision.keepName}”.`);
      }
      if (decision.action === 'push-keep-remote') {
        pushed.add(keepConflictCopy(remoteProject, decision.keepName, idx).id);
        indexChanged = true;
        noteConflict(`“${remoteProject.name}” was also changed on another device. That version is saved as “${decision.keepName}”.`);
      }

      if (decision.action === 'adopt' || decision.action === 'adopt-keep-local') {
        TakeoffStorage.saveProjectLocalOnly(remoteProject);
        openable.push(remoteProject);
        if (localEntry) {
          localEntry.name = remoteProject.name;
          localEntry.updatedAt = r.updated_at;
        } else {
          idx.projects.push({ id: r.id, name: remoteProject.name, createdAt: r.updated_at, updatedAt: r.updated_at });
        }
        indexChanged = true;
        if (r.id === current.id) {
          suppressPush = true;
          try {
            TakeoffState.adoptProject(remoteProject);
          } finally {
            suppressPush = false;
          }
        }
      }
      // Record what the cloud held before any push of ours lands, so the next
      // push can tell an unchanged row from another device's work.
      setSeen(r.id, r.updated_at);
      if ((decision.action === 'push' || decision.action === 'push-keep-remote') && localData) {
        pushed.add(r.id);
        queueProjectPush(localData, { immediate: true });
      }
    }

    // local-only projects go up (conflict copies just made are already on
    // their way — pushing them twice could race their own insert). The empty
    // starter every boot mints is not a bid and stays on this device.
    for (const p of idx.projects) {
      if (!remoteById.has(p.id) && !pushed.has(p.id)) {
        const localData = TakeoffStorage.loadProject(p.id);
        if (localData && TakeoffCloudSync.shouldPushNewProject(localData)) queueProjectPush(localData, { immediate: true });
      }
    }
    if (indexChanged) TakeoffStorage.saveProjectsIndex(idx);

    // A legacy cloud workspace with real content, no remote projects, and
    // nothing local beyond empty starters: a fresh device signing in before
    // any migrated device pushed. Surface it as a project once.
    if (
      legacyWs && Array.isArray(legacyWs.manifest) && legacyWs.manifest.length && remoteRows.length === 0 &&
      // "nothing local" means no bid anyone has typed in — the boot starter
      // carries one description-less row, so an empty-array test never
      // matched it and this fallback never fired on a fresh device.
      idx.projects.every((p) => TakeoffCloudSync.isStarterProject(TakeoffStorage.loadProject(p.id)))
    ) {
      const when = new Date(Date.parse(legacyWs.savedAt) || Date.now());
      const project = {
        v: 1,
        id: TakeoffStorage.generateProjectId(),
        savedAt: legacyWs.savedAt || new Date().toISOString(),
        name: `Takeoff — ${when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
        manifest: legacyWs.manifest,
        laborRate: typeof legacyWs.laborRate === 'number' ? legacyWs.laborRate : 0,
      };
      TakeoffStorage.saveProjectLocalOnly(project);
      idx.projects.push({ id: project.id, name: project.name, createdAt: project.savedAt, updatedAt: project.savedAt });
      TakeoffStorage.saveProjectsIndex(idx);
      queueProjectPush(project, { immediate: true });
      openable.push(project);
    }

    // The point of signing in is that the bid shows up. On a new device the
    // open project is the starter minted at boot, whose id can never match a
    // remote row — so nothing was ever adopted into view. Open the account's
    // most recent bid instead. A project with work in it is never disturbed.
    const openId = TakeoffCloudSync.pickProjectToOpen(
      { id: current.id, manifest: TakeoffState.getManifest() },
      openable
    );
    if (openId) {
      suppressPush = true;
      try {
        TakeoffState.switchProject(openId);
      } finally {
        suppressPush = false;
      }
    }
  }

  function queueProjectPush(project, opts) {
    if (!client || !session || !projectsTableAvailable) return;
    // An empty starter never earns a cloud row; once the project has a row up
    // there, every save of it goes up, empty or not (that is a real edit).
    if (!TakeoffCloudSync.shouldPushNewProject(project) && !getSeen(project.id)) return;
    pendingProjects[project.id] = project;
    clearTimeout(projectPushTimers[project.id]);
    if (opts && opts.immediate) {
      pushProjectNow(project.id);
    } else {
      projectPushTimers[project.id] = setTimeout(() => pushProjectNow(project.id), PUSH_DEBOUNCE_MS);
    }
  }

  let projectRpcAvailable = true; // supabase/003 applied? found out on first use

  function isMissingRpc(error) {
    const msg = (error && error.message) || '';
    return (error && (error.code === 'PGRST202' || error.code === '42883')) || /function .*does not exist|Could not find the function|schema cache/i.test(msg);
  }

  /**
   * Write one project row only if the caller's view of it is current.
   * With supabase/003 applied the check happens inside one statement; without
   * it, the same check is made across a read and a write (a push landing
   * between the two still wins by clock — that is the gap 003 closes).
   * Returns { applied, row } or { error }.
   */
  async function writeProjectRow(project, expected) {
    const payload = projectPayload(project);
    if (projectRpcAvailable) {
      const { data, error } = await client.rpc('takeoff_upsert_project', {
        p_id: project.id,
        p_name: project.name,
        p_data: payload,
        p_updated_at: project.savedAt,
        p_expected_updated_at: expected || null,
      });
      if (!error) {
        const res = data || {};
        return { applied: !!res.applied, row: res.row || null };
      }
      if (!isMissingRpc(error)) return { error };
      projectRpcAvailable = false; // fall through to the two-call form
    }
    const { data: rows, error: readError } = await client
      .from(PROJECTS_TABLE)
      .select('id,name,data,updated_at')
      .eq('id', project.id)
      .limit(1);
    if (readError) return { error: readError };
    const row = rows && rows[0];
    const stampsMatch = !!row && !!expected && (Date.parse(row.updated_at) || 0) === (Date.parse(expected) || 0);
    if (row && !stampsMatch) return { applied: false, row };
    const { error } = await client.from(PROJECTS_TABLE).upsert({
      id: project.id,
      user_id: session.user.id,
      name: project.name,
      data: payload,
      updated_at: project.savedAt,
    });
    if (error) return { error };
    return { applied: true, row: { id: project.id, name: project.name, updated_at: project.savedAt } };
  }

  /**
   * Push one project, but never over another device's work. When the row moved
   * since this device last saw it, that copy is kept as its own project first
   * — both bids survive, and neither estimator is asked to resolve a merge.
   */
  async function pushProjectNow(id) {
    if (!client || !session || !(id in pendingProjects)) return;
    const project = pendingProjects[id];
    delete pendingProjects[id];

    let res = await writeProjectRow(project, getSeen(id));
    if (res.error) {
      pendingProjects[id] = project; // retry on the next save or flush
      noteProjectsError(res.error);
      return;
    }
    if (!res.applied) {
      const row = res.row;
      if (!row) {
        pendingProjects[id] = project;
        return;
      }
      const remoteProject = rowToProject(row);
      const decision = TakeoffCloudSync.decideProjectPush(project, remoteProject, getSeen(id));
      setSeen(id, row.updated_at);
      if (decision.action === 'in-sync') return; // the cloud already holds this bid
      if (decision.action === 'fork-remote') {
        keepConflictCopy(remoteProject, decision.keepName);
        noteConflict(`“${remoteProject.name}” was also changed on another device. That version is saved as “${decision.keepName}”.`);
      }
      res = await writeProjectRow(project, row.updated_at);
      if (res.error || !res.applied) {
        pendingProjects[id] = project; // someone wrote again — try on the next save
        if (res.error) noteProjectsError(res.error);
        return;
      }
    }
    setSeen(id, (res.row && res.row.updated_at) || project.savedAt);
    setSyncedIfSettled();
  }

  function queuePush(key, value, opts) {
    if (!client || !session) return;
    pendingValues[key] = value;
    clearTimeout(pushTimers[key]);
    if (opts && opts.immediate) {
      pushNow(key);
    } else {
      pushTimers[key] = setTimeout(() => pushNow(key), PUSH_DEBOUNCE_MS);
    }
  }

  async function pushNow(key) {
    if (!client || !session || !(key in pendingValues)) return;
    const value = pendingValues[key];
    delete pendingValues[key];
    const { error } = await client.from(TABLE).upsert({ user_id: session.user.id, key, value });
    if (error) {
      pendingValues[key] = value; // retry on the next save or flush
      setStatus('error', error.message);
    } else {
      setSyncedIfSettled();
      if (key === 'book') pushSuggestions();
    }
  }

  /**
   * The lid closing on a laptop, or a tab being shut. An ordinary push dies
   * with the page — the request is cancelled in flight and the header's
   * checkmark was a lie — so the queue goes out as keepalive fetches, which
   * the browser finishes after the page is gone. js/cloudSync.js builds the
   * requests (and says what will not fit in the browser's keepalive budget);
   * anything it defers takes the ordinary path, exactly as before.
   */
  function flushPendingOnUnload() {
    if (!client || !session) return;
    // app.js flushes the debounced local saves on the way out too, but this
    // listener was registered first (cloud.js loads earlier), so the last
    // keystroke would not be in the queue yet. Write it down first, then send.
    // The saves are idempotent; app.js's own call finds nothing left to do.
    try {
      if (typeof TakeoffState !== 'undefined') TakeoffState.persistAllNow();
    } catch (_) { /* nothing to persist */ }
    if (!pendingCount()) return;
    const projects = Object.keys(pendingProjects).map((id) => ({
      project: pendingProjects[id],
      expectedUpdatedAt: getSeen(id),
    }));
    let requests = [];
    try {
      ({ requests } = TakeoffCloudSync.buildKeepalivePushes({
        baseUrl: SUPABASE_URL,
        apiKey: SUPABASE_KEY,
        accessToken: session.access_token,
        userId: session.user.id,
        values: { ...pendingValues },
        projects,
        rpcAvailable: projectRpcAvailable,
        projectPayload,
      }));
    } catch (err) {
      console.warn('Takeoff: final push could not be prepared', err);
    }
    for (const req of requests) {
      if (req.what.kind === 'store') {
        clearTimeout(pushTimers[req.what.key]);
        delete pendingValues[req.what.key];
      } else {
        clearTimeout(projectPushTimers[req.what.id]);
        delete pendingProjects[req.what.id];
        // Record the stamp this request writes. Without it the next load
        // finds a row newer than anything it has seen — its own push — and
        // forks the bid into a conflict copy of itself. A request that never
        // lands leaves the cloud older than "seen", which the ordinary push
        // path already handles (it re-reads and writes).
        setSeen(req.what.id, req.what.updatedAt);
      }
      try {
        fetch(req.url, req.options).catch(() => {});
      } catch (_) { /* the page is going anyway */ }
    }
    flushPending();
  }

  // Returns a promise so sign-out (and any other last-moment exit) can wait
  // for the writes it just kicked off.
  function flushPending() {
    const jobs = [];
    for (const key of Object.keys(pendingValues)) jobs.push(pushNow(key));
    for (const id of Object.keys(pendingProjects)) jobs.push(pushProjectNow(id));
    return Promise.all(jobs);
  }

  // --- Shared-book corrections (opt-in; see docs/ARCHITECTURE.md) ---

  // Roles come from takeoff_profiles (002 migration): admin reviews shared
  // corrections; dev additionally manages users. The email check is a
  // fallback so the review panel keeps working until 002 is applied.
  //
  // Re-read on demand as well as at sign-in (refreshRole below): a role
  // change used to need a sign-out before the promoted user saw their own
  // surfaces, because this ran in exactly one place.
  async function fetchProfileRole() {
    if (!client || !session) {
      profileRole = null;
      return;
    }
    try {
      const { data } = await client.from('takeoff_profiles').select('role').eq('user_id', session.user.id).maybeSingle();
      profileRole = data ? data.role : null;
    } catch (_) {
      profileRole = null;
    }
    updateUi();
  }

  function getRole() {
    return session ? profileRole || 'user' : null;
  }

  /**
   * Read this account's role again and re-chrome the app around it. Called
   * after a role is changed in Manage Users and on every "Sync now", so a
   * promotion shows up in the menu on the next sync instead of the next
   * sign-in (J13-F13).
   */
  function refreshRole() {
    return fetchProfileRole();
  }

  function isAdmin() {
    if (profileRole) return profileRole === 'admin' || profileRole === 'dev';
    return (getEmail() || '').toLowerCase() === ADMIN_EMAIL;
  }

  function isDev() {
    return profileRole === 'dev';
  }

  // --- Dev-only user management (RPCs + the takeoff-admin Edge Function) ---

  async function listUsers() {
    if (!client || !session) return { rows: [], error: 'Not signed in' };
    const { data, error } = await client.rpc('takeoff_list_users');
    return { rows: data || [], error: error ? error.message : null };
  }

  async function setUserRole(userId, role) {
    if (!client || !session) return 'Not signed in';
    const { error } = await client.rpc('takeoff_set_user_role', { target: userId, new_role: role });
    return error ? error.message : null;
  }

  /**
   * Create the account so it is in the directory with a role on it. No
   * password: the office has no way to deliver one safely and nobody could
   * change it afterwards — the person signs in with the emailed code and sets
   * their own password from the cloud dialog (X3).
   */
  async function adminCreateUser(email) {
    if (!client || !session) return { error: 'Not signed in' };
    const { data, error } = await client.functions.invoke('takeoff-admin', {
      body: { action: 'create-user', email },
    });
    if (error) {
      // supabase-js wraps non-2xx responses; surface the function's message
      let message = error.message;
      try {
        const body = await error.context.json();
        message = body.error || message;
      } catch (_) { /* not a JSON body */ }
      // The deployed function predates the passwordless change: say which
      // command fixes it rather than leaving a bare "password is required".
      if (/password.*required/i.test(message || '')) {
        message = 'The takeoff-admin function still requires a password — redeploy it (supabase functions deploy takeoff-admin).';
      }
      return { error: message };
    }
    return data && data.ok ? { userId: data.userId } : { error: (data && data.error) || 'Unknown error' };
  }

  async function adminDeleteUser(userId) {
    if (!client || !session) return 'Not signed in';
    const { data, error } = await client.functions.invoke('takeoff-admin', {
      body: { action: 'delete-user', userId },
    });
    if (error) {
      try {
        const body = await error.context.json();
        return body.error || error.message;
      } catch (_) {
        return error.message;
      }
    }
    return data && data.ok ? null : (data && data.error) || 'Unknown error';
  }

  // Consent is the account's, and it is only ever true for a signed-in
  // session that has read the account's own row. On a shared machine the next
  // person signs in to their own answer, never to the last person's.
  function isSharing() {
    return !!(session && shareConsentLoaded && shareConsent);
  }

  async function setSharing(on) {
    if (!client || !session) return;
    shareConsent = !!on;
    shareConsentLoaded = true;
    forgetSharedRowKeys();
    await client.from(TABLE).upsert({ user_id: session.user.id, key: 'share', value: TakeoffCloudSync.shareConsentRow(on) });
    if (on) {
      await pushSuggestions();
    } else {
      // stop sharing = withdraw what was shared, from whichever device says so
      await client.from(SUGGESTIONS_TABLE).delete().eq('user_id', session.user.id);
    }
    updateUi();
  }

  /**
   * The book rows whose correction is currently being shared, keyed
   * tab␁section␁name, so the book can mark them on the row itself. (The price
   * provenance badge cannot carry this: a labor-only fix on a price-less row
   * has no badge at all.) Memoised briefly — the book re-renders a row at a
   * time and the diff walks the whole book.
   */
  let sharedKeysCache = null;
  let sharedKeysAt = 0;

  function getSharedRowKeys() {
    if (!isSharing() || typeof TakeoffState === 'undefined' || !TakeoffState.getBookCorrections) return new Set();
    const now = Date.now();
    if (sharedKeysCache && now - sharedKeysAt < 1500) return sharedKeysCache;
    sharedKeysCache = new Set(TakeoffState.getBookCorrections().map((c) => [c.tab, c.section, c.name].join('\u0001')));
    sharedKeysAt = now;
    return sharedKeysCache;
  }

  function forgetSharedRowKeys() {
    sharedKeysCache = null;
  }

  // Upsert the user's current correction list; prune rows they've reverted.
  // Fire-and-forget from the sync path — a failure here never blocks the
  // workspace sync itself.
  async function pushSuggestions() {
    if (!client || !session || !isSharing()) return;
    if (typeof TakeoffState === 'undefined' || !TakeoffState.getBookCorrections) return;
    try {
      const list = TakeoffState.getBookCorrections();
      const keyOf = (t, s, n) => [t, s, n].join('\u0001');
      if (list.length) {
        const rows = list.map((c) => ({
          user_id: session.user.id,
          email: getEmail(),
          tab: c.tab,
          section: c.section,
          part_name: c.name,
          kind: c.kind,
          old_value: c.old,
          new_value: c.new,
          updated_at: new Date().toISOString(),
        }));
        const { error } = await client.from(SUGGESTIONS_TABLE).upsert(rows, { onConflict: 'user_id,tab,section,part_name' });
        if (error) {
          console.warn('Takeoff: sharing corrections failed', error.message);
          return;
        }
      }
      const current = new Set(list.map((c) => keyOf(c.tab, c.section, c.name)));
      const { data } = await client.from(SUGGESTIONS_TABLE).select('id,tab,section,part_name').eq('user_id', session.user.id);
      const stale = (data || []).filter((r) => !current.has(keyOf(r.tab, r.section, r.part_name))).map((r) => r.id);
      if (stale.length) await client.from(SUGGESTIONS_TABLE).delete().in('id', stale);
    } catch (err) {
      console.warn('Takeoff: sharing corrections failed', err);
    }
  }

  // Review-panel IO (RLS: only the admin sees rows beyond their own).
  async function fetchSuggestions(status) {
    if (!client || !session) return { data: [], error: 'Not signed in' };
    const { data, error } = await client
      .from(SUGGESTIONS_TABLE)
      .select('id,user_id,email,tab,section,part_name,kind,old_value,new_value,status,updated_at')
      .eq('status', status)
      .order('updated_at', { ascending: false })
      .limit(2000);
    return { data: data || [], error: error ? error.message : null };
  }

  async function setSuggestionStatus(ids, status) {
    if (!client || !session || !ids.length) return null;
    const { error } = await client.from(SUGGESTIONS_TABLE).update({ status }).in('id', ids);
    return error ? error.message : null;
  }

  /**
   * What became of this user's own shared rows — keyed tab␁section␁part.
   * RLS lets every user read their own rows, so the contributor can see
   * whether a correction was taken up (J12-F6).
   */
  async function fetchMySuggestionStatuses() {
    if (!client || !session) return null;
    const { data, error } = await client
      .from(SUGGESTIONS_TABLE)
      .select('tab,section,part_name,status')
      .eq('user_id', session.user.id);
    // null, not {} — "the cloud did not answer" must not render as
    // "not sent yet" against every row
    if (error) return null;
    const out = {};
    for (const r of data || []) out[[r.tab, r.section, r.part_name].join('\u0001')] = r.status || 'pending';
    return out;
  }

  // --- Tombstones: a delete has to travel or the next device brings it back ---

  function saveTombstones() {
    if (!client || !session) return;
    queuePush('deleted', tombstones, { immediate: true });
  }

  function noteDeleted(kind, id) {
    tombstones = TakeoffCloudSync.withTombstone(tombstones, kind, id, new Date().toISOString());
    saveTombstones();
  }

  // Called by TakeoffStorage after each local save.
  function onBookSaved(data) {
    if (suppressPush) return;
    queuePush('book', data);
  }

  function onProjectSaved(project) {
    if (suppressPush) return;
    queueProjectPush(project);
  }

  function onProjectDeleted(id) {
    forgetSeen(id);
    if (!client || !session) return;
    delete pendingProjects[id];
    // The tombstone is what reaches the other devices: deleting the row alone
    // only lasts until one of them re-uploads its index entry.
    noteDeleted('projects', id);
    if (!projectsTableAvailable) return;
    client.from(PROJECTS_TABLE).delete().eq('id', id).then(({ error }) => {
      if (error) noteProjectsError(error);
    });
  }

  function onAssembliesSaved(list) {
    if (suppressPush) {
      lastAssemblyIds = (list || []).map((a) => a && a.id).filter(Boolean);
      return;
    }
    const gone = TakeoffCloudSync.removedIds(lastAssemblyIds.map((id) => ({ id })), list);
    lastAssemblyIds = (list || []).map((a) => a && a.id).filter(Boolean);
    queuePush('assemblies', list);
    for (const id of gone) noteDeleted('assemblies', id);
  }

  // --- Auth ---

  async function sendCode(email) {
    const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (!error) pendingEmail = email;
    return error ? error.message : null;
  }

  async function verifyCode(email, token) {
    const { error } = await client.auth.verifyOtp({ email, token, type: 'email' });
    if (!error) authMethod = 'code';
    return error ? error.message : null;
  }

  async function signInWithPassword(email, password) {
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (!error) authMethod = 'password';
    return error ? error.message : null;
  }

  // The app's own address with no hash route on it. Supabase sends the
  // recovery token back as a hash, so this exact URL has to be listed under
  // Authentication → URL Configuration → Redirect URLs (supabase/README.md).
  function appUrl() {
    return window.location.origin + window.location.pathname;
  }

  /**
   * Send the "choose a new password" email. The link comes back to this page
   * with a recovery session on it; onAuthStateChange picks it up below and
   * the modal shows the new-password form.
   */
  async function sendPasswordReset(email) {
    if (!client) return 'Cloud sync is not available in this browser.';
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
    return error ? error.message : null;
  }

  // Set or change the signed-in account's password. This is the whole of
  // account management the app needs: an account provisioned by the office,
  // or created by an emailed code, can give itself a password from here
  // instead of keeping a temporary one forever (J13-F13).
  async function updatePassword(password) {
    if (!client || !session) return 'Sign in first.';
    const { error } = await client.auth.updateUser({ password });
    if (error) return error.message;
    authMethod = 'password';
    recoveryMode = false;
    return null;
  }

  async function signOut() {
    // Local data stays on this device; only the cloud link is removed — but
    // anything already written locally goes up first: clearing the timers
    // without pushing drops the last edit from the cloud (J11-F13).
    for (const key of Object.keys(pushTimers)) clearTimeout(pushTimers[key]);
    for (const id of Object.keys(projectPushTimers)) clearTimeout(projectPushTimers[id]);
    try {
      await flushPending();
    } catch (err) {
      console.warn('Takeoff: final push before sign-out failed', err);
    }
    await client.auth.signOut();
    pendingEmail = '';
    authMethod = null;
    recoveryMode = false;
    syncedThisLoad = false;
    // consent belongs to the account, not this browser
    shareConsent = false;
    shareConsentLoaded = false;
    setStatus('signedOut');
  }

  if (client) {
    client.auth.onAuthStateChange((event, s) => {
      session = s;
      if (session) fetchProfileRole();
      else profileRole = null;
      // A recovery link lands here with a session already on it. The one
      // thing to do with it is choose a new password, so say so straight away
      // rather than leaving the estimator signed in and none the wiser.
      if (event === 'PASSWORD_RECOVERY') {
        recoveryMode = true;
        openModal();
      }
      if (session && !syncedThisLoad) {
        syncedThisLoad = true;
        renderModal();
        syncDown();
      } else {
        updateUi();
      }
    });
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushPending();
    });
    // pagehide is the reliable one (iOS never fires beforeunload); both are
    // registered because a desktop tab close can fire either first. The second
    // one finds the queue empty and does nothing.
    window.addEventListener('pagehide', flushPendingOnUnload);
    window.addEventListener('beforeunload', flushPendingOnUnload);
  }

  // --- Notice line (one dismissible line under the header) ---
  // Kept copies are the whole story, so a conflict notice only says what
  // happened and where to find the other version. No dialog, nothing to
  // resolve. The same line carries "the shared book moved" at boot.

  const conflictNotices = [];

  function noteConflict(text) {
    if (conflictNotices.includes(text)) return;
    conflictNotices.push(text);
    renderConflictNotice();
  }

  /**
   * The shared book moved under this user: say so once, and name the rows,
   * because "3 values changed" with no names sends them hunting. Only rows a
   * defaults upgrade actually rewrote are counted — never a new section, and
   * never a row they had edited themselves (those are left alone). Runs
   * signed in or out: the book ships with the app, not with the account.
   */
  function noteBookUpdate() {
    if (typeof TakeoffState === 'undefined' || !TakeoffState.takeBookUpdate) return;
    const update = TakeoffState.takeBookUpdate();
    if (!update || !update.rows || !update.rows.length) return;
    const names = update.rows.map((r) => r.name).filter(Boolean);
    const shown = names.slice(0, 4).join(', ');
    const rest = names.length - Math.min(names.length, 4);
    const what = names.length === 1 ? '1 part' : `${names.length} parts`;
    noteConflict(`The shared parts book was updated — ${what} you had not changed: ${shown}${rest > 0 ? ` and ${rest} more` : ''}.`);
  }

  function renderConflictNotice() {
    const header = document.querySelector('#app > header');
    if (!header) return;
    let el = document.getElementById('cloud-notice');
    if (!conflictNotices.length) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.id = 'cloud-notice';
      el.className = 'cloud-notice';
      el.setAttribute('role', 'status');
      header.insertAdjacentElement('afterend', el);
    }
    el.innerHTML = [
      '<div class="cloud-notice-lines">',
      conflictNotices.map((t) => `<span class="cloud-notice-line">${escapeHtml(t)}</span>`).join(''),
      '</div>',
      '<button type="button" id="cloud-notice-dismiss" class="cloud-notice-dismiss" aria-label="Dismiss">Dismiss</button>',
    ].join('');
    document.getElementById('cloud-notice-dismiss').addEventListener('click', () => {
      conflictNotices.length = 0;
      renderConflictNotice();
    });
  }

  // --- UI (header button + #cloud-modal; one-time listeners) ---

  function buttonLabel() {
    if (status === 'disabled') return 'Cloud';
    if (!session) return 'Sign In';
    if (status === 'syncing') return 'Syncing…';
    if (status === 'error') return '⚠ Cloud';
    return '✓ Cloud';
  }

  function updateUi() {
    const btn = document.getElementById('cloud-btn');
    if (btn) {
      btn.textContent = buttonLabel();
      // the error says what went wrong without opening the dialog (J11-F14)
      btn.title = !session
        ? 'Sync this takeoff across devices'
        : status === 'error'
          ? `Sync error: ${statusDetail || 'the cloud did not answer'} — your work is saved on this computer`
          : `Signed in as ${getEmail()}` +
            (pendingCount() ? ' — sending your latest changes' : lastSyncedAt ? ` — last synced ${lastSyncedAt.toLocaleTimeString()}` : '');
      btn.classList.toggle('cloud-btn-error', status === 'error');
    }
    // the review panel is admin-only chrome
    document.getElementById('review-suggestions-btn')?.toggleAttribute('hidden', !(session && isAdmin()));
    document.getElementById('manage-users-btn')?.toggleAttribute('hidden', !(session && isDev()));
    // supplier price updates are maintainer tooling (CSV matching, JSON
    // downloads meant to be committed to the repo) — admin/dev only
    document.getElementById('mc-elliot-update-btn')?.toggleAttribute('hidden', !(session && isAdmin()));
    const modal = document.getElementById('cloud-modal');
    if (modal && modal.getAttribute('aria-hidden') === 'false') renderModal();
  }

  // Where a part lives, as the book itself shows it: "Gear · Panels · 1PH".
  // Storage keys ("gear", "Panels.1PH") are not the trade's words.
  function bookTrail(tab, section) {
    const labels = (typeof TakeoffState !== 'undefined' && TakeoffState.LABOR_BOOK_TYPE_LABELS) || {};
    return [labels[tab] || tab, ...String(section || '').split('.')].filter(Boolean).join(' · ');
  }

  // "0.09 hrs" / "$215.00" / "0.09 hrs · $215.00" — a price-less row says
  // nothing about price rather than "$—".
  function shareValue(v) {
    if (!v) return '';
    const parts = [];
    if (v.labor != null && v.labor !== '') parts.push(`${v.labor} hrs`);
    const price = Number(v.price);
    if (v.price !== '' && v.price != null && Number.isFinite(price)) parts.push(`$${price.toFixed(2)}`);
    return parts.join(' · ') || 'no numbers';
  }

  const SHARE_STATUS_WORDS = {
    pending: 'waiting for review',
    accepted: 'accepted',
    shipped: 'in the shared book',
    dismissed: 'not adopted',
  };

  function renderSharingSection() {
    const sharing = isSharing();
    const corrections = typeof TakeoffState !== 'undefined' && TakeoffState.getBookCorrections ? TakeoffState.getBookCorrections() : [];
    const n = corrections.length;
    return [
      '<div class="cloud-share-section">',
      '<div class="cloud-share-head"><strong>Improve the shared book</strong>',
      `<label class="cloud-share-toggle"><input type="checkbox" id="cloud-share-toggle" ${sharing ? 'checked' : ''} /> <span>${sharing ? 'On' : 'Off'}</span></label></div>`,
      '<p class="cloud-hint">Share your price and labor corrections so the shared parts book gets more accurate for everyone. Only book edits are shared — never your takeoffs or job data.</p>',
      `<p class="cloud-hint">Your sign-in email (${escapeHtml(getEmail() || '')}) goes with each correction, so we can ask you about it.</p>`,
      sharing
        ? `<p class="cloud-hint cloud-share-status">${n} correction${n === 1 ? '' : 's'} shared${n ? ' · <button type="button" id="cloud-share-view-btn" class="btn-link cloud-share-view-btn">see what’s shared</button>' : ''}</p><div id="cloud-share-list" class="cloud-share-list" hidden></div>`
        : '',
      '</div>',
    ].join('');
  }

  function renderShareList(listEl, statuses) {
    const corrections = TakeoffState.getBookCorrections();
    listEl.innerHTML = corrections
      .map((c) => {
        const change =
          c.kind === 'edit'
            ? `${shareValue(c.old)} → ${shareValue(c.new)}`
            : c.kind === 'new'
              ? `${shareValue(c.new)} · new part`
              : 'you removed this row';
        const status = statuses ? statuses[[c.tab, c.section, c.name].join('\u0001')] : null;
        const word = SHARE_STATUS_WORDS[status] || (statuses ? 'not sent yet' : '');
        return `<div class="cloud-share-row"><span class="cloud-share-part">${escapeHtml(c.name)}</span><span class="cloud-share-where">${escapeHtml(bookTrail(c.tab, c.section))}</span><span class="cloud-share-change">${escapeHtml(change)}</span><span class="cloud-share-state">${escapeHtml(word)}</span></div>`;
      })
      .join('') || '<p class="cloud-hint">Nothing shared yet.</p>';
  }

  // --- Passwords (X3) ---
  // One form does both jobs: a signed-in account setting or changing its own
  // password, and the "choose a new password" screen a reset link lands on.

  const MIN_PASSWORD = 8;

  function passwordFormHtml(saveLabel) {
    return [
      '<div class="cloud-form-row"><input type="password" id="cloud-new-password" class="cloud-email-input" placeholder="New password (8 characters or more)" autocomplete="new-password" />',
      `<button type="button" id="cloud-save-password-btn" class="btn btn-success">${saveLabel}</button></div>`,
      '<p class="cloud-hint" id="cloud-password-msg"></p>',
    ].join('');
  }

  function attachPasswordFormListeners(onSaved) {
    const msg = () => document.getElementById('cloud-password-msg');
    const save = async () => {
      const input = document.getElementById('cloud-new-password');
      const value = input ? input.value : '';
      if (value.length < MIN_PASSWORD) {
        msg().textContent = `Use at least ${MIN_PASSWORD} characters.`;
        return;
      }
      msg().textContent = 'Saving…';
      const err = await updatePassword(value);
      if (err) {
        msg().textContent = err;
        return;
      }
      if (onSaved) onSaved();
    };
    document.getElementById('cloud-save-password-btn')?.addEventListener('click', save);
    document.getElementById('cloud-new-password')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save();
    });
  }

  // The signed-in account's own password, behind a toggle so the dialog still
  // opens on the thing people came for (the sync state).
  function renderPasswordSection() {
    const label = authMethod === 'code' ? 'Set a password' : 'Change password';
    return [
      '<div class="cloud-form-row">',
      `<button type="button" id="cloud-password-toggle" class="btn btn-secondary">${label}</button>`,
      '</div>',
      '<div id="cloud-password-form" hidden>',
      passwordFormHtml('Save password'),
      '</div>',
    ].join('');
  }

  function attachPasswordSectionListeners() {
    document.getElementById('cloud-password-toggle')?.addEventListener('click', () => {
      const form = document.getElementById('cloud-password-form');
      if (!form) return;
      form.hidden = !form.hidden;
      if (!form.hidden) document.getElementById('cloud-new-password').focus();
    });
    attachPasswordFormListeners(() => {
      const msg = document.getElementById('cloud-password-msg');
      if (msg) msg.textContent = 'Password saved. Use it next time you sign in.';
      const input = document.getElementById('cloud-new-password');
      if (input) input.value = '';
    });
  }

  function attachSharingListeners() {
    document.getElementById('cloud-share-toggle')?.addEventListener('change', (e) => {
      setSharing(e.target.checked).then(renderModal);
    });
    document.getElementById('cloud-share-view-btn')?.addEventListener('click', () => {
      const listEl = document.getElementById('cloud-share-list');
      if (!listEl) return;
      if (!listEl.hidden) {
        listEl.hidden = true;
        return;
      }
      renderShareList(listEl, null); // what is on this machine, right away
      listEl.hidden = false;
      // …then what became of each one, once the cloud answers
      fetchMySuggestionStatuses().then((statuses) => {
        if (!statuses) return; // no answer — leave the local list standing
        const el = document.getElementById('cloud-share-list');
        if (el && !el.hidden) renderShareList(el, statuses);
      });
    });
  }

  function renderModal() {
    const body = document.getElementById('cloud-modal-body');
    if (!body) return;
    if (status === 'disabled') {
      body.innerHTML = '<p class="cloud-hint">Cloud sync is not available (the sync library failed to load). The app keeps saving to this browser.</p>';
      return;
    }
    // Arrived on a reset link: nothing else in here matters until the
    // password is chosen.
    if (session && recoveryMode) {
      body.innerHTML = [
        `<p>Choose a new password for <strong>${escapeHtml(getEmail() || '')}</strong>.</p>`,
        passwordFormHtml('Save password'),
      ].join('');
      attachPasswordFormListeners(() => {
        recoveryMode = false;
        renderModal();
        noteConflict('Your new password is saved. Sign in with it from now on.');
      });
      document.getElementById('cloud-new-password').focus();
      return;
    }
    if (session) {
      const waiting = pendingCount();
      const state = status === 'error'
        ? 'Sync error: ' + escapeHtml(statusDetail)
        : waiting
          ? `Sending your latest changes… (${waiting} waiting)`
          : lastSyncedAt
            ? 'Last synced ' + escapeHtml(lastSyncedAt.toLocaleTimeString())
            : 'Waiting for first sync…';
      body.innerHTML = [
        `<p>Signed in as <strong>${escapeHtml(getEmail() || '')}</strong></p>`,
        authMethod === 'code'
          ? '<p class="cloud-hint">You signed in with an emailed code. Set a password below if you would rather type one next time.</p>'
          : '',
        `<p class="cloud-hint">${state}</p>`,
        '<div class="cloud-form-row"><button type="button" id="cloud-sync-now-btn" class="btn btn-secondary">Sync now</button>',
        '<button type="button" id="cloud-sign-out-btn" class="btn btn-secondary">Sign Out</button></div>',
        '<p class="cloud-hint">Sync now reconciles this computer with the cloud — the newer copy wins each way.</p>',
        renderPasswordSection(),
        renderSharingSection(),
      ].join('');
      document.getElementById('cloud-sync-now-btn').addEventListener('click', () => {
        syncedThisLoad = true;
        syncDown();
      });
      document.getElementById('cloud-sign-out-btn').addEventListener('click', signOut);
      attachPasswordSectionListeners();
      attachSharingListeners();
      return;
    }
    if (pendingEmail) {
      body.innerHTML = [
        `<p>Enter the 6-digit code sent to <strong>${escapeHtml(pendingEmail)}</strong>.</p>`,
        '<div class="cloud-form-row"><input type="text" id="cloud-code-input" class="cloud-code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" />',
        '<button type="button" id="cloud-verify-btn" class="btn btn-success">Verify</button></div>',
        '<p class="cloud-hint" id="cloud-modal-msg"></p>',
        '<button type="button" id="cloud-restart-btn" class="btn btn-link">Use a different email</button>',
      ].join('');
      const verify = async () => {
        const token = document.getElementById('cloud-code-input').value.trim();
        if (token.length < 6) return;
        const msg = document.getElementById('cloud-modal-msg');
        msg.textContent = 'Verifying…';
        const err = await verifyCode(pendingEmail, token);
        if (err) msg.textContent = err;
        else pendingEmail = ''; // onAuthStateChange re-renders
      };
      document.getElementById('cloud-verify-btn').addEventListener('click', verify);
      document.getElementById('cloud-code-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') verify();
      });
      document.getElementById('cloud-restart-btn').addEventListener('click', () => {
        pendingEmail = '';
        renderModal();
      });
      document.getElementById('cloud-code-input').focus();
      return;
    }
    body.innerHTML = [
      '<p>Sign in to sync this takeoff across devices.</p>',
      '<div class="cloud-form-row"><input type="email" id="cloud-email-input" class="cloud-email-input" placeholder="you@example.com" autocomplete="email" /></div>',
      '<div class="cloud-form-row"><input type="password" id="cloud-password-input" class="cloud-email-input" placeholder="Password" autocomplete="current-password" />',
      '<button type="button" id="cloud-password-btn" class="btn btn-success">Sign In</button></div>',
      '<p class="cloud-hint" id="cloud-modal-msg"></p>',
      '<button type="button" id="cloud-forgot-btn" class="btn btn-link">Forgot your password?</button>',
      '<div class="cloud-or-divider"><span></span>or<span></span></div>',
      '<button type="button" id="cloud-send-code-btn" class="btn btn-secondary cloud-send-code-btn">Email me a 6-digit sign-in code</button>',
      '<p class="cloud-hint">No password, or new here? The emailed code signs you in — and creates your account if you don’t have one yet.</p>',
    ].join('');
    const getEmailValue = () => document.getElementById('cloud-email-input').value.trim();
    const msgEl = () => document.getElementById('cloud-modal-msg');
    // Both buttons answer the same way, and neither leaves the previous
    // answer on screen under a click it has nothing to do with (J11-F4/NEW-3).
    const signIn = async () => {
      msgEl().textContent = '';
      const email = getEmailValue();
      const password = document.getElementById('cloud-password-input').value;
      if (!email || !email.includes('@')) {
        msgEl().textContent = 'Enter your email first.';
        return;
      }
      if (!password) {
        msgEl().textContent = 'Enter your password, or use the emailed code below.';
        return;
      }
      msgEl().textContent = 'Signing in…';
      const err = await signInWithPassword(email, password);
      if (err) msgEl().textContent = err; // onAuthStateChange re-renders on success
    };
    const send = async () => {
      msgEl().textContent = '';
      const email = getEmailValue();
      if (!email || !email.includes('@')) {
        msgEl().textContent = 'Enter your email first.';
        return;
      }
      msgEl().textContent = 'Sending code…';
      const err = await sendCode(email);
      if (err) msgEl().textContent = err;
      else renderModal();
    };
    // Forgetting a password used to be the end of the road: the email carries
    // a link back to this page, where the modal asks for a new one.
    const forgot = async () => {
      msgEl().textContent = '';
      const email = getEmailValue();
      if (!email || !email.includes('@')) {
        msgEl().textContent = 'Enter your email first.';
        return;
      }
      msgEl().textContent = 'Sending…';
      const err = await sendPasswordReset(email);
      msgEl().textContent = err || `Check ${email} — the link in it lets you choose a new password.`;
    };
    document.getElementById('cloud-password-btn').addEventListener('click', signIn);
    document.getElementById('cloud-forgot-btn').addEventListener('click', forgot);
    document.getElementById('cloud-password-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') signIn();
    });
    document.getElementById('cloud-send-code-btn').addEventListener('click', send);
    document.getElementById('cloud-email-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('cloud-password-input').focus();
    });
    document.getElementById('cloud-email-input').focus();
  }

  function openModal() {
    const modal = document.getElementById('cloud-modal');
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'false');
    renderModal();
  }

  function closeModal() {
    const modal = document.getElementById('cloud-modal');
    if (modal) modal.setAttribute('aria-hidden', 'true');
  }

  document.getElementById('cloud-btn')?.addEventListener('click', openModal);
  document.getElementById('cloud-modal-close')?.addEventListener('click', closeModal);
  document.getElementById('cloud-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.addEventListener('keydown', function cloudModalKeyHandler(e) {
    const modal = document.getElementById('cloud-modal');
    if (!modal || modal.getAttribute('aria-hidden') !== 'false') return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
    }
  });
  updateUi();
  noteBookUpdate();

  // The pre-account sharing flag lived in this browser and survived sign-out
  // (J12-NEW-1). Consent is the account's now; clear the old key on sight.
  try {
    localStorage.removeItem(LEGACY_SHARE_KEY);
  } catch (_) { /* private mode */ }

  return { isSignedIn, getEmail, getEndpoint, isAdmin, isDev, getRole, refreshRole, listUsers, setUserRole, adminCreateUser, adminDeleteUser, onBookSaved, onProjectSaved, onProjectDeleted, onAssembliesSaved, flushPending, openModal, fetchSuggestions, setSuggestionStatus, getSharedRowKeys, getLastSyncedAt };
})();
