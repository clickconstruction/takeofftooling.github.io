#!/usr/bin/env node
/**
 * Apply Elliot Electric prices to mc-labor-book.json, headlessly.
 *
 * Usage:
 *   node scripts/apply-elliot-prices.js path/to/elliot.csv
 *     — parse the CSV, apply SAVED mappings only (no interactive matching),
 *       rebuild the overlay, patch the book.
 *   node scripts/apply-elliot-prices.js
 *     — re-apply the committed mc-assemblies/elliot-price-overlay.json as-is.
 *
 * Uses the same core logic as the in-app "Update Elliot Prices" flow.
 */

const fs = require('fs');
const path = require('path');
const core = require('../js/elliotPriceCore.js');

const ROOT = path.join(__dirname, '..');
const p = (rel) => path.join(ROOT, 'mc-assemblies', rel);

function main() {
  const csvArg = process.argv[2];
  const model = JSON.parse(fs.readFileSync(p('mc-price-model.json'), 'utf8'));
  const categoryMapping = JSON.parse(fs.readFileSync(p('elliot-category-mapping.json'), 'utf8')).mapping;
  const mappings = JSON.parse(fs.readFileSync(p('elliot-item-mappings.json'), 'utf8')).mappings || {};

  let overlay;
  if (csvArg) {
    const { rows, errors } = core.parseElliotCsvNormalized(fs.readFileSync(csvArg, 'utf8'));
    if (errors.length) {
      console.error('Parse failed:', errors.join('; '));
      process.exit(1);
    }
    const { rows: deduped, duplicateWarnings } = core.dedupeElliotRows(rows, categoryMapping);
    const rowByPn = new Map(deduped.map((r) => [r.partNumber, r]));

    const itemPrices = {};
    const usedPns = new Set();
    for (const [pn, itemNum] of Object.entries(mappings)) {
      const row = rowByPn.get(pn);
      const item = model.items[itemNum];
      if (!row || !item) continue;
      usedPns.add(pn);
      if (row.perEach > 0 && (item.p === 0 || Math.abs(row.perEach - item.p) / item.p > 0.001)) {
        itemPrices[itemNum] = Math.round(row.perEach * 10000) / 10000;
      }
    }

    const newItems = [];
    for (const r of deduped) {
      if (usedPns.has(r.partNumber)) continue;
      if (!categoryMapping[r.category]) continue;
      newItems.push([r.category, r.description || r.name, r.partNumber, Math.round(r.perEach * 10000) / 10000]);
    }

    overlay = {
      version: 1,
      sourceFile: path.basename(csvArg),
      importedAt: new Date().toISOString(),
      enabledCategories: [...new Set(newItems.map((n) => n[0]))],
      itemPrices,
      newItems,
    };
    fs.writeFileSync(p('elliot-price-overlay.json'), JSON.stringify(overlay));
    console.log(`Overlay rebuilt: ${Object.keys(itemPrices).length} item prices via saved mappings, ${newItems.length} new items, ${duplicateWarnings.length} duplicate-price warnings.`);
    console.log('Note: headless mode applies saved mappings only — run the in-app flow to match new SKUs.');
  } else {
    overlay = JSON.parse(fs.readFileSync(p('elliot-price-overlay.json'), 'utf8'));
    console.log(`Re-applying committed overlay from ${overlay.sourceFile} (${overlay.importedAt}).`);
  }

  const recompute = core.recomputeAssemblies(model, overlay.itemPrices || {});
  const book = JSON.parse(fs.readFileSync(p('mc-labor-book.json'), 'utf8'));
  const patched = core.patchLaborBook(book, recompute, overlay, categoryMapping);
  fs.writeFileSync(p('mc-labor-book.json'), JSON.stringify(patched, null, 1));
  console.log(JSON.stringify({ ...recompute.stats, newItems: (overlay.newItems || []).length }, null, 2));
}

main();
