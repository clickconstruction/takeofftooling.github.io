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

  // MC categories whose names read as glitches out of context. They're real
  // estimating tools: the "$1 / 1 hr" units nudge a bid by a known amount,
  // and TI Work holds per-sq-ft budget rates. Friendlier headers + a note.
  const LEVEL1_DISPLAY = {
    '1$ Mat & 1 Hr Labor': {
      label: 'Adjustment units ($1 material · 1 hr labor)',
      note: 'MC placeholders — add N of them to move a line by a known amount',
    },
    'TI Work': {
      label: 'Tenant Improvement budget rates',
      note: 'conceptual per-sq-ft and per-device rates for early budgets',
    },
    Grounding: {
      label: 'Grounding',
      note: 'ground rods and mast guy kits',
    },
  };

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

  /**
   * The shorthand on the screens this book feeds: the curated rows' fitting
   * codes and the assembly tree's own section codes. The Abbreviation Key
   * modal is generated from this list (js/views/laborBook.js), and
   * decodeSectionName below builds the tree's tooltips from the same table, so
   * the key can't drift from the words it is meant to decode.
   */
  const ABBREVIATIONS = [
    {
      group: 'Fittings',
      items: [
        ['SS', 'set screw'],
        ['CP', 'compression'],
        ['st', 'steel — next to a connector or coupling'],
        ['cn', 'connector'],
        ['insl.', 'insulated throat'],
        ['CP.INSL', 'compression fitting, insulated throat'],
        ['RGS', 'rigid steel'],
        ['RT', 'raintight'],
        ['D/S', 'die-cast body, set screw'],
        ['S/S', 'steel body, set screw'],
        ['D/C', 'die-cast body, compression'],
        ['S/C', 'steel body, compression'],
        ['(S)', 'set-screw fitting (curated rows)'],
        ['(R)', 'raintight fitting (curated rows)'],
        ['W/C', 'with clamp — e.g. a ground rod sold with its clamp'],
        ['BC', 'beam clamp'],
      ],
    },
    {
      group: 'Enclosures and gear',
      items: [
        ['N1', 'indoor enclosure'],
        ['N3R', 'raintight enclosure'],
        ['N4R', 'dusttight enclosure'],
        ['N4X', 'corrosion-resistant enclosure'],
        ['MLO', 'main lugs only — no main breaker'],
        ['1PH / 3PH', 'single phase / three phase'],
      ],
    },
    {
      group: 'In the assemblies tree',
      items: [
        ['encl cb', 'enclosed circuit breaker'],
        ['seb', 'service-entrance breaker enclosure'],
        ['gd / hd', 'general duty / heavy duty safety switch'],
        ['nf / f', 'non-fused / fused'],
        ['mtr h/u', 'motor hookup'],
        ['d/s strap', 'strap run using die-cast set-screw fittings'],
      ],
    },
  ];

  // Codes worth decoding when they appear in an assembly section name, longest
  // first so "encl cb" wins over "cb".
  const SECTION_CODE_HINTS = [
    ['encl cb', 'enclosed circuit breaker'],
    ['mtr h/u', 'motor hookup'],
    ['seb', 'service-entrance breaker enclosure'],
    ['gd', 'general duty'],
    ['hd', 'heavy duty'],
    ['nf', 'non-fused'],
    ['f', 'fused'],
    ['n1', 'indoor enclosure'],
    ['n3r', 'raintight enclosure'],
    ['n4x', 'corrosion-resistant enclosure'],
    ['d/s', 'die-cast, set screw'],
    ['s/s', 'steel, set screw'],
    ['d/c', 'die-cast, compression'],
    ['s/c', 'steel, compression'],
    ['w/c', 'with clamp'],
    ['bc', 'beam clamp'],
    ['mlo', 'main lugs only'],
    ['rgs', 'rigid steel'],
    ['1ph', 'single phase'],
    ['3ph', 'three phase'],
  ];

  /** "switch gd 3ph n3r nf" → "gd = general duty · 3ph = three phase · ..." */
  function decodeSectionName(name) {
    const n = ` ${String(name || '').toLowerCase()} `;
    const bits = [];
    const used = new Set();
    for (const [code, meaning] of SECTION_CODE_HINTS) {
      if (used.has(code)) continue;
      // whole word only: "f" must not decode every word holding an f
      if (new RegExp(`[^a-z0-9/]${code.replace(/[/]/g, '\\/')}[^a-z0-9/]`).test(n)) {
        used.add(code);
        bits.push(`${code} = ${meaning}`);
      }
    }
    return bits.join(' · ');
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
          <td class="mc-book-entry-add"><button type="button" class="btn btn-secondary mc-book-entry-add-btn" data-idx="${sectionIdx}" data-entry="${ei}" title="Add this assembly's components to the fixture">${TakeoffViewShared.CHILD_ARROW_SVG} Add</button></td>
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
   * An unpriced component carries price `null`, never 0 — the purchase list
   * counts a 0 as a real price and stops flagging the gap.
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
        const p = Number(overlayPrices[num] !== undefined ? overlayPrices[num] : it.p);
        return { description: it.n, qty, labor: it.l || 0, price: p > 0 ? p : null };
      });
    } catch (_) {
      return null;
    }
  }

  // How far the components' own prices may sit from the book price and still
  // be treated as the same number. Exploding is only honest when the parts add
  // back up to the row the estimator clicked; across the whole book they often
  // do not (median ratio 1.10, p90 18.7), and the bid then silently carries a
  // price nobody was shown. Anything outside the band lands rolled up.
  const PRICE_TOLERANCE = 0.10;

  /** Sum of the components' extended prices, or null if any is unpriced. */
  function componentsPrice(comps) {
    if (!comps || !comps.length) return null;
    let sum = 0;
    for (const c of comps) {
      if (!(Number(c.price) > 0)) return null;
      sum += Number(c.price) * (Number(c.qty) || 0);
    }
    return sum;
  }

  function componentsLabor(comps) {
    let sum = 0;
    for (const c of comps || []) sum += (Number(c.labor) || 0) * (Number(c.qty) || 0);
    return sum;
  }

  /** True when the components reconstruct the book price within tolerance. */
  function compositionReconstructsBook(comps, entry) {
    const bookPrice = Number(entry && entry.price) || 0;
    if (!(bookPrice > 0)) return false;
    const sum = componentsPrice(comps);
    if (sum === null) return false;
    return Math.abs(sum - bookPrice) <= bookPrice * PRICE_TOLERANCE;
  }

  function renderBom(comps, entry) {
    const r2 = (n) => Math.round(n * 10000) / 10000;
    let totLabor = 0;
    let totPrice = 0;
    let unpriced = 0;
    const rows = comps
      .map((c) => {
        totLabor += (Number(c.labor) || 0) * c.qty;
        totPrice += (Number(c.price) || 0) * c.qty;
        if (!(c.price > 0)) unpriced++;
        return `
        <tr>
          <td class="mc-book-bom-qty">${r2(c.qty)}</td>
          <td>${escapeHtml(c.description)}</td>
          <td class="mc-book-entry-labor">${r2(Number(c.labor) || 0)}</td>
          <td class="mc-book-entry-price">${c.price > 0 ? '$' + Number(c.price).toFixed(4) : '—'}</td>
        </tr>`;
      })
      .join('');
    // A partly/fully unpriced component list can't compute a real unit price;
    // showing "$0.26 vs book $57.34" reads like a bug. Say what's happening —
    // and say which price Add will actually put on the bid.
    const priceCell = unpriced === 0 ? `$${totPrice.toFixed(2)}` : '—';
    const bookBits = `${entry.labor || 0} hrs, ${fmtPrice(entry.price) || '$0'}`;
    let label;
    if (unpriced > 0) {
      label = `${unpriced === comps.length ? 'Components' : `${unpriced} of ${comps.length} components`} unpriced — Add uses the book price (${bookBits})`;
    } else if (compositionReconstructsBook(comps, entry)) {
      label = `Components add back up to the book price (${bookBits}) — Add explodes them`;
    } else {
      label = `Components total $${totPrice.toFixed(2)} against the book's ${bookBits} — Add uses the book price`;
    }
    return `
      <table class="mc-book-bom">
        <thead><tr><th>Qty/unit</th><th>Component</th><th>hrs/ea</th><th>$/ea</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td></td><td>${label}</td><td>${Math.round(totLabor * 1000) / 1000}</td><td>${priceCell}</td></tr></tfoot>
      </table>`;
  }

  function sectionMeta(s) {
    const bits = [s.level3, s.subsection ? `in ${s.section}` : ''].filter(Boolean);
    return bits.length ? `<span class="mc-book-section-meta">${escapeHtml(bits.join(' · '))}</span>` : '';
  }

  function renderSection(s, idx) {
    // the tree is written in MC's shorthand; the same table the Abbreviation
    // Key is built from decodes it on hover
    const decoded = decodeSectionName(s.name);
    const title = decoded ? ` title="${escapeHtml(decoded)}"` : '';
    return `
      <div class="mc-book-section" data-idx="${idx}">
        <div class="mc-book-section-header">
          <span class="labor-book-section-chevron"></span>
          <span class="mc-book-section-name"${title}>${escapeHtml(s.name)}</span>
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
      const rank = TakeoffUtils.makeSearchRanker(term);
      const hits = [];
      for (const [s, i] of pairs) {
        // a section whose own name matches outranks one that only holds a
        // matching entry, and a literal-word match outranks an abbreviation
        const nameScore = rank(`${s.name} ${s.section || ''}`);
        const score = nameScore ? nameScore + 2 : (s.entries.some((e) => rank(`${e.name} ${s.name}`)) ? 1 : 0);
        if (score) hits.push({ s, i, score });
        if (hits.length >= MAX_SEARCH_SECTIONS) break;
      }
      const matches = TakeoffUtils.rankedByScore(hits).map((h) => [h.s, h.i]);
      html = matches.map(([s, i]) => renderSection(s, i)).join('');
      html =
        `<div class="mc-book-result-count">${matches.length >= MAX_SEARCH_SECTIONS ? `First ${MAX_SEARCH_SECTIONS} matching sections` : `${matches.length} matching section${matches.length === 1 ? '' : 's'}`}</div>` +
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
        const display = LEVEL1_DISPLAY[l1];
        // the note is its own line under the header, not a third thing running
        // on after the label and the count
        const l1Note = display && display.note ? `<div class="mc-book-group-note">${escapeHtml(display.note)}</div>` : '';
        html += `
        <div class="labor-book-group labor-book-group-collapsed mc-book-group">
          <h2 class="labor-book-group-header"><span class="labor-book-section-chevron"></span><span class="mc-book-group-label">${escapeHtml(display ? display.label : l1)}</span> <span class="mc-book-section-count">${sectionTotal}</span></h2>
          ${l1Note}
          <div class="labor-book-group-body">
            ${subsHtml}
          </div>
        </div>`;
      }
    }
    container.innerHTML = html;
  }

  const hrs = (n) => Math.round((Number(n) || 0) * 100) / 100;

  function targetNote() {
    const note = TakeoffLaborBookTargets.getLastTargetNote?.();
    return note ? ` · ${note}` : '';
  }

  /**
   * Add one assembly entry to the current target. It explodes into components
   * only when those components add back up to the book price the row and the
   * BOM footer just showed; otherwise the rolled-up entry lands at the book's
   * own labor and price. Either way the flash says which price was used.
   * Resolves a status string (or null if the add failed/was blocked).
   */
  async function addAssemblyEntry(entry) {
    const rolledUp = () =>
      TakeoffLaborBookView.addEntryToTarget({
        description: entry.name,
        labor: entry.labor || 0,
        price: entry.price ? String(entry.price) : null,
      });
    const bookBits = `${hrs(entry.labor)} hrs — ${fmtPrice(entry.price) || '$0.00'}`;

    // fill mode replaces one row: use the rolled-up assembly, not components
    if (TakeoffLaborBookView.hasFillTarget && TakeoffLaborBookView.hasFillTarget()) {
      const ok = rolledUp();
      return ok ? `Filled the row with ${entry.name} — ${bookBits}, book price` : null;
    }
    const comps = await getComposition(entry.assmNum);
    if (comps && comps.length && compositionReconstructsBook(comps, entry)) {
      const ok = TakeoffLaborBookView.addComponentsToTarget(comps);
      if (!ok) return null;
      const msg = `Added ${comps.length} components of ${entry.name} — ${hrs(componentsLabor(comps))} hrs — ${fmtPrice(componentsPrice(comps))}, from components${targetNote()}`;
      TakeoffLaborBookTargets.flashTargetNote(msg);
      return msg;
    }
    const ok = rolledUp();
    if (!ok) return null;
    const msg = `Added ${entry.name} — ${bookBits}, book price${targetNote()}`;
    TakeoffLaborBookTargets.flashTargetNote(msg);
    return msg;
  }

  // hits collected before ranking; the best `cap` of them are returned
  const SEARCH_SCAN_CAP = 600;
  let lastAssemblyTotal = 0;

  /** How many assemblies the last searchAssemblies() matched (scan-capped). */
  function lastSearchTotal() {
    return lastAssemblyTotal;
  }

  /**
   * Search assembly entries across ALL tabs (Elliot part sections excluded).
   * Returns [{tab, sectionName, entry, score}] best-match-first, capped at
   * `cap`. Ranking is what lets the abbreviation synonyms exist: a row holding
   * the words the estimator typed comes before one reached through "cb".
   */
  function searchAssemblies(term, cap = 100) {
    lastAssemblyTotal = 0;
    if (!(term || '').trim() || !book) return [];
    // every query token must match, in any order; section names carry
    // meaning for terse entry names, so they join the haystack
    const rank = TakeoffUtils.makeSearchRanker(term);
    const hits = [];
    for (const tab of TakeoffState.getLaborBookTabOrder()) {
      for (const [s] of assemblySectionsForTab(tab)) {
        for (const entry of s.entries) {
          const score = rank(`${entry.name} ${s.name}`);
          if (score) hits.push({ tab, sectionName: s.name, entry, score });
          if (hits.length >= SEARCH_SCAN_CAP) break;
        }
        if (hits.length >= SEARCH_SCAN_CAP) break;
      }
      if (hits.length >= SEARCH_SCAN_CAP) break;
    }
    lastAssemblyTotal = hits.length;
    return TakeoffUtils.rankedByScore(hits).slice(0, cap);
  }

  function onTreeClick(e) {
    const addBtn = e.target.closest('.mc-book-entry-add-btn');
    if (addBtn) {
      const s = sectionsForTab(currentTab())[Number(addBtn.dataset.idx)];
      const entry = s && s.entries[Number(addBtn.dataset.entry)];
      // addAssemblyEntry flashes the result under the "Add to" banner, which is
      // visible from the Parts side and search too; the toolbar keeps saying
      // how much of the book is loaded.
      if (entry) addAssemblyEntry(entry);
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
      // Plain words: offline is the ordinary case on a job site, and the
      // service worker keeps the book once it has been opened over a
      // connection, so say that rather than naming a file (J11-F7).
      if (status) status.textContent = 'The parts book is not available offline yet — connect once and it will be saved on this device.';
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
    // Escape is not handled here: laborBook.js's one document-level handler
    // owns it for the whole modal (clear the filter, then close).
    document.getElementById('mc-book-search')?.addEventListener('input', onSearchInput);
    document.getElementById('mc-book-tree')?.addEventListener('click', onTreeClick);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { renderAssemblies, sectionCount, invalidate, ensureLoaded, elliotSectionsForTab, elliotImportDate, searchAssemblies, lastSearchTotal, addAssemblyEntry, getComposition, renderBom, compositionReconstructsBook, componentsPrice, decodeSectionName, ABBREVIATIONS, PRICE_TOLERANCE };
})();
