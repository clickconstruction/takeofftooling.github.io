# Data Pipeline (source-data → mc-assemblies)

The Labor & Price Book's "Assemblies" side is built offline from exports of the MC (McCormick) estimating software, then enriched at runtime with supplier ("Elliot Electric") prices. Node scripts live in `scripts/`; build inputs and intermediates live in `source-data/` (removable — see its README); the generated runtime JSON lives in `mc-assemblies/`. **Never hand-edit the generated JSON — regenerate it.**

Runtime needs only: `mc-assemblies/` (five fetched JSONs + `tab-mapping.json` build config) and `import-files/HCP_1272501.csv`. Everything in `source-data/` exists solely to re-run the pipeline.

## Sources

- `source-data/mc1to10000.csv` … `mc30001to34810.csv` (~14 MB): MC "Assemblies & Byproducts (Permanent)" report exports. Interleaved assembly rows + child item rows. Two column layouts (mc1to10000 has a leading empty column); `parseCSVFile` in `mc-assemblies-to-json.js` detects the format from the first data row and handles both.
- `source-data/hierarchy-images/` (~809 screenshots): the MC 4-column category picker UI — the flat report has no category tree, so the hierarchy was recovered from these images (one-time job).
- `import-files/HCP_1272501.csv` (3 MB): sample Elliot Electric price export (`Category,Name,Description,Part Number,Price,Cost,Unit of Measure`; units EACH/HUNDRED/THOUSAND). Referenced as `bundledFile` in vendor-profiles.json — fetched at runtime, so it stays outside `source-data/`.
- `source-data/file1_final.csv` / `file1_improved.csv`: older per-item price exports (superseded).

## Build DAG

All intermediate outputs below land in `source-data/`; only the final two artifacts land in `mc-assemblies/`.

```
4 MC CSVs (source-data/)
  └─ scripts/mc-assemblies-to-json.js ──────────► source-data/mc-assemblies.json  (40 MB, 28,920 assemblies)
                                                        │
hierarchy screenshots (one-time recovery)               │
  └─ scripts/extract-hierarchy-from-images.js           │
       (Ollama llava:13b → hierarchy-staging.jsonl,     │
        better run: hierarchy-extracted.jsonl)          │
  └─ scripts/hierarchy/align.py ───► review/heads-assigned.csv (+ unmatched reports)
  └─ scripts/hierarchy/propagate.py ─► rewrites source-data/mc-assemblies.json in place
       (adds level1/2/3, section, subsection; also mc-hierarchy.csv)
                                                        │
  ┌─────────────────────────────────────────────────────┤
  ▼                                                     ▼
scripts/build-mc-price-model.js                 scripts/build-mc-labor-book.js  (+ tab-mapping.json)
  └─► mc-assemblies/mc-price-model.json (3 MB)    └─► mc-assemblies/mc-labor-book.json (3.7 MB)
                                                       (re-applies elliot-price-overlay.json if present)

Elliot CSV
  └─ scripts/apply-elliot-prices.js <csv>           (headless; saved mappings only)
  └─ scripts/apply-elliot-prices.js <csv> --match   (headless + full fuzzy matching:
       persists auto matches into elliot-item-mappings.json, writes the review
       queue to source-data/elliot-review-queue.json)
       └─► elliot-price-overlay.json + patches mc-labor-book.json in place
  └─ OR the in-app "Update Supplier Prices" modal (fuzzy matching + review UI),
       whose Summary tab downloads updated JSON to commit back into mc-assemblies/
```

Auxiliary: `scripts/extract-section-heads.js` dumps section heads to `mc-section-heads.csv` for review.

## Artifact schemas

- **source-data/mc-assemblies.json**: `{meta:{totalAssemblies, byFile,…}, assemblies:[{assmNum, assmName, material, laborHours, unitPrice1, unitPrice2, level1, level2, level3, section, subsection, items:[{itemNum, itemName, bpQty, bpConst, price1, bidLbr, bidLbrUnit}]}]}`. "Section heads" have `items:[]` and zero prices.
- **mc-price-model.json**: `{meta, items:{itemNum:{n,p,l,u}}  // name, per-each price, per-each labor, unit`
  `, assemblies:{assmNum:{m, u1, c:[[itemNum, qty]], cm, v}}}`. Per-each normalization divides by `{M:1000, C:100, Q:100}`. `v:1` ("verified") iff computed material is within max($0.02, 2%) of reported material — **only v:1 assemblies get automatic price recompute** when supplier prices change. Current: 5,865 items; 24,291 assemblies; 13,055 verified (54%).
