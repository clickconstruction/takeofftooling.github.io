/**
 * Device flow - Boxes, Covers, Conduit, Wire, Screws, Misc.
 */

const TakeoffDeviceView = (function () {
  const TRASH_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" class="trash-icon"><path d="M232.7 69.9L224 96L128 96C110.3 96 96 110.3 96 128C96 145.7 110.3 160 128 160L512 160C529.7 160 544 145.7 544 128C544 110.3 529.7 96 512 96L416 96L407.3 69.9C402.9 56.8 390.7 48 376.9 48L263.1 48C249.3 48 237.1 56.8 232.7 69.9zM512 208L128 208L149.1 531.1C150.7 556.4 171.7 576 197 576L443 576C468.3 576 489.3 556.4 490.9 531.1L512 208z"/></svg>';
  const BOOK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" class="labor-book-icon"><path d="M480 576L192 576C139 576 96 533 96 480L96 160C96 107 139 64 192 64L496 64C522.5 64 544 85.5 544 112L544 400C544 420.9 530.6 438.7 512 445.3L512 512C529.7 512 544 526.3 544 544C544 561.7 529.7 576 512 576L480 576zM192 448C174.3 448 160 462.3 160 480C160 497.7 174.3 512 192 512L448 512L448 448L192 448zM224 216C224 229.3 234.7 240 248 240L424 240C437.3 240 448 229.3 448 216C448 202.7 437.3 192 424 192L248 192C234.7 192 224 202.7 224 216zM248 288C234.7 288 224 298.7 224 312C224 325.3 234.7 336 248 336L424 336C437.3 336 448 325.3 448 312C448 298.7 437.3 288 424 288L248 288z"/></svg>';

  const DEVICE_SECTIONS = [
    { key: 'outletsAndSwitches', label: 'Outlets and Switches', addLabel: '+ Outlet/Switch' },
    { key: 'boxes', label: 'Boxes', addLabel: '+ Box' },
    { key: 'backBoxSupport', label: 'Back Box Support', addLabel: '+ Back Box Support' },
    { key: 'covers', label: 'Covers', addLabel: '+ Cover' },
    { key: 'conduit', label: 'Conduit', addLabel: '+ Conduit' },
    { key: 'wire', label: 'Wire', addLabel: '+ Wire' },
    { key: 'screws', label: 'Screws', addLabel: '+ Screws' },
    { key: 'misc', label: 'Misc.', addLabel: '+ Misc.' },
  ];

  function renderSectionRows(sectionKey, rows) {
    return (rows || [])
      .map(
        (r, i) => `
      <tr>
        <td class="labor-book-cell"><button type="button" class="labor-book-icon-btn icon-btn" data-section="${sectionKey}" data-index="${i}" title="Open Labor and Price Book">${BOOK_SVG}</button></td>
        <td><input type="text" data-section="${sectionKey}" data-index="${i}" data-field="description" value="${escapeHtml(r.description || '')}" placeholder="Description" /></td>
        <td class="device-qty-cell"><div class="device-qty-wrap"><input type="number" data-section="${sectionKey}" data-index="${i}" data-field="quantity" value="${r.quantity ?? ''}" min="0" /><span class="device-qty-buttons-row"><button type="button" class="btn btn-small device-qty-x2-btn" data-section="${sectionKey}" data-index="${i}" title="Multiply by 2">×2</button><button type="button" class="btn btn-small device-qty-div2-btn" data-section="${sectionKey}" data-index="${i}" title="Divide by 2">/2</button></span></div></td>
        <td><input type="number" data-section="${sectionKey}" data-index="${i}" data-field="labor" value="${r.labor !== undefined ? r.labor : ''}" min="0" step="0.1" /></td>
        <td><input type="number" data-section="${sectionKey}" data-index="${i}" data-field="price" value="${r.price ?? ''}" min="0" step="0.01" dir="ltr" placeholder="Price" /></td>
        <td><button type="button" class="remove-child-btn icon-btn" data-section="${sectionKey}" data-index="${i}" title="Remove">${TRASH_SVG}</button></td>
      </tr>
    `
      )
      .join('');
  }

  function getCumulativeChildTotals(tempData) {
    let qty = 0;
    let labor = 0;
    let price = 0;
    for (const s of DEVICE_SECTIONS) {
      const rows = tempData[s.key] || [];
      for (const r of rows) {
        qty += parseFloat(r.quantity) || 0;
        labor += parseFloat(r.labor) || 0;
        price += parseFloat(r.price) || 0;
      }
    }
    return { qty, labor, price };
  }

  function render(itemId) {
    const item = TakeoffState.getItemById(itemId);
    if (!item) return '';

    const tempData = TakeoffState.getDeviceTempData();
    const canSave = DEVICE_SECTIONS.every((s) => (tempData[s.key] || []).length >= 1);
    const childTotals = getCumulativeChildTotals(tempData);

    const sectionsHtml = DEVICE_SECTIONS.map(
      (s) => `
        <div class="flow-section">
          <h3>${s.label}</h3>
          <table>
            <thead><tr><th></th><th>Description</th><th>Quantity</th><th>Labor</th><th>Price</th><th></th></tr></thead>
            <tbody>${renderSectionRows(s.key, tempData[s.key])}</tbody>
          </table>
          <div class="flow-section-add"><button type="button" class="btn add-device-section-btn" data-section="${s.key}">${s.addLabel}</button></div>
        </div>
      `
    ).join('');

    const assembliesList = TakeoffState.getAssemblies();
    const assembliesHtml = `
      <div class="assemblies-section assemblies-section-collapsed" id="assemblies-section">
        <h3 class="assemblies-section-header">
          <span class="assemblies-chevron"></span>Assemblies
          <select id="assemblies-select" class="assemblies-select" ${assembliesList.length ? '' : 'disabled'}>${assembliesList.length ? assembliesList.map((a) => `<option value="${a.id}">${escapeHtml(a.name || 'Unnamed')}</option>`).join('') : '<option value="">-- No assemblies --</option>'}</select>
          <button type="button" class="btn btn-secondary assemblies-load-btn" id="assemblies-load-btn" ${assembliesList.length ? '' : 'disabled'}>Load into Ledger</button>
        </h3>
        <div class="assemblies-section-body">
          ${assembliesList.length === 0 ? '<p class="assemblies-empty">No assemblies saved. Fill the form below and click "Save as Assembly →" to create one.</p>' : assembliesList.map((a) => {
            let assemblyPrice = 0;
            if (a.sections) {
              for (const s of DEVICE_SECTIONS) {
                const rows = a.sections[s.key] || [];
                for (const r of rows) assemblyPrice += parseFloat(r.price) || 0;
              }
            }
            const priceStr = assemblyPrice > 0 ? assemblyPrice.toFixed(2) : '0';
            return `
            <div class="assembly-card assembly-card-collapsed" data-assembly-id="${a.id}">
              <h4 class="assembly-card-header"><span class="assemblies-chevron"></span>${escapeHtml(a.name || 'Unnamed')} <span class="assembly-card-price">$${priceStr}</span></h4>
              <div class="assembly-card-body">
                ${DEVICE_SECTIONS.map((s) => {
                  const rows = (a.sections && a.sections[s.key]) || [];
                  if (rows.length === 0) return '';
                  return `<div class="assembly-subsection"><strong>${s.label}</strong><ul>${rows.map((r) => `<li>${escapeHtml(r.description || '-')} × ${r.quantity ?? 0} | Labor: ${r.labor ?? 0} | Price: ${r.price ?? ''}</li>`).join('')}</ul></div>`;
                }).join('')}
                <div class="assembly-card-actions">
                  <button type="button" class="btn btn-small assembly-load-btn" data-assembly-id="${a.id}">Load into Ledger</button>
                  <button type="button" class="btn btn-link assembly-delete-btn icon-btn" data-assembly-id="${a.id}" title="Delete assembly">${TRASH_SVG}</button>
                </div>
              </div>
            </div>
          `;
          }).join('')}
        </div>
      </div>
    `;

    return `
      <div class="flow-page device-flow">
        <div class="device-header-row">
          <h2>Devices - Add Boxes and Covers</h2>
          <button type="button" class="btn btn-success" id="device-save-assembly-btn">Save as Assembly →</button>
        </div>
        ${assembliesHtml}
        <div class="device-summary-row">
          <div class="parent-summary">
            <div class="parent-summary-line"><strong>Parent:</strong> ${escapeHtml(item.description || '')}</div>
            <div class="parent-summary-line">Quantity: ${item.quantity ?? 0}</div>
          </div>
          <div class="child-summary">
            <div class="parent-summary-line"><strong>Cumulative Child:</strong></div>
            <div class="parent-summary-line">Quantity: ${childTotals.qty % 1 === 0 ? childTotals.qty : childTotals.qty.toFixed(2)}</div>
            <div class="parent-summary-line">Labor: ${childTotals.labor.toFixed(1)} hrs</div>
            <div class="parent-summary-line">Price: ${childTotals.price.toFixed(2)}</div>
          </div>
        </div>
        ${sectionsHtml}
        <div class="flow-actions">
          <button type="button" class="btn btn-success" id="device-save-btn" ${canSave ? '' : 'disabled'}>Save and Back to Manifest</button>
        </div>
      </div>
    `;
  }

  function escapeHtml(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function attachListeners(itemId) {
    const item = TakeoffState.getItemById(itemId);
    if (!item) return;

    const hasParentDesc = (item.description || '').trim().length > 0;
    const parentQty = hasParentDesc ? 1 : (item.quantity ?? 0);
    document.querySelectorAll('.add-device-section-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const section = e.currentTarget.dataset.section;
        const temp = TakeoffState.getDeviceTempData();
        temp[section] = temp[section] || [];
        temp[section].push({ description: '', quantity: parentQty, labor: 0, price: '' });
        TakeoffState.setDeviceTempData(temp);
        TakeoffApp.render();
      });
    });

    document.querySelectorAll('.labor-book-icon-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const section = e.currentTarget.dataset.section;
        const index = parseInt(e.currentTarget.dataset.index, 10);
        TakeoffApp.showLaborBookModalForDeviceRow(section, index);
      });
    });

    document.querySelectorAll('.device-qty-x2-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const section = e.currentTarget.dataset.section;
        const index = parseInt(e.currentTarget.dataset.index, 10);
        const temp = TakeoffState.getDeviceTempData();
        const row = temp[section]?.[index];
        if (!row) return;
        const q = parseFloat(row.quantity) || 0;
        row.quantity = Math.round(q * 2 * 100) / 100;
        TakeoffState.setDeviceTempData(temp);
        TakeoffApp.render();
      });
    });

    document.querySelectorAll('.device-qty-div2-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const section = e.currentTarget.dataset.section;
        const index = parseInt(e.currentTarget.dataset.index, 10);
        const temp = TakeoffState.getDeviceTempData();
        const row = temp[section]?.[index];
        if (!row) return;
        const q = parseFloat(row.quantity) || 0;
        row.quantity = Math.max(0, Math.round((q / 2) * 100) / 100);
        TakeoffState.setDeviceTempData(temp);
        TakeoffApp.render();
      });
    });

    document.querySelectorAll('.remove-child-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const section = e.currentTarget.dataset.section;
        const index = parseInt(e.currentTarget.dataset.index, 10);
        const temp = TakeoffState.getDeviceTempData();
        if (!temp[section]) return;
        temp[section].splice(index, 1);
        if (temp[section].length === 0) {
          const parent = TakeoffState.getItemById(itemId);
          const hasDesc = (parent?.description || '').trim().length > 0;
          const qty = hasDesc ? 1 : (parent?.quantity ?? 0);
          temp[section].push({ description: '', quantity: qty, labor: 0, price: '' });
        }
        TakeoffState.setDeviceTempData(temp);
        TakeoffApp.render();
      });
    });

    document.querySelectorAll('[data-section][data-index][data-field]').forEach((input) => {
      input.addEventListener('change', (e) => {
        const section = e.target.dataset.section;
        const index = parseInt(e.target.dataset.index, 10);
        const field = e.target.dataset.field;
        let value = e.target.value;
        if (field === 'quantity' || field === 'labor') value = parseFloat(value) || 0;
        if (field === 'price') value = value === '' ? '' : (parseFloat(value) ?? '');
        const temp = TakeoffState.getDeviceTempData();
        if (!temp[section][index]) return;
        temp[section][index][field] = value;
        TakeoffState.setDeviceTempData(temp);
        TakeoffApp.render();
      });
    });

    document.getElementById('device-save-assembly-btn')?.addEventListener('click', () => {
      const temp = TakeoffState.getDeviceTempData();
      const name = prompt('Assembly name:');
      if (name == null || !name.trim()) return;
      const sections = {};
      for (const s of DEVICE_SECTIONS) {
        const rows = (temp[s.key] || []).map((r) => ({
          description: r.description,
          quantity: r.quantity,
          labor: r.labor,
          price: r.price,
        }));
        sections[s.key] = rows.length ? rows : [{ description: '', quantity: 0, labor: 0, price: '' }];
      }
      TakeoffState.addAssembly({ name: name.trim(), sections });
      TakeoffApp.render();
    });

    document.getElementById('assemblies-section')?.querySelector('.assemblies-section-header')?.addEventListener('click', (e) => {
      if (e.target.closest('.assemblies-load-btn') || e.target.closest('.assemblies-select')) return;
      document.getElementById('assemblies-section')?.classList.toggle('assemblies-section-collapsed');
    });

    document.getElementById('assemblies-load-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const select = document.getElementById('assemblies-select');
      const id = select?.value;
      if (!id) return;
      loadAssemblyIntoDevice(id);
    });

    document.getElementById('assemblies-select')?.addEventListener('click', (e) => e.stopPropagation());
    document.getElementById('assemblies-select')?.addEventListener('change', (e) => e.stopPropagation());

    document.querySelectorAll('.assembly-card-header').forEach((h) => {
      h.addEventListener('click', (e) => {
        if (e.target.closest('.assembly-load-btn') || e.target.closest('.assembly-delete-btn')) return;
        h.closest('.assembly-card')?.classList.toggle('assembly-card-collapsed');
      });
    });

    document.querySelectorAll('.assembly-delete-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm('Delete this assembly?')) return;
        TakeoffState.removeAssembly(e.currentTarget.dataset.assemblyId);
        TakeoffApp.render();
      });
    });

    document.querySelectorAll('.assembly-load-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        loadAssemblyIntoDevice(e.currentTarget.dataset.assemblyId);
      });
    });

    function loadAssemblyIntoDevice(assemblyId) {
      const assemblies = TakeoffState.getAssemblies();
      const a = assemblies.find((x) => x.id === assemblyId);
      if (!a || !a.sections) return;
      const temp = {};
      for (const s of DEVICE_SECTIONS) {
        const rows = (a.sections[s.key] || []);
        const hasDesc = (item.description || '').trim().length > 0;
        temp[s.key] = rows.length ? rows.map((r) => ({ ...r })) : [{ description: '', quantity: hasDesc ? 1 : (item.quantity ?? 0), labor: 0, price: '' }];
      }
      TakeoffState.setDeviceTempData(temp);
      TakeoffApp.render();
    }

    document.getElementById('device-save-btn')?.addEventListener('click', () => {
      const temp = TakeoffState.getDeviceTempData();
      const allTypes = ['outletsAndSwitches', 'box', 'backBoxSupport', 'cover', 'conduit', 'wire', 'screws', 'misc'];
      const sectionToType = { outletsAndSwitches: 'outletsAndSwitches', boxes: 'box', backBoxSupport: 'backBoxSupport', covers: 'cover', conduit: 'conduit', wire: 'wire', screws: 'screws', misc: 'misc' };
      const defaultLabels = { outletsAndSwitches: 'Outlets and Switches', box: 'Box', backBoxSupport: 'Back Box Support', cover: 'Cover', conduit: 'Conduit', wire: 'Wire', screws: 'Screws', misc: 'Misc.' };

      if (!DEVICE_SECTIONS.every((s) => (temp[s.key] || []).length >= 1)) return;

      const parent = TakeoffState.getItemById(itemId);
      if (parent) {
        parent.children = (parent.children || []).filter((c) => !allTypes.includes(c.type));
      }

      for (const s of DEVICE_SECTIONS) {
        const type = sectionToType[s.key];
        const rows = temp[s.key] || [];
        for (const r of rows) {
          TakeoffState.addItem({
            id: TakeoffState.generateId(),
            type,
            description: r.description || defaultLabels[type],
            quantity: r.quantity || 0,
            labor: r.labor || 0,
            price: r.price != null && r.price !== '' ? (parseFloat(r.price) || null) : null,
            parentId: itemId,
          });
        }
      }

      TakeoffApp.navigateToManifest();
    });
  }

  return { render, attachListeners };
})();
