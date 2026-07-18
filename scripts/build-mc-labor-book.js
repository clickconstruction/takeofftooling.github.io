#!/usr/bin/env node
/**
 * Build mc-labor-book.json: the MC assembly book organized by the recovered
 * picker hierarchy, mapped onto Labor Book tabs.
 *
 * Reads:  mc-assemblies/mc-assemblies.json  (with level1-3/section/subsection)
 *         mc-assemblies/tab-mapping.json    (level1 -> tab)
 * Writes: mc-assemblies/mc-labor-book.json
 *
 * Shape:
 * {
 *   meta: {...},
 *   tabs: {
 *     conduit: [
 *       { level1, level2, level3, section, entries: [{name, labor, price, assmNum}] },
 *       ...
 *     ],
 *     ...
 *   }
 * }
 * Sections appear in flat-book order within each tab.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'source-data/mc-assemblies.json'), 'utf8'));
const tabMapping = JSON.parse(fs.readFileSync(path.join(ROOT, 'mc-assemblies/tab-mapping.json'), 'utf8')).mapping;

function isHead(a) {
  return (
    a.items && a.items.length === 0 &&
    !a.material && !a.laborHours && !a.unitPrice1 && !a.unitPrice2
  );
}

const tabs = {};
const sectionIndex = new Map(); // `${tab}|${section}|${subsection}` -> section object
let skippedNoTab = 0;
let skippedNoPath = 0;

for (const a of data.assemblies) {
  if (isHead(a)) continue;
  if (!a.level1) { skippedNoPath++; continue; }
  const tab = tabMapping[a.level1];
  if (!tab) { skippedNoTab++; continue; }
  const sectionName = a.subsection || a.section || a.level3 || a.level2 || a.level1;
  const key = `${tab}|${a.section}|${a.subsection}`;
  let sec = sectionIndex.get(key);
  if (!sec) {
    sec = {
      level1: a.level1,
      level2: a.level2,
      level3: a.level3,
      section: a.section,
      subsection: a.subsection || '',
      name: sectionName,
      entries: [],
    };
    sectionIndex.set(key, sec);
    (tabs[tab] = tabs[tab] || []).push(sec);
  }
  sec.entries.push({
    name: a.assmName,
    labor: a.laborHours || 0,
    price: a.unitPrice1 || a.material || 0,
    assmNum: a.assmNum,
  });
}

const meta = {
  source: 'mc-assemblies.json + tab-mapping.json',
  generatedAt: new Date().toISOString(),
  tabs: Object.fromEntries(
    Object.entries(tabs).map(([t, secs]) => [
      t,
      { sections: secs.length, entries: secs.reduce((n, s) => n + s.entries.length, 0) },
    ])
  ),
  skippedNoTab,
  skippedNoPath,
};

let output = { meta, tabs };

// If a committed Elliot price overlay exists, apply it so full rebuilds
// never silently drop Elliot prices. (Same core as the in-app flow.)
const overlayPath = path.join(ROOT, 'mc-assemblies/elliot-price-overlay.json');
const modelPath = path.join(ROOT, 'mc-assemblies/mc-price-model.json');
if (fs.existsSync(overlayPath) && fs.existsSync(modelPath)) {
  const core = require('../js/elliotPriceCore.js');
  const overlay = JSON.parse(fs.readFileSync(overlayPath, 'utf8'));
  const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
  const categoryMapping = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'mc-assemblies/elliot-category-mapping.json'), 'utf8')
  ).mapping;
  const recompute = core.recomputeAssemblies(model, overlay.itemPrices || {});
  output = core.patchLaborBook(output, recompute, overlay, categoryMapping);
  console.log('Elliot overlay applied:', JSON.stringify(output.meta.elliot));
}

fs.writeFileSync(
  path.join(ROOT, 'mc-assemblies/mc-labor-book.json'),
  JSON.stringify(output, null, 1),
  'utf8'
);
console.log(JSON.stringify(meta, null, 2));
