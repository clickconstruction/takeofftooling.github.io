/**
 * Wire flow - Overage and optional MAC Adapters
 */

const TakeoffWireView = (function () {
  const TRASH_SVG = TakeoffViewShared.TRASH_SVG;

  function escapeHtml(str) {
    return TakeoffUtils.escapeHtml(str);
  }

  function render(itemId) {
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
        <td class="labor-book-cell"><button type="button" class="part-book-icon-btn icon-btn" data-mac-index="${i}" title="Part Book Search">PB</button></td>
        <td><input type="text" data-mac-index="${i}" data-field="description" value="${escapeHtml(m.description || '')}" placeholder="Description" /></td>
        <td><input type="number" data-mac-index="${i}" data-field="quantity" value="${m.quantity ?? ''}" min="0" /></td>
        <td><input type="number" data-mac-index="${i}" data-field="labor" value="${m.labor !== undefined ? m.labor : ''}" min="0" step="0.1" /></td>
        <td><button type="button" class="remove-mac-btn icon-btn" data-index="${i}" title="Remove">${TRASH_SVG}</button></td>
      </tr>
    `
      )
      .join('');

    return `
      <div class="flow-page wire-flow">
        <h2>Wire - Overage and MAC Adapters</h2>
        <div class="parent-summary">
          <div class="parent-summary-line"><strong>Parent:</strong> ${escapeHtml(item.description || '')}</div>
          <div class="parent-summary-line">Current length: ${baseLength}</div>
        </div>
        ${TakeoffViewShared.renderOverageSection({ inputId: 'wire-overage-percent', noun: 'Wire', baseLength, overagePercent })}
        <div class="flow-section">
          <h3>MAC Adapters (optional)</h3>
          <div class="flow-table-scroll"><table>
            <thead><tr><th></th><th>Description</th><th>Quantity</th><th>Labor</th><th></th></tr></thead>
            <tbody>${macRows}</tbody>
          </table></div>
          <button type="button" class="btn add-mac-btn">Add MAC Adapter</button>
        </div>
        <div class="flow-actions">
          <button type="button" class="btn btn-secondary" id="wire-cancel-btn">Cancel</button>
          <button type="button" class="btn btn-success" id="wire-save-btn">Save and Back to Manifest</button>
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

    document.getElementById('wire-overage-percent')?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      TakeoffState.setWireTempData({ overagePercent: isNaN(val) ? null : val });
      TakeoffState.setFlowDirty(true);
      TakeoffApp.render();
    });

    document.querySelector('.add-mac-btn')?.addEventListener('click', () => {
      const temp = TakeoffState.getWireTempData();
      temp.macAdapters = temp.macAdapters || [];
      temp.macAdapters.push({ description: '', quantity: 0, labor: 0 });
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
          temp.macAdapters.push({ description: '', quantity: 0, labor: 0 });
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
          });
        }
      }

      TakeoffState.endBatch();
      TakeoffState.setFlowDirty(false);
      TakeoffApp.navigateToManifest();
    });
  }

  return { render, attachListeners };
})();
