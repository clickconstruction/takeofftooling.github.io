/**
 * Device flow - Boxes, Covers, Conduit, Wire, Screws, Misc.
 */

const TakeoffDeviceView = (function () {
  const TRASH_SVG = TakeoffViewShared.TRASH_SVG;
  // One book door per flow row: PB fills the row in place. The row's own book
  // icon merged the pick into whatever the row already said ("NC POWER
  // SUPPLY&BACK-BOX, CADDY box support") and summed the quantities, so it is gone.

  const DEVICE_SECTIONS = [
    { key: 'outletsAndSwitches', label: 'Outlets and Switches', addLabel: '+ Outlet/Switch' },
    { key: 'boxes', label: 'Boxes', addLabel: '+ Box' },
    { key: 'backBoxSupport', label: 'Back Box Support', addLabel: '+ Back Box Support' },
    { key: 'covers', label: 'Covers', addLabel: '+ Cover' },
    { key: 'conduit', label: 'Conduit', addLabel: '+ Conduit' },
    { key: 'wire', label: 'Wire', addLabel: '+ Wire' },
    { key: 'screws', label: 'Screws', addLabel: '+ Screws' },
    { key: 'misc', label: 'Misc.', addLabel: '+ Misc.' },
  ];

  // One money formatter and one hours formatter for the whole app (js/utils.js):
  // the flow's totals must not print a different number from the summary or the
  // PDF for the same job.
  const money = (n) => TakeoffUtils.formatMoney(n);
  const hours = (n) => TakeoffUtils.formatHours(n);

  function renderSectionRows(sectionKey, rows) {
    return (rows || [])
      .map(
        (r, i) => `
      <tr>
        <td class="labor-book-cell"><button type="button" class="part-book-icon-btn icon-btn" data-section="${sectionKey}" data-index="${i}" title="Fill this row from the Labor and Price Book">Book</button></td>
        <td><input type="text" data-section="${sectionKey}" data-index="${i}" data-field="description" value="${escapeHtml(r.description || '')}" placeholder="Description" /></td>
        <td class="device-qty-cell"><div class="device-qty-wrap"><input type="number" inputmode="decimal" data-section="${sectionKey}" data-index="${i}" data-field="quantity" value="${r.quantity ?? ''}" min="0" /><span class="device-qty-buttons-row"><button type="button" class="btn btn-small device-qty-x2-btn" data-section="${sectionKey}" data-index="${i}" title="Multiply by 2">×2</button><button type="button" class="btn btn-small device-qty-div2-btn" data-section="${sectionKey}" data-index="${i}" title="Divide by 2">/2</button></span></div></td>
        <td><input type="number" inputmode="decimal" data-section="${sectionKey}" data-index="${i}" data-field="labor" value="${r.labor !== undefined ? r.labor : ''}" min="0" step="0.1" /></td>
        <td><input type="number" inputmode="decimal" data-section="${sectionKey}" data-index="${i}" data-field="price" value="${r.price ?? ''}" min="0" step="0.01" dir="ltr" placeholder="Price" /></td>
        <td><button type="button" class="remove-child-btn icon-btn" data-section="${sectionKey}" data-index="${i}" title="Remove">${TRASH_SVG}</button></td>
      </tr>
    `
      )
      .join('');
  }

  // A row only counts once the user gave it substance — the same rule the
  // save, the assembly and the totals use, so a row opened and left blank
  // never reaches the bid. Quantity is deliberately ignored: every new row is
  // seeded with the run count.
  function isMeaningfulRow(r) {
    return (r.description || '').trim() !== '' || (parseFloat(r.labor) || 0) > 0 || (parseFloat(r.price) || 0) > 0;
  }

  function countMeaningfulRows(tempData) {
    let n = 0;
    for (const s of DEVICE_SECTIONS) {
      for (const r of (tempData && tempData[s.key]) || []) if (isMeaningfulRow(r)) n++;
    }
    return n;
  }

  // The buffer as it stood before the last "Load into Ledger", so the note can
  // offer "Undo load". Survives the render the load triggers; the next render
  // clears the note with it.
  let preLoadBuffer = null;

  // The saved recipe as it stood before the last "Update from this run", so
  // the note can offer "Undo update". Assemblies are not the manifest, so app
  // undo never reaches them.
  let preUpdateAssembly = null;

  // Component quantities are totals for the whole line, so a saved assembly
  // stores each row as a per-run ratio (qty ÷ the run count it was saved from)
  // and load multiplies it back up. Parts are whole things: round UP, or a
  // "1 support per 20 runs" recipe would land on the purchase list as 0.4.
  function toPerRunRatio(qty, sourceQty) {
    const q = parseFloat(qty) || 0;
    if (!(sourceQty > 0)) return q;
    return Math.round((q / sourceQty) * 10000) / 10000;
  }

  function fromPerRunRatio(ratio, targetQty) {
    const r = parseFloat(ratio) || 0;
    if (r <= 0) return 0;
    return Math.ceil(r * (Number(targetQty) || 0));
  }

  // The current flow buffer as a recipe: rows with substance only, each
  // quantity turned into a per-run ratio when the line has a run count. Shared
  // by "Save as an assembly →" and "Update from this run", so re-recording a
  // saved recipe cannot drift from what a first save would have written.
  function recipeSections(temp, sourceQty) {
    const perRun = sourceQty > 0;
    const sections = {};
    for (const s of DEVICE_SECTIONS) {
      // Only rows the estimator gave substance to: a blank row per empty
      // section was stored, listed on the card and loaded back out again.
      const rows = ((temp && temp[s.key]) || []).filter(isMeaningfulRow).map((r) => ({
        description: r.description,
        quantity: perRun ? toPerRunRatio(r.quantity, sourceQty) : r.quantity,
        labor: r.labor,
        price: r.price,
      }));
      if (rows.length) sections[s.key] = rows;
    }
    return sections;
  }

  // Extended (whole-line) totals of one saved assembly, plus how many rows
  // carry anything. For a per-run assembly these read "per run".
  function assemblyTotals(a) {
    let price = 0;
    let labor = 0;
    let parts = 0;
    for (const s of DEVICE_SECTIONS) {
      for (const r of (a.sections && a.sections[s.key]) || []) {
        if (!isMeaningfulRow(r)) continue;
        parts++;
        const q = parseFloat(r.quantity) || 0;
        price += q * (parseFloat(r.price) || 0);
        labor += q * (parseFloat(r.labor) || 0);
      }
    }
    return { price, labor, parts };
  }

  // Extended totals (qty × per-unit), the numbers that actually hit the bid.
  function getCumulativeChildTotals(tempData) {
    let qty = 0;
    let labor = 0;
    let price = 0;
    for (const s of DEVICE_SECTIONS) {
      for (const r of tempData[s.key] || []) {
        if (!isMeaningfulRow(r)) continue;
        const q = parseFloat(r.quantity) || 0;
        qty += q;
        labor += q * (parseFloat(r.labor) || 0);
        price += q * (parseFloat(r.price) || 0);
      }
    }
    return { qty, labor, price };
  }

  function render(itemId) {
    const item = TakeoffState.getItemById(itemId);
    if (!item) return '';

    const tempData = TakeoffState.getDeviceTempData();
    const runCount = Number(item.quantity) || 0;
    // Component quantities are totals for the whole line, never per run — say
    // so in the column head instead of leaving the estimator to guess.
    const qtyHeader = runCount > 1 ? `Quantity (all ${runCount} runs)` : 'Quantity';

    // A section with no rows is a chip, not a table: eight empty tables were
    // ~1,200 px of nothing at 1440 and ~1,900 px on one column, and five of
    // the eight stay empty on a normal run. Every section name is still on
    // screen, one click from its table.
    const usedSections = DEVICE_SECTIONS.filter((s) => (tempData[s.key] || []).length > 0);
    const emptySections = DEVICE_SECTIONS.filter((s) => !(tempData[s.key] || []).length);

    const chipsHtml = emptySections.length
      ? `<div class="device-section-chips">${emptySections
          .map(
            (s) =>
              `<button type="button" class="btn btn-secondary btn-small add-device-section-chip add-device-section-btn" data-section="${s.key}">${s.addLabel}</button>`
          )
          .join('')}</div>`
      : '';

    const sectionsHtml = usedSections
      .map(
        (s) => `
        <div class="flow-section">
          <h3>${s.label}</h3>
          <div class="flow-table-scroll"><table>
            <thead><tr><th></th><th>Description</th><th>${escapeHtml(qtyHeader)}</th><th>Labor</th><th>Price</th><th></th></tr></thead>
            <tbody>${renderSectionRows(s.key, tempData[s.key])}</tbody>
          </table></div>
          <div class="flow-section-add"><button type="button" class="btn add-device-section-btn" data-section="${s.key}">${s.addLabel}</button></div>
        </div>
      `
      )
      .join('');

    const assembliesList = TakeoffState.getAssemblies();
    const assembliesHtml = `
      <div class="assemblies-section assemblies-section-collapsed" id="assemblies-section">
        <h3 class="assemblies-section-header">
          <span class="assemblies-chevron"></span>Assemblies
          <select id="assemblies-select" class="assemblies-select" ${assembliesList.length ? '' : 'disabled'}>${assembliesList.length ? assembliesList.map((a) => `<option value="${a.id}">${escapeHtml(a.name || 'Unnamed')}</option>`).join('') : '<option value="">-- No assemblies --</option>'}</select>
          <button type="button" class="btn btn-secondary assemblies-load-btn" id="assemblies-load-btn" ${assembliesList.length ? '' : 'disabled'}>Load into Ledger</button>
        </h3>
        <div class="assemblies-section-body">
          ${assembliesList.length === 0 ? '<p class="assemblies-empty">No assemblies saved. Fill in the sections below and click "Save as an assembly →" to keep them for another run.</p>' : assembliesList.map((a) => {
            const perRun = a.perRun === true;
            const t = assemblyTotals(a);
            const parts = `${t.parts} part${t.parts === 1 ? '' : 's'}`;
            const summary = perRun
              ? `$${money(t.price)} per run · ${hours(t.labor)} hrs per run · ${parts}`
              : `$${money(t.price)} total · ${hours(t.labor)} hrs · ${parts} — saved as totals`;
            const summaryTitle = perRun
              ? 'Material and labor for one run — load multiplies by this line’s run count'
              : `Totals saved from a ${a.sourceQty || 'different'}-run line — check the counts after loading`;
            return `
            <div class="assembly-card assembly-card-collapsed" data-assembly-id="${a.id}">
              <h4 class="assembly-card-header"><span class="assemblies-chevron"></span>${escapeHtml(a.name || 'Unnamed')} <span class="assembly-card-price" title="${escapeHtml(summaryTitle)}">${escapeHtml(summary)}</span></h4>
              <div class="assembly-card-body">
                ${DEVICE_SECTIONS.map((s) => {
                  // blank seed rows used to list as "- × 1 | Labor: 0 | Price:"
                  const rows = ((a.sections && a.sections[s.key]) || []).filter(isMeaningfulRow);
                  if (rows.length === 0) return '';
                  return `<div class="assembly-subsection"><strong>${s.label}</strong><ul>${rows.map((r) => `<li>${escapeHtml(r.description || '-')} × ${r.quantity ?? 0}${perRun ? ' per run' : ''} · ${hours(r.labor)} hrs${r.price != null && r.price !== '' ? ` · $${money(r.price)}` : ''}</li>`).join('')}</ul></div>`;
                }).join('')}
                <div class="assembly-card-actions">
                  <button type="button" class="btn btn-small assembly-load-btn" data-assembly-id="${a.id}">Load into Ledger</button>
                  <button type="button" class="btn btn-small btn-secondary assembly-update-btn" data-assembly-id="${a.id}" title="Replace this recipe's parts with the ones on this run">Update from this run</button>
                  <button type="button" class="btn btn-small btn-secondary assembly-rename-btn" data-assembly-id="${a.id}">Rename</button>
                  <button type="button" class="btn btn-link assembly-delete-btn icon-btn" data-assembly-id="${a.id}" title="Delete assembly">${TRASH_SVG}</button>
                </div>
                <div class="inline-name-row assembly-rename-row" data-assembly-id="${a.id}" hidden>
                  <input type="text" class="assembly-rename-input" value="${escapeHtml(a.name || '')}" placeholder="Assembly name" autocomplete="off" />
                  <button type="button" class="btn btn-success assembly-rename-save" data-assembly-id="${a.id}">Save name</button>
                </div>
              </div>
            </div>
          `;
          }).join('')}
        </div>
      </div>
    `;

    return `
      <div class="flow-page device-flow">
        <div class="device-header-row">
          <h2>${escapeHtml((item.description || '').trim() || 'Untitled run')} — parts</h2>
          <button type="button" class="btn btn-secondary" id="device-save-assembly-btn" title="Keeps these parts as a reusable recipe for other runs — nothing reaches the bid">Save as an assembly →</button>
        </div>
        <div class="inline-name-row device-assembly-name-row" id="device-assembly-name-row" hidden>
          <input type="text" id="device-assembly-name" placeholder="Assembly name" autocomplete="off" />
          <button type="button" class="btn btn-success" id="device-assembly-name-save">Save assembly</button>
        </div>
        ${assembliesHtml}
        <div class="flow-note" id="device-flow-note" hidden></div>
        <div class="device-summary-row">
          <div class="parent-summary">
            <div class="parent-summary-line"><strong>Parent:</strong> ${escapeHtml(item.description || '')}</div>
            <div class="parent-summary-line">Quantity: ${item.quantity ?? 0}</div>
          </div>
          <div class="child-summary">
            <div class="parent-summary-line"><strong>Components (extended):</strong></div>
            <div class="parent-summary-line">Labor: <span id="device-cum-labor">0.00</span> hrs</div>
            <div class="parent-summary-line">Price: $<span id="device-cum-price">0.00</span><span id="device-cum-per-run"></span></div>
            <div class="parent-summary-line device-labor-rollup" id="device-labor-rollup"></div>
          </div>
        </div>
        ${chipsHtml}
        <div class="device-sections">
        ${sectionsHtml}
        </div>
        <div class="flow-actions">
          <button type="button" class="btn btn-secondary" id="device-cancel-btn">Cancel</button>
          <button type="button" class="btn btn-success" id="device-save-btn">Save parts to the bid</button>
        </div>
      </div>
    `;
  }

  function escapeHtml(str) {
    return TakeoffUtils.escapeHtml(str);
  }

  function attachListeners(itemId) {
    const item = TakeoffState.getItemById(itemId);
    if (!item) return;
    const runCount = Number(item.quantity) || 0;

    // A one-line message under the assemblies bar (what a Load or an assembly
    // edit just did). Cleared for free by the next render. `undo` is
    // `{id, label, run}` and hangs one way back off the note — a load replaces
    // every section and an update overwrites a saved recipe, and neither is
    // reachable by app undo (the flow is a temp buffer; assemblies are not the
    // manifest), so the way back has to be on screen.
    function showFlowNote(msg, undo) {
      const el = document.getElementById('device-flow-note');
      if (!el) return;
      el.textContent = msg || '';
      if (msg && undo) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-link device-undo-load-btn';
        btn.id = undo.id;
        btn.textContent = undo.label;
        btn.addEventListener('click', undo.run);
        el.appendChild(btn);
      }
      el.hidden = !msg;
    }

    function undoLoad() {
      if (!preLoadBuffer) return;
      TakeoffState.setDeviceTempData(preLoadBuffer);
      preLoadBuffer = null;
      TakeoffState.setFlowDirty(true);
      TakeoffApp.render();
      showFlowNote('Load undone — the parts that were here are back.');
    }

    // Patch the totals panel in place (runs on every keystroke — no
    // re-render, so focus is never disturbed). Also shows the labor rollup:
    // the parent row keeps its own run labor, components add theirs.
    function updateCumulativePanel() {
      const t = getCumulativeChildTotals(TakeoffState.getDeviceTempData());
      const set = (id, v) => {
        const el = document.getElementById(id);
        if (el) el.textContent = v;
      };
      set('device-cum-labor', hours(t.labor));
      set('device-cum-price', money(t.price));
      // The components panel is an extended (whole-line) figure; show what one
      // run costs beside it so neither reading has to be guessed.
      set('device-cum-per-run', runCount > 1 ? ` — $${money(t.price / runCount)} per run` : '');
      const parentLabor = (Number(item.labor) || 0) * (Number(item.quantity) || 0);
      set('device-labor-rollup', parentLabor > 0
        ? `Job labor: parent ${hours(parentLabor)} + components ${hours(t.labor)} = ${hours(parentLabor + t.labor)} hrs`
        : '');
    }
    updateCumulativePanel();

    document.getElementById('device-cancel-btn')?.addEventListener('click', () => {
      TakeoffApp.navigateToManifest(); // asks first when there are unsaved edits
    });

    // Component quantities are totals for the whole line, so a new row starts
    // at the line's run count — the number that makes the seeded row correct.
    const parentQty = item.quantity ?? 0;
    document.querySelectorAll('.add-device-section-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const section = e.currentTarget.dataset.section;
        const temp = TakeoffState.getDeviceTempData();
        temp[section] = temp[section] || [];
        temp[section].push({ description: '', quantity: parentQty, labor: 0, price: '' });
        const index = temp[section].length - 1;
        TakeoffState.setDeviceTempData(temp);
        TakeoffState.setFlowDirty(true);
        TakeoffApp.render();
        // the point of "+ Box" is to type a box: land in the new description
        document
          .querySelector(`input[data-section="${section}"][data-index="${index}"][data-field="description"]`)
          ?.focus();
      });
    });

    document.querySelectorAll('.part-book-icon-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const section = e.currentTarget.dataset.section;
        const index = parseInt(e.currentTarget.dataset.index, 10);
        TakeoffApp.showPartBookSearchForDeviceRow(section, index);
      });
    });

    document.querySelectorAll('.device-qty-x2-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const section = e.currentTarget.dataset.section;
        const index = parseInt(e.currentTarget.dataset.index, 10);
        const temp = TakeoffState.getDeviceTempData();
        const row = temp[section]?.[index];
        if (!row) return;
        const q = parseFloat(row.quantity) || 0;
        row.quantity = Math.round(q * 2 * 100) / 100;
        TakeoffState.setDeviceTempData(temp);
        TakeoffState.setFlowDirty(true);
        TakeoffApp.render();
      });
    });

    document.querySelectorAll('.device-qty-div2-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const section = e.currentTarget.dataset.section;
        const index = parseInt(e.currentTarget.dataset.index, 10);
        const temp = TakeoffState.getDeviceTempData();
        const row = temp[section]?.[index];
        if (!row) return;
        const q = parseFloat(row.quantity) || 0;
        row.quantity = Math.max(0, Math.round((q / 2) * 100) / 100);
        TakeoffState.setDeviceTempData(temp);
        TakeoffState.setFlowDirty(true);
        TakeoffApp.render();
      });
    });

    document.querySelectorAll('.remove-child-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const section = e.currentTarget.dataset.section;
        const index = parseInt(e.currentTarget.dataset.index, 10);
        const temp = TakeoffState.getDeviceTempData();
        if (!temp[section]) return;
        // Emptying a section folds it back to its chip; it used to re-seed a
        // blank row, which read as "the delete didn't take".
        temp[section].splice(index, 1);
        TakeoffState.setDeviceTempData(temp);
        TakeoffState.setFlowDirty(true);
        TakeoffApp.render();
      });
    });

    // Commit to the buffer on every keystroke and live-update the totals panel
    // in place. Nothing here re-renders: a render on `change` rebuilds the DOM
    // under the pointer, so the first click after typing (Save, + Box, PB,
    // trash, ×2) landed on a node that no longer existed and was swallowed.
    function commitFieldToBuffer(e) {
      const section = e.target.dataset.section;
      const index = parseInt(e.target.dataset.index, 10);
      const field = e.target.dataset.field;
      let value = e.target.value;
      if (field === 'quantity' || field === 'labor') value = parseFloat(value) || 0;
      if (field === 'price') value = value === '' ? '' : (parseFloat(value) ?? '');
      const temp = TakeoffState.getDeviceTempData();
      if (!temp[section][index]) return;
      temp[section][index][field] = value;
      TakeoffState.setDeviceTempData(temp);
      TakeoffState.setFlowDirty(true);
      updateCumulativePanel();
    }

    document.querySelectorAll('[data-section][data-index][data-field]').forEach((input) => {
      input.addEventListener('input', commitFieldToBuffer);
      input.addEventListener('change', commitFieldToBuffer);
    });

    function saveAssemblyAs(name) {
      const temp = TakeoffState.getDeviceTempData();
      // An assembly is a recipe, not a snapshot: store each row per run so the
      // preset lands correctly on a line with a different count. A line with no
      // run count has no ratio to take, so it saves as totals (legacy shape).
      const sourceQty = runCount;
      const perRun = sourceQty > 0;
      TakeoffState.addAssembly({ name, sections: recipeSections(temp, sourceQty), perRun, sourceQty });
      TakeoffApp.render();
      showFlowNote(perRun
        ? `Saved "${name}" as a per-run recipe from this ${sourceQty}-run line.`
        : `Saved "${name}" as totals — this line has no run count, so check the quantities after loading it.`);
    }
    const assemblyNameRow = document.getElementById('device-assembly-name-row');
    const assemblyNameInput = document.getElementById('device-assembly-name');
    document.getElementById('device-save-assembly-btn')?.addEventListener('click', () => {
      if (!assemblyNameRow) return;
      assemblyNameRow.hidden = !assemblyNameRow.hidden;
      if (!assemblyNameRow.hidden) assemblyNameInput?.focus();
    });
    const confirmAssemblyName = () => {
      const name = (assemblyNameInput?.value || '').trim();
      if (!name) {
        assemblyNameInput?.focus();
        return;
      }
      saveAssemblyAs(name);
    };
    document.getElementById('device-assembly-name-save')?.addEventListener('click', confirmAssemblyName);
    // No Cancel here: the page already carries one (the flow's own), meaning
    // something else. Escape, or the button that opened the row, closes it.
    assemblyNameInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') confirmAssemblyName();
      if (e.key === 'Escape' && assemblyNameRow) assemblyNameRow.hidden = true;
    });

    document.getElementById('assemblies-section')?.querySelector('.assemblies-section-header')?.addEventListener('click', (e) => {
      if (e.target.closest('.assemblies-load-btn') || e.target.closest('.assemblies-select')) return;
      document.getElementById('assemblies-section')?.classList.toggle('assemblies-section-collapsed');
    });

    document.getElementById('assemblies-load-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const select = document.getElementById('assemblies-select');
      const id = select?.value;
      if (!id) return;
      loadAssemblyIntoDevice(id);
    });

    document.getElementById('assemblies-select')?.addEventListener('click', (e) => e.stopPropagation());
    document.getElementById('assemblies-select')?.addEventListener('change', (e) => e.stopPropagation());

    document.querySelectorAll('.assembly-card-header').forEach((h) => {
      h.addEventListener('click', (e) => {
        if (e.target.closest('.assembly-load-btn') || e.target.closest('.assembly-delete-btn')) return;
        h.closest('.assembly-card')?.classList.toggle('assembly-card-collapsed');
      });
    });

    // Saving, renaming, re-recording or deleting an assembly never calls
    // setFlowDirty: the assemblies list is a side cabinet of recipes, not the
    // bid, so none of it is an unsaved edit to this run. Cancel therefore
    // leaves without a guard after any of them — and rightly so, because the
    // change is already written to the assemblies store, not waiting on Save.
    // The one thing a Cancel could lose is the flow buffer itself, and the
    // guard for that is unchanged (navigateToManifest asks when the buffer is
    // dirty). "Undo update" is the way back for a recipe, not Cancel.
    document.querySelectorAll('.assembly-delete-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm('Delete this assembly?')) return;
        TakeoffState.removeAssembly(e.currentTarget.dataset.assemblyId);
        TakeoffApp.render();
      });
    });

    // Re-record a saved recipe from what is on this run. The per-run rule is
    // the same one a first save uses (recipeSections), so a recipe saved from
    // a 20-run line and updated from an 8-run line still holds ratios.
    document.querySelectorAll('.assembly-update-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = e.currentTarget.dataset.assemblyId;
        const a = TakeoffState.getAssemblies().find((x) => x.id === id);
        if (!a) return;
        const temp = TakeoffState.getDeviceTempData();
        const parts = countMeaningfulRows(temp);
        if (!parts) {
          // overwriting a recipe with nothing is never what was meant
          showFlowNote('Nothing on this run to record — put a part on the page first.');
          return;
        }
        const name = a.name || 'Unnamed';
        preUpdateAssembly = JSON.parse(JSON.stringify(a));
        TakeoffState.updateAssembly(id, recipeSections(temp, runCount), runCount);
        TakeoffApp.render();
        showFlowNote(
          runCount > 0
            ? `Updated "${name}" from this run — ${parts} part${parts === 1 ? '' : 's'}, kept per run from this ${runCount}-run line.`
            : `Updated "${name}" from this run — ${parts} part${parts === 1 ? '' : 's'}, saved as totals because this line has no run count.`,
          { id: 'device-undo-update-btn', label: 'Undo update', run: undoAssemblyUpdate }
        );
      });
    });

    function undoAssemblyUpdate() {
      if (!preUpdateAssembly) return;
      const prev = preUpdateAssembly;
      preUpdateAssembly = null;
      // put the whole previous object back, flags and all: a recipe that was
      // saved as totals must not come back wearing a per-run flag
      TakeoffState.setAssemblies(TakeoffState.getAssemblies().map((x) => (x.id === prev.id ? prev : x)));
      TakeoffApp.render();
      showFlowNote(`Update undone — "${prev.name || 'Unnamed'}" is back to what it held.`);
    }

    document.querySelectorAll('.assembly-rename-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const row = e.currentTarget.closest('.assembly-card')?.querySelector('.assembly-rename-row');
        if (!row) return;
        row.hidden = !row.hidden;
        if (!row.hidden) {
          const input = row.querySelector('.assembly-rename-input');
          input?.focus();
          input?.select();
        }
      });
    });

    function confirmRename(fromEl) {
      const row = fromEl.closest('.assembly-rename-row');
      const input = row?.querySelector('.assembly-rename-input');
      const id = row?.dataset.assemblyId;
      const name = (input?.value || '').trim();
      if (!id || !name) {
        input?.focus();
        return;
      }
      const before = (TakeoffState.getAssemblies().find((x) => x.id === id) || {}).name || 'Unnamed';
      if (!TakeoffState.renameAssembly(id, name)) {
        row.hidden = true; // same name, or gone — nothing to say
        return;
      }
      TakeoffApp.render();
      showFlowNote(`Renamed "${before}" to "${name}".`);
    }

    document.querySelectorAll('.assembly-rename-save').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        confirmRename(e.currentTarget);
      });
    });

    document.querySelectorAll('.assembly-rename-input').forEach((input) => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          confirmRename(e.currentTarget);
        }
        if (e.key === 'Escape') {
          const row = e.currentTarget.closest('.assembly-rename-row');
          if (row) row.hidden = true;
        }
      });
    });

    document.querySelectorAll('.assembly-load-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        loadAssemblyIntoDevice(e.currentTarget.dataset.assemblyId);
      });
    });

    function loadAssemblyIntoDevice(assemblyId) {
      const assemblies = TakeoffState.getAssemblies();
      const a = assemblies.find((x) => x.id === assemblyId);
      if (!a || !a.sections) return;
      const perRun = a.perRun === true;
      // A load replaces every section, so keep what was here: the flow is a
      // temp buffer that app undo never sees.
      const before = TakeoffState.getDeviceTempData();
      preLoadBuffer = JSON.parse(JSON.stringify(before || {}));
      const replaced = countMeaningfulRows(before);
      const temp = {};
      for (const s of DEVICE_SECTIONS) {
        // legacy assemblies carry a blank seed row per section — drop it. Every
        // key is written: setDeviceTempData merges, so a missing one would
        // leave the section that was here on screen.
        const rows = (a.sections[s.key] || []).filter(isMeaningfulRow);
        temp[s.key] = rows.map((r) => ({ ...r, quantity: perRun ? fromPerRunRatio(r.quantity, runCount) : r.quantity }));
      }
      TakeoffState.setDeviceTempData(temp);
      TakeoffState.setFlowDirty(true);
      TakeoffApp.render();
      const what = perRun
        ? `Loaded "${a.name || 'Unnamed'}" — quantities set for ${runCount} run${runCount === 1 ? '' : 's'}.`
        : `Loaded "${a.name || 'Unnamed'}" — saved as totals for ${a.sourceQty ? `a ${a.sourceQty}-run line` : 'another line'}, so check the quantities.`;
      showFlowNote(
        replaced ? `${what} Replaced ${replaced} part${replaced === 1 ? '' : 's'} already here.` : what,
        replaced > 0 && preLoadBuffer ? { id: 'device-undo-load-btn', label: 'Undo load', run: undoLoad } : null
      );
    }

    document.getElementById('device-save-btn')?.addEventListener('click', () => {
      const temp = TakeoffState.getDeviceTempData();
      const allTypes = ['outletsAndSwitches', 'box', 'backBoxSupport', 'cover', 'conduit', 'wire', 'screws', 'misc'];
      const sectionToType = { outletsAndSwitches: 'outletsAndSwitches', boxes: 'box', backBoxSupport: 'backBoxSupport', covers: 'cover', conduit: 'conduit', wire: 'wire', screws: 'screws', misc: 'misc' };
      const defaultLabels = { outletsAndSwitches: 'Outlets and Switches', box: 'Box', backBoxSupport: 'Back Box Support', cover: 'Cover', conduit: 'Conduit', wire: 'Wire', screws: 'Screws', misc: 'Misc.' };

      // A row is junk unless the user gave it a description, labor, or price;
      // quantity alone carries no information.
      const desired = [];
      for (const s of DEVICE_SECTIONS) {
        const type = sectionToType[s.key];
        for (const r of (temp[s.key] || []).filter(isMeaningfulRow)) {
          desired.push({
            type,
            description: r.description || defaultLabels[type],
            quantity: r.quantity || 0,
            labor: r.labor || 0,
            price: r.price != null && r.price !== '' ? (parseFloat(r.price) || null) : null,
            // a row filled from the book watches that book row (X1)
            book: r.book || null,
          });
        }
      }

      const parent = TakeoffState.getItemById(itemId);
      const existing = (parent?.children || []).filter((c) => allTypes.includes(c.type));
      const num = (v) => (v == null || v === '' ? null : Number(v));
      const sameAsSaved =
        existing.length === desired.length &&
        desired.every((d, i) => {
          const c = existing[i];
          return (
            c.type === d.type &&
            (c.description || '') === d.description &&
            (Number(c.quantity) || 0) === (Number(d.quantity) || 0) &&
            (Number(c.labor) || 0) === (Number(d.labor) || 0) &&
            num(c.price) === num(d.price) &&
            // the book reference is part of what a save writes (X1)
            JSON.stringify((c.meta && c.meta.book) || null) === JSON.stringify(d.book || null)
          );
        });

      // Nothing changed: writing anyway pushed an undo frame that undoes
      // nothing and handed every child a new id (breaking any reference to it).
      if (sameAsSaved) {
        TakeoffState.setFlowDirty(false);
        TakeoffApp.navigateToManifest();
        return;
      }

      // A row that survived the edit keeps its id, so only what actually
      // changed looks changed.
      const idPool = existing.map((c) => ({ id: c.id, type: c.type, description: c.description || '' }));
      const takeId = (d) => {
        const at = idPool.findIndex((c) => c.type === d.type && c.description === d.description);
        return at >= 0 ? idPool.splice(at, 1)[0].id : TakeoffState.generateId();
      };

      TakeoffState.beginBatch(); // one undo frame per save
      if (parent) {
        parent.children = (parent.children || []).filter((c) => !allTypes.includes(c.type));
      }
      for (const d of desired) {
        TakeoffState.addItem({
          id: takeId(d),
          type: d.type,
          description: d.description,
          quantity: d.quantity,
          labor: d.labor,
          price: d.price,
          parentId: itemId,
          meta: d.book ? { book: d.book } : null,
        });
      }

      TakeoffState.endBatch();
      TakeoffEvents.log('flow_saved', { kind: 'device', rows: desired.length, componentPrice: desired.some((d) => d.price != null) });
      TakeoffState.setFlowDirty(false);
      TakeoffApp.navigateToManifest();
    });
  }

  return { render, attachListeners };
})();
