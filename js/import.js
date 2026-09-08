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
 *    from the name and unit, since the text carries none; the preview lets
 *    the estimator fix any line's type before the rows exist.
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
 * Counts are TOTALS, never additions: a line that matches a row already on
 * the bid (same description key + unit) sets that row to the import's number,
 * up or down, and its children follow the same rule under it. The one primary
 * button says what it is about to do ("Update 1 count · add 2 fixtures");
 * "Add as separate rows" is the deliberate duplicate door. One undo frame
 * either way. See the "#import= contract" section of docs/ARCHITECTURE.md.
 *
 * The parser is pure and unit-tested (import.test.js) against a checked-in
 * CountTooling export (import-files/counttooling-export.fixture.txt).
 */

const TakeoffImport = (function () {
  // Dual browser/Node: in the browser TakeoffUtils is a prior <script>;
  // in Node (import.test.js) we require it.
  const utils = typeof TakeoffUtils !== 'undefined' ? TakeoffUtils : require('./utils.js');

  let pending = { items: [], project: null };
  let lastFocusBeforeModal = null;

  const GROUP_PREFIX_RE = /^\[([^\]]*)\]\s*/;
  const FT_PREFIX_RE = /^(ft|feet|foot|lf|lin\.?\s?ft|linear\s+(feet|foot|ft))\.?\s+of\s+/i;
  const PX_PREFIX_RE = /^px\s+of\s+/i;
  // CountTooling's view-link footer: the `t=<uuid>` param, or the label itself.
  const PLANS_LINK_RE = /https?:\/\/\S*[?&]t=[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
  const UNITS = ['ea', 'ft', 'px'];

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

  // A length is conduit unless the name says cable or wire.
  const WIRE_RE = /\b(mc|ac|nm|nm-b|romex|thhn|thwn|xhhw|use|ser|seu|cable|wire|cord|cat\s?[56]e?|fiber|coax)\b/i;

  /**
   * Ordered type rules for a COUNT — the first pattern that hits wins, and
   * every term is whole-word. Order carries the meaning: compound gear names
   * that contain a device or lighting word are tested before those words on
   * their own, so "Transfer Switch" is gear while "switch" alone is a device,
   * and "LED Flat Panel" is lighting while "Panel LP-2" is gear. Terms with a
   * known false positive in this trade are deliberately absent (lamp → beam
   * clamp, strip → strip heater, jack → jack chain, meter → voltmeter).
   */
  const TYPE_RULES = [
    ['conduit', /\bof\s+conduit\b|\bwhip\b/],
    ['wire', /\bof\s+wire\b/],
    // gear names that swallow a device/lighting word
    ['gear', /\bswitchgear\b|\bswitchboard\b|\btransfer\s+switch\b|\bdisconnect\b|\bsafety\s+switch\b|\bcontactor\b|\bmcc\b|\bmotor\s+control\b/],
    // fire alarm before lighting: "FA Horn/Strobe" is not an emergency light
    ['specialSystems', /\bfire\s+alarm\b|\bfa\b|\bsmoke\s+detector\b|\bheat\s+detector\b|\bpull\s+station\b|\bhorn\b|\bstrobe\b|\bnurse\s+call\b|\bcard\s+reader\b|\baccess\s+control\b|\bdoor\s+contact\b|\bcctv\b|\bcamera\b|\bdata\s+(drop|jack|port|outlet)\b|\bwap\b|\baccess\s+point\b|\bspeaker\b|\bintercom\b|\bsecurity\b/],
    // "Type A" / "Type F2" is how a lighting schedule names a fixture
    ['lighting', /\btype\s?[a-z]{1,3}\d*\b|\btroffer\b|\bdownlight\b|\bhigh[\s-]?bay\b|\blow[\s-]?bay\b|\bsconce\b|\bexit\b|\bemergency\b|\bwall[\s-]?pack\b|\bpendant\b|\bluminaire\b|\bflat\s+panel\b|\bled\s+panel\b|\bcanopy\b|\bbollard\b|\bflood[\s-]?light\b|\bstrip\s+light\b|\blinear\s+light\b|\bcan\s+light\b|\brecessed\s+can\b|\bvapor[\s-]?tight\b|\blight\s*fixture\b|\blighting\b|\bfixture\b/],
    ['devices', /\breceptacles?\b|\brecept\b|\brecp\b|\boutlets?\b|\bswitch(es)?\b|\bdimmers?\b|\bgfci\b|\bgfi\b|\bocc(upancy)?\s+sensor\b|\bvacancy\s+sensor\b|\bphoto\s?cell\b|\btoggle\b|\bquad\b|\bduplex\b|\bfloor\s+box\b|\bj-?box\b|\bjunction\s+box\b|\busb\b/],
    // generic gear last, so the compounds above win
    ['gear', /\bpanel(board)?\b|\bgear\b|\btransformers?\b|\bxfmr\b|\bbreakers?\b|\bload\s+cent(er|re)\b|\bmeter\s+(socket|base|can)\b|\bct\s+cabinet\b|\bats\b|\bmdp\b|\bgenerator\b|\bvfd\b/],
  ];

  /**
   * Type for a row from its name and (optional) unit. Lengths are conduit
   * unless the name says cable or wire; counts run the ordered rules.
   */
  function inferType(description, unit) {
    const d = (description || '').trim().toLowerCase();
    if (!d) return null;
    if (unit === 'ft' || unit === 'px') return WIRE_RE.test(d) ? 'wire' : 'conduit';
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

  // CountTooling appends 'View link:\t<url>' when its user is signed in. It is
  // a footer, not a fixture — recognised by its label + URL, or by the
  // `t=<uuid>` token alone. Returns the URL, or null when the line is a row.
  function viewLinkOf(line, cells) {
    if (/^view\s+link:?$/i.test(cells[0] || '') && /^https?:\/\//i.test(cells[1] || '')) return cells[1];
    const m = line.match(PLANS_LINK_RE);
    return m ? m[0] : null;
  }

  /**
   * Parse the clipboard text. Returns { items, plansUrl, skipped, unreadable }
   * where each item is { description, quantity, unit, type, group, planPage,
   * labor, meta, children: [item] } (children carry no children of their own
   * — the manifest is two levels deep). `skipped` counts lines that could not
   * be a row at all (one cell, no name); a row whose count cannot be read is
   * KEPT with quantity null (shown as '× ?') and counted in `unreadable`.
   */
  function parseCountToolingClipboard(text) {
    const items = [];
    let plansUrl = null;
    let skipped = 0;
    let unreadable = 0;
    let lastTop = null;
    for (const rawLine of String(text == null ? '' : text).split(/\r?\n/)) {
      if (!rawLine.trim()) continue;
      const indented = /^\s{2,}/.test(rawLine);
      const parts = rawLine.trim().split(/\t/).map((p) => p.trim());
      const link = viewLinkOf(rawLine, parts);
      if (link) {
        if (!plansUrl) plansUrl = link;
        continue;
      }
      if (parts.length < 2) { skipped++; continue; }
      const parsed = parseFixtureName(parts[0]);
      if (!parsed.description) { skipped++; continue; }
      const quantity = parseCount(parts[1]);
      if (quantity == null) unreadable++;
      // 4 cells = PipeTooling-style `fixture, count, group, pages`
      const group = parts.length >= 4 ? (parts[2] || parsed.group) : parsed.group;
      const planPage = (parts.length >= 4 ? parts[3] : parts[2]) || '';
      const item = {
        description: parsed.description,
        quantity: quantity == null ? null : Math.max(0, quantity),
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
    return { items, plansUrl, skipped, unreadable };
  }

  /**
   * Normalize a structured payload (v1 or v2) into the same item shape as
   * the clipboard parser. Returns { items, project } or null when the payload
   * is not one of ours.
   */
  function parsePayload(payload) {
    if (!payload || typeof payload !== 'object' || (payload.v !== 1 && payload.v !== 2) || !Array.isArray(payload.items)) return null;
    const knownTypes = typeof TakeoffState !== 'undefined' && Array.isArray(TakeoffState.ITEM_TYPES)
      ? TakeoffState.ITEM_TYPES
      : PICKABLE_TYPES.concat(['permits', 'powerCoCharges', 'temporaryPower']);
    const validType = (t) => typeof t === 'string' && knownTypes.includes(t);
    const toItem = (raw, isChild) => {
      if (!raw || typeof raw !== 'object') return null;
      const parsed = parseFixtureName(raw.description);
      if (!parsed.description) return null;
      // an explicit unit wins; otherwise the name convention; otherwise a count
      const unit = typeof raw.unit === 'string' ? normalizeUnit(raw.unit) : parsed.unit;
      const quantity = parseCount(raw.quantity ?? raw.count);
      const group = typeof raw.group === 'string' && raw.group.trim() ? raw.group.trim() : parsed.group;
      const item = {
        description: parsed.description,
        quantity: quantity == null ? null : Math.max(0, quantity),
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
    return utils.escapeHtml(str);
  }

  // One key for "the same fixture": the purchase list's description key
  // (case, trim and internal whitespace folded) plus the unit — 100 ft of
  // "1/2" EMT" and a count of the same name are two rows.
  function itemKey(desc, unit) {
    return utils.descKey(desc) + '\n' + normalizeUnit(unit);
  }

  /**
   * What the primary button is about to do. Pure: takes the import lines and
   * a Map of described manifest rows keyed by itemKey. The button label is
   * built from this, so the receipt is on screen before the click.
   */
  function summarizeImport(importItems, manifestByKey) {
    let updates = 0;
    let adds = 0;
    let matched = 0;
    let unreadable = 0;
    for (const item of importItems) {
      const existing = manifestByKey.get(itemKey(item.description, item.unit));
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

  // Real (described) manifest rows by description key + unit — blank starter
  // rows are noise in the preview and can't be merge targets.
  function getManifestItemsByKey() {
    const map = new Map();
    for (const i of TakeoffState.getTopLevelItems()) {
      if (!(i.description || '').trim()) continue;
      const key = itemKey(i.description, i.unit);
      if (!map.has(key)) map.set(key, i);
    }
    return map;
  }

  function unitTag(unit) {
    if (unit === 'ft') return ' <span class="unit-tag unit-tag-ft">ft</span>';
    if (unit === 'px') return ' <span class="unit-tag unit-tag-px" title="Unscaled: pixel length, not feet">px · unscaled</span>';
    return '';
  }

  function fmtQty(q) {
    if (q == null) return '?';
    return String(Math.round((Number(q) || 0) * 100) / 100);
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
          `<div class="import-preview-item">${i.group ? `<span class="group-tag">${escapeHtml(i.group)}</span>` : ''}<span class="import-preview-desc">${escapeHtml(i.description || '-')}</span> <span class="import-preview-meta">× ${fmtQty(i.quantity)}${unitTag(i.unit)} ${i.planPage ? '| ' + escapeHtml(i.planPage) : ''}</span></div>`
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

  function countUnscaled(items) {
    return items.reduce((n, i) => n + (i.unit === 'px' ? 1 : 0) + (i.children || []).filter((c) => c.unit === 'px').length, 0);
  }

  function renderImportList(container, importItems, manifestByKey, project) {
    if (importItems.length === 0) {
      container.innerHTML = '<p class="import-preview-empty">No import items.</p>';
      return;
    }
    let html = '';
    const pxCount = countUnscaled(importItems);
    if (pxCount) {
      html += `<div class="import-preview-notice import-preview-notice-warn">${pxCount} ${pxCount === 1 ? 'row is' : 'rows are'} unscaled (px): Count Tooling exported pixel lengths for pages with no scale. They import flagged and stay out of every total — set the scale in Count Tooling and copy again.</div>`;
    }
    if (project && project.plansUrl) {
      html += '<div class="import-preview-notice">Plans link found — it will be saved on this project and travel to PipeTooling with the counts.</div>';
    }
    const childRow = (child) => {
      const warn = child.unit === 'px'
        ? ' <span class="import-preview-warn">pixels, not feet — this page was never scaled in Count Tooling</span>'
        : '';
      return `<div class="import-preview-item import-preview-item-child ${child.unit === 'px' ? 'import-preview-item-px' : ''}"><span class="import-preview-desc">${escapeHtml(child.description || '-')}</span> <span class="import-preview-meta">× ${fmtQty(child.quantity)}${unitTag(child.unit)}</span>${warn}</div>`;
    };
    html += importItems
      .map((item, idx) => {
        const existing = manifestByKey.get(itemKey(item.description, item.unit));
        const badge = existing ? '' : '<span class="import-preview-badge import-preview-badge-new">new</span>';
        // for an existing item, the decision is the delta — show it, in both
        // directions, because counts are totals
        let delta = '';
        if (existing) {
          const have = Number(existing.quantity) || 0;
          if (item.quantity == null) {
            delta = ` <span class="import-preview-delta">count not read — keeping ${have}</span>`;
          } else if (item.quantity > have) {
            delta = ` <span class="import-preview-delta">was ${have}, +${fmtQty(item.quantity - have)}</span>`;
          } else if (item.quantity < have) {
            delta = ` <span class="import-preview-delta">was ${have}, −${fmtQty(have - item.quantity)}</span>`;
          } else {
            delta = ` <span class="import-preview-delta">already ${have}</span>`;
          }
          const page = (item.planPage || '').trim();
          const hadPage = (existing.planPage || '').trim();
          if (page && page !== hadPage) {
            delta += ` <span class="import-preview-delta">· page ${escapeHtml(page)}${hadPage ? `, was ${escapeHtml(hadPage)}` : ''}</span>`;
          }
        }
        const warn = item.unit === 'px'
          ? ' <span class="import-preview-warn">pixels, not feet — this page was never scaled in Count Tooling</span>'
          : '';
        const classes = ['import-preview-item'];
        if (!existing) classes.push('import-preview-item-new');
        if (!item.type) classes.push('import-preview-item-untyped');
        if (item.unit === 'px') classes.push('import-preview-item-px');
        const pageCell = existing || !item.planPage ? '' : ' | ' + escapeHtml(item.planPage);
        const groupTag = item.group ? `<span class="group-tag">${escapeHtml(item.group)}</span>` : '';
        const row = `<div class="${classes.join(' ')}" data-idx="${idx}">${badge}${groupTag}<span class="import-preview-desc">${escapeHtml(item.description || '-')}</span> ${renderTypePicker(item, idx)} <span class="import-preview-meta">× ${fmtQty(item.quantity)}${unitTag(item.unit)}${delta}${pageCell}</span>${warn}</div>`;
        return row + (item.children || []).map(childRow).join('');
      })
      .join('');
    container.innerHTML = html;
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

  // A CountTooling child count lands as the flow's own component type.
  function childTypeFor(parentType) {
    if (parentType === 'conduit') return 'fitting';
    if (parentType === 'devices') return 'misc';
    return null;
  }

  /**
   * separateRows=false (the primary button): counts are totals — a matched row
   * is set to the import's count in either direction and takes the import's
   * plan page, and its children are matched the same way under it; unmatched
   * lines are added. separateRows=true (the demoted secondary): every line
   * becomes its own row, duplicates included.
   */
  function performImport(items, separateRows, project) {
    const existingByKey = separateRows ? new Map() : getManifestItemsByKey();
    const lookup = (it) => existingByKey.get(itemKey(it.description, it.unit));
    const willAdd = items.filter((it) => separateRows || !lookup(it)).length;
    const blank = soleBlankRow();
    if (typeof TakeoffEvents !== 'undefined') TakeoffEvents.log('import_added', TakeoffEvents.importProps(items, separateRows, lookup));
    TakeoffState.beginBatch(); // whole import = one undo frame
    if (blank && willAdd > 0) TakeoffState.removeItem(blank.id);
    for (const item of items) {
      const existing = separateRows ? null : lookup(item);
      let parent = existing || null;
      if (existing) {
        const updates = {};
        if (item.quantity != null && item.quantity !== (Number(existing.quantity) || 0)) {
          updates.quantity = item.quantity;
        }
        const page = (item.planPage || '').trim();
        if (page && page !== (existing.planPage || '').trim()) updates.planPage = page;
        if (Object.keys(updates).length) TakeoffState.updateItem(existing.id, updates);
      } else {
        parent = TakeoffState.addItem({
          type: item.type,
          description: item.description,
          quantity: item.quantity == null ? 0 : item.quantity,
          unit: item.unit,
          labor: item.labor,
          planPage: item.planPage,
          group: item.group,
          meta: item.meta,
          parentId: null,
        });
      }
      for (const child of item.children || []) {
        if (existing) {
          const match = (parent.children || []).find((c) => itemKey(c.description, c.unit) === itemKey(child.description, child.unit));
          if (match) {
            if (child.quantity != null && child.quantity !== (Number(match.quantity) || 0)) {
              TakeoffState.updateItem(match.id, { quantity: child.quantity });
            }
            continue;
          }
        }
        TakeoffState.addItem({
          parentId: parent.id,
          type: childTypeFor(parent.type),
          description: child.description,
          quantity: child.quantity == null ? 0 : child.quantity,
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
    if (project.plansUrl && typeof TakeoffState.setPlansUrl === 'function') TakeoffState.setPlansUrl(project.plansUrl);
    if (project.name) {
      const current = TakeoffState.getCurrentProject();
      const described = TakeoffState.getTopLevelItems().filter((i) => (i.description || '').trim());
      if (current.name === 'Untitled project' || described.length === 0) TakeoffState.setProjectName(project.name);
    }
    if (typeof TakeoffProjectsView !== 'undefined') TakeoffProjectsView.updateHeader();
  }

  function refreshActions() {
    const summary = summarizeImport(pending.items, getManifestItemsByKey());
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

  /**
   * Open the preview. Takes either the parser's result ({ items, plansUrl })
   * or a bare items array plus an optional project ({ name?, plansUrl? }).
   */
  function showImportPreviewModal(parsedOrItems, project) {
    ensureImportPreviewListeners();
    let items = [];
    let proj = project || null;
    if (Array.isArray(parsedOrItems)) {
      items = parsedOrItems;
    } else if (parsedOrItems && typeof parsedOrItems === 'object') {
      items = Array.isArray(parsedOrItems.items) ? parsedOrItems.items : [];
      if (!proj && parsedOrItems.plansUrl) proj = { name: '', plansUrl: parsedOrItems.plansUrl };
    }
    pending = { items, project: proj };
    const modal = document.getElementById('import-preview-modal');
    const manifestList = document.getElementById('import-preview-manifest-list');
    const importList = document.getElementById('import-preview-import-list');
    if (!modal || !manifestList || !importList) return;

    renderManifestList(manifestList);
    renderImportList(importList, items, getManifestItemsByKey(), proj);
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
    pending = { items: [], project: null };
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
      const { items, project } = pending;
      hideImportPreviewModal();
      performImport(items, false, project);
    });
    document.getElementById('import-preview-separate-btn')?.addEventListener('click', () => {
      const { items, project } = pending;
      hideImportPreviewModal();
      performImport(items, true, project);
    });
    // the type each line will land with, fixed before the rows exist
    document.getElementById('import-preview-import-list')?.addEventListener('change', (e) => {
      const sel = e.target.closest?.('.import-preview-type');
      if (!sel) return;
      const item = pending.items[Number(sel.dataset.idx)];
      if (!item) return;
      item.type = sel.value || null;
      sel.closest('.import-preview-item')?.classList.toggle('import-preview-item-untyped', !item.type);
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
      const paste = document.getElementById('import-paste-modal');
      if (e.key === 'Escape' && paste && paste.getAttribute('aria-hidden') === 'false') {
        e.preventDefault();
        hidePasteModal();
        return;
      }
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

  // None of these stop the estimator doing anything else, so none of them is
  // worth a dialog that has to be clicked away: they go to the app's one
  // feedback region (js/toast.js). Long timeout — the first one names a format.
  function importWarn(text) {
    if (typeof TakeoffToast !== 'undefined') TakeoffToast.show(text, { kind: 'warn', timeout: 10000 });
  }

  // The clipboard (or pasted) text → the preview.
  function importText(text) {
    const parsed = parseCountToolingClipboard(text);
    if (parsed.items.length === 0) {
      importWarn('Nothing to bring in. Count Tooling copies one row per line: fixture, count, page, separated by tabs.');
      return;
    }
    if (parsed.skipped) importWarn(`${plural(parsed.skipped, 'line', 'lines')} skipped — no fixture name or no count cell.`);
    showImportPreviewModal(parsed.items, { name: '', plansUrl: parsed.plansUrl || '' });
  }

  async function importFromClipboard() {
    let text = '';
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) throw new Error('unavailable');
      text = await navigator.clipboard.readText();
    } catch (err) {
      // Firefox, a denied permission, or an insecure page land here: offer a
      // paste box instead of a dead end.
      showPasteModal();
      return;
    }
    importText(text);
  }

  /**
   * Structured handoff from CountTooling (or any host app) — no clipboard.
   * Accepts payload v1 and v2 (see the header). Items flow through the same
   * preview modal as the clipboard import. Returns { count, message }: count
   * is how many items were queued (0 = nothing shown) and message says why, so
   * a wrong envelope version is not reported as an empty link.
   */
  function importFromPayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { count: 0, message: 'This import link did not carry any counts.' };
    }
    if (payload.v !== 1 && payload.v !== 2) {
      const seen = payload.v == null ? 'no version' : `version ${String(payload.v).slice(0, 20)}`;
      return {
        count: 0,
        message: `This import link says ${seen}; this app reads version 1 and 2 links. Nothing was imported.`,
      };
    }
    const parsed = parsePayload(payload);
    if (!parsed) {
      return { count: 0, message: 'This import link did not carry any counts.' };
    }
    if (parsed.items.length) showImportPreviewModal(parsed.items, parsed.project);
    return {
      count: parsed.items.length,
      message: parsed.items.length ? '' : 'This import link contained no valid items.',
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
    importText,
    showImportPreviewModal,
    hideImportPreviewModal,
    ensureImportPreviewListeners,
    // pure helpers (unit-tested in import.test.js)
    parseCountToolingClipboard,
    parsePayload,
    parseFixtureName,
    inferType,
    parseCount,
    itemKey,
    summarizeImport,
    primaryLabel,
  };
})();

// Node (unit tests): the parser and inference are pure; the DOM-facing
// functions only touch TakeoffState/TakeoffApp when called. Inert in the browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TakeoffImport;
}
