/**
 * Import from Count Tooling clipboard format
 * Format: fixture\tcount\tpage per line
 * fixture — Item name
 * count — Count or length (number)
 * page — Comma-separated page numbers (e.g. 1, 3, 5)
 * Line types: [unit] of [name] (e.g. ft of Conduit, in of Pipe)
 *
 * Counts are TOTALS, never additions: a line that matches a row already on
 * the bid sets that row to the import's number, up or down. See the
 * "#import= contract" section of docs/ARCHITECTURE.md.
 */

const TakeoffImport = (function () {
  // Dual browser/Node: in the browser TakeoffUtils is a prior <script>;
  // in Node (import.test.js) we require it.
  const utils = typeof TakeoffUtils !== 'undefined' ? TakeoffUtils : require('./utils.js');

  let pendingImportItems = [];
  let lastFocusBeforeModal = null;

  // Types the preview's picker offers, in the type modal's own order.
  const PICKABLE_TYPES = ['gear', 'lighting', 'devices', 'conduit', 'wire', 'specialSystems'];
  const TYPE_LABELS = {
    lighting: 'Lighting',
    gear: 'Gear',
    devices: 'Devices',
    conduit: 'Conduit',
    wire: 'Wire',
    specialSystems: 'Special Systems',
    permits: 'Permits',
    powerCoCharges: 'Power co. charges',
    temporaryPower: 'Temporary power',
  };

  /**
   * Ordered type rules — the first pattern that hits wins, and every term is
   * whole-word. Order carries the meaning: compound gear names that contain a
   * device or lighting word are tested before those words on their own, so
   * "Transfer Switch" is gear while "switch" alone is a device, and "LED Flat
   * Panel" is lighting while "Panel LP-2" is gear. Terms with a known false
   * positive in this trade are deliberately absent (lamp → beam clamp,
   * strip → strip heater, jack → jack chain, meter → voltmeter).
   */
  const TYPE_RULES = [
    ['conduit', /\bof\s+conduit\b|\bwhip\b/],
    ['wire', /\bof\s+wire\b/],
    // gear names that swallow a device/lighting word
    ['gear', /\bswitchgear\b|\bswitchboard\b|\btransfer\s+switch\b|\bdisconnect\b|\bsafety\s+switch\b|\bcontactor\b|\bmcc\b|\bmotor\s+control\b/],
    ['lighting', /\btroffer\b|\bdownlight\b|\bhigh[\s-]?bay\b|\blow[\s-]?bay\b|\bsconce\b|\bexit\b|\bemergency\b|\bwall[\s-]?pack\b|\bpendant\b|\bluminaire\b|\bflat\s+panel\b|\bled\s+panel\b|\bcanopy\b|\bbollard\b|\bflood[\s-]?light\b|\bstrip\s+light\b|\blinear\s+light\b|\bcan\s+light\b|\brecessed\s+can\b|\bvapor[\s-]?tight\b|\blight\s*fixture\b|\blighting\b|\bfixture\b/],
    ['specialSystems', /\bfire\s+alarm\b|\bsmoke\s+detector\b|\bpull\s+station\b|\bstrobe\b|\bnurse\s+call\b|\bcard\s+reader\b|\baccess\s+control\b|\bcctv\b|\bcamera\b|\bdata\s+jack\b|\bdata\s+port\b|\bspeaker\b/],
    ['devices', /\breceptacles?\b|\brecept\b|\brecp\b|\boutlets?\b|\bswitch(es)?\b|\bdimmers?\b|\bgfci\b|\bocc(upancy)?\s+sensor\b|\bvacancy\s+sensor\b|\bphoto\s?cell\b|\btoggle\b|\bquad\b/],
    // generic gear last, so the compounds above win
    ['gear', /\bpanel(board)?\b|\bgear\b|\btransformers?\b|\bxfmr\b|\bbreakers?\b|\bload\s+cent(er|re)\b|\bmeter\s+(socket|base|can)\b|\bct\s+cabinet\b|\bats\b/],
  ];

  function inferType(description) {
    const d = (description || '').trim().toLowerCase();
    if (!d) return null;
    for (const [type, re] of TYPE_RULES) {
      if (re.test(d)) return type;
    }
    return null;
  }

  /**
   * A count the way a spreadsheet or a clipboard hands it over: '1,800',
   * '$1,800.00', '220 ft', 74.8. Returns a finite number, or null when the
   * cell cannot be read as a count — null renders as '× ?' and is never
   * silently turned into 0 or 1.
   */
  function parseCount(raw) {
    if (raw == null) return null;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    const cleaned = String(raw).replace(/[$,\s"'“”]/g, '');
    if (!cleaned) return null;
    const m = cleaned.match(/^(-?\d*\.?\d+)([a-z%]*)$/i);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  }

  // Count Tooling appends 'View link:\t<url>' when its user is signed in.
  // It is a footer, not a fixture — see docs/ARCHITECTURE.md.
  function isViewLinkFooter(cells) {
    return /^view\s+link:?$/i.test(cells[0] || '') && /^https?:\/\//i.test(cells[1] || '');
  }

  // A 'px of …' row means the plan page was never scaled in Count Tooling,
  // so the number is pixels and not feet. We can't fix it here; we can name it.
  function isUnscaled(description) {
    return /^\s*px\s+of\s+/i.test(description || '');
  }

  function parseCountToolingClipboard(text) {
    const lines = String(text == null ? '' : text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const items = [];
    for (const line of lines) {
      const parts = line.split(/\t/).map((p) => p.trim());
      if (parts.length < 2) continue;
      if (isViewLinkFooter(parts)) continue;
      const fixture = parts[0] || '';
      const page = parts[2] || '';
      if (!fixture) continue;
      items.push({
        description: fixture,
        quantity: parseCount(parts[1]),
        labor: null,
        planPage: page,
        type: inferType(fixture),
      });
    }
    return items;
  }

  // One key for "the same fixture", shared with the purchase list.
  function descKey(s) {
    return utils.descKey(s);
  }

  function escapeHtml(str) {
    return utils.escapeHtml(str);
  }

  /**
   * What the primary button is about to do. Pure: takes the import lines and
   * a Map of described manifest rows keyed by descKey. The button label is
   * built from this, so the receipt is on screen before the click.
   */
  function summarizeImport(importItems, manifestByDesc) {
    let updates = 0;
    let adds = 0;
    let matched = 0;
    let unreadable = 0;
    for (const item of importItems) {
      const existing = manifestByDesc.get(descKey(item.description));
      if (!existing) {
        adds++;
        continue;
      }
      matched++;
      if (item.quantity == null) {
        unreadable++;
        continue;
      }
      if (item.quantity !== (Number(existing.quantity) || 0)) updates++;
    }
    return { updates, adds, matched, unreadable, total: importItems.length };
  }

  function plural(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
  }

  function primaryLabel(summary) {
    const parts = [];
    if (summary.updates) parts.push(`Update ${plural(summary.updates, 'count', 'counts')}`);
    if (summary.adds) parts.push(`${parts.length ? 'add' : 'Add'} ${plural(summary.adds, 'fixture', 'fixtures')}`);
    if (!parts.length) return 'Nothing to change';
    return parts.join(' · ');
  }

  // Real (described) manifest rows by normalized description — blank starter
  // rows are noise in the preview and can't be merge targets.
  function getManifestItemsByDesc() {
    const map = new Map();
    for (const i of TakeoffState.getTopLevelItems()) {
      const key = descKey(i.description);
      if (key && !map.has(key)) map.set(key, i);
    }
    return map;
  }

  function renderManifestList(container) {
    const items = TakeoffState.getTopLevelItems().filter((i) => (i.description || '').trim());
    if (items.length === 0) {
      container.innerHTML = '<p class="import-preview-empty">Nothing on the bid yet.</p>';
      return;
    }
    container.innerHTML = items
      .map(
        (i) =>
          `<div class="import-preview-item"><span class="import-preview-desc">${escapeHtml(i.description || '-')}</span> <span class="import-preview-meta">× ${i.quantity ?? 0} ${i.planPage ? '| ' + escapeHtml(i.planPage) : ''}</span></div>`
      )
      .join('');
  }

  function renderTypePicker(item, idx) {
    const current = item.type || '';
    const types = PICKABLE_TYPES.slice();
    if (current && !types.includes(current)) types.push(current);
    const options = ['<option value="">Needs a type</option>']
      .concat(
        types.map(
          (t) =>
            `<option value="${t}"${t === current ? ' selected' : ''}>${escapeHtml(TYPE_LABELS[t] || t)}</option>`
        )
      )
      .join('');
    return `<select class="import-preview-type" data-idx="${idx}" aria-label="Type for ${escapeHtml(item.description || 'this line')}">${options}</select>`;
  }

  function renderImportList(container, importItems, manifestByDesc) {
    if (importItems.length === 0) {
      container.innerHTML = '<p class="import-preview-empty">No import items.</p>';
      return;
    }
    container.innerHTML = importItems
      .map((item, idx) => {
        const existing = manifestByDesc.get(descKey(item.description));
        const badge = existing ? '' : '<span class="import-preview-badge import-preview-badge-new">new</span>';
        const count = item.quantity == null ? '?' : item.quantity;
        // for an existing item, the decision is the delta — show it, in both
        // directions, because counts are totals
        let delta = '';
        if (existing) {
          const have = Number(existing.quantity) || 0;
          if (item.quantity == null) {
            delta = ` <span class="import-preview-delta">count not read — keeping ${have}</span>`;
          } else if (item.quantity > have) {
            delta = ` <span class="import-preview-delta">was ${have}, +${item.quantity - have}</span>`;
          } else if (item.quantity < have) {
            delta = ` <span class="import-preview-delta">was ${have}, −${have - item.quantity}</span>`;
          } else {
            delta = ` <span class="import-preview-delta">already ${have}</span>`;
          }
          const page = (item.planPage || '').trim();
          const hadPage = (existing.planPage || '').trim();
          if (page && page !== hadPage) {
            delta += ` <span class="import-preview-delta">· page ${escapeHtml(page)}${hadPage ? `, was ${escapeHtml(hadPage)}` : ''}</span>`;
          }
        }
        const warn = isUnscaled(item.description)
          ? ' <span class="import-preview-warn">pixels, not feet — this page was never scaled in Count Tooling</span>'
          : '';
        const classes = ['import-preview-item'];
        if (!existing) classes.push('import-preview-item-new');
        if (!item.type) classes.push('import-preview-item-untyped');
        const pageCell = existing || !item.planPage ? '' : ' | ' + escapeHtml(item.planPage);
        return `<div class="${classes.join(' ')}" data-idx="${idx}">${badge}<span class="import-preview-desc">${escapeHtml(item.description || '-')}</span> ${renderTypePicker(item, idx)} <span class="import-preview-meta">× ${escapeHtml(String(count))}${delta}${pageCell}</span>${warn}</div>`;
      })
      .join('');
  }

  // The blank row a new project always carries. It is only ever consumed when
  // the import brings a real row to put in its place — and inside the import's
  // own batch, so one Undo puts it back.
  function soleBlankRow() {
    const rows = TakeoffState.getTopLevelItems();
    if (rows.length !== 1) return null;
    const row = rows[0];
    if ((row.description || '').trim()) return null;
    if (row.children && row.children.length) return null;
    return row;
  }

  /**
   * separateRows=false (the primary button): counts are totals — a matched row
   * is set to the import's count in either direction and takes the import's
   * plan page; unmatched lines are added. separateRows=true (the demoted
   * secondary): every line becomes its own row, duplicates included.
   */
  function performImport(items, separateRows) {
    const existingByDesc = separateRows ? new Map() : getManifestItemsByDesc();
    const willAdd = items.filter((it) => separateRows || !existingByDesc.has(descKey(it.description))).length;
    const blank = soleBlankRow();
    if (typeof TakeoffEvents !== 'undefined') TakeoffEvents.log('import_added', TakeoffEvents.importProps(items, separateRows, (it) => existingByDesc.get(descKey(it.description))));
    TakeoffState.beginBatch(); // whole import = one undo frame
    if (blank && willAdd > 0) TakeoffState.removeItem(blank.id);
    for (const item of items) {
      const existing = separateRows ? null : existingByDesc.get(descKey(item.description));
      if (existing) {
        const updates = {};
        if (item.quantity != null && item.quantity !== (Number(existing.quantity) || 0)) {
          updates.quantity = item.quantity;
        }
        const page = (item.planPage || '').trim();
        if (page && page !== (existing.planPage || '').trim()) updates.planPage = page;
        if (Object.keys(updates).length) TakeoffState.updateItem(existing.id, updates);
        continue;
      }
      TakeoffState.addItem({
        type: item.type,
        description: item.description,
        quantity: item.quantity == null ? 0 : item.quantity,
        labor: item.labor,
        planPage: item.planPage,
        parentId: null,
      });
    }
    TakeoffState.endBatch();
    TakeoffApp.render();
  }

  function refreshActions() {
    const byDesc = getManifestItemsByDesc();
    const summary = summarizeImport(pendingImportItems, byDesc);
    const addBtn = document.getElementById('import-preview-add-btn');
    const sepBtn = document.getElementById('import-preview-separate-btn');
    if (addBtn) {
      addBtn.textContent = primaryLabel(summary);
      addBtn.disabled = summary.updates === 0 && summary.adds === 0;
    }
    // duplicating a fixture that is already on the bid is a deliberate act,
    // so the door only exists when there is something to duplicate
    if (sepBtn) sepBtn.hidden = summary.matched === 0;
  }

  function showImportPreviewModal(items) {
    ensureImportPreviewListeners();
    pendingImportItems = items;
    const modal = document.getElementById('import-preview-modal');
    const manifestList = document.getElementById('import-preview-manifest-list');
    const importList = document.getElementById('import-preview-import-list');
    if (!modal || !manifestList || !importList) return;

    renderManifestList(manifestList);
    renderImportList(importList, items, getManifestItemsByDesc());
    refreshActions();

    lastFocusBeforeModal = document.activeElement;
    modal.setAttribute('aria-hidden', 'false');
    // the modal owns the keyboard from here: Enter must hit this button, not
    // the paste button still focused behind it
    const addBtn = document.getElementById('import-preview-add-btn');
    const focusTarget = addBtn && !addBtn.disabled ? addBtn : document.getElementById('import-preview-cancel-btn');
    focusTarget?.focus();
  }

  function hideImportPreviewModal() {
    const modal = document.getElementById('import-preview-modal');
    if (modal) {
      if (modal.contains(document.activeElement)) document.activeElement?.blur();
      modal.setAttribute('aria-hidden', 'true');
    }
    pendingImportItems = [];
    if (lastFocusBeforeModal && document.contains(lastFocusBeforeModal)) lastFocusBeforeModal.focus();
    lastFocusBeforeModal = null;
  }

  function focusablesIn(modal) {
    return Array.from(modal.querySelectorAll('button, select, input, textarea, a[href], [tabindex]:not([tabindex="-1"])'))
      .filter((el) => !el.disabled && !el.hidden && el.offsetParent !== null);
  }

  function attachImportPreviewListeners() {
    document.getElementById('import-preview-cancel-btn')?.addEventListener('click', () => {
      hideImportPreviewModal();
    });
    document.getElementById('import-preview-add-btn')?.addEventListener('click', () => {
      const items = pendingImportItems;
      hideImportPreviewModal();
      performImport(items, false);
    });
    document.getElementById('import-preview-separate-btn')?.addEventListener('click', () => {
      const items = pendingImportItems;
      hideImportPreviewModal();
      performImport(items, true);
    });
    // the type each line will land with, fixed before the rows exist
    document.getElementById('import-preview-import-list')?.addEventListener('change', (e) => {
      const sel = e.target.closest?.('.import-preview-type');
      if (!sel) return;
      const item = pendingImportItems[Number(sel.dataset.idx)];
      if (!item) return;
      item.type = sel.value || null;
      sel.closest('.import-preview-item')?.classList.toggle('import-preview-item-untyped', !item.type);
    });
    document.getElementById('import-preview-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'import-preview-modal') hideImportPreviewModal();
    });
    document.addEventListener('keydown', function importPreviewKeyHandler(e) {
      const modal = document.getElementById('import-preview-modal');
      if (!modal || modal.getAttribute('aria-hidden') !== 'false') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        hideImportPreviewModal();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = focusablesIn(modal);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (!modal.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  // None of these three stop the estimator doing anything else, so none of them
  // is worth a dialog that has to be clicked away: they go to the app's one
  // feedback region (js/toast.js). Long timeout — the first one names a format.
  function importWarn(text) {
    if (typeof TakeoffToast !== 'undefined') TakeoffToast.show(text, { kind: 'warn', timeout: 10000 });
  }

  async function importFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      const items = parseCountToolingClipboard(text);
      if (items.length === 0) {
        importWarn('Nothing to bring in. Count Tooling copies one row per line: fixture, count, page, separated by tabs.');
        return;
      }
      showImportPreviewModal(items);
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        importWarn('The browser would not hand over the clipboard. Allow clipboard access for this site and paste again.');
      } else {
        importWarn('Could not read the paste: ' + (err.message || 'unknown error'));
      }
    }
  }

  /**
   * Structured handoff from Count Tooling (or any host app) — no clipboard.
   * payload: { v: 1, source?: string, items: [{ description, count|quantity, page?, type? }] }
   * Items flow through the same preview modal as the clipboard import.
   * Returns { count, message }: count is how many items were queued (0 =
   * nothing shown) and message says why, so a wrong envelope version is not
   * reported as an empty link.
   */
  function importFromPayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { count: 0, message: 'This import link did not carry any counts.' };
    }
    if (payload.v !== 1) {
      const seen = payload.v == null ? 'no version' : `version ${String(payload.v).slice(0, 20)}`;
      return {
        count: 0,
        message: `This import link says ${seen}; this app reads version 1 links. Nothing was imported.`,
      };
    }
    if (!Array.isArray(payload.items)) {
      return { count: 0, message: 'This import link did not carry any counts.' };
    }
    const items = [];
    for (const raw of payload.items) {
      if (!raw || typeof raw !== 'object') continue;
      const description = String(raw.description || '').trim();
      if (!description) continue;
      const quantity = parseCount(raw.quantity ?? raw.count);
      const type = typeof raw.type === 'string' && TakeoffState.ITEM_TYPES.includes(raw.type)
        ? raw.type
        : inferType(description);
      items.push({
        description,
        quantity,
        labor: null,
        planPage: String(raw.page ?? raw.planPage ?? '').trim(),
        type,
      });
    }
    if (items.length) showImportPreviewModal(items);
    return {
      count: items.length,
      message: items.length ? '' : 'This import link contained no valid items.',
    };
  }

  let importPreviewListenersAttached = false;
  function ensureImportPreviewListeners() {
    if (importPreviewListenersAttached) return;
    importPreviewListenersAttached = true;
    attachImportPreviewListeners();
  }

  return {
    importFromClipboard,
    importFromPayload,
    parseCountToolingClipboard,
    showImportPreviewModal,
    hideImportPreviewModal,
    ensureImportPreviewListeners,
    // pure helpers (unit-tested in import.test.js)
    inferType,
    parseCount,
    summarizeImport,
    primaryLabel,
  };
})();

// Node (unit tests); inert in the browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TakeoffImport;
}
