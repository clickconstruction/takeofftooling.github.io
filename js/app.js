/**
 * Takeoff Tooling - Main app entry and view switching
 */

(function () {
  const mainContent = document.getElementById('main-content');

  function render() {
    const view = TakeoffState.getCurrentView();
    const itemId = TakeoffState.getCurrentItemId();

    if (view === 'manifest') {
      mainContent.innerHTML = TakeoffManifestView.render();
      TakeoffManifestView.attachListeners();
    } else if (view === 'device' && itemId) {
      mainContent.innerHTML = TakeoffDeviceView.render(itemId);
      TakeoffDeviceView.attachListeners(itemId);
    } else if (view === 'conduit' && itemId) {
      mainContent.innerHTML = TakeoffConduitView.render(itemId);
      TakeoffConduitView.attachListeners(itemId);
    } else if (view === 'wire' && itemId) {
      mainContent.innerHTML = TakeoffWireView.render(itemId);
      TakeoffWireView.attachListeners(itemId);
    }
    updateUndoRedoButtons();
  }

  function updateUndoRedoButtons() {
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');
    if (undoBtn) undoBtn.disabled = !TakeoffState.canUndo();
    if (redoBtn) redoBtn.disabled = !TakeoffState.canRedo();
  }

  function showTypeModal(itemId) {
    TakeoffState.setModalItemId(itemId);
    const modal = document.getElementById('type-modal');
    modal.setAttribute('aria-hidden', 'false');
    TakeoffModal.attachListeners();
  }

  function hideTypeModal() {
    const modal = document.getElementById('type-modal');
    if (modal?.contains(document.activeElement)) {
      document.activeElement?.blur();
    }
    TakeoffState.setModalItemId(null);
    modal?.setAttribute('aria-hidden', 'true');
  }

  function showLaborBookModal(itemId) {
    TakeoffState.clearLaborBookTargetDeviceRow();
    TakeoffState.setLaborBookPreselectedItemId(itemId || null);
    const modal = document.getElementById('labor-book-modal');
    modal.setAttribute('aria-hidden', 'false');
    TakeoffLaborBookView.render();
    TakeoffLaborBookView.attachListeners();
  }

  function showLaborBookModalForDeviceRow(section, index) {
    TakeoffState.setLaborBookPreselectedItemId(null);
    TakeoffState.setLaborBookTargetDeviceRow({ section, index });
    const modal = document.getElementById('labor-book-modal');
    modal.setAttribute('aria-hidden', 'false');
    TakeoffLaborBookView.render();
    TakeoffLaborBookView.attachListeners();
  }

  function showMcPriceBookModal() {
    if (window.TakeoffMcPriceBookView) TakeoffMcPriceBookView.show();
  }

  function hideMcPriceBookModal() {
    if (window.TakeoffMcPriceBookView) TakeoffMcPriceBookView.hide();
  }

  function hideLaborBookModal() {
    const modal = document.getElementById('labor-book-modal');
    if (modal?.contains(document.activeElement)) {
      document.activeElement?.blur();
    }
    TakeoffState.clearLaborBookPreselectedItemId();
    TakeoffState.clearLaborBookTargetDeviceRow();
    modal?.setAttribute('aria-hidden', 'true');
  }

  function navigateToManifest() {
    TakeoffState.setCurrentView('manifest', null);
    TakeoffState.clearConduitTempData();
    TakeoffState.clearDeviceTempData();
    TakeoffState.clearWireTempData();
    TakeoffState.clearLaborBookTargetDeviceRow();
    render();
  }

  function navigateToDevice(itemId) {
    TakeoffState.setCurrentView('device', itemId);
    const item = TakeoffState.getItemById(itemId);
    const boxes = (item?.children || []).filter((c) => c.type === 'box' || (c.description || '').toLowerCase().includes('box'));
    const covers = (item?.children || []).filter((c) => c.type === 'cover' || (c.description || '').toLowerCase().includes('cover'));
    TakeoffState.setDeviceTempData({
      boxes: boxes.length ? boxes.map((b) => ({ description: b.description, quantity: b.quantity, labor: b.labor })) : [{ description: '', quantity: 0, labor: 0 }],
      covers: covers.length ? covers.map((c) => ({ description: c.description, quantity: c.quantity, labor: c.labor })) : [{ description: '', quantity: 0, labor: 0 }],
    });
    render();
  }

  function navigateToConduit(itemId) {
    TakeoffState.setCurrentView('conduit', itemId);
    const item = TakeoffState.getItemById(itemId);
    const children = item?.children || [];
    const trenching = children.find((c) => c.type === 'trenching' || (c.description || '').includes('Trenching'));
    const fittings = children.filter((c) => c.type === 'fitting');
    const overage = children.find((c) => c.type === 'overage' || (c.description || '').includes('overage'));

    let step = 1;
    let tempData = {};
    if (trenching) {
      tempData.trenching = { description: trenching.description, quantity: trenching.quantity, labor: trenching.labor };
      step = 2;
    }
    if (fittings.length) {
      tempData.fittings = fittings.map((f) => ({ description: f.description, quantity: f.quantity, labor: f.labor }));
      step = 2;
    } else if (step === 2 || trenching) {
      tempData.fittings = [{ description: '', quantity: 0, labor: 0 }];
      step = 2;
    }
    if (overage) {
      const match = (overage.description || '').match(/(\d+)%/);
      tempData.overagePercent = match ? parseInt(match[1], 10) : 0;
      step = 3;
    }
    TakeoffState.setConduitTempData(tempData);
    TakeoffState.setConduitStep(step);
    render();
  }

  function navigateToWire(itemId) {
    TakeoffState.setCurrentView('wire', itemId);
    const item = TakeoffState.getItemById(itemId);
    const children = item?.children || [];
    const overage = children.find((c) => c.type === 'overage');
    const macAdapters = children.filter((c) => c.type === 'macAdapter');
    const overageMatch = overage?.description?.match(/(\d+)%/);
    TakeoffState.setWireTempData({
      overagePercent: overageMatch ? parseInt(overageMatch[1], 10) : null,
      macAdapters: macAdapters.length ? macAdapters.map((m) => ({ description: m.description, quantity: m.quantity, labor: m.labor })) : [{ description: '', quantity: 0, labor: 0 }],
    });
    render();
  }

  // Expose for views
  window.TakeoffApp = {
    render,
    showTypeModal,
    hideTypeModal,
    showLaborBookModal,
    showLaborBookModalForDeviceRow,
    hideLaborBookModal,
    showMcPriceBookModal,
    hideMcPriceBookModal,
    navigateToManifest,
    navigateToDevice,
    navigateToConduit,
    navigateToWire,
  };

  // App title - navigate to manifest
  document.getElementById('app-title')?.addEventListener('click', () => {
    TakeoffApp.navigateToManifest();
  });

  // Import From Count Tooling
  document.getElementById('import-count-tooling-btn')?.addEventListener('click', () => {
    TakeoffImport.importFromClipboard();
  });

  // Undo
  document.getElementById('undo-btn')?.addEventListener('click', () => {
    if (TakeoffState.undo()) {
      TakeoffApp.navigateToManifest();
    }
  });

  // Redo
  document.getElementById('redo-btn')?.addEventListener('click', () => {
    if (TakeoffState.redo()) {
      TakeoffApp.navigateToManifest();
    }
  });

  // Header trash toggle
  document.getElementById('remove-toggle-btn')?.addEventListener('click', () => {
    TakeoffState.toggleShowRemoveIcons();
    document.getElementById('remove-toggle-btn')?.setAttribute('aria-pressed', TakeoffState.getShowRemoveIcons());
    document.getElementById('remove-toggle-btn')?.classList.toggle('active', TakeoffState.getShowRemoveIcons());
    if (TakeoffState.getCurrentView() === 'manifest') {
      render();
    }
  });

  // Form modal for Print with Form
  document.getElementById('form-modal-cancel')?.addEventListener('click', () => {
    const formModal = document.getElementById('form-modal');
    if (formModal?.contains(document.activeElement)) document.activeElement?.blur();
    formModal?.setAttribute('aria-hidden', 'true');
  });

  document.getElementById('form-modal-print')?.addEventListener('click', () => {
    const form = document.getElementById('form-details');
    const data = {
      address: form?.address?.value ?? '',
      permitNo: form?.permitNo?.value ?? '',
      builderOrOccupant: form?.builderOrOccupant?.value ?? '',
      electricalCount: form?.electricalCount?.value ?? '',
    };
    TakeoffPDF.printWithForm(data);
    const formModal = document.getElementById('form-modal');
    if (formModal?.contains(document.activeElement)) document.activeElement?.blur();
    formModal?.setAttribute('aria-hidden', 'true');
  });

  // Ensure at least one row exists on load
  if (TakeoffState.getTopLevelItems().length === 0) {
    TakeoffState.addItem({ type: null, description: '', quantity: 0, labor: 0, planPage: '', parentId: null });
  }

  // Initial render
  render();
})();
