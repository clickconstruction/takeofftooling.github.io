/**
 * TakeoffViewShared — bits shared across views (icons, overage logic).
 * Loaded before the view files.
 */

const TakeoffViewShared = (function () {
  const TRASH_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" class="trash-icon"><path d="M232.7 69.9L224 96L128 96C110.3 96 96 110.3 96 128C96 145.7 110.3 160 128 160L512 160C529.7 160 544 145.7 544 128C544 110.3 529.7 96 512 96L416 96L407.3 69.9C402.9 56.8 390.7 48 376.9 48L263.1 48C249.3 48 237.1 56.8 232.7 69.9zM512 208L128 208L149.1 531.1C150.7 556.4 171.7 576 197 576L443 576C468.3 576 489.3 556.4 490.9 531.1L512 208z"/></svg>';
  const BOOK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" class="labor-book-icon"><path d="M480 576L192 576C139 576 96 533 96 480L96 160C96 107 139 64 192 64L496 64C522.5 64 544 85.5 544 112L544 400C544 420.9 530.6 438.7 512 445.3L512 512C529.7 512 544 526.3 544 544C544 561.7 529.7 576 512 576L480 576zM192 448C174.3 448 160 462.3 160 480C160 497.7 174.3 512 192 512L448 512L448 448L192 448zM224 216C224 229.3 234.7 240 248 240L424 240C437.3 240 448 229.3 448 216C448 202.7 437.3 192 424 192L248 192C234.7 192 224 202.7 224 216zM248 288C234.7 288 224 298.7 224 312C224 325.3 234.7 336 248 336L424 336C437.3 336 448 325.3 448 312C448 298.7 437.3 288 424 288L248 288z"/></svg>';
  // corner-down-right arrow: "add a child underneath this row"
  const CHILD_ARROW_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="child-arrow-icon" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4v8a2 2 0 0 0 2 2h9"/><path d="m13 9 5 5-5 5"/></svg>';

  // Additional length from an overage % (ceil'd); null/absent percent → 0.
  // Shared by the conduit wizard step 3 and the wire flow.
  function computeOverage(baseLength, overagePercent) {
    const additional = overagePercent != null ? Math.ceil(baseLength * (overagePercent / 100)) : 0;
    return { additional, totalQty: baseLength + additional };
  }

  /**
   * The overage picker section (preset % buttons + input + computed total).
   * noun: 'Conduit' | 'Wire' — used in the total line. inputId differs per
   * flow so each flow's listeners stay unchanged.
   */
  function renderOverageSection({ inputId, noun, baseLength, overagePercent }) {
    const { additional, totalQty } = computeOverage(baseLength, overagePercent);
    return `
        <div class="flow-section">
          <h3>Overage</h3>
          <p>Select overage percentage:</p>
          <div class="overage-buttons">
            <button type="button" data-percent="5">5%</button>
            <button type="button" data-percent="10">10%</button>
            <button type="button" data-percent="15">15%</button>
            <button type="button" data-percent="20">20%</button>
          </div>
          <label>Overage % <input type="number" id="${inputId}" value="${overagePercent ?? ''}" min="0" max="100" step="1" placeholder="0" /></label>
          <p><strong>${noun} quantity:</strong> ${baseLength} + ${additional} additional = <strong>${totalQty}</strong> total</p>
        </div>`;
  }

  // ---------- price provenance (who priced it, when, how stale) ----------

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // Whole days since a YYYY-MM-DD date; null when absent/unparsable.
  function priceAgeDays(pricedAt) {
    if (!pricedAt) return null;
    const t = new Date(pricedAt + 'T00:00:00').getTime();
    if (Number.isNaN(t)) return null;
    return Math.max(0, Math.floor((Date.now() - t) / 86400000));
  }

  /**
   * The provenance badge: "Elliot · 30d" with a freshness dot (fresh < 30d,
   * aging 30–90d, stale > 90d, none when no date recorded). opts.button
   * renders a <button> (curated rows open the edit popover); opts.data is a
   * pre-escaped data-attribute string carried onto the element. Pass
   * opts.hasPrice: false for a row with no price at all — instead of a noisy
   * "no date" badge it renders a quiet "+ price" affordance (still the part
   * card's click target).
   */
  function renderPriceProvenance(source, pricedAt, opts = {}) {
    const esc = TakeoffUtils.escapeHtml;
    if (opts.hasPrice === false && !source && !pricedAt) {
      const attrs = `class="lb-prov-badge lb-prov-empty" title="No price yet — record a quote"${opts.data || ''}`;
      return opts.button ? `<button type="button" ${attrs}>+ price</button>` : `<span ${attrs}>+ price</span>`;
    }
    const days = priceAgeDays(pricedAt);
    let cls = 'none';
    let label = source ? esc(source) : 'no date';
    if (days !== null) {
      cls = days < 30 ? 'fresh' : days <= 90 ? 'aging' : 'stale';
      const age = days === 0 ? 'today' : `${days}d`;
      label = source ? `${esc(source)} · ${age}` : age;
    }
    const title = pricedAt ? `Price recorded ${esc(pricedAt)}${source ? ' from ' + esc(source) : ''}` : 'No price date recorded';
    const attrs = `class="lb-prov-badge lb-prov-${cls}" title="${title}"${opts.data || ''}`;
    return opts.button
      ? `<button type="button" ${attrs}><i></i>${label}</button>`
      : `<span ${attrs}><i></i>${label}</span>`;
  }

  return { TRASH_SVG, BOOK_SVG, CHILD_ARROW_SVG, computeOverage, renderOverageSection, todayISO, priceAgeDays, renderPriceProvenance };
})();
