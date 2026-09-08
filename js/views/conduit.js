/**
 * Conduit flow - Trenching, Fittings, Overage
 */

const TakeoffConduitView = (function () {
  const BOOK_SVG = TakeoffViewShared.BOOK_SVG;
  const TRASH_SVG = TakeoffViewShared.TRASH_SVG;

  const TRENCHING_QUICK_ADD = [
    { material: 'Dirt', depth: '24in', price: 15 },
    { material: 'Dirt', depth: '36in', price: 30 },
    { material: 'Dirt', depth: '48in', price: 45 },
    { material: 'Rock', depth: '24in', price: 150 },
    { material: 'Rock', depth: '36in', price: 175 },
    { material: 'Asphalt/Concrete', depth: '24in', price: 200 },
    { material: 'Asphalt/Concrete', depth: '36in', price: 250 },
  ];

  // The two kinds of add-on the estimator can put on a trench. They are priced
  // in different units — a backhoe by the hour or day, sand by the unit — so
  // each group gets its own buttons, its own table and its own column labels,
  // and the group is recorded on the child (meta.addonGroup) because the
  // summary taxes them differently: fill is stock, a rental is not.
  const ADDON_GROUPS = [
    {
      group: 'rental',
      title: 'Rentals',
      qtyHead: 'Hours or days',
      priceHead: 'Rate',
      priceSub: '($ per hour or day)',
      options: ['BACKHOE', 'SAW CUTTING', 'DRILLING', 'HAUL-OFF', 'MANLIFT'],
    },
    {
      group: 'fill',
      title: 'Fill & site',
      qtyHead: 'Quantity',
      priceHead: 'Unit price',
      priceSub: '($ each)',
      options: ['ASPHALT PATCH', 'TRENCHING SAND', 'POLE BASES', 'CONCRETE PADS', 'MANHOLES'],
    },
  ];
  const RENTAL_DESCRIPTIONS = new Set(ADDON_GROUPS[0].options);

  // Which button group a row came from. Rows saved before the split carry no
  // group, so fall back to the button that could have produced them; anything
  // unrecognised stays 'fill', which is what every add-on used to be.
  function addonGroupOf(row) {
    if (row?.group === 'rental' || row?.group === 'fill') return row.group;
    return RENTAL_DESCRIPTIONS.has((row?.description || '').trim().toUpperCase()) ? 'rental' : 'fill';
  }

  function escapeHtml(str) {
    return TakeoffUtils.escapeHtml(str);
  }

  // Money and hours in the flow read the way they read everywhere else (2
  // places at or above $1, 4 below), minus the thousands separators a
  // type=number field would reject. Blank stays blank — it means "not priced".
  function moneyValue(v) {
    if (v === '' || v == null) return '';
    const n = Number(v);
    if (!Number.isFinite(n)) return '';
    return TakeoffUtils.formatMoney(n).replace(/,/g, '');
  }
  function hoursValue(v) {
    if (v === '' || v == null) return '';
    const n = Number(v);
    if (!Number.isFinite(n)) return '';
    return TakeoffUtils.formatHours(n).replace(/,/g, '');
  }

  const BLANK_FITTING = () => ({ description: '', quantity: 0, labor: 0, price: '' });

  // "Conduit:" + the three wizard steps, the current one boxed in accent.
  // Pills are clickable and, like Next and Back, are pure navigation: nothing
  // reaches the bid until Save.
  function renderStepHeader(activeStep) {
    const steps = [[1, 'Trenching'], [2, 'Fittings'], [3, 'Overage']];
    const pills = steps
      .map(([n, label]) => `<button type="button" class="conduit-step-pill${n === activeStep ? ' active' : ''}" data-step="${n}">${label}</button>`)
      .join('');
    return `<h2 class="conduit-step-title">Conduit: ${pills}</h2>`;
  }

  // The step-1 fields are plain inputs; keep the buffer in step with them so
  // leaving step 1 never loses a value (the input listeners do this too — this
  // is the belt for anything set without firing an event).
  function captureStep1Fields() {
    const qtyEl = document.getElementById('trench-qty');
    if (!qtyEl) return; // step 1 is not on screen
    const temp = TakeoffState.getConduitTempData();
    temp.trenchQty = qtyEl.value;
    temp.trenchMaterial = document.getElementById('trench-material')?.value ?? '';
    temp.trenchDepth = document.getElementById('trench-depth')?.value ?? '';
    temp.trenchPricePerFoot = document.getElementById('trench-price-per-foot')?.value ?? '';
  }

  // Move the wizard. Pure navigation in both directions: the buffer is the
  // wizard's working copy and only Save writes it to the bid, so Back really
  // does go back and Cancel really does cancel.
  function goToStep(target) {
    const current = TakeoffState.getConduitStep();
    if (target === current) return;
    captureStep1Fields();
    // seed a row so step 2 opens on an editable line. Mutating the live buffer
    // object rather than going through the setter keeps this off the dirty
    // flag — nothing the estimator did.
    const temp = TakeoffState.getConduitTempData();
    if (target === 2 && (!temp.fittings || temp.fittings.length === 0)) {
      temp.fittings = [BLANK_FITTING()];
    }
    TakeoffState.setConduitStep(target);
    TakeoffApp.render();
  }

  // Everything the wizard collected, written to parent.children in one batch:
  // one undo frame per run, and nothing on the bid until this runs.
  function saveAll(itemId) {
    const item = TakeoffState.getItemById(itemId);
    if (!item) return;
    const temp = TakeoffState.getConduitTempData();

    const feet = parseFloat(temp.trenchQty) || 0;
    const material = (temp.trenchMaterial || '').trim();
    const depth = (temp.trenchDepth || '').trim();
    const pricePerFoot = parseFloat(temp.trenchPricePerFoot) || 0;
    const hasTrenching = feet > 0 || !!material || !!depth || pricePerFoot > 0;

    TakeoffState.beginBatch(); // one undo frame per save
    item.children = (item.children || []).filter(
      (c) => c.type !== 'trenching' && c.type !== 'trenchingAddon' && c.type !== 'fitting' && c.type !== 'overage'
    );

    if (hasTrenching) {
      TakeoffState.addItem({
        id: TakeoffState.generateId(),
        type: 'trenching',
        description: TakeoffViewShared.trenchDescription(feet, material, depth),
        quantity: feet,
        labor: 0,
        price: pricePerFoot > 0 ? pricePerFoot : null,
        parentId: itemId,
        meta: { feet, material, depth, pricePerFoot },
      });
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
          // the summary reads this: rentals are not stock, fill is
          meta: { addonGroup: addonGroupOf(a) },
        });
      }
    }

    for (const f of temp.fittings || []) {
      if (f.description) {
        TakeoffState.addItem({
          id: TakeoffState.generateId(),
          type: 'fitting',
          description: f.description,
          quantity: f.quantity || 0,
          labor: f.labor || 0,
          price: f.price !== '' && f.price != null && !isNaN(parseFloat(f.price)) ? parseFloat(f.price) : null,
          parentId: itemId,
          // a fitting filled from the book watches that book row (X1)
          meta: f.book ? { book: f.book } : null,
        });
      }
    }

    const baseLength = item.quantity || 0;
    const overagePercent = temp.overagePercent ?? 0;
    const { additional } = TakeoffViewShared.computeOverage(baseLength, overagePercent);
    if (additional > 0) {
      // extra footage is bought at the parent's unit price (material
      // waste — no install labor)
      const unitPrice = Number(item.price);
      TakeoffState.addItem({
        id: TakeoffState.generateId(),
        type: 'overage',
        description: `Conduit overage (${overagePercent}%)`,
        quantity: additional,
        labor: 0,
        price: !isNaN(unitPrice) && unitPrice > 0 ? unitPrice : null,
        parentId: itemId,
        meta: { overagePercent },
      });
    }

    TakeoffState.endBatch();
    TakeoffEvents.log('flow_saved', { kind: 'conduit', rows: (item.children || []).length, componentPrice: (item.children || []).some((c) => c.price != null) });
    TakeoffState.setFlowDirty(false);
    TakeoffApp.navigateToManifest();
  }

  // One group's buttons and, under them, the rows that came from them. The
  // index carried on each input is the row's index in the single buffer array,
  // so splitting the table changes nothing about how a row is edited.
  function renderAddonSection(spec, addons) {
    const rows = addons
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => addonGroupOf(a) === spec.group);

    const buttons = spec.options
      .map(
        (d) =>
          `<button type="button" class="btn btn-secondary trenching-addon-btn" data-group="${spec.group}" data-description="${escapeHtml(d)}">+ ${escapeHtml(d)}</button>`
      )
      .join('');

    const table = rows.length === 0 ? '' : `
              <div class="flow-table-scroll"><table class="trenching-addons-table" data-group="${spec.group}">
                <thead><tr><th>Description</th><th>${spec.qtyHead}</th><th>Added labor<br><span class="th-sub">(hrs)</span></th><th>${spec.priceHead}<br><span class="th-sub">${escapeHtml(spec.priceSub)}</span></th><th></th></tr></thead>
                <tbody>${rows.map(({ a, i }) => `
                  <tr>
                    <td>${escapeHtml(a.description || '')}</td>
                    <td><input type="number" inputmode="decimal" data-addon-index="${i}" data-field="quantity" value="${escapeHtml(a.quantity ?? '')}" min="0" step="0.1" dir="ltr" placeholder="0" /></td>
                    <td><input type="number" inputmode="decimal" data-addon-index="${i}" data-field="labor" value="${escapeHtml(hoursValue(a.labor))}" min="0" step="0.1" dir="ltr" placeholder="0" /></td>
                    <td><input type="number" inputmode="decimal" data-addon-index="${i}" data-field="price" value="${escapeHtml(moneyValue(a.price))}" min="0" step="0.01" dir="ltr" placeholder="0" /></td>
                    <td><button type="button" class="remove-addon-btn icon-btn" data-addon-index="${i}" title="Remove">${TRASH_SVG}</button></td>
                  </tr>
                `).join('')}</tbody>
              </table></div>`;

    return `
            <div class="trenching-addon-section" data-group="${spec.group}">
              <p class="trenching-addon-section-title">${escapeHtml(spec.title)}</p>
              <div class="trenching-addon-buttons">${buttons}</div>
              ${table}
            </div>`;
  }

  function renderStep1(itemId) {
    const item = TakeoffState.getItemById(itemId);
    if (!item) return '';
    const temp = TakeoffState.getConduitTempData();
    const addons = temp.trenchingAddons || [];

    return `
      <div class="flow-page conduit-flow">
        ${renderStepHeader(1)}
        ${TakeoffViewShared.renderParentSummary(item)}
        <div class="flow-section">
          <h3>Trenching</h3>
          <p class="trenching-intro">How much trenching (feet)? Through what material? At what depth?</p>
          <div class="trenching-row">
            <div class="trenching-fields">
              <label>Quantity (Feet Of Trenching) <input type="number" inputmode="decimal" id="trench-qty" value="${escapeHtml(temp.trenchQty ?? '')}" min="0" placeholder="0" /></label>
              <label>Material to Dig Through <input type="text" id="trench-material" value="${escapeHtml(temp.trenchMaterial || '')}" placeholder="e.g. asphalt, concrete" /></label>
              <label>Depth <input type="text" id="trench-depth" value="${escapeHtml(temp.trenchDepth || '')}" placeholder="e.g. 18 inches" /></label>
              <label>Price per Foot of Trenching ($) <input type="number" inputmode="decimal" id="trench-price-per-foot" value="${escapeHtml(moneyValue(temp.trenchPricePerFoot))}" min="0" step="0.01" placeholder="0" /></label>
            </div>
            <div class="trenching-quick-add">
              <p class="trenching-quick-add-title">Quick Add:</p>
              <table class="trenching-quick-add-table">
                <tbody>
                  ${TRENCHING_QUICK_ADD.map(
                    (p) => `
                  <tr class="trenching-quick-add-row" data-material="${escapeHtml(p.material)}" data-depth="${escapeHtml(p.depth)}" data-price="${p.price}" role="button" tabindex="0">
                    <td>${escapeHtml(`${p.material} to ${p.depth} - $${TakeoffUtils.formatMoney(p.price)}`)}</td>
                  </tr>
                `
                  ).join('')}
                </tbody>
              </table>
            </div>
          </div>
          <div class="trenching-addons">
            ${ADDON_GROUPS.map((spec) => renderAddonSection(spec, addons)).join('')}
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
        <td class="labor-book-cell"><button type="button" class="part-book-icon-btn icon-btn" data-fittings-index="${i}" title="Fill this row from the Labor and Price Book">Book</button></td>
        <td><input type="text" data-fittings-index="${i}" data-field="description" value="${escapeHtml(f.description || '')}" placeholder="Description" /></td>
        <td><input type="number" inputmode="decimal" data-fittings-index="${i}" data-field="quantity" value="${escapeHtml(f.quantity ?? '')}" min="0" /></td>
        <td><input type="number" inputmode="decimal" data-fittings-index="${i}" data-field="labor" value="${escapeHtml(hoursValue(f.labor))}" min="0" step="0.1" /></td>
        <td><input type="number" inputmode="decimal" data-fittings-index="${i}" data-field="price" value="${escapeHtml(moneyValue(f.price))}" min="0" step="0.01" dir="ltr" placeholder="Price" /></td>
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
        ${renderStepHeader(2)}
        ${TakeoffViewShared.renderParentSummary(item)}
        <div class="flow-section">
          <h3 class="fittings-section-header">Fittings <button type="button" class="labor-book-icon-btn icon-btn" id="conduit-fittings-labor-book-btn" title="Open Labor and Price Book - Conduit Fittings">${BOOK_SVG}</button></h3>
          <p>Add items manually or select from list:</p>
          <select id="fittings-preset">
            <option value="">-- Select from list --</option>
            ${presetOptions}
          </select>
          <div class="flow-table-scroll"><table class="fittings-table">
            <thead><tr><th></th><th>Description</th><th>Quantity</th><th>Labor</th><th>Price</th><th></th></tr></thead>
            <tbody>${fittingRows}</tbody>
          </table></div>
          <button type="button" class="btn add-fitting-btn">Add Fitting Row</button>
        </div>
        <div class="flow-actions">
          <button type="button" class="btn btn-secondary" id="conduit-cancel-btn">Cancel</button>
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

    return `
      <div class="flow-page conduit-flow">
        ${renderStepHeader(3)}
        ${TakeoffViewShared.renderParentSummary(item)}
        ${TakeoffViewShared.renderOverageSection({ inputId: 'overage-percent', noun: 'Conduit', baseLength, overagePercent })}
        <div class="flow-actions">
          <button type="button" class="btn btn-secondary" id="conduit-cancel-btn">Cancel</button>
          <button type="button" class="btn btn-secondary" id="conduit-back-fittings">Back</button>
          <button type="button" class="btn btn-success" id="conduit-save-btn">Save parts to the bid</button>
        </div>
      </div>
    `;
  }

  function render(itemId) {
    // the buffer is hydrated before this first render; from here on every
    // write to it — the labor book's included — counts as an edit
    TakeoffState.endFlowHydration();
    const step = TakeoffState.getConduitStep();
    if (step === 1) return renderStep1(itemId);
    if (step === 2) return renderStep2(itemId);
    return renderStep3(itemId);
  }

  function attachListeners(itemId) {
    const step = TakeoffState.getConduitStep();

    // step pills jump directly to a step — navigation only, like Next and Back
    document.querySelectorAll('.conduit-step-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        goToStep(Number(btn.dataset.step));
      });
    });

    // Cancel sits on every step; navigateToManifest runs the discard guard
    document.getElementById('conduit-cancel-btn')?.addEventListener('click', () => {
      TakeoffApp.navigateToManifest();
    });

    if (step === 1) {
      // keep the buffer in step with the fields, and arm the discard guard
      [
        ['trench-qty', 'trenchQty'],
        ['trench-material', 'trenchMaterial'],
        ['trench-depth', 'trenchDepth'],
        ['trench-price-per-foot', 'trenchPricePerFoot'],
      ].forEach(([id, key]) => {
        document.getElementById(id)?.addEventListener('input', (e) => {
          TakeoffState.setConduitTempData({ [key]: e.target.value });
          TakeoffState.setFlowDirty(true);
        });
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
          // untouched footage defaults to the run's length — a $0-feet trench
          // is one distracted click away otherwise
          const qtyInput = document.getElementById('trench-qty');
          if (qtyInput && !(parseFloat(qtyInput.value) > 0)) {
            const item = TakeoffState.getItemById(itemId);
            const feet = item?.quantity || 0;
            if (feet > 0) {
              qtyInput.value = feet;
              temp.trenchQty = String(feet);
            }
          }
          TakeoffState.setConduitTempData(temp);
          TakeoffState.setFlowDirty(true);
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
          // the button group is the row's group from here to the saved child
          const group = e.currentTarget.dataset.group === 'rental' ? 'rental' : 'fill';
          const temp = TakeoffState.getConduitTempData();
          temp.trenchingAddons = temp.trenchingAddons || [];
          temp.trenchingAddons.push({ description, group, quantity: '', labor: '', price: '' });
          TakeoffState.setConduitTempData(temp);
          TakeoffState.setFlowDirty(true);
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
          TakeoffState.setFlowDirty(true);
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
          TakeoffState.setFlowDirty(true);
        });
      });

      document.getElementById('conduit-next-fittings')?.addEventListener('click', () => {
        goToStep(2);
      });
    }

    if (step === 2) {
      document.getElementById('conduit-back-trench')?.addEventListener('click', () => {
        goToStep(1);
      });

      document.getElementById('conduit-fittings-labor-book-btn')?.addEventListener('click', () => {
        TakeoffApp.showLaborBookModalForConduitFittings(itemId);
      });

      document.getElementById('fittings-preset')?.addEventListener('change', (e) => {
        const val = e.target.value;
        if (!val) return;
        const temp = TakeoffState.getConduitTempData();
        temp.fittings = temp.fittings || [];
        // the step opens on a blank row; fill that one rather than leaving it
        // above the pick for the estimator to trash
        const blank = temp.fittings.findIndex((f) => !(f.description || '').trim());
        if (blank >= 0) {
          temp.fittings[blank] = { ...temp.fittings[blank], description: val, quantity: temp.fittings[blank].quantity || 1 };
        } else {
          temp.fittings.push({ description: val, quantity: 1, labor: 0, price: '' });
        }
        TakeoffState.setConduitTempData(temp);
        TakeoffState.setFlowDirty(true);
        e.target.value = '';
        TakeoffApp.render();
      });

      document.querySelector('.add-fitting-btn')?.addEventListener('click', () => {
        const temp = TakeoffState.getConduitTempData();
        temp.fittings = temp.fittings || [];
        temp.fittings.push(BLANK_FITTING());
        TakeoffState.setConduitTempData(temp);
        TakeoffState.setFlowDirty(true);
        TakeoffApp.render();
      });

      document.querySelectorAll('.part-book-icon-btn[data-fittings-index]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const index = parseInt(e.currentTarget.dataset.fittingsIndex, 10);
          TakeoffApp.showPartBookSearchForConduitFitting(index);
        });
      });

      document.querySelectorAll('.remove-fitting-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const index = parseInt(e.currentTarget.dataset.index, 10);
          const temp = TakeoffState.getConduitTempData();
          temp.fittings = temp.fittings || [];
          temp.fittings.splice(index, 1);
          if (temp.fittings.length === 0) {
            temp.fittings.push(BLANK_FITTING());
          }
          TakeoffState.setConduitTempData(temp);
          TakeoffState.setFlowDirty(true);
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
          TakeoffState.setFlowDirty(true);
        });
      });

      document.getElementById('conduit-next-overage')?.addEventListener('click', () => {
        goToStep(3);
      });
    }

    if (step === 3) {
      document.getElementById('conduit-back-fittings')?.addEventListener('click', () => {
        goToStep(2);
      });

      document.querySelectorAll('.overage-buttons button').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const percent = parseInt(e.target.dataset.percent, 10);
          TakeoffState.setConduitTempData({ overagePercent: percent });
          TakeoffState.setFlowDirty(true);
          document.getElementById('overage-percent').value = percent;
          TakeoffApp.render();
        });
      });

      // typing a custom %: update the buffer and patch the total line in place
      // (a re-render here would steal focus after the first digit)
      document.getElementById('overage-percent')?.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        const percent = isNaN(val) ? null : val;
        TakeoffState.setConduitTempData({ overagePercent: percent });
        TakeoffState.setFlowDirty(true);
        TakeoffViewShared.updateOverageTotal('overage-percent', 'Conduit', TakeoffState.getItemById(itemId)?.quantity || 0, percent);
      });

      document.getElementById('conduit-save-btn')?.addEventListener('click', () => {
        saveAll(itemId);
      });
    }
  }

  return { render, attachListeners };
})();
