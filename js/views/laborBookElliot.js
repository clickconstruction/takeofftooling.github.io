/**
 * Elliot supply-house parts group inside the Labor & Price Book Parts panel.
 *
 * Rendered live from the Elliot price data (not copied into the editable
 * Parts store): one collapsible group per tab, a section per Elliot
 * category, entries lazy-loaded, + Add to fixture. Filtering is driven by
 * the tab-level filter input via group._applyTabFilter (laborBook.js).
 * Loaded before js/views/laborBook.js.
 */

const TakeoffLaborBookElliot = (function () {
  const ELLIOT_FILTER_CAP = 200;

  function escapeHtml(str) {
    return TakeoffUtils.escapeHtml(str);
  }

  function renderElliotPartRows(entries, sectionKey) {
    const rows = entries
      .map(
        (e, ei) => `
        <tr>
          <td class="mc-book-entry-add"><button type="button" class="btn btn-secondary elliot-part-add-btn" data-key="${escapeHtml(sectionKey)}" data-entry="${ei}" title="Add as child to fixture">+ Add</button></td>
          <td class="mc-book-entry-name">${escapeHtml(e.name)}</td>
          <td class="mc-book-entry-labor">${escapeHtml(e.partNumber || '')}</td>
          <td class="mc-book-entry-price">${e.price ? '$' + Number(e.price).toFixed(2) : ''}</td>
        </tr>`
      )
      .join('');
    return `
      <table class="mc-book-entries">
        <thead><tr><th></th><th>Name</th><th>Part #</th><th>Price</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  /**
   * Append the Elliot Parts group to the Parts panel (async — waits for the
   * book). getActiveSection: () => 'parts'|'assemblies', used to discard the
   * stale async render when the user switches section/tab meanwhile.
   */
  function injectElliotParts(partsEl, getActiveSection) {
    if (typeof McBook === 'undefined') return;
    const renderedForTab = TakeoffState.getActiveLaborBookTab();
    McBook.ensureLoaded().then(() => {
      // guard against stale async: user may have switched tab/section meanwhile
      if (getActiveSection() !== 'parts' || TakeoffState.getActiveLaborBookTab() !== renderedForTab) return;
      if (partsEl.querySelector('.elliot-parts-group')) return;
      const sections = McBook.elliotSectionsForTab(renderedForTab);
      if (!sections.length) return;
      // when the tab has no curated sections the catalog IS the tab: start it
      // open and demote the "no sections yet" block to a footer
      const hasOwnSections = Object.keys(TakeoffState.getLaborBookType(renderedForTab)).length > 0;
      const total = sections.reduce((n, s) => n + s.entries.length, 0);
      const sectionsHtml = sections
        .map(
          (s) => `
        <div class="mc-book-section elliot-part-section" data-key="${escapeHtml(s.name)}">
          <div class="mc-book-section-header">
            <span class="labor-book-section-chevron"></span>
            <span class="mc-book-section-name">${escapeHtml(s.name)}</span>
            <span class="mc-book-section-count">${s.entries.length.toLocaleString()}</span>
          </div>
          <div class="mc-book-section-body" data-loaded="0"></div>
        </div>`
        )
        .join('');
      const group = document.createElement('div');
      group.className = `labor-book-group${hasOwnSections ? ' labor-book-group-collapsed' : ''} mc-book-group elliot-parts-group`;
      group.innerHTML = `
        <h2 class="labor-book-group-header"><span class="labor-book-section-chevron"></span>Supplier Parts · ${escapeHtml(sections[0].level1 || 'Elliot')} <span class="mc-book-section-count">${total.toLocaleString()}</span></h2>
        <div class="labor-book-group-body">
          <div class="elliot-parts-body">${sectionsHtml}</div>
        </div>`;
      partsEl.appendChild(group);

      if (!hasOwnSections) {
        const emptyEl = partsEl.querySelector('.labor-book-empty');
        if (emptyEl) {
          emptyEl.classList.add('labor-book-empty-footer');
          const msg = emptyEl.querySelector('p');
          if (msg) msg.textContent = 'These parts come from the supplier catalog above. To curate your own sections:';
          // move below the catalog — the DOM move keeps the buttons' listeners
          partsEl.appendChild(emptyEl);
        }
      }

      const findSection = (key) => sections.find((s) => s.name === key);
      const body = group.querySelector('.elliot-parts-body');

      group.addEventListener('click', (e) => {
        const addBtn = e.target.closest('.elliot-part-add-btn');
        if (addBtn) {
          let entry;
          if (addBtn.dataset.key === '__filtered__') {
            entry = group._filtered?.[Number(addBtn.dataset.entry)];
          } else {
            entry = findSection(addBtn.dataset.key)?.entries[Number(addBtn.dataset.entry)];
          }
          if (entry) {
            TakeoffLaborBookTargets.addEntryToTarget({
              description: entry.name,
              labor: 0,
              price: entry.price ? String(entry.price) : null,
            });
          }
          return;
        }
        const sectionHeader = e.target.closest('.mc-book-section-header');
        if (sectionHeader) {
          const sectionEl = sectionHeader.closest('.elliot-part-section');
          const sBody = sectionEl?.querySelector('.mc-book-section-body');
          if (!sBody) return;
          const expanded = sectionEl.classList.toggle('mc-book-section-expanded');
          if (expanded && sBody.dataset.loaded === '0') {
            const s = findSection(sectionEl.dataset.key);
            if (s) {
              sBody.innerHTML = renderElliotPartRows(s.entries, s.name);
              sBody.dataset.loaded = '1';
            }
          }
          return;
        }
        const groupHeader = e.target.closest('.labor-book-group-header');
        if (groupHeader && groupHeader.parentElement === group) {
          group.classList.toggle('labor-book-group-collapsed');
        }
      });

      // driven by the tab-level filter input (laborBook.js applyTabFilter)
      group._applyTabFilter = (termRaw) => {
        const term = (termRaw || '').trim().toLowerCase();
        if (!term) {
          group._filtered = null;
          body.innerHTML = sectionsHtml;
          group.classList.toggle('labor-book-group-collapsed', hasOwnSections);
          return;
        }
        group.classList.remove('labor-book-group-collapsed');
        const matched = [];
        for (const s of sections) {
          for (const en of s.entries) {
            if (en.name.toLowerCase().includes(term) || (en.partNumber || '').toLowerCase().includes(term)) {
              matched.push(en);
              if (matched.length >= ELLIOT_FILTER_CAP) break;
            }
          }
          if (matched.length >= ELLIOT_FILTER_CAP) break;
        }
        group._filtered = matched;
        body.innerHTML =
          `<div class="mc-book-result-count">${matched.length >= ELLIOT_FILTER_CAP ? `First ${ELLIOT_FILTER_CAP} matches` : `${matched.length} matches`}</div>` +
          (matched.length ? renderElliotPartRows(matched, '__filtered__') : '<p class="mc-book-empty">No matching supplier parts in this tab.</p>');
      };

      // the user may have typed while the book was still loading
      const pending = document.querySelector('.labor-book-tab-filter')?.value;
      if (pending && pending.trim()) group._applyTabFilter(pending);
    });
  }

  return { injectElliotParts };
})();
