/**
 * Wire flow - Overage and optional MAC Adapters
 */

const TakeoffWireView = (function () {
  function escapeHtml(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function render(itemId) {
    const item = TakeoffState.getItemById(itemId);
    if (!item) return '';

    const temp = TakeoffState.getWireTempData();
    const baseLength = item.quantity || 0;
    const overagePercent = temp.overagePercent ?? null;
    const additional = overagePercent != null ? Math.ceil(baseLength * (overagePercent / 100)) : 0;
    const totalQty = baseLength + additional;
    const macAdapters = temp.macAdapters || [];

    const macRows = macAdapters
      .map(
        (m, i) => `
      <tr>
        <td><input type="text" data-mac-index="${i}" data-field="description" value="${escapeHtml(m.description || '')}" placeholder="Description" /></td>
        <td><input type="number" data-mac-index="${i}" data-field="quantity" value="${m.quantity ?? ''}" min="0" /></td>
        <td><input type="number" data-mac-index="${i}" data-field="labor" value="${m.labor !== undefined ? m.labor : ''}" min="0" step="0.1" /></td>
        <td><button type="button" class="remove-mac-btn" data-index="${i}">Remove</button></td>
      </tr>
    `
      )
      .join('');

    return `
      <div class="flow-page wire-flow">
        <h2>Wire - Overage and MAC Adapters</h2>
        <div class="parent-summary">
          <strong>Parent:</strong> ${escapeHtml(item.description || '')} | Current length: ${baseLength}
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
          <label>Overage % <input type="number" id="wire-overage-percent" value="${overagePercent ?? ''}" min="0" max="100" step="1" placeholder="0" /></label>
          <p><strong>Wire quantity:</strong> ${baseLength} + ${additional} additional = <strong>${totalQty}</strong> total</p>
        </div>
        <div class="flow-section">
          <h3>MAC Adapters (optional)</h3>
          <table>
            <thead><tr><th>Description</th><th>Quantity</th><th>Labor</th><th></th></tr></thead>
            <tbody>${macRows}</tbody>
          </table>
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
        document.getElementById('wire-overage-percent').value = percent;
        TakeoffApp.render();
      });
    });

    document.getElementById('wire-overage-percent')?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      TakeoffState.setWireTempData({ overagePercent: isNaN(val) ? null : val });
      TakeoffApp.render();
    });

    document.querySelector('.add-mac-btn')?.addEventListener('click', () => {
      const temp = TakeoffState.getWireTempData();
      temp.macAdapters = temp.macAdapters || [];
      temp.macAdapters.push({ description: '', quantity: 0, labor: 0 });
      TakeoffState.setWireTempData(temp);
      TakeoffApp.render();
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
      });
    });

    document.getElementById('wire-save-btn')?.addEventListener('click', () => {
      const temp = TakeoffState.getWireTempData();
      const parent = TakeoffState.getItemById(itemId);
      if (!parent) return;

      // Remove existing wire children (overage, mac adapters)
      parent.children = (parent.children || []).filter((c) => c.type !== 'overage' && c.type !== 'macAdapter');

      const baseLength = item.quantity || 0;
      const overagePercent = temp.overagePercent ?? 0;
      const additional = Math.ceil(baseLength * (overagePercent / 100));

      if (additional > 0) {
        TakeoffState.addItem({
          id: TakeoffState.generateId(),
          type: 'overage',
          description: `Wire overage (${overagePercent}%)`,
          quantity: additional,
          labor: 0,
          parentId: itemId,
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
            parentId: itemId,
          });
        }
      }

      TakeoffApp.navigateToManifest();
    });
  }

  return { render, attachListeners };
})();
