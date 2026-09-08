/**
 * "Update Elliot Prices" modal: upload an Elliot Electric price CSV, match
 * SKUs to MC component items, recompute assembly prices, review ambiguous
 * matches, and download regenerated files for committing to the repo.
 */

const McElliotUpdate = (function () {
  const esc = (s) => TakeoffUtils.escapeHtml(s);

  let activeTab = 'upload';
  let lastSummary = null; // {stats, matching, duplicateWarnings, categories: {cat: count}}

  // The review list is the biggest document this modal touches (hundreds of
  // KB). It is read once per render and kept here, so a decision costs a
  // splice and one row removal rather than a re-parse and 300 fresh rows.
  let reviewQueue = null;
  let reviewFilter = '';
  let reviewCategory = '';
  const REVIEW_RENDER_CAP = 200;

  function queueLength() {
    return reviewQueue ? reviewQueue.length : McElliotState.getQueue().length;
  }

  // ---------- modal plumbing ----------

  function show() {
    document.getElementById('mc-elliot-modal')?.setAttribute('aria-hidden', 'false');
    activeTab = 'upload';
    reviewFilter = '';
    reviewCategory = '';
    reviewQueue = null;
    renderTabs();
    renderBody();
    // vendor profiles and the book's own numbers load lazily; re-render the
    // upload form once both are available
    Promise.all([
      McElliotState.loadReferenceData(),
      typeof McBook !== 'undefined' && McBook.ensureLoaded ? McBook.ensureLoaded() : null,
    ]).then(() => {
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
    // the tab count reads the way the body does: 2,525, not 2525
    const tabs = [
      ['upload', 'Upload'],
      ['review', `Review Matches (${queueLength().toLocaleString()})`],
      ['summary', 'Summary'],
    ];
    el.innerHTML = tabs
      .map(([k, label]) => `<button type="button" class="labor-book-tab${k === activeTab ? ' active' : ''}" data-eltab="${k}">${esc(label)}</button>`)
      .join('');
  }

  // The status line holds what is TRUE of the screen right now — progress
  // ("Parsing…") and refusals ("Not downloaded — …"). renderBody() clears it,
  // which is correct for those and was fatal for confirmations: a decision on
  // a review row re-rendered the list and wiped its own receipt in the same
  // tick. Confirmations therefore go to the app's one feedback region instead.
  function setStatus(text) {
    const el = document.getElementById('mc-elliot-status');
    if (el) el.textContent = text;
  }

  const ELLIOT_TOAST_KEY = 'elliot';
  function announce(text, kind) {
    if (typeof TakeoffToast === 'undefined' || !text) return;
    TakeoffToast.show(text, { kind: kind || 'success', key: ELLIOT_TOAST_KEY, timeout: 8000 });
  }

  // ---------- upload tab ----------

  function currentProfile() {
    const profiles = McElliotState.getVendorProfiles();
    return profiles[McElliotState.getCurrentVendor()] || profiles.elliot || McElliotCore.ELLIOT_PROFILE;
  }

  const BOOK_TABS = ['gear', 'lighting', 'devices', 'conduit', 'wire', 'specialSystems'];

  /** What the book on screen is showing right now, straight from the book. */
  function publishedCatalog() {
    if (typeof McBook === 'undefined' || !McBook.elliotSectionsForTab) return null;
    let parts = 0;
    for (const tab of BOOK_TABS) {
      for (const section of McBook.elliotSectionsForTab(tab)) parts += (section.entries || []).length;
    }
    const at = McBook.elliotImportDate ? McBook.elliotImportDate() : null;
    return parts || at ? { parts, at } : null;
  }

  function renderUpload() {
    const overlay = McElliotState.getOverlay();
    const profiles = McElliotState.getVendorProfiles();
    const vendorKeys = Object.keys(profiles);
    const vendor = McElliotState.getCurrentVendor();
    const profile = currentProfile();
    const partsCount = overlay ? overlayItemCount(overlay) : 0;
    const published = publishedCatalog();
    // The first sentence has to be true: the book already carries a supply-house
    // price file, so say which one, and say plainly whether this computer has
    // changed anything.
    const publishedLine = published
      ? `The book's supply-house prices are from the file published${published.at ? ' ' + esc(published.at) : ''}${published.parts ? ` (${published.parts.toLocaleString()} parts)` : ''}.`
      : 'The book is showing its published prices.';
    const current = overlay
      ? `<p class="mc-elliot-current">This computer is showing <strong>${esc(overlay.sourceFile || 'a price file')}</strong> from ${esc((overlay.importedAt || '').slice(0, 10))} — ${Object.keys(overlay.itemPrices || {}).length.toLocaleString()} prices moved, ${partsCount.toLocaleString()} parts. Nobody else has these yet.
         <button type="button" class="btn btn-link" id="mc-elliot-clear-btn">Remove this price file</button></p>`
      : `<p class="mc-elliot-current">${publishedLine} Nothing has been changed on this computer.</p>`;
    const vendorSelect = vendorKeys.length
      ? `<label class="mc-elliot-vendor-wrap">Supplier:
           <select id="mc-elliot-vendor">${vendorKeys.map((k) => `<option value="${esc(k)}" ${k === vendor ? 'selected' : ''}>${esc(profiles[k].label || k)}</option>`).join('')}</select>
         </label>
         <span class="mc-elliot-hint">More suppliers can be added in mc-assemblies/vendor-profiles.json</span>`
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
      const matched = await McElliotMatch.runMatching(priceModel.items, deduped, mappings, (done, total) => {
        if (progressEl) {
          progressEl.max = total;
          progressEl.value = done;
        }
        if (progressText) progressText.textContent = `${done.toLocaleString()} / ${total.toLocaleString()} items`;
      });
      if (progressEl) progressEl.style.display = 'none';
      if (progressText) progressText.textContent = '';

      // one supplier part number prices one MC item: guesses that would take
      // a part number already in use go to the review list instead
      const result = McElliotCore.resolveMatchCollisions(matched, priceModel.items, deduped);

      // overlay item prices: matched items whose price moved > 0.1%
      const itemPrices = {};
      const itemPartNumbers = {}; // which supplier part priced each item
      for (const [itemNum, m] of Object.entries(result.auto)) {
        const oldP = priceModel.items[itemNum]?.p || 0;
        if (m.perEach > 0 && (oldP === 0 || Math.abs(m.perEach - oldP) / oldP > 0.001)) {
          itemPrices[itemNum] = Math.round(m.perEach * 10000) / 10000;
          itemPartNumbers[itemNum] = m.partNumber;
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

      const importedAt = new Date().toISOString();
      const priorOverlay = await McElliotState.getPriorPricedParts();
      const overlay = {
        version: 1,
        vendor: McElliotState.getCurrentVendor(),
        vendorLabel: currentProfile().label || 'Elliot Electric',
        sourceFile: sourceFile || 'pasted CSV',
        importedAt,
        enabledCategories: Object.keys(categoryCounts).filter((c) => categoryMapping[c]),
        allCats: true,
        itemPrices,
        itemPartNumbers,
        // parts keep their prior date when the price is unchanged
        newItems: McElliotCore.stampNewItemDates(newItems, priorOverlay, importedAt.slice(0, 10)),
      };
      McElliotState.saveOverlay(overlay);
      const { stored } = await McElliotState.saveNewItems(overlay.newItems);
      // rows the maintainer already passed on stay gone — otherwise every
      // upload re-derives the identical list and the work is undone
      const queueRows = McElliotCore.withoutSkipped(result.review, McElliotState.getSkippedItems());
      McElliotState.saveQueue(queueRows);
      reviewQueue = null;
      reviewFilter = '';
      reviewCategory = '';
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
        heldBack: result.heldBack || 0,
        pricesChanged: Object.keys(itemPrices).length,
        review: queueRows.length,
        passedOver: result.review.length - queueRows.length,
        stats: recompute ? recompute.stats : null,
        duplicateWarnings,
        categoryCounts,
        newItemsStored: stored,
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
    if (!overlay) return '<p>No price file loaded yet — start on the Upload tab.</p>';
    const s = lastSummary;
    const queueN = queueLength();
    const stats = s?.stats;
    const catMapping = McElliotState.getCategoryMapping() || {};
    const counts = s?.categoryCounts || overlay.categoryCounts || countCategories(overlay);

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
        <p><strong>${esc(overlay.sourceFile || 'The price file')}</strong> is loaded on this computer — the book already shows these prices. Nobody else has them yet.</p>
        <table class="mc-elliot-stats">
          ${s ? `<tr><td>Rows in file</td><td>${s.rows.toLocaleString()} (${s.uniqueParts.toLocaleString()} unique parts)</td></tr>` : ''}
          ${s ? `<tr><td>Matched by a saved match</td><td>${s.matchedSaved.toLocaleString()}</td></tr>` : ''}
          ${s ? `<tr><td>Matched automatically</td><td>${s.matchedAuto.toLocaleString()}</td></tr>` : ''}
          ${s && s.heldBack ? `<tr><td>Held back — the part number already prices another item</td><td>${s.heldBack.toLocaleString()} — sent to Review Matches</td></tr>` : ''}
          <tr><td>Part prices that moved</td><td>${Object.keys(overlay.itemPrices || {}).length.toLocaleString()}</td></tr>
          ${stats ? `<tr><td>Assemblies repriced</td><td>${stats.updated.toLocaleString()} (avg change ${stats.avgDeltaPct}%)</td></tr>` : ''}
          ${stats ? `<tr><td>Assemblies left at the old price ⚠ (the book's formula didn't add up)</td><td>${stats.flagged.toLocaleString()}</td></tr>` : ''}
          <tr><td>Needs review</td><td>${queueN.toLocaleString()} — see Review Matches tab</td></tr>
          ${s?.passedOver ? `<tr><td>Passed over before, not asked again</td><td>${s.passedOver.toLocaleString()}</td></tr>` : ''}
          ${s?.duplicateWarnings?.length ? `<tr><td>Duplicate part numbers with differing prices</td><td>${s.duplicateWarnings.length} (lowest price kept)</td></tr>` : ''}
        </table>
        <h3>Sort supplier categories into tabs</h3>
        <p class="mc-elliot-hint">Pick where each supplier category's parts appear in the book — changes apply immediately. "Skip" leaves a category out entirely.</p>
        ${overlay.allCats ? '' : '<p class="mc-elliot-hint">⚠ This price file was loaded by an older version — load it again to turn previously skipped categories back on.</p>'}
        <div class="mc-elliot-cats">${catChecks || '<em>none</em>'}</div>
        ${overlay.newItemsIncomplete ? '<p class="mc-elliot-warn">⚠ This browser would not store the supply-house parts list, so the book keeps the parts already published — the new prices above still applied. Try again with fewer other tabs open, or hand the price file to whoever maintains the site.</p>' : ''}
        <h3>Send the new prices to everyone</h3>
        <p class="mc-elliot-hint">Right now only this computer sees them. Download these four files and hand them to whoever maintains the site; once they are published, every estimator's book updates on their next reload. They replace the files of the same name in <code>mc-assemblies/</code>.</p>
        <div class="mc-elliot-actions">
          <button type="button" class="btn btn-success" id="mc-elliot-dl-book">Download mc-labor-book.json</button>
          <button type="button" class="btn btn-secondary" id="mc-elliot-dl-overlay">Download elliot-price-overlay.json</button>
          <button type="button" class="btn btn-secondary" id="mc-elliot-dl-mappings">Download elliot-item-mappings.json</button>
          <button type="button" class="btn btn-secondary" id="mc-elliot-dl-catmap">Download elliot-category-mapping.json</button>
        </div>
      </div>`;
  }

  function countCategories(overlay) {
    if (overlay && overlay.categoryCounts) return overlay.categoryCounts;
    const counts = {};
    for (const [cat] of (overlay && overlay.newItems) || []) counts[cat] = (counts[cat] || 0) + 1;
    return counts;
  }

  /** Supply-house parts this computer holds, whether or not the list is loaded. */
  function overlayItemCount(overlay) {
    if (!overlay) return 0;
    if (typeof overlay.newItemsCount === 'number') return overlay.newItemsCount;
    return (overlay.newItems || []).length;
  }

  // ---------- review tab ----------

  const fmtEach = (p) => McElliotCore.formatUnitPrice(p);
  const UNCATEGORIZED = 'Other';

  function rowCategory(q) {
    return q.category || UNCATEGORIZED;
  }

  /** The review rows the filter box and the category picker leave standing. */
  function filteredQueue() {
    const queue = reviewQueue || [];
    const matcher = reviewFilter.trim() ? TakeoffUtils.makeTokenMatcher(reviewFilter) : null;
    return queue.filter((q) => {
      if (reviewCategory && rowCategory(q) !== reviewCategory) return false;
      if (!matcher) return true;
      const hay = [q.itemName, rowCategory(q)].concat((q.candidates || []).map((c) => c.desc + ' ' + c.pn)).join(' ');
      return matcher(hay);
    });
  }

  function reviewRowHtml(q) {
    const opts = (q.candidates || [])
      .map((c, i) => `<option value="${i}">${esc(c.desc)} — $${fmtEach(c.perEach)} (${Math.round(c.score * 100)}%)</option>`)
      .join('');
    // a held-back guess: the part number is already pricing another item,
    // so say whose it is rather than taking it silently
    const why = q.heldPartNumber
      ? `<div class="mc-elliot-review-held">Part ${esc(q.heldPartNumber)} prices <strong>${esc(q.heldByItemName || '')}</strong> today. Match moves it here; Not this leaves it there.</div>`
      : q.reason
        ? `<div class="mc-elliot-review-why">${esc(q.reason)}</div>`
        : '';
    return `
        <div class="mc-elliot-review-row${q.heldPartNumber ? ' has-held' : ''}" data-itemnum="${q.itemNum}">
          <div class="mc-elliot-review-item"><strong>${esc(q.itemName)}</strong> <span class="mc-book-section-count">$${fmtEach(q.oldPerEach)}/ea</span></div>
          <select class="mc-elliot-review-select">${opts}</select>
          <button type="button" class="btn btn-small btn-success mc-elliot-review-match">Match</button>
          <button type="button" class="btn btn-small btn-secondary mc-elliot-review-skip">Not this</button>
          ${why}
        </div>`;
  }

  function renderReview() {
    if (!reviewQueue) reviewQueue = McElliotState.getQueue();
    if (!reviewQueue.length) return '<p>Nothing to look at — uncertain matches appear here after a price file is loaded.</p>';

    // one line per trade: the reviewer works a category at a time
    const counts = {};
    for (const q of reviewQueue) counts[rowCategory(q)] = (counts[rowCategory(q)] || 0) + 1;
    const catOptions = Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([cat, n]) => `<option value="${esc(cat)}" ${cat === reviewCategory ? 'selected' : ''}>${esc(cat)} (${n.toLocaleString()})</option>`)
      .join('');

    return `
      <p class="mc-elliot-hint" id="mc-elliot-review-count">${reviewCountText()}</p>
      <div class="mc-elliot-review-controls">
        <input type="search" id="mc-elliot-review-filter" placeholder="Filter by part name" value="${esc(reviewFilter)}" />
        <select id="mc-elliot-review-cat">
          <option value="">All categories (${reviewQueue.length.toLocaleString()})</option>
          ${catOptions}
        </select>
      </div>
      <div id="mc-elliot-review-list">${renderReviewList()}</div>`;
  }

  function renderReviewList() {
    const shown = filteredQueue();
    if (!shown.length) return '<p class="mc-elliot-hint">Nothing matches that filter.</p>';
    const groups = {};
    for (const q of shown.slice(0, REVIEW_RENDER_CAP)) {
      const cat = rowCategory(q);
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(q);
    }
    const groupHtml = Object.entries(groups)
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(
        ([cat, rows]) => `
        <section class="mc-elliot-review-group" data-cat="${esc(cat)}">
          <h4>${esc(cat)} <span class="mc-book-section-count" data-groupcount>${rows.length.toLocaleString()}</span></h4>
          ${rows.map(reviewRowHtml).join('')}
        </section>`
      )
      .join('');
    return (
      groupHtml +
      (shown.length > REVIEW_RENDER_CAP
        ? `<p class="mc-elliot-hint" id="mc-elliot-review-cap">Showing the first ${REVIEW_RENDER_CAP} of ${shown.length.toLocaleString()} — narrow it down with the box above.</p>`
        : '')
    );
  }

  /** Re-draw only the list: the filter box keeps focus. */
  function refreshReviewList() {
    const list = document.getElementById('mc-elliot-review-list');
    if (list) list.innerHTML = renderReviewList();
  }

  function reviewCountText() {
    return `${(reviewQueue || []).length.toLocaleString()} parts have a likely match the computer would not take on its own. Match one, or say Not this — both are remembered for every future price file.`;
  }

  /** Update the counts a decision moved, without rebuilding the list. */
  function refreshReviewCounts() {
    const el = document.getElementById('mc-elliot-review-count');
    if (el) el.textContent = reviewCountText();
    const cap = document.getElementById('mc-elliot-review-cap');
    if (cap) {
      const drawn = document.querySelectorAll('.mc-elliot-review-row').length;
      cap.textContent = `Showing the first ${drawn} of ${filteredQueue().length.toLocaleString()} — narrow it down with the box above.`;
    }
    renderTabs();
  }

  function dropReviewRow(row) {
    const group = row.closest('.mc-elliot-review-group');
    row.remove();
    if (!group) return;
    const left = group.querySelectorAll('.mc-elliot-review-row').length;
    if (!left) {
      group.remove();
      return;
    }
    const countEl = group.querySelector('[data-groupcount]');
    if (countEl) countEl.textContent = left.toLocaleString();
  }

  function applyDecisions(decisions) {
    const out = McElliotState.resolveQueueItems(decisions);
    const done = new Set(decisions.map((d) => Number(d.itemNum)));
    reviewQueue = (reviewQueue || []).filter((q) => !done.has(Number(q.itemNum)));
    McElliotState.invalidateRecompute();
    if (typeof McBook !== 'undefined' && McBook.invalidate) McBook.invalidate();
    if (typeof TakeoffLaborBookView !== 'undefined' && TakeoffLaborBookView.refreshAssembliesIfVisible) TakeoffLaborBookView.refreshAssembliesIfVisible();
    return out;
  }

  function onReviewClick(e) {
    const row = e.target.closest('.mc-elliot-review-row');
    if (!row) return;
    const itemNum = Number(row.dataset.itemnum);
    const q = (reviewQueue || []).find((x) => Number(x.itemNum) === itemNum);
    if (!q) return;
    let status = '';
    if (e.target.closest('.mc-elliot-review-match')) {
      const sel = row.querySelector('.mc-elliot-review-select');
      const cand = q.candidates[Number(sel.value)];
      if (!cand) return;
      const { tookFrom } = applyDecisions([{ itemNum, partNumber: cand.pn, perEach: cand.perEach }]);
      status =
        `Matched "${q.itemName}" to ${cand.desc} at $${fmtEach(cand.perEach)}. Remembered for future price files.` +
        (tookFrom.length ? ` Part ${cand.pn} no longer prices "${q.heldByItemName || 'the item that held it'}".` : '');
    } else if (e.target.closest('.mc-elliot-review-skip')) {
      applyDecisions([{ itemNum, partNumber: null, perEach: null }]);
      status = `Passed on "${q.itemName}" — it will not come back on the next price file.`;
    } else {
      return;
    }
    // one row leaves the page; the other 199 stay exactly where they are
    dropReviewRow(row);
    refreshReviewCounts();
    announce(status);
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

  /** The copy of an artifact everyone else already has, or null. */
  async function publishedFile(name) {
    try {
      const res = await fetch('mc-assemblies/' + name);
      return res.ok ? await res.json() : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Every download says how big it is next to the file it replaces. A file
   * that arrives smaller than the published one is how a catalog gets deleted
   * for everybody, and comparing sizes by hand was the only safety net.
   */
  function sizeLine(what, count, publishedCount) {
    const n = count.toLocaleString();
    if (publishedCount == null) return `${n} ${what}.`;
    if (count < publishedCount) {
      return `${n} ${what} — ${(publishedCount - count).toLocaleString()} fewer than the published file. Check the whole price file loaded before you send this on.`;
    }
    return `${n} ${what} (published file: ${publishedCount.toLocaleString()}).`;
  }

  async function downloadPatchedBook() {
    setStatus('Building book...');
    const res = await fetch('mc-assemblies/mc-labor-book.json');
    const book = await res.json();
    const patched = await McElliotState.getPatchedBook(book);
    // never hand out a book that carries fewer supply-house parts than the
    // one everyone already has — that file would delete their catalog
    const before = McElliotCore.countSupplierEntries(book);
    const after = McElliotCore.countSupplierEntries(patched);
    if (after < before) {
      setStatus(
        `Not downloaded — this book would drop ${(before - after).toLocaleString()} supply-house parts (${before.toLocaleString()} → ${after.toLocaleString()}). Load the price file again before sending prices to everyone.`
      );
      return;
    }
    download('mc-labor-book.json', patched);
    announce('Downloaded mc-labor-book.json — ' + sizeLine('supply-house parts', after, before));
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
    document.addEventListener('keydown', function mcElliotKeyHandler(e) {
      const modal = document.getElementById('mc-elliot-modal');
      if (!modal || modal.getAttribute('aria-hidden') !== 'false') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        hide();
      }
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
        if (confirm('Remove the price file loaded on this computer? The book goes back to the published prices and parts. Your saved matches and the review list are kept.')) {
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
        setStatus('Building elliot-price-overlay.json...');
        // the file everyone else reads carries the parts list, never this
        // computer's own bookkeeping (row counts, storage flags)
        const overlay = await McElliotState.getFullOverlay();
        if (!overlay) {
          setStatus('Not downloaded — no price file is loaded on this computer.');
          return;
        }
        const out = McElliotCore.sanitizeOverlayForDownload(overlay);
        if (!Array.isArray(out.newItems) || !out.newItems.length) {
          setStatus('Not downloaded — this computer does not hold the supply-house parts list, so the file would arrive empty.');
          return;
        }
        const publishedOverlay = await publishedFile('elliot-price-overlay.json');
        download('elliot-price-overlay.json', out);
        announce(
          'Downloaded elliot-price-overlay.json — ' +
            sizeLine('parts', out.newItems.length, publishedOverlay && Array.isArray(publishedOverlay.newItems) ? publishedOverlay.newItems.length : null)
        );
        return;
      }
      if (e.target.id === 'mc-elliot-dl-catmap') {
        const mapping = McElliotState.getCategoryMapping() || {};
        const publishedMap = await publishedFile('elliot-category-mapping.json');
        download('elliot-category-mapping.json', {
          comment: 'Maps supplier CSV categories to Labor & Price Book tabs. null = skip.',
          mapping,
        });
        announce(
          'Downloaded elliot-category-mapping.json — ' +
            sizeLine('categories', Object.keys(mapping).length, publishedMap && publishedMap.mapping ? Object.keys(publishedMap.mapping).length : null)
        );
        return;
      }
      if (e.target.id === 'mc-elliot-dl-mappings') {
        const mappings = McElliotState.getEffectiveMappings();
        const skipped = Array.from(McElliotState.getSkippedItems()).sort((a, b) => a - b);
        const publishedMappings = await publishedFile('elliot-item-mappings.json');
        download('elliot-item-mappings.json', {
          version: 1,
          comment: 'Confirmed Elliot partNumber -> MC itemNum matches; skipped = MC items to leave out of the review list.',
          mappings,
          skipped,
        });
        announce(
          'Downloaded elliot-item-mappings.json — ' +
            sizeLine('confirmed matches', Object.keys(mappings).length, publishedMappings && publishedMappings.mappings ? Object.keys(publishedMappings.mappings).length : null) +
            (skipped.length ? ` ${skipped.length.toLocaleString()} passed over.` : '')
        );
        return;
      }
      onReviewClick(e);
    });

    document.getElementById('mc-elliot-body')?.addEventListener('input', (e) => {
      if (e.target.id !== 'mc-elliot-review-filter') return;
      reviewFilter = e.target.value;
      refreshReviewList();
    });

    document.getElementById('mc-elliot-body')?.addEventListener('change', (e) => {
      if (e.target.id === 'mc-elliot-review-cat') {
        reviewCategory = e.target.value;
        refreshReviewList();
        return;
      }
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
      announce(`"${sel.dataset.elcatdest}" now ${sel.value ? 'goes to the ' + sel.options[sel.selectedIndex].text + ' tab' : 'is skipped'}.`);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { show, hide };
})();
