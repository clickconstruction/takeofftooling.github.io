/**
 * Wire flow - Overage and optional MAC Adapters
 */

const TakeoffWireView = (function () {
  const TRASH_SVG = TakeoffViewShared.TRASH_SVG;

  function escapeHtml(str) {
    return TakeoffUtils.escapeHtml(str);
  }

  // Same rule as everywhere else (2 places at or above $1, 4 below; hours to
  // 2), minus the thousands separators a type=number field would reject.
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

  function render(itemId) {
    // the buffer is hydrated before this first render; from here on every
    // write to it — the labor book's included — counts as an edit
    TakeoffState.endFlowHydration();
    const item = TakeoffState.getItemById(itemId);
    if (!item) return '';

    const temp = TakeoffState.getWireTempData();
    const baseLength = item.quantity || 0;
    const overagePercent = temp.overagePercent ?? null;
    const macAdapters = temp.macAdapters || [];

    const macRows = macAdapters
      .map(
        (m, i) => `
      <tr>
        <td class="labor-book-cell"><button type="button" class="part-book-icon-btn icon-btn" data-mac-index="${i}" title="Fill this row from the Labor and Price Book">Book</button></td>
        <td><input type="text" data-mac-index="${i}" data-field="description" value="${escapeHtml(m.description || '')}" placeholder="Description" /></td>
        <td><input type="number" inputmode="decimal" data-mac-index="${i}" data-field="quantity" value="${escapeHtml(m.quantity ?? '')}" min="0" /></td>
        <td><input type="number" inputmode="decimal" data-mac-index="${i}" data-field="labor" value="${escapeHtml(hoursValue(m.labor))}" min="0" step="0.1" /></td>
        <td><input type="number" inputmode="decimal" data-mac-index="${i}" data-field="price" value="${escapeHtml(moneyValue(m.price))}" min="0" step="0.01" dir="ltr" placeholder="Price" /></td>
        <td><button type="button" class="remove-mac-btn icon-btn" data-index="${i}" title="Remove">${TRASH_SVG}</button></td>
      </tr>
    `
      )
      .join('');

    return `
      <div class="flow-page wire-flow">
        <h2>Wire - Overage and MAC Adapters</h2>
        ${TakeoffViewShared.renderParentSummary(item)}
        ${TakeoffViewShared.renderOverageSection({ inputId: 'wire-overage-percent', noun: 'Wire', baseLength, overagePercent })}
        <div class="flow-section">
          <h3>MAC Adapters (optional)</h3>
          <div class="flow-table-scroll"><table>
            <thead><tr><th></th><th>Description</th><th>Quantity</th><th>Labor</th><th>Price</th><th></th></tr></thead>
            <tbody>${macRows}</tbody>
          </table></div>
          <button type="button" class="btn add-mac-btn">Add MAC Adapter</button>
        </div>
        <div class="flow-actions">
          <button type="button" class="btn btn-secondary" id="wire-cancel-btn">Cancel</button>
          <button type="button" class="btn btn-success" id="wire-save-btn">Save parts to the bid</button>
        </div>
      </div>
    `;
  }

  function attachListeners(itemId) {
    const item = TakeoffState.getItemById(itemId);
    if (!item) return;

    document.getElementById('wire-cancel-btn')?.addEventListener('click', () => {
      TakeoffApp.navigateToManifest();
    });

    document.querySelectorAll('.overage-buttons button').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const percent = parseInt(e.target.dataset.percent, 10);
        TakeoffState.setWireTempData({ overagePercent: percent });
        TakeoffState.setFlowDirty(true);
        document.getElementById('wire-overage-percent').value = percent;
        TakeoffApp.render();
      });
    });

    // typing a custom %: update the buffer and patch the total line in place
    // (a re-render here would steal focus after the first digit)
    document.getElementById('wire-overage-percent')?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      const percent = isNaN(val) ? null : val;
      TakeoffState.setWireTempData({ overagePercent: percent });
      TakeoffState.setFlowDirty(true);
      TakeoffViewShared.updateOverageTotal('wire-overage-percent', 'Wire', item.quantity || 0, percent);
    });

    document.querySelector('.add-mac-btn')?.addEventListener('click', () => {
      const temp = TakeoffState.getWireTempData();
      temp.macAdapters = temp.macAdapters || [];
      temp.macAdapters.push({ description: '', quantity: 0, labor: 0, price: '' });
      TakeoffState.setWireTempData(temp);
      TakeoffState.setFlowDirty(true);
      TakeoffApp.render();
    });

    document.querySelectorAll('.part-book-icon-btn[data-mac-index]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.currentTarget.dataset.macIndex, 10);
        TakeoffApp.showPartBookSearchForWireMac(index);
      });
    });

    document.querySelectorAll('.remove-mac-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.dataset.index, 10);
        const temp = TakeoffState.getWireTempData();
        temp.macAdapters = temp.macAdapters || [];
        temp.macAdapters.splice(index, 1);
        if (temp.macAdapters.length === 0) {
          temp.macAdapters.push({ description: '', quantity: 0, labor: 0, price: '' });
        }
        TakeoffState.setWireTempData(temp);
        TakeoffState.setFlowDirty(true);
        TakeoffApp.render();
      });
    });

    document.querySelectorAll('[data-mac-index]').forEach((input) => {
      input.addEventListener('change', (e) => {
        const index = parseInt(e.target.dataset.macIndex, 10);
        const field = e.target.dataset.field;
        let value = e.target.value;
        if (field === 'quantity' || field === 'labor') value = parseFloat(value) || 0;
        if (field === 'price') value = value === '' ? null : (parseFloat(value) ?? null);
        const temp = TakeoffState.getWireTempData();
        if (temp.macAdapters?.[index]) temp.macAdapters[index][field] = value;
        TakeoffState.setWireTempData(temp);
        TakeoffState.setFlowDirty(true);
      });
    });

    document.getElementById('wire-save-btn')?.addEventListener('click', () => {
      const temp = TakeoffState.getWireTempData();
      const parent = TakeoffState.getItemById(itemId);
      if (!parent) return;

      // Remove existing wire children (overage, mac adapters)
      TakeoffState.beginBatch(); // one undo frame per save
      parent.children = (parent.children || []).filter((c) => c.type !== 'overage' && c.type !== 'macAdapter');

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
          description: `Wire overage (${overagePercent}%)`,
          quantity: additional,
          labor: 0,
          price: !isNaN(unitPrice) && unitPrice > 0 ? unitPrice : null,
          parentId: itemId,
          meta: { overagePercent },
        });
      }

      for (const m of temp.macAdapters || []) {
        if (m.description) {
          TakeoffState.addItem({
            id: TakeoffState.generateId(),
            type: 'macAdapter',
            description: m.description,
            quantity: m.quantity || 0,
            labor: m.labor || 0,
            price: m.price !== '' && m.price != null && !isNaN(parseFloat(m.price)) ? parseFloat(m.price) : null,
            parentId: itemId,
            // a MAC adapter filled from the book watches that book row (X1)
            meta: m.book ? { book: m.book } : null,
          });
        }
      }

      TakeoffState.endBatch();
      TakeoffEvents.log('flow_saved', { kind: 'wire', rows: (parent.children || []).length, componentPrice: (parent.children || []).some((c) => c.price != null) });
      TakeoffState.setFlowDirty(false);
      TakeoffApp.navigateToManifest();
    });
  }

  return { render, attachListeners };
})();
