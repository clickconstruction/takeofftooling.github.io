/**
 * Import from CountTooling — two doors into the same preview modal.
 *
 * 1. Clipboard / paste (the "Copy to /Tooling" text). One row per line,
 *    tab-separated: `fixture \t quantity \t pages`. CountTooling's conventions,
 *    all honored here (they are the same ones PipeTooling's importer reads):
 *      - `[Group] ` prefix on the name → the row's group (a circuit, a panel,
 *        an area). Kept OFF the description so the name can match the book.
 *      - `ft of <name>` → a length in feet (unit 'ft'); `px of <name>` → an
 *        UNSCALED length in pixels (unit 'px'): imported flagged, never
 *        priced or summed — the estimator rescales in CountTooling and
 *        copies again. Everything else is a count (unit 'ea').
 *      - a two-space indent → a child of the row above it (CountTooling's
 *        child counts: couplings under a conduit, connectors under a box).
 *      - a trailing `View link:\t<url>` footer → the project's plans link.
 *    Type (lighting/gear/devices/conduit/wire/specialSystems) is inferred
 *    from the name and unit, since the text carries none.
 *
 * 2. Structured handoff (`#import=<base64 JSON>`, js/app.js): CountTooling
 *    states facts and nothing is inferred that it provided.
 *      v1: { v:1, source, items:[{ description, count|quantity, page?, type? }] }
 *      v2: { v:2, source, project?: { name?, plansUrl? },
 *            items:[{ description, quantity|count, unit?: 'ea'|'ft'|'px',
 *                     type?, pages?|page?, group?, meta?,
 *                     children?: [{ description, quantity, unit?, type? }] }] }
 *    An invalid `type` falls back to inference; missing `unit` is 'ea'.
 *
 * Both paths land in #import-preview-modal: Add All (append) or Add Overages
 * Only (an existing description+unit is raised to the import's total when
 * higher — counts are totals, never additions). One undo frame either way.
 * The parser is pure and unit-tested (import.test.js) against a checked-in
 * CountTooling export (import-files/counttooling-export.fixture.txt).
 */

