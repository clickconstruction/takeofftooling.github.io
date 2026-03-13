/**
 * Import from Count Tooling clipboard format
 * Format: fixture\tcount\tpage per line
 * fixture — Item name
 * count — Count or length (number)
 * page — Comma-separated page numbers (e.g. 1, 3, 5)
 * Line types: [unit] of [name] (e.g. ft of Conduit, in of Pipe)
 */

const TakeoffImport = (function () {
  let pendingImportItems = [];

  function inferType(description) {
    const d = (description || '').trim().toLowerCase();
    if (/of\s+conduit/.test(d)) return 'conduit';
    if (/of\s+wire/.test(d)) return 'wire';
    if (/receptacle|switch|outlet/.test(d)) return 'devices';
    if (/light\s*fixture|lighting|fixture/.test(d)) return 'lighting';
    if (/panel|gear|transformer/.test(d)) return 'gear';
    return null;
  }

  function parseCountToolingClipboard(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const items = [];
    for (const line of lines) {
      const parts = line.split(/\t/).map((p) => p.trim());
      if (parts.length < 2) continue;
      const fixture = parts[0] || '';
      const count = parseFloat(parts[1]) || 0;
      const page = parts[2] || '';
      if (!fixture) continue;
      items.push({
        description: fixture,
        quantity: count,
        labor: null,
        planPage: page,
        type: inferType(fixture),
      });
    }
    return items;
  }

  function escapeHtml(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function getManifestDescriptions() {
    const items = TakeoffState.getTopLevelItems();
    return new Set(items.map((i) => (i.description || '').trim().toLowerCase()).filter(Boolean));
  }

  function renderManifestList(container) {
    const items = TakeoffState.getTopLevelItems();
    if (items.length === 0) {
      container.innerHTML = '<p class="import-preview-empty">Manifest is empty.</p>';
      return;
    }
    container.innerHTML = items
      .map(
        (i) =>
          `<div class="import-preview-item"><span class="import-preview-desc">${escapeHtml(i.description || '-')}</span> <span class="import-preview-meta">× ${i.quantity ?? 0} ${i.planPage ? '| ' + escapeHtml(i.planPage) : ''}</span></div>`
      )
      .join('');
  }

  function renderImportList(container, importItems, manifestDescs) {
    if (importItems.length === 0) {
      container.innerHTML = '<p class="import-preview-empty">No import items.</p>';
      return;
    }
    container.innerHTML = importItems
      .map((item) => {
        const descNorm = (item.description || '').trim().toLowerCase();
        const isNew = !manifestDescs.has(descNorm);
        const badge = isNew ? '<span class="import-preview-badge import-preview-badge-new">new</span>' : '';
        return `<div class="import-preview-item ${isNew ? 'import-preview-item-new' : ''}">${badge}<span class="import-preview-desc">${escapeHtml(item.description || '-')}</span> <span class="import-preview-meta">× ${item.quantity ?? 0} ${item.planPage ? '| ' + escapeHtml(item.planPage) : ''}</span></div>`;
      })
      .join('');
  }

  function performImport(items, overagesOnly) {
    const manifestDescs = overagesOnly ? getManifestDescriptions() : null;
    for (const item of items) {
      if (overagesOnly) {
        const descNorm = (item.description || '').trim().toLowerCase();
        if (manifestDescs.has(descNorm)) continue;
      }
      TakeoffState.addItem({
        type: item.type,
        description: item.description,
        quantity: item.quantity,
        labor: item.labor,
        planPage: item.planPage,
        parentId: null,
      });
    }
    TakeoffApp.render();
  }

  function showImportPreviewModal(items) {
    ensureImportPreviewListeners();
    pendingImportItems = items;
    const modal = document.getElementById('import-preview-modal');
    const manifestList = document.getElementById('import-preview-manifest-list');
    const importList = document.getElementById('import-preview-import-list');
    if (!modal || !manifestList || !importList) return;

    const manifestDescs = getManifestDescriptions();
    renderManifestList(manifestList);
    renderImportList(importList, items, manifestDescs);

    modal.setAttribute('aria-hidden', 'false');
  }

  function hideImportPreviewModal() {
    const modal = document.getElementById('import-preview-modal');
    if (modal) modal.setAttribute('aria-hidden', 'true');
    pendingImportItems = [];
  }

  function attachImportPreviewListeners() {
    document.getElementById('import-preview-cancel-btn')?.addEventListener('click', () => {
      hideImportPreviewModal();
    });
    document.getElementById('import-preview-overages-btn')?.addEventListener('click', () => {
      performImport(pendingImportItems, true);
      hideImportPreviewModal();
    });
    document.getElementById('import-preview-all-btn')?.addEventListener('click', () => {
      performImport(pendingImportItems, false);
      hideImportPreviewModal();
    });
    document.getElementById('import-preview-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'import-preview-modal') hideImportPreviewModal();
    });
    document.addEventListener('keydown', function importPreviewKeyHandler(e) {
      const modal = document.getElementById('import-preview-modal');
      if (!modal || modal.getAttribute('aria-hidden') !== 'false') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        hideImportPreviewModal();
      }
    });
  }

  async function importFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      const items = parseCountToolingClipboard(text);
      if (items.length === 0) {
        alert('No valid rows found. Expected format: fixture\\tcount\\tpage (tab-separated, one per line)');
        return;
      }
      showImportPreviewModal(items);
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        alert('Clipboard access denied. Please allow clipboard permission and try again.');
      } else {
        alert('Failed to import: ' + (err.message || 'Unknown error'));
      }
    }
  }

  let importPreviewListenersAttached = false;
  function ensureImportPreviewListeners() {
    if (importPreviewListenersAttached) return;
    importPreviewListenersAttached = true;
    attachImportPreviewListeners();
  }

  return { importFromClipboard, parseCountToolingClipboard, showImportPreviewModal, hideImportPreviewModal, ensureImportPreviewListeners };
})();
