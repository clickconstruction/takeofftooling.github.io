/**
 * Labor and Price Book modal - tabs per item type, labor rate rows, apply to manifest item
 */

const TakeoffLaborBookView = (function () {
  const TRASH_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" class="trash-icon"><path d="M232.7 69.9L224 96L128 96C110.3 96 96 110.3 96 128C96 145.7 110.3 160 128 160L512 160C529.7 160 544 145.7 544 128C544 110.3 529.7 96 512 96L416 96L407.3 69.9C402.9 56.8 390.7 48 376.9 48L263.1 48C249.3 48 237.1 56.8 232.7 69.9zM512 208L128 208L149.1 531.1C150.7 556.4 171.7 576 197 576L443 576C468.3 576 489.3 556.4 490.9 531.1L512 208z"/></svg>';

  function escapeHtml(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function renderTabs() {
    const tabs = TakeoffState.getLaborBookTabOrder();
    const active = TakeoffState.getActiveLaborBookTab();
    const labels = TakeoffState.LABOR_BOOK_TYPE_LABELS || {};
    return tabs
      .map(
        (t) =>
          `<button type="button" class="labor-book-tab ${t === active ? 'active' : ''}" data-tab="${t}">${escapeHtml(labels[t] || t)}</button>`
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
          <p>No sections yet.</p>
          <button type="button" class="btn add-section-btn" data-type="${type}">Add Section</button>
        </div>
      `;
    }

    let html = '';

    if (groups && type === 'conduit') {
      const expandGroup = TakeoffState.getLaborBookExpandGroup?.() || null;
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

  function render() {
    document.getElementById('labor-book-tabs').innerHTML = renderTabs();
    document.getElementById('labor-book-content').innerHTML = renderContent();
    const deviceTarget = TakeoffState.getLaborBookTargetDeviceRow();
    const preselectedId = TakeoffState.getLaborBookPreselectedItemId();
    const applyToEl = document.getElementById('labor-book-apply-to');
    if (deviceTarget) {
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
      const applyToEl = document.getElementById('labor-book-apply-to');
      const deviceTargetJson = applyToEl?.dataset.targetDeviceRow;
      if (deviceTargetJson) {
        const deviceTarget = JSON.parse(deviceTargetJson);
        const temp = TakeoffState.getDeviceTempData();
        const targetRow = temp[deviceTarget.section]?.[deviceTarget.index];
        if (!targetRow) return;
        const name = row.querySelector('.labor-book-name')?.value || '';
        const lbSection = row.dataset.section || '';
        let itemDesc = name;
        if (lbSection === 'Panels.1PH') itemDesc = `${name} Panel (1PH)`;
        else if (lbSection === 'Panels.3PH') itemDesc = `${name} Panel (3PH)`;
        else if (lbSection === 'THHN CU' || lbSection === 'THW AL') itemDesc = `${lbSection} ${name}`;
        else if (lbSection.startsWith('Cable Tray.')) {
          const depth = lbSection.replace('Cable Tray.', '');
          itemDesc = `${name} Cable Tray (${depth})`;
        } else if (lbSection) itemDesc = `${name} ${lbSection}`;
        const laborHours = parseFloat(row.dataset.labor) || 0;
        const priceEl = row.querySelector('.labor-book-price');
        const priceVal = priceEl?.value?.trim() || '';
        const priceNum = priceVal ? parseFloat(priceVal) : null;
        targetRow.description = targetRow.description ? `${targetRow.description}, ${itemDesc}` : itemDesc;
        targetRow.quantity = (targetRow.quantity || 0) + 1;
        targetRow.labor = (targetRow.labor || 0) + laborHours;
        if (priceNum != null && !isNaN(priceNum)) {
          const existingPrice = targetRow.price != null && targetRow.price !== '' ? parseFloat(targetRow.price) : 0;
          targetRow.price = existingPrice + priceNum;
        }
        TakeoffState.setDeviceTempData(temp);
        TakeoffApp.render();
        return;
      }
      const targetId = applyToEl?.dataset.targetFixtureId || document.getElementById('labor-book-target-select')?.value;
      if (!targetId) {
        alert('Please select a fixture from "Add to fixture" first.');
        return;
      }
      const name = row.querySelector('.labor-book-name')?.value || '';
      const section = row.dataset.section || '';
      let description = name;
      if (section === 'Panels.1PH') description = `${name} Panel (1PH)`;
      else if (section === 'Panels.3PH') description = `${name} Panel (3PH)`;
      else if (section === 'THHN CU' || section === 'THW AL') description = `${section} ${name}`;
      else if (section.startsWith('Cable Tray.')) {
        const depth = section.replace('Cable Tray.', '');
        description = `${name} Cable Tray (${depth})`;
      } else if (section) description = `${name} ${section}`;
      const labor = parseFloat(row.dataset.labor) || 0;
      const priceEl = row.querySelector('.labor-book-price');
      const price = priceEl?.value?.trim() || null;

      if (
        targetId === TakeoffState.getCurrentItemId() &&
        TakeoffState.getCurrentView() === 'conduit' &&
        TakeoffState.getConduitStep() === 2
      ) {
        const temp = TakeoffState.getConduitTempData();
        temp.fittings = temp.fittings || [];
        temp.fittings.push({ description, quantity: 1, labor, price: price || '' });
        TakeoffState.setConduitTempData(temp);
      } else {
        TakeoffState.addItem({
          parentId: targetId,
          description,
          quantity: 1,
          labor: labor,
          planPage: '',
          type: null,
          price: price,
        });
      }
      TakeoffApp.render();
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

  return { render, attachListeners };
})();
