/**
 * Assemblies renderer for the Labor & Price Book modal: browses the MC
 * assembly book (mc-assemblies/mc-labor-book.json, with the Elliot price
 * overlay applied) inside the #labor-book-assemblies panel. The active tab
 * is shared with the Parts section via TakeoffState.getActiveLaborBookTab().
 */

const McBook = (function () {
  const DATA_URL = 'mc-assemblies/mc-labor-book.json';
  const MAX_SEARCH_SECTIONS = 150;
  const DEBOUNCE_MS = 250;

  let book = null;
  let debounceTimer = null;

  function escapeHtml(str) {
    return TakeoffUtils.escapeHtml(str);
  }

  function currentTab() {
    return TakeoffState.getActiveLaborBookTab();
  }

  function sectionsForTab(tab) {
    return (book && book.tabs && book.tabs[tab]) || [];
  }

  // Elliot supply-house items are parts, not assemblies: they render in the
  // Parts section (laborBook.js pulls them via elliotSectionsForTab), so the
  // Assemblies tree works on the non-Elliot sections only. Original indexes
  // are kept so lazy entry loading stays valid.
  function assemblySectionsForTab(tab) {
    const out = [];
    const all = sectionsForTab(tab);
    for (let i = 0; i < all.length; i++) {
      if (!all[i].supplier && all[i].level1 !== 'Elliot') out.push([all[i], i]);
    }
    return out;
  }

  function elliotSectionsForTab(tab) {
    return sectionsForTab(tab).filter((s) => s.supplier || s.level1 === 'Elliot');
  }

  // When the supplier import last priced the catalog (YYYY-MM-DD, or null).
  // Entries without their own pricedAt fall back to this.
  function elliotImportDate() {
    const at = book?.meta?.elliot?.importedAt;
    return at ? String(at).slice(0, 10) : null;
  }

  // MC picker column order for top-level categories
  const LEVEL1_ORDER = [
    'Branch', 'Wire', 'Branch with Constants', 'Feeder', 'Feeder with Constants',
    'Hangers/Racks', 'Devices', 'Equipment', 'Fixtures', 'Grounding', 'Telephone',
    'Industrial', 'Heavy Industrial', 'HVAC', 'Special Systems', 'Voice/Data',
    'Site/Highway', 'Underground systems', 'Residential', 'T-D Construction',
    'TI Work', '1$ Mat & 1 Hr Labor', 'Elliot',
  ];

  function level1Rank(name) {
    const i = LEVEL1_ORDER.indexOf(name);
    return i === -1 ? LEVEL1_ORDER.length : i;
  }

  function fmtPrice(p) {
    const n = Number(p) || 0;
    return n ? `$${n.toFixed(2)}` : '';
  }

  function renderEntries(section, sectionIdx) {
    const rows = section.entries
      .map(
        (e, ei) => `
        <tr class="mc-book-entry-row" data-assm="${e.assmNum ?? ''}">
          <td class="mc-book-entry-add"><button type="button" class="btn btn-secondary mc-book-entry-add-btn" data-idx="${sectionIdx}" data-entry="${ei}" title="Add this assembly's components to the fixture">+ Add</button></td>
          <td class="mc-book-entry-name"><span class="mc-book-bom-toggle" title="Show components">▸</span> ${escapeHtml(e.name)}${e.flag ? ' <span class="mc-book-entry-flag" title="Elliot component prices changed, but this assembly’s price formula can’t be verified — price not auto-updated.">⚠</span>' : ''}</td>
          <td class="mc-book-entry-labor">${e.labor || 0}</td>
          <td class="mc-book-entry-price">${fmtPrice(e.price)}</td>
        </tr>`
      )
      .join('');
    return `
      <table class="mc-book-entries">
        <thead><tr><th></th><th>Name</th><th>Labor (hrs)</th><th>Price</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  /**
   * Component list for an assembly, with Elliot overlay prices applied.
   * Returns [{description, qty, labor, price}] or null if unavailable.
   */
  async function getComposition(assmNum) {
    if (typeof McElliotState === 'undefined' || !assmNum) return null;
    try {
      const { priceModel } = await McElliotState.loadReferenceData();
      const a = priceModel.assemblies[assmNum];
      if (!a || !a.c || !a.c.length) return null;
      const overlayPrices = McElliotState.getOverlay()?.itemPrices || {};
      return a.c.map(([num, qty]) => {
        const it = priceModel.items[num] || { n: `item #${num}`, p: 0, l: 0 };
        const p = overlayPrices[num] !== undefined ? overlayPrices[num] : it.p;
        return { description: it.n, qty, labor: it.l || 0, price: p };
      });
    } catch (_) {
      return null;
    }
  }

  function renderBom(comps, entry) {
    const r2 = (n) => Math.round(n * 10000) / 10000;
    let totLabor = 0;
    let totPrice = 0;
    const rows = comps
      .map((c) => {
        totLabor += c.labor * c.qty;
        totPrice += c.price * c.qty;
        return `
        <tr>
          <td class="mc-book-bom-qty">${r2(c.qty)}</td>
          <td>${escapeHtml(c.description)}</td>
          <td class="mc-book-entry-labor">${r2(c.labor)}</td>
          <td class="mc-book-entry-price">$${c.price.toFixed(4)}</td>
        </tr>`;
      })
      .join('');
    return `
      <table class="mc-book-bom">
        <thead><tr><th>Qty/unit</th><th>Component</th><th>hrs/ea</th><th>$/ea</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td></td><td>Computed per unit (book: ${entry.labor || 0} hrs, ${fmtPrice(entry.price) || '$0'})</td><td>${Math.round(totLabor * 1000) / 1000}</td><td>$${totPrice.toFixed(2)}</td></tr></tfoot>
      </table>`;
  }

  function sectionMeta(s) {
    const bits = [s.level3, s.subsection ? `in ${s.section}` : ''].filter(Boolean);
    return bits.length ? `<span class="mc-book-section-meta">${escapeHtml(bits.join(' · '))}</span>` : '';
  }

  function renderSection(s, idx) {
    return `
      <div class="mc-book-section" data-idx="${idx}">
        <div class="mc-book-section-header">
          <span class="labor-book-section-chevron"></span>
          <span class="mc-book-section-name">${escapeHtml(s.name)}</span>
          ${sectionMeta(s)}
          <span class="mc-book-section-count">${s.entries.length}</span>
        </div>
        <div class="mc-book-section-body" data-loaded="0"></div>
      </div>`;
  }

  function renderTree() {
    const container = document.getElementById('mc-book-tree');
    if (!container || !book) return;
    const term = (document.getElementById('mc-book-search')?.value || '').trim().toLowerCase();
    const pairs = assemblySectionsForTab(currentTab());

    let html = '';
    if (term) {
      const matches = [];
      for (const [s, i] of pairs) {
        const inName = s.name.toLowerCase().includes(term) || (s.section || '').toLowerCase().includes(term);
        const inEntries = !inName && s.entries.some((e) => e.name.toLowerCase().includes(term));
        if (inName || inEntries) matches.push([s, i]);
        if (matches.length >= MAX_SEARCH_SECTIONS) break;
      }
      html = matches.map(([s, i]) => renderSection(s, i)).join('');
      html =
        `<div class="mc-book-result-count">${matches.length >= MAX_SEARCH_SECTIONS ? `First ${MAX_SEARCH_SECTIONS} matching sections` : `${matches.length} matching sections`}</div>` +
        (html || '<p class="mc-book-empty">No matches in this tab.</p>');
    } else {
      // Nested nav mirroring the MC picker: level1 category -> level2 subsection -> sections
      const level1s = new Map(); // level1 -> Map(level2 -> [section index])
      const sectionByIdx = new Map(pairs.map(([s, i]) => [i, s]));
      pairs.forEach(([s, i]) => {
        if (!level1s.has(s.level1)) level1s.set(s.level1, new Map());
        const subs = level1s.get(s.level1);
        const l2 = s.level2 || 'General';
        if (!subs.has(l2)) subs.set(l2, []);
        subs.get(l2).push(i);
      });
      const ordered = [...level1s.keys()].sort((a, b) => level1Rank(a) - level1Rank(b));
      for (const l1 of ordered) {
        const subs = level1s.get(l1);
        const sectionTotal = [...subs.values()].reduce((n, idxs) => n + idxs.length, 0);
        let subsHtml = '';
        for (const [l2, idxs] of subs) {
          if (subs.size === 1 && (l2 === 'General' || l2 === l1)) {
            // single flat subsection: skip the redundant level-2 header
            subsHtml += idxs.map((i) => renderSection(sectionByIdx.get(i), i)).join('');
            continue;
          }
          subsHtml += `
          <div class="mc-book-subgroup mc-book-subgroup-collapsed">
            <h3 class="mc-book-subgroup-header"><span class="labor-book-section-chevron"></span>${escapeHtml(l2)} <span class="mc-book-section-count">${idxs.length}</span></h3>
            <div class="mc-book-subgroup-body">
              ${idxs.map((i) => renderSection(sectionByIdx.get(i), i)).join('')}
            </div>
          </div>`;
        }
        html += `
        <div class="labor-book-group labor-book-group-collapsed mc-book-group">
          <h2 class="labor-book-group-header"><span class="labor-book-section-chevron"></span>${escapeHtml(l1)} <span class="mc-book-section-count">${sectionTotal}</span></h2>
          <div class="labor-book-group-body">
            ${subsHtml}
          </div>
        </div>`;
      }
    }
    container.innerHTML = html;
  }

  /**
   * Exploded add of one assembly entry: components land individually;
   * falls back to the rolled-up entry when no composition exists.
   * Resolves a status string (or null if the add failed/was blocked).
   */
  async function addAssemblyEntry(entry) {
    // fill mode replaces one row: use the rolled-up assembly, not components
    if (TakeoffLaborBookView.hasFillTarget && TakeoffLaborBookView.hasFillTarget()) {
      const ok = TakeoffLaborBookView.addEntryToTarget({
        description: entry.name,
        labor: entry.labor || 0,
        price: entry.price ? String(entry.price) : null,
      });
      return ok ? `Filled the row with "${entry.name}".` : null;
    }
    const comps = await getComposition(entry.assmNum);
    if (comps && comps.length) {
      const ok = TakeoffLaborBookView.addComponentsToTarget(comps);
      return ok ? `Added ${comps.length} components of "${entry.name}" to the selected target.` : null;
    }
    const ok = TakeoffLaborBookView.addEntryToTarget({
      description: entry.name,
      labor: entry.labor || 0,
      price: entry.price ? String(entry.price) : null,
    });
    return ok ? `Added "${entry.name}" to the selected target.` : null;
  }

  /**
   * Search assembly entries across ALL tabs (Elliot part sections excluded).
   * Returns [{tab, sectionName, entry}] capped at `cap`.
   */
  function searchAssemblies(term, cap = 100) {
    const norm = (s) => (s || '').toLowerCase().replace(/["“”]/g, '');
    const t = norm(term).trim();
    if (!t || !book) return [];
    const out = [];
    for (const tab of TakeoffState.getLaborBookTabOrder()) {
      for (const [s] of assemblySectionsForTab(tab)) {
        for (const entry of s.entries) {
          if (norm(entry.name).includes(t)) {
            out.push({ tab, sectionName: s.name, entry });
            if (out.length >= cap) return out;
          }
        }
      }
    }
    return out;
  }

  function onTreeClick(e) {
    const addBtn = e.target.closest('.mc-book-entry-add-btn');
    if (addBtn) {
      const s = sectionsForTab(currentTab())[Number(addBtn.dataset.idx)];
      const entry = s && s.entries[Number(addBtn.dataset.entry)];
      if (entry) {
        addAssemblyEntry(entry).then((msg) => {
          const status = document.getElementById('mc-book-status');
          if (msg && status) status.textContent = msg;
        });
      }
      return;
    }
    const bomToggle = e.target.closest('.mc-book-bom-toggle');
    if (bomToggle) {
      const row = bomToggle.closest('.mc-book-entry-row');
      const next = row.nextElementSibling;
      if (next && next.classList.contains('mc-book-bom-row')) {
        next.remove();
        bomToggle.textContent = '▸';
        return;
      }
      const table = row.closest('table');
      const secEl = row.closest('.mc-book-section, .mc-book-section-body')?.closest('.mc-book-section') || row.closest('.mc-book-section');
      const sIdx = Number(secEl?.dataset.idx);
      const entryIdx = [...table.querySelectorAll('.mc-book-entry-row')].indexOf(row);
      const entry = sectionsForTab(currentTab())[sIdx]?.entries[entryIdx];
      if (!entry) return;
      bomToggle.textContent = '▾';
      const bomRow = document.createElement('tr');
      bomRow.className = 'mc-book-bom-row';
      bomRow.innerHTML = '<td></td><td colspan="3" class="mc-book-bom-cell">Loading components...</td>';
      row.after(bomRow);
      getComposition(entry.assmNum).then((comps) => {
        bomRow.querySelector('.mc-book-bom-cell').innerHTML = comps && comps.length
          ? renderBom(comps, entry)
          : '<em>No component breakdown available for this assembly.</em>';
      });
      return;
    }
    const subgroupHeader = e.target.closest('.mc-book-subgroup-header');
    if (subgroupHeader) {
      subgroupHeader.closest('.mc-book-subgroup')?.classList.toggle('mc-book-subgroup-collapsed');
      return;
    }
    const groupHeader = e.target.closest('.labor-book-group-header');
    if (groupHeader) {
      groupHeader.closest('.labor-book-group')?.classList.toggle('labor-book-group-collapsed');
      return;
    }
    const sectionHeader = e.target.closest('.mc-book-section-header');
    if (sectionHeader) {
      const sectionEl = sectionHeader.closest('.mc-book-section');
      const body = sectionEl?.querySelector('.mc-book-section-body');
      if (!body) return;
      const expanded = sectionEl.classList.toggle('mc-book-section-expanded');
      if (expanded && body.dataset.loaded === '0') {
        const idx = Number(sectionEl.dataset.idx);
        const s = sectionsForTab(currentTab())[idx];
        if (s) {
          body.innerHTML = renderEntries(s, idx);
          body.dataset.loaded = '1';
        }
      }
    }
  }

  async function loadData() {
    if (book) return;
    const status = document.getElementById('mc-book-status');
    if (status) status.textContent = 'Loading MC book...';
    try {
      const res = await fetch(DATA_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let loaded = await res.json();
      if (typeof McElliotState !== 'undefined') {
        loaded = await McElliotState.getPatchedBook(loaded);
      }
      book = loaded;
      if (status) {
        const total = Object.values(book.meta?.tabs || {}).reduce((n, t) => n + (t.entries || 0), 0);
        const elliot = book.meta?.elliot;
        status.textContent =
          `${total.toLocaleString()} assemblies loaded.` +
          (elliot ? ` Elliot prices applied (${elliot.updated.toLocaleString()} repriced, ${elliot.newItems.toLocaleString()} new items).` : '') +
          ' Expand a category, or search.';
      }
    } catch (err) {
      if (status) status.textContent = 'Could not load mc-assemblies/mc-labor-book.json — serve the app locally.';
    }
  }

  /** Force a re-fetch + overlay re-patch on next render (called after Elliot updates). */
  function invalidate() {
    book = null;
  }

  /** Render the Assemblies panel for the current shared tab. */
  async function renderAssemblies() {
    await loadData();
    renderTree();
  }

  function sectionCount(tab) {
    return assemblySectionsForTab(tab).length;
  }

  /** Ensure the book (with Elliot overlay) is loaded; used by the Parts side. */
  async function ensureLoaded() {
    await loadData();
  }

  function onSearchInput() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(renderTree, DEBOUNCE_MS);
  }

  function init() {
    document.getElementById('mc-book-search')?.addEventListener('input', onSearchInput);
    document.getElementById('mc-book-search')?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') TakeoffApp.hideLaborBookModal();
    });
    document.getElementById('mc-book-tree')?.addEventListener('click', onTreeClick);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { renderAssemblies, sectionCount, invalidate, ensureLoaded, elliotSectionsForTab, elliotImportDate, searchAssemblies, addAssemblyEntry, getComposition, renderBom };
})();
