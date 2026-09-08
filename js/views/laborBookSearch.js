/**
 * Labor & Price Book global search — spans Assemblies, Parts, and Elliot
 * parts (assemblies fill in asynchronously once the book loads).
 *
 * Owns the search term and the last result set; the one-time listeners for
 * the search input and the results panel attach at load. The view
 * (TakeoffLaborBookView) reads getTerm() to decide search mode and calls
 * renderResults() when in it. Loaded before js/views/laborBook.js.
 */

const TakeoffLaborBookSearch = (function () {
  const SEARCH_CAP = 80;
  // hits collected before ranking; the best SEARCH_CAP of these are rendered
  const SCAN_CAP = 600;

  // The three buckets are three different shapes of a part, and the estimator
  // has to pick between them: say what each one brings rather than naming one
  // after a vendor. Measured across the book: no catalog row carries labor,
  // and most of the curated book carries no price.
  const BUCKET_LABELS = {
    assemblies: 'MC assemblies (hours + material)',
    parts: 'Your book (hours)',
    elliot: 'Supply house · Elliot (prices)',
  };

  let term = '';
  let lastSearch = { assemblies: [], parts: [], elliot: [] };

  function escapeHtml(str) {
    return TakeoffUtils.escapeHtml(str);
  }

  function getTerm() {
    return term;
  }

  function setTerm(v) {
    term = (v || '').trim();
  }

  // Drop the term and the box together: a term that outlives its input is what
  // reopens the book showing stale results with the tabs hidden.
  function clearTerm() {
    term = '';
    const input = document.getElementById('labor-book-global-search');
    if (input) input.value = '';
  }

  function labelForTab(tab) {
    return (TakeoffState.LABOR_BOOK_TYPE_LABELS || {})[tab] || tab;
  }

  // Header for one bucket: what it brings, and how many it found.
  function groupHeading(kind, total) {
    const more = total >= SCAN_CAP ? '+' : '';
    return `${escapeHtml(BUCKET_LABELS[kind])} <span class="mc-book-section-count">${total}${more}</span>`;
  }

  function renderResults() {
    const resultsEl = document.getElementById('labor-book-search-results');
    if (!resultsEl) return;
    // every query token must match, in any order ('3/4 EMT coupling'); the
    // score puts the rows holding the words that were actually typed above the
    // ones an abbreviation reached
    const rank = TakeoffUtils.makeSearchRanker(term);

    // Parts (your editable book) — synchronous. Section names carry meaning
    // for bare-size rows ('6' in Panels), so they join the haystack.
    const partHits = [];
    for (const tab of TakeoffState.getLaborBookTabOrder()) {
      const data = TakeoffState.getLaborBookType(tab);
      for (const [section, rows] of Object.entries(data)) {
        for (const row of rows) {
          const score = rank(`${row.name} ${row.partNumber || ''} ${section}`);
          if (score) partHits.push({ tab, section, row, score });
          if (partHits.length >= SCAN_CAP) break;
        }
        if (partHits.length >= SCAN_CAP) break;
      }
      if (partHits.length >= SCAN_CAP) break;
    }
    const parts = TakeoffUtils.rankedByScore(partHits).slice(0, SEARCH_CAP);
    lastSearch = { assemblies: [], parts, elliot: [] };

    const row = (kind, i, name, context, labor, price) => `
      <div class="lb-search-row">
        <button type="button" class="btn btn-secondary lb-search-add" data-kind="${kind}" data-i="${i}" title="Add to the selected target">${TakeoffViewShared.CHILD_ARROW_SVG} Add</button>
        <span class="lb-search-name">${escapeHtml(name)}</span>
        <span class="lb-search-context">${escapeHtml(context)}</span>
        <span class="lb-search-num">${labor !== '' && labor != null ? labor + ' hrs' : ''}</span>
        <span class="lb-search-num">${price != null && price !== '' ? '$' + Number(price).toFixed(2) : ''}</span>
      </div>`;

    const partsHtml = parts
      .map((p, i) => row('part', i, p.row.name, `${labelForTab(p.tab)} · ${p.section}`, p.row.labor ?? '', p.row.price))
      .join('');

    const assembliesGroup = `
      <div class="lb-search-group" data-bucket="assemblies"><h3>${groupHeading('assemblies', 0)}</h3><div id="lb-search-assemblies"><em class="lb-search-loading">Searching assemblies...</em></div></div>`;
    const partsGroup = `
      <div class="lb-search-group" data-bucket="parts"><h3>${groupHeading('parts', partHits.length)}</h3>
        ${partsHtml || '<p class="lb-search-none">No matches in your own book.</p>'}
      </div>`;
    const elliotGroup = `
      <div class="lb-search-group" data-bucket="elliot"><h3>${groupHeading('elliot', 0)}</h3><div id="lb-search-elliot"><em class="lb-search-loading">Searching...</em></div></div>`;
    // Filling one row means replacing one description, labor and price: your
    // own book is the bucket that answers that, so it leads.
    const fillMode = TakeoffLaborBookView.hasFillTarget && TakeoffLaborBookView.hasFillTarget();

    resultsEl.innerHTML =
      '<p class="lb-search-legend">Assemblies bring both hours and price; your book has your hours; the supply house has today\'s prices.</p>' +
      (fillMode ? partsGroup + assembliesGroup : assembliesGroup + partsGroup) +
      elliotGroup;

    // Assemblies + Elliot parts need the book loaded — fill in asynchronously
    if (typeof McBook !== 'undefined') {
      const termAtStart = term;
      McBook.ensureLoaded().then(() => {
        if (term !== termAtStart) return; // stale
        const asm = McBook.searchAssemblies(termAtStart, SEARCH_CAP);
        lastSearch.assemblies = asm;
        const asmTotal = McBook.lastSearchTotal ? McBook.lastSearchTotal() : asm.length;
        const asmEl = document.getElementById('lb-search-assemblies');
        if (asmEl) {
          asmEl.innerHTML = asm.length
            ? asm.map((a, i) => `
      <div class="lb-search-row">
        <button type="button" class="btn btn-secondary lb-search-add" data-kind="assembly" data-i="${i}" title="Add this assembly's components to the selected target">${TakeoffViewShared.CHILD_ARROW_SVG} Add</button>
        <span class="lb-search-bom-toggle" data-i="${i}" title="Show components">▸</span>
        <span class="lb-search-name">${escapeHtml(a.entry.name)}</span>
        <span class="lb-search-context">${escapeHtml(labelForTab(a.tab) + ' · ' + a.sectionName)}</span>
        <span class="lb-search-num">${(a.entry.labor || 0) + ' hrs'}</span>
        <span class="lb-search-num">${a.entry.price != null && a.entry.price !== '' ? '$' + Number(a.entry.price).toFixed(2) : ''}</span>
      </div>`).join('')
            : '<p class="lb-search-none">No matching assemblies.</p>';
          asmEl.closest('.lb-search-group').querySelector('h3').innerHTML = groupHeading('assemblies', asmTotal);
        }
        const elliotHits = [];
        for (const tab of TakeoffState.getLaborBookTabOrder()) {
          for (const s of McBook.elliotSectionsForTab(tab)) {
            for (const e of s.entries) {
              const score = rank(`${e.name} ${e.partNumber || ''}`);
              if (score) elliotHits.push({ tab, category: s.name, entry: e, score });
              if (elliotHits.length >= SCAN_CAP) break;
            }
            if (elliotHits.length >= SCAN_CAP) break;
          }
          if (elliotHits.length >= SCAN_CAP) break;
        }
        const elliot = TakeoffUtils.rankedByScore(elliotHits).slice(0, SEARCH_CAP);
        lastSearch.elliot = elliot;
        const elEl = document.getElementById('lb-search-elliot');
        if (elEl) {
          elEl.innerHTML = elliot.length
            ? elliot.map((x, i) => row('elliot', i, x.entry.name, `${labelForTab(x.tab)} · ${x.category} · ${x.entry.partNumber || ''}`, '', x.entry.price)).join('')
            : '<p class="lb-search-none">No matching supply-house parts.</p>';
          elEl.closest('.lb-search-group').querySelector('h3').innerHTML = groupHeading('elliot', elliotHits.length);
        }
      });
    }
  }

  // ---------- one-time listeners (search input + results panel) ----------

  let debounceTimer = null;
  document.getElementById('labor-book-global-search')?.addEventListener('input', (e) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      setTerm(e.target.value);
      TakeoffLaborBookView.render();
      TakeoffLaborBookView.attachListeners();
    }, 250);
  });

  // Escape is not handled here: one document-level handler in laborBook.js
  // owns it for the whole modal, so "clear the term, then close" means the
  // same thing whether focus is in this box or on an Add button.

  document.getElementById('labor-book-search-results')?.addEventListener('click', (e) => {
    const bomToggle = e.target.closest('.lb-search-bom-toggle');
    if (bomToggle) {
      const rowEl = bomToggle.closest('.lb-search-row');
      const next = rowEl.nextElementSibling;
      if (next && next.classList.contains('lb-search-bom')) {
        next.remove();
        bomToggle.textContent = '▸';
        return;
      }
      const hit = lastSearch.assemblies[Number(bomToggle.dataset.i)];
      if (!hit || typeof McBook === 'undefined') return;
      bomToggle.textContent = '▾';
      const panel = document.createElement('div');
      panel.className = 'lb-search-bom';
      panel.innerHTML = '<em class="lb-search-loading">Loading components...</em>';
      rowEl.after(panel);
      McBook.getComposition(hit.entry.assmNum).then((comps) => {
        panel.innerHTML = comps && comps.length
          ? McBook.renderBom(comps, hit.entry)
          : '<em class="lb-search-none">No component breakdown available.</em>';
      });
      return;
    }
    const btn = e.target.closest('.lb-search-add');
    if (!btn) return;
    const i = Number(btn.dataset.i);
    // No ✓ swapped into the button for 1.2 s any more: every one of these
    // paths already routes through addEntryToTarget / McBook, which say what
    // landed and at what count in the one feedback region (js/toast.js). The
    // check said only "something happened" and said it twice.
    if (btn.dataset.kind === 'assembly') {
      const hit = lastSearch.assemblies[i];
      if (hit && typeof McBook !== 'undefined') McBook.addAssemblyEntry(hit.entry);
    } else if (btn.dataset.kind === 'part') {
      const hit = lastSearch.parts[i];
      if (hit) TakeoffLaborBookTargets.addEntryToTarget({
        description: TakeoffLaborBookTargets.describeBookRowIn(hit.tab, hit.section, hit.row.name || ''),
        labor: hit.row.labor || 0,
        price: hit.row.price != null && hit.row.price !== '' ? String(hit.row.price) : null,
      });
    } else if (btn.dataset.kind === 'elliot') {
      const hit = lastSearch.elliot[i];
      if (hit) TakeoffLaborBookTargets.addEntryToTarget({
        description: hit.entry.name,
        labor: 0,
        price: hit.entry.price != null ? String(hit.entry.price) : null,
      });
    }
  });

  return { getTerm, setTerm, clearTerm, renderResults };
})();