const TakeoffImport = (function () {
  let pending = { items: [], project: null };

  const GROUP_PREFIX_RE = /^\[([^\]]*)\]\s*/;
  const FT_PREFIX_RE = /^(ft|feet|foot|lf|lin\.?\s?ft|linear\s+(feet|foot|ft))\.?\s+of\s+/i;
  const PX_PREFIX_RE = /^px\s+of\s+/i;
  // CountTooling's view-link footer: detect by the `t=<uuid>` param, never by label.
  const PLANS_LINK_RE = /https?:\/\/\S*[?&]t=[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
  const UNITS = ['ea', 'ft', 'px'];

  const WIRE_RE = /\b(mc|ac|nm|nm-b|romex|thhn|thwn|xhhw|use|ser|seu|cable|wire|cord|cat\s?[56]e?|fiber|coax)\b/i;
  const SPECIAL_RE = /fire alarm|\bfa\b|smoke|heat det|pull station|horn|strobe|speaker|camera|card reader|door contact|motion|data|\btel\b|phone|jack|\bwap\b|access point|\btv\b|\bav\b|intercom|nurse call|security/i;
  const GEAR_RE = /panel|switchboard|switchgear|transformer|disconnect|breaker|\bmdp\b|\bmcc\b|meter|gutter|\bats\b|generator|\bvfd\b|starter|contactor/i;
  const LIGHTING_RE = /\btype\s?[a-z]{1,3}\d*\b|troffer|downlight|high.?bay|wall pack|sconce|exit|emergency|\bem\b|light|fixture|luminaire|pendant|strip|flood|pole/i;
  const DEVICES_RE = /recept|switch|outlet|gfci|gfi|dimmer|occupancy|sensor|j-?box|junction|\bbox\b|plate|usb|floor box|poke|dedicated|quad|duplex/i;

  /**
   * Type for a row from its name and unit. Lengths are conduit unless the
   * name says cable or wire; counts run the trade-specific patterns in the
   * order that keeps "Panel LP-1" gear, "Switch S3" a device, "Exit Sign" a
   * light and "Data Drop" a special system.
   */
  function inferType(description, unit) {
    const d = (description || '').trim();
    if (!d) return null;
    if (unit === 'ft' || unit === 'px') return WIRE_RE.test(d) ? 'wire' : 'conduit';
    if (SPECIAL_RE.test(d)) return 'specialSystems';
    if (GEAR_RE.test(d)) return 'gear';
    if (LIGHTING_RE.test(d)) return 'lighting';
    if (DEVICES_RE.test(d)) return 'devices';
    return null;
  }

  function normalizeUnit(u) {
    return typeof u === 'string' && UNITS.includes(u) ? u : 'ea';
  }

  // Split a CountTooling fixture name into { group, unit, description }.
  function parseFixtureName(raw) {
    let name = String(raw || '').trim();
    let group = null;
    const g = name.match(GROUP_PREFIX_RE);
    if (g) {
      group = g[1].trim() || null;
      name = name.slice(g[0].length);
    }
    let unit = 'ea';
    if (PX_PREFIX_RE.test(name)) {
      unit = 'px';
      name = name.replace(PX_PREFIX_RE, '');
    } else if (FT_PREFIX_RE.test(name)) {
      unit = 'ft';
      name = name.replace(FT_PREFIX_RE, '');
    }
    return { group, unit, description: name.trim() };
  }

  /**
   * Parse the clipboard text. Returns { items, plansUrl, skipped } where each
   * item is { description, quantity, unit, type, group, planPage, meta,
   * children: [item] } (children carry no children of their own — the
   * manifest is two levels deep).
   */
  function parseCountToolingClipboard(text) {
    const items = [];
    let plansUrl = null;
    let skipped = 0;
    let lastTop = null;
    for (const rawLine of String(text || '').split(/\r?\n/)) {
      if (!rawLine.trim()) continue;
      if (PLANS_LINK_RE.test(rawLine)) {
        if (!plansUrl) plansUrl = rawLine.match(PLANS_LINK_RE)[0];
        continue;
      }
      const indented = /^\s{2,}/.test(rawLine);
      const parts = rawLine.trim().split(/\t/).map((p) => p.trim());
      if (parts.length < 2) { skipped++; continue; }
      const parsed = parseFixtureName(parts[0]);
      if (!parsed.description) { skipped++; continue; }
      const quantity = parseFloat(parts[1]);
      if (isNaN(quantity) || quantity < 0) { skipped++; continue; }
      // 4 cells = PipeTooling-style `fixture, count, group, pages`
      const group = parts.length >= 4 ? (parts[2] || parsed.group) : parsed.group;
      const planPage = (parts.length >= 4 ? parts[3] : parts[2]) || '';
      const item = {
        description: parsed.description,
        quantity,
        unit: parsed.unit,
        type: inferType(parsed.description, parsed.unit),
        group,
        planPage,
        labor: null,
        meta: null,
        children: [],
      };
      if (indented && lastTop) {
        item.children = undefined;
        lastTop.children.push(item);
      } else {
        items.push(item);
        lastTop = item;
      }
    }
    return { items, plansUrl, skipped };
  }

  /**
   * Normalize a structured payload (v1 or v2) into the same item shape as
   * the clipboard parser. Returns { items, project } or null when the payload
   * is not one of ours.
   */
  function parsePayload(payload) {
    if (!payload || (payload.v !== 1 && payload.v !== 2) || !Array.isArray(payload.items)) return null;
    const validType = (t) => typeof t === 'string' && TakeoffState.ITEM_TYPES.includes(t);
    const toItem = (raw, isChild) => {
      if (!raw || typeof raw !== 'object') return null;
      const parsed = parseFixtureName(raw.description);
      if (!parsed.description) return null;
      // an explicit unit wins; otherwise the name convention; otherwise a count
      const unit = typeof raw.unit === 'string' ? normalizeUnit(raw.unit) : parsed.unit;
      const quantity = Number(raw.quantity ?? raw.count) || 0;
      const group = typeof raw.group === 'string' && raw.group.trim() ? raw.group.trim() : parsed.group;
      const item = {
        description: parsed.description,
        quantity,
        unit,
        type: validType(raw.type) ? raw.type : inferType(parsed.description, unit),
        group,
        planPage: String(raw.pages ?? raw.page ?? raw.planPage ?? '').trim(),
        labor: null,
        meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : null,
      };
      if (!isChild) {
        item.children = Array.isArray(raw.children) ? raw.children.map((c) => toItem(c, true)).filter(Boolean) : [];
      }
      return item;
    };
    const items = payload.items.map((r) => toItem(r, false)).filter(Boolean);
    const p = payload.project && typeof payload.project === 'object' ? payload.project : {};
    const project = {
      name: typeof p.name === 'string' ? p.name.trim() : '',
      plansUrl: typeof p.plansUrl === 'string' && PLANS_LINK_RE.test(p.plansUrl) ? p.plansUrl.match(PLANS_LINK_RE)[0] : '',
    };
    return { items, project };
  }

  function escapeHtml(str) {
    return TakeoffUtils.escapeHtml(str);
  }

  const itemKey = (desc, unit) => (desc || '').trim().toLowerCase() + '\n' + (unit || 'ea');

  // Real (described) manifest rows by description+unit — blank starter rows
  // are noise in the preview and can't be merge targets.
  function getManifestItemsByKey() {
    const map = new Map();
    for (const i of TakeoffState.getTopLevelItems()) {
      const key = itemKey(i.description, i.unit);
      if ((i.description || '').trim() && !map.has(key)) map.set(key, i);
    }
    return map;
  }

  function unitTag(unit) {
    if (unit === 'ft') return '<span class="unit-tag unit-tag-ft">ft</span>';
    if (unit === 'px') return '<span class="unit-tag unit-tag-px" title="Unscaled: pixel length, not feet">px · unscaled</span>';
    return '';
  }

  function fmtQty(item) {
    const q = Number(item.quantity) || 0;
    return item.unit === 'ft' ? q.toFixed(2) : String(Math.round(q * 100) / 100);
  }

  function renderManifestList(container) {
    const items = TakeoffState.getTopLevelItems().filter((i) => (i.description || '').trim());
    if (items.length === 0) {
      container.innerHTML = '<p class="import-preview-empty">Manifest is empty.</p>';
      return;
    }
    container.innerHTML = items
      .map(
        (i) =>
          `<div class="import-preview-item">${i.group ? `<span class="group-tag">${escapeHtml(i.group)}</span>` : ''}<span class="import-preview-desc">${escapeHtml(i.description || '-')}</span> <span class="import-preview-meta">× ${fmtQty(i)} ${unitTag(i.unit)}${i.planPage ? '| ' + escapeHtml(i.planPage) : ''}</span></div>`
      )
      .join('');
  }

  function renderImportList(container, importItems, manifestByKey, project) {
    if (importItems.length === 0) {
      container.innerHTML = '<p class="import-preview-empty">No import items.</p>';
      return;
    }
    const pxCount = importItems.reduce((n, i) => n + (i.unit === 'px' ? 1 : 0) + (i.children || []).filter((c) => c.unit === 'px').length, 0);
    let html = '';
    if (pxCount) {
      html += `<div class="import-preview-notice import-preview-notice-warn">${pxCount} ${pxCount === 1 ? 'row is' : 'rows are'} unscaled (px): CountTooling exported pixel lengths for pages with no scale. They import flagged and stay out of every total — set the scale in CountTooling and copy again.</div>`;
    }
    if (project && project.plansUrl) {
      html += '<div class="import-preview-notice">Plans link found — it will be saved on this project and travel to PipeTooling with the counts.</div>';
    }
    const row = (item, isChild) => {
      const existing = !isChild ? manifestByKey.get(itemKey(item.description, item.unit)) : null;
      const badge = existing || isChild ? '' : '<span class="import-preview-badge import-preview-badge-new">new</span>';
      let delta = '';
      if (existing) {
        const have = Number(existing.quantity) || 0;
        const want = Number(item.quantity) || 0;
        delta = want > have
          ? ` <span class="import-preview-delta">now ${have}, +${Math.round((want - have) * 100) / 100}</span>`
          : ` <span class="import-preview-delta">already ${have} — no change</span>`;
      }
      const typeTag = item.type ? `<span class="import-preview-type">${escapeHtml(item.type)}</span>` : '';
      return `<div class="import-preview-item ${existing || isChild ? '' : 'import-preview-item-new'} ${isChild ? 'import-preview-item-child' : ''} ${item.unit === 'px' ? 'import-preview-item-px' : ''}">${badge}${item.group && !isChild ? `<span class="group-tag">${escapeHtml(item.group)}</span>` : ''}<span class="import-preview-desc">${escapeHtml(item.description || '-')}</span> <span class="import-preview-meta">× ${fmtQty(item)} ${unitTag(item.unit)}${delta} ${item.planPage ? '| ' + escapeHtml(item.planPage) : ''} ${typeTag}</span></div>`;
    };
    for (const item of importItems) {
      html += row(item, false);
      for (const c of item.children || []) html += row(c, true);
    }
    container.innerHTML = html;
  }

  function childTypeFor(parentType) {
    if (parentType === 'conduit') return 'fitting';
    if (parentType === 'devices') return 'misc';
    return null;
  }

  // overagesOnly: new items are added; an item that already exists (matched
  // by description + unit) is raised to the import's total when that total is
  // higher, and left alone otherwise — counts are totals, never additions.
  // Children follow the same rule under their parent.
  function performImport(items, overagesOnly, project) {
    const existingByKey = overagesOnly ? getManifestItemsByKey() : new Map();
    TakeoffState.beginBatch(); // whole import = one undo frame
    for (const item of items) {
      let parent = null;
      if (overagesOnly) {
        const existing = existingByKey.get(itemKey(item.description, item.unit));
        if (existing) {
          const incoming = Number(item.quantity) || 0;
          if (incoming > (Number(existing.quantity) || 0)) TakeoffState.updateItem(existing.id, { quantity: incoming });
          parent = existing;
        }
      }
      if (!parent) {
        parent = TakeoffState.addItem({
          type: item.type,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          labor: item.labor,
          planPage: item.planPage,
          group: item.group,
          meta: item.meta,
          parentId: null,
        });
      }
      for (const child of item.children || []) {
        if (overagesOnly) {
          const match = (parent.children || []).find((c) => itemKey(c.description, c.unit) === itemKey(child.description, child.unit));
          if (match) {
            const incoming = Number(child.quantity) || 0;
            if (incoming > (Number(match.quantity) || 0)) TakeoffState.updateItem(match.id, { quantity: incoming });
            continue;
          }
        }
        TakeoffState.addItem({
          parentId: parent.id,
          type: childTypeFor(parent.type),
          description: child.description,
          quantity: child.quantity,
          unit: child.unit,
          labor: null,
          planPage: '',
          meta: child.meta || null,
        });
      }
    }
    TakeoffState.endBatch();
    applyProjectMeta(project);
    TakeoffApp.render();
  }

  // Project name (only when the open project is still the blank starter) and
  // the plans link, applied when the import commits — never on preview.
  function applyProjectMeta(project) {
    if (!project) return;
    if (project.plansUrl) TakeoffState.setPlansUrl(project.plansUrl);
    if (project.name) {
      const current = TakeoffState.getCurrentProject();
      const described = TakeoffState.getTopLevelItems().filter((i) => (i.description || '').trim());
      if (current.name === 'Untitled project' || described.length === 0) TakeoffState.setProjectName(project.name);
    }
    if (typeof TakeoffProjectsView !== 'undefined') TakeoffProjectsView.updateHeader();
  }

  function showImportPreviewModal(items, project) {
    ensureImportPreviewListeners();
    pending = { items, project: project || null };
    const modal = document.getElementById('import-preview-modal');
    const manifestList = document.getElementById('import-preview-manifest-list');
    const importList = document.getElementById('import-preview-import-list');
    if (!modal || !manifestList || !importList) return;
    renderManifestList(manifestList);
    renderImportList(importList, items, getManifestItemsByKey(), pending.project);
    modal.setAttribute('aria-hidden', 'false');
  }

  function hideImportPreviewModal() {
    const modal = document.getElementById('import-preview-modal');
    if (modal) modal.setAttribute('aria-hidden', 'true');
    pending = { items: [], project: null };
  }

  function summarize(items) {
    let ea = 0, eaQty = 0, ft = 0, ftQty = 0, px = 0;
    for (const i of items) {
      if (i.unit === 'px') px++;
      else if (i.unit === 'ft') { ft++; ftQty += Number(i.quantity) || 0; }
      else { ea++; eaQty += Number(i.quantity) || 0; }
    }
    const parts = [];
    if (ea) parts.push(`${ea} count${ea === 1 ? '' : 's'} (${Math.round(eaQty).toLocaleString()} ea)`);
    if (ft) parts.push(`${ft} line type${ft === 1 ? '' : 's'} (${ftQty.toLocaleString(undefined, { maximumFractionDigits: 2 })} ft)`);
    if (px) parts.push(`${px} unscaled`);
    return parts.join(' · ');
  }

  function attachImportPreviewListeners() {
    document.getElementById('import-preview-cancel-btn')?.addEventListener('click', hideImportPreviewModal);
    document.getElementById('import-preview-overages-btn')?.addEventListener('click', () => {
      const { items, project } = pending;
      performImport(items, true, project);
      hideImportPreviewModal();
      TakeoffUtils.toast('Imported overages: ' + summarize(items), { kind: 'success' });
    });
    document.getElementById('import-preview-all-btn')?.addEventListener('click', () => {
      const { items, project } = pending;
      performImport(items, false, project);
      hideImportPreviewModal();
      TakeoffUtils.toast('Imported ' + summarize(items), { kind: 'success' });
    });
    document.getElementById('import-preview-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'import-preview-modal') hideImportPreviewModal();
    });
    // paste fallback (clipboard permission denied or unavailable)
    document.getElementById('import-paste-cancel-btn')?.addEventListener('click', hidePasteModal);
    document.getElementById('import-paste-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'import-paste-modal') hidePasteModal();
    });
    document.getElementById('import-paste-import-btn')?.addEventListener('click', () => {
      const text = document.getElementById('import-paste-text')?.value || '';
      hidePasteModal();
      importText(text);
    });
    document.addEventListener('keydown', function importPreviewKeyHandler(e) {
      if (e.key !== 'Escape') return;
      const modal = document.getElementById('import-preview-modal');
      if (modal && modal.getAttribute('aria-hidden') === 'false') { e.preventDefault(); hideImportPreviewModal(); }
      const paste = document.getElementById('import-paste-modal');
      if (paste && paste.getAttribute('aria-hidden') === 'false') { e.preventDefault(); hidePasteModal(); }
    });
  }

  function showPasteModal() {
    ensureImportPreviewListeners();
    const modal = document.getElementById('import-paste-modal');
    const ta = document.getElementById('import-paste-text');
    if (!modal) return;
    if (ta) ta.value = '';
    modal.setAttribute('aria-hidden', 'false');
    ta?.focus();
  }

  function hidePasteModal() {
    const modal = document.getElementById('import-paste-modal');
    if (modal?.contains(document.activeElement)) document.activeElement?.blur();
    modal?.setAttribute('aria-hidden', 'true');
  }

  function importText(text) {
    const { items, plansUrl, skipped } = parseCountToolingClipboard(text);
    if (items.length === 0) {
      TakeoffUtils.toast('No count rows found. Expected CountTooling’s Copy to /Tooling text: one row per line, tab-separated (fixture, quantity, pages).', { kind: 'error' });
      return;
    }
    if (skipped) TakeoffUtils.toast(`${skipped} line${skipped === 1 ? '' : 's'} skipped (no quantity).`);
    showImportPreviewModal(items, { name: '', plansUrl: plansUrl || '' });
  }

  async function importFromClipboard() {
    let text = '';
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) throw new Error('unavailable');
      text = await navigator.clipboard.readText();
    } catch (err) {
      // Firefox and denied permissions land here: offer a paste box instead.
      showPasteModal();
      return;
    }
    importText(text);
  }

  /**
   * Structured handoff from CountTooling (or any host app) — no clipboard.
   * Returns the number of items queued (0 = nothing valid; caller may notify).
   */
  function importFromPayload(payload) {
    const parsed = parsePayload(payload);
    if (!parsed) return 0;
    if (parsed.items.length) showImportPreviewModal(parsed.items, parsed.project);
    return parsed.items.length;
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
    importText,
    parseCountToolingClipboard,
    parsePayload,
    parseFixtureName,
    inferType,
    showImportPreviewModal,
    hideImportPreviewModal,
    ensureImportPreviewListeners,
  };
})();

// Node (unit tests): the parser and inference are pure; the DOM-facing
// functions only touch TakeoffState/TakeoffApp when called. Inert in the browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TakeoffImport;
}
