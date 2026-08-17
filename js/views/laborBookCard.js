/**
 * The part card (#part-card-modal): one card per part — every supply house's
 * current offer, a form to record new quotes, and the append-only change
 * history with names. Opens from the provenance badge on curated rows and
 * (via openForCatalogPart) from supplier catalog rows; the first edit to a
 * catalog part PROMOTES it into the editable book in its universal section,
 * after which the card operates on the book row. Stacks above the Labor &
 * Price Book modal; its Escape handler stops propagation so the book stays
 * open underneath.
 */

const TakeoffLaborBookCard = (function () {
  // {mode:'book', type, section, index}
  // {mode:'catalog', tab, sectionName, vendor, entry:{name, partNumber, price, pricedAt}}
  let current = null;

  function escapeHtml(str) {
    return TakeoffUtils.escapeHtml(str);
  }

  function bookRow() {
    if (!current || current.mode !== 'book') return null;
    return TakeoffState.getLaborBookType(current.type)?.[current.section]?.[current.index] || null;
  }

  function viewModel() {
    if (current.mode === 'book') {
      const row = bookRow();
      if (!row) return null;
      let offers = row.offers || [];
      let synthetic = false;
      if (!offers.length && row.price !== '' && row.price != null && row.priceSource) {
        // a price set inline before any quotes were recorded
        offers = [{ supplier: row.priceSource, price: Number(row.price), at: row.pricedAt, by: null }];
        synthetic = true;
      }
      return {
        name: row.name || '(unnamed part)',
        partNumber: row.partNumber || '',
        labor: row.labor ?? '',
        offers,
        synthetic,
        inUse: (row.priceSource || '').toLowerCase(),
        history: row.history || [],
        editable: true,
      };
    }
    const e = current.entry;
    return {
      name: e.name,
      partNumber: e.partNumber || '',
      labor: '',
      offers: e.price ? [{ supplier: current.vendor, price: Number(e.price), at: e.pricedAt, by: 'import' }] : [],
      synthetic: false,
      inUse: current.vendor.toLowerCase(),
      history: [],
      editable: true, // editing promotes into the book
    };
  }

  function supplierSuggestions() {
    const names = new Set(['Elliot']);
    const book = TakeoffState.getLaborBook();
    for (const tab of Object.keys(book)) {
      for (const section of Object.keys(book[tab] || {})) {
        for (const row of book[tab][section]) {
          if (row.priceSource && row.priceSource !== 'You') names.add(row.priceSource);
          for (const o of row.offers || []) names.add(o.supplier);
        }
      }
    }
    if (current?.mode === 'catalog') names.add(current.vendor);
    return Array.from(names);
  }

  function render() {
    const body = document.getElementById('part-card-body');
    const vm = current && viewModel();
    if (!body || !vm) return;
    const badge = (at) => TakeoffViewShared.renderPriceProvenance(null, at);
    const offersHtml = vm.offers.length
      ? vm.offers
          .map((o) => {
            const active = o.supplier.toLowerCase() === vm.inUse;
            return `
            <tr>
              <td>${escapeHtml(o.supplier)}</td>
              <td class="pc-num">$${Number(o.price).toFixed(2)}</td>
              <td>${badge(o.at)}</td>
              <td class="pc-who">${escapeHtml(o.by || '—')}</td>
              <td class="pc-use-cell"><button type="button" class="pc-use-btn${active ? ' active' : ''}" data-supplier="${escapeHtml(o.supplier)}" ${active ? 'disabled' : ''}>${active ? 'In use' : 'Use'}</button></td>
            </tr>`;
          })
          .join('')
      : '<tr><td colspan="5" class="pc-empty">No prices recorded yet.</td></tr>';
    const historyHtml = vm.history.length
      ? vm.history
          .map((h) => {
            const what = h.kind === 'labor' ? `labor ${h.value}` : `$${Number(h.value).toFixed(2)} ${escapeHtml(h.supplier || '')}`;
            return `<li><span class="pc-hist-date">${escapeHtml(h.at || '')}</span> ${what} — <span class="pc-hist-by">${escapeHtml(h.by || '')}</span></li>`;
          })
          .join('')
      : '<li class="pc-empty">No changes recorded yet.</li>';

    body.innerHTML = `
      <div class="pc-head">
        <div class="pc-title-row">
          <h2 class="pc-title">${escapeHtml(vm.name)}</h2>
          <button type="button" class="btn btn-secondary" id="part-card-close-btn">Close</button>
        </div>
        <div class="pc-meta">
          <label>Part # <input type="text" id="part-card-partnum" value="${escapeHtml(vm.partNumber)}" placeholder="Part #" /></label>
          <label>Labor (hrs) <input type="number" id="part-card-labor" value="${vm.labor}" min="0" step="0.05" placeholder="0" /></label>
        </div>
      </div>
      <div class="pc-body">
        <h4>Prices by supply house</h4>
        <table class="pc-offers">
          <thead><tr><th>Supplier</th><th class="pc-num">Price</th><th>When</th><th>By</th><th></th></tr></thead>
          <tbody>${offersHtml}</tbody>
        </table>
        <div class="pc-record">
          <input type="text" id="part-card-supplier" list="part-card-suppliers" placeholder="Supplier" autocomplete="off" />
          <datalist id="part-card-suppliers">${supplierSuggestions().map((s) => `<option value="${escapeHtml(s)}"></option>`).join('')}</datalist>
          <input type="number" id="part-card-price" min="0" step="0.01" placeholder="Price" />
          <input type="date" id="part-card-date" value="${TakeoffViewShared.todayISO()}" />
          <button type="button" class="btn btn-primary" id="part-card-record-btn">Record price</button>
        </div>
        <h4>History</h4>
        <ul class="pc-history">${historyHtml}</ul>
      </div>`;

    body.querySelector('#part-card-close-btn').addEventListener('click', close);
    body.querySelector('#part-card-partnum').addEventListener('change', (e) => {
      const target = ensureBookTarget();
      TakeoffState.updateLaborBookRow(target.type, target.section, target.index, { partNumber: e.target.value.trim() });
      refresh();
    });
    body.querySelector('#part-card-labor').addEventListener('change', (e) => {
      const target = ensureBookTarget();
      TakeoffState.recordPartLabor(target.type, target.section, target.index, parseFloat(e.target.value) || 0);
      refresh();
    });
    body.querySelectorAll('.pc-use-btn:not(.active)').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = ensureBookTarget();
        TakeoffState.usePartOffer(target.type, target.section, target.index, btn.dataset.supplier);
        refresh();
      });
    });
    body.querySelector('#part-card-record-btn').addEventListener('click', () => {
      const supplier = body.querySelector('#part-card-supplier').value.trim();
      const price = parseFloat(body.querySelector('#part-card-price').value);
      const at = body.querySelector('#part-card-date').value;
      if (!supplier || Number.isNaN(price)) return;
      const target = ensureBookTarget();
      TakeoffState.recordPartPrice(target.type, target.section, target.index, { supplier, price, at });
      refresh();
    });
  }

  // Catalog parts join the editable book on first edit: same universal
  // section (created if the tab doesn't have it yet), carrying the part #
  // and the supplier's offer as the first history entry.
  function ensureBookTarget() {
    if (current.mode === 'book') return current;
    const { tab, sectionName, vendor, entry } = current;
    if (!TakeoffState.getLaborBookType(tab)[sectionName]) {
      TakeoffState.addLaborBookSection(tab, sectionName);
    }
    const at = entry.pricedAt || null;
    TakeoffState.addLaborBookRow(tab, sectionName, {
      name: entry.name,
      labor: 0,
      price: entry.price != null && entry.price !== '' ? String(entry.price) : '',
      partNumber: entry.partNumber || '',
      priceSource: entry.price ? vendor : undefined,
      pricedAt: entry.price ? at : undefined,
      offers: entry.price ? [{ supplier: vendor, price: Number(entry.price), at, by: 'import' }] : [],
      history: entry.price ? [{ at, kind: 'price', supplier: vendor, value: Number(entry.price), by: 'import' }] : [],
    });
    const index = TakeoffState.getLaborBookType(tab)[sectionName].length - 1;
    current = { mode: 'book', type: tab, section: sectionName, index };
    return current;
  }

  function refresh() {
    render();
    // reflect promotions/edits in the book underneath
    if (typeof TakeoffLaborBookView !== 'undefined') {
      TakeoffLaborBookView.render();
      TakeoffLaborBookView.attachListeners();
    }
  }

  function isOpen() {
    return document.getElementById('part-card-modal')?.getAttribute('aria-hidden') === 'false';
  }

  function open(target) {
    current = target;
    document.getElementById('part-card-modal')?.setAttribute('aria-hidden', 'false');
    render();
  }

  function openForBookRow(type, section, index) {
    open({ mode: 'book', type, section, index });
  }

  function openForCatalogPart(tab, sectionName, vendor, entry) {
    open({ mode: 'catalog', tab, sectionName, vendor, entry });
  }

  function close() {
    const modal = document.getElementById('part-card-modal');
    if (modal?.contains(document.activeElement)) document.activeElement?.blur();
    modal?.setAttribute('aria-hidden', 'true');
    current = null;
  }

  document.getElementById('part-card-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'part-card-modal') close();
  });

  // registered before laborBook.js's hotkey handler, so stopping immediate
  // propagation keeps one Escape from also closing the book underneath
  document.addEventListener('keydown', function partCardKeyHandler(e) {
    if (e.key !== 'Escape' || !isOpen()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close();
  });

  return { openForBookRow, openForCatalogPart, close, isOpen };
})();