- **mc-labor-book.json**: `{meta:{tabs, skipped…, elliot}, tabs:{tabName:[{level1,level2,level3, section, subsection, name, supplier?, entries:[{name, labor, price, assmNum}]}]}}`. Supplier sections' entries carry `partNumber` (plus `pricedAt` when the overlay records per-part dates) instead of `assmNum`. `meta.elliot` is populated (`HCP_1272501.csv`, imported 2026-07-18): `{sourceFile, importedAt, updated, flagged, newItems}` where `newItems` is the count of supplier entries actually in the book. When a local overlay is applied at runtime it adds `catalogSource: 'import' | 'published'` plus `pricesFrom` / `pricesImportedAt`; `sourceFile`/`importedAt` always describe the catalog on screen, which is what the per-part freshness badges date themselves from. For an imported catalog `importedAt` is the **newest per-part price date** (`McElliotCore.newestPartDate`), not the day the file was read — so re-loading a file that moved no prices leaves the book's date, and every badge, exactly where they were.
- **tab-mapping.json**: 22 MC level1 categories → the 6 app tabs (conduit/wire/devices/lighting/gear/specialSystems).
- **elliot-category-mapping.json**: 15 Elliot CSV categories → tab key or `null` (skip).
- **elliot-item-mappings.json**: `{version:1, mappings:{partNumber: itemNum}, skipped:[itemNum]}` — repo-committed confirmed matches (currently 173 auto matches from the `--match` run; grows as review-queue items are confirmed in-app and re-committed). `skipped` (optional, written by the in-app download) lists MC items the maintainer passed on with "Not this": `McElliotCore.withoutSkipped` drops them from every future review list, so a pass survives the next upload the way a confirmation does. `apply-elliot-prices.js --match` preserves the key.
- **vendor-profiles.json**: per-vendor CSV column indices, header validation strings, unit divisors, `bundledFile`.
- **elliot-price-overlay.json** (committed; built by the app or apply-elliot-prices.js): `{version:1, vendor, sourceFile, importedAt, enabledCategories, itemPrices:{itemNum: perEach}, itemPartNumbers:{itemNum: partNumber}, newItems:[[category,name,partNumber,price,pricedAt]]}` — `itemPartNumbers` (written by the in-app tool) records which supplier part priced each item, so "one part number, one MC item" is checkable after the fact. `pricedAt` (YYYY-MM-DD, `McElliotCore.stampNewItemDates`) is kept from the prior overlay when a part's price is unchanged, so re-imports only refresh dates where the price moved; 4-tuple overlays from before per-part dates still apply (entries fall back to the import day). Dates are carried forward from the **published** overlay when this computer has no price file of its own (`McElliotState.getPriorPricedParts`), so the first in-app import does not re-date 27,556 parts whose price never moved. The downloaded copy is passed through `McElliotCore.sanitizeOverlayForDownload`, which strips the browser's own bookkeeping (`newItemsCount`, `categoryCounts`, `newItemsIncomplete`, `newItemsTruncated`, `allCats`) — those never belong in a repo artifact.

## Runtime Elliot flow (browser)

