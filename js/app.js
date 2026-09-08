/**
 * Takeoff Tooling - Main app entry and view switching
 */

(function () {
  const mainContent = document.getElementById('main-content');

  function render() {
    let view = TakeoffState.getCurrentView();
    let itemId = TakeoffState.getCurrentItemId();

    // A flow editor whose row is gone (project switched, row deleted) would
    // render an empty page with no way out — fall back to the manifest.
    if (view !== 'manifest' && view !== 'organize' && (!itemId || !TakeoffState.getItemById(itemId))) {
      TakeoffState.setFlowDirty(false);
      TakeoffState.setCurrentView('manifest', null);
      TakeoffState.clearConduitTempData();
      TakeoffState.clearDeviceTempData();
      TakeoffState.clearWireTempData();
      view = 'manifest';
      itemId = null;
    }

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
    } else if (view === 'organize') {
      mainContent.innerHTML = TakeoffOrganizeView.render();
      TakeoffOrganizeView.attachListeners();
    }
    updateUndoRedoButtons();
    if (typeof TakeoffProjectsView !== 'undefined') TakeoffProjectsView.updateHeader();
  }

  // Called at the tail of render(), and by the manifest view after every edit
  // that deliberately skips a render (field edits, the quantity spinners):
  // Undo used to sit disabled with a full stack exactly when it was reached for.
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
    // every door primes the search, as the fill door already did — the book is
    // opened to look something up
    document.getElementById('labor-book-global-search')?.focus();
  }

  // (The device flow's per-row book door is gone: it merged the pick into
  // whatever the row already said. PB — fill mode — is the one door per row.)

  function showLaborBookModalForConduitFittings(itemId) {
    document.body.classList.add('lb-modal-open');
    TakeoffState.clearLaborBookTargetDeviceRow();
    TakeoffState.setLaborBookPreselectedItemId(itemId || null);
    TakeoffState.setActiveLaborBookTab('conduit');
    TakeoffState.setLaborBookExpandGroup('Fittings');
    // A term left in the box from a PB fill hides the whole tree behind search
    // results — this door promises the Fittings group, so show it.
    TakeoffLaborBookSearch.clearTerm();
    const modal = document.getElementById('labor-book-modal');
    modal.setAttribute('aria-hidden', 'false');
    TakeoffLaborBookView.render();
    TakeoffLaborBookView.attachListeners();
    document.getElementById('labor-book-global-search')?.focus();
  }

  function hideLaborBookModal() {
    const modal = document.getElementById('labor-book-modal');
    if (modal?.contains(document.activeElement)) {
      document.activeElement?.blur();
    }
    // closing drops the search too: a term that outlives the modal reopens it
    // showing stale results with the tabs hidden
    TakeoffLaborBookSearch.clearTerm();
    const asmFilter = document.getElementById('mc-book-search');
    if (asmFilter) asmFilter.value = '';
    TakeoffState.clearLaborBookPreselectedItemId();
    TakeoffState.clearLaborBookTargetDeviceRow();
    TakeoffState.clearLaborBookExpandGroup();
    TakeoffState.clearLaborBookFillTarget();
    modal?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('lb-modal-open');
  }

  // Leaving a flow drops its temp buffer, so uncommitted edits need a nod
  // first (flow saves clear the flag before navigating; Cancel asks too).
  function navigateToManifest() {
    if (TakeoffState.getFlowDirty() && TakeoffState.getCurrentView() !== 'manifest') {
      if (!confirm('Discard unsaved changes in this editor?')) return;
    }
    TakeoffState.setFlowDirty(false);
    TakeoffState.setCurrentView('manifest', null);
    TakeoffState.clearConduitTempData();
    TakeoffState.clearDeviceTempData();
    TakeoffState.clearWireTempData();
    TakeoffState.clearLaborBookTargetDeviceRow();
    render();
  }

  function navigateToDevice(itemId) {
    TakeoffState.setFlowDirty(false);
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
    // An empty section starts with no rows at all: device.js renders it as a
    // "+ Box"-style chip until the estimator asks for it, and the row that
    // chip adds is seeded with the line's run count (component quantities are
    // totals for the whole line — the column head says so).
    // `book`: the book row this part was filled from (X1) — it rides in the
    // buffer so re-opening and re-saving the editor doesn't drop the link.
    const toRows = (arr) => arr.map((x) => Object.assign(
      { description: x.description, quantity: x.quantity, labor: x.labor, price: x.price ?? '' },
      x.meta && x.meta.book ? { book: x.meta.book } : null
    ));
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
    TakeoffState.setFlowDirty(false);
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
        // which button group added it (rentals or fill); the wizard re-derives
        // it from the description for rows saved before the split
        group: a.meta?.addonGroup,
        quantity: a.quantity,
        labor: a.labor,
        price: a.price ?? '',
      }));
    }
    if (fittings.length) {
      tempData.fittings = fittings.map((f) => Object.assign(
        { description: f.description, quantity: f.quantity, labor: f.labor, price: f.price ?? '' },
        f.meta && f.meta.book ? { book: f.meta.book } : null
      ));
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

  // Full-page category organizer (opened from the Labor & Price Book modal)
  function navigateToOrganize() {
    TakeoffState.setCurrentView('organize', null);
    TakeoffOrganizeView.enter();
    render();
  }

  function navigateToWire(itemId) {
    TakeoffState.setFlowDirty(false);
    TakeoffState.setCurrentView('wire', itemId);
    const item = TakeoffState.getItemById(itemId);
    const children = item?.children || [];
    const overage = children.find((c) => c.type === 'overage');
    const macAdapters = children.filter((c) => c.type === 'macAdapter');
    TakeoffState.setWireTempData({
      overagePercent: overage ? overagePercentFrom(overage) : null,
      macAdapters: macAdapters.length
        ? macAdapters.map((m) => Object.assign(
          { description: m.description, quantity: m.quantity, labor: m.labor, price: m.price ?? '' },
          m.meta && m.meta.book ? { book: m.meta.book } : null
        ))
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

  /**
   * A one-line notice above the bid: what this project IS, and how to make the
   * line go away. Lives outside #main-content, so a render() cannot wipe it,
   * and it is never a dialog — nothing here is worth blocking the hands for.
   *
   * The split against TakeoffToast (js/toast.js), which is the app's channel
   * for everything else: a notice bar states a standing fact about the open
   * project ("this is your copy of a shared link") and waits to be dismissed;
   * a toast reports what a click just did and leaves on its own. If a message
   * would still be worth reading ten minutes from now, it belongs here.
   */
  function showAppNotice(text, kind) {
    const host = document.getElementById('app');
    const main = document.getElementById('main-content');
    if (!host || !main) return null;
    document.getElementById('app-notice')?.remove();
    const bar = document.createElement('div');
    bar.id = 'app-notice';
    bar.className = 'app-notice' + (kind === 'warn' ? ' app-notice-warn' : '');
    bar.setAttribute('role', 'status');
    const message = document.createElement('span');
    message.className = 'app-notice-text';
    message.textContent = text;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'app-notice-dismiss';
    close.id = 'app-notice-dismiss';
    close.title = 'Dismiss';
    close.textContent = '×';
    close.addEventListener('click', () => bar.remove());
    bar.append(message, close);
    host.insertBefore(bar, main);
    return bar;
  }

  // The share envelope: everything a second estimator needs to read this bid
  // at the same numbers — the rows, the labor rate, and the job's own details.
  function buildShareEnvelope() {
    return {
      v: 2,
      app: 'takeoff-tooling',
      exportedAt: new Date().toISOString(),
      name: TakeoffState.getCurrentProject().name,
      laborRate: TakeoffState.getLaborRate(),
      taxRate: TakeoffState.getTaxRate(),
      details: TakeoffState.getProjectDetails(),
      // where the counts came from (the CountTooling plans link), when known
      plansUrl: TakeoffState.getCurrentProject().plansUrl || undefined,
      manifest: TakeoffState.getManifest(),
    };
  }

  // Copy share link (Print Options). Resolves true when the link is on the
  // clipboard, so the button can say so where the hand already is.
  async function copyShareLink() {
    const json = JSON.stringify(buildShareEnvelope());
    const base64 = btoa(unescape(encodeURIComponent(json)));
    const url = window.location.origin + window.location.pathname + '#d=' + base64;
    try {
      await navigator.clipboard.writeText(url);
      TakeoffEvents.log('share_link_created', { rows: TakeoffState.getTopLevelItems().length, hasRate: Number(TakeoffState.getLaborRate()) > 0 });
      TakeoffToast.show('Share link copied — anyone who opens it gets their own copy at these numbers.', { kind: 'success' });
      return true;
    } catch (err) {
      // a failed copy is news about the click, not about the bid: it goes in
      // the toast region, not the notice bar that explains the open project
      TakeoffToast.show('Could not reach the clipboard. Copy the link from the address bar after opening it.', { kind: 'warn', timeout: 9000 });
      return false;
    }
  }

  // Expose for views
  window.TakeoffApp = {
    copyShareLink,
    buildShareEnvelope,
    showAppNotice,
    render,
    updateUndoRedoButtons,
    showTypeModal,
    hideTypeModal,
    showLaborBookModal,
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
    navigateToOrganize,
  };

  // App title - navigate to manifest
  document.getElementById('app-title')?.addEventListener('click', () => {
    TakeoffApp.navigateToManifest();
  });

  // Import From Count Tooling
  document.getElementById('import-count-tooling-btn')?.addEventListener('click', () => {
    TakeoffImport.importFromClipboard();
  });

  // Header overflow menu (New project / Review / Manage users / Reload app)
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
  // any menu action closes the menu (the item's own listener still runs)
  headerMenu?.addEventListener('click', (e) => {
    if (e.target.closest('.header-menu-item')) {
      setHeaderMenuOpen(false);
    }
  });

  // Copy for PipeTooling (v0 handoff: PipeTooling's Counts-import text)
  document.getElementById('copy-pipetooling-btn')?.addEventListener('click', () => {
    TakeoffHandoff.copyForPipeTooling();
  });

  // Undo/Redo move the manifest under whatever is on screen, so an open editor
  // with unsaved edits has to be settled BEFORE the manifest moves — asking
  // afterwards (via navigateToManifest) left "Cancel" sitting in the editor
  // over an already-changed bid, with no way back.
  function confirmLeavingOpenFlow() {
    if (!TakeoffState.getFlowDirty() || TakeoffState.getCurrentView() === 'manifest') return true;
    if (!confirm('Discard unsaved changes in this editor?')) return false;
    TakeoffState.setFlowDirty(false); // answered here; don't ask again on the way out
    return true;
  }

  // Undo
  document.getElementById('undo-btn')?.addEventListener('click', () => {
    if (!confirmLeavingOpenFlow()) return;
    TakeoffEvents.log('undo', { frames: TakeoffState.getUndoDepth(), fromView: TakeoffState.getCurrentView() });
    if (TakeoffState.undo()) {
      TakeoffApp.navigateToManifest();
    }
  });

  // Redo
  document.getElementById('redo-btn')?.addEventListener('click', () => {
    if (!confirmLeavingOpenFlow()) return;
    if (TakeoffState.redo()) {
      TakeoffApp.navigateToManifest();
    }
  });

  // Ctrl/Cmd-Z outside a field. Inside one, the browser's own per-field undo
  // is already writing through to state via the input listener, so an
  // app-level handler there would run two undo systems on one keystroke —
  // and a keystroke aimed at a dialog is that dialog's business.
  function keyboardUndoAllowed(e) {
    const el = e.target;
    if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return false;
    return !document.querySelector('.modal[aria-hidden="false"]');
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'z' && e.key !== 'Z') return;
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    if (!keyboardUndoAllowed(e)) return;
    e.preventDefault();
    if (!confirmLeavingOpenFlow()) return;
    if (!e.shiftKey) TakeoffEvents.log('undo', { frames: TakeoffState.getUndoDepth(), fromView: TakeoffState.getCurrentView() });
    const moved = e.shiftKey ? TakeoffState.redo() : TakeoffState.undo();
    if (moved) TakeoffApp.navigateToManifest();
    else updateUndoRedoButtons();
  });

  // (X13) The "Remove items" mode is gone: the trash sits on every manifest
  // row and appears on hover — always, at touch widths.

  // New Project: hand off to the Manage Projects modal's inline create row
  document.getElementById('new-takeoff-btn')?.addEventListener('click', () => {
    TakeoffProjectsView.openModal({ create: true });
  });

  // Type modal Cancel (Escape and click-outside also work)
  document.getElementById('type-modal-cancel')?.addEventListener('click', hideTypeModal);

  // Cache clear and hard reload (code caches only — never user data)
  document.getElementById('cache-clear-reload-btn')?.addEventListener('click', async () => {
    // location.replace unloads without firing the guard below, so a dirty
    // editor is asked about here instead (J11-F2).
    if (!confirmLeavingOpenFlow()) return;
    TakeoffState.persistAllNow();
    if (typeof TakeoffCloud !== 'undefined') TakeoffCloud.flushPending();
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    // The offline service worker holds the shell too, so clearing the caches
    // alone would still hand back the old code: unregister it, and the
    // reload comes straight off the network and installs a fresh copy.
    if ('serviceWorker' in navigator) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      } catch (err) { /* nothing registered, or blocked — reload anyway */ }
    }
    window.location.replace(window.location.pathname + window.location.search);
  });

  // Flush pending project + book saves before the page goes away — and, when
  // an editor is holding unsaved work, let the browser ask first. Every
  // in-app exit already asks; a Cmd-R or a tab close took the run silently.
  window.addEventListener('beforeunload', (e) => {
    TakeoffState.persistAllNow();
    if (typeof TakeoffCloud !== 'undefined') TakeoffCloud.flushPending();
    if (TakeoffState.getFlowDirty() && TakeoffState.getCurrentView() !== 'manifest') {
      e.preventDefault();
      e.returnValue = ''; // the browser supplies its own wording
      return '';
    }
    return undefined;
  });

  // One-time cleanup: retired features (old Import MC triage, standalone Part Book)
  try {
    localStorage.removeItem('labor-book-import-progress');
    for (const key of ['part-book', 'part-book-elliot-mappings', 'part-book-unmatched', 'part-book-structure', 'part-book-category-mapping', 'part-book-create-destination']) {
      localStorage.removeItem(key);
    }
  } catch (_) {}

  // (The Print-with-Form modal is retired — the five facts it asked for every
  // time now live on the project, edited under Print Options → Job details.)

  // Hash routes: #d= (a shared takeoff → lands in a NEW project) and
  // #import= (structured count handoff → the import preview). Runs at boot
  // and on hashchange, so a link pasted into a tab that already has the app
  // open works instead of silently doing nothing. Returns true when a route
  // was consumed.
  function handleHashRoute({ atBoot } = {}) {
    const hash = window.location.hash;
    if (!hash || !(hash.startsWith('#d=') || hash.startsWith('#import='))) return false;
    const stripHash = () => window.history.replaceState(null, '', window.location.pathname);
    // at runtime a flow editor may hold unsaved edits — leave it first (asks)
    if (!atBoot && TakeoffState.getCurrentView() !== 'manifest') {
      navigateToManifest();
      if (TakeoffState.getCurrentView() !== 'manifest') {
        stripHash(); // the user kept their edits; the link is dropped
        return false;
      }
    }
    if (hash.startsWith('#d=')) {
      try {
        const json = decodeURIComponent(escape(atob(hash.slice(3))));
        const data = JSON.parse(json);
        const list = Array.isArray(data) ? data : data && Array.isArray(data.manifest) ? data.manifest : null;
        stripHash();
        if (!list) {
          // shaped like a link but carrying no rows. Silence here read exactly
          // like a working import that happened to produce nothing.
          showAppNotice('That share link carried no takeoff rows — ask the sender to copy the link again.', 'warn');
        } else {
          TakeoffEvents.log('share_link_opened', { rows: list.length, hasRate: typeof data.laborRate === 'number' });
          const base = data && typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'Imported takeoff';
          // the day the SENDER made the link, not the day it was opened
          const exportedAt = data && typeof data.exportedAt === 'string' ? data.exportedAt : '';
          const stamp = Date.parse(exportedAt);
          const when = new Date(isNaN(stamp) ? Date.now() : stamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          // The same link opened twice is one bid, not two: reopen the copy
          // already here instead of making a byte-identical twin.
          const existing = TakeoffState.findImportedProject(base, exportedAt);
          if (existing) {
            TakeoffState.switchProject(existing);
            showAppNotice(`Reopened your copy of ${base}, shared ${when} by link — edits stay on this device.`);
          } else {
            // shared links land in their own project — nothing gets replaced
            TakeoffState.createProject(TakeoffState.uniqueProjectName(base), {
              details: data && data.details,
              importedFrom: exportedAt ? { name: base, exportedAt } : null,
            });
            // the sender's rate travels with the bid, so both people read the
            // same grand total; links made before v2 carried none, and those
            // keep inheriting the recipient's own rate
            if (data && typeof data.laborRate === 'number') TakeoffState.setLaborRate(data.laborRate);
            // the jurisdiction's sales tax travels with the bid too; a link made
            // before it was editable carries none and keeps the 8.5% it was bid at
            TakeoffState.setTaxRate(data && typeof data.taxRate === 'number' ? data.taxRate : TakeoffState.LEGACY_TAX_RATE);
            if (data && typeof data.plansUrl === 'string') TakeoffState.setPlansUrl(data.plansUrl);
            TakeoffState.loadManifestFromExport(data);
            showAppNotice(`Copy of ${base}, shared ${when} by link — edits stay on this device.`);
          }
        }
      } catch (err) {
        stripHash();
        showAppNotice('That share link could not be opened — it may be truncated or corrupted.', 'warn');
      }
    } else {
      // {v:1, source, items:[{description, count, page, type?}]} → preview modal
      try {
        const json = decodeURIComponent(escape(atob(hash.slice(8))));
        const payload = JSON.parse(json);
        stripHash();
        // {count, message} — a wrong envelope version says so, instead of
        // being reported as an empty link
        const result = TakeoffImport.importFromPayload(payload);
        if (!result.count) TakeoffToast.show(result.message, { kind: 'warn', timeout: 9000 });
      } catch (err) {
        stripHash();
        TakeoffToast.show('This import link could not be loaded — it may be truncated or corrupted.', { kind: 'warn', timeout: 9000 });
      }
    }
    if (!atBoot) {
      seedStarterRow();
      render();
    }
    return true;
  }

  // The starter row IS the empty table, not something the estimator did: it
  // must not leave an undo frame, or a cold boot opens with Undo lit and one
  // press empties the bid.
  function seedStarterRow() {
    if (TakeoffState.getTopLevelItems().length > 0) return;
    TakeoffState.addItem({ type: null, description: '', quantity: 1, labor: 0, planPage: '', parentId: null });
    TakeoffState.clearManifestHistory();
  }

  handleHashRoute({ atBoot: true });
  window.addEventListener('hashchange', () => handleHashRoute());

  // Ensure at least one row exists on load
  seedStarterRow();

  // Initial render
  render();
  TakeoffEvents.log('session_start', { vw: window.innerWidth, vh: window.innerHeight, coarsePointer: !!window.matchMedia?.('(pointer: coarse)').matches, standalone: !!window.matchMedia?.('(display-mode: standalone)').matches });

  // Keep a copy of the app on the device, so a refresh with no signal opens
  // the bid instead of the browser's error page (sw.js). Skipped under
  // automation: every Playwright context is a fresh profile, and a worker
  // installing itself mid-run only adds noise to specs that are about
  // something else. The offline spec registers it by hand.
  if ('serviceWorker' in navigator
      && window.location.protocol !== 'file:'
      && !navigator.webdriver) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {
        // No offline copy this time — the app itself is unaffected.
      });
    });
  }
})();
