/**
 * Manifest state management for Takeoff Tooling
 */

const TakeoffState = (function () {
  const ITEM_TYPES = ['lighting', 'gear', 'devices', 'conduit', 'wire', 'specialSystems', 'permits', 'powerCoCharges', 'temporaryPower'];

  let manifest = [];
  let currentView = 'manifest'; // 'manifest' | 'device' | 'conduit' | 'wire'
  let currentItemId = null;
  let modalItemId = null;
  let conduitStep = 1; // 1: trenching, 2: fittings, 3: overage
  let conduitTempData = {};
  let deviceTempData = { outletsAndSwitches: [], boxes: [], backBoxSupport: [], covers: [], conduit: [], wire: [], screws: [], misc: [] };
  let wireTempData = { overagePercent: null, macAdapters: [] };
  let assemblies = TakeoffStorage.loadAssemblies();
  let showRemoveIcons = false;
  let showPrintOptions = false;
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

  function setCurrentView(view, itemId = null) {
    currentView = view;
    currentItemId = itemId;
  }

  function getCurrentView() {
    return currentView;
  }

  function getCurrentItemId() {
    return currentItemId;
  }

  function setModalItemId(id) {
    modalItemId = id;
  }

  function getModalItemId() {
    return modalItemId;
  }

  let laborBookPreselectedItemId = null;
  function setLaborBookPreselectedItemId(id) {
    laborBookPreselectedItemId = id;
  }
  function getLaborBookPreselectedItemId() {
    return laborBookPreselectedItemId;
  }
  function clearLaborBookPreselectedItemId() {
    laborBookPreselectedItemId = null;
  }

  let laborBookTargetDeviceRow = null;
  function setLaborBookTargetDeviceRow(val) {
    laborBookTargetDeviceRow = val;
  }
  function getLaborBookTargetDeviceRow() {
    return laborBookTargetDeviceRow;
  }
  function clearLaborBookTargetDeviceRow() {
    laborBookTargetDeviceRow = null;
  }

  // Fill target: + Add fills this row in place instead of adding children.
  // {kind: 'manifest-row', id} | {kind:'device-row', section, index}
  // | {kind:'conduit-fitting', index} | {kind:'wire-mac', index}
  let laborBookFillTarget = null;
  function setLaborBookFillTarget(target) {
    laborBookFillTarget = target;
  }
  function getLaborBookFillTarget() {
    return laborBookFillTarget;
  }
  function clearLaborBookFillTarget() {
    laborBookFillTarget = null;
  }

  let laborBookExpandGroup = null;
  function setLaborBookExpandGroup(name) {
    laborBookExpandGroup = name;
  }
  function getLaborBookExpandGroup() {
    return laborBookExpandGroup;
  }
  function clearLaborBookExpandGroup() {
    laborBookExpandGroup = null;
  }

  function setConduitStep(step) {
    conduitStep = step;
  }

  function getConduitStep() {
    return conduitStep;
  }

  function setConduitTempData(data) {
    conduitTempData = { ...conduitTempData, ...data };
  }

  function getConduitTempData() {
    return conduitTempData;
  }

  function clearConduitTempData() {
    conduitTempData = {};
  }

  function setDeviceTempData(data) {
    deviceTempData = { ...deviceTempData, ...data };
  }

  function getDeviceTempData() {
    return deviceTempData;
  }

  function clearDeviceTempData() {
    deviceTempData = { outletsAndSwitches: [], boxes: [], backBoxSupport: [], covers: [], conduit: [], wire: [], screws: [], misc: [] };
  }

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

  function setWireTempData(data) {
    wireTempData = { ...wireTempData, ...data };
  }

  function getWireTempData() {
    return wireTempData;
  }

  function clearWireTempData() {
    wireTempData = { overagePercent: null, macAdapters: [] };
  }

  function getShowRemoveIcons() {
    return showRemoveIcons;
  }

  function setShowRemoveIcons(value) {
    showRemoveIcons = !!value;
  }

  function toggleShowRemoveIcons() {
    showRemoveIcons = !showRemoveIcons;
    return showRemoveIcons;
  }

  function getLaborRate() {
    return laborRate;
  }

  function setLaborRate(value) {
    laborRate = Number(value) || 0;
    schedulePersist();
  }

  function getShowPrintOptions() {
    return showPrintOptions;
  }

  function toggleShowPrintOptions() {
    showPrintOptions = !showPrintOptions;
    return showPrintOptions;
  }

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

  function getTotalLabor() {
    function sumLabor(items) {
      let total = 0;
      for (const item of items) {
        const unitLabor = Number(item.labor) || 0;
        const qty = Number(item.quantity) || 0;
        // labor is per-unit hours; a priced/labored line with qty 0 counts once (same rule as price)
        const effectiveQty = qty > 0 ? qty : (unitLabor > 0 ? 1 : 0);
        total += unitLabor * effectiveQty;
        if (item.children && item.children.length) {
          total += sumLabor(item.children);
        }
      }
      return total;
    }
    return sumLabor(manifest.filter((i) => !i.parentId));
  }

  function getTotalPrice() {
    function sumPrice(items) {
      let total = 0;
      for (const item of items) {
        const p = Number(item.price);
        const q = Number(item.quantity) || 0;
        if (!isNaN(p) && p > 0) total += p * q;
        if (item.children && item.children.length) {
          total += sumPrice(item.children);
        }
      }
      return total;
    }
    return sumPrice(manifest.filter((i) => !i.parentId));
  }

  /**
   * Aggregate every purchasable material line across the job.
   * Included: all children with a description and qty > 0, plus childless
   * top-level items (they represent the material directly). Parents WITH
   * children are treated as groupings, and other-charges types are skipped.
   * Identical descriptions merge: quantities sum, extended cost sums
   * per-occurrence so price differences stay accurate.
   */
  function getPurchaseList() {
    const OTHER = ['permits', 'powerCoCharges', 'temporaryPower'];
    const byKey = new Map();

    function addLine(item) {
      const desc = (item.description || '').trim();
      const qty = Number(item.quantity) || 0;
      if (!desc || qty <= 0) return;
      const key = desc.toLowerCase().replace(/\s+/g, ' ');
      const price = item.price != null && item.price !== '' && !isNaN(Number(item.price)) ? Number(item.price) : null;
      let line = byKey.get(key);
      if (!line) {
        byKey.set(key, (line = { description: desc, quantity: 0, extended: 0, prices: new Set(), unpricedQty: 0 }));
      }
      line.quantity += qty;
      if (price != null) {
        line.extended += qty * price;
        line.prices.add(Math.round(price * 100) / 100);
      } else {
        line.unpricedQty += qty;
      }
    }

    for (const item of manifest.filter((i) => !i.parentId)) {
      if (OTHER.includes(item.type)) continue;
      const children = item.children || [];
      if (children.length === 0) {
        addLine(item);
      } else {
        for (const c of children) addLine(c);
      }
    }

    const lines = [...byKey.values()]
      .map((l) => {
        const prices = [...l.prices];
        return {
          description: l.description,
          quantity: Math.round(l.quantity * 100) / 100,
          unitPrice: prices.length === 1 ? prices[0] : prices.length > 1 ? Math.max(...prices) : null,
          priceVaries: prices.length > 1,
          unpriced: l.unpricedQty > 0,
          extended: Math.round(l.extended * 100) / 100,
        };
      })
      .sort((a, b) => a.description.localeCompare(b.description));

    return {
      lines,
      totalCost: Math.round(lines.reduce((s, l) => s + l.extended, 0) * 100) / 100,
      unpricedCount: lines.filter((l) => l.unpriced).length,
    };
  }

  function getFlattenedItems() {
    const result = [];
    function flatten(items, depth = 0) {
      for (const item of items) {
        result.push({ ...item, _depth: depth });
        if (item.children && item.children.length) {
          flatten(item.children, depth + 1);
        }
      }
    }
    flatten(manifest.filter((i) => !i.parentId));
    return result;
  }

  const MATERIAL_TYPES = ['lighting', 'gear', 'devices', 'conduit', 'wire', 'specialSystems'];
  const OTHER_TYPES = ['permits', 'powerCoCharges', 'temporaryPower'];
  const SALES_TAX_RATE = 0.085;

  function getSummaryBreakdown() {
    const materials = { lighting: 0, gear: 0, devices: 0, conduit: 0, wire: 0, specialSystems: 0, misc: 0 };
    const labor = { lighting: 0, gear: 0, devices: 0, conduit: 0, wire: 0, specialSystems: 0, misc: 0 };
    const otherCharges = { permits: 0, powerCoCharges: 0, temporaryPower: 0 };

    function processItems(items, parentType) {
      // Children always roll up into their top-level parent's bucket, so flow
      // components (boxes, fittings, overage...) count toward Devices/Conduit/
      // Wire instead of Misc.
      for (const item of items) {
        const effectiveType = parentType || item.type || null;
        const qty = Number(item.quantity) || 0;
        const priceVal = Number(item.price);
        const effectiveQty = qty > 0 ? qty : (!isNaN(priceVal) && priceVal > 0 ? 1 : 0);
        const priceAmount = !isNaN(priceVal) && priceVal > 0 ? priceVal * effectiveQty : 0;
        const unitLabor = Number(item.labor) || 0;
        const laborQty = qty > 0 ? qty : (unitLabor > 0 ? 1 : 0);
        const laborHrs = unitLabor * laborQty;

        if (OTHER_TYPES.includes(effectiveType)) {
          otherCharges[effectiveType] = (otherCharges[effectiveType] || 0) + priceAmount;
        } else if (MATERIAL_TYPES.includes(effectiveType)) {
          materials[effectiveType] = (materials[effectiveType] || 0) + priceAmount;
          labor[effectiveType] = (labor[effectiveType] || 0) + laborHrs;
        } else {
          materials.misc += priceAmount;
          labor.misc += laborHrs;
        }

        if (item.children && item.children.length) {
          processItems(item.children, effectiveType || parentType);
        }
      }
    }
    processItems(manifest.filter((i) => !i.parentId), null);

    const materialsSubtotal = [...MATERIAL_TYPES, 'misc'].reduce((s, t) => s + (materials[t] || 0), 0);
    const salesTax = materialsSubtotal * SALES_TAX_RATE;
    const materialsTotal = materialsSubtotal + salesTax;
    const laborTotal = [...MATERIAL_TYPES, 'misc'].reduce((s, t) => s + (labor[t] || 0), 0);
    const otherTotal = OTHER_TYPES.reduce((s, t) => s + (otherCharges[t] || 0), 0);

    return {
      materials,
      materialsSubtotal,
      salesTax,
      materialsTotal,
      labor,
      laborTotal,
      otherCharges,
      otherTotal,
    };
  }

  restoreWorkspace();

  return {
    ITEM_TYPES,
    LABOR_BOOK_TYPE_LABELS,
    getManifest,
    persistNow,
    loadManifestFromExport,
    getTopLevelItems,
    getItemById,
    getParentItem,
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
    setCurrentView,
    getCurrentView,
    getCurrentItemId,
    setModalItemId,
    getModalItemId,
    setLaborBookPreselectedItemId,
    getLaborBookPreselectedItemId,
    clearLaborBookPreselectedItemId,
    setLaborBookTargetDeviceRow,
    getLaborBookTargetDeviceRow,
    clearLaborBookTargetDeviceRow,
    setLaborBookExpandGroup,
    setLaborBookFillTarget,
    getLaborBookFillTarget,
    clearLaborBookFillTarget,
    getLaborBookExpandGroup,
    clearLaborBookExpandGroup,
    getTopLevelParentId,
    setConduitStep,
    getConduitStep,
    setConduitTempData,
    getConduitTempData,
    clearConduitTempData,
    setDeviceTempData,
    getDeviceTempData,
    clearDeviceTempData,
    getAssemblies,
    addAssembly,
    removeAssembly,
    setWireTempData,
    getWireTempData,
    clearWireTempData,
    getTotalLabor,
    getTotalPrice,
    getFlattenedItems,
    getPurchaseList,
    getSummaryBreakdown,
    generateId,
    getLaborRate,
    setLaborRate,
    getShowRemoveIcons,
    setShowRemoveIcons,
    toggleShowRemoveIcons,
    getShowPrintOptions,
    toggleShowPrintOptions,
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
