/**
 * TakeoffUiState — ephemeral UI state, none of it persisted.
 *
 * Current view/routing ids, modal target, labor-book targeting (preselect /
 * device row / fill target / expand group), flow-editor temp buffers, and
 * display toggles. Independent of the manifest; TakeoffState re-exports this
 * API so callers see one facade. Loaded before js/state.js.
 */

const TakeoffUiState = (function () {
  let currentView = 'manifest'; // 'manifest' | 'device' | 'conduit' | 'wire'
  let currentItemId = null;
  let modalItemId = null;
  let conduitStep = 1; // 1: trenching, 2: fittings, 3: overage
  let conduitTempData = {};
  let deviceTempData = { outletsAndSwitches: [], boxes: [], backBoxSupport: [], covers: [], conduit: [], wire: [], screws: [], misc: [] };
  let wireTempData = { overagePercent: null, macAdapters: [] };
  let showRemoveIcons = false;
  let showPrintOptions = false;

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

  function getShowPrintOptions() {
    return showPrintOptions;
  }

  function toggleShowPrintOptions() {
    showPrintOptions = !showPrintOptions;
    return showPrintOptions;
  }

  return {
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
    setLaborBookFillTarget,
    getLaborBookFillTarget,
    clearLaborBookFillTarget,
    setLaborBookExpandGroup,
    getLaborBookExpandGroup,
    clearLaborBookExpandGroup,
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
    getShowRemoveIcons,
    setShowRemoveIcons,
    toggleShowRemoveIcons,
    getShowPrintOptions,
    toggleShowPrintOptions,
  };
})();
