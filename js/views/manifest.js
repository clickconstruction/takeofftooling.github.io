/**
 * Main manifest table view
 */

const TakeoffManifestView = (function () {
  const TRASH_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" class="trash-icon"><path d="M232.7 69.9L224 96L128 96C110.3 96 96 110.3 96 128C96 145.7 110.3 160 128 160L512 160C529.7 160 544 145.7 544 128C544 110.3 529.7 96 512 96L416 96L407.3 69.9C402.9 56.8 390.7 48 376.9 48L263.1 48C249.3 48 237.1 56.8 232.7 69.9zM512 208L128 208L149.1 531.1C150.7 556.4 171.7 576 197 576L443 576C468.3 576 489.3 556.4 490.9 531.1L512 208z"/></svg>';
  const BOOK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" class="labor-book-icon"><path d="M480 576L192 576C139 576 96 533 96 480L96 160C96 107 139 64 192 64L496 64C522.5 64 544 85.5 544 112L544 400C544 420.9 530.6 438.7 512 445.3L512 512C529.7 512 544 526.3 544 544C544 561.7 529.7 576 512 576L480 576zM192 448C174.3 448 160 462.3 160 480C160 497.7 174.3 512 192 512L448 512L448 448L192 448zM224 216C224 229.3 234.7 240 248 240L424 240C437.3 240 448 229.3 448 216C448 202.7 437.3 192 424 192L248 192C234.7 192 224 202.7 224 216zM248 288C234.7 288 224 298.7 224 312C224 325.3 234.7 336 248 336L424 336C437.3 336 448 325.3 448 312C448 298.7 437.3 288 424 288L248 288z"/></svg>';

  const TYPE_LABELS = {
    lighting: 'Lighting',
    gear: 'Gear',
    devices: 'Devices',
    conduit: 'Conduit',
    wire: 'Wire',
    specialSystems: 'Special Systems',
    permits: 'PERMITS',
    powerCoCharges: 'POWER CO. CHARGES',
    temporaryPower: 'TEMPORARY POWER',
  };

  function renderRow(item, isChild = false) {
    const typeClass = item.type && TYPE_LABELS[item.type] ? item.type : 'default';
    const typeLabel = item.type ? TYPE_LABELS[item.type] || item.type : '';
    const hasFlow = ['devices', 'conduit', 'wire'].includes(item.type);

    const planPageCell = isChild
      ? '<td></td>'
      : `<td><input type="text" data-field="planPage" data-id="${item.id}" value="${escapeHtml(item.planPage || '')}" placeholder="Plan page / Location" /></td>`;

    const typeLabelDisplay = item.type ? (TYPE_LABELS[item.type] || item.type) : '';
    const parentId = item.parentId || null;
    const parent = parentId ? TakeoffState.getItemById(parentId) : null;
    const parentHasFlow = parent && ['devices', 'conduit', 'wire'].includes(parent.type);
    const showEditFlow = (hasFlow && !isChild) || (isChild && parentHasFlow);
    const editFlowTargetId = isChild && parentHasFlow ? parentId : item.id;
    const typeCell = item.type
      ? `<td><span class="type-badge ${typeClass}">${escapeHtml(typeLabelDisplay)}</span><button type="button" class="clear-type-btn icon-btn" data-id="${item.id}" title="Remove type">×</button>${showEditFlow ? ` <button type="button" class="edit-flow-btn" data-id="${editFlowTargetId}">Edit in flow</button>` : ''}</td>`
      : `<td class="type-cell-add"><button type="button" class="select-type-btn btn" data-id="${item.id}">Add</button></td>`;

    const showRemove = TakeoffState.getShowRemoveIcons();
    const removeCell = `<td class="remove-cell ${showRemove ? 'visible' : ''}"><button type="button" class="remove-btn icon-btn" data-id="${item.id}" title="Remove">${TRASH_SVG}</button></td>`;

    const laborBookCell = `<td class="labor-book-cell"><button type="button" class="labor-book-icon-btn icon-btn" data-id="${item.id}" title="Open Labor and Price Book">${BOOK_SVG}</button></td>`;

    return `
      <tr class="${isChild ? 'child-row' : ''}" data-id="${item.id}">
        ${removeCell}
        ${laborBookCell}
        <td><input type="text" data-field="description" data-id="${item.id}" value="${escapeHtml(item.description || '')}" placeholder="Assembly Description" /></td>
        ${typeCell}
        <td class="qty-cell"><div class="qty-spinner"><button type="button" class="qty-down-btn" data-id="${item.id}" title="Subtract 1">−</button><input type="number" data-field="quantity" data-id="${item.id}" dir="ltr" value="${item.quantity || ''}" min="0" step="1" placeholder="0" /><button type="button" class="qty-up-btn" data-id="${item.id}" title="Add 1">+</button></div></td>
        <td class="labor-cell"><input type="number" data-field="labor" data-id="${item.id}" dir="ltr" value="${item.labor || ''}" min="0" step="0.1" placeholder="0" /></td>
        <td class="price-cell"><input type="number" data-field="price" data-id="${item.id}" dir="ltr" value="${item.price ?? ''}" min="0" step="1" placeholder="Price" /></td>
        ${planPageCell}
      </tr>
    `;
  }

  function escapeHtml(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  const SUMMARY_LABELS = {
    lighting: 'Lighting',
    gear: 'Gear',
    devices: 'Devices',
    conduit: 'Conduit',
    wire: 'Wire',
    specialSystems: 'Special Systems',
    misc: 'Misc.',
    permits: 'PERMITS',
    powerCoCharges: 'POWER CO. CHARGES',
    temporaryPower: 'TEMPORARY POWER',
  };

  function formatMoney(n) {
    return (n || 0).toFixed(2);
  }

  function renderSummary() {
    const s = TakeoffState.getSummaryBreakdown();
    const matTypes = ['lighting', 'gear', 'devices', 'conduit', 'wire', 'specialSystems', 'misc'];
    const otherTypes = ['permits', 'powerCoCharges', 'temporaryPower'];

    let materialsRows = matTypes.map((t) => `<tr><td>${SUMMARY_LABELS[t]}</td><td class="summary-value">$${formatMoney(s.materials[t])}</td></tr>`).join('');
    let laborRows = matTypes.map((t) => `<tr><td>${SUMMARY_LABELS[t]}</td><td class="summary-value">${(s.labor[t] || 0).toFixed(1)}</td></tr>`).join('');
    let otherRows = otherTypes.map((t) => `<tr><td>${SUMMARY_LABELS[t]}</td><td class="summary-value">$${formatMoney(s.otherCharges[t])}</td></tr>`).join('');

    const laborTotalDollars = s.laborTotal * (TakeoffState.getLaborRate() || 0);
    const grandTotal = s.materialsTotal + laborTotalDollars + s.otherTotal;

    return `
      <div class="manifest-summary">
        <div class="manifest-summary-section">
          <h3 class="manifest-summary-title">MATERIALS</h3>
          <table class="manifest-summary-table">
            ${materialsRows}
            <tr class="summary-subtotal"><td>Sub Total</td><td class="summary-value">$${formatMoney(s.materialsSubtotal)}</td></tr>
            <tr><td>SALES TAX (8.5%)</td><td class="summary-value">$${formatMoney(s.salesTax)}</td></tr>
            <tr class="summary-total"><td>Materials TOTAL $</td><td class="summary-value">$${formatMoney(s.materialsTotal)}</td></tr>
          </table>
        </div>
        <div class="manifest-summary-section">
          <h3 class="manifest-summary-title">LABOR</h3>
          <table class="manifest-summary-table">
            ${laborRows}
            <tr class="summary-total"><td>Labor TOTAL (hrs)</td><td class="summary-value">${s.laborTotal.toFixed(1)}</td></tr>
            <tr><td>Labor Rate ($/Hr)</td><td class="summary-value"><input type="number" id="labor-rate-input" value="${TakeoffState.getLaborRate() || ''}" min="0" step="0.01" placeholder="0" /></td></tr>
            <tr class="summary-total"><td>Labor Total $</td><td class="summary-value">$${formatMoney(s.laborTotal * (TakeoffState.getLaborRate() || 0))}</td></tr>
          </table>
        </div>
        <div class="manifest-summary-section">
          <h3 class="manifest-summary-title">OTHER CHARGES</h3>
          <table class="manifest-summary-table">
            ${otherRows}
            <tr class="summary-total"><td>Other TOTAL $</td><td class="summary-value">$${formatMoney(s.otherTotal)}</td></tr>
          </table>
        </div>
        <div class="manifest-summary-grand-total">
          Grand Total: $${formatMoney(grandTotal)}
        </div>
      </div>
    `;
  }

  function updateSummaryOnly() {
    const laborInput = document.getElementById('labor-rate-input');
    if (laborInput) TakeoffState.setLaborRate(laborInput.value);
    const summaryEl = document.querySelector('.manifest-view .manifest-summary');
    if (summaryEl) {
      summaryEl.outerHTML = renderSummary();
      document.getElementById('labor-rate-input')?.addEventListener('change', (e) => {
        TakeoffState.setLaborRate(e.target.value);
        updateSummaryOnly();
      });
    }
  }

  function render() {
    const items = TakeoffState.getFlattenedItems();

    let rows = '';
    for (const { _depth, ...item } of items) {
      rows += renderRow(item, _depth > 0);
    }

    return `
      <div class="manifest-view">
        <table>
          <colgroup>
            <col class="col-remove" />
            <col class="col-labor-book" />
            <col class="col-desc" />
            <col class="col-type" />
            <col class="col-qty" />
            <col class="col-labor" />
            <col class="col-price" />
            <col class="col-plan" />
          </colgroup>
          <thead>
            <tr>
              <th></th>
              <th></th>
              <th>Assembly Description</th>
              <th>Type</th>
              <th>Quantity</th>
              <th>Labor</th>
              <th>Price</th>
              <th>Plan Page / Location</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
        <div class="manifest-actions">
          <button type="button" class="btn btn-success" id="add-row-btn">Add Row</button>
        </div>
        ${renderSummary()}
        <div class="print-options ${TakeoffState.getShowPrintOptions() ? 'expanded' : ''}">
          <button type="button" class="btn print-options-toggle" id="print-options-toggle" aria-expanded="${TakeoffState.getShowPrintOptions()}">
            Print Options
          </button>
          <div class="print-options-content">
            <button type="button" class="btn" id="print-review-btn">Print for Review</button>
            <button type="button" class="btn" id="print-po-btn">Print for Purchase Order</button>
            <button type="button" class="btn" id="print-form-btn">Print with Form</button>
          </div>
        </div>
      </div>
    `;
  }

  function attachListeners() {
    document.getElementById('add-row-btn')?.addEventListener('click', () => {
      TakeoffState.addItem({
        type: null,
        description: '',
        quantity: 1,
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

    document.getElementById('print-options-toggle')?.addEventListener('click', () => {
      TakeoffState.toggleShowPrintOptions();
      TakeoffApp.render();
    });

    document.getElementById('labor-rate-input')?.addEventListener('change', (e) => {
      TakeoffState.setLaborRate(e.target.value);
      TakeoffApp.render();
    });

    document.querySelectorAll('.labor-book-icon-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        TakeoffApp.showLaborBookModal(e.currentTarget.dataset.id);
      });
    });

    function handleFieldUpdate(e) {
      const id = e.target.dataset.id;
      const field = e.target.dataset.field;
      let value = e.target.value;
      if (field === 'quantity' || field === 'labor') value = parseFloat(value) || 0;
      if (field === 'price') value = value === '' ? null : (parseFloat(value) ?? null);
      const updates = { [field]: value };
      if (field === 'description') {
        const item = TakeoffState.getItemById(id);
        const descVal = (value || '').trim();
        if (descVal && item && (item.quantity ?? 0) === 0) {
          updates.quantity = 1;
          const qtyInput = document.querySelector(`.qty-cell input[data-field="quantity"][data-id="${id}"]`);
          if (qtyInput) qtyInput.value = 1;
        }
      }
      TakeoffState.updateItem(id, updates);
      if (['quantity', 'price', 'labor'].includes(field) || updates.quantity !== undefined) updateSummaryOnly();
    }

    document.querySelectorAll('[data-field]').forEach((input) => {
      input.addEventListener('change', handleFieldUpdate);
      input.addEventListener('input', handleFieldUpdate);
    });

    document.querySelectorAll('.qty-up-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        const input = document.querySelector(`.qty-cell input[data-field="quantity"][data-id="${id}"]`);
        if (input) {
          const val = parseFloat(input.value) || 0;
          input.value = val + 1;
          TakeoffState.updateItem(id, { quantity: val + 1 });
          updateSummaryOnly();
        }
      });
    });

    document.querySelectorAll('.qty-down-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        const input = document.querySelector(`.qty-cell input[data-field="quantity"][data-id="${id}"]`);
        if (input) {
          const val = Math.max(0, (parseFloat(input.value) || 0) - 1);
          input.value = val;
          TakeoffState.updateItem(id, { quantity: val });
          updateSummaryOnly();
        }
      });
    });

    document.querySelectorAll('.select-type-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        TakeoffApp.showTypeModal(e.target.dataset.id);
      });
    });

    document.querySelectorAll('.clear-type-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        TakeoffState.setType(e.target.dataset.id, null);
        TakeoffApp.render();
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
            TakeoffState.addItem({ type: null, description: '', quantity: 1, labor: 0, planPage: '', parentId: null });
          }
          TakeoffApp.render();
        }
      });
    });
  }

  return { render, attachListeners };
})();
