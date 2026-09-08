/**
 * TakeoffSuggestionsReview — the admin-only review panel for shared-book
 * corrections (public.takeoff_suggestions, written by js/cloud.js).
 *
 * Pending suggestions are aggregated per part (distinct users, median of the
 * proposed values, outlier flag), and Accept/Dismiss updates their status.
 * Accepting never touches the shipped book directly: "Download accepted as
 * defaults patch" produces a JSON to apply to js/data/laborBookDefaults.js
 * and commit — the same trust model as the supplier-price flow.
 *
 * The menu item (#review-suggestions-btn) is unhidden by cloud.js updateUi
 * only for the admin account; RLS is what actually scopes the data.
 */
const TakeoffSuggestionsReview = (function () {
  const escapeHtml = (s) => TakeoffUtils.escapeHtml(s);

  let groups = []; // aggregated pending suggestions
  let layouts = []; // pending layout suggestions (one per user; 003 migration)
  let acceptedGroupCount = 0;

  function median(nums) {
    const list = nums.filter((n) => typeof n === 'number' && !isNaN(n)).sort((a, b) => a - b);
    if (!list.length) return null;
    const mid = Math.floor(list.length / 2);
    return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
  }

  function aggregate(rows) {
    const byKey = new Map();
    for (const r of rows) {
      const key = JSON.stringify([r.kind, r.tab, r.section, r.part_name]);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(r);
    }
    const out = [];
    for (const rowsForKey of byKey.values()) {
      const first = rowsForKey[0];
      const users = new Set(rowsForKey.map((r) => r.user_id)).size;
      const medPrice = median(rowsForKey.map((r) => parseFloat(r.new_value && r.new_value.price)));
      const medLabor = median(rowsForKey.map((r) => r.new_value && Number(r.new_value.labor)));
      const old = rowsForKey.find((r) => r.old_value)?.old_value || null;
      const oldPrice = old ? parseFloat(old.price) : null;
      // fat-finger guard: a proposed price 20x off the current default
      const outlier =
        first.kind === 'edit' && oldPrice > 0 && medPrice > 0 && (medPrice / oldPrice >= 20 || medPrice / oldPrice <= 0.05);
      out.push({
        kind: first.kind,
        tab: first.tab,
        section: first.section,
        name: first.part_name,
        ids: rowsForKey.map((r) => r.id),
        users,
        medPrice,
        medLabor,
        old,
        outlier,
      });
    }
    out.sort((a, b) => b.users - a.users || a.name.localeCompare(b.name));
    return out;
  }

  function fmtValue(labor, price) {
    const parts = [];
    if (labor != null && !isNaN(labor)) parts.push(labor + ' hrs');
    if (price != null && !isNaN(price)) parts.push('$' + Number(price).toFixed(2));
    return parts.join(' · ') || '—';
  }

  function usersBadge(g) {
    if (g.outlier) return '<span class="sugg-badge sugg-badge-outlier">outlier</span>';
    if (g.users >= 2) return `<span class="sugg-badge sugg-badge-agree">${g.users} users agree</span>`;
    return '<span class="sugg-badge sugg-badge-single">1 user</span>';
  }

  // Where each default section lives, for spotting cross-tab moves in a
  // shared layout ({sectionName: tab}; names are unique across tabs today).
  function defaultsHomeMap() {
    const home = {};
    for (const tab of Object.keys(LABOR_BOOK_DEFAULTS)) {
      for (const section of Object.keys(LABOR_BOOK_DEFAULTS[tab])) home[section] = tab;
    }
    return home;
  }

  function layoutMoves(value) {
    const home = defaultsHomeMap();
    const moves = [];
    for (const tab of Object.keys(value.order || {})) {
      for (const section of value.order[tab]) {
        if (home[section] && home[section] !== tab) moves.push({ section, from: home[section], to: tab });
      }
    }
    return moves;
  }

  function layoutHtml(row, i) {
    const value = row.value || {};
    const tabs = Object.keys(value.groups || {}).filter((t) => (value.groups[t] || []).length);
    const groupsSummary = tabs
      .map((t) => `${escapeHtml(t)}: ${value.groups[t].map((g) => `${escapeHtml(g.name)} (${g.sections.length})`).join(', ')}`)
      .join(' · ') || 'no custom groups';
    const moves = layoutMoves(value);
    const movesSummary = moves.length
      ? `<div class="sugg-layout-moves">moved: ${moves.map((m) => `${escapeHtml(m.section)} (${escapeHtml(m.from)} → ${escapeHtml(m.to)})`).join(', ')}</div>`
      : '';
    const when = row.updated_at ? new Date(row.updated_at).toLocaleDateString() : '';
    return `
      <div class="sugg-row sugg-layout-row" data-layout-index="${i}">
        <div class="sugg-part">
          <div class="sugg-name">Category layout</div>
          <div class="sugg-where">${escapeHtml(row.email || row.user_id)}${when ? ' · ' + escapeHtml(when) : ''}</div>
        </div>
        <div class="sugg-change">${groupsSummary}${movesSummary}</div>
        <div class="sugg-actions">
          <button type="button" class="btn btn-small sugg-layout-copy-btn" data-layout-index="${i}" title="Copy as a LABOR_BOOK_DEFAULT_GROUPS literal to hard-code into js/data/laborBookDefaults.js">Copy as code</button>
          <button type="button" class="btn btn-small sugg-accept-btn sugg-layout-accept-btn" data-layout-index="${i}">Accept</button>
          <button type="button" class="btn btn-small btn-secondary sugg-layout-dismiss-btn" data-layout-index="${i}">Dismiss</button>
        </div>
      </div>`;
  }

  function render() {
    const body = document.getElementById('suggestions-modal-body');
    if (!body) return;
    const countEl = document.getElementById('suggestions-pending-count');
    if (countEl) {
      countEl.textContent = `${groups.length + layouts.length} pending`;
      countEl.hidden = false;
    }
    const dlBtn = document.getElementById('suggestions-download-btn');
    if (dlBtn) {
      dlBtn.textContent = `Download accepted (${acceptedGroupCount}) as defaults patch`;
      dlBtn.disabled = acceptedGroupCount === 0;
    }
    if (!groups.length && !layouts.length) {
      body.innerHTML = '<p class="sugg-empty">No pending suggestions. As users share corrections they show up here.</p>';
      return;
    }
    const layoutBlock = layouts.length
      ? `<h3 class="sugg-section-title">Layout suggestions</h3>${layouts.map(layoutHtml).join('')}${groups.length ? '<h3 class="sugg-section-title">Part corrections</h3>' : ''}`
      : '';
    body.innerHTML = layoutBlock + groups
      .map((g, i) => {
        const change =
          g.kind === 'edit'
            ? `${escapeHtml(fmtValue(g.old && Number(g.old.labor), g.old && parseFloat(g.old.price)))} <span class="sugg-arrow">→</span> <strong>${escapeHtml(fmtValue(g.medLabor, g.medPrice))}</strong>`
            : g.kind === 'new'
              ? `<strong>${escapeHtml(fmtValue(g.medLabor, g.medPrice))}</strong> <span class="sugg-kind-label">new part</span>`
              : `<span class="sugg-kind-label">remove</span> (was ${escapeHtml(fmtValue(g.old && Number(g.old.labor), g.old && parseFloat(g.old.price)))})`;
        return `
        <div class="sugg-row" data-index="${i}">
          <div class="sugg-part">
            <div class="sugg-name">${escapeHtml(g.name)}</div>
            <div class="sugg-where">${escapeHtml(g.tab)} · ${escapeHtml(g.section)}</div>
          </div>
          <div class="sugg-change">${change}</div>
          ${usersBadge(g)}
          <div class="sugg-actions">
            <button type="button" class="btn btn-small sugg-accept-btn" data-index="${i}">Accept</button>
            <button type="button" class="btn btn-small btn-secondary sugg-dismiss-btn" data-index="${i}">Dismiss</button>
          </div>
        </div>`;
      })
      .join('');
  }

  async function load() {
    const body = document.getElementById('suggestions-modal-body');
    if (body) body.innerHTML = '<p class="sugg-empty">Loading…</p>';
    const [pending, accepted, pendingLayouts] = await Promise.all([
      TakeoffCloud.fetchSuggestions('pending'),
      TakeoffCloud.fetchSuggestions('accepted'),
      TakeoffCloud.fetchLayoutSuggestions('pending'),
    ]);
    if (pending.error) {
      if (body) body.innerHTML = `<p class="sugg-empty">Could not load suggestions: ${escapeHtml(pending.error)}</p>`;
      return;
    }
    groups = aggregate(pending.data);
    layouts = pendingLayouts.data || [];
    acceptedGroupCount = aggregate(accepted.data || []).length;
    render();
  }

  async function resolveLayout(index, status) {
    const row = layouts[index];
    if (!row) return;
    const err = await TakeoffCloud.setLayoutSuggestionStatus([row.user_id], status);
    if (err) {
      TakeoffUtils.toast('Could not update: ' + err, { kind: 'error' });
      return;
    }
    layouts.splice(index, 1);
    render();
  }

  // The hard-code artifact: a LABOR_BOOK_DEFAULT_GROUPS literal (tabs with
  // named groups only) plus comments for the moves/order the config can't
  // express — those need edits to LABOR_BOOK_DEFAULTS itself.
  async function copyLayoutCode(index) {
    const row = layouts[index];
    if (!row) return;
    const value = row.value || {};
    const groupsObj = {};
    for (const tab of Object.keys(value.groups || {})) {
      if ((value.groups[tab] || []).length) groupsObj[tab] = value.groups[tab];
    }
    const lines = [
      `// Category layout suggested by ${row.email || row.user_id}${row.updated_at ? ' on ' + row.updated_at.slice(0, 10) : ''}`,
      '// Paste into js/data/laborBookDefaults.js and bump LABOR_BOOK_DEFAULTS_VERSION.',
    ];
    const moves = layoutMoves(value);
    if (moves.length) {
      lines.push('// Cross-tab moves — relocate these sections inside LABOR_BOOK_DEFAULTS:');
      for (const m of moves) lines.push(`//   - ${JSON.stringify(m.section)}: ${m.from} → ${m.to}`);
    }
    lines.push(`const LABOR_BOOK_DEFAULT_GROUPS = ${JSON.stringify(groupsObj, null, 2)};`);
    if (value.order) {
      lines.push('// Section order per tab (reorder LABOR_BOOK_DEFAULTS keys to match):');
      for (const tab of Object.keys(value.order)) {
        if (value.order[tab].length) lines.push(`//   ${tab}: ${value.order[tab].join(' | ')}`);
      }
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      TakeoffUtils.toast('Layout copied as code');
    } catch (err) {
      TakeoffUtils.toast('Could not copy: ' + (err.message || 'clipboard unavailable'), { kind: 'error' });
    }
  }

  async function resolveGroup(index, status) {
    const g = groups[index];
    if (!g) return;
    const err = await TakeoffCloud.setSuggestionStatus(g.ids, status);
    if (err) {
      TakeoffUtils.toast('Could not update: ' + err, { kind: 'error' });
      return;
    }
    groups.splice(index, 1);
    if (status === 'accepted') acceptedGroupCount++;
    render();
  }

  async function downloadAcceptedPatch() {
    const { data, error } = await TakeoffCloud.fetchSuggestions('accepted');
    if (error) {
      TakeoffUtils.toast('Could not load accepted suggestions: ' + error, { kind: 'error' });
      return;
    }
    const changes = aggregate(data).map((g) => ({
      tab: g.tab,
      section: g.section,
      name: g.name,
      kind: g.kind,
      labor: g.medLabor,
      price: g.medPrice != null ? g.medPrice.toFixed(2) : null,
    }));
    const patch = {
      v: 1,
      app: 'takeoff-tooling',
      kind: 'labor-book-defaults-patch',
      generatedAt: new Date().toISOString(),
      note: 'Apply to js/data/laborBookDefaults.js and bump LABOR_BOOK_DEFAULTS_VERSION',
      changes,
    };
    const blob = new Blob([JSON.stringify(patch, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'labor-book-defaults-patch.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function openModal() {
    const modal = document.getElementById('suggestions-modal');
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'false');
    load();
  }

  function closeModal() {
    document.getElementById('suggestions-modal')?.setAttribute('aria-hidden', 'true');
  }

  // one-time listeners (delegated for the per-row buttons)
  document.getElementById('review-suggestions-btn')?.addEventListener('click', openModal);
  document.getElementById('suggestions-modal-close')?.addEventListener('click', closeModal);
  document.addEventListener('keydown', function suggestionsModalKeyHandler(e) {
    const modal = document.getElementById('suggestions-modal');
    if (!modal || modal.getAttribute('aria-hidden') !== 'false') return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
    }
  });
  document.getElementById('suggestions-refresh-btn')?.addEventListener('click', load);
  document.getElementById('suggestions-download-btn')?.addEventListener('click', downloadAcceptedPatch);
  document.getElementById('suggestions-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      closeModal();
      return;
    }
    const layoutCopy = e.target.closest('.sugg-layout-copy-btn');
    if (layoutCopy) {
      copyLayoutCode(Number(layoutCopy.dataset.layoutIndex));
      return;
    }
    const layoutAccept = e.target.closest('.sugg-layout-accept-btn');
    if (layoutAccept) {
      resolveLayout(Number(layoutAccept.dataset.layoutIndex), 'accepted');
      return;
    }
    const layoutDismiss = e.target.closest('.sugg-layout-dismiss-btn');
    if (layoutDismiss) {
      resolveLayout(Number(layoutDismiss.dataset.layoutIndex), 'dismissed');
      return;
    }
    const accept = e.target.closest('.sugg-accept-btn');
    if (accept) {
      resolveGroup(Number(accept.dataset.index), 'accepted');
      return;
    }
    const dismiss = e.target.closest('.sugg-dismiss-btn');
    if (dismiss) resolveGroup(Number(dismiss.dataset.index), 'dismissed');
  });

  return { openModal, load };
})();
