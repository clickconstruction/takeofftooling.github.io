// TakeoffExplode — the assembly kernel: what parts a device or a run needs.
//
// Pure data in, data out, no DOM, no state: the browser flows and the agent door
// (supabase/functions/import-manifest, via the byte-identical copy in
// supabase/functions/_shared/explode.js — kernel-copies.test.js keeps them equal)
// both call the same code, and a harness can run it locally like CountTooling's
// takeoffPlacement kernel. UMD: `TakeoffExplode` global in the browser and in
// Deno (module scope, `self`), `module.exports` under node:test.
//
// Model. A TEMPLATE matches a parent row by type + description and lists child
// rules: { name, qty, per } where per is 'count' (qty × the parent's quantity),
// 'run' (qty per parent row — a connector at each end) or 'ft' (qty × ceil(feet /
// ftInterval) — a coupling and a strap every 10 ft). Child rows are ordinary
// manifest children: { type, description, quantity, unit:'ea', labor, price, meta }.
// Labor hours and prices come from a BOOK — a flat list of { name, labor, price }
// (TakeoffState.getLaborBook() flattened, or the twin's synced book, or the shipped
// defaults) — matched by exact normalized name, then by every-token containment
// ('1/2 emt coupling' finds '1/2" EMT Set-Screw Coupling'). A child no book row
// prices gets labor/price null and meta.needsPricing = true — never a guess.
//
// Templates are the shipped electrical defaults (the "assembly templates" the
// electrical note moved here from CountTooling); a book section named the same
// as a child wins over the template's spelling. Editing them is a data change.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TakeoffExplode = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();

  // --- shipped templates ------------------------------------------------------
  // match: { type, re } — re runs on the parent's description. First match wins.
  const TEMPLATES = [
    {
      id: 'gfci-receptacle', label: 'GFCI receptacle', match: { type: 'devices', re: /gfci|gfi/i },
      children: [
        { name: '4" Square Box, 1-1/2" deep', qty: 1, per: 'count', childType: 'box' },
        { name: '4" Square 1-Gang Mud Ring', qty: 1, per: 'count', childType: 'box' },
        { name: '1-Gang Decora Plate', qty: 1, per: 'count', childType: 'cover' },
        { name: '1/2" EMT Set-Screw Connector', qty: 2, per: 'count', childType: 'misc' },
      ],
    },
    {
      id: 'receptacle', label: 'Receptacle', match: { type: 'devices', re: /recept|outlet|duplex|quad|dedicated/i },
      children: [
        { name: '4" Square Box, 1-1/2" deep', qty: 1, per: 'count', childType: 'box' },
        { name: '4" Square 1-Gang Mud Ring', qty: 1, per: 'count', childType: 'box' },
        { name: '1-Gang Duplex Plate', qty: 1, per: 'count', childType: 'cover' },
        { name: '1/2" EMT Set-Screw Connector', qty: 2, per: 'count', childType: 'misc' },
      ],
    },
    {
      id: 'switch', label: 'Switch / dimmer / sensor', match: { type: 'devices', re: /switch|dimmer|occupancy|sensor/i },
      children: [
        { name: '4" Square Box, 1-1/2" deep', qty: 1, per: 'count', childType: 'box' },
        { name: '4" Square 1-Gang Mud Ring', qty: 1, per: 'count', childType: 'box' },
        { name: '1-Gang Decora Plate', qty: 1, per: 'count', childType: 'cover' },
        { name: '1/2" EMT Set-Screw Connector', qty: 2, per: 'count', childType: 'misc' },
      ],
    },
    {
      id: 'data-drop', label: 'Data / low-voltage drop', match: { type: 'specialSystems', re: /data|cat\s?[56]|wap|access point|tel|phone|jack|tv|av\b/i },
      children: [
        { name: '4" Square Box, 1-1/2" deep', qty: 1, per: 'count', childType: 'misc' },
        { name: '4" Square 1-Gang Mud Ring', qty: 1, per: 'count', childType: 'misc' },
        { name: '1-Gang Decora Plate', qty: 1, per: 'count', childType: 'misc' },
      ],
    },
    {
      id: 'troffer', label: 'Lay-in fixture', match: { type: 'lighting', re: /troffer|lay-?in|2x4|2x2|1x4|panel light/i },
      children: [
        { name: "4' Steel Flex Fixture Whip", qty: 1, per: 'count', childType: 'misc' },
      ],
    },
    {
      id: 'emt', label: 'EMT run', match: { type: 'conduit', re: /\bemt\b/i },
      children: [
        { name: '{size} EMT Set-Screw Coupling', qty: 1, per: 'ft', ftInterval: 10, childType: 'fitting' },
        { name: '{size} 1-Hole Strap', qty: 1, per: 'ft', ftInterval: 10, childType: 'fitting' },
        { name: '{size} EMT Set-Screw Connector', qty: 2, per: 'run', childType: 'fitting' },
      ],
    },
    {
      id: 'pvc', label: 'PVC run', match: { type: 'conduit', re: /\bpvc\b/i },
      children: [
        { name: '{size} PVC Coupling', qty: 1, per: 'ft', ftInterval: 10, childType: 'fitting' },
        { name: '{size} PVC Male Adapter', qty: 2, per: 'run', childType: 'fitting' },
      ],
    },
    {
      id: 'mc', label: 'MC cable run', match: { type: 'wire', re: /\bmc\b|\bac\b|armored/i },
      children: [
        { name: '{size} MC Connector', qty: 2, per: 'run', childType: 'macAdapter' },
        { name: 'MC Cable Strap', qty: 1, per: 'ft', ftInterval: 6, childType: 'macAdapter' },
      ],
    },
  ];

  // The trade size at the front of a description: 1/2", 3/4", 1", 1-1/4", #12…
  function sizeOf(description) {
    const m = String(description || '').match(/(\d+(?:-\d+\/\d+)?(?:\/\d+)?\s*(?:"|in\b|″))/i);
    return m ? m[1].replace(/\s*(in\b|″)/i, '"').replace(/\s+/g, '') : '';
  }

  function findTemplate(item) {
    if (!item) return null;
    const desc = String(item.description || '');
    if (!desc.trim()) return null;
    return TEMPLATES.find((t) => t.match.type === item.type && t.match.re.test(desc)) || null;
  }

  // --- the book ---------------------------------------------------------------

  /** laborBook[type][section] = [{name, labor, price}] → flat [{name, labor, price, type, section}] */
  function flattenBook(laborBook) {
    const rows = [];
    for (const [type, sections] of Object.entries(laborBook || {})) {
      for (const [section, list] of Object.entries(sections || {})) {
        for (const r of list || []) if (r && r.name) rows.push({ name: r.name, labor: r.labor, price: r.price, type, section });
      }
    }
    return rows;
  }

  /** Exact normalized name, else the first row containing every token of the wanted name. */
  function lookup(bookRows, name) {
    const want = norm(name);
    if (!want) return null;
    const exact = (bookRows || []).find((r) => norm(r.name) === want);
    if (exact) return exact;
    const tokens = want.split(' ').filter(Boolean);
    return (bookRows || []).find((r) => { const h = norm(r.name); return tokens.every((t) => h.includes(t)); }) || null;
  }

  const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

  // --- explode -----------------------------------------------------------------

  /**
   * Child rows for one parent. opts: { book: flat rows, template?: override }.
   * Returns [] when no template matches or the parent has no quantity.
   */
  function explodeItem(item, opts) {
    const o = opts || {};
    const t = o.template || findTemplate(item);
    if (!t) return [];
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) return [];
    const isLength = item.unit === 'ft';
    if (item.unit === 'px') return []; // unscaled: never explode pixels
    const size = sizeOf(item.description);
    const children = [];
    for (const rule of t.children) {
      const name = rule.name.replace('{size}', size).replace(/^\s+/, '');
      if (rule.name.includes('{size}') && !size) continue; // no size on the run → skip sized fittings
      let n;
      if (rule.per === 'count') n = rule.qty * qty;
      else if (rule.per === 'run') n = rule.qty;
      else if (rule.per === 'ft') n = isLength ? rule.qty * Math.ceil(qty / (rule.ftInterval || 10)) : 0;
      else n = 0;
      if (n <= 0) continue;
      const hit = lookup(o.book, name);
      children.push({
        type: rule.childType || 'misc',
        description: hit ? hit.name : name,
        quantity: n,
        unit: 'ea',
        labor: hit ? toNum(hit.labor) : null,
        price: hit ? toNum(hit.price) : null,
        planPage: '',
        meta: { fromTemplate: t.id, rule: rule.per + (rule.per === 'ft' ? '/' + (rule.ftInterval || 10) : ''), ...(hit ? {} : { needsPricing: true }) },
      });
    }
    return children;
  }

  /**
   * Explode every childless parent a template matches. Returns { manifest, exploded,
   * unpriced } — a NEW manifest (inputs untouched); parents that already have children
   * are left alone (the estimator's hand work wins).
   */
  function explodeManifest(manifest, opts) {
    let exploded = 0;
    let unpriced = 0;
    const out = (manifest || []).map((item) => {
      if (!item || item.parentId || (item.children && item.children.length)) return item;
      const kids = explodeItem(item, opts);
      if (!kids.length) return item;
      exploded++;
      unpriced += kids.filter((k) => k.meta && k.meta.needsPricing).length;
      return { ...item, children: kids.map((k) => ({ ...k, parentId: item.id })) };
    });
    return { manifest: out, exploded, unpriced };
  }

  return { TEMPLATES, findTemplate, sizeOf, flattenBook, lookup, explodeItem, explodeManifest };
});
