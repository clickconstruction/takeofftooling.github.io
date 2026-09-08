/**
 * TakeoffHandoff — the manifest onward to PipeTooling ("Copy for PipeTooling").
 *
 * v0 of the TakeoffTooling → PipeTooling seam: emits EXACTLY the text
 * PipeTooling's Counts import already reads from CountTooling (Bids → Counts
 * → Import from /Tooling), so an electrical bid's counts land on a bid with
 * no PipeTooling change. Prices and labor do not travel yet (that is the v1
 * priced handoff, which needs a PipeTooling import of priced rows).
 *
 * Format (one row per line, tab-separated; mirrors CountTooling's export and
 * PipeTooling's parseCountsImportText):
 *   [Group] Name \t quantity \t pages          — a count (unit ea)
 *   [Group] ft of Name \t 143.00 \t pages      — a length in feet
 *   [Group] px of Name \t 1840 \t pages        — an unscaled run (kept as px
 *                                                so PipeTooling flags it too)
 *     [Group] Child \t 15 \t pages             — two-space indent = child
 *   <blank>
 *   View link:\t<the project's CountTooling plans link>   (when it has one)
 * Rows with no description, or qty 0, are left out; other-charge rows
 * (permits, power co, temporary power) are not counts and are left out too.
 *
 * buildPipeToolingText is pure (unit-tested in handoff.test.js);
 * copyForPipeTooling is the button.
 */
const TakeoffHandoff = (function () {
  const OTHER_TYPES = ['permits', 'powerCoCharges', 'temporaryPower'];

  function fmtQty(item) {
    const q = Number(item.quantity) || 0;
    if (item.unit === 'ft') return q.toFixed(2);
    if (item.unit === 'px') return String(Math.round(q));
    return String(Math.round(q * 100) / 100);
  }

  function rowText(item, indent, inheritedGroup) {
    const group = item.group || inheritedGroup || null;
    const prefix = (group ? '[' + group + '] ' : '') + (item.unit === 'ft' ? 'ft of ' : item.unit === 'px' ? 'px of ' : '');
    return indent + prefix + (item.description || '').trim() + '\t' + fmtQty(item) + '\t' + (item.planPage || '').trim();
  }

  /**
   * @param {Array} manifest  top-level items with nested children
   * @param {{ plansUrl?: string }} [project]
   * @returns {{ text: string, counts: number, feet: number, unscaled: number, rows: number }}
   */
  function buildPipeToolingText(manifest, project) {
    const lines = [];
    let counts = 0, feet = 0, unscaled = 0;
    const tally = (item) => {
      if (item.unit === 'px') unscaled++;
      else if (item.unit === 'ft') feet++;
      else counts++;
    };
    for (const item of manifest || []) {
      if (item.parentId) continue;
      if (OTHER_TYPES.includes(item.type)) continue;
      const desc = (item.description || '').trim();
      const qty = Number(item.quantity) || 0;
      if (!desc || qty <= 0) continue;
      lines.push(rowText(item, '', null));
      tally(item);
      for (const child of item.children || []) {
        const cdesc = (child.description || '').trim();
        const cqty = Number(child.quantity) || 0;
        if (!cdesc || cqty <= 0) continue;
        lines.push(rowText({ ...child, planPage: child.planPage || item.planPage }, '  ', item.group));
        tally(child);
      }
    }
    let text = lines.join('\n');
    const plans = project && typeof project.plansUrl === 'string' ? project.plansUrl.trim() : '';
    if (text && plans) text += '\n\nView link:\t' + plans;
    return { text, counts, feet, unscaled, rows: lines.length };
  }

  function describe(r) {
    const parts = [];
    if (r.counts) parts.push(`${r.counts} count${r.counts === 1 ? '' : 's'}`);
    if (r.feet) parts.push(`${r.feet} line type${r.feet === 1 ? '' : 's'}`);
    if (r.unscaled) parts.push(`${r.unscaled} unscaled`);
    return parts.join(' · ');
  }

  async function copyForPipeTooling() {
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

  return { buildPipeToolingText, copyForPipeTooling };
})();

// Node (unit tests); inert in the browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TakeoffHandoff;
}
