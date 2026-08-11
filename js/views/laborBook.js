/**
 * Labor and Price Book modal — the view facade: Parts tabs/sections, the
 * Parts/Assemblies toggle, the apply-to header, and modal chrome.
 *
 * Split-out pieces (loaded before this file):
 *   js/views/laborBookTargets.js — apply-to-takeoff logic (add/fill/explode)
 *   js/views/laborBookElliot.js  — live Elliot supplier parts group
 *   js/views/laborBookSearch.js  — global search (owns the search term)
 * The public API here is stable — app.js, McBook, and McElliotUpdate call it.
 */

const TakeoffLaborBookView = (function () {
  const TRASH_SVG = TakeoffViewShared.TRASH_SVG;

  const TAB_HOTKEYS = { g: 'gear', l: 'lighting', d: 'devices', c: 'conduit', w: 'wire', s: 'specialSystems' };
  const TAB_TO_KEY = { gear: 'G', lighting: 'L', devices: 'D', conduit: 'C', wire: 'W', specialSystems: 'S' };

  // 'parts' | 'assemblies' — remembered across modal opens (in-memory only)
  let activeSection = 'parts';

  function escapeHtml(str) {
    return TakeoffUtils.escapeHtml(str);
  }

  function renderTabs() {
    const tabs = TakeoffState.getLaborBookTabOrder();
    const active = TakeoffState.getActiveLaborBookTab();
    const labels = TakeoffState.LABOR_BOOK_TYPE_LABELS || {};
    return tabs
      .map(
        (t) =>
          `<button type="button" class="labor-book-tab ${t === active ? 'active' : ''}" data-tab="${t}" title="${TAB_TO_KEY[t] ? 'Press ' + TAB_TO_KEY[t] : ''}">${escapeHtml(labels[t] || t)}${TAB_TO_KEY[t] ? ` <kbd class="labor-book-tab-kbd">${TAB_TO_KEY[t]}</kbd>` : ''}</button>`
      )
      .join('');
  }

  function renderSectionRows(type, section, data) {
    const rows = data[section] || [];
    return rows
      .map(
        (r, i) => `
        <tr class="labor-book-row" data-type="${type}" data-section="${escapeHtml(section)}" data-index="${i}" data-labor="${r.labor || 0}">
          <td><button type="button" class="btn labor-book-add-btn" data-type="${type}" data-section="${escapeHtml(section)}" data-index="${i}" title="Add as child to fixture">+ Add</button></td>
          <td><input type="text" class="labor-book-name" value="${escapeHtml(r.name || '')}" data-type="${type}" data-section="${escapeHtml(section)}" data-index="${i}" placeholder="Name" /></td>
          <td><input type="number" class="labor-book-hrs" value="${r.labor ?? ''}" min="0" step="0.1" data-type="${type}" data-section="${escapeHtml(section)}" data-index="${i}" placeholder="hrs" /></td>
          <td><input type="text" class="labor-book-price" value="${escapeHtml(r.price ?? '')}" data-type="${type}" data-section="${escapeHtml(section)}" data-index="${i}" placeholder="Price" /></td>
          <td><button type="button" class="btn-link labor-book-remove-row icon-btn" data-type="${type}" data-section="${escapeHtml(section)}" data-index="${i}" title="Remove">${TRASH_SVG}</button></td>
        </tr>
      `
      )
      .join('');
  }

  function renderSectionBlock(type, section, data) {
    const rowHtml = renderSectionRows(type, section, data);
    return `
        <div class="labor-book-section labor-book-section-collapsed" data-section="${escapeHtml(section)}">
          <h3 class="labor-book-section-header"><span class="labor-book-section-chevron"></span>${escapeHtml(section)}</h3>
          <div class="labor-book-section-body">
            <table>
              <thead><tr><th>Add</th><th>Name</th><th>Labor (hrs)</th><th>Price</th><th></th></tr></thead>
              <tbody>${rowHtml}</tbody>
            </table>
            <button type="button" class="btn add-row-btn" data-type="${type}" data-section="${escapeHtml(section)}">Add Row</button>
          </div>
        </div>
      `;
  }

  function renderContent() {
    const type = TakeoffState.getActiveLaborBookTab();
    const data = TakeoffState.getLaborBookType(type);
    const sections = Object.keys(data);
    const groups = TakeoffState.getLaborBookGroups(type);
    const filterHtml = '<input type="text" class="labor-book-tab-filter" placeholder="Filter parts in this tab by name or part number..." autocomplete="off" />';

    if (sections.length === 0) {
      // if the supplier catalog has parts for this tab, injectElliotParts
      // demotes this block to a footer below the (auto-expanded) catalog
      return `
        ${filterHtml}
        <div class="labor-book-empty">
          <p>No parts sections yet. Browse Assemblies for priced entries, or start a section from scratch.</p>
          <button type="button" class="btn btn-success labor-book-browse-assemblies-btn">Browse Assemblies</button>
          <button type="button" class="btn add-section-btn" data-type="${type}">Add Section</button>
        </div>
      `;
    }

    let html = filterHtml;

    if (groups && type === 'conduit') {
      const expandGroup = TakeoffState.getLaborBookExpandGroup?.() || null;
      const grouped = new Set();
      for (const group of groups) {
        for (const section of group.sections) grouped.add(section);
      }
      for (const group of groups) {
        let groupSectionsHtml = '';
        for (const section of group.sections) {
          if (!data[section]) continue;
          groupSectionsHtml += renderSectionBlock(type, section, data);
        }
        if (groupSectionsHtml) {
          const collapsedClass = expandGroup === group.name ? '' : ' labor-book-group-collapsed';
          html += `
        <div class="labor-book-group${collapsedClass}" data-group="${escapeHtml(group.name)}">
          <h2 class="labor-book-group-header"><span class="labor-book-section-chevron"></span>${escapeHtml(group.name)}</h2>
          <div class="labor-book-group-body">
            ${groupSectionsHtml}
          </div>
        </div>
      `;
        }
      }
      let importedSectionsHtml = '';
      for (const section of sections) {
        if (grouped.has(section)) continue;
        importedSectionsHtml += renderSectionBlock(type, section, data);
      }
      if (importedSectionsHtml) {
        const collapsedClass = expandGroup === 'Imported' ? '' : ' labor-book-group-collapsed';
        html += `
        <div class="labor-book-group${collapsedClass}" data-group="Imported">
          <h2 class="labor-book-group-header"><span class="labor-book-section-chevron"></span>Imported</h2>
          <div class="labor-book-group-body">
            ${importedSectionsHtml}
          </div>
        </div>
      `;
      }
    } else {
      const transformersSections = sections.filter((s) => s.startsWith('Transformers.'));
      const panelsSections = sections.filter((s) => s.startsWith('Panels.'));
      const otherSections = sections.filter(
        (s) => !s.startsWith('Transformers.') && !s.startsWith('Panels.') && !s.startsWith('Cable Tray.')
      );

      for (const section of otherSections) {
        html += renderSectionBlock(type, section, data);
      }

    if (panelsSections.length > 0 && type === 'gear') {
      let panelsHtml = '<div class="labor-book-section labor-book-section-collapsed" data-section="Panels"><h3 class="labor-book-section-header"><span class="labor-book-section-chevron"></span>Panels</h3><div class="labor-book-section-body">';
      for (const section of panelsSections) {
        const subLabel = section.replace('Panels.', '');
        const rowHtml = renderSectionRows(type, section, data);
        panelsHtml += `
          <h4 class="labor-book-subsection">${escapeHtml(subLabel)}</h4>
          <table>
            <thead><tr><th>Add</th><th>Name</th><th>Labor (hrs)</th><th>Price</th><th></th></tr></thead>
            <tbody>${rowHtml}</tbody>
          </table>
          <button type="button" class="btn add-row-btn" data-type="${type}" data-section="${escapeHtml(section)}">Add Row</button>
        `;
      }
      panelsHtml += '</div></div>';
      html += panelsHtml;
    }

    if (transformersSections.length > 0 && type === 'gear') {
      let transformersHtml = '<div class="labor-book-section labor-book-section-collapsed" data-section="Transformers"><h3 class="labor-book-section-header"><span class="labor-book-section-chevron"></span>Transformers</h3><div class="labor-book-section-body">';
      for (const section of transformersSections) {
        const subLabel = section.replace('Transformers.', '');
        const rowHtml = renderSectionRows(type, section, data);
        transformersHtml += `
          <h4 class="labor-book-subsection">${escapeHtml(subLabel)}</h4>
          <table>
            <thead><tr><th>Add</th><th>Name</th><th>Labor (hrs)</th><th>Price</th><th></th></tr></thead>
            <tbody>${rowHtml}</tbody>
          </table>
          <button type="button" class="btn add-row-btn" data-type="${type}" data-section="${escapeHtml(section)}">Add Row</button>
        `;
      }
      transformersHtml += '</div></div>';
      html += transformersHtml;
    }
    }

    return html;
  }

  // Tab-level filter: narrows the curated sections in the DOM (rows are live
  // inputs) and hands the term to the supplier group's data-driven filter.
  function applyTabFilter(termRaw) {
    const partsEl = document.getElementById('labor-book-content');
    if (!partsEl) return;
    const term = (termRaw || '').trim().toLowerCase();
    partsEl.querySelectorAll('.labor-book-section').forEach((sec) => {
      // row names can be bare sizes ("12", "3/4\"") — the meaning often lives
      // in the section or group title, so a title match shows the whole block
      const groupEl = sec.closest('.labor-book-group:not(.elliot-parts-group)');
      const titleMatch =
        term &&
        ((sec.dataset.section || '').toLowerCase().includes(term) ||
          (groupEl?.dataset.group || '').toLowerCase().includes(term));
      let any = false;
      sec.querySelectorAll('.labor-book-row').forEach((row) => {
        const name = (row.querySelector('.labor-book-name')?.value || '').toLowerCase();
        const show = !term || titleMatch || name.includes(term);
        row.style.display = show ? '' : 'none';
        if (show) any = true;
      });
      sec.style.display = !term || any ? '' : 'none';
      // clearing the term restores the default all-collapsed view
      sec.classList.toggle('labor-book-section-collapsed', term ? !any : true);
    });
    partsEl.querySelectorAll('.labor-book-group:not(.elliot-parts-group)').forEach((g) => {
      const anyVisible = Array.from(g.querySelectorAll('.labor-book-section')).some((s) => s.style.display !== 'none');
      g.style.display = !term || anyVisible ? '' : 'none';
      g.classList.toggle('labor-book-group-collapsed', term ? !anyVisible : true);
    });
    partsEl.querySelector('.elliot-parts-group')?._applyTabFilter?.(term);
  }

  let tabFilterTimer = null;

  function renderApplyToSelect() {
    const items = TakeoffState.getTopLevelItems();
    return items
      .map((item) => {
        const desc = (item.description || '').slice(0, 40) + ((item.description || '').length > 40 ? '...' : '');
        const label = `${desc} | Quantity: ${item.quantity || 0} | ${item.planPage || '-'}`;
        return `<option value="${item.id}">${escapeHtml(label)}</option>`;
      })
      .join('');
  }

  function syncSectionToggle() {
    document.querySelectorAll('#labor-book-section-toggle .labor-book-section-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.section === activeSection);
    });
  }

  function updateAssemblyTabCounts() {
    if (activeSection !== 'assemblies' || typeof McBook === 'undefined') return;
    document.querySelectorAll('#labor-book-tabs .labor-book-tab').forEach((btn) => {
      const n = McBook.sectionCount(btn.dataset.tab);
      if (n > 0 && !btn.querySelector('.mc-book-tab-count')) {
        btn.insertAdjacentHTML('beforeend', ` <span class="mc-book-tab-count">${n}</span>`);
      }
    });
  }

  function setActiveSection(section) {
    if (section !== 'parts' && section !== 'assemblies') return;
    activeSection = section;
    // choosing a section exits search mode
    TakeoffLaborBookSearch.setTerm('');
    const input = document.getElementById('labor-book-global-search');
    if (input) input.value = '';
    render();
    attachListeners();
  }

  function refreshAssembliesIfVisible() {
    const modal = document.getElementById('labor-book-modal');
    if (modal?.getAttribute('aria-hidden') === 'false' && activeSection === 'assemblies') {
      render();
      attachListeners();
    }
  }

  function render() {
    syncSectionToggle();
    const partsEl = document.getElementById('labor-book-content');
    const asmEl = document.getElementById('labor-book-assemblies');
    const searchEl = document.getElementById('labor-book-search-results');
    const tabsEl = document.getElementById('labor-book-tabs');
    const searchTerm = TakeoffLaborBookSearch.getTerm();
    // Update Elliot Prices is a Parts-section action (bottom of the modal)
    document.getElementById('mc-elliot-update-btn')?.classList.toggle('lb-hidden', activeSection !== 'parts' || !!searchTerm);

    if (searchTerm) {
      partsEl.classList.add('lb-hidden');
      partsEl.innerHTML = '';
      asmEl?.classList.add('lb-hidden');
      tabsEl.classList.add('lb-hidden');
      tabsEl.innerHTML = '';
      searchEl?.classList.remove('lb-hidden');
      TakeoffLaborBookSearch.renderResults();
    } else {
      searchEl?.classList.add('lb-hidden');
      if (searchEl) searchEl.innerHTML = '';
      tabsEl.classList.remove('lb-hidden');
      tabsEl.innerHTML = renderTabs();
      if (activeSection === 'assemblies') {
        partsEl.classList.add('lb-hidden');
        partsEl.innerHTML = '';
        asmEl?.classList.remove('lb-hidden');
        if (typeof McBook !== 'undefined') McBook.renderAssemblies().then(updateAssemblyTabCounts);
      } else {
        asmEl?.classList.add('lb-hidden');
        partsEl.classList.remove('lb-hidden');
        partsEl.innerHTML = renderContent();
        TakeoffLaborBookElliot.injectElliotParts(partsEl, () => activeSection);
      }
    }
    const fillTarget = TakeoffState.getLaborBookFillTarget?.();
    const deviceTarget = TakeoffState.getLaborBookTargetDeviceRow();
    const preselectedId = TakeoffState.getLaborBookPreselectedItemId();
    const applyToEl = document.getElementById('labor-book-apply-to');
    if (fillTarget) {
      const labels = {
        'manifest-row': 'manifest row',
        'device-row': `${fillTarget.section || ''} row ${(fillTarget.index ?? 0) + 1}`,
        'conduit-fitting': `fitting row ${(fillTarget.index ?? 0) + 1}`,
        'wire-mac': `MAC adapter row ${(fillTarget.index ?? 0) + 1}`,
      };
      applyToEl.innerHTML = `<div class="labor-book-preselected">Fill: <strong>${escapeHtml(labels[fillTarget.kind] || 'row')}</strong> — selecting an entry replaces this row's description, labor, and price</div>`;
      applyToEl.removeAttribute('data-target-fixture-id');
      applyToEl.removeAttribute('data-target-device-row');
    } else if (deviceTarget) {
      const sectionLabels = { boxes: 'Box', covers: 'Cover', conduit: 'Conduit', wire: 'Wire', screws: 'Screws', misc: 'Misc.' };
      const label = sectionLabels[deviceTarget.section] || deviceTarget.section;
      const temp = TakeoffState.getDeviceTempData();
      const row = temp[deviceTarget.section]?.[deviceTarget.index];
      const desc = (row?.description || '').slice(0, 40) + ((row?.description || '').length > 40 ? '...' : '');
      applyToEl.innerHTML = `<div class="labor-book-preselected">Add to: <strong>${escapeHtml(label)} row ${deviceTarget.index + 1}</strong>${desc ? ` (${escapeHtml(desc)})` : ''}</div>`;
      applyToEl.dataset.targetDeviceRow = JSON.stringify(deviceTarget);
      applyToEl.removeAttribute('data-target-fixture-id');
    } else if (preselectedId) {
      const fixtureId = TakeoffState.getTopLevelParentId(preselectedId);
      const fixture = TakeoffState.getItemById(fixtureId);
      const desc = (fixture?.description || '').slice(0, 50) + ((fixture?.description || '').length > 50 ? '...' : '');
      applyToEl.innerHTML = `<div class="labor-book-preselected">Add to: <strong>${escapeHtml(desc)}</strong> (Quantity: ${fixture?.quantity || 0})</div>`;
      applyToEl.dataset.targetFixtureId = fixtureId;
      applyToEl.removeAttribute('data-target-device-row');
    } else {
      applyToEl.removeAttribute('data-target-fixture-id');
      applyToEl.removeAttribute('data-target-device-row');
      const prevSelect = document.getElementById('labor-book-target-select');
      const currentVal = prevSelect?.value || '';
      applyToEl.innerHTML = '<label>Add to fixture: <select id="labor-book-target-select"><option value="">-- Select fixture --</option>' + renderApplyToSelect() + '</select></label>';
      const select = document.getElementById('labor-book-target-select');
      if (select && currentVal) select.value = currentVal;
    }
  }

  function exportGroupsAndSectionsAsText() {
    const tabs = TakeoffState.getLaborBookTabOrder();
    const labels = TakeoffState.LABOR_BOOK_TYPE_LABELS || {};
    const lines = [];

    for (const type of tabs) {
      const data = TakeoffState.getLaborBookType(type);
      const sections = Object.keys(data);
      const groups = TakeoffState.getLaborBookGroups(type);

      if (sections.length === 0) continue;

      lines.push(labels[type] || type);
      lines.push('');

      if (groups && type === 'conduit') {
        for (const group of groups) {
          lines.push('  ' + group.name);
          for (const section of group.sections) {
            if (data[section]) lines.push('    - ' + section);
          }
          lines.push('');
        }
      } else {
        const panelsSections = sections.filter((s) => s.startsWith('Panels.'));
        const transformersSections = sections.filter((s) => s.startsWith('Transformers.'));
        const cableTraySections = sections.filter((s) => s.startsWith('Cable Tray.'));
        const otherSections = sections.filter(
          (s) => !s.startsWith('Panels.') && !s.startsWith('Transformers.') && !s.startsWith('Cable Tray.')
        );

        for (const section of otherSections) {
          lines.push('  - ' + section);
        }
        if (panelsSections.length > 0) {
          lines.push('  Panels');
          for (const s of panelsSections) {
            lines.push('    - ' + s.replace('Panels.', ''));
          }
        }
        if (transformersSections.length > 0) {
          lines.push('  Transformers');
          for (const s of transformersSections) {
            lines.push('    - ' + s.replace('Transformers.', ''));
          }
        }
        if (cableTraySections.length > 0) {
          lines.push('  Cable Tray');
          for (const s of cableTraySections) {
            lines.push('    - ' + s.replace('Cable Tray.', ''));
          }
        }
        lines.push('');
      }
    }

    const text = lines.join('\n').trim();
    if (!text) return;

    navigator.clipboard
      .writeText(text)
      .then(() => {
        const btn = document.getElementById('labor-book-export-structure-btn');
        if (btn) {
          const orig = btn.textContent;
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = orig; }, 1500);
        }
      })
      .catch((err) => {
        alert('Failed to copy: ' + (err.message || 'Unknown error'));
      });
  }

  function attachListeners() {
    document.getElementById('labor-book-close-btn')?.addEventListener('click', () => {
      TakeoffApp.hideLaborBookModal();
    });

    document.getElementById('labor-book-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'labor-book-modal') TakeoffApp.hideLaborBookModal();
    });

    document.querySelectorAll('.labor-book-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        TakeoffState.setActiveLaborBookTab(btn.dataset.tab);
        render();
        attachListeners();
      });
    });

    document.querySelector('.labor-book-tab-filter')?.addEventListener('input', (e) => {
      if (tabFilterTimer) clearTimeout(tabFilterTimer);
      tabFilterTimer = setTimeout(() => applyTabFilter(e.target.value), 200);
    });

    function addRowToFixture(row) {
      TakeoffLaborBookTargets.addEntryToTarget({
        description: TakeoffLaborBookTargets.describeBookRow(row.querySelector('.labor-book-name')?.value || '', row.dataset.section || ''),
        labor: parseFloat(row.dataset.labor) || 0,
        price: row.querySelector('.labor-book-price')?.value?.trim() || null,
      });
    }

    document.querySelectorAll('.labor-book-add-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const row = btn.closest('.labor-book-row');
        if (row) addRowToFixture(row);
      });
    });

    document.querySelectorAll('.labor-book-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.labor-book-remove-row') || e.target.closest('.labor-book-add-btn') || e.target.closest('input') || e.target.closest('.labor-book-price')) return;
        addRowToFixture(row);
      });
    });

    document.querySelectorAll('.labor-book-name, .labor-book-hrs, .labor-book-price').forEach((input) => {
      input.addEventListener('change', (e) => {
        const { type, section, index } = e.target.dataset;
        let field, value;
        if (e.target.classList.contains('labor-book-name')) {
          field = 'name';
          value = e.target.value;
        } else if (e.target.classList.contains('labor-book-hrs')) {
          field = 'labor';
          value = parseFloat(e.target.value) || 0;
        } else {
          field = 'price';
          value = e.target.value;
        }
        TakeoffState.updateLaborBookRow(type, section, parseInt(index, 10), { [field]: value });
        const row = e.target.closest('.labor-book-row');
        if (row && field === 'labor') row.dataset.labor = value;
      });
    });

    document.querySelectorAll('.labor-book-remove-row').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const { type, section, index } = btn.dataset;
        TakeoffState.removeLaborBookRow(type, section, parseInt(index, 10));
        render();
        attachListeners();
      });
    });

    document.querySelectorAll('.add-row-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const { type, section } = btn.dataset;
        TakeoffState.addLaborBookRow(type, section, { name: '', labor: 0, price: '' });
        render();
        attachListeners();
      });
    });

    document.querySelectorAll('.add-section-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        const name = prompt('Section name:', 'New Section');
        if (name) {
          TakeoffState.addLaborBookSection(type, name.trim());
          render();
          attachListeners();
        }
      });
    });

    document.querySelectorAll('.labor-book-browse-assemblies-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        setActiveSection('assemblies');
      });
    });

    document.querySelectorAll('.labor-book-section-header').forEach((header) => {
      header.addEventListener('click', () => {
        const section = header.closest('.labor-book-section');
        if (section) section.classList.toggle('labor-book-section-collapsed');
      });
    });

    document.querySelectorAll('.labor-book-group-header').forEach((header) => {
      header.addEventListener('click', () => {
        const group = header.closest('.labor-book-group');
        if (group) group.classList.toggle('labor-book-group-collapsed');
      });
    });
  }

  // ---------- one-time listeners (modal chrome) ----------

  document.getElementById('labor-book-export-structure-btn')?.addEventListener('click', () => {
    exportGroupsAndSectionsAsText();
  });

  document.getElementById('labor-book-abbreviation-key-btn')?.addEventListener('click', () => {
    const modal = document.getElementById('abbreviation-key-modal');
    if (modal) modal.setAttribute('aria-hidden', 'false');
  });

  document.getElementById('abbreviation-key-close-btn')?.addEventListener('click', () => {
    const modal = document.getElementById('abbreviation-key-modal');
    if (modal) modal.setAttribute('aria-hidden', 'true');
  });

  document.getElementById('abbreviation-key-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'abbreviation-key-modal') {
      e.target.setAttribute('aria-hidden', 'true');
    }
  });

  document.addEventListener('keydown', function laborBookHotkeyHandler(e) {
    const modal = document.getElementById('labor-book-modal');
    if (!modal || modal.getAttribute('aria-hidden') !== 'false') return;
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
    const key = (e.key || '').toLowerCase();
    const tab = TAB_HOTKEYS[key];
    if (tab) {
      e.preventDefault();
      TakeoffState.setActiveLaborBookTab(tab);
      TakeoffLaborBookView.render();
      TakeoffLaborBookView.attachListeners();
    }
  });

  document.getElementById('labor-book-section-toggle')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-section]');
    if (btn) setActiveSection(btn.dataset.section);
  });

  document.getElementById('labor-book-open-btn')?.addEventListener('click', () => {
    TakeoffApp.showLaborBookModal();
  });

  return {
    render,
    attachListeners,
    setActiveSection,
    refreshAssembliesIfVisible,
    // apply-to-takeoff API delegates to TakeoffLaborBookTargets (stable
    // surface for McBook and older callers)
    addEntryToTarget: TakeoffLaborBookTargets.addEntryToTarget,
    addComponentsToTarget: TakeoffLaborBookTargets.addComponentsToTarget,
    hasFillTarget: TakeoffLaborBookTargets.hasFillTarget,
  };
})();
