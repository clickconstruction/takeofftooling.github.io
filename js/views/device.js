/**
 * Device flow - Boxes, Covers, Conduit, Wire, Screws, Misc.
 */

const TakeoffDeviceView = (function () {
  const TRASH_SVG = TakeoffViewShared.TRASH_SVG;
  const BOOK_SVG = TakeoffViewShared.BOOK_SVG;

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
        <td class="labor-book-cell"><button type="button" class="labor-book-icon-btn icon-btn" data-section="${sectionKey}" data-index="${i}" title="Open Labor and Price Book">${BOOK_SVG}</button><button type="button" class="part-book-icon-btn icon-btn" data-section="${sectionKey}" data-index="${i}" title="Part Book Search">PB</button></td>
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
          <button type="button" class="btn btn-success" id="device-save-btn">Save and Back to Manifest</button>
        </div>
      </div>
    `;
  }

  function escapeHtml(str) {
    return TakeoffUtils.escapeHtml(str);
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

    document.querySelectorAll('.part-book-icon-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const section = e.currentTarget.dataset.section;
        const index = parseInt(e.currentTarget.dataset.index, 10);
        TakeoffApp.showPartBookSearchForDeviceRow(section, index);
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

      TakeoffState.beginBatch(); // one undo frame per save
      const parent = TakeoffState.getItemById(itemId);
      if (parent) {
        parent.children = (parent.children || []).filter((c) => !allTypes.includes(c.type));
      }

      // a row is junk unless the user gave it a description, labor, or price;
      // quantity alone carries no information (empty sections are seeded with a qty-1 blank row)
      const isMeaningful = (r) =>
        (r.description || '').trim() !== '' || (parseFloat(r.labor) || 0) > 0 || (parseFloat(r.price) || 0) > 0;

      for (const s of DEVICE_SECTIONS) {
        const type = sectionToType[s.key];
        const rows = (temp[s.key] || []).filter(isMeaningful);
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

      TakeoffState.endBatch();
      TakeoffApp.navigateToManifest();
    });
  }

  return { render, attachListeners };
})();
