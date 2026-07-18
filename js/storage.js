/**
 * TakeoffStorage — the single seam for durable persistence.
 *
 * Everything the app saves goes through this adapter. The current
 * implementation is localStorage; to back the app with a database
 * (IndexedDB, Supabase, the Count Tooling project store), replace these
 * four functions — no other file touches storage directly.
 *
 * Contract:
 *   loadWorkspace()        -> workspace object ({v:1, savedAt, manifest, laborBook, laborRate}) or null
 *   saveWorkspace(data)    -> void (best-effort; must not throw)
 *   loadAssemblies()       -> array of saved device assemblies (possibly [])
 *   saveAssemblies(list)   -> void (best-effort; must not throw)
 */
const TakeoffStorage = (function () {
  const WORKSPACE_KEY = 'takeoff-workspace';
  const ASSEMBLIES_KEY = 'takeoff-assemblies';

  function loadWorkspace() {
    try {
      const raw = localStorage.getItem(WORKSPACE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.warn('Takeoff: could not restore saved workspace', err);
      return null;
    }
  }

  function saveWorkspace(data) {
    try {
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify(data));
    } catch (err) {
      console.warn('Takeoff: could not save workspace', err);
    }
  }

  function loadAssemblies() {
    try {
      const raw = localStorage.getItem(ASSEMBLIES_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (err) {
      console.warn('Takeoff: could not load saved assemblies', err);
      return [];
    }
  }

  function saveAssemblies(list) {
    try {
      localStorage.setItem(ASSEMBLIES_KEY, JSON.stringify(list));
    } catch (err) {
      console.warn('Takeoff: could not save assemblies', err);
    }
  }

  return { loadWorkspace, saveWorkspace, loadAssemblies, saveAssemblies };
})();
