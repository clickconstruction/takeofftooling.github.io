/**
 * Device flow - Boxes and Covers
 */

const TakeoffDeviceView = (function () {
  function render(itemId) {
    const item = TakeoffState.getItemById(itemId);
    if (!item) return '';

    const tempData = TakeoffState.getDeviceTempData();
    const boxes = tempData.boxes || [];
    const covers = tempData.covers || [];

    const canSave = boxes.length >= 1 && covers.length >= 1;

    const boxRows = boxes
      .map(
        (b, i) => `
      <tr>
        <td><input type="text" data-section="boxes" data-index="${i}" data-field="description" value="${escapeHtml(b.description || '')}" placeholder="Description" /></td>
        <td><input type="number" data-section="boxes" data-index="${i}" data-field="quantity" value="${b.quantity || ''}" min="0" /></td>
        <td><input type="number" data-section="boxes" data-index="${i}" data-field="labor" value="${b.labor !== undefined ? b.labor : ''}" min="0" step="0.1" /></td>
        <td><button type="button" class="remove-child-btn" data-section="boxes" data-index="${i}">Remove</button></td>
      </tr>
    `
      )
      .join('');

    const coverRows = covers
      .map(
        (c, i) => `
      <tr>
        <td><input type="text" data-section="covers" data-index="${i}" data-field="description" value="${escapeHtml(c.description || '')}" placeholder="Description" /></td>
        <td><input type="number" data-section="covers" data-index="${i}" data-field="quantity" value="${c.quantity || ''}" min="0" /></td>
        <td><input type="number" data-section="covers" data-index="${i}" data-field="labor" value="${c.labor !== undefined ? c.labor : ''}" min="0" step="0.1" /></td>
        <td><button type="button" class="remove-child-btn" data-section="covers" data-index="${i}">Remove</button></td>
      </tr>
    `
      )
      .join('');

    return `
      <div class="flow-page device-flow">
        <h2>Devices - Add Boxes and Covers</h2>
        <div class="parent-summary">
          <strong>Parent:</strong> ${escapeHtml(item.description || '')} | Qty: ${item.quantity} | Labor: ${(item.labor || 0) * 0.1} hrs
        </div>
        <div class="flow-section">
          <h3>Boxes (at least one required)</h3>
          <table>
            <thead><tr><th>Description</th><th>Quantity</th><th>Labor</th><th></th></tr></thead>
            <tbody>${boxRows}</tbody>
          </table>
          <button type="button" class="btn add-box-btn">Add Box</button>
        </div>
        <div class="flow-section">
          <h3>Covers (at least one required)</h3>
          <table>
            <thead><tr><th>Description</th><th>Quantity</th><th>Labor</th><th></th></tr></thead>
            <tbody>${coverRows}</tbody>
          </table>
          <button type="button" class="btn add-cover-btn">Add Cover</button>
        </div>
        <div class="flow-actions">
          <button type="button" class="btn btn-secondary" id="device-back-btn">Back to Manifest</button>
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

    document.querySelector('.add-box-btn')?.addEventListener('click', () => {
      const temp = TakeoffState.getDeviceTempData();
      temp.boxes = temp.boxes || [];
      temp.boxes.push({ description: '', quantity: 0, labor: 0 });
      TakeoffState.setDeviceTempData(temp);
      TakeoffApp.render();
    });

    document.querySelector('.add-cover-btn')?.addEventListener('click', () => {
      const temp = TakeoffState.getDeviceTempData();
      temp.covers = temp.covers || [];
      temp.covers.push({ description: '', quantity: 0, labor: 0 });
      TakeoffState.setDeviceTempData(temp);
      TakeoffApp.render();
    });

    document.querySelectorAll('.remove-child-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const section = e.target.dataset.section;
        const index = parseInt(e.target.dataset.index, 10);
        const temp = TakeoffState.getDeviceTempData();
        temp[section].splice(index, 1);
        if (temp[section].length === 0) {
          temp[section].push({ description: '', quantity: 0, labor: 0 });
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
        const temp = TakeoffState.getDeviceTempData();
        if (!temp[section][index]) return;
        temp[section][index][field] = value;
        TakeoffState.setDeviceTempData(temp);
      });
    });

    document.getElementById('device-back-btn')?.addEventListener('click', () => {
      TakeoffApp.navigateToManifest();
    });

    document.getElementById('device-save-btn')?.addEventListener('click', () => {
      const temp = TakeoffState.getDeviceTempData();
      if (temp.boxes.length < 1 || temp.covers.length < 1) return;

      // Replace existing box/cover children
      const parent = TakeoffState.getItemById(itemId);
      if (parent) {
        parent.children = (parent.children || []).filter((c) => c.type !== 'box' && c.type !== 'cover');
      }

      for (const b of temp.boxes) {
        TakeoffState.addItem({
          id: TakeoffState.generateId(),
          type: 'box',
          description: b.description || 'Box',
          quantity: b.quantity || 0,
          labor: b.labor || 0,
          parentId: itemId,
        });
      }
      for (const c of temp.covers) {
        TakeoffState.addItem({
          id: TakeoffState.generateId(),
          type: 'cover',
          description: c.description || 'Cover',
          quantity: c.quantity || 0,
          labor: c.labor || 0,
          parentId: itemId,
        });
      }

      TakeoffApp.navigateToManifest();
    });
  }

  return { render, attachListeners };
})();
