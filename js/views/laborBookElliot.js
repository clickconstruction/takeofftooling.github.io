/**
 * Supplier parts inside the Labor & Price Book Parts panel.
 *
 * Sections are universal: no supplier owns one. Each supplier catalog
 * section (today: Elliot) renders as a first-class section beside the
 * curated ones — or, when a curated section of the same name exists, its
 * parts appear inside that section as a "Supplier parts" block below the
 * curated rows. Supplier attribution lives on the per-part provenance
 * badge, not on the section. Entries stay lazy-loaded and read-only
 * (rendered from the catalog, not copied into the editable Parts store).
 * Filtering is driven by the tab-level filter input via partsEl._elliotFilter
 * (laborBook.js applyTabFilter). Loaded before js/views/laborBook.js.
 */

const TakeoffLaborBookElliot = (function () {
  const FILTER_CAP_PER_SECTION = 100;

  function escapeHtml(str) {
    return TakeoffUtils.escapeHtml(str);
  }

  function renderPartRows(entries, sectionKey, vendor, importDate) {
    const rows = entries
      .map(
        (e, ei) => `
        <tr>
          <td class="mc-book-entry-add"><button type="button" class="btn btn-secondary elliot-part-add-btn" data-key="${escapeHtml(sectionKey)}" data-entry="${ei}" title="Add as child to fixture">${TakeoffViewShared.CHILD_ARROW_SVG} Add</button></td>
          <td class="mc-book-entry-name">${escapeHtml(e.name)}</td>
          <td class="mc-book-entry-labor">${escapeHtml(e.partNumber || '')}</td>
          <td class="mc-book-entry-price">${e.price ? '$' + Number(e.price).toFixed(2) : ''}</td>
          <td class="lb-prov-cell">${TakeoffViewShared.renderPriceProvenance(vendor, e.pricedAt || importDate)}</td>
        </tr>`
      )
      .join('');
    return `
      <table class="mc-book-entries">
        <thead><tr><th></th><th>Name</th><th>Part #</th><th>Price</th><th>Price from</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  /**
   * Weave the supplier catalog's sections into the Parts panel (async —
   * waits for the book). getActiveSection: () => 'parts'|'assemblies', used
   * to discard the stale async render when the user switches meanwhile.
   */
  function injectElliotParts(partsEl, getActiveSection) {
    if (typeof McBook === 'undefined') return;
    const renderedForTab = TakeoffState.getActiveLaborBookTab();
    McBook.ensureLoaded().then(() => {
      // guard against stale async: user may have switched tab/section meanwhile
      if (getActiveSection() !== 'parts' || TakeoffState.getActiveLaborBookTab() !== renderedForTab) return;
      if (partsEl.querySelector('.lb-supplier-section, .lb-offers')) return;
      const sections = McBook.elliotSectionsForTab(renderedForTab);
      if (!sections.length) return;
      const importDate = McBook.elliotImportDate();
      const hasOwnSections = Object.keys(TakeoffState.getLaborBookType(renderedForTab)).length > 0;

      const findSection = (key) => sections.find((s) => s.name === key);
      const blocks = []; // {el, bodyEl, section, hostSection: curated .labor-book-section|null}

      // curated section blocks by lowercased name — a name match means the
      // supplier offers parts into that same universal section
      const curatedByName = {};
      partsEl.querySelectorAll('.labor-book-section:not(.lb-supplier-section)').forEach((el) => {
        const key = (el.dataset.section || '').trim().toLowerCase();
        if (key && !curatedByName[key]) curatedByName[key] = el;
      });

      for (const s of sections) {
        const vendor = s.level1 || 'Elliot';
        const host = curatedByName[s.name.trim().toLowerCase()] || null;
        let el;
        if (host) {
          el = document.createElement('div');
          el.className = 'lb-offers lb-offers-collapsed';
          el.dataset.key = s.name;
          el.innerHTML = `
            <h4 class="lb-offers-header"><span class="labor-book-section-chevron"></span>Supplier parts <span class="mc-book-section-count">${s.entries.length.toLocaleString()}</span></h4>
            <div class="lb-offers-body" data-loaded="0"></div>`;
          host.querySelector('.labor-book-section-body')?.appendChild(el);
        } else {
          el = document.createElement('div');
          el.className = 'labor-book-section labor-book-section-collapsed lb-supplier-section';
          el.dataset.section = s.name;
          el.innerHTML = `
            <h3 class="labor-book-section-header"><span class="labor-book-section-chevron"></span>${escapeHtml(s.name)}<span class="mc-book-section-count">${s.entries.length.toLocaleString()}</span></h3>
            <div class="labor-book-section-body lb-offers-body" data-loaded="0"></div>`;
          partsEl.appendChild(el);
        }
        const bodyEl = el.querySelector('.lb-offers-body');
        const block = { el, bodyEl, section: s, vendor, hostSection: host };
        blocks.push(block);

        el.addEventListener('click', (e) => {
          const addBtn = e.target.closest('.elliot-part-add-btn');
          if (addBtn) {
            const entry = addBtn.dataset.key === '__filtered__'
              ? block._filtered?.[Number(addBtn.dataset.entry)]
              : findSection(addBtn.dataset.key)?.entries[Number(addBtn.dataset.entry)];
            if (entry) {
              TakeoffLaborBookTargets.addEntryToTarget({
                description: entry.name,
                labor: 0,
                price: entry.price ? String(entry.price) : null,
              });
            }
            return;
          }
          const header = e.target.closest('.labor-book-section-header, .lb-offers-header');
          if (header && el.contains(header)) {
            e.stopPropagation(); // curated hosts have their own header toggle
            const collapsedClass = block.hostSection ? 'lb-offers-collapsed' : 'labor-book-section-collapsed';
            const expanded = !el.classList.toggle(collapsedClass);
            if (expanded && bodyEl.dataset.loaded === '0') {
              bodyEl.innerHTML = renderPartRows(s.entries, s.name, vendor, importDate);
              bodyEl.dataset.loaded = '1';
            }
          }
        });
      }

      if (!hasOwnSections) {
        const emptyEl = partsEl.querySelector('.labor-book-empty');
        if (emptyEl) {
          emptyEl.classList.add('labor-book-empty-footer');
          const msg = emptyEl.querySelector('p');
          if (msg) msg.textContent = 'These sections come from the supplier catalog. To curate your own:';
          // move below the catalog — the DOM move keeps the buttons' listeners
          partsEl.appendChild(emptyEl);
        }
      }

      // driven by the tab-level filter input (laborBook.js applyTabFilter,
      // which runs its curated-row pass first)
      partsEl._elliotFilter = (termRaw) => {
        const term = (termRaw || '').trim().toLowerCase();
        for (const block of blocks) {
          const { el, bodyEl, section: s, vendor, hostSection } = block;
          if (!term) {
            block._filtered = null;
            bodyEl.innerHTML = '';
            bodyEl.dataset.loaded = '0';
            el.classList.add(hostSection ? 'lb-offers-collapsed' : 'labor-book-section-collapsed');
            el.style.display = '';
            continue;
          }
          const titleMatch = s.name.toLowerCase().includes(term);
          const matched = [];
          for (const en of s.entries) {
            if (titleMatch || en.name.toLowerCase().includes(term) || (en.partNumber || '').toLowerCase().includes(term)) {
              matched.push(en);
              if (matched.length >= FILTER_CAP_PER_SECTION) break;
            }
          }
          if (!matched.length) {
            el.style.display = 'none';
            continue;
          }
          block._filtered = matched;
          el.style.display = '';
          el.classList.remove(hostSection ? 'lb-offers-collapsed' : 'labor-book-section-collapsed');
          bodyEl.innerHTML =
            `<div class="mc-book-result-count">${matched.length >= FILTER_CAP_PER_SECTION ? `First ${FILTER_CAP_PER_SECTION} matches` : `${matched.length} matches`}</div>` +
            renderPartRows(matched, '__filtered__', vendor, importDate);
          bodyEl.dataset.loaded = '1';
          if (hostSection) {
            // supplier matches keep the shared section visible and open
            hostSection.style.display = '';
            hostSection.classList.remove('labor-book-section-collapsed');
          }
        }
      };

      // the user may have typed while the book was still loading
      const pending = document.querySelector('.labor-book-tab-filter')?.value;
      if (pending && pending.trim()) partsEl._elliotFilter(pending);
    });
  }

  return { injectElliotParts };
})();
