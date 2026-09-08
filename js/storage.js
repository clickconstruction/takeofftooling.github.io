/**
 * TakeoffStorage — the single seam for durable persistence.
 *
 * Everything the app saves goes through this adapter. localStorage is the
 * synchronous cache the app boots from; each save also notifies TakeoffCloud
 * (js/cloud.js), which mirrors the data to Supabase when signed in.
 *
 * Keys:
 *   takeoff-projects-index  {v:1, currentId, projects:[{id,name,createdAt,
 *                            updatedAt, archived?:true, archivedAt?}]}
 *                           (device-local — never synced; cloud rebuilds the
 *                           list from takeoff_projects rows). archived mirrors
 *                           the project document's flag so the list can be
 *                           split into live and closed-out bids without
 *                           loading every document; the pair is absent on a
 *                           live bid
 *   takeoff-project-<id>    {v:1, id, savedAt, name, manifest, laborRate,
 *                            details:{client,address,permitNo,
 *                            builderOrOccupant,dueDate}, importedFrom:
 *                            {name,exportedAt}|null, archived?:true,
 *                            archivedAt?}  — details are the job's
 *                            own facts (all optional; they print on the form
 *                            PDF); importedFrom stamps the share link a copy
 *                            came from, so the same link opened twice reopens
 *                            it instead of making a twin; archived is a
 *                            closed-out bid (kept in full, out of the
 *                            switcher) and rides the cloud row's data blob
 *   takeoff-book            {v:1, savedAt, laborBook, laborBookMeta}
 *   takeoff-assemblies      device-assembly presets (unchanged)
 *   takeoff-cloud-seen      {v:1, projects:{<id>: <remote updated_at>}} — the
 *                           cloud stamp this device last reconciled with per
 *                           project (device-local; drives conflict detection
 *                           in js/cloudSync.js)
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
  const REMOTE_SEEN_KEY = 'takeoff-cloud-seen';

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
    deleteProjectLocalOnly(id);
    try {
      if (typeof TakeoffCloud !== 'undefined') TakeoffCloud.onProjectDeleted(id);
    } catch (err) {
      console.warn('Takeoff: cloud delete failed', err);
    }
  }

  // Drop a project the cloud says was deleted elsewhere — no delete goes back
  // up, or a device would re-announce a delete it merely heard about.
  function deleteProjectLocalOnly(id) {
    try {
      localStorage.removeItem(PROJECT_KEY_PREFIX + id);
    } catch (err) {
      console.warn('Takeoff: could not delete project', err);
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

  // --- last-seen remote stamps (device-local; never synced) ---
  // Per project id, the cloud `updated_at` this device last reconciled with.
  // js/cloudSync.js uses it as the common ancestor: a local copy no newer than
  // its stamp holds no unsynced work and may be replaced.

  function loadRemoteSeen() {
    const data = readJson(REMOTE_SEEN_KEY);
    return data && data.v === 1 && data.projects && typeof data.projects === 'object' ? data : { v: 1, projects: {} };
  }

  function saveRemoteSeen(data) {
    writeJson(REMOTE_SEEN_KEY, data);
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
    // The index entry's `updatedAt` is when this device last wrote the
    // project, and that is now — the migration. Stamping it with the legacy
    // save date made the project you are looking at read "Jul 14" in the
    // switcher on the day it arrived (J11-NEW-2). The document keeps the
    // legacy `savedAt`, which is what the cloud compares.
    const migratedAt = new Date().toISOString();
    saveProjectsIndex({ v: 1, currentId: id, projects: [{ id, name, createdAt: savedAt, updatedAt: migratedAt }] });
  }

  return {
    generateProjectId,
    loadProjectsIndex,
    saveProjectsIndex,
    loadProject,
    saveProject,
    saveProjectLocalOnly,
    deleteProject,
    deleteProjectLocalOnly,
    loadBook,
    saveBook,
    loadAssemblies,
    saveAssemblies,
    loadRemoteSeen,
    saveRemoteSeen,
    loadLegacyWorkspace,
    migrateLegacyWorkspace,
  };
})();
