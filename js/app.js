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
    TakeoffState.clearLaborBookExpandGroup();
    TakeoffState.setLaborBookPreselectedItemId(itemId || null);
    const modal = document.getElementById('labor-book-modal');
    modal.setAttribute('aria-hidden', 'false');
    TakeoffLaborBookView.render();
    TakeoffLaborBookView.attachListeners();
  }

  function showLaborBookModalForDeviceRow(section, index) {
    TakeoffState.setLaborBookPreselectedItemId(null);
    TakeoffState.setLaborBookTargetDeviceRow({ section, index });
    TakeoffState.clearLaborBookExpandGroup();
    const modal = document.getElementById('labor-book-modal');
    modal.setAttribute('aria-hidden', 'false');
    TakeoffLaborBookView.render();
    TakeoffLaborBookView.attachListeners();
  }

  function showLaborBookModalForConduitFittings(itemId) {
    TakeoffState.clearLaborBookTargetDeviceRow();
    TakeoffState.setLaborBookPreselectedItemId(itemId || null);
    TakeoffState.setActiveLaborBookTab('conduit');
    TakeoffState.setLaborBookExpandGroup('Fittings');
    const modal = document.getElementById('labor-book-modal');
    modal.setAttribute('aria-hidden', 'false');
    TakeoffLaborBookView.render();
    TakeoffLaborBookView.attachListeners();
  }

  function hideLaborBookModal() {
    const modal = document.getElementById('labor-book-modal');
    if (modal?.contains(document.activeElement)) {
      document.activeElement?.blur();
    }
    TakeoffState.clearLaborBookPreselectedItemId();
    TakeoffState.clearLaborBookTargetDeviceRow();
    TakeoffState.clearLaborBookExpandGroup();
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
    const children = item?.children || [];
    const outletsAndSwitches = children.filter((c) => c.type === 'outletsAndSwitches');
    const boxes = children.filter((c) => c.type === 'box' || (c.description || '').toLowerCase().includes('box'));
    const backBoxSupport = children.filter((c) => c.type === 'backBoxSupport' || (c.description || '').toLowerCase().includes('back box support'));
    const covers = children.filter((c) => c.type === 'cover' || (c.description || '').toLowerCase().includes('cover'));
    const conduit = children.filter((c) => c.type === 'conduit');
    const wire = children.filter((c) => c.type === 'wire');
    const screws = children.filter((c) => c.type === 'screws');
    const misc = children.filter((c) => c.type === 'misc');
    const hasParentDesc = (item?.description || '').trim().length > 0;
    const parentQty = hasParentDesc ? 1 : (item?.quantity ?? 0);
    const toRows = (arr) => (arr.length ? arr.map((x) => ({ description: x.description, quantity: x.quantity, labor: x.labor, price: x.price ?? '' })) : [{ description: '', quantity: parentQty, labor: 0, price: '' }]);
    TakeoffState.setDeviceTempData({
      outletsAndSwitches: toRows(outletsAndSwitches),
      boxes: toRows(boxes),
      backBoxSupport: toRows(backBoxSupport),
      covers: toRows(covers),
      conduit: toRows(conduit),
      wire: toRows(wire),
      screws: toRows(screws),
      misc: toRows(misc),
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
    showLaborBookModalForConduitFittings,
    hideLaborBookModal,
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

  // Export via link
  document.getElementById('export-link-btn')?.addEventListener('click', async () => {
    const manifest = TakeoffState.getManifest();
    const json = JSON.stringify(manifest);
    const base64 = btoa(unescape(encodeURIComponent(json)));
    const url = window.location.origin + window.location.pathname + '#d=' + base64;
    try {
      await navigator.clipboard.writeText(url);
      const btn = document.getElementById('export-link-btn');
      const orig = btn?.textContent;
      if (btn) btn.textContent = 'Link copied!';
      setTimeout(() => { if (btn) btn.textContent = orig || 'Export via link'; }, 2000);
    } catch (err) {
      alert('Could not copy link. Try selecting and copying manually.');
    }
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

  // Cache clear and hard reload
  document.getElementById('cache-clear-reload-btn')?.addEventListener('click', async () => {
    localStorage.removeItem('takeoff-assemblies');
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    window.location.replace(window.location.pathname + window.location.search);
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

  // Load from export link (hash)
  const hash = window.location.hash;
  if (hash && hash.startsWith('#d=')) {
    try {
      const base64 = hash.slice(3);
      const json = decodeURIComponent(escape(atob(base64)));
      const data = JSON.parse(json);
      if (TakeoffState.loadManifestFromExport(data)) {
        window.history.replaceState(null, '', window.location.pathname);
      }
    } catch (_) {}
  }

  // Ensure at least one row exists on load
  if (TakeoffState.getTopLevelItems().length === 0) {
    TakeoffState.addItem({ type: null, description: '', quantity: 1, labor: 0, planPage: '', parentId: null });
  }

  // Initial render
  render();
})();
