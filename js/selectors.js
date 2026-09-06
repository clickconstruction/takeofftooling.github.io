/**
 * TakeoffSelectors — pure computed views over a manifest array.
 *
 * No state, no DOM, no storage: every function takes the manifest as its
 * argument and returns derived data. TakeoffState wraps these with its own
 * manifest; they are also directly testable. Loaded before js/state.js.
 */

const TakeoffSelectors = (function () {
  const MATERIAL_TYPES = ['lighting', 'gear', 'devices', 'conduit', 'wire', 'specialSystems'];
  const OTHER_TYPES = ['permits', 'powerCoCharges', 'temporaryPower'];
  const SALES_TAX_RATE = 0.085;

  function topLevel(manifest) {
    return manifest.filter((i) => !i.parentId);
  }

  function getTotalLabor(manifest) {
    function sumLabor(items) {
      let total = 0;
      for (const item of items) {
        const unitLabor = Number(item.labor) || 0;
        const qty = Number(item.quantity) || 0;
        // labor is per-unit hours; a priced/labored line with qty 0 counts once (same rule as price)
        const effectiveQty = qty > 0 ? qty : (unitLabor > 0 ? 1 : 0);
        total += unitLabor * effectiveQty;
        if (item.children && item.children.length) {
          total += sumLabor(item.children);
        }
      }
      return total;
    }
    return sumLabor(topLevel(manifest));
  }

  function getTotalPrice(manifest) {
    function sumPrice(items) {
      let total = 0;
      for (const item of items) {
        const p = Number(item.price);
        const q = Number(item.quantity) || 0;
        if (!isNaN(p) && p > 0) total += p * q;
        if (item.children && item.children.length) {
          total += sumPrice(item.children);
        }
      }
      return total;
    }
    return sumPrice(topLevel(manifest));
  }

  /**
   * Aggregate every purchasable material line across the job.
   * Included: all children with a description and qty > 0, childless
   * top-level items (they represent the material directly), and parents
   * WITH children that carry their own price — a conduit run's footage or
   * a panel with add-on parts is real material, not just a grouping.
   * Price-less parents with children (device runs) are groupings and skip
   * their own line. Other-charges types are skipped entirely.
   * Identical descriptions merge: quantities sum, extended cost sums
   * per-occurrence so price differences stay accurate.
   */
  function getPurchaseList(manifest) {
    const byKey = new Map();

    function addLine(item) {
      const desc = (item.description || '').trim();
      const qty = Number(item.quantity) || 0;
      if (!desc || qty <= 0) return;
      const key = desc.toLowerCase().replace(/\s+/g, ' ');
      const price = item.price != null && item.price !== '' && !isNaN(Number(item.price)) ? Number(item.price) : null;
      let line = byKey.get(key);
      if (!line) {
        byKey.set(key, (line = { description: desc, quantity: 0, extended: 0, prices: new Set(), unpricedQty: 0 }));
      }
      line.quantity += qty;
      if (price != null) {
        line.extended += qty * price;
        line.prices.add(Math.round(price * 100) / 100);
      } else {
        line.unpricedQty += qty;
      }
    }

    for (const item of topLevel(manifest)) {
      if (OTHER_TYPES.includes(item.type)) continue;
      const children = item.children || [];
      if (children.length === 0) {
        addLine(item);
      } else {
        const ownPrice = Number(item.price);
        if (item.price != null && item.price !== '' && !isNaN(ownPrice) && ownPrice > 0) addLine(item);
        for (const c of children) addLine(c);
      }
    }

    const lines = [...byKey.values()]
      .map((l) => {
        const prices = [...l.prices];
        return {
          description: l.description,
          quantity: Math.round(l.quantity * 100) / 100,
          unitPrice: prices.length === 1 ? prices[0] : prices.length > 1 ? Math.max(...prices) : null,
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

  function getSummaryBreakdown(manifest) {
    const materials = { lighting: 0, gear: 0, devices: 0, conduit: 0, wire: 0, specialSystems: 0, misc: 0 };
    const labor = { lighting: 0, gear: 0, devices: 0, conduit: 0, wire: 0, specialSystems: 0, misc: 0 };
    const otherCharges = { permits: 0, powerCoCharges: 0, temporaryPower: 0 };

    function processItems(items, parentType) {
      // Children always roll up into their top-level parent's bucket, so flow
      // components (boxes, fittings, overage...) count toward Devices/Conduit/
      // Wire instead of Misc.
      for (const item of items) {
        const effectiveType = parentType || item.type || null;
        const qty = Number(item.quantity) || 0;
        const priceVal = Number(item.price);
        const effectiveQty = qty > 0 ? qty : (!isNaN(priceVal) && priceVal > 0 ? 1 : 0);
        const priceAmount = !isNaN(priceVal) && priceVal > 0 ? priceVal * effectiveQty : 0;
        const unitLabor = Number(item.labor) || 0;
        const laborQty = qty > 0 ? qty : (unitLabor > 0 ? 1 : 0);
        const laborHrs = unitLabor * laborQty;

        if (OTHER_TYPES.includes(effectiveType)) {
          otherCharges[effectiveType] = (otherCharges[effectiveType] || 0) + priceAmount;
        } else if (MATERIAL_TYPES.includes(effectiveType)) {
          materials[effectiveType] = (materials[effectiveType] || 0) + priceAmount;
          labor[effectiveType] = (labor[effectiveType] || 0) + laborHrs;
        } else {
          materials.misc += priceAmount;
          labor.misc += laborHrs;
        }

        if (item.children && item.children.length) {
          processItems(item.children, effectiveType || parentType);
        }
      }
    }
    processItems(topLevel(manifest), null);

    const materialsSubtotal = [...MATERIAL_TYPES, 'misc'].reduce((s, t) => s + (materials[t] || 0), 0);
    const salesTax = materialsSubtotal * SALES_TAX_RATE;
    const materialsTotal = materialsSubtotal + salesTax;
    const laborTotal = [...MATERIAL_TYPES, 'misc'].reduce((s, t) => s + (labor[t] || 0), 0);
    const otherTotal = OTHER_TYPES.reduce((s, t) => s + (otherCharges[t] || 0), 0);

    return {
      materials,
      materialsSubtotal,
      salesTax,
      materialsTotal,
      labor,
      laborTotal,
      otherCharges,
      otherTotal,
    };
  }

  return { getTotalLabor, getTotalPrice, getPurchaseList, getFlattenedItems, getSummaryBreakdown, MATERIAL_TYPES, OTHER_TYPES, SALES_TAX_RATE };
})();

// Node (unit tests); inert in the browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TakeoffSelectors;
}
