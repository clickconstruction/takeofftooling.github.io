/**
 * TakeoffStorage — the single seam for durable persistence.
 *
 * Everything the app saves goes through this adapter. localStorage is the
 * synchronous cache the app boots from; each save also notifies TakeoffCloud
 * (js/cloud.js), which mirrors the data to Supabase when signed in.
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
    try {
      if (typeof TakeoffCloud !== 'undefined') TakeoffCloud.onWorkspaceSaved(data);
    } catch (err) {
      console.warn('Takeoff: cloud push failed', err);
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
    try {
      if (typeof TakeoffCloud !== 'undefined') TakeoffCloud.onAssembliesSaved(list);
    } catch (err) {
      console.warn('Takeoff: cloud push failed', err);
    }
  }

  return { loadWorkspace, saveWorkspace, loadAssemblies, saveAssemblies };
})();
