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
  // Sales tax is the jurisdiction's, not the app's: it travels with the
  // project (and with a share link), as a PERCENT, starting at 8.25% (Texas'
  // combined maximum) for a new bid.
  let taxRate = TakeoffSelectors.DEFAULT_TAX_RATE;
  // The rate the app hardcoded before it was a project setting. A document
  // saved without a taxRate was bid at this, so that is what it keeps.
  const LEGACY_TAX_RATE = 8.5;
  // Link back to the CountTooling project the counts came from (the
  // `?t=<token>` view link CountTooling appends to its export). Shown in the
  // header; travels on to PipeTooling with the counts.
  let plansUrl = '';

  // The open project (manifest + laborRate are its contents)
  let projectId = null;
  let projectName = 'Untitled project';
  // The job's own details — client, address, permit no., builder or occupant,
  // due date. All optional: a bid is valid with none of them, and nothing here
  // is ever a step before typing the first fixture. They ride the project
  // document, the share envelope and Print with form.
  const DETAIL_KEYS = ['client', 'address', 'permitNo', 'builderOrOccupant', 'dueDate'];
  let projectDetails = {};
  // For a bid that arrived over a share link: {name, exportedAt} of the link it
  // came from, so opening the same link twice reopens the copy instead of
  // making an identical twin.
  let projectImportedFrom = null;
  // A closed-out bid: it keeps everything it has, it just leaves the switcher.
  // Mirrored onto the device index entry so the list can be split without
  // reading every project document.
  let projectArchived = false;
  let projectArchivedAt = null;

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
  let laborBookRemoved = {}; // removals the user made — shared as corrections
  let laborBookRemovedLegacy = {}; // pre-split map: honoured, never shared
  // Defaults missing from their home tab/section but present elsewhere in the
  // book (moved/renamed via Organize Categories). The defaults merge treats
  // them like removed (no resurrection at the old spot) but they are NOT
  // shared as remove-corrections — a move is not a deletion suggestion.
  let laborBookRelocated = {};
  let laborBookDefaultsVersion = LABOR_BOOK_DEFAULTS_VERSION;
  // Rows a defaults upgrade rewrote under the user, for the one-time "the
  // shared book moved" line (read once by js/cloud.js at boot).
  let bookUpdate = null;

  function generateId() {
    // UUIDs so ids stay valid as database row keys after the Count Tooling
    // integration; legacy 'id_' ids in saved workspaces remain accepted.
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  }

  function getManifest() {
    return manifest;
  }

  // Row units (see TakeoffSelectors.UNITS): anything unknown is a count.
  function normalizeUnit(u) {
    return typeof u === 'string' && TakeoffSelectors.UNITS.includes(u) ? u : 'ea';
  }

  // Imported rows always get fresh ids. Reusing the sender's ids let a shared
  // copy and its source share row ids, so an open flow editor kept rendering
  // after a project switch and saved into the wrong bid.
  function sanitizeImportedItem(raw, parentId) {
    if (!raw || typeof raw !== 'object') return null;
    const id = generateId();
    const price = Number(raw.price);
    const item = {
      id,
      type: typeof raw.type === 'string' ? raw.type : null,
      description: typeof raw.description === 'string' ? raw.description : '',
      quantity: Number(raw.quantity) || 0,
      unit: normalizeUnit(raw.unit),
      labor: Number(raw.labor) || 0,
      planPage: typeof raw.planPage === 'string' ? raw.planPage : '',
      group: typeof raw.group === 'string' && raw.group.trim() ? raw.group.trim() : null,
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

  // Details arrive from a share link or a restored document: keep the five
  // known keys, as trimmed strings, and drop everything else.
  function sanitizeDetails(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const key of DETAIL_KEYS) {
      const value = raw[key];
      if (typeof value === 'string' && value.trim()) out[key] = value.trim().slice(0, 200);
    }
    return out;
  }

  function sanitizeImportedFrom(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    const exportedAt = typeof raw.exportedAt === 'string' ? raw.exportedAt.trim() : '';
    return name && exportedAt ? { name, exportedAt } : null;
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
    markEntryArchived(entry, projectArchived, projectArchivedAt);
    idx.currentId = projectId;
    TakeoffStorage.saveProjectsIndex(idx);
  }

  function persistNow() {
    if (!projectId) return;
    const savedAt = new Date().toISOString();
    const doc = { v: 1, id: projectId, savedAt, name: projectName, manifest, laborRate, taxRate, details: projectDetails, importedFrom: projectImportedFrom };
    if (plansUrl) doc.plansUrl = plansUrl;
    if (projectArchived) {
      doc.archived = true;
      doc.archivedAt = projectArchivedAt;
    }
    TakeoffStorage.saveProject(doc);
    touchIndexEntry(savedAt);
  }

  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(persistNow, 400);
  }

  // savedAt is the book's last-write-wins clock against the cloud copy. A
  // user edit stamps "now"; a merge-only save (the silent defaults upgrade at
  // boot) keeps the stored stamp, so booting after an app update can never
  // make this device's book win over another device's real corrections.
  let bookSavedAt = null; // stamp of the stored book document
  let bookUserEdited = false; // a user edit has touched the book this session

  function persistBookNow() {
    const savedAt = bookUserEdited || !bookSavedAt ? new Date().toISOString() : bookSavedAt;
    bookSavedAt = savedAt;
    TakeoffStorage.saveBook({
      v: 1,
      savedAt,
      laborBook,
      // null = the shipped groups config (LABOR_BOOK_DEFAULT_GROUPS) applies
      laborBookGroups,
      laborBookMeta: {
        defaultsVersion: laborBookDefaultsVersion,
        // removedV: 2 — `removed` holds only removals the user made; the
        // pre-split map (which mixed those with gaps bootstrap inferred)
        // lives on as removedLegacy; `relocated` is what Organize Categories
        // moved or renamed. See js/laborBookMerge.js.
        removedV: 2,
        removed: laborBookRemoved,
        removedLegacy: laborBookRemovedLegacy,
        relocated: laborBookRelocated,
      },
    });
  }

  function schedulePersistBook(opts) {
    if (!(opts && opts.mergeOnly)) bookUserEdited = true;
    if (persistBookTimer) clearTimeout(persistBookTimer);
    persistBookTimer = setTimeout(persistBookNow, 400);
  }

  // Flush both documents (beforeunload, project switches).
  function persistAllNow() {
    persistNow();
    persistBookNow();
  }

  // Reconcile a restored/adopted book with the shipped defaults: bootstrap
  // provenance flags on pre-versioning workspaces, then merge in any newer
  // defaults (user-touched rows win). Persists when anything changed.
  // The bootstrap must NOT claim the book is already at the current defaults
  // version — a legacy, empty or partial book has to run the merge too, or it
  // is recorded as up to date with most of its sections missing and never
  // self-heals.
  function upgradeLaborBook(meta, savedAt) {
    bookSavedAt = typeof savedAt === 'string' && savedAt ? savedAt : null;
    bookUserEdited = false; // this book document is what storage/cloud holds
    const maps = TakeoffLaborBookMerge.migrateRemovedMeta(meta);
    laborBookRemoved = maps.removed;
    laborBookRemovedLegacy = maps.removedLegacy;
    laborBookRelocated = maps.relocated;
    const storedVersion = meta && typeof meta.defaultsVersion === 'number' ? meta.defaultsVersion : 0;
    let dirty = false;
    if (storedVersion === 0) {
      // flags only — a missing default is an inferred gap, not a removal, and
      // the merge below fills it back in (J11-F12)
      TakeoffLaborBookMerge.bootstrap(laborBook, LABOR_BOOK_DEFAULTS, LABOR_BOOK_RETIRED);
      dirty = true;
    }
    if (storedVersion < LABOR_BOOK_DEFAULTS_VERSION) {
      // relocated defaults count as removed for the merge — moved sections
      // must not be resurrected at their old location
      const res = TakeoffLaborBookMerge.mergeDefaults(laborBook, LABOR_BOOK_DEFAULTS, laborBookRemoved, laborBookRemovedLegacy, laborBookRelocated, LABOR_BOOK_RETIRED);
      // Only a stored book that was already at a real defaults version can be
      // told "your book changed": a bootstrap pass rewrites rows the user
      // never saw as defaults, and a first boot has nothing to compare with.
      if (storedVersion > 0 && res.updated.length) bookUpdate = { at: Date.now(), rows: res.updated };
      dirty = true;
    } else if (!meta || meta.removedV !== 2) {
      dirty = true; // record the removed/removedLegacy split for next boot
    }
    laborBookDefaultsVersion = LABOR_BOOK_DEFAULTS_VERSION;
    // mergeOnly: this save is the app catching the book up to its own
    // defaults, not a user edit — it must not outrank another device's copy.
    if (dirty) schedulePersistBook({ mergeOnly: true });
  }

  // A stored, imported or typed tax rate, as a percent between 0 and 100.
  // A missing or unreadable rate falls back to the 8.5% the app used to
  // hardcode: that is the rate the document was bid at (new bids start at
  // TakeoffSelectors.DEFAULT_TAX_RATE, set where the project is created).
  function sanitizeTaxRate(value) {
    const n = Number(value);
    if (typeof value === 'boolean' || value === null || value === '' || !isFinite(n)) return LEGACY_TAX_RATE;
    return Math.min(100, Math.max(0, n));
  }

  // Archived is a flag the app sets, never a value it accepts on trust: a
  // shared or imported document carrying anything else is simply live.
  function sanitizeArchived(data) {
    if (!data || data.archived !== true) return { archived: false, archivedAt: null };
    const at = typeof data.archivedAt === 'string' && Date.parse(data.archivedAt) ? data.archivedAt : new Date().toISOString();
    return { archived: true, archivedAt: at };
  }

  // The device index entry mirrors the flag so the project list can be split
  // without loading every project document.
  function markEntryArchived(entry, archived, archivedAt) {
    if (archived) {
      entry.archived = true;
      entry.archivedAt = archivedAt;
    } else {
      delete entry.archived;
      delete entry.archivedAt;
    }
    return entry;
  }

  function loadProjectIntoState(data) {
    projectId = data.id;
    projectName = data.name || 'Untitled project';
    manifest = Array.isArray(data.manifest) ? data.manifest : [];
    laborRate = typeof data.laborRate === 'number' ? data.laborRate : 0;
    // a project saved before the rate was editable carries none: it was bid at
    // the old hardcoded 8.5%, so that is what it keeps
    taxRate = sanitizeTaxRate(data.taxRate);
    plansUrl = typeof data.plansUrl === 'string' && /^https?:\/\//i.test(data.plansUrl) ? data.plansUrl : '';
    projectDetails = sanitizeDetails(data.details);
    projectImportedFrom = sanitizeImportedFrom(data.importedFrom);
    const arch = sanitizeArchived(data);
    projectArchived = arch.archived;
    projectArchivedAt = arch.archivedAt;
  }

  function restoreOnBoot() {
    TakeoffStorage.migrateLegacyWorkspace();
    const book = TakeoffStorage.loadBook();
    if (book && book.laborBook && typeof book.laborBook === 'object') {
      laborBook = book.laborBook;
      if (book.laborBookGroups && typeof book.laborBookGroups === 'object') laborBookGroups = book.laborBookGroups;
      upgradeLaborBook(book.laborBookMeta, book.savedAt);
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
    upgradeLaborBook(data.laborBookMeta, data.savedAt);
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
    return { id: projectId, name: projectName, plansUrl };
  }

  // The CountTooling plans link for this project (set by the import; shown in
  // the header and forwarded to PipeTooling). Empty string clears it.
  function setPlansUrl(url) {
    const next = typeof url === 'string' ? url.trim() : '';
    if (next && !/^https?:\/\//i.test(next)) return false;
    plansUrl = next;
    schedulePersist();
    return true;
  }

  function setProjectName(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    projectName = trimmed;
    schedulePersist();
  }

  function getProjectDetails() {
    return { ...projectDetails };
  }

  // Patch-style: only the keys passed are touched; a blank value clears one.
  function setProjectDetails(patch) {
    if (!patch || typeof patch !== 'object') return getProjectDetails();
    for (const key of DETAIL_KEYS) {
      if (!(key in patch)) continue;
      const value = typeof patch[key] === 'string' ? patch[key].trim().slice(0, 200) : '';
      if (value) projectDetails[key] = value;
      else delete projectDetails[key];
    }
    schedulePersist();
    return getProjectDetails();
  }

  function getProjectImportedFrom() {
    return projectImportedFrom ? { ...projectImportedFrom } : null;
  }

  /**
   * The project a share link already landed in, or null. Two links carrying the
   * same name and the same exportedAt are the same bid: opening one twice must
   * reopen the copy, not make a byte-identical twin.
   */
  function findImportedProject(name, exportedAt) {
    if (!name || !exportedAt) return null;
    const idx = TakeoffStorage.loadProjectsIndex();
    for (const entry of (idx && idx.projects) || []) {
      const doc = entry.id === projectId
        ? { importedFrom: projectImportedFrom }
        : TakeoffStorage.loadProject(entry.id);
      const from = doc && sanitizeImportedFrom(doc.importedFrom);
      if (from && from.name === name && from.exportedAt === exportedAt) return entry.id;
    }
    return null;
  }

  /**
   * '<name>', then '<name> 2', '<name> 3'… — the suffix a second copy gets,
   * whether it came from Duplicate or from a share link.
   */
  function uniqueProjectName(base) {
    const wanted = (base || '').trim() || 'Untitled project';
    const idx = TakeoffStorage.loadProjectsIndex();
    const taken = new Set(((idx && idx.projects) || []).map((p) => (p.name || '').trim()));
    if (projectId) taken.add(projectName);
    if (!taken.has(wanted)) return wanted;
    let n = 2;
    while (taken.has(`${wanted} ${n}`)) n++;
    return `${wanted} ${n}`;
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

  // New projects start with one blank row (same as a fresh boot — an empty
  // table with nothing to type into reads as broken); the labor rate carries
  // over as the default. Share-link imports replace the manifest right after.
  function createProject(name, opts) {
    persistAllNow();
    projectId = TakeoffStorage.generateProjectId();
    projectName = (name || '').trim() || 'Untitled project';
    projectDetails = sanitizeDetails(opts && opts.details);
    projectImportedFrom = sanitizeImportedFrom(opts && opts.importedFrom);
    // a new bid — however it arrived, share link included — is always live
    projectArchived = false;
    projectArchivedAt = null;
    plansUrl = ''; // the counts for a new bid have not come from anywhere yet
    // laborRate and taxRate carry over as the new project's defaults
    manifest = [
      { id: generateId(), type: null, description: '', quantity: 1, unit: 'ea', labor: 0, planPage: '', group: null, parentId: null, price: null, children: [], conduitMeta: null, meta: null },
    ];
    clearManifestHistory();
    persistNow();
    return projectId;
  }

  // A copy must not share row ids with its source: an open flow editor keyed
  // on an id that exists in both bids renders after a switch and saves into
  // the wrong one. Rewrites children's parentId to match.
  function reidManifest(list, parentId) {
    return (Array.isArray(list) ? list : []).map((item) => {
      const fresh = { ...item, id: generateId(), parentId: parentId ?? null };
      fresh.children = reidManifest(item.children, fresh.id);
      return fresh;
    });
  }

  function duplicateProject(id) {
    const source = id === projectId
      ? { v: 1, id: projectId, name: projectName, manifest, laborRate, taxRate, plansUrl, details: projectDetails }
      : TakeoffStorage.loadProject(id);
    if (!source) return null;
    const savedAt = new Date().toISOString();
    const copy = {
      v: 1,
      id: TakeoffStorage.generateProjectId(),
      savedAt,
      // '<name> 2', then '<name> 3' — the same suffix a second share-link copy
      // gets, so two duplicates are never two identical '(copy)' rows.
      name: uniqueProjectName(source.name || 'Untitled project'),
      manifest: reidManifest(JSON.parse(JSON.stringify(source.manifest || [])), null),
      laborRate: typeof source.laborRate === 'number' ? source.laborRate : 0,
      taxRate: sanitizeTaxRate(source.taxRate),
      details: sanitizeDetails(source.details),
      importedFrom: null,
    };
    if (typeof source.plansUrl === 'string' && source.plansUrl) copy.plansUrl = source.plansUrl;
    TakeoffStorage.saveProject(copy);
    const idx = TakeoffStorage.loadProjectsIndex() || { v: 1, currentId: projectId, projects: [] };
    idx.projects.push({ id: copy.id, name: copy.name, createdAt: savedAt, updatedAt: savedAt });
    TakeoffStorage.saveProjectsIndex(idx);
    return copy.id;
  }

  function isProjectArchived() {
    return projectArchived;
  }

  /**
   * Close a bid out (or reopen it). Archiving keeps every line, every rate and
   * the bid's place in the savedAt order — it only leaves the switcher, so a
   * season of finished jobs stops standing between the estimator and today's.
   * The open bid can't be archived (open another one first); it can always be
   * unarchived. The document's savedAt IS stamped, because that stamp is what
   * carries the change to the account's other devices; the device index entry's
   * updatedAt is not, so "Last edited" and every ordering stay put.
   */
  function setProjectArchived(id, archived) {
    const want = !!archived;
    if (id === projectId) {
      if (want) return false; // the bid you have open is not a closed bid
      if (!projectArchived) return true;
      projectArchived = false;
      projectArchivedAt = null;
      persistNow();
      return true;
    }
    const data = TakeoffStorage.loadProject(id);
    if (!data) return false;
    const at = new Date().toISOString();
    if (want) {
      data.archived = true;
      data.archivedAt = at;
    } else {
      delete data.archived;
      delete data.archivedAt;
    }
    data.savedAt = at;
    TakeoffStorage.saveProject(data);
    const idx = TakeoffStorage.loadProjectsIndex();
    const entry = idx && idx.projects.find((p) => p.id === id);
    if (entry) {
      markEntryArchived(entry, want, at);
      TakeoffStorage.saveProjectsIndex(idx);
    }
    return true;
  }

  /**
   * Bring a device index entry back in step with its project document. Cloud
   * sync writes documents pulled from the account and only refreshes the name
   * and stamp on the entry, so a bid archived on another device can reach this
   * one with the flag in the document alone. Index-only: nothing is saved back
   * to the document and nothing goes to the cloud.
   */
  function reconcileArchivedEntry(id, archived, archivedAt) {
    const idx = TakeoffStorage.loadProjectsIndex();
    const entry = idx && idx.projects.find((p) => p.id === id);
    if (!entry) return false;
    const want = !!archived;
    if (!!entry.archived === want) return false;
    markEntryArchived(entry, want, typeof archivedAt === 'string' ? archivedAt : new Date().toISOString());
    TakeoffStorage.saveProjectsIndex(idx);
    return true;
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

  // Moving through the stack ends the coalescing window: the next keystroke
  // starts a frame of its own. Without this, typing within 1.2 s of an Undo
  // coalesced into a frame that Undo had just consumed — the edit was not
  // undoable, and the Redo it silently dropped stayed lit.
  function undo() {
    if (undoStack.length === 0) return false;
    redoStack.push(deepCloneManifest());
    manifest = undoStack.pop();
    lastEdit = { id: null, keys: '', time: 0 };
    schedulePersist();
    return true;
  }

  function redo() {
    if (redoStack.length === 0) return false;
    undoStack.push(deepCloneManifest());
    manifest = redoStack.pop();
    lastEdit = { id: null, keys: '', time: 0 };
    schedulePersist();
    return true;
  }

  function canUndo() {
    return undoStack.length > 0;
  }

  // How many manifest frames are still behind the estimator (telemetry reads
  // this to see how deep real undos go; the buttons only need canUndo).
  function getUndoDepth() {
    return undoStack.length;
  }

  function canRedo() {
    return redoStack.length > 0;
  }

  // A price is a number or nothing — never the string a search row or a
  // supplier catalog hands over ("73.0758"), which sorted and summed wrong
  // everywhere downstream. Blank stays null: "no price yet" is not $0.
  function coercePrice(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    return isFinite(n) ? n : null;
  }

  function addItem(item) {
    pushUndo();
    const newItem = {
      id: item.id || generateId(),
      type: item.type || null,
      description: item.description || '',
      quantity: Number(item.quantity) || 0,
      unit: normalizeUnit(item.unit),
      labor: Number(item.labor) || 0,
      planPage: item.planPage ?? '',
      group: typeof item.group === 'string' && item.group.trim() ? item.group.trim() : null,
      parentId: item.parentId ?? null,
      price: coercePrice(item.price),
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

  // Two values that mean the same thing on a row: null and undefined are both
  // "empty", and a number typed twice is one number. Objects are never
  // compared — a meta/children write always counts as a change.
  function sameFieldValue(a, b) {
    if (a === b) return true;
    if (a == null && b == null) return true;
    return false;
  }

  function isNoOpUpdate(item, updates) {
    for (const key of Object.keys(updates)) {
      const next = updates[key];
      if (next && typeof next === 'object') return false;
      if (!sameFieldValue(next, item[key])) return false;
    }
    return true;
  }

  function updateItem(id, updates) {
    const item = getItemById(id);
    if (!item) return null;
    if (updates && Object.prototype.hasOwnProperty.call(updates, 'price')) {
      updates = { ...updates, price: coercePrice(updates.price) };
    }
    // An edit that changes nothing costs no undo press. Typing a value,
    // pausing past the coalescing window, then tabbing away re-sent the same
    // value and pushed a second frame, so the first Undo appeared to do
    // nothing. Compared after coercion, so a blank price re-sent on blur
    // (null against null) is equal too.
    if (isNoOpUpdate(item, updates)) return item;
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
    if ('unit' in updates) updates = { ...updates, unit: normalizeUnit(updates.unit) };
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
    // perRun/sourceQty: rows are stored as per-run ratios of the line they were
    // saved from. Assemblies without the flag are legacy absolute totals.
    const a = {
      id: generateId(),
      name: assembly.name || 'Unnamed',
      sections: assembly.sections || {},
      perRun: assembly.perRun === true,
      sourceQty: Number(assembly.sourceQty) || 0,
      createdAt: new Date().toISOString(),
    };
    assemblies.push(a);
    TakeoffStorage.saveAssemblies(assemblies);
    return a;
  }

  // Rename and re-record keep the assembly's id, which is what the cloud's
  // union-by-id merge keys on (js/cloudSync.js mergeAssemblies keeps whole
  // objects, local over remote) — so an edit travels as an edit rather than
  // arriving beside the copy it replaced. Neither touches the manifest, so
  // neither is undoable and neither marks the open flow dirty.
  function renameAssembly(id, name) {
    const a = assemblies.find((x) => x.id === id);
    const next = (name || '').trim();
    if (!a || !next || a.name === next) return null;
    a.name = next;
    a.updatedAt = new Date().toISOString();
    TakeoffStorage.saveAssemblies(assemblies);
    return a;
  }

  /**
   * Overwrite a saved recipe's rows with a fresh set. `sourceQty` is the run
   * count they were taken from: > 0 means the rows are per-run ratios (the
   * shape addAssembly writes), 0 means absolute totals, exactly as on a first
   * save — so re-recording from a line with no run count does not leave a
   * per-run flag standing over totals.
   */
  function updateAssembly(id, sections, sourceQty) {
    const a = assemblies.find((x) => x.id === id);
    if (!a) return null;
    const qty = Number(sourceQty) || 0;
    a.sections = sections || {};
    a.perRun = qty > 0;
    a.sourceQty = qty;
    a.updatedAt = new Date().toISOString();
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

  // --- Labor rate and sales tax (both per project) ---

  function getLaborRate() {
    return laborRate;
  }

  function setLaborRate(value) {
    // a rate cannot be negative: a minus sign turned a $17,024 bid into $1,154
    laborRate = Math.max(0, Number(value) || 0);
    schedulePersist();
  }

  function getTaxRate() {
    return taxRate;
  }

  // Typed by the estimator: a cleared box means 0% (a job outside any sales
  // tax), not "put the default back".
  function setTaxRate(value) {
    const n = Number(value);
    if (!isFinite(n)) return;
    taxRate = Math.min(100, Math.max(0, n));
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
    TakeoffLaborBookMerge.recordRemoved(laborBookRemoved, type, section, name);
  }

  // …and the mirror: the row is back (renamed back, or added again under the
  // old name), so the removal stops being true on both maps.
  function noteRestoredDefault(type, section, name) {
    if (!name) return;
    TakeoffLaborBookMerge.unrecordRemoved(laborBookRemoved, type, section, name);
    TakeoffLaborBookMerge.unrecordRemoved(laborBookRemovedLegacy, type, section, name);
    TakeoffLaborBookMerge.unrecordRemoved(laborBookRelocated, type, section, name);
  }

  // The shipped row of that name, if any — used to tell a real edit from a
  // row whose values have drifted back to the default.
  function shippedDefaultRow(type, section, name) {
    return LABOR_BOOK_DEFAULTS[type]?.[section]?.find((d) => d.name === name) || null;
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
      if (!r.priceSource) r.priceSource = HAND_PRICED;
    }
    // adding back a default the user had deleted cancels the removal, and the
    // row is a default again rather than a "new part" (J12-F2)
    const def = shippedDefaultRow(type, section, r.name);
    if (def) {
      noteRestoredDefault(type, section, r.name);
      delete r.userAdded;
      if (!TakeoffLaborBookMerge.rowsEqual(r, def)) r.edited = true;
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

  /**
   * Apply an edit to one book row. Money is parsed here, once, for every
   * caller (TakeoffUtils.parseMoney): '$21,450.75' becomes 21450.75 rather
   * than riding into the book — and onto the bid — as text that every
   * number input renders blank. Text that is not money is REJECTED: the row
   * is left unpriced and no provenance is stamped, so nothing looks priced
   * that isn't. Returns { priceRejected } so the view can flag the field
   * and keep what was typed on screen.
   */
  function updateLaborBookRow(type, section, index, updates) {
    const row = laborBook[type]?.[section]?.[index];
    if (!row) return { priceRejected: false };
    let priceRejected = false;
    if ('price' in updates) {
      const parsed = TakeoffUtils.parseMoney(updates.price);
      priceRejected = Number.isNaN(parsed);
      updates = { ...updates, price: parsed == null || priceRejected ? '' : String(parsed) };
      // a rejected price must not carry provenance with it
      if (priceRejected) {
        delete updates.priceSource;
        delete updates.pricedAt;
      }
    }
    if (typeof updates.name === 'string' && updates.name !== row.name && !row.userAdded) {
      noteRemovedDefault(type, section, row.name);
      // renamed back onto a default the user had renamed away from: the
      // removal is no longer true (J12-F2)
      noteRestoredDefault(type, section, updates.name);
    }
    const priceChanged = 'price' in updates && String(updates.price ?? '') !== String(row.price ?? '');
    const valueChanged =
      priceChanged ||
      ('name' in updates && updates.name !== row.name) ||
      ('labor' in updates && (Number(updates.labor) || 0) !== (Number(row.labor) || 0)) ||
      ('partNumber' in updates && (updates.partNumber || '') !== (row.partNumber || ''));
    const clearedPrice = priceChanged && String(updates.price ?? '') === '';
    Object.assign(row, updates);
    // a changed price is stamped with who/when unless the caller supplied it —
    // never for a rejected price, which leaves the row unpriced
    if (priceChanged && !priceRejected && !clearedPrice) {
      const handPriced = !('priceSource' in updates);
      if (handPriced) row.priceSource = HAND_PRICED;
      if (!('pricedAt' in updates)) row.pricedAt = todayISO();
      // Typing in the Price cell is the commonest way a price is entered and
      // it used to leave no trail at all: record it as a real offer and a
      // history line, like any other price on this part.
      if (handPriced) noteHandPrice(row, Number(row.price), row.pricedAt);
    }
    // a price cleared away is not a price recorded today: drop the provenance
    // with it so the row goes back to the quiet "+ price" ghost instead of
    // wearing a fresh green badge over an empty field
    if (clearedPrice && !('priceSource' in updates) && !('pricedAt' in updates)) {
      delete row.priceSource;
      delete row.pricedAt;
    }
    // provenance-only updates must not set `edited` — that would freeze the
    // row out of future defaults upgrades (laborBookMerge skips edited rows)
    if (valueChanged && !row.userAdded) {
      // …and a row typed back to the shipped values is not an edit at all:
      // leaving the flag on freezes it out of every future improvement and
      // proposes the old default as a correction (J12-F3)
      const def = shippedDefaultRow(type, section, row.name);
      if (def && TakeoffLaborBookMerge.rowsEqual(row, def)) delete row.edited;
      else row.edited = true;
    }
    schedulePersistBook();
    return { priceRejected };
  }

  // ---------- part offers & history (the "part card") ----------

  const PART_HISTORY_CAP = 50;

  // The source of a price somebody typed in rather than got from a supply
  // house. It sits in the offers list beside the real quotes so the trail is
  // complete, but it is not a supply house and never wins over a real quote.
  const HAND_PRICED = 'You';

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

  // A price typed straight into the row: one real offer, one history line.
  function noteHandPrice(row, amount, at) {
    if (!Number.isFinite(amount)) return;
    if (!row.offers) row.offers = [];
    const who = currentUserName();
    const existing = row.offers.find((o) => o.supplier === HAND_PRICED);
    if (existing) {
      existing.price = amount;
      existing.at = at;
      existing.by = who;
    } else {
      row.offers.push({ supplier: HAND_PRICED, price: amount, at, by: who });
    }
    pushPartHistory(row, { at, kind: 'price', supplier: HAND_PRICED, value: amount, by: who });
  }

  /**
   * Record a supply-house quote on a row: updates that supplier's offer,
   * appends to history, and moves the working price when `use` is set, when
   * the supplier is already the one in use, or when this is the first quote a
   * person has recorded on the row (an imported catalog price is the vendor's
   * number, not a quote — first-quote-wins has to survive promotion).
   *
   * `at` omitted means today; `at: ''` or null means "no date recorded", which
   * is a real answer — a quote from "last month sometime" is common, and the
   * badge has a tier for it.
   */
  function recordPartPrice(type, section, index, { supplier, price, at, by, use }) {
    const row = laborBook[type]?.[section]?.[index];
    if (!row || !supplier) return { priceRejected: false };
    // a quote is money or it is nothing: never record text as an offer
    const amount = TakeoffUtils.parseMoney(price);
    if (amount == null || Number.isNaN(amount)) return { priceRejected: true };
    const when = at === undefined ? todayISO() : at || null;
    const who = by || currentUserName();
    if (!row.offers) row.offers = [];
    const existing = row.offers.find((o) => o.supplier.toLowerCase() === supplier.toLowerCase());
    // one canonical spelling per supply house: offers merge case-insensitively,
    // so "summit electric" must not ride onto the row's badge beside the
    // table's "Summit Electric"
    const canonical = existing ? existing.supplier : supplier;
    if (existing) {
      existing.price = amount;
      existing.at = when;
      existing.by = who;
    } else {
      row.offers.push({ supplier: canonical, price: amount, at: when, by: who });
    }
    pushPartHistory(row, { at: when, kind: 'price', supplier: canonical, value: amount, by: who });
    const inUse = (row.priceSource || '').toLowerCase() === supplier.toLowerCase();
    // "first quote wins": true until a real supply-house quote is on the row.
    // A catalog import and a hand-typed price are not quotes, so a promoted
    // catalog part still takes the estimator's first quote as its price.
    const noRealQuoteYet = row.offers.every(
      (o) => o.by === 'import' || o.supplier === HAND_PRICED || o.supplier.toLowerCase() === supplier.toLowerCase()
    );
    if (use || inUse || noRealQuoteYet) {
      updateLaborBookRow(type, section, index, { price: String(amount), priceSource: canonical, pricedAt: when });
    } else {
      schedulePersistBook();
    }
    return { priceRejected: false };
  }

  /**
   * Correct where a price came from without re-recording the price: the date
   * a quote actually carries ('' → no date), or the supply house's name spelt
   * right. The row follows the offer it is using, and the history lines for
   * that supplier take the corrected spelling so one part can't show two.
   * Provenance-only, so it deliberately does not mark the row `edited`.
   */
  function updatePartOffer(type, section, index, supplier, updates) {
    const row = laborBook[type]?.[section]?.[index];
    const offer = row?.offers?.find((o) => o.supplier.toLowerCase() === (supplier || '').toLowerCase());
    if (!offer) return;
    const before = offer.supplier;
    if ('at' in updates) offer.at = updates.at || null;
    if (typeof updates.supplier === 'string' && updates.supplier.trim()) offer.supplier = updates.supplier.trim();
    if ((row.priceSource || '').toLowerCase() === before.toLowerCase()) {
      row.priceSource = offer.supplier;
      row.pricedAt = offer.at;
    }
    for (const h of row.history || []) {
      if ((h.supplier || '').toLowerCase() === before.toLowerCase()) h.supplier = offer.supplier;
    }
    schedulePersistBook();
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
    const all = TakeoffLaborBookMerge.computeCorrections(laborBook, LABOR_BOOK_DEFAULTS, laborBookRemoved);
    // A catalog part copied into the book is marked userAdded, so the diff
    // reads it as a brand-new part and the shared book learns the supply
    // house's own price back — usually with no hours at all. It waits here
    // until somebody quotes it or puts hours on it (js/cloudSync.js).
    const list = all.filter((c) => {
      const row = (laborBook[c.tab]?.[c.section] || []).find((r) => r && r.name === c.name);
      return !TakeoffCloudSync.isUnquotedPromotion(row);
    });
    // updateLaborBookRow parses money on the way in, but a workspace saved
    // before that fix can still hold '$21,450.75' as text. Never let one ride
    // into the shared book: an unparseable price shares as no price at all.
    for (const c of list) {
      for (const side of ['old', 'new']) {
        if (!c[side] || !('price' in c[side])) continue;
        const n = TakeoffUtils.parseMoney(c[side].price);
        c[side].price = Number.isFinite(n) ? String(n) : '';
      }
    }
    return list;
  }

  /**
   * The rows a defaults upgrade rewrote at boot, once. js/cloud.js reads it
   * to show "the shared book moved" with the row names in it; a second call
   * returns null, so the line is shown once per upgrade, not once per render.
   */
  function takeBookUpdate() {
    const u = bookUpdate;
    bookUpdate = null;
    return u;
  }

  // --- Computed views (pure logic lives in TakeoffSelectors) ---

  function getTotalLabor() {
    return TakeoffSelectors.getTotalLabor(manifest);
  }

  function getPurchaseList() {
    return TakeoffSelectors.getPurchaseList(manifest);
  }

  function getFlattenedItems() {
    return TakeoffSelectors.getFlattenedItems(manifest);
  }

  function getSummaryBreakdown() {
    return TakeoffSelectors.getSummaryBreakdown(manifest, taxRate);
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
    getUndoDepth,
    getAssemblies,
    addAssembly,
    renameAssembly,
    updateAssembly,
    removeAssembly,
    setAssemblies,
    getTotalLabor,
    getFlattenedItems,
    getPurchaseList,
    getSummaryBreakdown,
    generateId,
    getLaborRate,
    setLaborRate,
    getTaxRate,
    setTaxRate,
    LEGACY_TAX_RATE,
    setPlansUrl,
    clearManifestHistory,
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
    updatePartOffer,
    HAND_PRICED,
    recordPartLabor,
    promoteCatalogPart,
    refreshSupplierOffers,
    getBookCorrections,
    takeBookUpdate,
    getProjects,
    getCurrentProject,
    setProjectName,
    getProjectDetails,
    setProjectDetails,
    getProjectImportedFrom,
    findImportedProject,
    uniqueProjectName,
    switchProject,
    createProject,
    duplicateProject,
    deleteProject,
    isProjectArchived,
    setProjectArchived,
    reconcileArchivedEntry,
    getActiveLaborBookTab,
    setActiveLaborBookTab,
  };
})();
