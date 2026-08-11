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
    document.body.classList.add('lb-modal-open');
    TakeoffState.clearLaborBookTargetDeviceRow();
    TakeoffState.clearLaborBookExpandGroup();
    TakeoffState.setLaborBookPreselectedItemId(itemId || null);
    // open on the tab matching the item's type
    const itemType = itemId ? TakeoffState.getItemById(itemId)?.type : null;
    if (itemType && TakeoffState.getLaborBookTabOrder().includes(itemType)) {
      TakeoffState.setActiveLaborBookTab(itemType);
    }
    const modal = document.getElementById('labor-book-modal');
    modal.setAttribute('aria-hidden', 'false');
    TakeoffLaborBookView.render();
    TakeoffLaborBookView.attachListeners();
  }

  function showLaborBookModalForDeviceRow(section, index) {
    document.body.classList.add('lb-modal-open');
    TakeoffState.setLaborBookPreselectedItemId(null);
    TakeoffState.setLaborBookTargetDeviceRow({ section, index });
    TakeoffState.clearLaborBookExpandGroup();
    const modal = document.getElementById('labor-book-modal');
    modal.setAttribute('aria-hidden', 'false');
    TakeoffLaborBookView.render();
    TakeoffLaborBookView.attachListeners();
  }

  function showLaborBookModalForConduitFittings(itemId) {
    document.body.classList.add('lb-modal-open');
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
    TakeoffState.clearLaborBookFillTarget();
    modal?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('lb-modal-open');
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
    const boxes = children.filter((c) => c.type === 'box');
    const backBoxSupport = children.filter((c) => c.type === 'backBoxSupport');
    const covers = children.filter((c) => c.type === 'cover');
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

  // Prefer structured meta on the child item; fall back to parsing the display
  // string only for legacy items saved before meta existed.
  function overagePercentFrom(overage) {
    if (overage?.meta && typeof overage.meta.overagePercent === 'number') return overage.meta.overagePercent;
    const match = (overage?.description || '').match(/([\d.]+)%/);
    return match ? parseFloat(match[1]) : 0;
  }

  function navigateToConduit(itemId) {
    TakeoffState.setCurrentView('conduit', itemId);
    const item = TakeoffState.getItemById(itemId);
    const children = item?.children || [];
    const trenching = children.find((c) => c.type === 'trenching' || (c.description || '').includes('Trenching'));
    const trenchingAddons = children.filter((c) => c.type === 'trenchingAddon');
    const fittings = children.filter((c) => c.type === 'fitting');
    const overage = children.find((c) => c.type === 'overage' || (c.description || '').includes('overage'));

    let step = 1;
    let tempData = {};
    if (trenching) {
      tempData.trenching = { description: trenching.description, quantity: trenching.quantity, labor: trenching.labor };
      if (trenching.meta) {
        tempData.trenchQty = trenching.meta.feet ?? trenching.quantity ?? '';
        tempData.trenchMaterial = trenching.meta.material ?? '';
        tempData.trenchDepth = trenching.meta.depth ?? '';
        tempData.trenchPricePerFoot = trenching.meta.pricePerFoot ?? trenching.price ?? '';
      } else {
        // legacy: best-effort parse of "Trenching: {feet} - {material} @ {depth}"
        const m = (trenching.description || '').match(/^Trenching:\s*(.*?)\s*-\s*(.*?)\s*@\s*(.*)$/);
        tempData.trenchQty = trenching.quantity ?? '';
        tempData.trenchMaterial = m && m[2] !== 'N/A' ? m[2] : '';
        tempData.trenchDepth = m && m[3] !== 'N/A' ? m[3] : '';
        tempData.trenchPricePerFoot = trenching.price ?? '';
      }
      step = 2;
    }
    if (trenchingAddons.length) {
      tempData.trenchingAddons = trenchingAddons.map((a) => ({
        description: a.description,
        quantity: a.quantity,
        labor: a.labor,
        price: a.price ?? '',
      }));
    }
    if (fittings.length) {
      tempData.fittings = fittings.map((f) => ({ description: f.description, quantity: f.quantity, labor: f.labor, price: f.price ?? '' }));
      step = 2;
    } else if (step === 2 || trenching) {
      tempData.fittings = [{ description: '', quantity: 0, labor: 0, price: '' }];
      step = 2;
    }
    if (overage) {
      tempData.overagePercent = overagePercentFrom(overage);
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
    TakeoffState.setWireTempData({
      overagePercent: overage ? overagePercentFrom(overage) : null,
      macAdapters: macAdapters.length
        ? macAdapters.map((m) => ({ description: m.description, quantity: m.quantity, labor: m.labor, price: m.price ?? '' }))
        : [{ description: '', quantity: 0, labor: 0 }],
    });
    render();
  }

  // "PB" buttons: open the Labor & Price Book in FILL mode — + Add fills the
  // clicked row in place instead of adding children. (Replaces the old
  // standalone Part Book search.)
  function openLaborBookFill(target) {
    document.body.classList.add('lb-modal-open');
    TakeoffState.clearLaborBookTargetDeviceRow();
    TakeoffState.clearLaborBookExpandGroup();
    TakeoffState.setLaborBookPreselectedItemId(null);
    TakeoffState.setLaborBookFillTarget(target);
    const modal = document.getElementById('labor-book-modal');
    modal.setAttribute('aria-hidden', 'false');
    TakeoffLaborBookView.render();
    TakeoffLaborBookView.attachListeners();
    document.getElementById('labor-book-global-search')?.focus();
  }

  function showPartBookSearchForManifestItem(itemId) {
    openLaborBookFill({ kind: 'manifest-row', id: itemId });
  }

  function showPartBookSearchForDeviceRow(section, index) {
    openLaborBookFill({ kind: 'device-row', section, index });
  }

  function showPartBookSearchForConduitFitting(index) {
    openLaborBookFill({ kind: 'conduit-fitting', index });
  }

  function showPartBookSearchForWireMac(index) {
    openLaborBookFill({ kind: 'wire-mac', index });
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
    showPartBookSearchForManifestItem,
    showPartBookSearchForDeviceRow,
    showPartBookSearchForConduitFitting,
    showPartBookSearchForWireMac,
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

  // Header overflow menu (New Takeoff / Export via link / Remove items / Hard reload)
  const headerMenuBtn = document.getElementById('header-menu-btn');
  const headerMenu = document.getElementById('header-menu');
  function setHeaderMenuOpen(open) {
    headerMenu?.setAttribute('aria-hidden', String(!open));
    headerMenuBtn?.setAttribute('aria-expanded', String(open));
  }
  headerMenuBtn?.addEventListener('click', () => {
    setHeaderMenuOpen(headerMenu?.getAttribute('aria-hidden') !== 'false');
  });
  document.addEventListener('click', (e) => {
    if (headerMenu?.getAttribute('aria-hidden') === 'false' && !e.target.closest('.header-menu-wrap')) {
      setHeaderMenuOpen(false);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setHeaderMenuOpen(false);
  });
  // any menu action closes the menu (the item's own listener still runs);
  // export-link stays open so its "Link copied!" feedback is visible
  headerMenu?.addEventListener('click', (e) => {
    if (e.target.closest('.header-menu-item') && !e.target.closest('#export-link-btn')) {
      setHeaderMenuOpen(false);
    }
  });

  // Export via link (versioned envelope; import still accepts legacy bare arrays)
  document.getElementById('export-link-btn')?.addEventListener('click', async () => {
    const envelope = {
      v: 2,
      app: 'takeoff-tooling',
      exportedAt: new Date().toISOString(),
      manifest: TakeoffState.getManifest(),
    };
    const json = JSON.stringify(envelope);
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

  // New Takeoff: clear the manifest, keep the books
  document.getElementById('new-takeoff-btn')?.addEventListener('click', () => {
    const hasWork = TakeoffState.getTopLevelItems().some(
      (i) => (i.description || '').trim() || (i.children && i.children.length)
    );
    if (
      hasWork &&
      !confirm('Start a new takeoff? This clears the current manifest. Your Labor Book, assemblies, and labor rate are kept.')
    ) {
      return;
    }
    TakeoffState.loadManifestFromExport([]);
    TakeoffState.addItem({ type: null, description: '', quantity: 1, labor: 0, planPage: '', parentId: null });
    TakeoffState.persistNow();
    navigateToManifest();
  });

  // Cache clear and hard reload (code caches only — never user data)
  document.getElementById('cache-clear-reload-btn')?.addEventListener('click', async () => {
    TakeoffState.persistNow();
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    window.location.replace(window.location.pathname + window.location.search);
  });

  // Flush pending workspace saves before the page goes away
  window.addEventListener('beforeunload', () => {
    TakeoffState.persistNow();
  });

  // One-time cleanup: retired features (old Import MC triage, standalone Part Book)
  try {
    localStorage.removeItem('labor-book-import-progress');
    for (const key of ['part-book', 'part-book-elliot-mappings', 'part-book-unmatched', 'part-book-structure', 'part-book-category-mapping', 'part-book-create-destination']) {
      localStorage.removeItem(key);
    }
  } catch (_) {}

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
      const hasWork = TakeoffState.getTopLevelItems().some(
        (i) => (i.description || '').trim() || (i.children && i.children.length)
      );
      const proceed = !hasWork || confirm('Loading this link will replace your current takeoff. Continue?');
      if (proceed && TakeoffState.loadManifestFromExport(data)) {
        window.history.replaceState(null, '', window.location.pathname);
      } else if (!proceed) {
        window.history.replaceState(null, '', window.location.pathname);
      }
    } catch (err) {
      alert('This shared link could not be loaded — it may be truncated or corrupted.');
    }
  } else if (hash && hash.startsWith('#import=')) {
    // Structured count handoff (from Count Tooling): #import= + base64 JSON
    // {v:1, source, items:[{description, count, page, type?}]}. Items go
    // through the normal import preview modal.
    try {
      const json = decodeURIComponent(escape(atob(hash.slice(8))));
      const payload = JSON.parse(json);
      window.history.replaceState(null, '', window.location.pathname);
      if (!TakeoffImport.importFromPayload(payload)) {
        alert('This import link contained no valid items.');
      }
    } catch (err) {
      alert('This import link could not be loaded — it may be truncated or corrupted.');
    }
  }

  // Ensure at least one row exists on load
  if (TakeoffState.getTopLevelItems().length === 0) {
    TakeoffState.addItem({ type: null, description: '', quantity: 1, labor: 0, planPage: '', parentId: null });
  }

  // Initial render
  render();
})();
