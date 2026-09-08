/**
 * TakeoffLaborBookMerge — pure logic for keeping a user's editable Parts book
 * in sync with the shipped defaults, and for diffing their corrections.
 *
 * Provenance model: rows the user edits carry `edited: true`; rows they add
 * carry `userAdded: true`; default rows they delete (or rename away from) are
 * recorded per tab/section in a `removed` map. With that, when the shipped
 * defaults change (LABOR_BOOK_DEFAULTS_VERSION bump), untouched rows upgrade
 * to the new defaults while user changes survive — and the same flags yield
 * the correction list shared through cloud sync (js/cloud.js).
 *
 * Only a user's own delete or rename writes `removed`. A default simply
 * missing from an older book is an *inferred* gap, not a decision: bootstrap
 * used to blacklist those forever (and propose each one to the maintainer as
 * a removal), so a book that predated a section's newer rows never received
 * them. Inferred gaps are now healed by mergeDefaults instead. Books written
 * before that fix carry a map that mixes the two, so it migrates into
 * `removedLegacy` (see migrateRemovedMeta): still honoured, so a real delete
 * is never resurrected, but never shared as a correction.
 *
 * Dual browser/Node (unit-tested in laborBookMerge.test.js). No state:
 * `book` is mutated in place by bootstrap/merge; callers persist it.
 */
