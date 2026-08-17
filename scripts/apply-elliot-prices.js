#!/usr/bin/env node
/**
 * Apply Elliot Electric prices to mc-labor-book.json, headlessly.
 *
 * Usage:
 *   node scripts/apply-elliot-prices.js path/to/elliot.csv
 *     — parse the CSV, apply SAVED mappings only (no matching),
 *       rebuild the overlay, patch the book.
 *   node scripts/apply-elliot-prices.js path/to/elliot.csv --match
 *     — additionally run the same fuzzy matcher as the in-app flow:
 *       auto matches are persisted into elliot-item-mappings.json,
 *       review-grade candidates are written to source-data/elliot-review-queue.json
 *       (confirm them via the in-app "Update Supplier Prices" review tab).
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
const round4 = (n) => Math.round(n * 10000) / 10000;

async function main() {
  const args = process.argv.slice(2);
  const csvArg = args.find((a) => !a.startsWith('--'));
  const doMatch = args.includes('--match');
  const model = JSON.parse(fs.readFileSync(p('mc-price-model.json'), 'utf8'));
  const categoryMapping = JSON.parse(fs.readFileSync(p('elliot-category-mapping.json'), 'utf8')).mapping;
  const mappingsFile = JSON.parse(fs.readFileSync(p('elliot-item-mappings.json'), 'utf8'));
  const mappings = mappingsFile.mappings || {};

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
    const applyMatch = (itemNum, partNumber, perEach) => {
      const item = model.items[itemNum];
      if (!item) return;
      usedPns.add(partNumber);
      if (perEach > 0 && (item.p === 0 || Math.abs(perEach - item.p) / item.p > 0.001)) {
        itemPrices[itemNum] = round4(perEach);
      }
    };

    let matchStats = null;
    if (doMatch) {
      const matcher = require('../js/mcElliotMatch.js');
      const result = await matcher.runMatching(model.items, deduped, mappings, (done, total) => {
        if (done % 2000 === 0 || done === total) console.log(`  matched ${done}/${total} items`);
      });
      let newAuto = 0;
      for (const [itemNum, m] of Object.entries(result.auto)) {
        applyMatch(itemNum, m.partNumber, m.perEach);
        if (m.via === 'auto' && mappings[m.partNumber] === undefined) {
          mappings[m.partNumber] = Number(itemNum);
          newAuto++;
        }
      }
      fs.writeFileSync(
        p('elliot-item-mappings.json'),
        JSON.stringify({ ...mappingsFile, mappings }, null, 1)
      );
      const reviewPath = path.join(ROOT, 'source-data/elliot-review-queue.json');
      fs.writeFileSync(reviewPath, JSON.stringify(result.review, null, 1));
      matchStats = {
        savedMappingsApplied: result.mappedApplied,
        autoMatched: newAuto,
        needsReview: result.review.length,
        reviewQueueWrittenTo: 'source-data/elliot-review-queue.json',
      };
    } else {
      for (const [pn, itemNum] of Object.entries(mappings)) {
        const row = rowByPn.get(pn);
        if (row) applyMatch(itemNum, pn, row.perEach);
      }
    }

    const newItems = [];
    for (const r of deduped) {
      if (usedPns.has(r.partNumber)) continue;
      if (!categoryMapping[r.category]) continue;
      newItems.push([r.category, r.description || r.name, r.partNumber, round4(r.perEach)]);
    }

    // parts keep their prior date when the price is unchanged
    let priorOverlay = null;
    try {
      priorOverlay = JSON.parse(fs.readFileSync(p('elliot-price-overlay.json'), 'utf8'));
    } catch (_) {}
    const importedAt = new Date().toISOString();
    overlay = {
      version: 1,
      sourceFile: path.basename(csvArg),
      importedAt,
      enabledCategories: [...new Set(newItems.map((n) => n[0]))],
      itemPrices,
      newItems: core.stampNewItemDates(newItems, priorOverlay, importedAt.slice(0, 10)),
    };
    fs.writeFileSync(p('elliot-price-overlay.json'), JSON.stringify(overlay));
    console.log(`Overlay rebuilt: ${Object.keys(itemPrices).length} item prices, ${newItems.length} new items, ${duplicateWarnings.length} duplicate-price warnings.`);
    if (matchStats) console.log(JSON.stringify(matchStats, null, 2));
    else console.log('Note: saved mappings only — pass --match (or run the in-app flow) to match new SKUs.');
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
