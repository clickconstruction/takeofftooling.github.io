/**
 * Main manifest table view
 */

const TakeoffManifestView = (function () {
  const TRASH_SVG = TakeoffViewShared.TRASH_SVG;
  const BOOK_SVG = TakeoffViewShared.BOOK_SVG;
  const CHILD_ARROW_SVG = TakeoffViewShared.CHILD_ARROW_SVG;

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

  // Flow-generated component types, shown on child rows
  const CHILD_TYPE_LABELS = {
    outletsAndSwitches: 'Outlet/Switch',
    box: 'Box',
    backBoxSupport: 'Back Box Support',
    cover: 'Cover',
    screws: 'Screws',
    misc: 'Misc.',
    trenching: 'Trenching',
    trenchingAddon: 'Trenching Add-on',
    fitting: 'Fitting',
    overage: 'Overage',
    macAdapter: 'MAC Adapter',
    conduit: 'Conduit',
    wire: 'Wire',
  };

  // ---------- X1: the book row a bid row came from ----------
  // A bid row is a snapshot, and it should stay one — but when the book row it
  // was priced from has moved (a quote landed, a supplier update ran), the row
  // says so where the money is and offers the new number. Only on a real
  // difference: no chip is standing furniture on every book-sourced row.

  function bookRowFor(ref) {
    if (!ref || !ref.type || !ref.section || !ref.name) return null;
    const rows = TakeoffState.getLaborBookType(ref.type)?.[ref.section];
    if (!Array.isArray(rows)) return null;
    return rows.find((r) => r && r.name === ref.name) || null;
  }

  const cents = (n) => Math.round((Number(n) || 0) * 100);

  /** What the book now says, when that differs from what this row says. */
  function bookDelta(item) {
    const row = bookRowFor(item && item.meta && item.meta.book);
    if (!row) return null;
    const bookPrice = TakeoffUtils.parseMoney(row.price);
    if (bookPrice == null || !Number.isFinite(bookPrice)) return null;
    const itemPrice = item.price == null || item.price === '' ? null : Number(item.price);
    if (itemPrice != null && cents(itemPrice) === cents(bookPrice)) return null;
    const bookLabor = Number(row.labor) || 0;
    return {
      bookPrice,
      bookLabor,
      laborChanged: Math.round(bookLabor * 1000) !== Math.round((Number(item.labor) || 0) * 1000),
      source: row.priceSource || '',
      at: row.pricedAt || '',
    };
  }

  function bookChipSignature(item) {
    const d = bookDelta(item);
    return d ? `${d.bookPrice}|${d.bookLabor}|${d.laborChanged ? 1 : 0}` : '';
  }

  function bookChipHtml(item) {
    const d = bookDelta(item);
    if (!d) return '';
    const from = [d.source, d.at].filter(Boolean).join(', ');
    const laborBit = d.laborChanged ? ` and ${TakeoffUtils.formatHours(d.bookLabor)} hrs` : '';
    const title = `The book now has $${TakeoffUtils.formatMoney(d.bookPrice)}${laborBit} for this part${from ? ` (${from})` : ''}. Click to bring it onto this row.`;
    return `<button type="button" class="book-price-chip row-btn" tabindex="-1" data-id="${item.id}" title="${escapeHtml(title)}">book: $${TakeoffUtils.formatMoney(d.bookPrice)}</button>`;
  }

  // The slot is always there for a book-sourced row and empty when the two
  // agree, so the chip can appear and go without a re-render (updateSummaryOnly).
  function bookChipSlot(item) {
    if (!item.meta || !item.meta.book) return '';
    return `<span class="book-chip-slot" data-book-chip="${item.id}" data-chip-sig="${escapeHtml(bookChipSignature(item))}">${bookChipHtml(item)}</span>`;
  }

  function syncBookChips() {
    document.querySelectorAll('.manifest-view [data-book-chip]').forEach((slot) => {
      const item = TakeoffState.getItemById(slot.dataset.bookChip);
      const sig = item ? bookChipSignature(item) : '';
      if (slot.dataset.chipSig === sig) return;
      slot.dataset.chipSig = sig;
      slot.innerHTML = item ? bookChipHtml(item) : '';
      bindBookChip(slot.querySelector('.book-price-chip'));
    });
  }

  function bindBookChip(btn) {
    if (!btn) return;
    btn.addEventListener('click', (e) => applyBookPrice(e.currentTarget.dataset.id));
    btn.addEventListener('keydown', handleRowButtonKeydown);
  }

  // Price, and hours when the book's have changed too, in ONE undo frame.
  function applyBookPrice(id) {
    const item = TakeoffState.getItemById(id);
    const d = item && bookDelta(item);
    if (!d) return;
    const updates = { price: d.bookPrice };
    if (d.laborChanged) updates.labor = d.bookLabor;
    TakeoffState.beginBatch();
    TakeoffState.updateItem(id, updates);
    TakeoffState.endBatch();
    TakeoffApp.render();
  }

  // The row's buttons are a roving group: one tab stop per row, the arrow
  // keys walk the rest. Module-scope because a chip created after render
  // (syncBookChips) joins the same group.
  function handleRowButtonKeydown(e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const row = e.currentTarget.closest('tr');
    if (!row) return;
    const btns = [...row.querySelectorAll('.row-btn')];
    const next = btns[btns.indexOf(e.currentTarget) + (e.key === 'ArrowRight' ? 1 : -1)];
    if (!next) return;
    e.preventDefault();
    for (const b of btns) b.tabIndex = -1;
    next.tabIndex = 0;
    next.focus();
  }

  function renderRow(item, isChild = false) {
    const typeClass = item.type && TYPE_LABELS[item.type] ? item.type : 'default';
    const hasFlow = ['devices', 'conduit', 'wire'].includes(item.type);

    const planPageCell = isChild
      ? '<td></td>'
      : `<td><div class="plan-cell-wrap">${item.group ? `<span class="group-tag" title="Group / circuit from CountTooling">${escapeHtml(item.group)}</span>` : ''}<input type="text" data-field="planPage" data-id="${item.id}" value="${escapeHtml(item.planPage || '')}" placeholder="Plan page / Location" /></div></td>`;

    const typeLabelDisplay = item.type
      ? (isChild ? CHILD_TYPE_LABELS[item.type] || TYPE_LABELS[item.type] || item.type : TYPE_LABELS[item.type] || item.type)
      : '';
    const parentId = item.parentId || null;
    const parent = parentId ? TakeoffState.getItemById(parentId) : null;
    const parentHasFlow = parent && ['devices', 'conduit', 'wire'].includes(parent.type);
    const showEditFlow = (hasFlow && !isChild) || (isChild && parentHasFlow);
    const editFlowTargetId = isChild && parentHasFlow ? parentId : item.id;
    // Flow types (devices/conduit/wire): the pencil is the one-click door into
    // the editor. The chip's TEXT opens the type picker instead (X12), which is
    // how a typed row is re-typed — so there is no × that parks the row's money
    // in Misc on the way. Child badges are the parent's flow door, and children
    // never carry type controls of their own.
    const PENCIL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="type-badge-edit-icon" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
    const childBadge = (extraClass) =>
      showEditFlow
        ? `<button type="button" class="type-badge ${extraClass} type-badge-flow row-btn" tabindex="-1" data-id="${editFlowTargetId}" title="Edit in flow">${escapeHtml(typeLabelDisplay)}${PENCIL_SVG}</button>`
        : `<span class="type-badge ${extraClass}">${escapeHtml(typeLabelDisplay)}</span>`;
    const typeTextBtn = (extraClass) =>
      `<button type="button" class="type-badge ${extraClass} type-badge-text row-btn" tabindex="-1" data-id="${item.id}" title="Change the type">${escapeHtml(typeLabelDisplay)}</button>`;
    let typeCell;
    if (isChild) {
      // children are flow/book components: label only, never type controls
      typeCell = `<td class="type-cell-child">${item.type ? childBadge('child-type-badge') : ''}</td>`;
    } else if (!item.type) {
      // An untyped row asks for a type where the type goes: a dashed chip the
      // size of the badge it becomes, not a second gold Add button beside the
      // one that adds rows.
      typeCell = `<td class="type-cell-add"><button type="button" class="select-type-btn type-badge-empty row-btn" tabindex="-1" data-id="${item.id}" title="Choose a type">type…</button></td>`;
    } else if (hasFlow) {
      typeCell = `<td><span class="type-badge-split">${typeTextBtn(typeClass)}<button type="button" class="type-badge ${typeClass} type-badge-flow row-btn" tabindex="-1" data-id="${item.id}" title="Edit in flow">${PENCIL_SVG}</button></span></td>`;
    } else {
      typeCell = `<td>${typeTextBtn(typeClass)}</td>`;
    }

    // Roving tab stop: Tab walks the row's five fields, and one button per row
    // stays reachable so the arrow keys can reach the rest (see
    // handleRowButtonKeydown). Taking every button out with tabindex="-1"
    // would remove the book and the delete from a keyboard entirely.
    //
    // X13: the trash sits on every row and appears on hover (always, at touch
    // widths — see the manifest CSS). It used to be behind a mode in the ☰ menu
    // whose checkmark was out of sight the moment it was set.
    const removeCell = `<td class="remove-cell"><button type="button" class="remove-btn icon-btn row-btn" tabindex="-1" data-id="${item.id}" title="Remove this row">${TRASH_SVG}</button></td>`;

    // childless parents get "+" for their first child; once children exist the
    // ghost add-row at the bottom of the block takes over (children can't nest)
    const showRailAdd = !isChild && !(item.children && item.children.length);
    const laborBookCell = `<td class="labor-book-cell"><button type="button" class="labor-book-icon-btn icon-btn row-btn" tabindex="0" data-id="${item.id}" title="Open Labor and Price Book">${BOOK_SVG}</button>${showRailAdd ? `<button type="button" class="add-child-btn icon-btn row-btn" tabindex="-1" data-id="${item.id}" title="Add child row">${CHILD_ARROW_SVG}</button>` : ''}</td>`;

    return `
      <tr class="${isChild ? 'child-row' : ''} ${item.unit === 'px' ? 'row-unscaled' : ''}" data-id="${item.id}">
        ${removeCell}
        ${laborBookCell}
        <td><input type="text" data-field="description" data-id="${item.id}" value="${escapeHtml(item.description || '')}" placeholder="Assembly Description" /></td>
        ${typeCell}
        <td class="qty-cell"><div class="qty-spinner"><button type="button" class="qty-down-btn row-btn" tabindex="-1" data-id="${item.id}" title="Subtract 1">−</button><input type="number" class="${isParkedAtZero(item) ? 'qty-zero' : ''}" data-field="quantity" data-id="${item.id}" dir="ltr" inputmode="decimal" value="${isParkedAtZero(item) ? 0 : item.quantity || ''}" min="0" step="${item.unit === 'ea' ? 1 : 'any'}" placeholder="0" /><button type="button" class="qty-up-btn row-btn" tabindex="-1" data-id="${item.id}" title="Add 1">+</button></div>${renderUnitSelect(item)}</td>
        <td class="labor-cell"><input type="number" data-field="labor" data-id="${item.id}" dir="ltr" inputmode="decimal" value="${item.labor || ''}" min="0" step="0.1" placeholder="0" /></td>
        <td class="price-cell"><input type="number" data-field="price" data-id="${item.id}" dir="ltr" inputmode="decimal" value="${item.price ?? ''}" min="0" step="1" placeholder="Price" />${bookChipSlot(item)}</td>
        ${planPageCell}
      </tr>
    `;
  }

  function escapeHtml(str) {
    return TakeoffUtils.escapeHtml(str);
  }

  // Unit beside the quantity: ea (a count) or ft (a length). px is CountTooling's
  // unscaled-run flag — shown, never chosen; it clears by picking ea or ft
  // once the estimator has a real length.
  function renderUnitSelect(item) {
    const unit = item.unit || 'ea';
    const opts = [['ea', 'ea'], ['ft', 'ft']];
    if (unit === 'px') opts.push(['px', 'px · unscaled']);
    return `<select class="qty-unit-select ${unit === 'px' ? 'is-px' : ''}" data-field="unit" data-id="${item.id}" title="${unit === 'px' ? 'Unscaled: a pixel length from CountTooling. Left out of every total — set the scale there and re-import, or pick a unit once you know the length.' : 'Quantity unit'}">${opts.map(([v, l]) => `<option value="${v}" ${v === unit ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  }

  const SUMMARY_LABELS = {
    lighting: 'Lighting',
    gear: 'Gear',
    devices: 'Devices',
    conduit: 'Conduit',
    wire: 'Wire',
    specialSystems: 'Special Systems',
    misc: 'Misc.',
    other: 'Other',
    permits: 'PERMITS',
    powerCoCharges: 'POWER CO. CHARGES',
    temporaryPower: 'TEMPORARY POWER',
    siteWork: 'Site work & rentals',
  };

  const SUMMARY_MAT_TYPES = ['lighting', 'gear', 'devices', 'conduit', 'wire', 'specialSystems', 'misc'];
  // The three typed charge rows plus the trenching and rentals moved out of
  // materials (js/selectors.js): a sub-contract and a hired backhoe are not
  // stock, so they are not taxed and not on the purchase list.
  const SUMMARY_OTHER_TYPES = [...TakeoffSelectors.OTHER_CHARGE_KEYS];

  // One money formatter and one hours formatter for the whole app (js/utils.js):
  // thousands separators, and hours that agree with the dollars beside them.
  function formatMoney(n) {
    return TakeoffUtils.formatMoney(n, { fixed2: true });
  }

  function formatHours(n) {
    return TakeoffUtils.formatHours(n);
  }

  // What a parent row is called, per type, when the hours are split. A conduit,
  // wire or devices row is a run; everything else is the assembly the table's
  // first column already names.
  const SUMMARY_PARENT_WORD = {
    devices: 'runs',
    conduit: 'runs',
    wire: 'runs',
  };

  function parentWord(t) {
    return SUMMARY_PARENT_WORD[t] || 'assemblies';
  }

  // X10: a type whose hours come from BOTH the assembly rows and their parts
  // says so, in the cell, instead of showing one number nobody can reconcile
  // by hand: "11.30 · runs 5.30 + parts 6.00". A type with only one half shows
  // the bare number — the split would be noise.
  function laborSplitText(s, t) {
    const o = s.laborByOrigin && s.laborByOrigin[t];
    if (!o || !(o.parent > 0) || !(o.component > 0)) return '';
    return ` · ${parentWord(t)} ${formatHours(o.parent)} + parts ${formatHours(o.component)}`;
  }

  // Every number the summary shows, keyed by the data-summary attribute of the
  // cell that holds it. render() and updateSummaryOnly() share this map so the
  // block can be patched cell by cell instead of rebuilt (see updateSummaryOnly).
  function summaryValues(s) {
    const rate = TakeoffState.getLaborRate() || 0;
    const v = {};
    for (const t of SUMMARY_MAT_TYPES) {
      v['mat.' + t] = '$' + formatMoney(s.materials[t]);
      v['lab.' + t] = formatHours(s.labor[t]);
      v['labSplit.' + t] = laborSplitText(s, t);
    }
    // hours typed on permits / power co. / temporary power rows
    v['lab.other'] = formatHours(s.labor.other);
    v['labSplit.other'] = laborSplitText(s, 'other');
    for (const t of SUMMARY_OTHER_TYPES) v['oth.' + t] = '$' + formatMoney(s.otherCharges[t]);
    v.materialsSubtotal = '$' + formatMoney(s.materialsSubtotal);
    v.salesTax = '$' + formatMoney(s.salesTax);
    v.materialsTotal = '$' + formatMoney(s.materialsTotal);
    v.laborTotal = formatHours(s.laborTotal);
    v.laborDollars = '$' + formatMoney(s.laborTotal * rate);
    v.otherTotal = '$' + formatMoney(s.otherTotal);
    v.grandTotal = 'Grand Total: $' + formatMoney(s.materialsTotal + s.laborTotal * rate + s.otherTotal);
    // px rows are pixels, not feet: they sit outside every total until rescaled
    v.unscaledNote = s.unscaledCount
      ? `${s.unscaledCount} unscaled row${s.unscaledCount === 1 ? '' : 's'} (px) left out of totals — set the scale in CountTooling and re-import.`
      : '';
    return v;
  }

  // X10: every number in the summary says how it is built, on the number
  // itself. An estimator whose own arithmetic disagrees can see which rows the
  // app counted before asking anyone.
  function summaryTitle(key) {
    const [group, t] = key.split('.');
    const label = SUMMARY_LABELS[t] || '';
    if (group === 'mat') return `Sum of qty × price for ${label} rows and their parts, rounded per line`;
    if (group === 'lab' && t === 'other') return 'Hours typed on the permit, power co. and temporary power rows';
    if (group === 'lab') return `Sum of qty × hours for ${label} rows and their parts`;
    if (group === 'oth' && t === 'siteWork') return 'Trenching and rentals: hired work, so it is not taxed and not on the purchase list';
    if (group === 'oth') return `Sum of qty × price for ${label} rows`;
    const titles = {
      materialsSubtotal: 'Every materials line above, added up',
      salesTax: 'Materials sub total × the sales tax rate above',
      materialsTotal: 'Materials sub total + sales tax',
      laborTotal: 'Every labor line above, added up',
      laborDollars: 'Labor total hours × the labor rate',
      otherTotal: 'Every other charge above, added up',
      grandTotal: 'Materials total + labor $ + other charges',
      unscaledNote: 'Rows still carrying a pixel length (px) from Count Tooling: no price and no hours until the page is scaled there and re-imported',
    };
    return titles[key] || '';
  }

  function renderSummary() {
    const s = TakeoffState.getSummaryBreakdown();
    const v = summaryValues(s);
    const cell = (key) => `<td class="summary-value" data-summary="${key}" title="${escapeHtml(summaryTitle(key))}">${v[key]}</td>`;
    // the split rides in its own span so updateSummaryOnly can patch both
    // halves by textContent without rebuilding the cell
    const laborValueCell = (t) =>
      `<td class="summary-value" title="${escapeHtml(summaryTitle('lab.' + t))}"><span data-summary="lab.${t}">${v['lab.' + t]}</span><span class="summary-split" data-summary="labSplit.${t}">${v['labSplit.' + t]}</span></td>`;

    const materialsRows = SUMMARY_MAT_TYPES.map((t) => `<tr><td>${SUMMARY_LABELS[t]}</td>${cell('mat.' + t)}</tr>`).join('');
    const laborRows = [...SUMMARY_MAT_TYPES, 'other'].map((t) => `<tr><td>${SUMMARY_LABELS[t]}</td>${laborValueCell(t)}</tr>`).join('');
    const otherRows = SUMMARY_OTHER_TYPES.map((t) => `<tr><td>${SUMMARY_LABELS[t]}</td>${cell('oth.' + t)}</tr>`).join('');

    return `
      <div class="manifest-summary">
        <div class="manifest-summary-section">
          <h3 class="manifest-summary-title">MATERIALS</h3>
          <table class="manifest-summary-table">
            ${materialsRows}
            <tr class="summary-subtotal"><td>Sub Total</td>${cell('materialsSubtotal')}</tr>
            <tr><td>Sales tax (%)</td><td class="summary-value"><input type="number" id="tax-rate-input" inputmode="decimal" value="${TakeoffState.getTaxRate()}" min="0" max="100" step="0.001" placeholder="0" title="The job's own sales tax rate" /></td></tr>
            <tr><td>Sales tax $</td>${cell('salesTax')}</tr>
            <tr class="summary-total"><td>Materials TOTAL $</td>${cell('materialsTotal')}</tr>
          </table>
        </div>
        <div class="manifest-summary-section">
          <h3 class="manifest-summary-title">LABOR</h3>
          <table class="manifest-summary-table">
            ${laborRows}
            <tr class="summary-total"><td>Labor TOTAL (hrs)</td>${cell('laborTotal')}</tr>
            <tr><td>Labor Rate ($/Hr)</td><td class="summary-value"><input type="number" id="labor-rate-input" inputmode="decimal" value="${TakeoffState.getLaborRate() || ''}" min="0" step="0.01" placeholder="0" /></td></tr>
            <tr class="summary-total"><td>Labor Total $</td>${cell('laborDollars')}</tr>
          </table>
        </div>
        <div class="manifest-summary-section">
          <h3 class="manifest-summary-title">OTHER CHARGES</h3>
          <table class="manifest-summary-table">
            ${otherRows}
            <tr class="summary-total"><td>Other TOTAL $</td>${cell('otherTotal')}</tr>
          </table>
        </div>
        <div class="manifest-summary-grand-total" data-summary="grandTotal" title="${escapeHtml(summaryTitle('grandTotal'))}">${v.grandTotal}</div>
        <div class="manifest-summary-grand-note">Cost only — margin and the bid price are set in PipeTooling.</div>
        <div class="summary-unscaled-note" data-summary="unscaledNote" title="${escapeHtml(summaryTitle('unscaledNote'))}" ${v.unscaledNote ? '' : 'hidden'}>${escapeHtml(v.unscaledNote)}</div>
      </div>
    `;
  }

  /**
   * Refresh the numbers a row edit changed, without replacing any node the
   * estimator might be aiming at. A field's `change` fires between mousedown
   * and click, so rebuilding the summary here used to destroy the labor-rate
   * input under the pointer: the click landed on nothing and the focus went
   * to <body>. Text is patched cell by cell; the purchase list's Copy/Hide
   * buttons live outside the part that is rewritten, for the same reason.
   */
  function updateSummaryOnly() {
    const summaryEl = document.querySelector('.manifest-view .manifest-summary');
    if (summaryEl) {
      const laborInput = document.getElementById('labor-rate-input');
      if (laborInput) TakeoffState.setLaborRate(laborInput.value);
      const taxInput = document.getElementById('tax-rate-input');
      if (taxInput) TakeoffState.setTaxRate(taxInput.value);
      const v = summaryValues(TakeoffState.getSummaryBreakdown());
      summaryEl.querySelectorAll('[data-summary]').forEach((el) => {
        const next = v[el.dataset.summary];
        if (next !== undefined && el.textContent !== next) el.textContent = next;
        if (el.dataset.summary === 'unscaledNote') el.hidden = !next;
      });
    }
    updatePurchaseListOnly();
    // A price typed by hand can agree with the book again, or stop agreeing:
    // the chip follows without a render (the estimator is still in the field).
    syncBookChips();
    // These edits deliberately skip a render, so nothing else would refresh
    // the header's Undo/Redo state (T2-03).
    refreshUndoRedo();
  }

  function refreshUndoRedo() {
    if (typeof TakeoffApp !== 'undefined' && TakeoffApp.updateUndoRedoButtons) TakeoffApp.updateUndoRedoButtons();
  }

  // Ghost row closing a child block: adding lands exactly where the row appears
  function renderAddChildRow(parentId) {
    return `
      <tr class="child-row add-child-row">
        <td class="remove-cell"></td>
        <td class="labor-book-cell"></td>
        <td colspan="6" class="add-child-cell"><button type="button" class="add-child-btn add-child-row-btn" data-id="${parentId}">${CHILD_ARROW_SVG} Add component</button></td>
      </tr>
    `;
  }

  function render() {
    const items = TakeoffState.getFlattenedItems();

    let rows = '';
    let openBlockParentId = null;
    for (const { _depth, ...item } of items) {
      const isChild = _depth > 0;
      if (!isChild) {
        if (openBlockParentId) rows += renderAddChildRow(openBlockParentId);
        openBlockParentId = item.children && item.children.length ? item.id : null;
      }
      rows += renderRow(item, isChild);
    }
    if (openBlockParentId) rows += renderAddChildRow(openBlockParentId);

    // A bid with no described row yet: point at the two ways in, and keep the
    // zeroed summary out of the way. The hint is hidden in place on the first
    // description keystroke (no re-render, so typing isn't interrupted) — and
    // shown again if that description is deleted, which is still an empty bid.
    const hasContent = items.some((i) => (i.description || '').trim());
    const hint = `<div class="manifest-first-run-hint" id="manifest-first-run-hint"${hasContent ? ' hidden' : ''}>
          <strong>Start here.</strong> Paste your counts from CountTooling.com, or type the first fixture below.
        </div>`;

    return `
      <div class="manifest-view">
        ${hint}
        <div class="manifest-table-scroll">
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
              <th>Labor (hrs/unit)</th>
              <th>Price</th>
              <th>Plan Page / Location</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
        </div>
        <div class="manifest-actions">
          <button type="button" class="btn btn-success" id="add-row-btn">Add Row</button>
        </div>
        <div class="manifest-below${hasContent ? '' : ' manifest-empty-hide'}" id="manifest-below">
        ${renderSummary()}
        <div class="print-options ${TakeoffState.getShowPrintOptions() ? 'expanded' : ''}">
          <button type="button" class="btn print-options-toggle" id="print-options-toggle" aria-expanded="${TakeoffState.getShowPrintOptions()}">
            Print Options
          </button>
          <div class="print-options-content">
            <button type="button" class="btn" id="print-review-btn">Print for review</button>
            <button type="button" class="btn" id="print-po-btn">Print purchase list (PO)</button>
            <button type="button" class="btn" id="print-form-btn">Print with form</button>
            ${TakeoffPrintPanel.render()}
          </div>
        </div>
        ${renderPurchaseList()}
        </div>
      </div>
    `;
  }

  // ---------- Purchase list report ----------
  let purchaseListVisible = false;

  // A material bought at two prices shows both, not one of them: '$11.00–$12.50'.
  // The Extended $ column stays a single number — that is the column that gets summed.
  function unitPriceText(l) {
    if (l.priceVaries) return '$' + formatMoney(l.unitPriceLow) + '–$' + formatMoney(l.unitPriceHigh);
    return l.unitPrice != null ? '$' + formatMoney(l.unitPrice) : '—';
  }

  // A material priced at $0 (a give-away, an owner-furnished part) is priced:
  // it reads $0.00 and is never counted as "without a price". Only a blank
  // price stays dashed — and that one is counted.
  function extendedText(l) {
    return l.unitPrice != null ? '$' + formatMoney(l.extended) : '—';
  }

  function purchaseListMeta(report) {
    return `${report.lines.length} materials${report.unpricedCount ? ` · ${report.unpricedCount} without a price` : ''}`;
  }

  function purchaseListBody(report) {
    if (!report.lines.length) return '<p class="purchase-list-empty">No materials on the manifest yet.</p>';
    const rows = report.lines
      .map(
        (l) => `
        <tr class="${l.unpriced ? 'purchase-list-unpriced' : ''}">
          <td class="purchase-list-qty">${l.quantity}</td>
          <td>${escapeHtml(l.description)}</td>
          <td class="purchase-list-money">${unitPriceText(l)}</td>
          <td class="purchase-list-money">${extendedText(l)}</td>
        </tr>`
      )
      .join('');
    return `
        <table class="purchase-list-table">
          <thead><tr><th class="purchase-list-qty">Qty</th><th>Material</th><th class="purchase-list-money">Unit $</th><th class="purchase-list-money">Extended $</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td></td><td>Materials total (before tax)</td><td></td><td class="purchase-list-money">$${formatMoney(report.totalCost)}</td></tr></tfoot>
        </table>`;
  }

  function renderPurchaseList() {
    if (!purchaseListVisible) {
      return `
        <div class="purchase-list">
          <button type="button" class="btn btn-secondary" id="purchase-list-toggle-btn">Generate purchase list (PO)</button>
        </div>`;
    }
    const report = TakeoffState.getPurchaseList();
    return `
      <div class="purchase-list purchase-list-open">
        <div class="purchase-list-header">
          <h3>Purchase list (PO)</h3>
          <span class="purchase-list-meta">${escapeHtml(purchaseListMeta(report))}</span>
          <button type="button" class="btn btn-small" id="purchase-list-copy-btn" title="Copy as tab-separated rows for a spreadsheet or email">Copy</button>
          <button type="button" class="btn btn-small btn-secondary" id="purchase-list-toggle-btn">Hide</button>
        </div>
        <div class="purchase-list-body">${purchaseListBody(report)}</div>
      </div>`;
  }

  // An open list is one of the two artifacts being reconciled: it must move
  // with the bid. Only the meta line and the body are rewritten, so the
  // header's Copy/Hide buttons survive a mid-click refresh.
  function updatePurchaseListOnly() {
    const listEl = document.querySelector('.manifest-view .purchase-list-open');
    if (!listEl) return;
    const report = TakeoffState.getPurchaseList();
    const meta = listEl.querySelector('.purchase-list-meta');
    if (meta) meta.textContent = purchaseListMeta(report);
    const body = listEl.querySelector('.purchase-list-body');
    if (body) body.innerHTML = purchaseListBody(report);
  }

  function copyPurchaseList() {
    const report = TakeoffState.getPurchaseList();
    const lines = [['Qty', 'Material', 'Unit $', 'Extended $'].join('\t')];
    for (const l of report.lines) {
      const unit = l.priceVaries
        ? l.unitPriceLow.toFixed(2) + '–' + l.unitPriceHigh.toFixed(2)
        : l.unitPrice != null ? l.unitPrice.toFixed(2) : '';
      lines.push([l.quantity, l.description, unit, l.extended ? l.extended.toFixed(2) : ''].join('\t'));
    }
    lines.push(['', 'TOTAL', '', report.totalCost.toFixed(2)].join('\t'));
    // both outcomes go to the app's one feedback region (js/toast.js) — the
    // count is the receipt, so the estimator knows what landed in the sheet
    navigator.clipboard.writeText(lines.join('\n')).then(
      () => TakeoffToast.show(`Purchase list copied — ${report.lines.length} ${report.lines.length === 1 ? 'line' : 'lines'}, ready to paste into a spreadsheet.`, { kind: 'success' }),
      () => TakeoffToast.show('Could not reach the clipboard. Copy the list from the screen instead.', { kind: 'warn', timeout: 9000 })
    );
  }

  // The two rates are bound once, on the stable #main-content host, instead of
  // on the inputs themselves: they live inside the summary block, and anything
  // that re-binds them has to survive the block being refreshed mid-edit.
  let laborRateBound = false;
  function bindLaborRateDelegation() {
    if (laborRateBound) return;
    const host = document.getElementById('main-content');
    if (!host) return;
    laborRateBound = true;
    const onRate = (e) => {
      const el = e.target;
      if (!el || (el.id !== 'labor-rate-input' && el.id !== 'tax-rate-input')) return;
      // A minus sign belongs on neither rate: a labor rate of -92 turned a
      // $17,024 bid into $1,154. Correct it when the value is committed, not
      // while it is being typed.
      if (e.type === 'change') clampNonNegative(el);
      if (el.id === 'labor-rate-input') TakeoffState.setLaborRate(el.value);
      else TakeoffState.setTaxRate(el.value);
      updateSummaryOnly();
    };
    host.addEventListener('input', onRate);
    host.addEventListener('change', onRate);
  }

  // Nothing on a bid is negative. The corrected field says so, and the mark
  // clears as soon as the estimator types in it again.
  function clampNonNegative(input) {
    if (!input) return false;
    const n = parseFloat(input.value);
    if (!(n < 0)) return false;
    input.value = 0;
    input.classList.add('input-invalid');
    input.addEventListener('input', () => input.classList.remove('input-invalid'), { once: true });
    return true;
  }

  // A described row that is priced or labored but sitting at 0 buys nothing and
  // books no hours: grey the quantity so the row reads as parked, not counted.
  function syncQtyZeroFlag(id) {
    const input = document.querySelector(`.qty-cell input[data-field="quantity"][data-id="${id}"]`);
    const item = TakeoffState.getItemById(id);
    if (!input || !item) return;
    input.classList.toggle('qty-zero', isParkedAtZero(item));
  }

  // Adding a row puts the cursor in it: the estimator asked for a row because
  // they have something to type. (The ghost "Add component" row has focused
  // its new description since it shipped; this is the same move.)
  function addRowAndFocus() {
    const item = TakeoffState.addItem({ type: null, description: '', quantity: 1, labor: 0, planPage: '', parentId: null });
    TakeoffApp.render();
    focusField(item.id, 'description');
    return item;
  }

  function focusField(id, field) {
    const el = document.querySelector(`.manifest-view input[data-field="${field}"][data-id="${id}"]`);
    if (el) el.focus();
    return el;
  }

  function typeModalIsOpen() {
    return document.getElementById('type-modal')?.getAttribute('aria-hidden') === 'false';
  }

  function isParkedAtZero(item) {
    return (
      (Number(item.quantity) || 0) <= 0 &&
      (item.description || '').trim() !== '' &&
      ((Number(item.price) || 0) > 0 || (Number(item.labor) || 0) > 0)
    );
  }

  function attachListeners() {
    document.getElementById('purchase-list-toggle-btn')?.addEventListener('click', () => {
      purchaseListVisible = !purchaseListVisible;
      TakeoffApp.render();
      if (purchaseListVisible) {
        TakeoffEvents.log('purchase_list_generated', { lines: TakeoffState.getPurchaseList().lines.length, unpriced: TakeoffState.getPurchaseList().unpricedCount });
        document.querySelector('.purchase-list-open')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    document.getElementById('purchase-list-copy-btn')?.addEventListener('click', copyPurchaseList);

    document.getElementById('add-row-btn')?.addEventListener('click', addRowAndFocus);

    document.getElementById('print-review-btn')?.addEventListener('click', () => {
      TakeoffPDF.printForReview();
    });

    document.getElementById('print-po-btn')?.addEventListener('click', () => {
      TakeoffPDF.printForPurchaseOrder();
    });

    // The details it prints are the project's own (Job details, below), so
    // there is nothing left to ask for first.
    document.getElementById('print-form-btn')?.addEventListener('click', () => {
      TakeoffPDF.printWithForm(TakeoffState.getProjectDetails());
    });

    document.getElementById('print-options-toggle')?.addEventListener('click', () => {
      TakeoffState.toggleShowPrintOptions();
      TakeoffApp.render();
    });

    TakeoffPrintPanel.attachListeners();

    bindLaborRateDelegation();

    document.querySelectorAll('.labor-book-icon-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        TakeoffApp.showLaborBookModal(e.currentTarget.dataset.id);
      });
    });

    // A run's overage/trenching children are derived from the run. After an
    // edit, recompute them (shared.js) and patch their visible cells in place —
    // never re-render here, the user is still typing in a field of this block.
    function syncDerived(id) {
      if (typeof TakeoffViewShared === 'undefined' || !TakeoffViewShared.syncDerivedChildren) return;
      if (!TakeoffViewShared.syncDerivedChildren(id)) return;
      const item = TakeoffState.getItemById(id);
      if (!item) return;
      const rows = item.parentId ? [item] : item.children || [];
      for (const row of rows) {
        for (const field of ['description', 'quantity', 'price']) {
          const input = document.querySelector(`[data-field="${field}"][data-id="${row.id}"]`);
          if (!input || input === document.activeElement) continue;
          const v = row[field];
          input.value = v == null ? '' : v;
        }
        syncQtyZeroFlag(row.id);
      }
    }

    // An empty bid points at the two ways in and keeps the zeroed summary out
    // of the way; the moment a row is described (or the last one is cleared)
    // that flips, without a render interrupting the typing.
    function syncFirstRunHint() {
      const hasContent = TakeoffState.getFlattenedItems().some((i) => (i.description || '').trim());
      const hintEl = document.getElementById('manifest-first-run-hint');
      if (hintEl) hintEl.hidden = hasContent;
      document.getElementById('manifest-below')?.classList.toggle('manifest-empty-hide', !hasContent);
    }

    function handleFieldUpdate(e) {
      const id = e.target.dataset.id;
      const field = e.target.dataset.field;
      // A count, an hours figure and a price are all ≥ 0. Correcting on
      // change (not on every keystroke) leaves a typed minus sign alone until
      // the value is committed.
      if (e.type !== 'input' && ['quantity', 'labor', 'price'].includes(field)) clampNonNegative(e.target);
      let value = e.target.value;
      if (field === 'quantity' || field === 'labor') value = parseFloat(value) || 0;
      if (field === 'price') value = value === '' ? null : (parseFloat(value) ?? null);
      const updates = { [field]: value };
      if (field === 'unit') {
        // unit changes re-render the row (px flag, step) and the totals
        TakeoffState.updateItem(id, updates);
        TakeoffApp.render();
        return;
      }
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
      if (field === 'description') syncFirstRunHint();
      syncQtyZeroFlag(id);
      if (['quantity', 'price'].includes(field)) syncDerived(id);
      if (['quantity', 'price', 'labor'].includes(field) || updates.quantity !== undefined) updateSummaryOnly();
      else refreshUndoRedo();
    }

    // Enter at the end of a row is how a spreadsheet says "next line": add one
    // and land in it. Never while the type modal is open — that Enter belongs
    // to the dialog.
    function handleFieldKeydown(e) {
      if (e.key !== 'Enter' || e.target.dataset.field !== 'planPage') return;
      if (typeModalIsOpen()) return;
      e.preventDefault();
      addRowAndFocus();
    }

    document.querySelectorAll('[data-field]').forEach((input) => {
      input.addEventListener('change', handleFieldUpdate);
      input.addEventListener('input', handleFieldUpdate);
      input.addEventListener('blur', handleFieldUpdate);
      input.addEventListener('keydown', handleFieldKeydown);
    });

    // The roving group (handleRowButtonKeydown, above): every row button,
    // trash included — it is on the row now, not behind a mode.
    document.querySelectorAll('.manifest-view .row-btn').forEach((btn) => {
      btn.addEventListener('keydown', handleRowButtonKeydown);
    });

    document.querySelectorAll('.manifest-view .book-price-chip').forEach((btn) => {
      btn.addEventListener('click', (e) => applyBookPrice(e.currentTarget.dataset.id));
    });

    document.querySelectorAll('.qty-up-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        const input = document.querySelector(`.qty-cell input[data-field="quantity"][data-id="${id}"]`);
        if (input) {
          const val = parseFloat(input.value) || 0;
          input.value = val + 1;
          TakeoffState.updateItem(id, { quantity: val + 1 });
          syncQtyZeroFlag(id);
          syncDerived(id);
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
          syncQtyZeroFlag(id);
          syncDerived(id);
          updateSummaryOnly();
        }
      });
    });

    // e.currentTarget, never e.target: a click at a button's centre lands on
    // whatever it contains (the <path> inside an icon), and that child carries
    // no data-id. These two work today only because their label is bare text.
    document.querySelectorAll('.select-type-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        TakeoffApp.showTypeModal(e.currentTarget.dataset.id);
      });
    });

    // X12: the chip's text reopens the picker, so re-typing a row is two clicks
    // and never parks its money in Misc on the way. "No type" is at the bottom
    // of the picker, which is where the × used to be.
    document.querySelectorAll('.type-badge-text').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        TakeoffApp.showTypeModal(e.currentTarget.dataset.id);
      });
    });

    document.querySelectorAll('.add-child-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const child = TakeoffState.addItem({ parentId: e.currentTarget.dataset.id, description: '', quantity: 0, labor: 0, planPage: '' });
        TakeoffApp.render();
        document.querySelector(`input[data-field="description"][data-id="${child.id}"]`)?.focus();
      });
    });

    document.querySelectorAll('.type-badge-flow').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        const item = TakeoffState.getItemById(id);
        if (item.type === 'devices') TakeoffApp.navigateToDevice(id);
        else if (item.type === 'conduit') TakeoffApp.navigateToConduit(id);
        else if (item.type === 'wire') TakeoffApp.navigateToWire(id);
      });
    });

    document.querySelectorAll('.remove-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        // the trash is an icon: a click at its centre targets the <path>
        const id = e.currentTarget.dataset.id;
        if (confirm('Remove this item?')) {
          const item = TakeoffState.getItemById(id);
          const wasTopLevel = item && !item.parentId;
          // Deleting the last row and the blank row that replaces it are one
          // action: two frames meant the first Undo brought back an empty
          // table instead of the row that was deleted.
          TakeoffState.beginBatch();
          TakeoffState.removeItem(id);
          if (wasTopLevel && TakeoffState.getTopLevelItems().length === 0) {
            TakeoffState.addItem({ type: null, description: '', quantity: 1, labor: 0, planPage: '', parentId: null });
          }
          TakeoffState.endBatch();
          TakeoffApp.render();
        }
      });
    });
  }

  // Label maps are exported so the PDFs print the same words as the screen.
  return { render, attachListeners, TYPE_LABELS, CHILD_TYPE_LABELS, SUMMARY_LABELS };
})();