1. `McElliotState.loadReferenceData()` fetches mc-price-model.json + the three mapping JSONs + vendor-profiles.json (cached).
2. "Update Supplier Prices" modal (`McElliotUpdate.processText`): parse CSV (`McElliotCore.parseVendorCsv`) → dedupe (keep lowest price) → `McElliotMatch.runMatching` (saved mappings first, then token-index fuzzy matching in 500-row chunks; score = 0.65·coverage + 0.35·jaccard with trade-size/wire-size boosts; auto ≥ 0.8 with 0.15 margin, review ≥ 0.45, price-sanity ratio 0.2–5). A review row also carries `category` (the best candidate's supplier category, what the review list groups by), `reason`/`reasonCode` (why it was not taken: `near-tie` names the rival at a different price, which the row's three shown candidates may not include — `price-jump`, `partial-name`), and `bulkOk`.
3. `McElliotCore.resolveMatchCollisions` enforces **one supplier part number, one MC item**: an automatic guess at a part number a saved mapping (or a stronger guess) already holds does not overwrite it — it goes to the review queue carrying `heldPartNumber` / `heldByItemNum` / `heldByItemName`, and is counted separately in the summary ("Held back — the part number already prices another item"). Confirming such a row in the review tab moves the part number, and `resolveQueueItem` drops the losing item's overlay price with it. The same guard runs in `apply-elliot-prices.js --match`.
4. Result → overlay: the small half (prices, counts, category counts) in `mc-elliot-overlay` localStorage, the parts list in IndexedDB (`takeoff-elliot` › `overlay` › `newItems`, with `mc-elliot-overlay-items` as fallback); ambiguous matches → review queue; auto matches persisted to `mc-elliot-mappings`.
5. `McElliotState.getPatchedBook(book)` applies overlay: `recomputeAssemblies` (only `v===1` assemblies scale `u1` by material ratio; others flagged ⚠ unverified) + `patchLaborBook` (patches entry prices, appends per-category `supplier:true` sections). **An overlay only replaces the committed supplier catalog when it carries a parts list of its own** (`McElliotCore.overlayReplacesCatalog`); an overlay with no parts list — empty, or a list this browser refused to store — leaves the published catalog exactly where it is, prices still applied. `meta.elliot.newItems` reports the supplier entries actually present, so the Assemblies status line can never call a loss a success.
6. Review tab: rows are grouped by supplier category with a filter box (`TakeoffUtils.makeTokenMatcher`) and a category picker, 200 rendered at a time. A decision patches the one row out of the DOM rather than re-rendering the list, and the status line is set *after* the render so the confirmation survives. **Match** writes a mapping; **Not this** writes a skip (see `skipped` above). `McElliotState.resolveQueueItems` applies any number of decisions with one queue, mapping and overlay write.
7. Summary tab download buttons produce updated mc-labor-book.json / overlay / mappings / category mapping for publishing back to everyone. Every one of the four reports its size against the published file it replaces; the book download **refuses** when the patched book would carry fewer supplier parts than the committed one, and the overlay download refuses when this computer does not hold the parts list.

## Known issues

- `scripts/hierarchy/align.py` reads `merged.jsonl` + `overrides.json` from its own directory — those inputs are not committed, so the align step can't be re-run as-is (one-time tool; its outputs are preserved in `source-data/review/`).
- Elliot outputs are **committed** (from `HCP_1272501.csv` via `apply-elliot-prices.js --match`): the overlay, 173 auto-generated item mappings, and a patched `mc-labor-book.json` (~7.8 MB with 27,556 supplier entries; `meta.elliot` records the import). Re-running the bundled file in-app now re-derives 2,529 review rows (2,525 fuzzy candidates plus the 4 part numbers held back from a saved mapping) and changes no committed mapping. 2,525 fuzzy candidates still need human confirmation — they're saved in `source-data/elliot-review-queue.json` for reference, and the in-app "Update Supplier Prices" review tab re-derives them (confirmed matches should be downloaded from the app and committed into `elliot-item-mappings.json`). Note the recompute showed **avg −36.5% price delta** on verified assemblies — the pre-Elliot book prices were dated.
- There is deliberately **no bulk action** on the review list: a perfect-score tie whose near-tied rivals all cost the same is exactly the case `classifyMatches` auto-accepts (it lifts the margin to 1), so such rows never reach review — a "match all identical-price ties" button was measured empty on the bundled file and removed.
- Hierarchy coverage: of 4,629 section heads, 3,776 assigned, 853 unmatched (see `source-data/review/stats.txt`).
- `scripts/build-mc-labor-book.js` re-applies the overlay at the end of a rebuild specifically so full rebuilds don't drop Elliot prices — keep that step if you touch the build.
