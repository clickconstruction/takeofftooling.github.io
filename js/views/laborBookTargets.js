/**
 * Labor & Price Book "apply to takeoff" logic — no rendering.
 *
 * How a picked entry (Parts row, Assemblies entry, Elliot part, or search
 * hit) lands on the current target: a fill-mode row (PB buttons), a device
 * temp row, the conduit fittings list, or a manifest fixture. Consumed by
 * TakeoffLaborBookView, TakeoffLaborBookSearch, TakeoffLaborBookElliot, and
 * McBook. Loaded before js/views/laborBook.js.
 */

const TakeoffLaborBookTargets = (function () {
  // Terse book names ("600a", "1200a") need their section for context;
  // full assembly names already carry it.
  function describeBookRow(name, section) {
    if (section === 'Panels.1PH') return `${name} Panel (1PH)`;
    if (section === 'Panels.3PH') return `${name} Panel (3PH)`;
    if (section === 'THHN CU' || section === 'THW AL') return `${section} ${name}`;
    if (section.startsWith('Cable Tray.')) return `${name} Cable Tray (${section.replace('Cable Tray.', '')})`;
    if (section && name.length < 10) return `${name} ${section}`;
    return name;
  }

  /**
   * Add one entry (from Parts rows or Assemblies entries) to the current
   * target: a device temp row, the conduit fittings list, or a manifest
   * fixture (child inherits the parent's quantity). Returns true if added.
   */
  function addEntryToTarget({ description, labor, price }) {
    const applyToEl = document.getElementById('labor-book-apply-to');
    const deviceTargetJson = applyToEl?.dataset.targetDeviceRow;
    const laborHours = Number(labor) || 0;

    // FILL mode: replace the targeted row's fields in place (PB buttons)
    const fill = TakeoffState.getLaborBookFillTarget?.();
    if (fill) {
      const priceNum = price != null && String(price).trim() !== '' ? parseFloat(price) : null;
      if (fill.kind === 'manifest-row') {
        TakeoffState.updateItem(fill.id, { description, labor: laborHours, price: priceNum });
      } else if (fill.kind === 'device-row') {
        const temp = TakeoffState.getDeviceTempData();
        const row = temp[fill.section]?.[fill.index];
        if (!row) return false;
        row.description = description;
        row.labor = laborHours;
        row.price = priceNum != null ? priceNum : '';
        TakeoffState.setDeviceTempData(temp);
      } else if (fill.kind === 'conduit-fitting') {
        const temp = TakeoffState.getConduitTempData();
        const row = (temp.fittings || [])[fill.index];
        if (!row) return false;
        row.description = description;
        row.labor = laborHours;
        row.price = priceNum != null ? priceNum : '';
        TakeoffState.setConduitTempData(temp);
      } else if (fill.kind === 'wire-mac') {
        const temp = TakeoffState.getWireTempData();
        const row = (temp.macAdapters || [])[fill.index];
        if (!row) return false;
        row.description = description;
        row.labor = laborHours;
        if (priceNum != null) row.price = priceNum;
        TakeoffState.setWireTempData(temp);
      } else {
        return false;
      }
      TakeoffApp.render();
      TakeoffApp.hideLaborBookModal();
      return true;
    }
    if (deviceTargetJson) {
      const deviceTarget = JSON.parse(deviceTargetJson);
      const temp = TakeoffState.getDeviceTempData();
      const targetRow = temp[deviceTarget.section]?.[deviceTarget.index];
      if (!targetRow) return false;
      const priceNum = price != null && String(price).trim() !== '' ? parseFloat(price) : null;
      targetRow.description = targetRow.description ? `${targetRow.description}, ${description}` : description;
      targetRow.quantity = (targetRow.quantity || 0) + 1;
      targetRow.labor = (targetRow.labor || 0) + laborHours;
      if (priceNum != null && !isNaN(priceNum)) {
        const existingPrice = targetRow.price != null && targetRow.price !== '' ? parseFloat(targetRow.price) : 0;
        targetRow.price = existingPrice + priceNum;
      }
      TakeoffState.setDeviceTempData(temp);
      TakeoffApp.render();
      return true;
    }
    const targetId = applyToEl?.dataset.targetFixtureId || document.getElementById('labor-book-target-select')?.value;
    if (!targetId) {
      alert('Please select a fixture from "Add to fixture" first.');
      return false;
    }
    if (
      targetId === TakeoffState.getCurrentItemId() &&
      TakeoffState.getCurrentView() === 'conduit' &&
      TakeoffState.getConduitStep() === 2
    ) {
      const temp = TakeoffState.getConduitTempData();
      temp.fittings = temp.fittings || [];
      temp.fittings.push({ description, quantity: 1, labor: laborHours, price: price || '' });
      TakeoffState.setConduitTempData(temp);
    } else {
      // Inherit the parent's quantity: pricing a qty-24 fixture from the book
      // should count 24 units, not 1.
      const parent = TakeoffState.getItemById(targetId);
      const inheritedQty = Number(parent?.quantity) > 0 ? Number(parent.quantity) : 1;
      TakeoffState.addItem({
        parentId: targetId,
        description,
        quantity: inheritedQty,
        labor: laborHours,
        planPage: '',
        type: null,
        price: price,
      });
    }
    TakeoffApp.render();
    return true;
  }

  const round2 = (n) => Math.round(n * 100) / 100;

  function hasFillTarget() {
    return !!TakeoffState.getLaborBookFillTarget?.();
  }

  /**
   * Exploded assembly add: each component lands individually on the target.
   * components: [{description, qty (per assembly unit), labor (hrs/each), price (per each)}]
   * - manifest fixture: one child per component, qty scaled by the fixture qty, single undo frame
   * - conduit fittings: one fittings row per component, qty scaled by the run's footage
   * - device temp row: first component fills the clicked row (if empty) or merges; the rest append as new rows
   * Returns true if added.
   */
  function addComponentsToTarget(components) {
    if (!components || !components.length) return false;
    // FILL mode fills one row: component explosion doesn't apply here
    if (hasFillTarget()) return false;
    const applyToEl = document.getElementById('labor-book-apply-to');
    const deviceTargetJson = applyToEl?.dataset.targetDeviceRow;

    if (deviceTargetJson) {
      const deviceTarget = JSON.parse(deviceTargetJson);
      const temp = TakeoffState.getDeviceTempData();
      const rows = temp[deviceTarget.section];
      const targetRow = rows?.[deviceTarget.index];
      if (!targetRow) return false;
      let insertAt = deviceTarget.index + 1;
      for (let i = 0; i < components.length; i++) {
        const c = components[i];
        const qty = round2(c.qty);
        if (i === 0 && !(targetRow.description || '').trim()) {
          targetRow.description = c.description;
          targetRow.quantity = qty;
          targetRow.labor = c.labor || 0;
          targetRow.price = c.price != null ? round2(Number(c.price)) : '';
        } else {
          rows.splice(insertAt++, 0, {
            description: c.description,
            quantity: qty,
            labor: c.labor || 0,
            price: c.price != null ? round2(Number(c.price)) : '',
          });
        }
      }
      TakeoffState.setDeviceTempData(temp);
      TakeoffApp.render();
      return true;
    }

    const targetId = applyToEl?.dataset.targetFixtureId || document.getElementById('labor-book-target-select')?.value;
    if (!targetId) {
      alert('Please select a fixture from "Add to fixture" first.');
      return false;
    }
    const targetItem = TakeoffState.getItemById(targetId);
    const scale = Number(targetItem?.quantity) > 0 ? Number(targetItem.quantity) : 1;

    if (
      targetId === TakeoffState.getCurrentItemId() &&
      TakeoffState.getCurrentView() === 'conduit' &&
      TakeoffState.getConduitStep() === 2
    ) {
      const temp = TakeoffState.getConduitTempData();
      temp.fittings = temp.fittings || [];
      for (const c of components) {
        temp.fittings.push({ description: c.description, quantity: round2(c.qty * scale), labor: c.labor || 0, price: c.price != null ? String(round2(Number(c.price))) : '' });
      }
      TakeoffState.setConduitTempData(temp);
    } else {
      TakeoffState.beginBatch(); // whole assembly explosion = one undo frame
      for (const c of components) {
        TakeoffState.addItem({
          parentId: targetId,
          description: c.description,
          quantity: round2(c.qty * scale),
          labor: c.labor || 0,
          planPage: '',
          type: null,
          price: c.price != null ? round2(Number(c.price)) : null,
        });
      }
      TakeoffState.endBatch();
    }
    TakeoffApp.render();
    return true;
  }

  return { describeBookRow, addEntryToTarget, addComponentsToTarget, hasFillTarget };
})();
