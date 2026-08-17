/**
 * Supplier parts inside the Labor & Price Book Parts panel.
 *
 * Sections are universal: no supplier owns one. Each supplier catalog
 * section (today: Elliot) merges into the curated structure by name
 * (case-insensitive): a matching curated *section* gets the parts as a
 * "Supplier parts" block below its rows; a matching curated *group*
 * (conduit tab) gets them as a "Supplier parts" section at the end of the
 * group; anything else renders as a standalone section — styled at group
 * level on tabs whose top-level list is groups, so the list stays visually
 * uniform. Supplier attribution lives on the per-part provenance badge,
 * never on the section. Entries stay lazy-loaded and read-only (rendered
 * from the catalog, not copied into the editable Parts store). Filtering
 * is driven by the tab-level filter input via partsEl._elliotFilter
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
        <tr data-entry="${ei}">
          <td class="mc-book-entry-add"><button type="button" class="btn btn-secondary elliot-part-add-btn" data-key="${escapeHtml(sectionKey)}" data-entry="${ei}" title="Add as child to fixture">${TakeoffViewShared.CHILD_ARROW_SVG} Add</button></td>
          <td class="mc-book-entry-name lb-card-open" title="Open part card">${escapeHtml(e.name)}</td>
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
      const bookTab = TakeoffState.getLaborBookType(renderedForTab);
      const hasOwnSections = Object.keys(bookTab).length > 0;

      // parts promoted into the editable book supersede their catalog row
      const promoted = new Set();
      for (const secName of Object.keys(bookTab)) {
        for (const r of bookTab[secName]) {
          if (r.partNumber) promoted.add(r.partNumber.toLowerCase());
        }
      }

      const blocks = []; // {el, bodyEl, section, visible, vendor, collapsedClass, sectionHost}

      // curated section/group blocks by lowercased name — a name match means
      // the supplier offers parts into that same universal section/group
      const curatedByName = {};
      partsEl.querySelectorAll('.labor-book-section:not(.lb-supplier-section)').forEach((el) => {
        const key = (el.dataset.section || '').trim().toLowerCase();
        if (key && !curatedByName[key]) curatedByName[key] = el;
      });
      const groupsByName = {};
      partsEl.querySelectorAll('.labor-book-group[data-group]').forEach((el) => {
        const key = (el.dataset.group || '').trim().toLowerCase();
        if (key && !groupsByName[key]) groupsByName[key] = el;
      });
      const groupedTab = Object.keys(groupsByName).length > 0;

      for (const s of sections) {
        const vendor = s.level1 || 'Elliot';
        const visible = s.entries.filter((e) => !e.partNumber || !promoted.has(e.partNumber.toLowerCase()));
        if (!visible.length) continue;
        const key = s.name.trim().toLowerCase();
        const sectionHost = curatedByName[key] || null;
        const groupHost = !sectionHost ? groupsByName[key] || null : null;
        let el;
        let collapsedClass;
        if (sectionHost) {
          el = document.createElement('div');
          el.className = 'lb-offers lb-offers-collapsed';
          el.dataset.key = s.name;
          el.innerHTML = `
            <h4 class="lb-offers-header"><span class="labor-book-section-chevron"></span>Supplier parts <span class="mc-book-section-count">${visible.length.toLocaleString()}</span></h4>
            <div class="lb-offers-body" data-loaded="0"></div>`;
          sectionHost.querySelector('.labor-book-section-body')?.appendChild(el);
          collapsedClass = 'lb-offers-collapsed';
        } else if (groupHost) {
          el = document.createElement('div');
          el.className = 'labor-book-section labor-book-section-collapsed lb-supplier-section';
          el.dataset.section = s.name;
          el.innerHTML = `
            <h3 class="labor-book-section-header"><span class="labor-book-section-chevron"></span>Supplier parts<span class="mc-book-section-count">${visible.length.toLocaleString()}</span></h3>
            <div class="labor-book-section-body lb-offers-body" data-loaded="0"></div>`;
          groupHost.querySelector('.labor-book-group-body')?.appendChild(el);
          collapsedClass = 'labor-book-section-collapsed';
        } else {
          el = document.createElement('div');
          el.className = `labor-book-section labor-book-section-collapsed lb-supplier-section${groupedTab ? ' lb-group-level' : ''}`;
          el.dataset.section = s.name;
          el.innerHTML = `
            <h3 class="labor-book-section-header"><span class="labor-book-section-chevron"></span>${escapeHtml(s.name)}<span class="mc-book-section-count">${visible.length.toLocaleString()}</span></h3>
            <div class="labor-book-section-body lb-offers-body" data-loaded="0"></div>`;
          partsEl.appendChild(el);
          collapsedClass = 'labor-book-section-collapsed';
        }
        const bodyEl = el.querySelector('.lb-offers-body');
        const block = { el, bodyEl, section: s, visible, vendor, collapsedClass, sectionHost };
        blocks.push(block);

        el.addEventListener('click', (e) => {
          const rowEntries = () => (block._filtered ? block._filtered : block.visible);
          const addBtn = e.target.closest('.elliot-part-add-btn');
          if (addBtn) {
            const entry = rowEntries()[Number(addBtn.dataset.entry)];
            if (entry) {
              TakeoffLaborBookTargets.addEntryToTarget({
                description: entry.name,
                labor: 0,
                price: entry.price ? String(entry.price) : null,
              });
            }
            return;
          }
          const cardCell = e.target.closest('.lb-card-open, .lb-prov-cell');
          if (cardCell) {
            const tr = cardCell.closest('tr[data-entry]');
            const entry = tr && rowEntries()[Number(tr.dataset.entry)];
            if (entry) {
              TakeoffLaborBookCard.openForCatalogPart(renderedForTab, s.name, vendor, {
                name: entry.name,
                partNumber: entry.partNumber || '',
                price: entry.price,
                pricedAt: entry.pricedAt || importDate,
              });
            }
            return;
          }
          const header = e.target.closest('.labor-book-section-header, .lb-offers-header');
          if (header && el.contains(header)) {
            e.stopPropagation(); // hosts have their own header toggles
            const expanded = !el.classList.toggle(block.collapsedClass);
            if (expanded && bodyEl.dataset.loaded === '0') {
              bodyEl.innerHTML = renderPartRows(block.visible, s.name, vendor, importDate);
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
      // which runs this between its section pass and its group pass so group
      // visibility can account for supplier matches)
      partsEl._elliotFilter = (termRaw) => {
        const term = (termRaw || '').trim().toLowerCase();
        for (const block of blocks) {
          const { el, bodyEl, section: s, visible, vendor, collapsedClass, sectionHost } = block;
          if (!term) {
            block._filtered = null;
            bodyEl.innerHTML = '';
            bodyEl.dataset.loaded = '0';
            el.classList.add(collapsedClass);
            el.style.display = '';
            continue;
          }
          const titleMatch = s.name.toLowerCase().includes(term);
          const matched = [];
          for (const en of visible) {
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
          el.classList.remove(collapsedClass);
          bodyEl.innerHTML =
            `<div class="mc-book-result-count">${matched.length >= FILTER_CAP_PER_SECTION ? `First ${FILTER_CAP_PER_SECTION} matches` : `${matched.length} matches`}</div>` +
            renderPartRows(matched, '__filtered__', vendor, importDate);
          bodyEl.dataset.loaded = '1';
          if (sectionHost) {
            // supplier matches keep the shared section visible and open
            sectionHost.style.display = '';
            sectionHost.classList.remove('labor-book-section-collapsed');
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
