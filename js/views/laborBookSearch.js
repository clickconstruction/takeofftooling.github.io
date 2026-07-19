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

  function labelForTab(tab) {
    return (TakeoffState.LABOR_BOOK_TYPE_LABELS || {})[tab] || tab;
  }

  // inch-marks are punctuation noise when searching ('1/2 emt' should hit '1/2" EMT')
  function searchNorm(s) {
    return (s || '').toLowerCase().replace(/["“”]/g, '');
  }

  function renderResults() {
    const resultsEl = document.getElementById('labor-book-search-results');
    if (!resultsEl) return;
    const normTerm = searchNorm(term);

    // Parts (your editable book) — synchronous
    const parts = [];
    for (const tab of TakeoffState.getLaborBookTabOrder()) {
      const data = TakeoffState.getLaborBookType(tab);
      for (const [section, rows] of Object.entries(data)) {
        for (const row of rows) {
          if (searchNorm(row.name).includes(normTerm)) {
            parts.push({ tab, section, row });
            if (parts.length >= SEARCH_CAP) break;
          }
        }
        if (parts.length >= SEARCH_CAP) break;
      }
      if (parts.length >= SEARCH_CAP) break;
    }
    lastSearch = { assemblies: [], parts, elliot: [] };

    const row = (kind, i, name, context, labor, price) => `
      <div class="lb-search-row">
        <button type="button" class="btn btn-secondary lb-search-add" data-kind="${kind}" data-i="${i}" title="Add to the selected target">+ Add</button>
        <span class="lb-search-name">${escapeHtml(name)}</span>
        <span class="lb-search-context">${escapeHtml(context)}</span>
        <span class="lb-search-num">${labor !== '' && labor != null ? labor + ' hrs' : ''}</span>
        <span class="lb-search-num">${price != null && price !== '' ? '$' + Number(price).toFixed(2) : ''}</span>
      </div>`;

    const partsHtml = parts
      .map((p, i) => row('part', i, p.row.name, `${labelForTab(p.tab)} · ${p.section}`, p.row.labor ?? '', p.row.price))
      .join('');

    resultsEl.innerHTML = `
      <div class="lb-search-group"><h3>Assemblies</h3><div id="lb-search-assemblies"><em class="lb-search-loading">Searching assemblies...</em></div></div>
      <div class="lb-search-group"><h3>Parts <span class="mc-book-section-count">${parts.length}${parts.length >= SEARCH_CAP ? '+' : ''}</span></h3>
        ${partsHtml || '<p class="lb-search-none">No matches in your Parts sections.</p>'}
      </div>
      <div class="lb-search-group"><h3>Elliot Parts</h3><div id="lb-search-elliot"><em class="lb-search-loading">Searching...</em></div></div>`;

    // Assemblies + Elliot parts need the book loaded — fill in asynchronously
    if (typeof McBook !== 'undefined') {
      const termAtStart = term;
      McBook.ensureLoaded().then(() => {
        if (term !== termAtStart) return; // stale
        const asm = McBook.searchAssemblies(termAtStart, SEARCH_CAP);
        lastSearch.assemblies = asm;
        const asmEl = document.getElementById('lb-search-assemblies');
        if (asmEl) {
          asmEl.innerHTML = asm.length
            ? asm.map((a, i) => `
      <div class="lb-search-row">
        <button type="button" class="btn btn-secondary lb-search-add" data-kind="assembly" data-i="${i}" title="Add this assembly's components to the selected target">+ Add</button>
        <span class="lb-search-bom-toggle" data-i="${i}" title="Show components">▸</span>
        <span class="lb-search-name">${escapeHtml(a.entry.name)}</span>
        <span class="lb-search-context">${escapeHtml(labelForTab(a.tab) + ' · ' + a.sectionName)}</span>
        <span class="lb-search-num">${(a.entry.labor || 0) + ' hrs'}</span>
        <span class="lb-search-num">${a.entry.price != null && a.entry.price !== '' ? '$' + Number(a.entry.price).toFixed(2) : ''}</span>
      </div>`).join('')
            : '<p class="lb-search-none">No matching assemblies.</p>';
          asmEl.closest('.lb-search-group').querySelector('h3').innerHTML =
            `Assemblies <span class="mc-book-section-count">${asm.length}${asm.length >= SEARCH_CAP ? '+' : ''}</span>`;
        }
        const elliot = [];
        for (const tab of TakeoffState.getLaborBookTabOrder()) {
          for (const s of McBook.elliotSectionsForTab(tab)) {
            for (const e of s.entries) {
              if (searchNorm(e.name).includes(normTerm) || searchNorm(e.partNumber).includes(normTerm)) {
                elliot.push({ tab, category: s.name, entry: e });
                if (elliot.length >= SEARCH_CAP) break;
              }
            }
            if (elliot.length >= SEARCH_CAP) break;
          }
          if (elliot.length >= SEARCH_CAP) break;
        }
        lastSearch.elliot = elliot;
        const elEl = document.getElementById('lb-search-elliot');
        if (elEl) {
          elEl.innerHTML = elliot.length
            ? elliot.map((x, i) => row('elliot', i, x.entry.name, `${labelForTab(x.tab)} · ${x.category} · ${x.entry.partNumber || ''}`, '', x.entry.price)).join('')
            : '<p class="lb-search-none">No matching Elliot parts.</p>';
          elEl.closest('.lb-search-group').querySelector('h3').innerHTML =
            `Elliot Parts <span class="mc-book-section-count">${elliot.length}${elliot.length >= SEARCH_CAP ? '+' : ''}</span>`;
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

  document.getElementById('labor-book-global-search')?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (e.target.value) {
        e.target.value = '';
        setTerm('');
        TakeoffLaborBookView.render();
        TakeoffLaborBookView.attachListeners();
      } else {
        TakeoffApp.hideLaborBookModal();
      }
    }
  });

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
    const flash = (ok) => {
      btn.textContent = ok ? '✓ Added' : '+ Add';
      setTimeout(() => { btn.textContent = '+ Add'; }, 1200);
    };
    if (btn.dataset.kind === 'assembly') {
      const hit = lastSearch.assemblies[i];
      if (hit && typeof McBook !== 'undefined') McBook.addAssemblyEntry(hit.entry).then((msg) => flash(!!msg));
    } else if (btn.dataset.kind === 'part') {
      const hit = lastSearch.parts[i];
      if (hit) flash(TakeoffLaborBookTargets.addEntryToTarget({
        description: TakeoffLaborBookTargets.describeBookRow(hit.row.name || '', hit.section),
        labor: hit.row.labor || 0,
        price: hit.row.price != null && hit.row.price !== '' ? String(hit.row.price) : null,
      }));
    } else if (btn.dataset.kind === 'elliot') {
      const hit = lastSearch.elliot[i];
      if (hit) flash(TakeoffLaborBookTargets.addEntryToTarget({
        description: hit.entry.name,
        labor: 0,
        price: hit.entry.price != null ? String(hit.entry.price) : null,
      }));
    }
  });

  return { getTerm, setTerm, renderResults };
})();
