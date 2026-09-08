/**
 * TakeoffSelectors — pure computed views over a manifest array.
 *
 * No state, no DOM, no storage: every function takes the manifest as its
 * argument and returns derived data. TakeoffState wraps these with its own
 * manifest; they are also directly testable. Loaded before js/state.js.
 */

const TakeoffSelectors = (function () {
  // Dual browser/Node: in the browser TakeoffUtils is a prior <script>;
  // in Node (selectors.test.js) we require it.
  const utils = typeof TakeoffUtils !== 'undefined' ? TakeoffUtils : require('./utils.js');
  const MATERIAL_TYPES = ['lighting', 'gear', 'devices', 'conduit', 'wire', 'specialSystems'];
  const OTHER_TYPES = ['permits', 'powerCoCharges', 'temporaryPower'];
  // Sales tax is a per-project number (the project document carries it); 8.25%
  // (Texas' combined maximum) is only where a NEW bid starts — a document
  // saved before the field existed keeps the 8.5% it was bid at (state.js).
  // Every reader passes the project's rate in, as a PERCENT.
  const DEFAULT_TAX_RATE = 8.25; // percent
  // Row units: 'ea' (a count), 'ft' (a length), 'px' (an UNSCALED length
  // from CountTooling — pixels, not feet). px rows are never priced, labored
  // or summed: they are flagged for the estimator to rescale and re-copy.
  const UNITS = ['ea', 'ft', 'px'];
  const isUnscaled = (item) => !!item && item.unit === 'px';
  const SITE_CHARGE_KEY = 'siteWork';
  // Every bucket under OTHER CHARGES: the three typed types plus the site work
  // moved out of materials below.
  const OTHER_CHARGE_KEYS = [...OTHER_TYPES, SITE_CHARGE_KEY];

  function taxRateOf(value) {
    const n = Number(value);
    if (!isFinite(n)) return DEFAULT_TAX_RATE;
    return Math.min(100, Math.max(0, n));
  }

  // Nothing on a bid is negative: a minus sign in a price, an hours figure or
  // a count is a typo, and reading it as a credit made the summary and the
  // purchase list disagree by the whole line. The inputs clamp on change; this
  // clamps what is already stored (imports, share links, older bids).
  function nonNegative(value) {
    const n = Number(value);
    return isFinite(n) && n > 0 ? n : 0;
  }

  /**
   * Trenching is a sub-contract and a rental is equipment on hire: neither is
   * stock, so their dollars are other charges — untaxed, and off the purchase
   * list nobody can order a backhoe from. Fill materials (sand, asphalt patch,
   * pole bases, concrete pads, manholes) are real stock and stay materials.
   * The conduit flow records which button group an add-on came from; add-on
   * children saved before it did carry no group and stay materials.
   */
  function isSiteCharge(item) {
    if (!item) return false;
    if (item.type === 'trenching') return true;
    return item.type === 'trenchingAddon' && !!item.meta && item.meta.addonGroup === 'rental';
  }

  function topLevel(manifest) {
    return manifest.filter((i) => !i.parentId);
  }

  // The one labor total. The screen, the PDF and every other reader must show
  // the same number, so this delegates to the summary rather than re-deriving.
  function getTotalLabor(manifest) {
    return getSummaryBreakdown(manifest).laborTotal;
  }

  /**
   * Aggregate every purchasable material line across the job.
   * Included: all children with a description and qty > 0, childless
   * top-level items (they represent the material directly), and parents
   * WITH children that carry their own price — a conduit run's footage or
   * a panel with add-on parts is real material, not just a grouping.
   * Price-less parents with children (device runs) are groupings and skip
   * their own line. Other-charges types are skipped entirely.
   *
   * Merging is by TakeoffUtils.descKey — the one "same description" key the
   * import preview and merge also use. Quantities sum and extended cost sums
   * per occurrence, so a material bought at two prices stays exact; the unit
   * column then shows the range rather than one of the two prices.
   *
   * Overage children never get a line of their own: the waste belongs to the
   * footage you order, so it folds into its parent's line (by parentId and
   * type, never by description — two runs' overage is not one material) and
   * the line says so: '3/4" EMT Homerun (incl. 10% overage)'.
   */
  function getPurchaseList(manifest) {
    const byKey = new Map();

    function priceOf(item) {
      return item.price != null && item.price !== '' && !isNaN(Number(item.price)) ? nonNegative(item.price) : null;
    }

    function accrue(line, qty, price) {
      line.quantity += qty;
      if (price != null) {
        // rounded per line, the same convention getSummaryBreakdown uses, so
        // the two artifacts agree to the cent on 4-decimal supplier prices
        line.extended += Math.round(qty * price * 100) / 100;
        line.prices.add(Math.round(price * 100) / 100);
      } else {
        line.unpricedQty += qty;
      }
    }

    function addLine(item) {
      const desc = (item.description || '').trim();
      const qty = nonNegative(item.quantity);
      if (!desc || qty <= 0 || isUnscaled(item)) return null;
      const key = utils.descKey(desc);
      let line = byKey.get(key);
      if (!line) {
        byKey.set(key, (line = { description: desc, quantity: 0, extended: 0, prices: new Set(), unpricedQty: 0, overagePercents: new Set() }));
      }
      accrue(line, qty, priceOf(item));
      return line;
    }

    // '10' from meta, else from the description the flow writes.
    function overagePercentOf(child) {
      const fromMeta = child.meta && child.meta.overagePercent;
      if (fromMeta != null && fromMeta !== '' && !isNaN(Number(fromMeta))) return Number(fromMeta);
      const m = /(\d+(?:\.\d+)?)\s*%/.exec(child.description || '');
      return m ? Number(m[1]) : null;
    }

    for (const item of topLevel(manifest)) {
      if (OTHER_TYPES.includes(item.type) || isSiteCharge(item)) continue;
      const children = item.children || [];
      if (children.length === 0) {
        addLine(item);
      } else {
        const ownPrice = Number(item.price);
        const parentLine = item.price != null && item.price !== '' && !isNaN(ownPrice) && ownPrice > 0 ? addLine(item) : null;
        for (const c of children) {
          // a trench or a rental is not something the supply house sells
          if (isSiteCharge(c)) continue;
          const qty = nonNegative(c.quantity);
          if (c.type === 'overage' && parentLine && qty > 0) {
            // fold the waste into the footage line it belongs to
            accrue(parentLine, qty, priceOf(c));
            const pct = overagePercentOf(c);
            parentLine.overagePercents.add(pct == null ? '' : pct);
            continue;
          }
          addLine(c);
        }
      }
    }

    const lines = [...byKey.values()]
      .map((l) => {
        const prices = [...l.prices].sort((a, b) => a - b);
        const pcts = [...l.overagePercents];
        const suffix = pcts.length === 0
          ? ''
          : pcts.length === 1 && pcts[0] !== '' ? ` (incl. ${pcts[0]}% overage)` : ' (incl. overage)';
        return {
          description: l.description + suffix,
          quantity: Math.round(l.quantity * 100) / 100,
          unitPrice: prices.length ? prices[prices.length - 1] : null,
          unitPriceLow: prices.length ? prices[0] : null,
          unitPriceHigh: prices.length ? prices[prices.length - 1] : null,
          priceVaries: prices.length > 1,
          unpriced: l.unpricedQty > 0,
          extended: Math.round(l.extended * 100) / 100,
        };
      })
      .sort((a, b) => a.description.localeCompare(b.description));

    return {
      lines,
      totalCost: Math.round(lines.reduce((s, l) => s + l.extended, 0) * 100) / 100,
      unpricedCount: lines.filter((l) => l.unpriced).length,
    };
  }

  function getFlattenedItems(manifest) {
    const result = [];
    function flatten(items, depth = 0) {
      for (const item of items) {
        result.push({ ...item, _depth: depth });
        if (item.children && item.children.length) {
          flatten(item.children, depth + 1);
        }
      }
    }
    flatten(topLevel(manifest));
    return result;
  }

  function getSummaryBreakdown(manifest, taxRatePercent) {
    const taxRate = taxRateOf(taxRatePercent);
    const materials = { lighting: 0, gear: 0, devices: 0, conduit: 0, wire: 0, specialSystems: 0, misc: 0 };
    // `other` holds the hours typed on permits / power co. / temporary power
    // rows: those rows bill their price under Other Charges, but the crew
    // still works the hours, so they count in the labor total.
    const labor = { lighting: 0, gear: 0, devices: 0, conduit: 0, wire: 0, specialSystems: 0, misc: 0, other: 0 };
    // The same hours, split by where they were typed: on the assembly row
    // itself (a run, a fixture) or on one of its components (boxes, fittings,
    // parts added from the book). The summary shows the split so an estimator
    // adding up hours by hand can see which half theirs is missing.
    const laborByOrigin = {};
    for (const t of Object.keys(labor)) laborByOrigin[t] = { parent: 0, component: 0 };
    const otherCharges = { permits: 0, powerCoCharges: 0, temporaryPower: 0, [SITE_CHARGE_KEY]: 0 };

    function processItems(items, parentType, isChild) {
      // Children always roll up into their top-level parent's bucket, so flow
      // components (boxes, fittings, overage...) count toward Devices/Conduit/
      // Wire instead of Misc.
      for (const item of items) {
        const effectiveType = parentType || item.type || null;
        // Quantity 0 means none of it: no material, no hours, and no line on
        // the purchase list. (Typing a description still sets the quantity to
        // 1, so a row you are filling in is never silently worth nothing.)
        const qty = nonNegative(item.quantity);
        // Rounded per line, the way the purchase list rounds it: two
        // 4-decimal supplier prices used to leave the summary and the list a
        // cent apart on the same bid.
        // A px row is pixels, not feet: it has no money and no hours until
        // it is rescaled and re-copied.
        const priceAmount = isUnscaled(item) ? 0 : Math.round(nonNegative(item.price) * qty * 100) / 100;
        const laborHrs = isUnscaled(item) ? 0 : nonNegative(item.labor) * qty;

        let laborBucket;
        if (isSiteCharge(item)) {
          // sub-contract / rental dollars: an other charge, untaxed. The hours
          // are still worked, so they stay in the run's own labor bucket.
          otherCharges[SITE_CHARGE_KEY] += priceAmount;
          laborBucket = MATERIAL_TYPES.includes(effectiveType) ? effectiveType : 'misc';
        } else if (OTHER_TYPES.includes(effectiveType)) {
          otherCharges[effectiveType] = (otherCharges[effectiveType] || 0) + priceAmount;
          laborBucket = 'other';
        } else if (MATERIAL_TYPES.includes(effectiveType)) {
          materials[effectiveType] = (materials[effectiveType] || 0) + priceAmount;
          laborBucket = effectiveType;
        } else {
          materials.misc += priceAmount;
          laborBucket = 'misc';
        }
        labor[laborBucket] = (labor[laborBucket] || 0) + laborHrs;
        if (laborByOrigin[laborBucket]) laborByOrigin[laborBucket][isChild ? 'component' : 'parent'] += laborHrs;

        if (item.children && item.children.length) {
          processItems(item.children, effectiveType || parentType, true);
        }
      }
    }
    processItems(topLevel(manifest), null, false);

    const materialsSubtotal = Math.round([...MATERIAL_TYPES, 'misc'].reduce((s, t) => s + (materials[t] || 0), 0) * 100) / 100;
    const salesTax = Math.round(materialsSubtotal * (taxRate / 100) * 100) / 100;
    const materialsTotal = Math.round((materialsSubtotal + salesTax) * 100) / 100;
    const laborTotal = [...MATERIAL_TYPES, 'misc', 'other'].reduce((s, t) => s + (labor[t] || 0), 0);
    const otherTotal = Math.round(OTHER_CHARGE_KEYS.reduce((s, t) => s + (otherCharges[t] || 0), 0) * 100) / 100;

    return {
      taxRate,
      materials,
      materialsSubtotal,
      salesTax,
      materialsTotal,
      labor,
      laborByOrigin,
      laborTotal,
      otherCharges,
      otherTotal,
      unscaledCount: countUnscaled(manifest),
    };
  }

  // Rows still carrying pixel lengths (unit 'px') anywhere in the manifest.
  function countUnscaled(manifest) {
    let n = 0;
    (function walk(items) {
      for (const item of items) {
        if (isUnscaled(item)) n++;
        if (item.children && item.children.length) walk(item.children);
      }
    })(topLevel(manifest));
    return n;
  }

  return {
    getTotalLabor,
    getPurchaseList,
    getFlattenedItems,
    getSummaryBreakdown,
    countUnscaled,
    isSiteCharge,
    isUnscaled,
    MATERIAL_TYPES,
    OTHER_TYPES,
    OTHER_CHARGE_KEYS,
    SITE_CHARGE_KEY,
    DEFAULT_TAX_RATE,
    UNITS,
  };
})();

// Node (unit tests); inert in the browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TakeoffSelectors;
}
