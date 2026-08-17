/**
 * TakeoffStorage — the single seam for durable persistence.
 *
 * Everything the app saves goes through this adapter. localStorage is the
 * synchronous cache the app boots from; each save also notifies TakeoffCloud
 * (js/cloud.js), which mirrors the data to Supabase when signed in.
 *
 * Keys:
 *   takeoff-projects-index  {v:1, currentId, projects:[{id,name,createdAt,updatedAt}]}
 *                           (device-local — never synced; cloud rebuilds the
 *                           list from takeoff_projects rows)
 *   takeoff-project-<id>    {v:1, id, savedAt, name, manifest, laborRate}
 *   takeoff-book            {v:1, savedAt, laborBook, laborBookMeta}
 *   takeoff-assemblies      device-assembly presets (unchanged)
 *   takeoff-workspace       legacy single-workspace key — migrated into the
 *                           keys above on first boot, then left untouched as
 *                           a frozen rollback backup
 */
const TakeoffStorage = (function () {
  const INDEX_KEY = 'takeoff-projects-index';
  const PROJECT_KEY_PREFIX = 'takeoff-project-';
  const BOOK_KEY = 'takeoff-book';
  const ASSEMBLIES_KEY = 'takeoff-assemblies';
  const LEGACY_WORKSPACE_KEY = 'takeoff-workspace';

  function readJson(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.warn(`Takeoff: could not read ${key}`, err);
      return null;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.warn(`Takeoff: could not save ${key}`, err);
      return false;
    }
  }

  function generateProjectId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  }

  // --- projects index (device-local; holds which project is open) ---

  function loadProjectsIndex() {
    const idx = readJson(INDEX_KEY);
    return idx && idx.v === 1 && Array.isArray(idx.projects) ? idx : null;
  }

  function saveProjectsIndex(idx) {
    writeJson(INDEX_KEY, idx);
  }

  // --- per-project payloads ---

  function loadProject(id) {
    const data = readJson(PROJECT_KEY_PREFIX + id);
    return data && data.v === 1 ? data : null;
  }

  function saveProject(data) {
    writeJson(PROJECT_KEY_PREFIX + data.id, data);
    try {
      if (typeof TakeoffCloud !== 'undefined') TakeoffCloud.onProjectSaved(data);
    } catch (err) {
      console.warn('Takeoff: cloud push failed', err);
    }
  }

  // Write a project pulled from the cloud without notifying the cloud back.
  function saveProjectLocalOnly(data) {
    writeJson(PROJECT_KEY_PREFIX + data.id, data);
  }

  function deleteProject(id) {
    try {
      localStorage.removeItem(PROJECT_KEY_PREFIX + id);
    } catch (err) {
      console.warn('Takeoff: could not delete project', err);
    }
    try {
      if (typeof TakeoffCloud !== 'undefined') TakeoffCloud.onProjectDeleted(id);
    } catch (err) {
      console.warn('Takeoff: cloud delete failed', err);
    }
  }

  // --- account-level Labor & Price Book ---

  function loadBook() {
    const data = readJson(BOOK_KEY);
    return data && data.v === 1 ? data : null;
  }

  function saveBook(data) {
    writeJson(BOOK_KEY, data);
    try {
      if (typeof TakeoffCloud !== 'undefined') TakeoffCloud.onBookSaved(data);
    } catch (err) {
      console.warn('Takeoff: cloud push failed', err);
    }
  }

  // --- assemblies (unchanged) ---

  function loadAssemblies() {
    const list = readJson(ASSEMBLIES_KEY);
    return Array.isArray(list) ? list : [];
  }

  function saveAssemblies(list) {
    writeJson(ASSEMBLIES_KEY, list);
    try {
      if (typeof TakeoffCloud !== 'undefined') TakeoffCloud.onAssembliesSaved(list);
    } catch (err) {
      console.warn('Takeoff: cloud push failed', err);
    }
  }

  // --- legacy single-workspace migration ---

  function loadLegacyWorkspace() {
    const data = readJson(LEGACY_WORKSPACE_KEY);
    return data && data.v === 1 ? data : null;
  }

  /**
   * One-time boot migration: the legacy workspace becomes project #1 (named
   * from its save date) and the labor book moves to its own key. The legacy
   * key is left untouched as a rollback backup. No-op once an index exists.
   */
  function migrateLegacyWorkspace() {
    if (loadProjectsIndex()) return;
    const legacy = loadLegacyWorkspace();
    if (!legacy) return;
    const savedAt = legacy.savedAt || new Date().toISOString();
    const when = new Date(Date.parse(savedAt) || Date.now());
    const name = `Takeoff — ${when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    const id = generateProjectId();
    saveProjectLocalOnly({
      v: 1,
      id,
      savedAt,
      name,
      manifest: Array.isArray(legacy.manifest) ? legacy.manifest : [],
      laborRate: typeof legacy.laborRate === 'number' ? legacy.laborRate : 0,
    });
    if (legacy.laborBook && typeof legacy.laborBook === 'object') {
      writeJson(BOOK_KEY, { v: 1, savedAt, laborBook: legacy.laborBook, laborBookMeta: legacy.laborBookMeta || null });
    }
    saveProjectsIndex({ v: 1, currentId: id, projects: [{ id, name, createdAt: savedAt, updatedAt: savedAt }] });
  }

  return {
    generateProjectId,
    loadProjectsIndex,
    saveProjectsIndex,
    loadProject,
    saveProject,
    saveProjectLocalOnly,
    deleteProject,
    loadBook,
    saveBook,
    loadAssemblies,
    saveAssemblies,
    loadLegacyWorkspace,
    migrateLegacyWorkspace,
  };
})();
