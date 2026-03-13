/**
 * Conduit flow - Trenching, Fittings, Overage
 */

const TakeoffConduitView = (function () {
  const BOOK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" class="labor-book-icon"><path d="M480 576L192 576C139 576 96 533 96 480L96 160C96 107 139 64 192 64L496 64C522.5 64 544 85.5 544 112L544 400C544 420.9 530.6 438.7 512 445.3L512 512C529.7 512 544 526.3 544 544C544 561.7 529.7 576 512 576L480 576zM192 448C174.3 448 160 462.3 160 480C160 497.7 174.3 512 192 512L448 512L448 448L192 448zM224 216C224 229.3 234.7 240 248 240L424 240C437.3 240 448 229.3 448 216C448 202.7 437.3 192 424 192L248 192C234.7 192 224 202.7 224 216zM248 288C234.7 288 224 298.7 224 312C224 325.3 234.7 336 248 336L424 336C437.3 336 448 325.3 448 312C448 298.7 437.3 288 424 288L248 288z"/></svg>';
  const TRASH_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" class="trash-icon"><path d="M232.7 69.9L224 96L128 96C110.3 96 96 110.3 96 128C96 145.7 110.3 160 128 160L512 160C529.7 160 544 145.7 544 128C544 110.3 529.7 96 512 96L416 96L407.3 69.9C402.9 56.8 390.7 48 376.9 48L263.1 48C249.3 48 237.1 56.8 232.7 69.9zM512 208L128 208L149.1 531.1C150.7 556.4 171.7 576 197 576L443 576C468.3 576 489.3 556.4 490.9 531.1L512 208z"/></svg>';

  const TRENCHING_QUICK_ADD = [
    { label: 'Dirt to 24in - $15', material: 'Dirt', depth: '24in', price: 15 },
    { label: 'Dirt to 36in - $30', material: 'Dirt', depth: '36in', price: 30 },
    { label: 'Dirt to 48in - $45', material: 'Dirt', depth: '48in', price: 45 },
    { label: 'Rock to 24in - $150', material: 'Rock', depth: '24in', price: 150 },
    { label: 'Rock to 36in - $175', material: 'Rock', depth: '36in', price: 175 },
    { label: 'Asphalt/Concrete to 24in - $200', material: 'Asphalt/Concrete', depth: '24in', price: 200 },
    { label: 'Asphalt/Concrete to 36in - $250', material: 'Asphalt/Concrete', depth: '36in', price: 250 },
  ];

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
          <p class="trenching-intro">How much trenching (feet)? Through what material? At what depth?</p>
          <div class="trenching-row">
            <div class="trenching-fields">
              <label>Quantity (Feet Of Trenching) <input type="number" id="trench-qty" value="${temp.trenchQty ?? ''}" min="0" placeholder="0" /></label>
              <label>Material to Dig Through <input type="text" id="trench-material" value="${escapeHtml(temp.trenchMaterial || '')}" placeholder="e.g. asphalt, concrete" /></label>
              <label>Depth <input type="text" id="trench-depth" value="${escapeHtml(temp.trenchDepth || '')}" placeholder="e.g. 18 inches" /></label>
              <label>Price per Foot of Trenching ($) <input type="number" id="trench-price-per-foot" value="${temp.trenchPricePerFoot ?? ''}" min="0" step="0.01" placeholder="0" /></label>
            </div>
            <div class="trenching-quick-add">
              <p class="trenching-quick-add-title">Quick Add:</p>
              <table class="trenching-quick-add-table">
                <tbody>
                  ${TRENCHING_QUICK_ADD.map(
                    (p) => `
                  <tr class="trenching-quick-add-row" data-material="${escapeHtml(p.material)}" data-depth="${escapeHtml(p.depth)}" data-price="${p.price}" role="button" tabindex="0">
                    <td>${escapeHtml(p.label)}</td>
                  </tr>
                `
                  ).join('')}
                </tbody>
              </table>
            </div>
          </div>
          <div class="trenching-addons">
            <div class="trenching-addon-section">
              <p class="trenching-addon-section-title">Rentals</p>
              <div class="trenching-addon-buttons">
                <button type="button" class="btn btn-secondary trenching-addon-btn" data-description="BACKHOE">+ BACKHOE</button>
                <button type="button" class="btn btn-secondary trenching-addon-btn" data-description="SAW CUTTING">+ SAW CUTTING</button>
                <button type="button" class="btn btn-secondary trenching-addon-btn" data-description="DRILLING">+ DRILLING</button>
                <button type="button" class="btn btn-secondary trenching-addon-btn" data-description="HAUL-OFF">+ HAUL-OFF</button>
                <button type="button" class="btn btn-secondary trenching-addon-btn" data-description="MANLIFT">+ MANLIFT</button>
              </div>
            </div>
            <div class="trenching-addon-section">
              <p class="trenching-addon-section-title">Fill Materials</p>
              <div class="trenching-addon-buttons">
                <button type="button" class="btn btn-secondary trenching-addon-btn" data-description="ASPHALT PATCH">+ ASPHALT PATCH</button>
                <button type="button" class="btn btn-secondary trenching-addon-btn" data-description="TRENCHING SAND">+ TRENCHING SAND</button>
                <button type="button" class="btn btn-secondary trenching-addon-btn" data-description="POLE BASES">+ POLE BASES</button>
                <button type="button" class="btn btn-secondary trenching-addon-btn" data-description="CONCRETE PADS">+ CONCRETE PADS</button>
                <button type="button" class="btn btn-secondary trenching-addon-btn" data-description="MANHOLES">+ MANHOLES</button>
              </div>
            </div>
            ${(temp.trenchingAddons || []).length > 0 ? `
            <table class="trenching-addons-table">
              <thead><tr><th>Description</th><th>Quantity<br><span class="th-sub">(Hours or Days)</span></th><th>Additional Labor</th><th>Charge<br><span class="th-sub">(per Hour or Day)</span></th><th></th></tr></thead>
              <tbody>${(temp.trenchingAddons || []).map((a, i) => `
      <tr>
        <td>${escapeHtml(a.description || '')}</td>
        <td><input type="number" data-addon-index="${i}" data-field="quantity" value="${a.quantity ?? ''}" min="0" step="0.1" dir="ltr" placeholder="0" /></td>
        <td><input type="number" data-addon-index="${i}" data-field="labor" value="${a.labor ?? ''}" min="0" step="0.1" dir="ltr" placeholder="0" /></td>
        <td><input type="number" data-addon-index="${i}" data-field="price" value="${a.price ?? ''}" min="0" step="0.01" dir="ltr" placeholder="0" /></td>
        <td><button type="button" class="remove-addon-btn icon-btn" data-addon-index="${i}" title="Remove">${TRASH_SVG}</button></td>
      </tr>
    `).join('')}</tbody>
            </table>
            ` : ''}
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
        <td><input type="number" data-fittings-index="${i}" data-field="price" value="${f.price ?? ''}" min="0" step="0.01" dir="ltr" placeholder="Price" /></td>
        <td><button type="button" class="remove-fitting-btn icon-btn" data-index="${i}" title="Remove">${TRASH_SVG}</button></td>
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
          <h3 class="fittings-section-header">Fittings <button type="button" class="labor-book-icon-btn icon-btn" id="conduit-fittings-labor-book-btn" title="Open Labor and Price Book - Conduit Fittings">${BOOK_SVG}</button></h3>
          <p>Add items manually or select from list:</p>
          <select id="fittings-preset">
            <option value="">-- Select from list --</option>
            ${presetOptions}
          </select>
          <table class="fittings-table">
            <thead><tr><th>Description</th><th>Quantity</th><th>Labor</th><th>Price</th><th></th></tr></thead>
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

      document.querySelectorAll('.trenching-quick-add-row').forEach((row) => {
        const applyQuickAdd = () => {
          const material = row.dataset.material || '';
          const depth = row.dataset.depth || '';
          const price = row.dataset.price || '';
          const materialInput = document.getElementById('trench-material');
          const depthInput = document.getElementById('trench-depth');
          const priceInput = document.getElementById('trench-price-per-foot');
          if (materialInput) materialInput.value = material;
          if (depthInput) depthInput.value = depth;
          if (priceInput) priceInput.value = price;
          const temp = TakeoffState.getConduitTempData();
          temp.trenchMaterial = material;
          temp.trenchDepth = depth;
          temp.trenchPricePerFoot = price;
          TakeoffState.setConduitTempData(temp);
        };
        row.addEventListener('click', applyQuickAdd);
        row.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            applyQuickAdd();
          }
        });
      });

      document.querySelectorAll('.trenching-addon-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const description = e.currentTarget.dataset.description || '';
          if (!description) return;
          const temp = TakeoffState.getConduitTempData();
          temp.trenchingAddons = temp.trenchingAddons || [];
          temp.trenchingAddons.push({ description, quantity: '', labor: '', price: '' });
          TakeoffState.setConduitTempData(temp);
          TakeoffApp.render();
        });
      });

      document.querySelectorAll('.remove-addon-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const index = parseInt(e.currentTarget.dataset.addonIndex, 10);
          const temp = TakeoffState.getConduitTempData();
          temp.trenchingAddons = temp.trenchingAddons || [];
          temp.trenchingAddons.splice(index, 1);
          TakeoffState.setConduitTempData(temp);
          TakeoffApp.render();
        });
      });

      document.querySelectorAll('[data-addon-index]').forEach((el) => {
        if (el.tagName !== 'INPUT') return;
        el.addEventListener('change', (e) => {
          const index = parseInt(e.target.dataset.addonIndex, 10);
          const field = e.target.dataset.field;
          let value = e.target.value;
          if (field === 'quantity' || field === 'labor') value = value === '' ? '' : (parseFloat(value) ?? '');
          if (field === 'price') value = value === '' ? '' : (parseFloat(value) ?? '');
          const temp = TakeoffState.getConduitTempData();
          if (temp.trenchingAddons?.[index]) temp.trenchingAddons[index][field] = value;
          TakeoffState.setConduitTempData(temp);
        });
      });

      document.getElementById('conduit-next-fittings')?.addEventListener('click', () => {
        const qty = document.getElementById('trench-qty')?.value;
        const material = document.getElementById('trench-material')?.value;
        const depth = document.getElementById('trench-depth')?.value;
        const pricePerFoot = document.getElementById('trench-price-per-foot')?.value;
        const desc = `Trenching: ${qty || 0} - ${material || 'N/A'} @ ${depth || 'N/A'}`;
        const trenchData = { description: desc, quantity: parseFloat(qty) || 0, labor: 0 };
        const temp = TakeoffState.getConduitTempData();
        temp.trenching = trenchData;
        temp.trenchQty = qty;
        temp.trenchMaterial = material;
        temp.trenchDepth = depth;
        temp.trenchPricePerFoot = pricePerFoot;
        if (!temp.fittings || temp.fittings.length === 0) {
          temp.fittings = [{ description: '', quantity: 0, labor: 0, price: '' }];
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
          price: parseFloat(pricePerFoot) || undefined,
          parentId: itemId,
        });
        if (parent) {
          parent.children = (parent.children || []).filter((c) => c.type !== 'trenchingAddon');
        }
        for (const a of temp.trenchingAddons || []) {
          if (a.description) {
            TakeoffState.addItem({
              id: TakeoffState.generateId(),
              type: 'trenchingAddon',
              description: a.description,
              quantity: parseFloat(a.quantity) || 0,
              labor: parseFloat(a.labor) || 0,
              price: parseFloat(a.price) || null,
              parentId: itemId,
            });
          }
        }
        TakeoffState.setConduitStep(2);
        TakeoffApp.render();
      });
    }

    if (step === 2) {
      document.getElementById('conduit-back-trench')?.addEventListener('click', () => {
        TakeoffState.setConduitStep(1);
        TakeoffApp.render();
      });

      document.getElementById('conduit-fittings-labor-book-btn')?.addEventListener('click', () => {
        TakeoffApp.showLaborBookModalForConduitFittings(itemId);
      });

      document.getElementById('fittings-preset')?.addEventListener('change', (e) => {
        const val = e.target.value;
        if (!val) return;
        const temp = TakeoffState.getConduitTempData();
        temp.fittings = temp.fittings || [];
        temp.fittings.push({ description: val, quantity: 1, labor: 0, price: '' });
        TakeoffState.setConduitTempData(temp);
        e.target.value = '';
        TakeoffApp.render();
      });

      document.querySelector('.add-fitting-btn')?.addEventListener('click', () => {
        const temp = TakeoffState.getConduitTempData();
        temp.fittings = temp.fittings || [];
        temp.fittings.push({ description: '', quantity: 0, labor: 0, price: '' });
        TakeoffState.setConduitTempData(temp);
        TakeoffApp.render();
      });

      document.querySelectorAll('.remove-fitting-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const index = parseInt(e.currentTarget.dataset.index, 10);
          const temp = TakeoffState.getConduitTempData();
          temp.fittings = temp.fittings || [];
          temp.fittings.splice(index, 1);
          if (temp.fittings.length === 0) {
            temp.fittings.push({ description: '', quantity: 0, labor: 0, price: '' });
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
          if (field === 'price') value = value === '' ? null : (parseFloat(value) ?? null);
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
              price: f.price != null && !isNaN(f.price) ? parseFloat(f.price) : null,
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
