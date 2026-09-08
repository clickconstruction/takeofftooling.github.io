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

  // A change log with a date on every line reads as a trail only in date
  // order; back-dated quotes and import lines otherwise interleave. Undated
  // entries sort last, and same-day lines keep the order they happened in.
  function inDateOrder(history) {
    return (history || [])
      .map((h, i) => ({ h, i }))
      .sort((a, b) => String(b.h.at || '').localeCompare(String(a.h.at || '')) || a.i - b.i)
      .map((x) => x.h);
  }

  function viewModel() {
    if (current.mode === 'book') {
      const row = bookRow();
      if (!row) return null;
      // No synthetic offer: a hand-typed price is a real offer on the row now
      // (TakeoffState.noteHandPrice), so nothing here has to invent one — and
      // the first real quote no longer replaces a row that was never recorded.
      return {
        name: row.name || '(unnamed part)',
        partNumber: row.partNumber || '',
        labor: row.labor ?? '',
        offers: row.offers || [],
        inUse: (row.priceSource || '').toLowerCase(),
        history: inDateOrder(row.history),
        editable: true,
      };
    }
    const e = current.entry;
    return {
      name: e.name,
      partNumber: e.partNumber || '',
      labor: '',
      offers: e.price ? [{ supplier: current.vendor, price: Number(e.price), at: e.pricedAt, by: 'import' }] : [],
      inUse: current.vendor.toLowerCase(),
      history: [],
      editable: true, // editing promotes into the book
    };
  }

  // 'You' is the source of a price somebody typed in. It is not a supply
  // house, and the offers table is a list of supply houses.
  function supplierLabel(supplier) {
    return supplier === TakeoffState.HAND_PRICED ? 'Hand-priced' : supplier;
  }

  // The date cell is editable now, so the freshness tier the row badge shows
  // rides on the date's own colour rather than a separate badge.
  function whenTier(at) {
    const days = TakeoffViewShared.priceAgeDays(at);
    if (days === null) return '';
    return days < 30 ? 'pc-when-fresh' : days <= 90 ? 'pc-when-aging' : 'pc-when-stale';
  }

  function whenTitle(at) {
    const days = TakeoffViewShared.priceAgeDays(at);
    if (days === null) return "No date recorded — type one, or leave it blank if you don't know";
    return `${days === 0 ? 'Quoted today' : `${days} days old`} — correct the date here without re-recording the price`;
  }

  function supplierSuggestions() {
    const names = new Set(['Elliot']);
    const book = TakeoffState.getLaborBook();
    for (const tab of Object.keys(book)) {
      for (const section of Object.keys(book[tab] || {})) {
        for (const row of book[tab][section]) {
          // a hand-typed price is not a supply house — keep it out of the list
          if (row.priceSource && row.priceSource !== TakeoffState.HAND_PRICED) names.add(row.priceSource);
          for (const o of row.offers || []) {
            if (o.supplier !== TakeoffState.HAND_PRICED) names.add(o.supplier);
          }
        }
      }
    }
    if (current?.mode === 'catalog') names.add(current.vendor);
    return Array.from(names);
  }

  // Where this part lives, so a card titled "6" reads "Gear · Panels · 1PH · 6"
  function contextTrail() {
    const labels = TakeoffState.LABOR_BOOK_TYPE_LABELS || {};
    const tab = current.mode === 'book' ? current.type : current.tab;
    const section = current.mode === 'book' ? current.section : current.sectionName;
    // dotted section names ("Panels.1PH") are sub-tables — show each level
    const parts = [labels[tab] || tab, ...(section || '').split('.')].filter(Boolean);
    return parts.join(' · ');
  }

  function render() {
    const body = document.getElementById('part-card-body');
    const vm = current && viewModel();
    if (!body || !vm) return;
    const offersHtml = vm.offers.length
      ? vm.offers
          .map((o) => {
            const active = o.supplier.toLowerCase() === vm.inUse;
            return `
            <tr>
              <td>${escapeHtml(supplierLabel(o.supplier))}</td>
              <td class="pc-num">$${TakeoffUtils.formatMoney(o.price)}</td>
              <td class="pc-when-cell"><input type="date" class="pc-offer-date ${whenTier(o.at)}" value="${escapeHtml(o.at || '')}" data-supplier="${escapeHtml(o.supplier)}" title="${escapeHtml(whenTitle(o.at))}" /></td>
              <td class="pc-who">${escapeHtml(o.by || '—')}</td>
              <td class="pc-use-cell"><button type="button" class="pc-use-btn${active ? ' active' : ''}" data-supplier="${escapeHtml(o.supplier)}" ${active ? 'disabled' : ''}>${active ? 'In use' : 'Use'}</button></td>
            </tr>`;
          })
          .join('')
      : '<tr><td colspan="5" class="pc-empty">No prices recorded yet.</td></tr>';
    const historyHtml = vm.history.length
      ? vm.history
          .map((h) => {
            const what =
              h.kind === 'labor'
                ? `labor ${TakeoffUtils.formatHours(h.value)}`
                : `$${TakeoffUtils.formatMoney(h.value)} ${escapeHtml(supplierLabel(h.supplier || ''))}`;
            return `<li><span class="pc-hist-date">${escapeHtml(h.at || 'no date')}</span> ${what} — <span class="pc-hist-by">${escapeHtml(h.by || '')}</span></li>`;
          })
          .join('')
      : '<li class="pc-empty">No changes recorded yet.</li>';

    body.innerHTML = `
      <div class="pc-head">
        <div class="pc-context">${escapeHtml(contextTrail())}</div>
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
        <p class="pc-note">In use is the price this book row carries. Parts already on a bid keep the price they were added with.</p>
        <div class="pc-record">
          <input type="text" id="part-card-supplier" list="part-card-suppliers" placeholder="Supply house" autocomplete="off" />
          <datalist id="part-card-suppliers">${supplierSuggestions().map((s) => `<option value="${escapeHtml(s)}"></option>`).join('')}</datalist>
          <input type="text" inputmode="decimal" id="part-card-price" placeholder="Price" />
          <input type="date" id="part-card-date" value="${TakeoffViewShared.todayISO()}" title="Leave blank if you don't know the date" />
          <button type="button" class="btn btn-primary" id="part-card-record-btn">Record price</button>
        </div>
        <p class="pc-error" id="part-card-error" hidden></p>
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
    // Correcting where a price came from is not the same as re-quoting it:
    // the date can be fixed — or cleared, for a quote whose date nobody
    // remembers — without touching the number.
    body.querySelectorAll('.pc-offer-date').forEach((input) => {
      input.addEventListener('change', () => {
        const target = ensureBookTarget();
        TakeoffState.updatePartOffer(target.type, target.section, target.index, input.dataset.supplier, { at: input.value });
        refresh();
      });
    });
    body.querySelector('#part-card-record-btn').addEventListener('click', () => {
      const supplierEl = body.querySelector('#part-card-supplier');
      const supplier = supplierEl.value.trim();
      const priceEl = body.querySelector('#part-card-price');
      // quotes get typed the way they're written: '$21,450.75', '1,975'
      const price = TakeoffUtils.parseMoney(priceEl.value);
      // a blank date is an answer, not an omission: "last month sometime"
      const at = body.querySelector('#part-card-date').value;
      const badPrice = price == null || Number.isNaN(price);
      priceEl.classList.toggle('lb-price-invalid', badPrice);
      priceEl.setAttribute('aria-invalid', badPrice ? 'true' : 'false');
      supplierEl.classList.toggle('lb-price-invalid', !supplier);
      supplierEl.setAttribute('aria-invalid', supplier ? 'false' : 'true');
      const errEl = body.querySelector('#part-card-error');
      // the button used to do nothing at all, with no message anywhere
      const problem = !supplier
        ? 'Which supply house quoted this? Type their name first.'
        : badPrice
          ? 'Type the price as money — 1,975 or $19.75.'
          : '';
      errEl.textContent = problem;
      errEl.hidden = !problem;
      if (problem) return;
      const target = ensureBookTarget();
      TakeoffState.recordPartPrice(target.type, target.section, target.index, { supplier, price, at });
      refresh();
    });
  }

  // Catalog parts join the editable book on first edit (promote-on-edit —
  // shared with the inline catalog inputs via TakeoffState.promoteCatalogPart).
  function ensureBookTarget() {
    if (current.mode === 'book') return current;
    const { tab, sectionName, vendor, entry } = current;
    const { section, index } = TakeoffState.promoteCatalogPart(tab, sectionName, vendor, entry);
    // the book underneath re-renders on the next refresh: open the section the
    // part just landed in, so closing the card doesn't hide it
    if (typeof TakeoffLaborBookView !== 'undefined') TakeoffLaborBookView.markSectionOpen(section);
    current = { mode: 'book', type: tab, section, index };
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
