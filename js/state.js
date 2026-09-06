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

  // The open project (manifest + laborRate are its contents)
  let projectId = null;
  let projectName = 'Untitled project';

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
  // User-defined section groups from the Organize Categories view, keyed by
  // tab: {type: [{name, sections:[names]}]}. null → the shipped defaults
  // config (LABOR_BOOK_DEFAULT_GROUPS) applies. Persisted in the book doc.
  let laborBookGroups = null;
  // Provenance for the shared-book feedback loop (js/laborBookMerge.js):
  // which defaults the user deleted, and which defaults version the stored
  // book was last reconciled against.
  let laborBookRemoved = {};
  // Defaults missing from their home tab/section but present elsewhere in the
  // book (moved/renamed via Organize Categories). The defaults merge treats
  // them like removed (no resurrection at the old spot) but they are NOT
  // shared as remove-corrections — a move is not a deletion suggestion.
  let laborBookRelocated = {};
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

  // --- Persistence (all durable writes go through TakeoffStorage) ---
  // Two documents: the open PROJECT (manifest + laborRate) and the
  // account-level BOOK (labor book + provenance meta). Each has its own
  // debounced save.
  let persistTimer = null;
  let persistBookTimer = null;

  // Keep the device-local index entry (name/updatedAt) in step with a save.
  function touchIndexEntry(savedAt) {
    const idx = TakeoffStorage.loadProjectsIndex() || { v: 1, currentId: projectId, projects: [] };
    let entry = idx.projects.find((p) => p.id === projectId);
    if (!entry) {
      entry = { id: projectId, name: projectName, createdAt: savedAt, updatedAt: savedAt };
      idx.projects.push(entry);
    }
    entry.name = projectName;
    entry.updatedAt = savedAt;
    idx.currentId = projectId;
    TakeoffStorage.saveProjectsIndex(idx);
  }

  function persistNow() {
    if (!projectId) return;
    const savedAt = new Date().toISOString();
    TakeoffStorage.saveProject({ v: 1, id: projectId, savedAt, name: projectName, manifest, laborRate });
    touchIndexEntry(savedAt);
  }

  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(persistNow, 400);
  }

  function persistBookNow() {
    TakeoffStorage.saveBook({
      v: 1,
      savedAt: new Date().toISOString(),
      laborBook,
      laborBookGroups,
      laborBookMeta: { defaultsVersion: laborBookDefaultsVersion, removed: laborBookRemoved, relocated: laborBookRelocated },
    });
  }

  function schedulePersistBook() {
    if (persistBookTimer) clearTimeout(persistBookTimer);
    persistBookTimer = setTimeout(persistBookNow, 400);
  }

  // Flush both documents (beforeunload, project switches).
  function persistAllNow() {
    persistNow();
    persistBookNow();
  }

  // Union of two removed-shaped maps ({tab: {section: [names]}}); pure.
  function unionRemovedMaps(a, b) {
    const out = JSON.parse(JSON.stringify(a || {}));
    for (const tab of Object.keys(b || {})) {
      if (!out[tab]) out[tab] = {};
      for (const section of Object.keys(b[tab] || {})) {
        if (!out[tab][section]) out[tab][section] = [];
        for (const name of b[tab][section]) {
          if (!out[tab][section].includes(name)) out[tab][section].push(name);
        }
      }
    }
    return out;
  }

  // Reconcile a restored/adopted book with the shipped defaults: bootstrap
  // provenance flags on pre-versioning workspaces, then merge in any newer
  // defaults (user-touched rows win). Persists when anything changed.
  function upgradeLaborBook(meta) {
    laborBookRemoved = meta && meta.removed && typeof meta.removed === 'object' ? meta.removed : {};
    laborBookRelocated = meta && meta.relocated && typeof meta.relocated === 'object' ? meta.relocated : {};
    let storedVersion = meta && typeof meta.defaultsVersion === 'number' ? meta.defaultsVersion : 0;
    let dirty = false;
    if (storedVersion === 0) {
      const inferred = TakeoffLaborBookMerge.bootstrap(laborBook, LABOR_BOOK_DEFAULTS);
      for (const tab of Object.keys(inferred)) laborBookRemoved[tab] = inferred[tab];
      storedVersion = LABOR_BOOK_DEFAULTS_VERSION;
      dirty = true;
    }
    if (storedVersion < LABOR_BOOK_DEFAULTS_VERSION) {
      // relocated defaults count as removed for the merge — moved sections
      // must not be resurrected at their old location
      TakeoffLaborBookMerge.mergeDefaults(laborBook, LABOR_BOOK_DEFAULTS, unionRemovedMaps(laborBookRemoved, laborBookRelocated));
      dirty = true;
    }
    laborBookDefaultsVersion = LABOR_BOOK_DEFAULTS_VERSION;
    if (dirty) schedulePersistBook();
  }

  function loadProjectIntoState(data) {
    projectId = data.id;
    projectName = data.name || 'Untitled project';
    manifest = Array.isArray(data.manifest) ? data.manifest : [];
    laborRate = typeof data.laborRate === 'number' ? data.laborRate : 0;
  }

  function restoreOnBoot() {
    TakeoffStorage.migrateLegacyWorkspace();
    const book = TakeoffStorage.loadBook();
    if (book && book.laborBook && typeof book.laborBook === 'object') {
      laborBook = book.laborBook;
      if (book.laborBookGroups && typeof book.laborBookGroups === 'object') laborBookGroups = book.laborBookGroups;
      upgradeLaborBook(book.laborBookMeta);
    }
    const idx = TakeoffStorage.loadProjectsIndex();
    const currentEntry = idx && (idx.projects.find((p) => p.id === idx.currentId) || idx.projects[0]);
    const data = currentEntry && TakeoffStorage.loadProject(currentEntry.id);
    if (data) {
      loadProjectIntoState(data);
    } else {
      // fresh install (or a dangling index): start with an empty project
      projectId = TakeoffStorage.generateProjectId();
      projectName = 'Untitled project';
      persistNow();
    }
  }

  // Replace the book with one pulled from cloud sync (TakeoffCloud). The
  // caller has already written it to TakeoffStorage.
  function adoptBook(data) {
    if (!data || data.v !== 1 || !data.laborBook || typeof data.laborBook !== 'object') return false;
    laborBook = data.laborBook;
    laborBookGroups = data.laborBookGroups && typeof data.laborBookGroups === 'object' ? data.laborBookGroups : null;
    upgradeLaborBook(data.laborBookMeta);
    return true;
  }

  // Replace the OPEN project with a newer copy pulled from cloud sync. Undo
  // history refers to the replaced manifest, so it is cleared.
  function adoptProject(data) {
    if (!data || data.v !== 1 || data.id !== projectId) return false;
    loadProjectIntoState(data);
    undoStack = [];
    redoStack = [];
    lastEdit = { id: null, keys: '', time: 0 };
    return true;
  }

  // --- Project management ---

  function getProjects() {
    const idx = TakeoffStorage.loadProjectsIndex();
    const list = idx ? idx.projects.slice() : [];
    list.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
    return list;
  }

  function getCurrentProject() {
    return { id: projectId, name: projectName };
  }

  function setProjectName(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    projectName = trimmed;
    schedulePersist();
  }

  function clearManifestHistory() {
    undoStack = [];
    redoStack = [];
    lastEdit = { id: null, keys: '', time: 0 };
  }

  function switchProject(id) {
    if (id === projectId) return true;
    const data = TakeoffStorage.loadProject(id);
    if (!data) return false;
    persistAllNow();
    loadProjectIntoState(data);
    clearManifestHistory();
    const idx = TakeoffStorage.loadProjectsIndex();
    if (idx) {
      idx.currentId = id;
      TakeoffStorage.saveProjectsIndex(idx);
    }
    return true;
  }

  // New projects start empty; the labor rate carries over as the default.
  function createProject(name) {
    persistAllNow();
    projectId = TakeoffStorage.generateProjectId();
    projectName = (name || '').trim() || 'Untitled project';
    manifest = [];
    clearManifestHistory();
    persistNow();
    return projectId;
  }

  function duplicateProject(id) {
    const source = id === projectId
      ? { v: 1, id: projectId, name: projectName, manifest, laborRate }
      : TakeoffStorage.loadProject(id);
    if (!source) return null;
    const savedAt = new Date().toISOString();
    const copy = {
      v: 1,
      id: TakeoffStorage.generateProjectId(),
      savedAt,
      name: `${source.name || 'Untitled project'} (copy)`,
      manifest: JSON.parse(JSON.stringify(source.manifest || [])),
      laborRate: typeof source.laborRate === 'number' ? source.laborRate : 0,
    };
    TakeoffStorage.saveProject(copy);
    const idx = TakeoffStorage.loadProjectsIndex() || { v: 1, currentId: projectId, projects: [] };
    idx.projects.push({ id: copy.id, name: copy.name, createdAt: savedAt, updatedAt: savedAt });
    TakeoffStorage.saveProjectsIndex(idx);
    return copy.id;
  }

  // The open project can't be deleted (switch away first).
  function deleteProject(id) {
    if (id === projectId) return false;
    TakeoffStorage.deleteProject(id);
    const idx = TakeoffStorage.loadProjectsIndex();
    if (idx) {
      idx.projects = idx.projects.filter((p) => p.id !== id);
      TakeoffStorage.saveProjectsIndex(idx);
    }
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
    if (laborBookGroups) return laborBookGroups[type] || null;
    return LABOR_BOOK_GROUPS[type] || null;
  }

  /**
   * Commit a reorganization from the Organize Categories view. `payload` is
   * {tabs: [{key, groups: [{name|null, sections: [{name, items:[rows],
   * origin?: {tab, name}}]}]}]} — the full structure for every tab. Rows
   * already carry provenance flags (stamped by the view as the user edited
   * them); `origin` is where a section lived in the book when the view
   * opened (absent for sections created in the view). Rebuilds each tab's
   * section map in the given order, stores named groups as the user's group
   * config, and re-derives the removed/relocated maps: defaults whose home
   * section survived somewhere (moved/renamed — matched by origin) become
   * `relocated` (no resurrection on merge, but not shared as a remove
   * suggestion); defaults whose section is gone, or rows deleted from a
   * surviving section, become `removed`. Not undoable (labor-book changes
   * never are).
   */
  function applyBookReorganization(payload) {
    if (!payload || !Array.isArray(payload.tabs)) return false;
    const newBook = {};
    const newGroups = {};
    const survivingOrigins = new Set(); // "tab\nsection" of sections that still exist somewhere
    for (const tab of payload.tabs) {
      if (!LABOR_BOOK_TAB_ORDER.includes(tab.key)) continue;
      const sections = {};
      const named = [];
      for (const group of tab.groups || []) {
        const sectionNames = [];
        for (const sec of group.sections || []) {
          const name = String(sec.name || '').trim();
          if (!name || sections[name]) continue; // duplicates collapse silently
          sections[name] = Array.isArray(sec.items) ? sec.items : [];
          sectionNames.push(name);
          if (sec.origin && sec.origin.tab && sec.origin.name) {
            survivingOrigins.add(sec.origin.tab + '\n' + sec.origin.name);
          }
        }
        if (group.name !== null && group.name !== undefined) {
          named.push({ name: String(group.name), sections: sectionNames });
        }
      }
      newBook[tab.key] = sections;
      newGroups[tab.key] = named;
    }
    // any tab the payload skipped keeps its current sections
    for (const key of LABOR_BOOK_TAB_ORDER) {
      if (!newBook[key]) newBook[key] = laborBook[key] || {};
    }
    laborBook = newBook;
    laborBookGroups = newGroups;

    const missing = TakeoffLaborBookMerge.computeRemoved(laborBook, LABOR_BOOK_DEFAULTS, true);
    laborBookRemoved = {};
    laborBookRelocated = {};
    for (const tabKey of Object.keys(missing)) {
      for (const section of Object.keys(missing[tabKey])) {
        // a section still present at home lost individual rows → removed;
        // a section that survived elsewhere (moved/renamed) → relocated;
        // a section that is gone entirely → removed
        const atHome = !!laborBook[tabKey][section];
        const movedAway = !atHome && survivingOrigins.has(tabKey + '\n' + section);
        const dest = movedAway ? laborBookRelocated : laborBookRemoved;
        if (!dest[tabKey]) dest[tabKey] = {};
        dest[tabKey][section] = missing[tabKey][section].slice();
      }
    }
    persistBookNow();
    return true;
  }

  function getLaborBookType(type) {
    return laborBook[type] || {};
  }

  function setLaborBookSection(type, section, entries) {
    if (!laborBook[type]) laborBook[type] = {};
    laborBook[type][section] = entries || [];
    schedulePersistBook();
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
    schedulePersistBook();
  }

  function removeLaborBookRow(type, section, index) {
    if (!laborBook[type]?.[section]) return;
    const row = laborBook[type][section][index];
    if (row) noteRemovedDefault(type, section, row.name);
    laborBook[type][section].splice(index, 1);
    schedulePersistBook();
  }

  function addLaborBookSection(type, sectionName) {
    if (!laborBook[type]) laborBook[type] = {};
    laborBook[type][sectionName] = [];
    schedulePersistBook();
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
    schedulePersistBook();
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
      schedulePersistBook();
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
    schedulePersistBook();
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
    if (changed) schedulePersistBook();
    return changed;
  }

  /**
   * Copy a supplier catalog part into the editable book (its universal
   * section, created if needed), carrying part #, the vendor's offer, and
   * the first history entry. Returns {section, index} of the new row.
   * Rendering dedupes catalog rows by part #, so the row simply becomes
   * editable in place.
   */
  function promoteCatalogPart(type, sectionName, vendor, entry) {
    if (!laborBook[type] || !laborBook[type][sectionName]) {
      addLaborBookSection(type, sectionName);
    }
    const at = entry.pricedAt || null;
    const hasPrice = entry.price != null && entry.price !== '';
    addLaborBookRow(type, sectionName, {
      name: entry.name,
      labor: 0,
      price: hasPrice ? String(entry.price) : '',
      partNumber: entry.partNumber || '',
      priceSource: hasPrice ? vendor : undefined,
      pricedAt: hasPrice ? at : undefined,
      offers: hasPrice ? [{ supplier: vendor, price: Number(entry.price), at, by: 'import' }] : [],
      history: hasPrice ? [{ at, kind: 'price', supplier: vendor, value: Number(entry.price), by: 'import' }] : [],
    });
    return { section: sectionName, index: laborBook[type][sectionName].length - 1 };
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

  restoreOnBoot();

  return {
    ITEM_TYPES,
    LABOR_BOOK_TYPE_LABELS,
    // ephemeral UI state (see js/uiState.js)
    ...TakeoffUiState,
    getManifest,
    persistNow,
    persistAllNow,
    adoptBook,
    adoptProject,
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
    applyBookReorganization,
    getLaborBookType,
    setLaborBookSection,
    addLaborBookRow,
    removeLaborBookRow,
    addLaborBookSection,
    updateLaborBookRow,
    recordPartPrice,
    usePartOffer,
    recordPartLabor,
    promoteCatalogPart,
    refreshSupplierOffers,
    getBookCorrections,
    getProjects,
    getCurrentProject,
    setProjectName,
    switchProject,
    createProject,
    duplicateProject,
    deleteProject,
    getActiveLaborBookTab,
    setActiveLaborBookTab,
  };
})();