const TakeoffLaborBookMerge = (function () {
  function rowsEqual(a, b) {
    return (
      (a.name || '') === (b.name || '') &&
      (Number(a.labor) || 0) === (Number(b.labor) || 0) &&
      String(a.price ?? '') === String(b.price ?? '')
    );
  }

  function recordRemoved(removed, tab, section, name) {
    if (!removed[tab]) removed[tab] = {};
    if (!removed[tab][section]) removed[tab][section] = [];
    if (!removed[tab][section].includes(name)) removed[tab][section].push(name);
  }

  /**
   * The row came back (renamed back, or added again under the old name), so
   * the removal is no longer true. Mutates `removed`; returns true when a
   * name was actually taken out.
   */
  function unrecordRemoved(removed, tab, section, name) {
    const list = removed && removed[tab] && removed[tab][section];
    if (!Array.isArray(list)) return false;
    const i = list.indexOf(name);
    if (i === -1) return false;
    list.splice(i, 1);
    if (!list.length) delete removed[tab][section];
    if (removed[tab] && !Object.keys(removed[tab]).length) delete removed[tab];
    return true;
  }

  /** Is `name` blocked from coming back into `tab`/`section`? */
  function isRemoved(maps, tab, section, name) {
    for (const map of maps) {
      const list = map && map[tab] && map[tab][section];
      if (Array.isArray(list) && list.includes(name)) return true;
    }
    return false;
  }

  /**
   * Split a stored `laborBookMeta` into the two removal maps this module now
   * uses. A meta written before the inferred/deleted split (`removedV` absent)
   * has a `removed` map that mixes the user's own deletes with gaps bootstrap
   * inferred, and nothing in it can tell them apart — so the whole map becomes
   * `removedLegacy`: honoured by the merge (a real delete stays deleted) and
   * ignored by computeCorrections (no phantom "remove" reaches the
   * maintainer). Everything recorded from here on is a user action.
   * Pure — does not mutate `meta`.
   */
  function migrateRemovedMeta(meta) {
    const stored = meta && meta.removed && typeof meta.removed === 'object' ? meta.removed : {};
    const legacy = meta && meta.removedLegacy && typeof meta.removedLegacy === 'object' ? meta.removedLegacy : {};
    if (meta && meta.removedV === 2) {
      return { removed: JSON.parse(JSON.stringify(stored)), removedLegacy: JSON.parse(JSON.stringify(legacy)) };
    }
    return { removed: {}, removedLegacy: JSON.parse(JSON.stringify(stored)) };
  }

  /**
   * Names appearing more than once in one section's rows. The provenance model
   * is name-keyed, so duplicate names inside a *defaults* section make the
   * merge ambiguous (it oscillates and invents corrections) — shipped defaults
   * must be duplicate-free, which laborBookMerge.test.js asserts against the
   * real LABOR_BOOK_DEFAULTS.
   */
  function duplicateNames(rows) {
    const seen = new Set();
    const dupes = [];
    for (const r of rows || []) {
      const name = (r && r.name) || '';
      if (seen.has(name)) {
        if (!dupes.includes(name)) dupes.push(name);
      } else {
        seen.add(name);
      }
    }
    return dupes;
  }

  /** Every `${tab}/${section}` in `defaults` whose rows carry a duplicate name. */
  function duplicateDefaultSections(defaults) {
    const out = [];
    for (const tab of Object.keys(defaults || {})) {
      for (const section of Object.keys(defaults[tab] || {})) {
        const dupes = duplicateNames(defaults[tab][section]);
        if (dupes.length) out.push({ tab, section, names: dupes });
      }
    }
    return out;
  }

  /**
   * First run on a pre-provenance workspace: infer flags by comparing the
   * stored book against the currently shipped defaults. Rows matching a
   * default by name but with different values → edited; rows with no default
   * of that name → userAdded.
   *
   * Default names absent from the user's section are NOT recorded as removed:
   * a pre-provenance book cannot record a delete, so every gap here is equally
   * consistent with "this book predates that row". mergeDefaults heals them.
   * Mutates `book` rows; returns { missing } — the inferred gaps, for
   * diagnostics only.
   */
  function bootstrap(book, defaults) {
    const missing = [];
    for (const tab of Object.keys(defaults)) {
      const bookTab = book[tab];
      if (!bookTab) continue;
      for (const section of Object.keys(defaults[tab])) {
        const rows = bookTab[section];
        if (!rows) continue;
        for (const def of defaults[tab][section]) {
          if (!rows.some((r) => r.name === def.name)) missing.push({ tab, section, name: def.name });
        }
      }
    }
    for (const tab of Object.keys(book)) {
      for (const section of Object.keys(book[tab] || {})) {
        const defRows = (defaults[tab] && defaults[tab][section]) || null;
        const claimed = new Set(); // one default row is matched by one book row
        for (const row of book[tab][section]) {
          if (row.edited || row.userAdded) continue;
          const i = defRows ? defRows.findIndex((d, di) => !claimed.has(di) && d.name === row.name) : -1;
          if (i !== -1) {
            claimed.add(i);
            if (!rowsEqual(row, defRows[i])) row.edited = true;
          } else if (defRows && defRows.some((d) => d.name === row.name)) {
            // a surplus copy of a default name (a stale duplicate from an
            // older book): leave it unflagged so mergeDefaults drops it
            continue;
          } else {
            row.userAdded = true;
          }
        }
      }
    }
    return { missing };
  }

  /**
   * Upgrade a book to a newer set of defaults. Untouched rows take the new
   * default values; edited/userAdded rows are left alone; default rows the
   * user removed stay removed (`removed`, plus the migrated `removedLegacy`);
   * new default rows/sections/tabs are added; untouched rows dropped from the
   * defaults are dropped here too.
   *
   * Mutates `book`. Returns { changed, updated, added, dropped } — `changed`
   * is the old row count, and `updated` names the rows whose numbers actually
   * moved under the user, which is the only honest thing to tell them about
   * (a wholesale new section is not "your book changed").
   */
  function mergeDefaults(book, defaults, removed, removedLegacy) {
    const blockMaps = [removed, removedLegacy];
    const updated = [];
    const added = [];
    const dropped = [];
    let changed = 0;
    for (const tab of Object.keys(defaults)) {
      if (!book[tab]) book[tab] = {};
      for (const section of Object.keys(defaults[tab])) {
        const defRows = defaults[tab][section];
        if (duplicateNames(defRows).length) {
          // Ambiguous defaults data — a name-keyed merge would oscillate.
          // Leave the user's section alone rather than corrupt it.
          console.warn(`Takeoff: duplicate default part names in ${tab}/${section} — section not merged`);
          continue;
        }
        if (!book[tab][section]) {
          book[tab][section] = JSON.parse(JSON.stringify(defRows));
          changed += defRows.length;
          continue;
        }
        const rows = book[tab][section];
        // Each default claims at most one book row, so a book carrying a
        // duplicate name (from an older, ambiguous merge) keeps one copy.
        const claimed = new Set();
        for (const def of defRows) {
          const i = rows.findIndex((r, ri) => !claimed.has(ri) && r.name === def.name);
          if (i === -1) {
            if (!isRemoved(blockMaps, tab, section, def.name)) {
              rows.push(JSON.parse(JSON.stringify(def)));
              claimed.add(rows.length - 1);
              added.push({ tab, section, name: def.name });
              changed++;
            }
          } else {
            claimed.add(i);
            if (!rows[i].edited && !rows[i].userAdded && !rowsEqual(rows[i], def)) {
              const before = rows[i];
              rows[i] = JSON.parse(JSON.stringify(def));
              // a same-name row whose numbers moved is the one case worth
              // telling the estimator about
              if ((Number(before.labor) || 0) !== (Number(def.labor) || 0) || String(before.price ?? '') !== String(def.price ?? '')) {
                updated.push({ tab, section, name: def.name });
              }
              changed++;
            }
          }
        }
        for (let i = rows.length - 1; i >= 0; i--) {
          const r = rows[i];
          if (r.edited || r.userAdded) continue;
          if (!claimed.has(i)) {
            dropped.push({ tab, section, name: r.name || '' });
            rows.splice(i, 1);
            changed++;
          }
        }
      }
    }
    return { changed, updated, added, dropped };
  }

  /**
   * The correction list a consenting user shares: one entry per user-touched
   * row ('edit' when a default of the same name exists, else 'new') plus one
   * 'remove' per deleted default. Edited rows whose values drifted back to
   * the default are skipped. Pure — does not mutate inputs.
   */
  function computeCorrections(book, defaults, removed) {
    const out = [];
    // The cloud upserts these on (user_id, tab, section, part_name), and
    // Postgres rejects a batch that touches one key twice — so never emit the
    // same key twice, whatever shape the book is in.
    const seen = new Set();
    const push = (c) => {
      const key = [c.tab, c.section, c.name].join('\u0001');
      if (seen.has(key)) return;
      seen.add(key);
      out.push(c);
    };
    for (const tab of Object.keys(book)) {
      for (const section of Object.keys(book[tab] || {})) {
        for (const row of book[tab][section]) {
          const name = (row.name || '').trim();
          if (!name || (!row.edited && !row.userAdded)) continue;
          const def = defaults[tab] && defaults[tab][section]
            ? defaults[tab][section].find((d) => d.name === row.name)
            : null;
          const value = { labor: Number(row.labor) || 0, price: String(row.price ?? '') };
          if (def) {
            if (rowsEqual(row, def)) continue;
            push({ tab, section, name, kind: 'edit', old: { labor: Number(def.labor) || 0, price: String(def.price ?? '') }, new: value });
          } else {
            // a new part is useless to the maintainer without something to key
            // the catalog on, so the part number rides along with it
            const partNumber = (row.partNumber || '').trim();
            push({ tab, section, name, kind: 'new', old: null, new: partNumber ? { ...value, partNumber } : value });
          }
        }
      }
    }
    for (const tab of Object.keys(removed || {})) {
      for (const section of Object.keys(removed[tab] || {})) {
        for (const name of removed[tab][section]) {
          const def = defaults[tab] && defaults[tab][section]
            ? defaults[tab][section].find((d) => d.name === name)
            : null;
          if (!def) continue; // no longer a default — nothing to suggest removing
          // the row is back in the book (renamed back, or added again): the
          // removal is stale, and proposing it would be a correction the user
          // never made
          const present = book[tab] && book[tab][section] && book[tab][section].some((r) => r.name === name);
          if (present) continue;
          push({ tab, section, name, kind: 'remove', old: { labor: Number(def.labor) || 0, price: String(def.price ?? '') }, new: null });
        }
      }
    }
    return out;
  }

  return {
    bootstrap,
    mergeDefaults,
    computeCorrections,
    rowsEqual,
    duplicateNames,
    duplicateDefaultSections,
    recordRemoved,
    unrecordRemoved,
    migrateRemovedMeta,
  };
})();

// Node (unit tests); inert in the browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TakeoffLaborBookMerge;
}
