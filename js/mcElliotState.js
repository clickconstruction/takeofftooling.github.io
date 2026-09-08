/**
 * Persistence for the Elliot price-update flow: overlay, confirmed mappings,
 * review queue. Compact deltas only — never the whole Elliot file.
 */

const McElliotState = (function () {
  const OVERLAY_KEY = 'mc-elliot-overlay';
  const OVERLAY_ITEMS_KEY = 'mc-elliot-overlay-items'; // fallback when IndexedDB is unavailable
  const MAPPINGS_KEY = 'mc-elliot-mappings';
  const QUEUE_KEY = 'mc-elliot-review-queue';
  const QUEUE_MAX_BYTES = 2500000;
  const IDB_NAME = 'takeoff-elliot';
  const IDB_STORE = 'overlay';
  const IDB_ITEMS_KEY = 'newItems';

  let repoMappings = null; // from mc-assemblies/elliot-item-mappings.json
  let repoSkipped = null; // MC items the published file says not to ask about
  let priceModel = null;
  let categoryMapping = null;
  let vendorProfiles = null; // from mc-assemblies/vendor-profiles.json

  function readJson(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.warn('McElliotState: could not persist', key, err);
      return false;
    }
  }

  // ---------- IndexedDB (the supplier parts list is far too big for localStorage) ----------

  function openDb() {
    return new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      let req;
      try {
        req = indexedDB.open(IDB_NAME, 1);
      } catch (_) {
        resolve(null);
        return;
      }
      req.onupgradeneeded = () => {
        try {
          if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE);
        } catch (_) {}
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
  }

  function idbRun(mode, fn) {
    return openDb().then(
      (db) =>
        new Promise((resolve) => {
          if (!db) {
            resolve(undefined);
            return;
          }
          let tx;
          try {
            tx = db.transaction(IDB_STORE, mode);
          } catch (_) {
            resolve(undefined);
            return;
          }
          let value;
          const req = fn(tx.objectStore(IDB_STORE));
          if (req) {
            req.onsuccess = () => {
              value = req.result;
            };
          }
          tx.oncomplete = () => resolve(req ? value : true);
          tx.onerror = () => resolve(undefined);
          tx.onabort = () => resolve(undefined);
        })
    );
  }

  // ---------- lazy-loaded reference data ----------

  async function loadReferenceData() {
    if (!priceModel) {
      const res = await fetch('mc-assemblies/mc-price-model.json');
      if (!res.ok) throw new Error('Could not load mc-price-model.json (HTTP ' + res.status + ')');
      priceModel = await res.json();
    }
    if (!repoMappings) {
      try {
        const res = await fetch('mc-assemblies/elliot-item-mappings.json');
        const doc = res.ok ? await res.json() : {};
        repoMappings = doc.mappings || {};
        repoSkipped = Array.isArray(doc.skipped) ? doc.skipped.map(Number) : [];
      } catch (_) {
        repoMappings = {};
        repoSkipped = [];
      }
    }
    if (!categoryMapping) {
      const res = await fetch('mc-assemblies/elliot-category-mapping.json');
      categoryMapping = res.ok ? (await res.json()).mapping || {} : {};
    }
    if (!vendorProfiles) {
      try {
        const res = await fetch('mc-assemblies/vendor-profiles.json');
        vendorProfiles = res.ok ? (await res.json()).vendors || {} : {};
      } catch (_) {
        vendorProfiles = {};
      }
      if (!vendorProfiles.elliot && typeof McElliotCore !== 'undefined') {
        vendorProfiles.elliot = McElliotCore.ELLIOT_PROFILE;
      }
    }
    return { priceModel, repoMappings, categoryMapping, vendorProfiles };
  }

  function getVendorProfiles() {
    return vendorProfiles || {};
  }

  function getPriceModel() {
    return priceModel;
  }

  const CATEGORY_OVERRIDES_KEY = 'mc-elliot-category-overrides';

  /** Repo mapping merged with locally-chosen destinations (local wins). */
  function getCategoryMapping() {
    if (!categoryMapping) return categoryMapping;
    const overrides = readJson(CATEGORY_OVERRIDES_KEY) || {};
    return { ...categoryMapping, ...overrides };
  }

  function setCategoryOverride(category, tabOrNull) {
    const overrides = readJson(CATEGORY_OVERRIDES_KEY) || {};
    overrides[category] = tabOrNull;
    writeJson(CATEGORY_OVERRIDES_KEY, overrides);
  }

  // ---------- mappings (repo ∪ local, local wins; namespaced per vendor) ----------

  let currentVendor = 'elliot';

  function setCurrentVendor(vendor) {
    if (vendor) currentVendor = vendor;
  }

  function getCurrentVendor() {
    return currentVendor;
  }

  function readVendorMappings() {
    const data = readJson(MAPPINGS_KEY) || {};
    if (data.vendors) return data.vendors;
    // migrate v1 flat shape (pre-vendor era: all mappings were Elliot's)
    if (data.mappings) return { elliot: data.mappings };
    return {};
  }

  function getLocalMappings() {
    return readVendorMappings()[currentVendor] || {};
  }

  function getEffectiveMappings() {
    // the committed repo file holds Elliot's confirmed matches
    const repo = currentVendor === 'elliot' ? repoMappings || {} : {};
    return { ...repo, ...getLocalMappings() };
  }

  function writeMappingsDoc(vendors, skipped) {
    writeJson(MAPPINGS_KEY, { version: 2, vendors, skipped });
  }

  function setMapping(partNumber, itemNum) {
    const vendors = readVendorMappings();
    if (!vendors[currentVendor]) vendors[currentVendor] = {};
    vendors[currentVendor][partNumber] = itemNum;
    writeMappingsDoc(vendors, readSkippedDoc());
  }

  // ---------- "not this" decisions ----------
  //
  // Passing on a row is half of every review decision, and it has to survive
  // the next upload or the list can never be finished. A pass is recorded
  // against the MC item (there is no supplier part to key it on), alongside
  // the confirmed matches and shipped in the same file.

  function readSkippedDoc() {
    const data = readJson(MAPPINGS_KEY) || {};
    return data.skipped && typeof data.skipped === 'object' ? data.skipped : {};
  }

  function getLocalSkipped() {
    const list = readSkippedDoc()[currentVendor];
    return Array.isArray(list) ? list.map(Number) : [];
  }

  /** MC item numbers to leave out of the review list (published ∪ local). */
  function getSkippedItems() {
    const repo = currentVendor === 'elliot' ? repoSkipped || [] : [];
    return new Set(repo.concat(getLocalSkipped()));
  }

  function addSkipped(itemNums) {
    const wanted = (Array.isArray(itemNums) ? itemNums : [itemNums]).map(Number).filter((n) => !Number.isNaN(n));
    if (!wanted.length) return;
    const skipped = readSkippedDoc();
    const merged = new Set((Array.isArray(skipped[currentVendor]) ? skipped[currentVendor] : []).map(Number));
    for (const n of wanted) merged.add(n);
    skipped[currentVendor] = Array.from(merged).sort((a, b) => a - b);
    writeMappingsDoc(readVendorMappings(), skipped);
  }

  // ---------- overlay ----------
  //
  // Two documents, because they are two different sizes: the small part
  // (prices, categories, counts) stays in localStorage and is read and
  // written synchronously; the supplier parts list — tens of thousands of
  // rows, megabytes of it — lives in IndexedDB and is loaded on demand.
  // Nothing the estimator does re-writes the big one.

  let itemsCache = null; // the array as last read from / written to storage
  let itemsLoaded = false;

  function countCategories(items) {
    const counts = {};
    for (const [cat] of items || []) counts[cat] = (counts[cat] || 0) + 1;
    return counts;
  }

  /** The overlay's small half, plus the parts list when it is already loaded. */
  function getOverlay() {
    const base = readJson(OVERLAY_KEY);
    if (!base) return null;
    if (Array.isArray(base.newItems) && base.newItems.length) {
      // overlay written before the parts list moved out of localStorage
      itemsCache = base.newItems;
      itemsLoaded = true;
      return base;
    }
    if (itemsLoaded && itemsCache) return { ...base, newItems: itemsCache };
    return base;
  }

  /** Load the supplier parts list (IndexedDB, or the localStorage fallback). */
  async function loadOverlayItems() {
    if (itemsLoaded) return itemsCache;
    const base = readJson(OVERLAY_KEY);
    if (!base) {
      itemsLoaded = true;
      itemsCache = null;
      return null;
    }
    if (Array.isArray(base.newItems) && base.newItems.length) {
      itemsCache = base.newItems;
      itemsLoaded = true;
      return itemsCache;
    }
    let items = null;
    const stored = await idbRun('readonly', (store) => store.get(IDB_ITEMS_KEY));
    if (stored && Array.isArray(stored.items)) items = stored.items;
    if (!items) {
      const fallback = readJson(OVERLAY_ITEMS_KEY);
      if (fallback && Array.isArray(fallback.items)) items = fallback.items;
    }
    itemsCache = items;
    itemsLoaded = true;
    return items;
  }

  let publishedOverlay; // undefined = not fetched yet, null = not available

  /**
   * What these parts cost last time, for keeping their price dates: the file
   * loaded on this computer if there is one, otherwise the published file the
   * book already ships. Without the published fallback the first import on a
   * machine stamps every unchanged part with today, and "priced 50 days ago"
   * becomes "priced today" for 27,556 parts whose price never moved.
   */
  async function getPriorPricedParts() {
    const local = await getFullOverlay();
    if (local && Array.isArray(local.newItems) && local.newItems.length) return local;
    if (publishedOverlay === undefined) {
      try {
        const res = await fetch('mc-assemblies/elliot-price-overlay.json');
        publishedOverlay = res.ok ? await res.json() : null;
      } catch (_) {
        publishedOverlay = null;
      }
    }
    return publishedOverlay;
  }

  /** The whole overlay, parts list included. */
  async function getFullOverlay() {
    const base = readJson(OVERLAY_KEY);
    if (!base) return null;
    const items = await loadOverlayItems();
    return items ? { ...base, newItems: items } : base;
  }

  /**
   * Save the overlay's small half. The parts list is written separately by
   * saveNewItems, so a Match or a category change can never rewrite (or
   * lose) the catalog.
   */
  function saveOverlay(overlay) {
    const base = { ...overlay };
    const items = Array.isArray(overlay.newItems) ? overlay.newItems : null;
    delete base.newItems;
    delete base.newItemsTruncated;
    if (items) {
      base.newItemsCount = items.length;
      base.categoryCounts = countCategories(items);
    }
    return { saved: writeJson(OVERLAY_KEY, base) };
  }

  /**
   * Persist the supplier parts list. Returns {stored} — false means this
   * browser refused the write, in which case the overlay is flagged so the
   * book keeps the parts already published instead of losing them.
   */
  async function saveNewItems(items) {
    const list = Array.isArray(items) ? items : [];
    itemsCache = list.length ? list : null;
    itemsLoaded = true;
    if (!list.length) {
      await clearNewItems();
      return { stored: true };
    }
    const ok = await idbRun('readwrite', (store) => store.put({ version: 1, items: list }, IDB_ITEMS_KEY));
    let stored = ok !== undefined;
    if (!stored) stored = writeJson(OVERLAY_ITEMS_KEY, { version: 1, items: list });
    else {
      try {
        localStorage.removeItem(OVERLAY_ITEMS_KEY);
      } catch (_) {}
    }
    const base = readJson(OVERLAY_KEY);
    if (base) {
      if (stored) delete base.newItemsIncomplete;
      else base.newItemsIncomplete = true;
      writeJson(OVERLAY_KEY, base);
    }
    if (!stored) {
      itemsCache = null;
      itemsLoaded = true;
    }
    return { stored };
  }

  async function clearNewItems() {
    await idbRun('readwrite', (store) => store.delete(IDB_ITEMS_KEY));
    try {
      localStorage.removeItem(OVERLAY_ITEMS_KEY);
    } catch (_) {}
  }

  /** Remove the local price file. The review list and saved matches stay. */
  function clearOverlay() {
    try {
      localStorage.removeItem(OVERLAY_KEY);
    } catch (_) {}
    itemsCache = null;
    itemsLoaded = true;
    clearNewItems();
  }

  function hasOverlay() {
    try {
      return localStorage.getItem(OVERLAY_KEY) !== null;
    } catch (_) {
      return false;
    }
  }

  // ---------- review queue ----------

  function getQueue() {
    return (readJson(QUEUE_KEY) || {}).queue || [];
  }

  function saveQueue(queue) {
    let q = queue;
    if (JSON.stringify({ version: 1, queue: q }).length > QUEUE_MAX_BYTES) {
      q = q.slice(0, 2000);
    }
    writeJson(QUEUE_KEY, { version: 1, queue: q });
  }

  /**
   * Take a decision off the review list. A confirmed match moves the part
   * number to this item — including away from whatever item held it before,
   * so one supplier part never prices two MC items.
   * Returns {remaining, tookFrom} (tookFrom = the item that lost the part).
   */
  function resolveQueueItem(itemNum, partNumber, perEach) {
    const { remaining, tookFrom } = resolveQueueItems([{ itemNum, partNumber, perEach }]);
    return { remaining, tookFrom: tookFrom.length ? tookFrom[0].tookFrom : null };
  }

  /**
   * Apply several review decisions in one pass: one queue write, one mapping
   * write, one overlay write — so a bulk confirmation costs the same as a
   * single one. A decision with partNumber === null is a pass ("not this"),
   * remembered so the row does not come back on the next upload.
   * Returns {remaining, matched, skipped, tookFrom: [{itemNum, tookFrom}]}.
   */
  function resolveQueueItems(decisions) {
    const list = (decisions || []).filter((d) => d && d.itemNum != null);
    if (!list.length) return { remaining: getQueue().length, matched: 0, skipped: 0, tookFrom: [] };
    const done = new Set(list.map((d) => Number(d.itemNum)));
    const queue = getQueue().filter((q) => !done.has(Number(q.itemNum)));
    saveQueue(queue);

    const vendors = readVendorMappings();
    if (!vendors[currentVendor]) vendors[currentVendor] = {};
    const skippedDoc = readSkippedDoc();
    const passes = new Set((Array.isArray(skippedDoc[currentVendor]) ? skippedDoc[currentVendor] : []).map(Number));
    const effective = getEffectiveMappings();
    const overlay = getOverlay();
    const tookFrom = [];
    let matched = 0;
    let skipped = 0;

    for (const d of list) {
      const itemNum = Number(d.itemNum);
      if (d.partNumber == null) {
        passes.add(itemNum);
        skipped++;
        continue;
      }
      matched++;
      const previous = effective[d.partNumber];
      const lost = previous !== undefined && Number(previous) !== itemNum ? Number(previous) : null;
      if (lost != null) tookFrom.push({ itemNum, tookFrom: lost });
      vendors[currentVendor][d.partNumber] = itemNum;
      effective[d.partNumber] = itemNum;
      // a confirmed match un-skips the item: the maintainer just answered it
      passes.delete(itemNum);
      if (overlay) {
        overlay.itemPrices[itemNum] = d.perEach;
        overlay.itemPartNumbers = overlay.itemPartNumbers || {};
        overlay.itemPartNumbers[itemNum] = d.partNumber;
        if (lost != null) {
          delete overlay.itemPrices[lost];
          delete overlay.itemPartNumbers[lost];
        }
      }
    }

    skippedDoc[currentVendor] = Array.from(passes).sort((a, b) => a - b);
    writeMappingsDoc(vendors, skippedDoc);
    if (matched && overlay) saveOverlay(overlay);
    return { remaining: queue.length, matched, skipped, tookFrom };
  }

  // ---------- recompute cache + book patching (used by McBook) ----------

  let recomputeCache = null; // { key, result }

  async function getRecompute() {
    const overlay = getOverlay();
    if (!overlay) return null;
    const key = overlay.importedAt + ':' + Object.keys(overlay.itemPrices || {}).length;
    if (recomputeCache && recomputeCache.key === key) return recomputeCache.result;
    const { priceModel: model } = await loadReferenceData();
    const result = McElliotCore.recomputeAssemblies(model, overlay.itemPrices || {});
    recomputeCache = { key, result };
    return result;
  }

  function invalidateRecompute() {
    recomputeCache = null;
  }

  /** Patch a freshly-fetched mc-labor-book.json with the local overlay, if any. */
  async function getPatchedBook(book) {
    if (!hasOverlay()) return book;
    try {
      const overlay = await getFullOverlay();
      const recompute = await getRecompute();
      await loadReferenceData();
      return McElliotCore.patchLaborBook(book, recompute, overlay, getCategoryMapping());
    } catch (err) {
      console.warn('McElliotState: overlay not applied —', err.message);
      return book;
    }
  }

  return {
    loadReferenceData,
    getRecompute,
    invalidateRecompute,
    getPatchedBook,
    getVendorProfiles,
    setCategoryOverride,
    setCurrentVendor,
    getCurrentVendor,
    getPriceModel,
    getCategoryMapping,
    getEffectiveMappings,
    setMapping,
    getLocalMappings,
    getSkippedItems,
    addSkipped,
    getOverlay,
    getFullOverlay,
    getPriorPricedParts,
    loadOverlayItems,
    saveOverlay,
    saveNewItems,
    clearOverlay,
    hasOverlay,
    getQueue,
    saveQueue,
    resolveQueueItem,
    resolveQueueItems,
  };
})();
