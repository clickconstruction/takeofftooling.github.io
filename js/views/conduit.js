/**
 * Conduit flow - Trenching, Fittings, Overage
 */

const TakeoffConduitView = (function () {
  function escapeHtml(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function renderStep1(itemId) {
    const item = TakeoffState.getItemById(itemId);
    if (!item) return '';
    const temp = TakeoffState.getConduitTempData();

    return `
      <div class="flow-page conduit-flow">
        <h2>Conduit - Trenching</h2>
        <div class="parent-summary">
          <div class="parent-summary-line"><strong>Parent:</strong> ${escapeHtml(item.description || '')}</div>
          <div class="parent-summary-line">Quantity: ${item.quantity}</div>
          <div class="parent-summary-line">Length: ${item.quantity}</div>
        </div>
        <div class="flow-section">
          <h3>Trenching</h3>
          <p>How much trenching? Through what material? At what depth? At what length?</p>
          <div class="trenching-fields">
            <label>Quantity <input type="number" id="trench-qty" value="${temp.trenchQty ?? ''}" min="0" placeholder="0" /></label>
            <label>Material <input type="text" id="trench-material" value="${escapeHtml(temp.trenchMaterial || '')}" placeholder="e.g. asphalt, concrete" /></label>
            <label>Depth <input type="text" id="trench-depth" value="${escapeHtml(temp.trenchDepth || '')}" placeholder="e.g. 18 inches" /></label>
            <label>Length <input type="text" id="trench-length" value="${escapeHtml(temp.trenchLength || '')}" placeholder="e.g. 50 ft" /></label>
          </div>
        </div>
        <div class="flow-actions">
          <button type="button" class="btn btn-secondary" id="conduit-cancel-btn">Cancel</button>
          <button type="button" class="btn" id="conduit-next-fittings">Next: Fittings</button>
        </div>
      </div>
    `;
  }

  function renderStep2(itemId) {
    const item = TakeoffState.getItemById(itemId);
    if (!item) return '';
    const temp = TakeoffState.getConduitTempData();
    const fittings = temp.fittings || [];

    const fittingRows = fittings
      .map(
        (f, i) => `
      <tr>
        <td><input type="text" data-fittings-index="${i}" data-field="description" value="${escapeHtml(f.description || '')}" placeholder="Description" /></td>
        <td><input type="number" data-fittings-index="${i}" data-field="quantity" value="${f.quantity ?? ''}" min="0" /></td>
        <td><input type="number" data-fittings-index="${i}" data-field="labor" value="${f.labor !== undefined ? f.labor : ''}" min="0" step="0.1" /></td>
        <td><button type="button" class="remove-fitting-btn" data-index="${i}">Remove</button></td>
      </tr>
    `
      )
      .join('');

    const fittingsList = typeof FITTINGS_LIST !== 'undefined' ? FITTINGS_LIST : [];
    const presetOptions =
      fittingsList.length > 0
        ? fittingsList.map((f) => {
            const text = typeof f === 'string' ? f : (f.description || '');
            return `<option value="${escapeHtml(text)}">${escapeHtml(text)}</option>`;
          }).join('')
        : '<option value="">-- Add your list in js/data/fittings.js --</option>';

    return `
      <div class="flow-page conduit-flow">
        <h2>Conduit - Fittings</h2>
        <div class="parent-summary">
          <div class="parent-summary-line"><strong>Parent:</strong> ${escapeHtml(item.description || '')}</div>
          <div class="parent-summary-line">Quantity: ${item.quantity}</div>
        </div>
        <div class="flow-section">
          <h3>Fittings</h3>
          <p>Add items manually or select from list:</p>
          <select id="fittings-preset">
            <option value="">-- Select from list --</option>
            ${presetOptions}
          </select>
          <table class="fittings-table">
            <thead><tr><th>Description</th><th>Quantity</th><th>Labor</th><th></th></tr></thead>
            <tbody>${fittingRows}</tbody>
          </table>
          <button type="button" class="btn add-fitting-btn">Add Fitting Row</button>
        </div>
        <div class="flow-actions">
          <button type="button" class="btn btn-secondary" id="conduit-back-trench">Back</button>
          <button type="button" class="btn" id="conduit-next-overage">Next: Overage</button>
        </div>
      </div>
    `;
  }

  function renderStep3(itemId) {
    const item = TakeoffState.getItemById(itemId);
    if (!item) return '';
    const temp = TakeoffState.getConduitTempData();
    const baseLength = item.quantity || 0;
    const overagePercent = temp.overagePercent ?? null;
    const additional = overagePercent != null ? Math.ceil(baseLength * (overagePercent / 100)) : 0;
    const totalQty = baseLength + additional;

    return `
      <div class="flow-page conduit-flow">
        <h2>Conduit - Overage</h2>
        <div class="parent-summary">
          <div class="parent-summary-line"><strong>Parent:</strong> ${escapeHtml(item.description || '')}</div>
          <div class="parent-summary-line">Current length: ${baseLength}</div>
        </div>
        <div class="flow-section">
          <h3>Overage</h3>
          <p>Select overage percentage:</p>
          <div class="overage-buttons">
            <button type="button" data-percent="5">5%</button>
            <button type="button" data-percent="10">10%</button>
            <button type="button" data-percent="15">15%</button>
            <button type="button" data-percent="20">20%</button>
          </div>
          <label>Overage % <input type="number" id="overage-percent" value="${overagePercent ?? ''}" min="0" max="100" step="1" placeholder="0" /></label>
          <p><strong>Conduit quantity:</strong> ${baseLength} + ${additional} additional = <strong>${totalQty}</strong> total</p>
        </div>
        <div class="flow-actions">
          <button type="button" class="btn btn-secondary" id="conduit-back-fittings">Back</button>
          <button type="button" class="btn btn-success" id="conduit-save-btn">Save and Back to Manifest</button>
        </div>
      </div>
    `;
  }

  function render(itemId) {
    const step = TakeoffState.getConduitStep();
    if (step === 1) return renderStep1(itemId);
    if (step === 2) return renderStep2(itemId);
    return renderStep3(itemId);
  }

  function attachListeners(itemId) {
    const step = TakeoffState.getConduitStep();

    if (step === 1) {
      document.getElementById('conduit-cancel-btn')?.addEventListener('click', () => {
        TakeoffApp.navigateToManifest();
      });

      document.getElementById('conduit-next-fittings')?.addEventListener('click', () => {
        const qty = document.getElementById('trench-qty')?.value;
        const material = document.getElementById('trench-material')?.value;
        const depth = document.getElementById('trench-depth')?.value;
        const length = document.getElementById('trench-length')?.value;
        const desc = `Trenching: ${qty || 0} - ${material || 'N/A'} @ ${depth || 'N/A'}, ${length || 'N/A'}`;
        const trenchData = { description: desc, quantity: parseFloat(qty) || 0, labor: 0 };
        const temp = TakeoffState.getConduitTempData();
        temp.trenching = trenchData;
        temp.trenchQty = qty;
        temp.trenchMaterial = material;
        temp.trenchDepth = depth;
        temp.trenchLength = length;
        if (!temp.fittings || temp.fittings.length === 0) {
          temp.fittings = [{ description: '', quantity: 0, labor: 0 }];
        }
        TakeoffState.setConduitTempData(temp);
        const parent = TakeoffState.getItemById(itemId);
        if (parent) {
          const trenchIdx = (parent.children || []).findIndex((c) => c.type === 'trenching');
          if (trenchIdx >= 0) parent.children.splice(trenchIdx, 1);
        }
        TakeoffState.addItem({
          id: TakeoffState.generateId(),
          type: 'trenching',
          description: trenchData.description,
          quantity: trenchData.quantity,
          labor: trenchData.labor,
          parentId: itemId,
        });
        TakeoffState.setConduitStep(2);
        TakeoffApp.render();
      });
    }

    if (step === 2) {
      document.getElementById('conduit-back-trench')?.addEventListener('click', () => {
        TakeoffState.setConduitStep(1);
        TakeoffApp.render();
      });

      document.getElementById('fittings-preset')?.addEventListener('change', (e) => {
        const val = e.target.value;
        if (!val) return;
        const temp = TakeoffState.getConduitTempData();
        temp.fittings = temp.fittings || [];
        temp.fittings.push({ description: val, quantity: 1, labor: 0 });
        TakeoffState.setConduitTempData(temp);
        e.target.value = '';
        TakeoffApp.render();
      });

      document.querySelector('.add-fitting-btn')?.addEventListener('click', () => {
        const temp = TakeoffState.getConduitTempData();
        temp.fittings = temp.fittings || [];
        temp.fittings.push({ description: '', quantity: 0, labor: 0 });
        TakeoffState.setConduitTempData(temp);
        TakeoffApp.render();
      });

      document.querySelectorAll('.remove-fitting-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const index = parseInt(e.target.dataset.index, 10);
          const temp = TakeoffState.getConduitTempData();
          temp.fittings = temp.fittings || [];
          temp.fittings.splice(index, 1);
          if (temp.fittings.length === 0) {
            temp.fittings.push({ description: '', quantity: 0, labor: 0 });
          }
          TakeoffState.setConduitTempData(temp);
          TakeoffApp.render();
        });
      });

      document.querySelectorAll('[data-fittings-index]').forEach((input) => {
        input.addEventListener('change', (e) => {
          const index = parseInt(e.target.dataset.fittingsIndex, 10);
          const field = e.target.dataset.field;
          let value = e.target.value;
          if (field === 'quantity' || field === 'labor') value = parseFloat(value) || 0;
          const temp = TakeoffState.getConduitTempData();
          if (temp.fittings?.[index]) temp.fittings[index][field] = value;
          TakeoffState.setConduitTempData(temp);
        });
      });

      document.getElementById('conduit-next-overage')?.addEventListener('click', () => {
        const temp = TakeoffState.getConduitTempData();
        const parent = TakeoffState.getItemById(itemId);
        if (parent) {
          parent.children = (parent.children || []).filter((c) => c.type !== 'fitting');
        }
        for (const f of temp.fittings || []) {
          if (f.description) {
            TakeoffState.addItem({
              id: TakeoffState.generateId(),
              type: 'fitting',
              description: f.description,
              quantity: f.quantity || 0,
              labor: f.labor || 0,
              parentId: itemId,
            });
          }
        }
        TakeoffState.setConduitStep(3);
        TakeoffApp.render();
      });
    }

    if (step === 3) {
      document.getElementById('conduit-back-fittings')?.addEventListener('click', () => {
        TakeoffState.setConduitStep(2);
        TakeoffApp.render();
      });

      document.querySelectorAll('.overage-buttons button').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const percent = parseInt(e.target.dataset.percent, 10);
          TakeoffState.setConduitTempData({ overagePercent: percent });
          document.getElementById('overage-percent').value = percent;
          TakeoffApp.render();
        });
      });

      document.getElementById('overage-percent')?.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        TakeoffState.setConduitTempData({ overagePercent: isNaN(val) ? null : val });
        TakeoffApp.render();
      });

      document.getElementById('conduit-save-btn')?.addEventListener('click', () => {
        const item = TakeoffState.getItemById(itemId);
        if (!item) return;

        const temp = TakeoffState.getConduitTempData();
        const parent = TakeoffState.getItemById(itemId);
        if (parent) {
          parent.children = (parent.children || []).filter((c) => c.type !== 'overage');
        }
        const baseLength = item.quantity || 0;
        const overagePercent = temp.overagePercent ?? 0;
        const additional = Math.ceil(baseLength * (overagePercent / 100));

        if (additional > 0) {
          TakeoffState.addItem({
            id: TakeoffState.generateId(),
            type: 'overage',
            description: `Conduit overage (${overagePercent}%)`,
            quantity: additional,
            labor: 0,
            parentId: itemId,
          });
        }

        TakeoffApp.navigateToManifest();
      });
    }
  }

  return { render, attachListeners };
})();
