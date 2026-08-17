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

  function render() {
    const body = document.getElementById('suggestions-modal-body');
    if (!body) return;
    const countEl = document.getElementById('suggestions-pending-count');
    if (countEl) {
      countEl.textContent = `${groups.length} pending`;
      countEl.hidden = false;
    }
    const dlBtn = document.getElementById('suggestions-download-btn');
    if (dlBtn) {
      dlBtn.textContent = `Download accepted (${acceptedGroupCount}) as defaults patch`;
      dlBtn.disabled = acceptedGroupCount === 0;
    }
    if (!groups.length) {
      body.innerHTML = '<p class="sugg-empty">No pending suggestions. As users share corrections they show up here.</p>';
      return;
    }
    body.innerHTML = groups
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
    const [pending, accepted] = await Promise.all([
      TakeoffCloud.fetchSuggestions('pending'),
      TakeoffCloud.fetchSuggestions('accepted'),
    ]);
    if (pending.error) {
      if (body) body.innerHTML = `<p class="sugg-empty">Could not load suggestions: ${escapeHtml(pending.error)}</p>`;
      return;
    }
    groups = aggregate(pending.data);
    acceptedGroupCount = aggregate(accepted.data || []).length;
    render();
  }

  async function resolveGroup(index, status) {
    const g = groups[index];
    if (!g) return;
    const err = await TakeoffCloud.setSuggestionStatus(g.ids, status);
    if (err) {
      alert('Could not update: ' + err);
      return;
    }
    groups.splice(index, 1);
    if (status === 'accepted') acceptedGroupCount++;
    render();
  }

  async function downloadAcceptedPatch() {
    const { data, error } = await TakeoffCloud.fetchSuggestions('accepted');
    if (error) {
      alert('Could not load accepted suggestions: ' + error);
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
