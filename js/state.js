/**
 * Manifest state management for Takeoff Tooling
 */

const TakeoffState = (function () {
  const ITEM_TYPES = ['lighting', 'gear', 'devices', 'conduit', 'wire', 'specialSystems'];

  let manifest = [];
  let currentView = 'manifest'; // 'manifest' | 'device' | 'conduit' | 'wire'
  let currentItemId = null;
  let modalItemId = null;
  let conduitStep = 1; // 1: trenching, 2: fittings, 3: overage
  let conduitTempData = {};
  let deviceTempData = { boxes: [], covers: [] };
  let wireTempData = { overagePercent: null, macAdapters: [] };
  let showRemoveIcons = false;

  function generateId() {
    return 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  }

  function getManifest() {
    return manifest;
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

  function addItem(item) {
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
    deviceTempData = { boxes: [], covers: [] };
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

  function getTotalLabor() {
    function sumLabor(items) {
      let total = 0;
      for (const item of items) {
        total += (item.labor || 0) * 0.1;
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

  return {
    ITEM_TYPES,
    getManifest,
    getTopLevelItems,
    getItemById,
    getParentItem,
    addItem,
    updateItem,
    removeItem,
    setType,
    setCurrentView,
    getCurrentView,
    getCurrentItemId,
    setModalItemId,
    getModalItemId,
    setConduitStep,
    getConduitStep,
    setConduitTempData,
    getConduitTempData,
    clearConduitTempData,
    setDeviceTempData,
    getDeviceTempData,
    clearDeviceTempData,
    setWireTempData,
    getWireTempData,
    clearWireTempData,
    getTotalLabor,
    getTotalPrice,
    getFlattenedItems,
    generateId,
    getShowRemoveIcons,
    setShowRemoveIcons,
    toggleShowRemoveIcons,
  };
})();
