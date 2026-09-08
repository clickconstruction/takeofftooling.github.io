// TakeoffHandoff — the manifest onward to PipeTooling.
//
// Two pure builders (UMD: `TakeoffHandoff` in the browser and in Deno via the
// byte-identical copy in supabase/functions/_shared/handoff.js; module.exports
// under node:test — handoff.test.js, kernel-copies.test.js) and one button.
//
// buildPipeToolingText — v0 of the TakeoffTooling → PipeTooling seam: EXACTLY the
// text PipeTooling's Counts import already reads from CountTooling (Bids → Counts →
// Import from /Tooling), so an electrical bid's counts land on a bid with no
// PipeTooling change. Format (one row per line, tab-separated):
//   [Group] Name \t quantity \t pages          — a count (unit ea)
//   [Group] ft of Name \t 143.00 \t pages      — a length in feet
//   [Group] px of Name \t 1840 \t pages        — an unscaled run (kept as px so
//                                                PipeTooling flags it too)
//     [Group] Child \t 15 \t pages             — two-space indent = child
//   <blank>
//   View link:\t<the project's CountTooling plans link>   (when it has one)
// Rows with no description or qty 0 are left out; other-charge rows (permits,
// power co, temporary power) are not counts and are left out too.
//
// buildPipeToolingRows — v1, the priced shape: the same rows as structured data
// with unit cost and labor hours per row, for PipeTooling's paste_counts (and any
// harness) to read through the manage-user bridge's twin_manifest verb.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TakeoffHandoff = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const OTHER_TYPES = ['permits', 'powerCoCharges', 'temporaryPower'];

  function fmtQty(item) {
    const q = Number(item.quantity) || 0;
    if (item.unit === 'ft') return q.toFixed(2);
    if (item.unit === 'px') return String(Math.round(q));
    return String(Math.round(q * 100) / 100);
  }

  function fixtureName(item, inheritedGroup) {
    const group = item.group || inheritedGroup || null;
    const prefix = (group ? '[' + group + '] ' : '') + (item.unit === 'ft' ? 'ft of ' : item.unit === 'px' ? 'px of ' : '');
    return prefix + (item.description || '').trim();
  }

  function rowText(item, indent, inheritedGroup) {
    return indent + fixtureName(item, inheritedGroup) + '\t' + fmtQty(item) + '\t' + (item.planPage || '').trim();
  }

  // Parent rows and their children, in display order, with the filters the text
  // export applies. Yields { item, parent } so both builders walk one list.
  function walk(manifest) {
    const out = [];
    for (const item of manifest || []) {
      if (item.parentId) continue;
      if (OTHER_TYPES.includes(item.type)) continue;
      const desc = (item.description || '').trim();
      const qty = Number(item.quantity) || 0;
      if (!desc || qty <= 0) continue;
      out.push({ item, parent: null });
      for (const child of item.children || []) {
        const cdesc = (child.description || '').trim();
        const cqty = Number(child.quantity) || 0;
        if (!cdesc || cqty <= 0) continue;
        out.push({ item: child, parent: item });
      }
    }
    return out;
  }

  /**
   * @param {Array} manifest  top-level items with nested children
   * @param {{ plansUrl?: string }} [project]
   * @returns {{ text: string, counts: number, feet: number, unscaled: number, rows: number }}
   */
  function buildPipeToolingText(manifest, project) {
    const lines = [];
    let counts = 0, feet = 0, unscaled = 0;
    for (const { item, parent } of walk(manifest)) {
      if (parent) lines.push(rowText({ ...item, planPage: item.planPage || parent.planPage }, '  ', parent.group));
      else lines.push(rowText(item, '', null));
      if (item.unit === 'px') unscaled++;
      else if (item.unit === 'ft') feet++;
      else counts++;
    }
    let text = lines.join('\n');
    const plans = project && typeof project.plansUrl === 'string' ? project.plansUrl.trim() : '';
    if (text && plans) text += '\n\nView link:\t' + plans;
    return { text, counts, feet, unscaled, rows: lines.length };
  }

  const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

  /**
   * The priced rows. Each: { fixture (PipeTooling's name convention, group + unit
   * prefixes intact), description, count, unit, page, group, is_child, parent,
   * unit_cost (price per unit, null when unpriced), labor_hours (per unit),
   * extended_cost, extended_hours, type }.
   */
  function buildPipeToolingRows(manifest, project) {
    const rows = [];
    for (const { item, parent } of walk(manifest)) {
      const unit = item.unit || 'ea';
      const qty = Number(item.quantity) || 0;
      const px = unit === 'px';
      const cost = px ? null : toNum(item.price);
      const hours = px ? null : toNum(item.labor);
      rows.push({
        fixture: fixtureName(parent ? item : item, parent ? parent.group : null),
        description: (item.description || '').trim(),
        count: unit === 'ft' ? Math.round(qty * 100) / 100 : px ? Math.round(qty) : Math.round(qty * 100) / 100,
        unit,
        page: ((parent && !item.planPage ? parent.planPage : item.planPage) || '').trim() || null,
        group: item.group || (parent ? parent.group : null) || null,
        is_child: !!parent,
        parent: parent ? (parent.description || '').trim() : null,
        type: item.type || (parent ? parent.type : null) || null,
        unit_cost: cost != null && cost > 0 ? cost : null,
        labor_hours: hours != null && hours > 0 ? hours : null,
        extended_cost: cost != null && cost > 0 ? Math.round(cost * qty * 100) / 100 : null,
        extended_hours: hours != null && hours > 0 ? Math.round(hours * qty * 100) / 100 : null,
      });
    }
    void project;
    return rows;
  }

  function describe(r) {
    const parts = [];
    if (r.counts) parts.push(`${r.counts} count${r.counts === 1 ? '' : 's'}`);
    if (r.feet) parts.push(`${r.feet} line type${r.feet === 1 ? '' : 's'}`);
    if (r.unscaled) parts.push(`${r.unscaled} unscaled`);
    return parts.join(' · ');
  }

  // The header-menu button (browser only; TakeoffState / TakeoffUtils resolved at call time).
  async function copyForPipeTooling() {
    /* global TakeoffState, TakeoffUtils */
    const result = buildPipeToolingText(TakeoffState.getManifest(), TakeoffState.getCurrentProject());
    if (!result.text) {
      TakeoffUtils.toast('Nothing to copy yet — the manifest has no described rows with a quantity.', { kind: 'error' });
      return false;
    }
    try {
      await navigator.clipboard.writeText(result.text);
    } catch (err) {
      TakeoffUtils.toast('Could not reach the clipboard. Allow clipboard access and try again.', { kind: 'error' });
      return false;
    }
    const plans = TakeoffState.getCurrentProject().plansUrl ? ' Plans link included.' : '';
    TakeoffUtils.toast(`Copied ${result.rows} rows for PipeTooling: ${describe(result)}. Paste into Bids → Counts → Import from /Tooling.${plans}`, { kind: 'success', durationMs: 6000 });
    return true;
  }

  return { buildPipeToolingText, buildPipeToolingRows, copyForPipeTooling };
});
