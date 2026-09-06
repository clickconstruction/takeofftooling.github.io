/**
 * Takeoff Tooling - Organize Categories view (PREVIEW)
 *
 * Full-page board for reorganizing the Labor & Price Book structure:
 * one lane per tab, groups and sections as a draggable tree, plus
 * click-and-place for long-distance moves and a section editor drawer.
 *
 * Works on a scratch copy of the real book taken on entry; "Apply" is a
 * stub for now (nothing is written back to TakeoffState), so the whole
 * view is a safe sandbox. Opened from the Labor & Price Book modal's
 * "Organize Categories" button (TakeoffApp.navigateToOrganize).
 */
const TakeoffOrganizeView = (function () {
  const escapeHtml = (s) => TakeoffUtils.escapeHtml(String(s ?? ''));

  // ---------- module state (reset on enter()) ----------
  let model = { tabs: [] }; // [{key, label, groups:[{name|null, sections:[{name, items:[rows]}]}]}]
  let changes = [];
  let collapsed = new Set();
  let drag = null;    // {kind:'section'|'group', t, g, s} — native drag in progress
  let placing = null; // same shape — click-and-place armed
  let drawerSec = null; // object reference to the section open in the drawer

  // Build the working model from the real book: groups come from the
  // defaults group config; sections not covered by a group land in the
  // per-tab Ungrouped bucket (which always renders last).
  function enter() {
    const book = TakeoffState.getLaborBook();
    model = { tabs: [] };
    changes = [];
    collapsed = new Set();
    drag = null;
    placing = null;
    drawerSec = null;
    for (const key of TakeoffState.getLaborBookTabOrder()) {
      const label = TakeoffState.LABOR_BOOK_TYPE_LABELS[key] || key;
      const sections = book[key] || {};
      const seen = new Set();
      const groups = [];
      for (const g of TakeoffState.getLaborBookGroups(key) || []) {
        const gs = [];
        for (const name of g.sections) {
          if (Object.prototype.hasOwnProperty.call(sections, name)) {
            gs.push({ name, items: JSON.parse(JSON.stringify(sections[name])) });
            seen.add(name);
          }
        }
        groups.push({ name: g.name, sections: gs });
      }
      const loose = { name: null, sections: [] };
      for (const name of Object.keys(sections)) {
        if (!seen.has(name)) loose.sections.push({ name, items: JSON.parse(JSON.stringify(sections[name])) });
      }
      groups.push(loose);
      model.tabs.push({ key, label, groups });
    }
  }

  function ensureLoose(tab) {
    let g = tab.groups.find((x) => x.name === null);
    if (!g) { g = { name: null, sections: [] }; tab.groups.push(g); }
    return g;
  }

  // ---------- rendering ----------

  function render() {
    return `
    <div class="org-view">
      <div class="org-header">
        <button type="button" class="btn btn-secondary" id="org-back-btn">&larr; Back to book</button>
        <div class="org-title">Organize Categories
          <span class="org-sub">PREVIEW &mdash; drag, or use &#x2725; to click-and-place &middot; click a section to edit it &middot; nothing saves yet</span>
        </div>
        <div class="org-legend">
          <span><span class="org-sw org-sw-curated"></span>section</span>
          <span><span class="org-sw org-sw-empty"></span>empty</span>
        </div>
        <input class="org-search" id="org-search" type="search" placeholder="Find a section&hellip;" autocomplete="off">
      </div>
      <div class="org-place-banner" id="org-place-banner" hidden>
        <span>Placing <b id="org-place-name"></b></span>
        <span class="org-place-hint">scroll anywhere, then click a destination &mdash; edges of a section = before/after, center = merge &middot; Esc cancels</span>
        <button type="button" id="org-place-cancel">Cancel (Esc)</button>
      </div>
      <div class="org-board" id="org-board"></div>
      <aside class="org-drawer" id="org-drawer" hidden></aside>
      <div class="org-tray">
        <div class="org-tray-summary" id="org-summary"></div>
        <div class="org-tray-log" id="org-log"></div>
        <button type="button" class="btn btn-secondary" id="org-discard-btn">Discard</button>
        <button type="button" class="btn org-apply-btn" id="org-apply-btn" disabled title="Preview — applying to the book is a later step">Apply changes</button>
      </div>
    </div>`;
  }

  function boardHtml() {
    return model.tabs.map((tab, t) => {
      const count = tab.groups.reduce((n, g) => n + g.sections.length, 0);
      return `
      <section class="org-lane" data-t="${t}">
        <div class="org-lane-head">
          <span class="org-lane-name">${escapeHtml(tab.label)}</span>
          <span class="org-lane-count">${count} section${count === 1 ? '' : 's'}</span>
          <button type="button" class="org-add-group" data-act="add-group" data-t="${t}">+ Group</button>
        </div>
        <div class="org-lane-body">
          ${tab.groups.map((g, gi) => groupHtml(t, g, gi)).join('')}
        </div>
      </section>`;
    }).join('');
  }

  function groupHtml(t, g, gi) {
    const isLoose = g.name === null;
    const key = `${t}:${gi}`;
    // an active search force-expands groups so every hit is visible
    const searching = (document.getElementById('org-search')?.value || '').trim() !== '';
    const isCollapsed = collapsed.has(key) && !searching;
    const chips = isCollapsed ? '' : `<div class="org-children">` + g.sections.map((s, si) => `
      <div class="org-chip-wrap"><div class="org-chip" draggable="true" data-t="${t}" data-g="${gi}" data-s="${si}" title="${escapeHtml(s.name)}">
        ${s.items.length === 0 ? '<span class="org-empty-dot" title="0 rows"></span>' : ''}
        <span class="org-cname">${escapeHtml(s.name)}</span>
        <span class="org-rows">${s.items.length}</span>
        <span class="org-minis">
          <button type="button" data-act="pick-sec" title="Pick up &mdash; then click where it goes">&#x2725;</button>
          <button type="button" data-act="edit-sec" title="Edit section">&#x270E;</button>
        </span></div></div>`).join('')
      + (isLoose && g.sections.length === 0
        ? `<div class="org-loose-empty" data-t="${t}" data-g="${gi}">empty &mdash; drop or place a section here</div>` : '')
      + `</div>`;

    const head = isLoose
      ? `<div class="org-group-head" data-t="${t}" data-g="${gi}">
          <button type="button" class="org-collapse" data-act="collapse" data-key="${key}">${isCollapsed ? '&#9654;' : '&#9660;'}</button>
          <span class="org-gname">Ungrouped</span>
          <span class="org-gcount">${g.sections.length}</span>
          <button type="button" class="org-add-sec" data-act="add-sec" data-t="${t}" data-g="${gi}" title="Add section">+</button>
        </div>`
      : `<div class="org-group-head" draggable="true" data-t="${t}" data-g="${gi}">
          <button type="button" class="org-collapse" data-act="collapse" data-key="${key}">${isCollapsed ? '&#9654;' : '&#9660;'}</button>
          <button type="button" class="org-grip" data-act="pick-group" title="Pick up group &mdash; then click where it goes">&#x2839;&#x2839;</button>
          <span class="org-gname">${escapeHtml(g.name)}</span>
          <span class="org-gcount">${g.sections.length}</span>
          <button type="button" class="org-add-sec" data-act="add-sec" data-t="${t}" data-g="${gi}" title="Add section">+</button>
        </div>`;

    return `<div class="org-group${isLoose ? ' org-ungrouped' : ''}" data-t="${t}" data-g="${gi}">${head}${chips}</div>`;
  }

  // Re-render the board/tray/drawer in place (keeps header + search focus).
  function refresh() {
    const board = document.getElementById('org-board');
    if (!board) return;
    board.innerHTML = boardHtml();
    applySearch();
    renderTray();
    renderDrawer();
    if (placing) {
      const el = placing.kind === 'section'
        ? board.querySelector(`.org-chip[data-t="${placing.t}"][data-g="${placing.g}"][data-s="${placing.s}"]`)
        : board.querySelector(`.org-group-head[data-t="${placing.t}"][data-g="${placing.g}"]`);
      el?.classList.add('org-armed');
    }
  }

  function renderTray() {
    const n = changes.length;
    const summary = document.getElementById('org-summary');
    const log = document.getElementById('org-log');
    const apply = document.getElementById('org-apply-btn');
    if (summary) summary.innerHTML = n ? `<b>${n}</b> pending change${n === 1 ? '' : 's'} (preview)` : 'No pending changes';
    if (log) log.innerHTML = changes.map((c) => `<span>${escapeHtml(c)}</span>`).join('');
    if (apply) apply.disabled = n === 0;
  }

  function logChange(label) { if (!changes.includes(label)) changes.push(label); }

  // ---------- target resolution (shared by drag & place) ----------

  function resolveTarget(e) {
    const chip = e.target.closest('.org-chip');
    const ghead = e.target.closest('.org-group-head');
    const looseEmpty = e.target.closest('.org-loose-empty');
    const lane = e.target.closest('.org-lane');
    if (chip) {
      const r = chip.getBoundingClientRect();
      const y = (e.clientY - r.top) / r.height;
      return { el: chip, type: y < 0.3 ? 'before' : y > 0.7 ? 'after' : 'merge',
               t: +chip.dataset.t, g: +chip.dataset.g, s: +chip.dataset.s };
    }
    if (ghead) {
      const r = ghead.getBoundingClientRect();
      return { el: ghead, type: 'group', t: +ghead.dataset.t, g: +ghead.dataset.g,
               half: (e.clientY - r.top) / r.height < 0.5 ? 'before' : 'after' };
    }
    if (looseEmpty) return { el: looseEmpty, type: 'loose', t: +looseEmpty.dataset.t, g: +looseEmpty.dataset.g };
    if (lane) return { el: lane, type: 'lane', t: +lane.dataset.t };
    return null;
  }

  function clearDropHints() {
    document.querySelectorAll('.org-drop-before,.org-drop-after,.org-drop-merge,.org-drop-into').forEach((el) =>
      el.classList.remove('org-drop-before', 'org-drop-after', 'org-drop-merge', 'org-drop-into'));
  }

  function showHint(src, tgt) {
    clearDropHints();
    if (!tgt) return;
    if (src.kind === 'section') {
      if (tgt.type === 'before') tgt.el.classList.add('org-drop-before');
      else if (tgt.type === 'after') tgt.el.classList.add('org-drop-after');
      else if (tgt.type === 'merge') tgt.el.classList.add('org-drop-merge');
      else tgt.el.classList.add('org-drop-into');
    } else if (src.kind === 'group') {
      if (tgt.type === 'group') tgt.el.classList.add(tgt.half === 'before' ? 'org-drop-before' : 'org-drop-after');
      else if (tgt.type === 'lane') tgt.el.classList.add('org-drop-into');
    }
  }

  function commitMove(src, tgt) {
    if (!tgt) return;
    if (src.kind === 'section') {
      if (tgt.type === 'merge') {
        if (tgt.t === src.t && tgt.g === src.g && tgt.s === src.s) return;
        return promptMerge(src, tgt);
      }
      if (tgt.type === 'before' || tgt.type === 'after') {
        if (tgt.t === src.t && tgt.g === src.g && tgt.s === src.s) return;
        return moveSection(src, tgt.t, tgt.g, tgt.s + (tgt.type === 'after' ? 1 : 0));
      }
      if (tgt.type === 'group' || tgt.type === 'loose') return moveSection(src, tgt.t, tgt.g, Infinity);
      if (tgt.type === 'lane') {
        ensureLoose(model.tabs[tgt.t]);
        return moveSection(src, tgt.t, model.tabs[tgt.t].groups.findIndex((g) => g.name === null), Infinity);
      }
    } else if (src.kind === 'group') {
      if (tgt.type === 'group') {
        const dstIsLoose = model.tabs[tgt.t].groups[tgt.g].name === null;
        const at = dstIsLoose ? tgt.g : tgt.g + (tgt.half === 'after' ? 1 : 0);
        return moveGroup(src, tgt.t, at);
      }
      if (tgt.type === 'lane') return moveGroup(src, tgt.t, Infinity);
    }
  }

  // ---------- moves ----------

  function takeSection(src) {
    return model.tabs[src.t].groups[src.g].sections.splice(src.s, 1)[0];
  }

  function moveSection(src, dt, dg, ds) {
    const sec = model.tabs[src.t].groups[src.g].sections[src.s];
    if (!sec) return;
    const srcTab = model.tabs[src.t];
    const dstTab = model.tabs[dt];
    let dstGroup = dstTab.groups[Math.min(dg, dstTab.groups.length - 1)];
    if (!dstGroup) dstGroup = ensureLoose(dstTab);
    // name collision in the destination tab (sections are keyed by name per tab)
    if (dt !== src.t && model.tabs[dt].groups.some((g) => g.sections.some((s) => s.name === sec.name))) {
      toast(`"${sec.name}" already exists in ${dstTab.label} — rename one of them first, or merge instead`);
      return;
    }
    const same = (src.t === dt && dstGroup === model.tabs[src.t].groups[src.g]);
    takeSection(src);
    let at = Math.min(ds === Infinity ? dstGroup.sections.length : ds, dstGroup.sections.length);
    if (same && ds !== Infinity && ds > src.s) at = ds - 1;
    dstGroup.sections.splice(at, 0, sec);
    const gLabel = dstGroup.name || 'Ungrouped';
    const where = dstTab === srcTab
      ? (same ? 'reordered' : `→ ${gLabel}`)
      : `${srcTab.label} → ${dstTab.label} / ${gLabel}`;
    logChange(`Move "${sec.name}" ${where}`);
    refresh();
  }

  function moveGroup(src, dt, dg) {
    if (model.tabs[src.t].groups[src.g].name === null) return; // Ungrouped bucket stays put
    const g = model.tabs[src.t].groups.splice(src.g, 1)[0];
    const dstTab = model.tabs[dt];
    // keep the Ungrouped bucket last
    const looseIdx = dstTab.groups.findIndex((x) => x.name === null);
    const cap = looseIdx < 0 ? dstTab.groups.length : looseIdx;
    let at = dg === Infinity ? cap : Math.min(dg, cap);
    if (src.t === dt && dg !== Infinity && dg > src.g) at = Math.min(dg - 1, cap);
    dstTab.groups.splice(at, 0, g);
    logChange(src.t === dt
      ? `Reorder group "${g.name}"`
      : `Move group "${g.name}" ${model.tabs[src.t].label} → ${dstTab.label}`);
    refresh();
  }

  // ---------- merge confirm ----------

  function removeConfirmBar() { document.querySelector('.org-confirm-bar')?.remove(); }

  function promptMerge(src, dst) {
    const s = model.tabs[src.t].groups[src.g].sections[src.s];
    const d = model.tabs[dst.t].groups[dst.g].sections[dst.s];
    if (!s || !d) return;
    removeConfirmBar();
    const bar = document.createElement('div');
    bar.className = 'org-confirm-bar';
    bar.innerHTML = `
      <span>Merge <b>${escapeHtml(s.name)}</b> (${s.items.length} rows) into <b>${escapeHtml(d.name)}</b>?
      Its rows move over and the emptied section is removed.</span>
      <button type="button" class="btn org-apply-btn" data-mg="yes">Merge</button>
      <button type="button" class="btn btn-secondary" data-mg="no">Cancel</button>`;
    document.body.appendChild(bar);
    bar.querySelector('[data-mg="no"]').addEventListener('click', removeConfirmBar);
    bar.querySelector('[data-mg="yes"]').addEventListener('click', () => {
      removeConfirmBar();
      d.items = d.items.concat(s.items);
      if (drawerSec === s) drawerSec = null;
      takeSection(src);
      logChange(`Merge "${s.name}" into "${d.name}"`);
      refresh();
    });
  }

  // ---------- click-and-place ----------

  function armPlace(src, name) {
    placing = src;
    document.body.classList.add('org-placing');
    const banner = document.getElementById('org-place-banner');
    const label = document.getElementById('org-place-name');
    if (label) label.textContent = name;
    if (banner) banner.hidden = false;
    refresh();
  }

  function cancelPlace() {
    placing = null;
    document.body.classList.remove('org-placing');
    const banner = document.getElementById('org-place-banner');
    if (banner) banner.hidden = true;
    clearDropHints();
    document.querySelectorAll('.org-armed').forEach((el) => el.classList.remove('org-armed'));
  }

  // ---------- section editor drawer ----------

  function findSec(sec) {
    for (let t = 0; t < model.tabs.length; t++)
      for (let g = 0; g < model.tabs[t].groups.length; g++) {
        const s = model.tabs[t].groups[g].sections.indexOf(sec);
        if (s >= 0) return { t, g, s };
      }
    return null;
  }

  function openDrawer(t, g, s) {
    drawerSec = model.tabs[t].groups[g].sections[s] || null;
    renderDrawer();
  }

  function closeDrawer() {
    drawerSec = null;
    const drawer = document.getElementById('org-drawer');
    if (drawer) drawer.hidden = true;
  }

  function renderDrawer() {
    const drawer = document.getElementById('org-drawer');
    if (!drawer) return;
    if (!drawerSec) { drawer.hidden = true; return; }
    const loc = findSec(drawerSec);
    if (!loc) { closeDrawer(); return; }
    const tab = model.tabs[loc.t];
    const grp = tab.groups[loc.g];
    drawer.hidden = false;
    drawer.innerHTML = `
      <div class="org-drawer-head">
        <div class="org-drawer-row1">
          <input class="org-drawer-name" value="${escapeHtml(drawerSec.name)}" title="Section name — edit and press Enter">
          <button type="button" class="org-drawer-close" title="Close">&#x2715;</button>
        </div>
        <div class="org-drawer-crumb">${escapeHtml(tab.label)} &rsaquo; <b>${escapeHtml(grp.name || 'Ungrouped')}</b> &middot; ${drawerSec.items.length} row${drawerSec.items.length === 1 ? '' : 's'}</div>
        <div class="org-drawer-actions">
          <button type="button" class="org-drawer-move">&#x2725; Move this section&hellip;</button>
          <button type="button" class="org-drawer-delete">Delete section</button>
        </div>
      </div>
      <div class="org-drawer-body">
        <table class="org-rows-table">
          <thead><tr><th>Name</th><th class="org-col-labor">Labor</th><th class="org-col-price">Price</th><th class="org-col-del"></th></tr></thead>
          <tbody>
            ${drawerSec.items.map((r, i) => `
            <tr>
              <td><input data-i="${i}" data-f="name" value="${escapeHtml(r.name)}"></td>
              <td><input data-i="${i}" data-f="labor" class="org-num" value="${escapeHtml(r.labor ?? 0)}"></td>
              <td><input data-i="${i}" data-f="price" class="org-num" value="${escapeHtml(r.price ?? '')}"></td>
              <td><button type="button" class="org-del-row" data-i="${i}" title="Remove row">&#x1F5D1;</button></td>
            </tr>`).join('')}
          </tbody>
        </table>
        <button type="button" class="org-add-row">+ Add row</button>
      </div>
      <div class="org-drawer-note">Edits stay in this preview &mdash; nothing is written to the book yet.</div>`;

    drawer.querySelector('.org-drawer-close').addEventListener('click', closeDrawer);
    drawer.querySelector('.org-drawer-move').addEventListener('click', () => {
      const l = findSec(drawerSec);
      const name = drawerSec.name;
      closeDrawer();
      if (l) armPlace({ kind: 'section', t: l.t, g: l.g, s: l.s }, name);
    });
    drawer.querySelector('.org-drawer-delete').addEventListener('click', () => {
      const l = findSec(drawerSec);
      if (!l) return;
      const name = drawerSec.name;
      model.tabs[l.t].groups[l.g].sections.splice(l.s, 1);
      logChange(`Delete section "${name}"`);
      closeDrawer();
      refresh();
    });
    drawer.querySelector('.org-drawer-name').addEventListener('change', (e) => {
      const v = e.target.value.trim();
      if (!v || v === drawerSec.name) return;
      const l = findSec(drawerSec);
      if (l && model.tabs[l.t].groups.some((g) => g.sections.some((x) => x !== drawerSec && x.name === v))) {
        toast(`"${v}" already exists in ${model.tabs[l.t].label}`);
        renderDrawer();
        return;
      }
      logChange(`Rename "${drawerSec.name}" → "${v}"`);
      drawerSec.name = v;
      refresh();
    });
    drawer.querySelector('.org-drawer-body').addEventListener('change', (e) => {
      const inp = e.target.closest('input[data-i]');
      if (!inp) return;
      const row = drawerSec.items[+inp.dataset.i];
      if (!row) return;
      const f = inp.dataset.f;
      if (f === 'name') row.name = inp.value;
      else if (f === 'labor') row.labor = Number(inp.value) || 0;
      else row.price = inp.value.trim();
      logChange(`Edit rows in "${drawerSec.name}"`);
      refresh();
    });
    drawer.querySelector('.org-drawer-body').addEventListener('click', (e) => {
      const del = e.target.closest('.org-del-row');
      if (del) {
        drawerSec.items.splice(+del.dataset.i, 1);
        logChange(`Edit rows in "${drawerSec.name}"`);
        refresh();
        return;
      }
      if (e.target.closest('.org-add-row')) {
        drawerSec.items.push({ name: 'New row', labor: 0, price: '' });
        logChange(`Edit rows in "${drawerSec.name}"`);
        refresh();
      }
    });
  }

  // ---------- search ----------

  function applySearch() {
    const q = (document.getElementById('org-search')?.value || '').trim().toLowerCase();
    document.querySelectorAll('.org-chip').forEach((chip) => {
      chip.classList.remove('org-dim', 'org-hit');
      if (!q) return;
      const name = chip.querySelector('.org-cname').textContent.toLowerCase();
      chip.classList.add(name.includes(q) ? 'org-hit' : 'org-dim');
    });
  }

  // ---------- misc ----------

  function nextName(existing, base) {
    let n = base;
    let i = 2;
    while (existing.includes(n)) n = `${base} ${i++}`;
    return n;
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'org-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  function leave() {
    cancelPlace();
    removeConfirmBar();
    drawerSec = null;
    TakeoffApp.navigateToManifest();
    TakeoffApp.showLaborBookModal();
  }

  // ---------- listeners ----------

  function attachListeners() {
    const board = document.getElementById('org-board');
    if (!board) return;
    board.innerHTML = boardHtml();
    renderTray();
    renderDrawer();
    applySearch();

    document.getElementById('org-back-btn')?.addEventListener('click', leave);
    document.getElementById('org-search')?.addEventListener('input', refresh);
    document.getElementById('org-place-cancel')?.addEventListener('click', cancelPlace);

    document.getElementById('org-discard-btn')?.addEventListener('click', () => {
      enter();
      cancelPlace();
      removeConfirmBar();
      refresh();
    });
    document.getElementById('org-apply-btn')?.addEventListener('click', () => {
      toast(`Preview only — applying ${changes.length} change${changes.length === 1 ? '' : 's'} to the book is a later step; nothing was saved`);
    });

    // -- native drag & drop --
    board.addEventListener('dragstart', (e) => {
      if (placing) { e.preventDefault(); return; }
      const chip = e.target.closest('.org-chip');
      const ghead = e.target.closest('.org-group-head');
      if (chip) {
        drag = { kind: 'section', t: +chip.dataset.t, g: +chip.dataset.g, s: +chip.dataset.s };
        chip.classList.add('org-dragging');
      } else if (ghead && !ghead.closest('.org-ungrouped')) {
        drag = { kind: 'group', t: +ghead.dataset.t, g: +ghead.dataset.g };
        ghead.classList.add('org-dragging');
      }
      if (drag) e.dataTransfer.effectAllowed = 'move';
    });
    board.addEventListener('dragend', () => {
      drag = null;
      clearDropHints();
      board.querySelectorAll('.org-dragging').forEach((el) => el.classList.remove('org-dragging'));
    });
    board.addEventListener('dragover', (e) => {
      if (!drag) return;
      e.preventDefault();
      showHint(drag, resolveTarget(e));
    });
    board.addEventListener('drop', (e) => {
      if (!drag) return;
      e.preventDefault();
      const src = drag;
      drag = null;
      clearDropHints();
      commitMove(src, resolveTarget(e));
    });

    // -- click-and-place hints --
    board.addEventListener('mousemove', (e) => {
      if (!placing) return;
      showHint(placing, resolveTarget(e));
    });

    // -- clicks --
    board.addEventListener('click', (e) => {
      if (placing) {
        const tgt = resolveTarget(e);
        const src = placing;
        if (tgt && tgt.type !== 'lane' && tgt.el.classList.contains('org-armed')) { cancelPlace(); return; }
        cancelPlace();
        commitMove(src, tgt);
        return;
      }

      const btn = e.target.closest('[data-act]');
      if (btn) {
        const act = btn.dataset.act;
        if (act === 'collapse') {
          const k = btn.dataset.key;
          if (collapsed.has(k)) collapsed.delete(k); else collapsed.add(k);
          refresh();
        } else if (act === 'add-group') {
          const t = +btn.dataset.t;
          const name = nextName(model.tabs[t].groups.map((g) => g.name), 'New Group');
          const looseIdx = model.tabs[t].groups.findIndex((g) => g.name === null);
          model.tabs[t].groups.splice(looseIdx < 0 ? model.tabs[t].groups.length : looseIdx, 0, { name, sections: [] });
          logChange(`New group "${name}" in ${model.tabs[t].label}`);
          refresh();
        } else if (act === 'add-sec') {
          const t = +btn.dataset.t;
          const g = +btn.dataset.g;
          const grp = model.tabs[t].groups[g];
          const name = nextName(model.tabs[t].groups.flatMap((x) => x.sections.map((s) => s.name)), 'New Section');
          grp.sections.push({ name, items: [] });
          logChange(`New section "${name}" in ${grp.name || model.tabs[t].label + ' / Ungrouped'}`);
          refresh();
        } else if (act === 'pick-sec') {
          const chip = btn.closest('.org-chip');
          armPlace({ kind: 'section', t: +chip.dataset.t, g: +chip.dataset.g, s: +chip.dataset.s },
            chip.querySelector('.org-cname').textContent);
        } else if (act === 'pick-group') {
          const gh = btn.closest('.org-group-head');
          armPlace({ kind: 'group', t: +gh.dataset.t, g: +gh.dataset.g },
            'group "' + gh.querySelector('.org-gname').textContent + '"');
        } else if (act === 'edit-sec') {
          const chip = btn.closest('.org-chip');
          openDrawer(+chip.dataset.t, +chip.dataset.g, +chip.dataset.s);
        }
        return;
      }

      const chip = e.target.closest('.org-chip');
      if (chip) openDrawer(+chip.dataset.t, +chip.dataset.g, +chip.dataset.s);
    });

    // -- group rename on double-click (section rename lives in the drawer) --
    board.addEventListener('dblclick', (e) => {
      if (placing) return;
      const nameEl = e.target.closest('.org-gname');
      if (!nameEl || nameEl.closest('.org-ungrouped')) return;
      const holder = nameEl.closest('.org-group-head');
      const target = model.tabs[+holder.dataset.t].groups[+holder.dataset.g];
      const old = target.name;
      const input = document.createElement('input');
      input.className = 'org-gname-input';
      input.value = old;
      nameEl.replaceWith(input);
      input.focus();
      input.select();
      const commit = () => {
        const v = input.value.trim();
        if (v && v !== old) {
          target.name = v;
          logChange(`Rename group "${old}" → "${v}"`);
        }
        refresh();
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') input.blur();
        if (ev.key === 'Escape') { input.value = old; input.blur(); }
      });
    });
  }

  // One-time: Escape cancels place mode, then closes the drawer.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (TakeoffState.getCurrentView() !== 'organize') return;
    if (placing) { cancelPlace(); return; }
    if (drawerSec) closeDrawer();
  });

  return { render, attachListeners, enter };
})();
