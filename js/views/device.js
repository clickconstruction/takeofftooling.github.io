/**
 * Device flow - Boxes and Covers
 */

const TakeoffDeviceView = (function () {
  const TRASH_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" class="trash-icon"><path d="M232.7 69.9L224 96L128 96C110.3 96 96 110.3 96 128C96 145.7 110.3 160 128 160L512 160C529.7 160 544 145.7 544 128C544 110.3 529.7 96 512 96L416 96L407.3 69.9C402.9 56.8 390.7 48 376.9 48L263.1 48C249.3 48 237.1 56.8 232.7 69.9zM512 208L128 208L149.1 531.1C150.7 556.4 171.7 576 197 576L443 576C468.3 576 489.3 556.4 490.9 531.1L512 208z"/></svg>';
  const BOOK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" class="labor-book-icon"><path d="M480 576L192 576C139 576 96 533 96 480L96 160C96 107 139 64 192 64L496 64C522.5 64 544 85.5 544 112L544 400C544 420.9 530.6 438.7 512 445.3L512 512C529.7 512 544 526.3 544 544C544 561.7 529.7 576 512 576L480 576zM192 448C174.3 448 160 462.3 160 480C160 497.7 174.3 512 192 512L448 512L448 448L192 448zM224 216C224 229.3 234.7 240 248 240L424 240C437.3 240 448 229.3 448 216C448 202.7 437.3 192 424 192L248 192C234.7 192 224 202.7 224 216zM248 288C234.7 288 224 298.7 224 312C224 325.3 234.7 336 248 336L424 336C437.3 336 448 325.3 448 312C448 298.7 437.3 288 424 288L248 288z"/></svg>';

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
        <td class="labor-book-cell"><button type="button" class="labor-book-icon-btn icon-btn" data-section="boxes" data-index="${i}" title="Open labor book">${BOOK_SVG}</button></td>
        <td><input type="number" data-section="boxes" data-index="${i}" data-field="labor" value="${b.labor !== undefined ? b.labor : ''}" min="0" step="0.1" /></td>
        <td><button type="button" class="remove-child-btn icon-btn" data-section="boxes" data-index="${i}" title="Remove">${TRASH_SVG}</button></td>
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
        <td class="labor-book-cell"><button type="button" class="labor-book-icon-btn icon-btn" data-section="covers" data-index="${i}" title="Open labor book">${BOOK_SVG}</button></td>
        <td><input type="number" data-section="covers" data-index="${i}" data-field="labor" value="${c.labor !== undefined ? c.labor : ''}" min="0" step="0.1" /></td>
        <td><button type="button" class="remove-child-btn icon-btn" data-section="covers" data-index="${i}" title="Remove">${TRASH_SVG}</button></td>
      </tr>
    `
      )
      .join('');

    return `
      <div class="flow-page device-flow">
        <h2>Devices - Add Boxes and Covers</h2>
        <div class="parent-summary">
          <div class="parent-summary-line"><strong>Parent:</strong> ${escapeHtml(item.description || '')}</div>
          <div class="parent-summary-line">Quantity: ${item.quantity}</div>
          <div class="parent-summary-line">Labor: ${(item.labor || 0) * 0.1} hrs</div>
        </div>
        <div class="flow-section">
          <h3>Boxes (at least one required)</h3>
          <table>
            <thead><tr><th>Description</th><th>Quantity</th><th></th><th>Labor</th><th></th></tr></thead>
            <tbody>${boxRows}</tbody>
          </table>
          <button type="button" class="btn add-box-btn">Add Box</button>
        </div>
        <div class="flow-section">
          <h3>Covers (at least one required)</h3>
          <table>
            <thead><tr><th>Description</th><th>Quantity</th><th></th><th>Labor</th><th></th></tr></thead>
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

    document.querySelectorAll('.labor-book-icon-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const section = e.currentTarget.dataset.section;
        const index = parseInt(e.currentTarget.dataset.index, 10);
        TakeoffApp.showLaborBookModalForDeviceRow(section, index);
      });
    });

    document.querySelectorAll('.remove-child-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const section = e.currentTarget.dataset.section;
        const index = parseInt(e.currentTarget.dataset.index, 10);
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
