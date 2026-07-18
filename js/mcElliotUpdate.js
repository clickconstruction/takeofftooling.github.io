/**
 * "Update Elliot Prices" modal: upload an Elliot Electric price CSV, match
 * SKUs to MC component items, recompute assembly prices, review ambiguous
 * matches, and download regenerated files for committing to the repo.
 */

const McElliotUpdate = (function () {
  const esc = (s) => TakeoffUtils.escapeHtml(s);

  let activeTab = 'upload';
  let lastSummary = null; // {stats, matching, duplicateWarnings, categories: {cat: count}}

  // ---------- modal plumbing ----------

  function show() {
    document.getElementById('mc-elliot-modal')?.setAttribute('aria-hidden', 'false');
    activeTab = 'upload';
    renderTabs();
    renderBody();
    // vendor profiles load lazily; re-render the upload form once available
    McElliotState.loadReferenceData().then(() => {
      if (activeTab === 'upload') renderBody();
    });
  }

  function hide() {
    const modal = document.getElementById('mc-elliot-modal');
    if (modal?.contains(document.activeElement)) document.activeElement?.blur();
    modal?.setAttribute('aria-hidden', 'true');
  }

  function renderTabs() {
    const el = document.getElementById('mc-elliot-tabs');
    if (!el) return;
    const queueN = McElliotState.getQueue().length;
    const tabs = [
      ['upload', 'Upload'],
      ['review', `Review Matches (${queueN})`],
      ['summary', 'Summary'],
    ];
    el.innerHTML = tabs
      .map(([k, label]) => `<button type="button" class="labor-book-tab${k === activeTab ? ' active' : ''}" data-eltab="${k}">${esc(label)}</button>`)
      .join('');
  }

  function setStatus(text) {
    const el = document.getElementById('mc-elliot-status');
    if (el) el.textContent = text;
  }

  // ---------- upload tab ----------

  function currentProfile() {
    const profiles = McElliotState.getVendorProfiles();
    return profiles[McElliotState.getCurrentVendor()] || profiles.elliot || McElliotCore.ELLIOT_PROFILE;
  }

  function renderUpload() {
    const overlay = McElliotState.getOverlay();
    const profiles = McElliotState.getVendorProfiles();
    const vendorKeys = Object.keys(profiles);
    const vendor = McElliotState.getCurrentVendor();
    const profile = currentProfile();
    const current = overlay
      ? `<p class="mc-elliot-current">Current overlay: <strong>${esc(overlay.vendorLabel || 'Elliot Electric')}</strong> — ${esc(overlay.sourceFile || 'unknown')} imported ${esc((overlay.importedAt || '').slice(0, 10))} — ${Object.keys(overlay.itemPrices || {}).length} item prices, ${(overlay.newItems || []).length} new items.
         <button type="button" class="btn btn-link" id="mc-elliot-clear-btn">Remove overlay</button></p>`
      : '<p class="mc-elliot-current">No supplier price overlay is active — the book shows original MC prices.</p>';
    const vendorSelect = vendorKeys.length
      ? `<label class="mc-elliot-vendor-wrap">Supplier:
           <select id="mc-elliot-vendor">${vendorKeys.map((k) => `<option value="${esc(k)}" ${k === vendor ? 'selected' : ''}>${esc(profiles[k].label || k)}</option>`).join('')}</select>
         </label>
         <span class="mc-elliot-hint">Add suppliers by editing mc-assemblies/vendor-profiles.json</span>`
      : '';
    return `
      ${current}
      <div class="mc-elliot-upload-controls">${vendorSelect}</div>
      <p>Upload a price file from ${esc(profile.label || 'your supplier')}.</p>
      <div class="mc-elliot-upload-controls">
        <input type="file" id="mc-elliot-file" accept=".csv,text/csv" />
        ${profile.bundledFile ? `<span>or</span>
        <button type="button" class="btn btn-secondary" id="mc-elliot-load-bundled">Load bundled ${esc(profile.bundledFile.split('/').pop())}</button>` : ''}
      </div>
      <textarea id="mc-elliot-textarea" rows="4" placeholder="...or paste CSV contents here"></textarea>
      <div class="mc-elliot-actions">
        <button type="button" class="btn btn-success" id="mc-elliot-process-btn">Process</button>
        <progress id="mc-elliot-progress" max="100" value="0" style="display:none"></progress>
        <span id="mc-elliot-progress-text"></span>
      </div>`;
  }

  async function processText(text, sourceFile) {
    const progressEl = document.getElementById('mc-elliot-progress');
    const progressText = document.getElementById('mc-elliot-progress-text');
    try {
      setStatus('Parsing...');
      const { priceModel } = await McElliotState.loadReferenceData();
      const categoryMapping = McElliotState.getCategoryMapping();
      const profile = currentProfile();
      const { rows, errors } = McElliotCore.parseVendorCsv(text, profile);
      if (errors.length || !rows.length) {
        setStatus(errors[0] || 'No rows parsed.');
        return;
      }
      const { rows: deduped, duplicateWarnings } = McElliotCore.dedupeElliotRows(rows, categoryMapping);

      setStatus(`Parsed ${rows.length.toLocaleString()} rows (${deduped.length.toLocaleString()} unique parts). Matching against ${Object.keys(priceModel.items).length.toLocaleString()} MC items...`);
      if (progressEl) progressEl.style.display = '';

      const mappings = McElliotState.getEffectiveMappings();
      const result = await McElliotMatch.runMatching(priceModel.items, deduped, mappings, (done, total) => {
        if (progressEl) {
          progressEl.max = total;
          progressEl.value = done;
        }
        if (progressText) progressText.textContent = `${done.toLocaleString()} / ${total.toLocaleString()} items`;
      });
      if (progressEl) progressEl.style.display = 'none';
      if (progressText) progressText.textContent = '';

      // overlay item prices: matched items whose price moved > 0.1%
      const itemPrices = {};
      for (const [itemNum, m] of Object.entries(result.auto)) {
        const oldP = priceModel.items[itemNum]?.p || 0;
        if (m.perEach > 0 && (oldP === 0 || Math.abs(m.perEach - oldP) / oldP > 0.001)) {
          itemPrices[itemNum] = Math.round(m.perEach * 10000) / 10000;
        }
        // remember auto matches permanently
        if (m.via === 'auto') McElliotState.setMapping(m.partNumber, Number(itemNum));
      }

      // new items: rows not consumed by any match, in tab-mapped categories
      // keep ALL categories' rows so destination changes apply without re-upload
      const usedPns = new Set(Object.values(result.auto).map((m) => m.partNumber));
      const newItems = [];
      const categoryCounts = {};
      for (const r of deduped) {
        if (usedPns.has(r.partNumber)) continue;
        newItems.push([r.category, r.description || r.name, r.partNumber, Math.round(r.perEach * 10000) / 10000]);
        categoryCounts[r.category] = (categoryCounts[r.category] || 0) + 1;
      }

      const overlay = {
        version: 1,
        vendor: McElliotState.getCurrentVendor(),
        vendorLabel: currentProfile().label || 'Elliot Electric',
        sourceFile: sourceFile || 'pasted CSV',
        importedAt: new Date().toISOString(),
        enabledCategories: Object.keys(categoryCounts).filter((c) => categoryMapping[c]),
        allCats: true,
        itemPrices,
        newItems,
      };
      const { truncated } = McElliotState.saveOverlay(overlay);
      McElliotState.saveQueue(result.review);
      McElliotState.invalidateRecompute();
      if (typeof McBook !== 'undefined' && McBook.invalidate) McBook.invalidate();
      if (typeof TakeoffLaborBookView !== 'undefined' && TakeoffLaborBookView.refreshAssembliesIfVisible) TakeoffLaborBookView.refreshAssembliesIfVisible();

      const recompute = await McElliotState.getRecompute();
      lastSummary = {
        sourceFile: overlay.sourceFile,
        rows: rows.length,
        uniqueParts: deduped.length,
        matchedSaved: result.mappedApplied,
        matchedAuto: Object.values(result.auto).filter((m) => m.via === 'auto').length,
        pricesChanged: Object.keys(itemPrices).length,
        review: result.review.length,
        stats: recompute ? recompute.stats : null,
        duplicateWarnings,
        categoryCounts,
        truncated,
      };
      activeTab = 'summary';
      renderTabs();
      renderBody();
    } catch (err) {
      if (progressEl) progressEl.style.display = 'none';
      setStatus('Failed: ' + (err.message || 'unknown error'));
    }
  }

  // ---------- summary tab ----------

  function renderSummary() {
    const overlay = McElliotState.getOverlay();
    if (!overlay) return '<p>No Elliot data imported yet — use the Upload tab.</p>';
    const s = lastSummary;
    const queueN = McElliotState.getQueue().length;
    const stats = s?.stats;
    const catMapping = McElliotState.getCategoryMapping() || {};
    const counts = s?.categoryCounts || countCategories(overlay);

    const TAB_LABELS = { gear: 'Gear', lighting: 'Lighting', devices: 'Devices', conduit: 'Conduit', wire: 'Wire', specialSystems: 'Special Systems' };
    const catChecks = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(
        ([cat, n]) => `
        <label class="mc-elliot-cat">
          <select data-elcatdest="${esc(cat)}">
            <option value="">Skip</option>
            ${Object.entries(TAB_LABELS).map(([v, l]) => `<option value="${v}" ${catMapping[cat] === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          ${esc(cat)} <span class="mc-book-section-count">${n.toLocaleString()}</span></label>`
      )
      .join('');

    return `
      <div class="mc-elliot-summary">
        <p><strong>${esc(overlay.sourceFile || '')}</strong> — applied locally ✓ (MC Book already shows these prices on this computer).</p>
        <table class="mc-elliot-stats">
          ${s ? `<tr><td>Rows in file</td><td>${s.rows.toLocaleString()} (${s.uniqueParts.toLocaleString()} unique parts)</td></tr>` : ''}
          ${s ? `<tr><td>Matched via saved mappings</td><td>${s.matchedSaved.toLocaleString()}</td></tr>` : ''}
          ${s ? `<tr><td>Matched automatically</td><td>${s.matchedAuto.toLocaleString()}</td></tr>` : ''}
          <tr><td>Component prices changed</td><td>${Object.keys(overlay.itemPrices || {}).length.toLocaleString()}</td></tr>
          ${stats ? `<tr><td>Assemblies repriced</td><td>${stats.updated.toLocaleString()} (avg change ${stats.avgDeltaPct}%)</td></tr>` : ''}
          ${stats ? `<tr><td>Assemblies flagged ⚠ (formula unverified, price kept)</td><td>${stats.flagged.toLocaleString()}</td></tr>` : ''}
          <tr><td>Needs review</td><td>${queueN.toLocaleString()} — see Review Matches tab</td></tr>
          ${s?.duplicateWarnings?.length ? `<tr><td>Duplicate part numbers with differing prices</td><td>${s.duplicateWarnings.length} (lowest price kept)</td></tr>` : ''}
        </table>
        <h3>Sort supplier categories into tabs</h3>
        <p class="mc-elliot-hint">Pick where each supplier category's parts appear in the book — changes apply immediately. "Skip" leaves a category out entirely.</p>
        ${overlay.allCats ? '' : '<p class="mc-elliot-hint">⚠ This overlay predates live re-sorting — re-run the upload once to enable switching previously skipped categories on.</p>'}
        <div class="mc-elliot-cats">${catChecks || '<em>none</em>'}</div>
        ${overlay.newItemsTruncated ? '<p class="mc-elliot-warn">⚠ New-item list was too large for local storage — commit the downloaded book to keep them.</p>' : ''}
        <h3>Commit to the repo</h3>
        <p class="mc-elliot-hint">Local overlay only affects this browser. To make prices permanent for every device, download these and replace the files in <code>mc-assemblies/</code>:</p>
        <div class="mc-elliot-actions">
          <button type="button" class="btn btn-success" id="mc-elliot-dl-book">Download mc-labor-book.json</button>
          <button type="button" class="btn btn-secondary" id="mc-elliot-dl-overlay">Download elliot-price-overlay.json</button>
          <button type="button" class="btn btn-secondary" id="mc-elliot-dl-mappings">Download elliot-item-mappings.json</button>
          <button type="button" class="btn btn-secondary" id="mc-elliot-dl-catmap">Download elliot-category-mapping.json</button>
        </div>
      </div>`;
  }

  function countCategories(overlay) {
    const counts = {};
    for (const [cat] of overlay.newItems || []) counts[cat] = (counts[cat] || 0) + 1;
    return counts;
  }

  // ---------- review tab ----------

  function renderReview() {
    const queue = McElliotState.getQueue();
    if (!queue.length) return '<p>Nothing to review — ambiguous matches will appear here after an upload.</p>';
    const rows = queue
      .slice(0, 300)
      .map((q) => {
        const opts = q.candidates
          .map((c, i) => `<option value="${i}">${esc(c.desc)} — $${c.perEach} (${Math.round(c.score * 100)}%)</option>`)
          .join('');
        return `
        <div class="mc-elliot-review-row" data-itemnum="${q.itemNum}">
          <div class="mc-elliot-review-item"><strong>${esc(q.itemName)}</strong> <span class="mc-book-section-count">$${q.oldPerEach}/ea</span></div>
          <select class="mc-elliot-review-select">${opts}</select>
          <button type="button" class="btn btn-small btn-success mc-elliot-review-match">Match</button>
          <button type="button" class="btn btn-small btn-secondary mc-elliot-review-skip">Skip</button>
        </div>`;
      })
      .join('');
    return `<p class="mc-elliot-hint">${queue.length.toLocaleString()} MC items have a plausible but uncertain Elliot match. Confirm or skip — confirmations are remembered for every future upload.</p>${rows}${queue.length > 300 ? '<p class="mc-elliot-hint">Showing first 300.</p>' : ''}`;
  }

  function onReviewClick(e) {
    const row = e.target.closest('.mc-elliot-review-row');
    if (!row) return;
    const itemNum = Number(row.dataset.itemnum);
    const queue = McElliotState.getQueue();
    const q = queue.find((x) => x.itemNum === itemNum);
    if (!q) return;
    if (e.target.closest('.mc-elliot-review-match')) {
      const sel = row.querySelector('.mc-elliot-review-select');
      const cand = q.candidates[Number(sel.value)];
      if (cand) {
        McElliotState.resolveQueueItem(itemNum, cand.pn, cand.perEach);
        McElliotState.invalidateRecompute();
        if (typeof McBook !== 'undefined' && McBook.invalidate) McBook.invalidate();
      if (typeof TakeoffLaborBookView !== 'undefined' && TakeoffLaborBookView.refreshAssembliesIfVisible) TakeoffLaborBookView.refreshAssembliesIfVisible();
        setStatus(`Matched "${q.itemName}" → ${cand.desc}. Remembered for future uploads.`);
      }
    } else if (e.target.closest('.mc-elliot-review-skip')) {
      McElliotState.resolveQueueItem(itemNum, null, null);
      setStatus(`Skipped "${q.itemName}".`);
    } else {
      return;
    }
    renderTabs();
    renderBody();
  }

  // ---------- downloads ----------

  function download(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function downloadPatchedBook() {
    setStatus('Building book...');
    const res = await fetch('mc-assemblies/mc-labor-book.json');
    const book = await res.json();
    const patched = await McElliotState.getPatchedBook(book);
    download('mc-labor-book.json', patched);
    setStatus('Downloaded mc-labor-book.json — replace the file in mc-assemblies/ and push.');
  }

  // ---------- body dispatch + listeners ----------

  function renderBody() {
    const body = document.getElementById('mc-elliot-body');
    if (!body) return;
    body.innerHTML = activeTab === 'upload' ? renderUpload() : activeTab === 'review' ? renderReview() : renderSummary();
    setStatus('');
  }

  function init() {
    document.getElementById('mc-elliot-update-btn')?.addEventListener('click', show);
    document.getElementById('mc-elliot-close-btn')?.addEventListener('click', hide);
    document.getElementById('mc-elliot-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'mc-elliot-modal') hide();
    });
    document.getElementById('mc-elliot-tabs')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-eltab]');
      if (!btn) return;
      activeTab = btn.dataset.eltab;
      renderTabs();
      renderBody();
    });

    document.getElementById('mc-elliot-body')?.addEventListener('click', async (e) => {
      if (e.target.id === 'mc-elliot-load-bundled') {
        setStatus('Loading bundled file...');
        try {
          const bundled = currentProfile().bundledFile;
          const res = await fetch(bundled);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          processText(await res.text(), bundled.split('/').pop());
        } catch (err) {
          setStatus('Could not load bundled file: ' + err.message);
        }
        return;
      }
      if (e.target.id === 'mc-elliot-process-btn') {
        const file = document.getElementById('mc-elliot-file')?.files?.[0];
        const pasted = document.getElementById('mc-elliot-textarea')?.value?.trim();
        if (file) {
          processText(await file.text(), file.name);
        } else if (pasted) {
          processText(pasted, 'pasted CSV');
        } else {
          setStatus('Choose a file, paste CSV, or load the bundled file first.');
        }
        return;
      }
      if (e.target.id === 'mc-elliot-clear-btn') {
        if (confirm('Remove the local Elliot price overlay? MC Book returns to original MC prices. Saved match confirmations are kept.')) {
          McElliotState.clearOverlay();
          McElliotState.invalidateRecompute();
          if (typeof McBook !== 'undefined' && McBook.invalidate) McBook.invalidate();
      if (typeof TakeoffLaborBookView !== 'undefined' && TakeoffLaborBookView.refreshAssembliesIfVisible) TakeoffLaborBookView.refreshAssembliesIfVisible();
          lastSummary = null;
          renderTabs();
          renderBody();
        }
        return;
      }
      if (e.target.id === 'mc-elliot-dl-book') {
        downloadPatchedBook();
        return;
      }
      if (e.target.id === 'mc-elliot-dl-overlay') {
        const overlay = McElliotState.getOverlay();
        if (overlay) download('elliot-price-overlay.json', overlay);
        return;
      }
      if (e.target.id === 'mc-elliot-dl-catmap') {
        download('elliot-category-mapping.json', {
          comment: 'Maps supplier CSV categories to Labor & Price Book tabs. null = skip.',
          mapping: McElliotState.getCategoryMapping() || {},
        });
        return;
      }
      if (e.target.id === 'mc-elliot-dl-mappings') {
        download('elliot-item-mappings.json', {
          version: 1,
          comment: 'Confirmed Elliot partNumber -> MC itemNum matches.',
          mappings: McElliotState.getEffectiveMappings(),
        });
        return;
      }
      onReviewClick(e);
    });

    document.getElementById('mc-elliot-body')?.addEventListener('change', (e) => {
      if (e.target.id === 'mc-elliot-vendor') {
        McElliotState.setCurrentVendor(e.target.value);
        renderBody();
        return;
      }
      const sel = e.target.closest('[data-elcatdest]');
      if (!sel) return;
      const overlay = McElliotState.getOverlay();
      if (!overlay) return;
      McElliotState.setCategoryOverride(sel.dataset.elcatdest, sel.value || null);
      // enabled = categories whose effective destination is a tab
      const mapping = McElliotState.getCategoryMapping() || {};
      const counts = lastSummary?.categoryCounts || countCategories(overlay);
      overlay.enabledCategories = Object.keys(counts).filter((c) => mapping[c]);
      McElliotState.saveOverlay(overlay);
      McElliotState.invalidateRecompute();
      if (typeof McBook !== 'undefined' && McBook.invalidate) McBook.invalidate();
      if (typeof TakeoffLaborBookView !== 'undefined' && TakeoffLaborBookView.refreshAssembliesIfVisible) TakeoffLaborBookView.refreshAssembliesIfVisible();
      setStatus(`"${sel.dataset.elcatdest}" now ${sel.value ? 'goes to the ' + sel.options[sel.selectedIndex].text + ' tab' : 'is skipped'}.`);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { show, hide };
})();
