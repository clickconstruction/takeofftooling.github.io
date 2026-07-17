/**
 * Labor and Price Book modal - tabs per item type, labor rate rows, apply to manifest item
 */

const TakeoffLaborBookView = (function () {
  const TRASH_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" class="trash-icon"><path d="M232.7 69.9L224 96L128 96C110.3 96 96 110.3 96 128C96 145.7 110.3 160 128 160L512 160C529.7 160 544 145.7 544 128C544 110.3 529.7 96 512 96L416 96L407.3 69.9C402.9 56.8 390.7 48 376.9 48L263.1 48C249.3 48 237.1 56.8 232.7 69.9zM512 208L128 208L149.1 531.1C150.7 556.4 171.7 576 197 576L443 576C468.3 576 489.3 556.4 490.9 531.1L512 208z"/></svg>';

  const TAB_HOTKEYS = { g: 'gear', l: 'lighting', d: 'devices', c: 'conduit', w: 'wire', s: 'specialSystems' };
  const TAB_TO_KEY = { gear: 'G', lighting: 'L', devices: 'D', conduit: 'C', wire: 'W', specialSystems: 'S' };

  // 'parts' | 'assemblies' — remembered across modal opens (in-memory only)
  let activeSection = 'parts';

  // Global search across both sections (assemblies listed first, parts second)
  let globalSearchTerm = '';
  let lastSearch = { assemblies: [], parts: [], elliot: [] };
  const SEARCH_CAP = 80;

  // Terse book names ("600a", "1200a") need their section for context;
  // full assembly names already carry it.
  function describeBookRow(name, section) {
    if (section === 'Panels.1PH') return `${name} Panel (1PH)`;
    if (section === 'Panels.3PH') return `${name} Panel (3PH)`;
    if (section === 'THHN CU' || section === 'THW AL') return `${section} ${name}`;
    if (section.startsWith('Cable Tray.')) return `${name} Cable Tray (${section.replace('Cable Tray.', '')})`;
    if (section && name.length < 10) return `${name} ${section}`;
    return name;
  }

  /**
   * Add one entry (from Parts rows or Assemblies entries) to the current
   * target: a device temp row, the conduit fittings list, or a manifest
   * fixture (child inherits the parent's quantity). Returns true if added.
   */
  function addEntryToTarget({ description, labor, price }) {
    const applyToEl = document.getElementById('labor-book-apply-to');
    const deviceTargetJson = applyToEl?.dataset.targetDeviceRow;
    const laborHours = Number(labor) || 0;

    // FILL mode: replace the targeted row's fields in place (PB buttons)
    const fill = TakeoffState.getLaborBookFillTarget?.();
    if (fill) {
      const priceNum = price != null && String(price).trim() !== '' ? parseFloat(price) : null;
      if (fill.kind === 'manifest-row') {
        TakeoffState.updateItem(fill.id, { description, labor: laborHours, price: priceNum });
      } else if (fill.kind === 'device-row') {
        const temp = TakeoffState.getDeviceTempData();
        const row = temp[fill.section]?.[fill.index];
        if (!row) return false;
        row.description = description;
        row.labor = laborHours;
        row.price = priceNum != null ? priceNum : '';
        TakeoffState.setDeviceTempData(temp);
      } else if (fill.kind === 'conduit-fitting') {
        const temp = TakeoffState.getConduitTempData();
        const row = (temp.fittings || [])[fill.index];
        if (!row) return false;
        row.description = description;
        row.labor = laborHours;
        row.price = priceNum != null ? priceNum : '';
        TakeoffState.setConduitTempData(temp);
      } else if (fill.kind === 'wire-mac') {
        const temp = TakeoffState.getWireTempData();
        const row = (temp.macAdapters || [])[fill.index];
        if (!row) return false;
        row.description = description;
        row.labor = laborHours;
        if (priceNum != null) row.price = priceNum;
        TakeoffState.setWireTempData(temp);
      } else {
        return false;
      }
      TakeoffApp.render();
      TakeoffApp.hideLaborBookModal();
      return true;
    }
    if (deviceTargetJson) {
      const deviceTarget = JSON.parse(deviceTargetJson);
      const temp = TakeoffState.getDeviceTempData();
      const targetRow = temp[deviceTarget.section]?.[deviceTarget.index];
      if (!targetRow) return false;
      const priceNum = price != null && String(price).trim() !== '' ? parseFloat(price) : null;
      targetRow.description = targetRow.description ? `${targetRow.description}, ${description}` : description;
      targetRow.quantity = (targetRow.quantity || 0) + 1;
      targetRow.labor = (targetRow.labor || 0) + laborHours;
      if (priceNum != null && !isNaN(priceNum)) {
        const existingPrice = targetRow.price != null && targetRow.price !== '' ? parseFloat(targetRow.price) : 0;
        targetRow.price = existingPrice + priceNum;
      }
      TakeoffState.setDeviceTempData(temp);
      TakeoffApp.render();
      return true;
    }
    const targetId = applyToEl?.dataset.targetFixtureId || document.getElementById('labor-book-target-select')?.value;
    if (!targetId) {
      alert('Please select a fixture from "Add to fixture" first.');
      return false;
    }
    if (
      targetId === TakeoffState.getCurrentItemId() &&
      TakeoffState.getCurrentView() === 'conduit' &&
      TakeoffState.getConduitStep() === 2
    ) {
      const temp = TakeoffState.getConduitTempData();
      temp.fittings = temp.fittings || [];
      temp.fittings.push({ description, quantity: 1, labor: laborHours, price: price || '' });
      TakeoffState.setConduitTempData(temp);
    } else {
      // Inherit the parent's quantity: pricing a qty-24 fixture from the book
      // should count 24 units, not 1.
      const parent = TakeoffState.getItemById(targetId);
      const inheritedQty = Number(parent?.quantity) > 0 ? Number(parent.quantity) : 1;
      TakeoffState.addItem({
        parentId: targetId,
        description,
        quantity: inheritedQty,
        labor: laborHours,
        planPage: '',
        type: null,
        price: price,
      });
    }
    TakeoffApp.render();
    return true;
  }

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

    if (sections.length === 0) {
      return `
        <div class="labor-book-empty">
          <p>No parts sections yet. Browse Assemblies for priced entries, or start a section from scratch.</p>
          <button type="button" class="btn btn-success labor-book-browse-assemblies-btn">Browse Assemblies</button>
          <button type="button" class="btn add-section-btn" data-type="${type}">Add Section</button>
        </div>
      `;
    }

    let html = '';

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
    globalSearchTerm = '';
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

  const round2 = (n) => Math.round(n * 100) / 100;

  /**
   * Exploded assembly add: each component lands individually on the target.
   * components: [{description, qty (per assembly unit), labor (hrs/each), price (per each)}]
   * - manifest fixture: one child per component, qty scaled by the fixture qty, single undo frame
   * - conduit fittings: one fittings row per component, qty scaled by the run's footage
   * - device temp row: first component fills the clicked row (if empty) or merges; the rest append as new rows
   * Returns true if added.
   */
  function hasFillTarget() {
    return !!TakeoffState.getLaborBookFillTarget?.();
  }

  function addComponentsToTarget(components) {
    if (!components || !components.length) return false;
    // FILL mode fills one row: component explosion doesn't apply here
    if (hasFillTarget()) return false;
    const applyToEl = document.getElementById('labor-book-apply-to');
    const deviceTargetJson = applyToEl?.dataset.targetDeviceRow;

    if (deviceTargetJson) {
      const deviceTarget = JSON.parse(deviceTargetJson);
      const temp = TakeoffState.getDeviceTempData();
      const rows = temp[deviceTarget.section];
      const targetRow = rows?.[deviceTarget.index];
      if (!targetRow) return false;
      let insertAt = deviceTarget.index + 1;
      for (let i = 0; i < components.length; i++) {
        const c = components[i];
        const qty = round2(c.qty);
        if (i === 0 && !(targetRow.description || '').trim()) {
          targetRow.description = c.description;
          targetRow.quantity = qty;
          targetRow.labor = c.labor || 0;
          targetRow.price = c.price != null ? round2(Number(c.price)) : '';
        } else {
          rows.splice(insertAt++, 0, {
            description: c.description,
            quantity: qty,
            labor: c.labor || 0,
            price: c.price != null ? round2(Number(c.price)) : '',
          });
        }
      }
      TakeoffState.setDeviceTempData(temp);
      TakeoffApp.render();
      return true;
    }

    const targetId = applyToEl?.dataset.targetFixtureId || document.getElementById('labor-book-target-select')?.value;
    if (!targetId) {
      alert('Please select a fixture from "Add to fixture" first.');
      return false;
    }
    const targetItem = TakeoffState.getItemById(targetId);
    const scale = Number(targetItem?.quantity) > 0 ? Number(targetItem.quantity) : 1;

    if (
      targetId === TakeoffState.getCurrentItemId() &&
      TakeoffState.getCurrentView() === 'conduit' &&
      TakeoffState.getConduitStep() === 2
    ) {
      const temp = TakeoffState.getConduitTempData();
      temp.fittings = temp.fittings || [];
      for (const c of components) {
        temp.fittings.push({ description: c.description, quantity: round2(c.qty * scale), labor: c.labor || 0, price: c.price != null ? String(round2(Number(c.price))) : '' });
      }
      TakeoffState.setConduitTempData(temp);
    } else {
      TakeoffState.beginBatch(); // whole assembly explosion = one undo frame
      for (const c of components) {
        TakeoffState.addItem({
          parentId: targetId,
          description: c.description,
          quantity: round2(c.qty * scale),
          labor: c.labor || 0,
          planPage: '',
          type: null,
          price: c.price != null ? round2(Number(c.price)) : null,
        });
      }
      TakeoffState.endBatch();
    }
    TakeoffApp.render();
    return true;
  }

  // ---------- Elliot supply-house parts inside the Parts section ----------
  // Rendered live from the Elliot price data (not copied into the editable
  // Parts store): one collapsible group per tab, a section per Elliot
  // category, entries lazy-loaded, with a filter box and + Add to fixture.

  const ELLIOT_FILTER_CAP = 200;

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

  function injectElliotParts(partsEl) {
    if (typeof McBook === 'undefined') return;
    const renderedForTab = TakeoffState.getActiveLaborBookTab();
    McBook.ensureLoaded().then(() => {
      // guard against stale async: user may have switched tab/section meanwhile
      if (activeSection !== 'parts' || TakeoffState.getActiveLaborBookTab() !== renderedForTab) return;
      if (partsEl.querySelector('.elliot-parts-group')) return;
      const sections = McBook.elliotSectionsForTab(renderedForTab);
      if (!sections.length) return;
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
      group.className = 'labor-book-group labor-book-group-collapsed mc-book-group elliot-parts-group';
      group.innerHTML = `
        <h2 class="labor-book-group-header"><span class="labor-book-section-chevron"></span>${escapeHtml((sections[0].level1 || 'Elliot') + ' Parts')} <span class="mc-book-section-count">${total.toLocaleString()}</span></h2>
        <div class="labor-book-group-body">
          <input type="text" class="elliot-parts-filter" placeholder="Filter supplier parts in this tab..." autocomplete="off" />
          <div class="elliot-parts-body">${sectionsHtml}</div>
        </div>`;
      partsEl.appendChild(group);

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
            addEntryToTarget({
              description: entry.name,
              labor: 0,
              price: entry.price ? String(entry.price) : null,
            });
          }
          return;
        }
        if (e.target.closest('.elliot-parts-filter')) return;
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

      let filterTimer = null;
      group.querySelector('.elliot-parts-filter').addEventListener('input', (e) => {
        if (filterTimer) clearTimeout(filterTimer);
        filterTimer = setTimeout(() => {
          const term = e.target.value.trim().toLowerCase();
          if (!term) {
            group._filtered = null;
            body.innerHTML = sectionsHtml;
            return;
          }
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
            (matched.length ? renderElliotPartRows(matched, '__filtered__') : '<p class="mc-book-empty">No matching Elliot parts in this tab.</p>');
        }, 200);
      });
    });
  }

  function labelForTab(tab) {
    return (TakeoffState.LABOR_BOOK_TYPE_LABELS || {})[tab] || tab;
  }

  // inch-marks are punctuation noise when searching ('1/2 emt' should hit '1/2" EMT')
  function searchNorm(s) {
    return (s || '').toLowerCase().replace(/["“”]/g, '');
  }

  function renderGlobalSearch() {
    const resultsEl = document.getElementById('labor-book-search-results');
    if (!resultsEl) return;
    const term = searchNorm(globalSearchTerm);

    // Parts (your editable book) — synchronous
    const parts = [];
    for (const tab of TakeoffState.getLaborBookTabOrder()) {
      const data = TakeoffState.getLaborBookType(tab);
      for (const [section, rows] of Object.entries(data)) {
        for (const row of rows) {
          if (searchNorm(row.name).includes(term)) {
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
      const termAtStart = globalSearchTerm;
      McBook.ensureLoaded().then(() => {
        if (globalSearchTerm !== termAtStart) return; // stale
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
              if (searchNorm(e.name).includes(term) || searchNorm(e.partNumber).includes(term)) {
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

  function render() {
    syncSectionToggle();
    const partsEl = document.getElementById('labor-book-content');
    const asmEl = document.getElementById('labor-book-assemblies');
    const searchEl = document.getElementById('labor-book-search-results');
    const tabsEl = document.getElementById('labor-book-tabs');
    // Update Elliot Prices is a Parts-section action (bottom of the modal)
    document.getElementById('mc-elliot-update-btn')?.classList.toggle('lb-hidden', activeSection !== 'parts' || !!globalSearchTerm);

    if (globalSearchTerm) {
      partsEl.classList.add('lb-hidden');
      partsEl.innerHTML = '';
      asmEl?.classList.add('lb-hidden');
      tabsEl.classList.add('lb-hidden');
      tabsEl.innerHTML = '';
      searchEl?.classList.remove('lb-hidden');
      renderGlobalSearch();
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
        injectElliotParts(partsEl);
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

    function addRowToFixture(row) {
      addEntryToTarget({
        description: describeBookRow(row.querySelector('.labor-book-name')?.value || '', row.dataset.section || ''),
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

  let globalSearchTimer = null;
  document.getElementById('labor-book-global-search')?.addEventListener('input', (e) => {
    if (globalSearchTimer) clearTimeout(globalSearchTimer);
    globalSearchTimer = setTimeout(() => {
      globalSearchTerm = e.target.value.trim();
      render();
      attachListeners();
    }, 250);
  });

  document.getElementById('labor-book-global-search')?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (e.target.value) {
        e.target.value = '';
        globalSearchTerm = '';
        render();
        attachListeners();
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
      if (hit) flash(addEntryToTarget({
        description: describeBookRow(hit.row.name || '', hit.section),
        labor: hit.row.labor || 0,
        price: hit.row.price != null && hit.row.price !== '' ? String(hit.row.price) : null,
      }));
    } else if (btn.dataset.kind === 'elliot') {
      const hit = lastSearch.elliot[i];
      if (hit) flash(addEntryToTarget({
        description: hit.entry.name,
        labor: 0,
        price: hit.entry.price != null ? String(hit.entry.price) : null,
      }));
    }
  });

  document.getElementById('labor-book-open-btn')?.addEventListener('click', () => {
    TakeoffApp.showLaborBookModal();
  });

  return { render, attachListeners, setActiveSection, addEntryToTarget, addComponentsToTarget, hasFillTarget, refreshAssembliesIfVisible };
})();
