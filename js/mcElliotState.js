/**
 * Persistence for the Elliot price-update flow: overlay, confirmed mappings,
 * review queue. Compact deltas only — never the whole Elliot file.
 */

const McElliotState = (function () {
  const OVERLAY_KEY = 'mc-elliot-overlay';
  const MAPPINGS_KEY = 'mc-elliot-mappings';
  const QUEUE_KEY = 'mc-elliot-review-queue';
  const MAX_BYTES = 2500000;

  let repoMappings = null; // from mc-assemblies/elliot-item-mappings.json
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
        repoMappings = res.ok ? (await res.json()).mappings || {} : {};
      } catch (_) {
        repoMappings = {};
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

  function setMapping(partNumber, itemNum) {
    const vendors = readVendorMappings();
    if (!vendors[currentVendor]) vendors[currentVendor] = {};
    vendors[currentVendor][partNumber] = itemNum;
    writeJson(MAPPINGS_KEY, { version: 2, vendors });
  }

  // ---------- overlay ----------

  function getOverlay() {
    return readJson(OVERLAY_KEY);
  }

  function saveOverlay(overlay) {
    const json = JSON.stringify(overlay);
    if (json.length > MAX_BYTES) {
      const slim = { ...overlay, newItems: [], newItemsTruncated: true };
      writeJson(OVERLAY_KEY, slim);
      return { saved: true, truncated: true };
    }
    return { saved: writeJson(OVERLAY_KEY, overlay), truncated: false };
  }

  function clearOverlay() {
    try {
      localStorage.removeItem(OVERLAY_KEY);
      localStorage.removeItem(QUEUE_KEY);
    } catch (_) {}
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
    if (JSON.stringify({ version: 1, queue: q }).length > MAX_BYTES) {
      q = q.slice(0, 2000);
    }
    writeJson(QUEUE_KEY, { version: 1, queue: q });
  }

  function resolveQueueItem(itemNum, partNumber, perEach) {
    const queue = getQueue().filter((q) => q.itemNum !== itemNum);
    saveQueue(queue);
    if (partNumber != null) {
      setMapping(partNumber, itemNum);
      const overlay = getOverlay();
      if (overlay) {
        overlay.itemPrices[itemNum] = perEach;
        saveOverlay(overlay);
      }
    }
    return queue.length;
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
      const overlay = getOverlay();
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
    getOverlay,
    saveOverlay,
    clearOverlay,
    hasOverlay,
    getQueue,
    saveQueue,
    resolveQueueItem,
  };
})();
