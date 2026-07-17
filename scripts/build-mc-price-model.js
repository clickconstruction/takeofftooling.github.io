#!/usr/bin/env node
/**
 * Build mc-assemblies/mc-price-model.json: a compact price model the browser
 * can fetch instead of the 42MB mc-assemblies.json.
 *
 * items:      { itemNum: { n: itemName, p: perEachPrice, u: bidLbrUnit } }
 * assemblies: { assmNum: { m: material, u1: unitPrice1, c: [[itemNum, qty]...],
 *               cm: computedMaterial, v: 1|0 } }
 *
 * perEach = price1 / divisor, divisor by bidLbrUnit {M:1000, C:100, Q:100, else 1}.
 * v=1 when |cm - m| <= max(0.02, 2% of m)  (the "verified formula" gate:
 * only these assemblies get automatic price recomputation).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INPUT = path.join(ROOT, 'mc-assemblies/mc-assemblies.json');
const OUTPUT = path.join(ROOT, 'mc-assemblies/mc-price-model.json');

const DIVISOR = { M: 1000, C: 100, Q: 100 };

function perEach(price1, unit) {
  return price1 / (DIVISOR[unit] || 1);
}

function main() {
  const data = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  const items = {};
  const conflicts = [];

  // pass 1: item catalog (verify one price/unit per itemNum)
  for (const a of data.assemblies) {
    for (const it of a.items || []) {
      const existing = items[it.itemNum];
      const entry = {
        n: it.itemName,
        p: perEach(it.price1, it.bidLbrUnit),
        l: perEach(it.bidLbr || 0, it.bidLbrUnit),
        u: it.bidLbrUnit || 'E',
      };
      if (existing) {
        if (Math.abs(existing.p - entry.p) > 0.0001 || existing.u !== entry.u) {
          conflicts.push(it.itemNum);
        }
      } else {
        items[it.itemNum] = entry;
      }
    }
  }

  // pass 2: assembly compositions + verified gate
  const assemblies = {};
  let verified = 0;
  let withItems = 0;
  for (const a of data.assemblies) {
    if (!a.items || a.items.length === 0) continue;
    withItems++;
    const comp = a.items.map((it) => [it.itemNum, it.bpQty + (it.bpConst || 0)]);
    const cm = comp.reduce((s, [num, qty]) => s + (items[num]?.p || 0) * qty, 0);
    const m = a.material || 0;
    const v = m > 0 && Math.abs(cm - m) <= Math.max(0.02, m * 0.02) ? 1 : 0;
    if (v) verified++;
    assemblies[a.assmNum] = {
      m,
      u1: a.unitPrice1 || 0,
      c: comp.map(([num, qty]) => [num, Math.round(qty * 10000) / 10000]),
      cm: Math.round(cm * 10000) / 10000,
      v,
    };
  }

  const meta = {
    source: 'mc-assemblies.json',
    generatedAt: new Date().toISOString(),
    version: 1,
    itemCount: Object.keys(items).length,
    assemblyCount: withItems,
    verifiedCount: verified,
    verifiedPct: Math.round((100 * verified) / withItems),
    itemPriceConflicts: conflicts.length,
  };

  fs.writeFileSync(OUTPUT, JSON.stringify({ meta, items, assemblies }));
  console.log(JSON.stringify(meta, null, 2));
  if (conflicts.length) {
    console.warn('WARNING: itemNums with conflicting price/unit:', conflicts.slice(0, 20));
  }
}

main();
