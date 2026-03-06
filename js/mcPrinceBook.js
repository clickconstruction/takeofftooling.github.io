/**
 * MC Prince Book - Searchable full-page modal for file1_improved.csv
 */

const McPrinceBook = (function () {
  const CSV_URL = 'file1_improved.csv';
  const MAX_DISPLAY_ROWS = 500;
  const DEBOUNCE_MS = 300;

  let cachedData = null;
  let cachedHeaders = null;
  let debounceTimer = null;

  function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if (c === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += c;
      }
    }
    result.push(current.trim());
    return result;
  }

  function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length === 0) return { headers: [], rows: [] };
    const headers = parseCSVLine(lines[0]);
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = parseCSVLine(lines[i]);
      rows.push(cells);
    }
    return { headers, rows };
  }

  function escapeHtml(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function filterRows(rows, searchTerm) {
    if (!searchTerm || !searchTerm.trim()) return rows;
    const term = searchTerm.trim().toLowerCase();
    return rows.filter((row) =>
      row.some((cell) => (cell || '').toLowerCase().includes(term))
    );
  }

  function renderTable(headers, filteredRows, totalMatchCount, searchTerm) {
    const thead = document.getElementById('mc-prince-thead');
    const tbody = document.getElementById('mc-prince-tbody');
    const footer = document.getElementById('mc-prince-result-count');

    if (!thead || !tbody || !footer) return;

    thead.innerHTML = `<tr>${headers.map((h) => `<th>${escapeHtml(h || '')}</th>`).join('')}</tr>`;

    const displayRows = filteredRows.slice(0, MAX_DISPLAY_ROWS);
    tbody.innerHTML = displayRows
      .map(
        (row) =>
          `<tr>${row.map((cell) => `<td>${escapeHtml(cell || '')}</td>`).join('')}</tr>`
      )
      .join('');

    const truncated = filteredRows.length > MAX_DISPLAY_ROWS;
    const hasSearch = searchTerm && String(searchTerm).trim();
    if (hasSearch) {
      footer.textContent = truncated
        ? `Showing first ${MAX_DISPLAY_ROWS.toLocaleString()} of ${totalMatchCount.toLocaleString()} matches`
        : `Showing ${totalMatchCount.toLocaleString()} matches`;
    } else {
      footer.textContent = truncated
        ? `Showing first ${MAX_DISPLAY_ROWS.toLocaleString()} of ${totalMatchCount.toLocaleString()} rows (type to search)`
        : `Showing ${totalMatchCount.toLocaleString()} rows (type to search)`;
    }
  }

  function runSearch() {
    const searchInput = document.getElementById('mc-prince-search');
    const term = searchInput?.value || '';

    if (!cachedData || !cachedHeaders) return;

    const filtered = filterRows(cachedData.rows, term);
    renderTable(cachedHeaders, filtered, filtered.length, term);
  }

  function onSearchInput() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runSearch, DEBOUNCE_MS);
  }

  async function loadData() {
    if (cachedData) return;
    try {
      const res = await fetch(CSV_URL);
      const text = await res.text();
      const { headers, rows } = parseCSV(text);
      cachedHeaders = headers;
      cachedData = { headers, rows };
    } catch (err) {
      const footer = document.getElementById('mc-prince-result-count');
      if (footer) footer.textContent = 'Failed to load: ' + (err.message || 'Unknown error');
    }
  }

  function showModal() {
    const modal = document.getElementById('mc-prince-modal');
    const footer = document.getElementById('mc-prince-result-count');
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'false');
    if (footer) footer.textContent = 'Loading...';
    loadData().then(() => {
      runSearch();
      document.getElementById('mc-prince-search')?.focus();
    });
  }

  function hideModal() {
    const modal = document.getElementById('mc-prince-modal');
    if (modal?.contains(document.activeElement)) {
      document.activeElement?.blur();
    }
    if (modal) modal.setAttribute('aria-hidden', 'true');
  }

  function init() {
    document.getElementById('search-mc-prince-btn')?.addEventListener('click', showModal);
    document.getElementById('mc-prince-close-btn')?.addEventListener('click', hideModal);
    document.getElementById('mc-prince-search')?.addEventListener('input', onSearchInput);
    document.getElementById('mc-prince-search')?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideModal();
    });
    document.getElementById('mc-prince-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'mc-prince-modal') hideModal();
    });
  }

  init();

  return { showModal, hideModal };
})();
