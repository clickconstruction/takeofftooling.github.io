/**
 * TakeoffState — the single state facade the rest of the app talks to.
 *
 * Owns the durable data (manifest, labor book, labor rate, assemblies),
 * undo/redo, and persistence scheduling. Delegates to (loaded before this):
 *   js/storage.js              — TakeoffStorage, the persistence adapter
 *   js/uiState.js              — TakeoffUiState, ephemeral UI state (re-exported here)
 *   js/selectors.js            — TakeoffSelectors, pure computed views over the manifest
 *   js/data/laborBookDefaults.js — LABOR_BOOK_DEFAULTS / LABOR_BOOK_DEFAULT_GROUPS
 */

const TakeoffState = (function () {
  const ITEM_TYPES = ['lighting', 'gear', 'devices', 'conduit', 'wire', 'specialSystems', 'permits', 'powerCoCharges', 'temporaryPower'];

  let manifest = [];
  let assemblies = TakeoffStorage.loadAssemblies();
  let laborRate = 0;

  const UNDO_STACK_SIZE = 50;
  let undoStack = [];
  let redoStack = [];
  let batchDepth = 0;
  let lastEdit = { id: null, keys: '', time: 0 };

  const LABOR_BOOK_TAB_ORDER = ['gear', 'lighting', 'devices', 'conduit', 'wire', 'specialSystems'];
  const LABOR_BOOK_TYPE_LABELS = { gear: 'Gear', lighting: 'Lighting', devices: 'Devices', conduit: 'Conduit', wire: 'Wire', specialSystems: 'Special Systems' };
  const LABOR_BOOK_GROUPS = LABOR_BOOK_DEFAULT_GROUPS;
  let activeLaborBookTab = 'gear';
  let laborBook = JSON.parse(JSON.stringify(LABOR_BOOK_DEFAULTS));

  function generateId() {
    // UUIDs so ids stay valid as database row keys after the Count Tooling
    // integration; legacy 'id_' ids in saved workspaces remain accepted.
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  }

  function getManifest() {
    return manifest;
  }

  const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

  function sanitizeImportedItem(raw, parentId) {
    if (!raw || typeof raw !== 'object') return null;
    const id = typeof raw.id === 'string' && SAFE_ID_RE.test(raw.id) ? raw.id : generateId();
    const price = Number(raw.price);
    const item = {
      id,
      type: typeof raw.type === 'string' ? raw.type : null,
      description: typeof raw.description === 'string' ? raw.description : '',
      quantity: Number(raw.quantity) || 0,
      labor: Number(raw.labor) || 0,
      planPage: typeof raw.planPage === 'string' ? raw.planPage : '',
      parentId: parentId ?? null,
      price: isNaN(price) || raw.price == null || raw.price === '' ? null : price,
      children: [],
      conduitMeta: raw.conduitMeta && typeof raw.conduitMeta === 'object' ? raw.conduitMeta : null,
      meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : null,
    };
    if (Array.isArray(raw.children)) {
      item.children = raw.children.map((c) => sanitizeImportedItem(c, item.id)).filter(Boolean);
    }
    return item;
  }

  function loadManifestFromExport(data) {
    // Accepts the versioned envelope {v, manifest} or a legacy bare array.
    const list = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray(data.manifest) ? data.manifest : null;
    if (!list) return false;
    manifest = list.map((raw) => sanitizeImportedItem(raw, null)).filter(Boolean);
    undoStack = [];
    redoStack = [];
    schedulePersist();
    return true;
  }

  function getTopLevelItems() {
    return manifest.filter((item) => !item.parentId);
  }

  function getItemById(id) {
    for (const item of manifest) {
      if (item.id === id) return item;
      if (item.children) {
        const found = item.children.find((c) => c.id === id);
        if (found) return found;
      }
    }
    return null;
  }

  function getParentItem(id) {
    const item = getItemById(id);
    if (!item || !item.parentId) return null;
    return getItemById(item.parentId);
  }

  function getTopLevelParentId(id) {
    const item = getItemById(id);
    if (!item) return null;
    if (!item.parentId) return id;
    return getTopLevelParentId(item.parentId);
  }

  function deepCloneManifest() {
    return JSON.parse(JSON.stringify(manifest));
  }

  // --- Workspace persistence (all durable writes go through TakeoffStorage) ---
  let persistTimer = null;

  function persistNow() {
    TakeoffStorage.saveWorkspace({ v: 1, savedAt: new Date().toISOString(), manifest, laborBook, laborRate });
  }

  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(persistNow, 400);
  }

  function restoreWorkspace() {
    const data = TakeoffStorage.loadWorkspace();
    if (!data || data.v !== 1) return;
    if (Array.isArray(data.manifest)) manifest = data.manifest;
    if (data.laborBook && typeof data.laborBook === 'object') laborBook = data.laborBook;
    if (typeof data.laborRate === 'number') laborRate = data.laborRate;
  }

  // Replace live state with a workspace pulled from cloud sync (TakeoffCloud).
  // The caller has already written it to TakeoffStorage; undo history refers
  // to the replaced manifest, so it is cleared.
  function adoptWorkspace(data) {
    if (!data || data.v !== 1) return false;
    if (Array.isArray(data.manifest)) manifest = data.manifest;
    if (data.laborBook && typeof data.laborBook === 'object') laborBook = data.laborBook;
    if (typeof data.laborRate === 'number') laborRate = data.laborRate;
    undoStack = [];
    redoStack = [];
    lastEdit = { id: null, keys: '', time: 0 };
    return true;
  }

  function pushUndoRaw() {
    undoStack.push(deepCloneManifest());
    if (undoStack.length > UNDO_STACK_SIZE) undoStack.shift();
    redoStack = [];
    lastEdit = { id: null, keys: '', time: 0 };
  }

  function pushUndo() {
    if (batchDepth > 0) return; // inside a batch: one snapshot was taken at beginBatch
    pushUndoRaw();
    schedulePersist();
  }

  // Group several mutations into a single undo frame (flow saves, bulk imports).
  function beginBatch() {
    if (batchDepth === 0) pushUndoRaw();
    batchDepth++;
  }

  function endBatch() {
    batchDepth = Math.max(0, batchDepth - 1);
    if (batchDepth === 0) schedulePersist();
  }

  function undo() {
    if (undoStack.length === 0) return false;
    redoStack.push(deepCloneManifest());
    manifest = undoStack.pop();
    schedulePersist();
    return true;
  }

  function redo() {
    if (redoStack.length === 0) return false;
    undoStack.push(deepCloneManifest());
    manifest = redoStack.pop();
    schedulePersist();
    return true;
  }

  function canUndo() {
    return undoStack.length > 0;
  }

  function canRedo() {
    return redoStack.length > 0;
  }

  function addItem(item) {
    pushUndo();
    const newItem = {
      id: item.id || generateId(),
      type: item.type || null,
      description: item.description || '',
      quantity: Number(item.quantity) || 0,
      labor: Number(item.labor) || 0,
      planPage: item.planPage ?? '',
      parentId: item.parentId ?? null,
      price: item.price ?? null,
      children: item.children || [],
      conduitMeta: item.conduitMeta || null,
      meta: item.meta && typeof item.meta === 'object' ? item.meta : null,
    };
    if (item.parentId) {
      const parent = getItemById(item.parentId);
      if (parent) {
        if (!parent.children) parent.children = [];
        parent.children.push(newItem);
      } else {
        manifest.push(newItem);
      }
    } else {
      manifest.push(newItem);
    }
    return newItem;
  }

  function updateItem(id, updates) {
    const item = getItemById(id);
    if (!item) return null;
    // Coalesce rapid edits to the same field of the same item (per-keystroke
    // input events) into one undo frame.
    const keys = Object.keys(updates).sort().join(',');
    const now = Date.now();
    const coalesce = lastEdit.id === id && lastEdit.keys === keys && now - lastEdit.time < 1200;
    if (!coalesce) pushUndo();
    if (batchDepth === 0) lastEdit = { id, keys, time: now };
    schedulePersist();
    const parent = item.parentId ? getItemById(item.parentId) : null;
    const list = parent ? parent.children : manifest;
    const idx = list.findIndex((i) => i.id === id);
    if (idx === -1) return null;
    Object.assign(list[idx], updates);
    return list[idx];
  }

  function removeItem(id) {
    const item = getItemById(id);
    if (!item) return false;
    pushUndo();
    const parent = item.parentId ? getItemById(item.parentId) : null;
    const list = parent ? parent.children : manifest;
    const idx = list.findIndex((i) => i.id === id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    return true;
  }

  function setType(id, type) {
    return updateItem(id, { type });
  }

  // --- Device-flow assemblies (saved presets) ---

  function getAssemblies() {
    return assemblies;
  }

  function addAssembly(assembly) {
    const a = { id: generateId(), name: assembly.name || 'Unnamed', sections: assembly.sections || {}, createdAt: new Date().toISOString() };
    assemblies.push(a);
    TakeoffStorage.saveAssemblies(assemblies);
    return a;
  }

  function removeAssembly(id) {
    assemblies = assemblies.filter((a) => a.id !== id);
    TakeoffStorage.saveAssemblies(assemblies);
  }

  // Replace the assemblies list (cloud-sync merge result).
  function setAssemblies(list) {
    assemblies = Array.isArray(list) ? list : [];
    TakeoffStorage.saveAssemblies(assemblies);
  }

  // --- Labor rate ---

  function getLaborRate() {
    return laborRate;
  }

  function setLaborRate(value) {
    laborRate = Number(value) || 0;
    schedulePersist();
  }

  // --- Labor & Price Book (editable Parts data) ---

  function getLaborBook() {
    return laborBook;
  }

  function getActiveLaborBookTab() {
    return activeLaborBookTab;
  }

  function setActiveLaborBookTab(tab) {
    if (LABOR_BOOK_TAB_ORDER.includes(tab)) activeLaborBookTab = tab;
  }

  function getLaborBookTabOrder() {
    return LABOR_BOOK_TAB_ORDER;
  }

  function getLaborBookGroups(type) {
    return LABOR_BOOK_GROUPS[type] || null;
  }

  function getLaborBookType(type) {
    return laborBook[type] || {};
  }

  function setLaborBookSection(type, section, entries) {
    if (!laborBook[type]) laborBook[type] = {};
    laborBook[type][section] = entries || [];
    schedulePersist();
  }

  function addLaborBookRow(type, section, row) {
    if (!laborBook[type]) laborBook[type] = {};
    if (!laborBook[type][section]) laborBook[type][section] = [];
    laborBook[type][section].push(row || { name: '', labor: 0, price: '' });
    schedulePersist();
  }

  function removeLaborBookRow(type, section, index) {
    if (!laborBook[type]?.[section]) return;
    laborBook[type][section].splice(index, 1);
    schedulePersist();
  }

  function addLaborBookSection(type, sectionName) {
    if (!laborBook[type]) laborBook[type] = {};
    laborBook[type][sectionName] = [];
    schedulePersist();
  }

  function updateLaborBookRow(type, section, index, updates) {
    if (!laborBook[type]?.[section]?.[index]) return;
    Object.assign(laborBook[type][section][index], updates);
    schedulePersist();
  }

  // --- Computed views (pure logic lives in TakeoffSelectors) ---

  function getTotalLabor() {
    return TakeoffSelectors.getTotalLabor(manifest);
  }

  function getTotalPrice() {
    return TakeoffSelectors.getTotalPrice(manifest);
  }

  function getPurchaseList() {
    return TakeoffSelectors.getPurchaseList(manifest);
  }

  function getFlattenedItems() {
    return TakeoffSelectors.getFlattenedItems(manifest);
  }

  function getSummaryBreakdown() {
    return TakeoffSelectors.getSummaryBreakdown(manifest);
  }

  restoreWorkspace();

  return {
    ITEM_TYPES,
    LABOR_BOOK_TYPE_LABELS,
    // ephemeral UI state (see js/uiState.js)
    ...TakeoffUiState,
    getManifest,
    persistNow,
    adoptWorkspace,
    loadManifestFromExport,
    getTopLevelItems,
    getItemById,
    getParentItem,
    getTopLevelParentId,
    addItem,
    updateItem,
    removeItem,
    setType,
    undo,
    redo,
    beginBatch,
    endBatch,
    canUndo,
    canRedo,
    getAssemblies,
    addAssembly,
    removeAssembly,
    setAssemblies,
    getTotalLabor,
    getTotalPrice,
    getFlattenedItems,
    getPurchaseList,
    getSummaryBreakdown,
    generateId,
    getLaborRate,
    setLaborRate,
    getLaborBook,
    getLaborBookTabOrder,
    getLaborBookGroups,
    getLaborBookType,
    setLaborBookSection,
    addLaborBookRow,
    removeLaborBookRow,
    addLaborBookSection,
    updateLaborBookRow,
    getActiveLaborBookTab,
    setActiveLaborBookTab,
  };
})();
