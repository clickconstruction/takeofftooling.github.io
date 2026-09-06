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
   * Default rows missing from their home tab/section in `book`. By default,
   * sections the book doesn't have at all are skipped (bootstrap semantics —
   * they were never adopted); pass `includeMissingSections` to record their
   * rows too (reorganization semantics — the section was moved or deleted).
   * Pure; returns a fresh `removed`-shaped map. Recomputed wholesale after a
   * reorganization so stale entries drop out when a default row comes back.
   */
  function computeRemoved(book, defaults, includeMissingSections) {
    const removed = {};
    for (const tab of Object.keys(defaults)) {
      const bookTab = book[tab];
      if (!bookTab) continue;
      for (const section of Object.keys(defaults[tab])) {
        const rows = bookTab[section];
        if (!rows && !includeMissingSections) continue;
        for (const def of defaults[tab][section]) {
          if (!rows || !rows.some((r) => r.name === def.name)) {
            recordRemoved(removed, tab, section, def.name);
          }
        }
      }
    }
    return removed;
  }

  /**
   * First run on a pre-provenance workspace: infer flags by comparing the
   * stored book against the currently shipped defaults. Rows matching a
   * default by name but with different values → edited; rows with no default
   * of that name → userAdded; default names absent from the user's section →
   * recorded as removed (so future merges don't resurrect them).
   * Mutates `book` rows; returns the inferred `removed` map.
   */
  function bootstrap(book, defaults) {
    const removed = computeRemoved(book, defaults);
    for (const tab of Object.keys(book)) {
      for (const section of Object.keys(book[tab] || {})) {
        const defRows = defaults[tab] ? defaults[tab][section] : null;
        for (const row of book[tab][section]) {
          if (row.edited || row.userAdded) continue;
          const match = defRows && defRows.find((d) => d.name === row.name);
          if (!match) row.userAdded = true;
          else if (!rowsEqual(row, match)) row.edited = true;
        }
      }
    }
    return removed;
  }

  /**
   * Upgrade a book to a newer set of defaults. Untouched rows take the new
   * default values; edited/userAdded rows are left alone; default rows the
   * user removed stay removed; new default rows/sections/tabs are added;
   * untouched rows dropped from the defaults are dropped here too.
   * Mutates `book`; returns the number of rows changed/added/removed.
   */
  function mergeDefaults(book, defaults, removed) {
    let changed = 0;
    for (const tab of Object.keys(defaults)) {
      if (!book[tab]) book[tab] = {};
      for (const section of Object.keys(defaults[tab])) {
        const defRows = defaults[tab][section];
        const removedNames = (removed && removed[tab] && removed[tab][section]) || [];
        if (!book[tab][section]) {
          // a section the user moved away or deleted (all rows in `removed`)
          // stays gone; otherwise adopt the new default section
          const fresh = defRows.filter((d) => !removedNames.includes(d.name));
          if (fresh.length) {
            book[tab][section] = JSON.parse(JSON.stringify(fresh));
            changed += fresh.length;
          }
          continue;
        }
        const rows = book[tab][section];
        for (const def of defRows) {
          const i = rows.findIndex((r) => r.name === def.name);
          if (i === -1) {
            if (!removedNames.includes(def.name)) {
              rows.push(JSON.parse(JSON.stringify(def)));
              changed++;
            }
          } else if (!rows[i].edited && !rows[i].userAdded && !rowsEqual(rows[i], def)) {
            rows[i] = JSON.parse(JSON.stringify(def));
            changed++;
          }
        }
        for (let i = rows.length - 1; i >= 0; i--) {
          const r = rows[i];
          if (r.edited || r.userAdded) continue;
          if (!defRows.some((d) => d.name === r.name)) {
            rows.splice(i, 1);
            changed++;
          }
        }
      }
    }
    return changed;
  }

  /**
   * The correction list a consenting user shares: one entry per user-touched
   * row ('edit' when a default of the same name exists, else 'new') plus one
   * 'remove' per deleted default. Edited rows whose values drifted back to
   * the default are skipped. Pure — does not mutate inputs.
   */
  function computeCorrections(book, defaults, removed) {
    const out = [];
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
            out.push({ tab, section, name, kind: 'edit', old: { labor: Number(def.labor) || 0, price: String(def.price ?? '') }, new: value });
          } else {
            out.push({ tab, section, name, kind: 'new', old: null, new: value });
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
          out.push({ tab, section, name, kind: 'remove', old: { labor: Number(def.labor) || 0, price: String(def.price ?? '') }, new: null });
        }
      }
    }
    return out;
  }

  return { bootstrap, mergeDefaults, computeCorrections, computeRemoved, rowsEqual };
})();

// Node (unit tests); inert in the browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TakeoffLaborBookMerge;
}
