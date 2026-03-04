/**
 * Main manifest table view
 */

const TakeoffManifestView = (function () {
  const TRASH_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" class="trash-icon"><path d="M232.7 69.9L224 96L128 96C110.3 96 96 110.3 96 128C96 145.7 110.3 160 128 160L512 160C529.7 160 544 145.7 544 128C544 110.3 529.7 96 512 96L416 96L407.3 69.9C402.9 56.8 390.7 48 376.9 48L263.1 48C249.3 48 237.1 56.8 232.7 69.9zM512 208L128 208L149.1 531.1C150.7 556.4 171.7 576 197 576L443 576C468.3 576 489.3 556.4 490.9 531.1L512 208z"/></svg>';

  const TYPE_LABELS = {
    lighting: 'Lighting',
    gear: 'Gear',
    devices: 'Devices',
    conduit: 'Conduit',
    wire: 'Wire',
    specialSystems: 'Special Systems',
  };

  function renderRow(item, isChild = false) {
    const typeClass = item.type && TYPE_LABELS[item.type] ? item.type : 'default';
    const typeLabel = item.type ? TYPE_LABELS[item.type] || item.type : '';
    const hasFlow = ['devices', 'conduit', 'wire'].includes(item.type);

    const planPageCell = isChild
      ? '<td></td>'
      : `<td><input type="text" data-field="planPage" data-id="${item.id}" value="${escapeHtml(item.planPage || '')}" placeholder="Plan page" /></td>`;

    const typeLabelDisplay = item.type ? (TYPE_LABELS[item.type] || item.type) : '';
    const parentId = item.parentId || null;
    const parent = parentId ? TakeoffState.getItemById(parentId) : null;
    const parentHasFlow = parent && ['devices', 'conduit', 'wire'].includes(parent.type);
    const showEditFlow = (hasFlow && !isChild) || (isChild && parentHasFlow);
    const editFlowTargetId = isChild && parentHasFlow ? parentId : item.id;
    const typeCell = item.type
      ? `<td><span class="type-badge ${typeClass}">${escapeHtml(typeLabelDisplay)}</span>${showEditFlow ? ` <button type="button" class="edit-flow-btn" data-id="${editFlowTargetId}">Edit in flow</button>` : ''}</td>`
      : `<td><button type="button" class="select-type-btn btn" data-id="${item.id}">Add</button></td>`;

    const showRemove = TakeoffState.getShowRemoveIcons();
    const removeCell = `<td class="remove-cell ${showRemove ? 'visible' : ''}"><button type="button" class="remove-btn icon-btn" data-id="${item.id}" title="Remove">${TRASH_SVG}</button></td>`;

    return `
      <tr class="${isChild ? 'child-row' : ''}" data-id="${item.id}">
        ${removeCell}
        <td><input type="text" data-field="description" data-id="${item.id}" value="${escapeHtml(item.description || '')}" placeholder="Description" /></td>
        <td><input type="number" data-field="quantity" data-id="${item.id}" value="${item.quantity || ''}" min="0" step="1" placeholder="0" /></td>
        <td><input type="number" data-field="labor" data-id="${item.id}" value="${item.labor || ''}" min="0" step="0.1" placeholder="0" /></td>
        ${planPageCell}
        ${typeCell}
        <td><input type="text" data-field="price" data-id="${item.id}" value="${item.price !== undefined && item.price !== null ? item.price : ''}" placeholder="Price (opt)" /></td>
      </tr>
    `;
  }

  function escapeHtml(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function render() {
    const items = TakeoffState.getFlattenedItems();
    const totalLabor = TakeoffState.getTotalLabor();

    let rows = '';
    for (const { _depth, ...item } of items) {
      rows += renderRow(item, _depth > 0);
    }

    return `
      <div class="manifest-view">
        <table>
          <colgroup>
            <col class="col-remove" />
            <col class="col-desc" />
            <col class="col-qty" />
            <col class="col-labor" />
            <col class="col-plan" />
            <col class="col-type" />
            <col class="col-price" />
          </colgroup>
          <thead>
            <tr>
              <th></th>
              <th>Description</th>
              <th>Quantity</th>
              <th>Labor</th>
              <th>Plan Page</th>
              <th>Type</th>
              <th>Price (opt)</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
        <div class="manifest-actions">
          <button type="button" class="btn btn-success" id="add-row-btn">Add Row</button>
        </div>
        <div class="totals">
          <p><strong>Total Labor:</strong> ${totalLabor.toFixed(1)} hrs</p>
        </div>
        <div class="manifest-actions print-actions">
          <button type="button" class="btn" id="print-review-btn">Print for Review</button>
          <button type="button" class="btn" id="print-po-btn">Print for Purchase Order</button>
          <button type="button" class="btn" id="print-form-btn">Print with Form</button>
        </div>
      </div>
    `;
  }

  function attachListeners() {
    document.getElementById('add-row-btn')?.addEventListener('click', () => {
      TakeoffState.addItem({
        type: null,
        description: '',
        quantity: 0,
        labor: 0,
        planPage: '',
        parentId: null,
      });
      TakeoffApp.render();
    });

    document.getElementById('print-review-btn')?.addEventListener('click', () => {
      TakeoffPDF.printForReview();
    });

    document.getElementById('print-po-btn')?.addEventListener('click', () => {
      TakeoffPDF.printForPurchaseOrder();
    });

    document.getElementById('print-form-btn')?.addEventListener('click', () => {
      document.getElementById('form-modal').setAttribute('aria-hidden', 'false');
    });

    document.querySelectorAll('[data-field]').forEach((input) => {
      input.addEventListener('change', (e) => {
        const id = e.target.dataset.id;
        const field = e.target.dataset.field;
        let value = e.target.value;
        if (field === 'quantity' || field === 'labor') value = parseFloat(value) || 0;
        if (field === 'price') value = value === '' ? null : value;
        TakeoffState.updateItem(id, { [field]: value });
      });
    });

    document.querySelectorAll('.select-type-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        TakeoffApp.showTypeModal(e.target.dataset.id);
      });
    });

    document.querySelectorAll('.edit-flow-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.target.dataset.id;
        const item = TakeoffState.getItemById(id);
        if (item.type === 'devices') TakeoffApp.navigateToDevice(id);
        else if (item.type === 'conduit') TakeoffApp.navigateToConduit(id);
        else if (item.type === 'wire') TakeoffApp.navigateToWire(id);
      });
    });

    document.querySelectorAll('.remove-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        if (confirm('Remove this item?')) {
          const item = TakeoffState.getItemById(e.target.dataset.id);
          const wasTopLevel = item && !item.parentId;
          TakeoffState.removeItem(e.target.dataset.id);
          if (wasTopLevel && TakeoffState.getTopLevelItems().length === 0) {
            TakeoffState.addItem({ type: null, description: '', quantity: 0, labor: 0, planPage: '', parentId: null });
          }
          TakeoffApp.render();
        }
      });
    });
  }

  return { render, attachListeners };
})();
