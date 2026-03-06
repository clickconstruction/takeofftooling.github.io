/**
 * MC Price Book modal - searchable parts data from McCormick Systems
 */

const TakeoffMcPriceBookView = (function () {
  const DISPLAY_LIMIT = 500;
  const SEARCH_DEBOUNCE_MS = 150;

  let data = null;
  let loadPromise = null;

  function escapeHtml(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatPrice(val) {
    if (val == null || val === '') return '—';
    const n = Number(val);
    if (isNaN(n)) return String(val);
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatNum(val) {
    if (val == null || val === '') return '—';
    const n = Number(val);
    if (isNaN(n)) return String(val);
    return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  function hasExcludedUom(row) {
    const uoms = [row.bookPriceUom, row.price1Uom, row.bidLbrUom, row.neca1Uom];
    return uoms.some((u) => u === 'X');
  }

  function loadData() {
    if (data) return Promise.resolve(data);
    if (loadPromise) return loadPromise;
    loadPromise = fetch('js/data/mcPriceBook.json')
      .then((r) => r.json())
      .then((arr) => {
        data = arr;
        return data;
      })
      .catch((err) => {
        loadPromise = null;
        throw err;
      });
    return loadPromise;
  }

  function filterData(query) {
    if (!data) return [];
    const q = (query || '').trim().toLowerCase();
    if (!q) return data;
    return data.filter((row) => {
      const name = (row.itemName || '').toLowerCase();
      const no = (row.itemNo || '').toLowerCase();
      const upc = (row.dciUpc || '').toLowerCase().replace(/\s/g, '');
      const qNorm = q.replace(/\s/g, '');
      return name.includes(q) || no.includes(q) || upc.includes(qNorm) || (row.dciUpc || '').toLowerCase().includes(q);
    });
  }

  function renderResults(filtered) {
    const container = document.getElementById('mc-price-book-results');
    if (!container) return;

    const total = filtered.length;
    const display = filtered.slice(0, DISPLAY_LIMIT);
    const truncated = total > DISPLAY_LIMIT;

    let html = '<table class="mc-price-book-table"><thead><tr>';
    html += '<th>Item #</th><th>Item Name</th><th>Book Price</th><th>UOM</th>';
    html += '<th>Price 1</th><th>Bid Lbr</th><th>NECA 1</th><th>DCI / UPC</th>';
    html += '</tr></thead><tbody>';

    for (const row of display) {
      const excluded = hasExcludedUom(row);
      const rowClass = excluded ? 'mc-price-book-row-excluded' : '';
      const badge = excluded ? ' <span class="mc-price-book-x-badge">X</span>' : '';
      html += `<tr class="${rowClass}">`;
      html += `<td>${escapeHtml(row.itemNo)}</td>`;
      html += `<td>${escapeHtml(row.itemName)}${badge}</td>`;
      html += `<td>${formatPrice(row.bookPrice)}</td>`;
      html += `<td>${escapeHtml(row.bookPriceUom || '')}</td>`;
      html += `<td>${formatPrice(row.price1)}</td>`;
      html += `<td>${formatNum(row.bidLbr)}</td>`;
      html += `<td>${formatNum(row.neca1)}</td>`;
      html += `<td>${escapeHtml(row.dciUpc || '')}</td>`;
      html += '</tr>';
    }

    html += '</tbody></table>';

    if (truncated) {
      html = `<p class="mc-price-book-results-count">Showing first ${DISPLAY_LIMIT} of ${total.toLocaleString()} results</p>` + html;
    } else if (total > 0) {
      html = `<p class="mc-price-book-results-count">${total.toLocaleString()} results</p>` + html;
    } else {
      html = '<p class="mc-price-book-empty">No results. Try a different search.</p>';
    }

    container.innerHTML = html;
  }

  function debounce(fn, ms) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function attachListeners() {
    const searchEl = document.getElementById('mc-price-book-search');
    if (searchEl) {
      searchEl.value = '';
      searchEl.addEventListener(
        'input',
        debounce(() => {
          const q = searchEl.value;
          const filtered = filterData(q);
          renderResults(filtered);
        }, SEARCH_DEBOUNCE_MS)
      );
    }
  }

  function show() {
    const modal = document.getElementById('mc-price-book-modal');
    if (!modal) return;

    modal.setAttribute('aria-hidden', 'false');
    document.getElementById('mc-price-book-results').innerHTML = '<p class="mc-price-book-loading">Loading price book...</p>';

    loadData()
      .then(() => {
        const q = document.getElementById('mc-price-book-search')?.value || '';
        const filtered = filterData(q);
        renderResults(filtered);
        attachListeners();
      })
      .catch((err) => {
        document.getElementById('mc-price-book-results').innerHTML =
          '<p class="mc-price-book-error">Failed to load price book: ' + escapeHtml(err.message) + '</p>';
      });
  }

  function hide() {
    const modal = document.getElementById('mc-price-book-modal');
    if (modal) modal.setAttribute('aria-hidden', 'true');
  }

  document.getElementById('search-mc-price-book-btn')?.addEventListener('click', () => {
    TakeoffApp.showMcPriceBookModal();
  });

  document.getElementById('mc-price-book-close-btn')?.addEventListener('click', () => {
    TakeoffMcPriceBookView.hide();
  });

  document.getElementById('mc-price-book-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'mc-price-book-modal') TakeoffMcPriceBookView.hide();
  });

  window.TakeoffMcPriceBookView = { show, hide };
  return { show, hide };
})();
