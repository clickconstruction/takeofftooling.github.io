/**
 * TakeoffViewShared — bits shared across views (icons, overage logic).
 * Loaded before the view files.
 */

const TakeoffViewShared = (function () {
  const TRASH_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" class="trash-icon"><path d="M232.7 69.9L224 96L128 96C110.3 96 96 110.3 96 128C96 145.7 110.3 160 128 160L512 160C529.7 160 544 145.7 544 128C544 110.3 529.7 96 512 96L416 96L407.3 69.9C402.9 56.8 390.7 48 376.9 48L263.1 48C249.3 48 237.1 56.8 232.7 69.9zM512 208L128 208L149.1 531.1C150.7 556.4 171.7 576 197 576L443 576C468.3 576 489.3 556.4 490.9 531.1L512 208z"/></svg>';
  const BOOK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" class="labor-book-icon"><path d="M480 576L192 576C139 576 96 533 96 480L96 160C96 107 139 64 192 64L496 64C522.5 64 544 85.5 544 112L544 400C544 420.9 530.6 438.7 512 445.3L512 512C529.7 512 544 526.3 544 544C544 561.7 529.7 576 512 576L480 576zM192 448C174.3 448 160 462.3 160 480C160 497.7 174.3 512 192 512L448 512L448 448L192 448zM224 216C224 229.3 234.7 240 248 240L424 240C437.3 240 448 229.3 448 216C448 202.7 437.3 192 424 192L248 192C234.7 192 224 202.7 224 216zM248 288C234.7 288 224 298.7 224 312C224 325.3 234.7 336 248 336L424 336C437.3 336 448 325.3 448 312C448 298.7 437.3 288 424 288L248 288z"/></svg>';
  // lightning bolt: the Explode button. It was the ⚡ emoji, which the emoji
  // font paints in its own colours — a white block among the row's grey icons,
  // deaf to `color`. As an SVG it inherits the icon button's colour and size.
  const BOLT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="explode-icon" fill="currentColor"><path d="M13 2 3.5 14H11l-1 8 9.5-12H12l1-8z"/></svg>';

  // corner-down-right arrow: "add a child underneath this row"
  const CHILD_ARROW_SVG ='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="child-arrow-icon" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4v8a2 2 0 0 0 2 2h9"/><path d="m13 9 5 5-5 5"/></svg>';

  // Additional length from an overage % (ceil'd); null/absent percent → 0.
  // Shared by the conduit wizard step 3 and the wire flow.
  function computeOverage(baseLength, overagePercent) {
    const additional = overagePercent != null ? Math.ceil(baseLength * (overagePercent / 100)) : 0;
    return { additional, totalQty: baseLength + additional };
  }

  /**
   * The run's parent panel, one line per fact and the length carrying its
   * unit ("220 ft"). The conduit wizard used to print the same number three
   * ways — "Quantity: 220", "Length: 220", "Current length: 220" — with no
   * unit on any of them; every step and the wire flow now print this.
   */
  function renderParentSummary(item, opts = {}) {
    const esc = TakeoffUtils.escapeHtml;
    const unit = opts.unit === undefined ? 'ft' : opts.unit;
    const qty = Number(item?.quantity) || 0;
    return `
        <div class="parent-summary">
          <div class="parent-summary-line"><strong>Parent:</strong> ${esc(item?.description || '')}</div>
          <div class="parent-summary-line">Length: ${qty.toLocaleString('en-US')}${unit ? ' ' + esc(unit) : ''}</div>
        </div>`;
  }

  /**
   * The overage picker section (preset % buttons + input + computed total).
   * noun: 'Conduit' | 'Wire' — used in the total line. inputId differs per
   * flow so each flow's listeners stay unchanged.
   */
  // The computed total line — also patched in place while the user types a
  // custom %, so the input keeps focus (a full re-render would drop it).
  function overageTotalLine(noun, baseLength, overagePercent) {
    const { additional, totalQty } = computeOverage(baseLength, overagePercent);
    return `<strong>${noun} quantity:</strong> ${baseLength} + ${additional} additional = <strong>${totalQty}</strong> total`;
  }

  // Which preset button is the current percentage. Called at render and again
  // while a custom % is typed: 12% belongs to none of them, so the pressed
  // state clears rather than sitting on the last button pressed.
  function markActiveOveragePercent(percent) {
    document.querySelectorAll('.overage-buttons button').forEach((btn) => {
      const on = percent != null && Number(btn.dataset.percent) === Number(percent);
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function updateOverageTotal(inputId, noun, baseLength, overagePercent) {
    const el = document.getElementById(`${inputId}-total`);
    if (el) el.innerHTML = overageTotalLine(noun, baseLength, overagePercent);
    markActiveOveragePercent(overagePercent);
  }

  function renderOverageSection({ inputId, noun, baseLength, overagePercent }) {
    const buttons = [5, 10, 15, 20]
      .map((p) => {
        const on = overagePercent != null && Number(overagePercent) === p;
        return `<button type="button" class="${on ? 'active' : ''}" aria-pressed="${on ? 'true' : 'false'}" data-percent="${p}">${p}%</button>`;
      })
      .join('');
    return `
        <div class="flow-section">
          <h3>Overage</h3>
          <p>Select overage percentage:</p>
          <div class="overage-buttons">${buttons}</div>
          <label>Overage % <input type="number" inputmode="decimal" id="${inputId}" value="${overagePercent ?? ''}" min="0" max="100" step="1" placeholder="0" /></label>
          <p class="overage-total" id="${inputId}-total">${overageTotalLine(noun, baseLength, overagePercent)}</p>
        </div>`;
  }

  // ---------- derived children (overage, trenching) ----------

  // The trenching child's display string. One builder, used by the conduit
  // wizard on save and by syncDerivedChildren when the row is corrected on
  // the manifest, so the two can never word it differently.
  function trenchDescription(feet, material, depth) {
    return `Trenching: ${feet || 0} - ${material || 'N/A'} @ ${depth || 'N/A'}`;
  }

  function isOverageChild(child) {
    return child?.type === 'overage' || (!child?.type && /overage/i.test(child?.description || ''));
  }

  function isTrenchChild(child) {
    return child?.type === 'trenching' || (!child?.type && /^Trenching:/.test(child?.description || ''));
  }

  // The unit price an overage child inherits: the parent's, or none.
  function parentUnitPrice(parent) {
    const unitPrice = Number(parent?.price);
    return !isNaN(unitPrice) && unitPrice > 0 ? unitPrice : null;
  }

  function overagePercentOf(child) {
    const pct = child?.meta?.overagePercent;
    return typeof pct === 'number' ? pct : null;
  }

  // Recompute one overage child from the parent's current quantity and price.
  function syncOverageChild(parent, child) {
    const pct = overagePercentOf(child);
    if (pct == null) return false;
    const { additional } = computeOverage(Number(parent.quantity) || 0, pct);
    const price = parentUnitPrice(parent);
    let changed = false;
    if ((Number(child.quantity) || 0) !== additional) {
      child.quantity = additional;
      changed = true;
    }
    if ((child.price ?? null) !== price) {
      child.price = price;
      changed = true;
    }
    return changed;
  }

  // True when the row no longer holds the numbers its percentage would produce
  // — i.e. someone typed over it on the manifest.
  function overageWasOverridden(parent, child) {
    const pct = overagePercentOf(child);
    if (pct == null) return false;
    const { additional } = computeOverage(Number(parent.quantity) || 0, pct);
    return (Number(child.quantity) || 0) !== additional || (child.price ?? null) !== parentUnitPrice(parent);
  }

  // The estimator's number wins from here on: drop the percentage so nothing
  // recomputes over it, and stop the label claiming one (app.js re-reads the
  // percent out of the description when meta has none).
  function markOverageOverridden(child) {
    let changed = false;
    if (child.meta && child.meta.overagePercent != null) {
      delete child.meta.overagePercent;
      child.meta.overageManual = true;
      changed = true;
    }
    const desc = child.description || '';
    const relabelled = desc.replace(/\s*\(\s*[\d.]+\s*%\s*\)/, ' (manual)');
    if (relabelled !== desc) {
      child.description = relabelled;
      changed = true;
    }
    return changed;
  }

  // A trench row corrected on the manifest: its quantity is the footage and
  // its price the price per foot, so meta has to follow or the next trip
  // through the wizard reverts the correction.
  function syncTrenchChild(child) {
    if (!child.meta || typeof child.meta !== 'object') {
      // legacy row: recover material/depth from the display string first, so
      // regenerating it does not blank them
      const m = (child.description || '').match(/^Trenching:\s*(.*?)\s*-\s*(.*?)\s*@\s*(.*)$/);
      child.meta = {
        feet: Number(child.quantity) || 0,
        material: m && m[2] !== 'N/A' ? m[2] : '',
        depth: m && m[3] !== 'N/A' ? m[3] : '',
        pricePerFoot: Number(child.price) || 0,
      };
    }
    const meta = child.meta;
    const feet = Number(child.quantity) || 0;
    const pricePerFoot = Number(child.price) || 0;
    let changed = false;
    if (meta.feet !== feet) {
      meta.feet = feet;
      changed = true;
    }
    if (meta.pricePerFoot !== pricePerFoot) {
      meta.pricePerFoot = pricePerFoot;
      changed = true;
    }
    const desc = trenchDescription(feet, meta.material, meta.depth);
    if (child.description !== desc) {
      child.description = desc;
      changed = true;
    }
    return changed;
  }

  /**
   * Reconcile the derived children of a manifest row after a field edit.
   *
   * Call it with the id (or the item) of the row that was just updated,
   * immediately after the update in TakeoffManifestView's handleFieldUpdate:
   *
   *     TakeoffState.updateItem(id, updates);
   *     TakeoffViewShared.syncDerivedChildren(id);
   *
   * Three write-time rules (nothing is derived at render: pdf.js, share links,
   * getPurchaseList and getSummaryBreakdown all read the stored child, so a
   * read-time variant would only add a second stored-versus-shown split):
   *   - editing a parent recomputes every overage child that still carries
   *     meta.overagePercent, from the parent's current quantity and price;
   *   - editing the overage child itself is an override — meta.overagePercent
   *     is dropped and the label loses its percentage;
   *   - editing a trenching child's quantity or price writes meta.feet /
   *     meta.pricePerFoot and regenerates its description.
   *
   * Mutates the live manifest items in place. The caller's updateItem has
   * already taken the undo snapshot and scheduled the debounced save, so the
   * reconciliation rides along in the same frame and the same save.
   * Returns true when something changed.
   */
  function syncDerivedChildren(itemOrId) {
    const item = typeof itemOrId === 'string' ? TakeoffState.getItemById(itemOrId) : itemOrId;
    if (!item) return false;

    if (item.parentId) {
      const parent = TakeoffState.getItemById(item.parentId);
      if (!parent) return false;
      if (isOverageChild(item)) {
        return overageWasOverridden(parent, item) ? markOverageOverridden(item) : false;
      }
      if (isTrenchChild(item)) return syncTrenchChild(item);
      return false;
    }

    let changed = false;
    for (const child of item.children || []) {
      if (isOverageChild(child)) changed = syncOverageChild(item, child) || changed;
    }
    return changed;
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
   * renders a <button> (curated rows open the part card — there is no popover;
   * the card owns provenance, js/views/laborBookCard.js); opts.data is a
   * pre-escaped data-attribute string carried onto the element. Pass
   * opts.hasPrice: false for a row with no price at all — instead of a noisy
   * "no date" badge it renders a quiet "+ price" affordance (still the part
   * card's click target).
   */
  // A price somebody typed in is stored as 'You' (TakeoffState.HAND_PRICED)
  // and shown as what it is: not a supply house.
  function sourceLabel(source) {
    const hand = typeof TakeoffState !== 'undefined' ? TakeoffState.HAND_PRICED : 'You';
    return source === hand ? 'Hand-priced' : source;
  }

  function renderPriceProvenance(source, pricedAt, opts = {}) {
    const esc = TakeoffUtils.escapeHtml;
    if (opts.hasPrice === false && !source && !pricedAt) {
      const attrs = `class="lb-prov-badge lb-prov-empty" title="No price yet — record a quote"${opts.data || ''}`;
      return opts.button ? `<button type="button" ${attrs}>+ price</button>` : `<span ${attrs}>+ price</span>`;
    }
    const shown = sourceLabel(source);
    const days = priceAgeDays(pricedAt);
    let cls = 'none';
    let label = shown ? esc(shown) : 'no date';
    if (days !== null) {
      cls = days < 30 ? 'fresh' : days <= 90 ? 'aging' : 'stale';
      const age = days === 0 ? 'today' : `${days}d`;
      label = shown ? `${esc(shown)} · ${age}` : age;
    }
    const title = pricedAt ? `Price recorded ${esc(pricedAt)}${shown ? ' from ' + esc(shown) : ''}` : 'No price date recorded';
    const attrs = `class="lb-prov-badge lb-prov-${cls}" title="${title}"${opts.data || ''}`;
    return opts.button
      ? `<button type="button" ${attrs}><i></i>${label}</button>`
      : `<span ${attrs}><i></i>${label}</span>`;
  }

  return {
    TRASH_SVG,
    BOOK_SVG,
    CHILD_ARROW_SVG,
    BOLT_SVG,
    computeOverage,
    renderParentSummary,
    renderOverageSection,
    updateOverageTotal,
    markActiveOveragePercent,
    trenchDescription,
    syncDerivedChildren,
    todayISO,
    priceAgeDays,
    renderPriceProvenance,
  };
})();
