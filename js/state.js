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
  // Provenance for the shared-book feedback loop (js/laborBookMerge.js):
  // which defaults the user deleted, and which defaults version the stored
  // book was last reconciled against.
  let laborBookRemoved = {};
  let laborBookDefaultsVersion = LABOR_BOOK_DEFAULTS_VERSION;

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
    TakeoffStorage.saveWorkspace({
      v: 1,
      savedAt: new Date().toISOString(),
      manifest,
      laborBook,
      laborRate,
      laborBookMeta: { defaultsVersion: laborBookDefaultsVersion, removed: laborBookRemoved },
    });
  }

  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(persistNow, 400);
  }

  // Reconcile a restored/adopted book with the shipped defaults: bootstrap
  // provenance flags on pre-versioning workspaces, then merge in any newer
  // defaults (user-touched rows win). Persists when anything changed.
  function upgradeLaborBook(meta) {
    laborBookRemoved = meta && meta.removed && typeof meta.removed === 'object' ? meta.removed : {};
    let storedVersion = meta && typeof meta.defaultsVersion === 'number' ? meta.defaultsVersion : 0;
    let dirty = false;
    if (storedVersion === 0) {
      const inferred = TakeoffLaborBookMerge.bootstrap(laborBook, LABOR_BOOK_DEFAULTS);
      for (const tab of Object.keys(inferred)) laborBookRemoved[tab] = inferred[tab];
      storedVersion = LABOR_BOOK_DEFAULTS_VERSION;
      dirty = true;
    }
    if (storedVersion < LABOR_BOOK_DEFAULTS_VERSION) {
      TakeoffLaborBookMerge.mergeDefaults(laborBook, LABOR_BOOK_DEFAULTS, laborBookRemoved);
      dirty = true;
    }
    laborBookDefaultsVersion = LABOR_BOOK_DEFAULTS_VERSION;
    if (dirty) schedulePersist();
  }

  function restoreWorkspace() {
    const data = TakeoffStorage.loadWorkspace();
    if (!data || data.v !== 1) return;
    if (Array.isArray(data.manifest)) manifest = data.manifest;
    if (typeof data.laborRate === 'number') laborRate = data.laborRate;
    if (data.laborBook && typeof data.laborBook === 'object') {
      laborBook = data.laborBook;
      upgradeLaborBook(data.laborBookMeta);
    }
  }

  // Replace live state with a workspace pulled from cloud sync (TakeoffCloud).
  // The caller has already written it to TakeoffStorage; undo history refers
  // to the replaced manifest, so it is cleared.
  function adoptWorkspace(data) {
    if (!data || data.v !== 1) return false;
    if (Array.isArray(data.manifest)) manifest = data.manifest;
    if (typeof data.laborRate === 'number') laborRate = data.laborRate;
    if (data.laborBook && typeof data.laborBook === 'object') {
      laborBook = data.laborBook;
      upgradeLaborBook(data.laborBookMeta);
    }
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

  // A deleted (or renamed-away) default row is recorded so defaults merges
  // don't resurrect it, and so the removal can be shared as a correction.
  function noteRemovedDefault(type, section, name) {
    const isDefault = LABOR_BOOK_DEFAULTS[type]?.[section]?.some((d) => d.name === name);
    if (!isDefault) return;
    if (!laborBookRemoved[type]) laborBookRemoved[type] = {};
    if (!laborBookRemoved[type][section]) laborBookRemoved[type][section] = [];
    if (!laborBookRemoved[type][section].includes(name)) laborBookRemoved[type][section].push(name);
  }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function addLaborBookRow(type, section, row) {
    if (!laborBook[type]) laborBook[type] = {};
    if (!laborBook[type][section]) laborBook[type][section] = [];
    const r = Object.assign({ name: '', labor: 0, price: '' }, row, { userAdded: true });
    if (String(r.price ?? '') !== '' && !r.pricedAt) {
      r.pricedAt = todayISO();
      if (!r.priceSource) r.priceSource = 'You';
    }
    laborBook[type][section].push(r);
    schedulePersist();
  }

  function removeLaborBookRow(type, section, index) {
    if (!laborBook[type]?.[section]) return;
    const row = laborBook[type][section][index];
    if (row) noteRemovedDefault(type, section, row.name);
    laborBook[type][section].splice(index, 1);
    schedulePersist();
  }

  function addLaborBookSection(type, sectionName) {
    if (!laborBook[type]) laborBook[type] = {};
    laborBook[type][sectionName] = [];
    schedulePersist();
  }

  function updateLaborBookRow(type, section, index, updates) {
    const row = laborBook[type]?.[section]?.[index];
    if (!row) return;
    if (typeof updates.name === 'string' && updates.name !== row.name && !row.userAdded) {
      noteRemovedDefault(type, section, row.name);
    }
    const priceChanged = 'price' in updates && String(updates.price ?? '') !== String(row.price ?? '');
    const valueChanged =
      priceChanged ||
      ('name' in updates && updates.name !== row.name) ||
      ('labor' in updates && (Number(updates.labor) || 0) !== (Number(row.labor) || 0)) ||
      ('partNumber' in updates && (updates.partNumber || '') !== (row.partNumber || ''));
    Object.assign(row, updates);
    // a changed price is stamped with who/when unless the caller supplied it
    if (priceChanged) {
      if (!('priceSource' in updates)) row.priceSource = 'You';
      if (!('pricedAt' in updates)) row.pricedAt = todayISO();
    }
    // provenance-only updates must not set `edited` — that would freeze the
    // row out of future defaults upgrades (laborBookMerge skips edited rows)
    if (valueChanged && !row.userAdded) row.edited = true;
    schedulePersist();
  }

  // ---------- part offers & history (the "part card") ----------

  const PART_HISTORY_CAP = 50;

  // Who gets credited in part history: the signed-in email's short name
  // (cloud.js loads after state.js, so resolve at call time), else 'You'.
  function currentUserName() {
    const email = typeof TakeoffCloud !== 'undefined' ? TakeoffCloud.getEmail() : null;
    return email ? String(email).split('@')[0] : 'You';
  }

  function pushPartHistory(row, entry) {
    if (!row.history) row.history = [];
    row.history.unshift(entry);
    if (row.history.length > PART_HISTORY_CAP) row.history.length = PART_HISTORY_CAP;
  }

  /**
   * Record a supply-house quote on a row: updates that supplier's offer,
   * appends to history, and moves the working price when `use` is set, when
   * the supplier is already the one in use, or when the row has no offers
   * yet (first quote wins by default).
   */
  function recordPartPrice(type, section, index, { supplier, price, at, by, use }) {
    const row = laborBook[type]?.[section]?.[index];
    if (!row || !supplier) return;
    const when = at || todayISO();
    const who = by || currentUserName();
    if (!row.offers) row.offers = [];
    const existing = row.offers.find((o) => o.supplier.toLowerCase() === supplier.toLowerCase());
    if (existing) {
      existing.price = price;
      existing.at = when;
      existing.by = who;
    } else {
      row.offers.push({ supplier, price, at: when, by: who });
    }
    pushPartHistory(row, { at: when, kind: 'price', supplier, value: price, by: who });
    const inUse = (row.priceSource || '').toLowerCase() === supplier.toLowerCase();
    if (use || inUse || row.offers.length === 1) {
      updateLaborBookRow(type, section, index, { price: String(price), priceSource: supplier, pricedAt: when });
    } else {
      schedulePersist();
    }
  }

  // Pick which supplier's offer is the row's working price.
  function usePartOffer(type, section, index, supplier) {
    const row = laborBook[type]?.[section]?.[index];
    const offer = row?.offers?.find((o) => o.supplier.toLowerCase() === (supplier || '').toLowerCase());
    if (!offer) return;
    updateLaborBookRow(type, section, index, { price: String(offer.price), priceSource: offer.supplier, pricedAt: offer.at });
  }

  // Labor set from the part card: same update as inline editing, plus history.
  function recordPartLabor(type, section, index, labor) {
    const row = laborBook[type]?.[section]?.[index];
    if (!row) return;
    updateLaborBookRow(type, section, index, { labor: Number(labor) || 0 });
    pushPartHistory(row, { at: todayISO(), kind: 'labor', value: Number(labor) || 0, by: currentUserName() });
    schedulePersist();
  }

  /**
   * Sync promoted parts with the supplier catalog: for every row in the tab
   * whose partNumber the catalog knows, refresh that vendor's offer (added
   * if missing — typing a part # links a row to the catalog). The working
   * price follows only when that vendor is the offer in use. Returns the
   * number of rows changed (0 → caller can skip re-rendering).
   */
  function refreshSupplierOffers(type, vendor, byPartNumber) {
    let changed = 0;
    for (const section of Object.keys(laborBook[type] || {})) {
      for (let i = 0; i < laborBook[type][section].length; i++) {
        const row = laborBook[type][section][i];
        const cat = row.partNumber && byPartNumber[row.partNumber.toLowerCase()];
        if (!cat || cat.price == null) continue;
        const offer = row.offers?.find((o) => o.supplier.toLowerCase() === vendor.toLowerCase());
        if (offer && Number(offer.price) === Number(cat.price)) continue;
        if (!row.offers) row.offers = [];
        if (offer) {
          offer.price = cat.price;
          offer.at = cat.at;
          offer.by = 'import';
        } else {
          row.offers.push({ supplier: vendor, price: cat.price, at: cat.at, by: 'import' });
        }
        pushPartHistory(row, { at: cat.at, kind: 'price', supplier: vendor, value: cat.price, by: 'import' });
        if ((row.priceSource || '').toLowerCase() === vendor.toLowerCase()) {
          row.price = String(cat.price);
          row.pricedAt = cat.at;
        }
        changed++;
      }
    }
    if (changed) schedulePersist();
    return changed;
  }

  // Corrections a consenting user shares through cloud sync (js/cloud.js).
  function getBookCorrections() {
    return TakeoffLaborBookMerge.computeCorrections(laborBook, LABOR_BOOK_DEFAULTS, laborBookRemoved);
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
    recordPartPrice,
    usePartOffer,
    recordPartLabor,
    refreshSupplierOffers,
    getBookCorrections,
    getActiveLaborBookTab,
    setActiveLaborBookTab,
  };
})();
