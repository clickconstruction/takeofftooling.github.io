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

Auxiliary: `scripts/extract-section-heads.js` dumps section heads to `mc-section-heads.csv` for review. `scripts/merge-hierarchy.js` is an earlier hierarchy-merge path (reads the 6-row `mc-hierarchy-mapping.csv`) — superseded by align/propagate.

## Artifact schemas

- **source-data/mc-assemblies.json**: `{meta:{totalAssemblies, byFile,…}, assemblies:[{assmNum, assmName, material, laborHours, unitPrice1, unitPrice2, level1, level2, level3, section, subsection, items:[{itemNum, itemName, bpQty, bpConst, price1, bidLbr, bidLbrUnit}]}]}`. "Section heads" have `items:[]` and zero prices.
- **mc-price-model.json**: `{meta, items:{itemNum:{n,p,l,u}}  // name, per-each price, per-each labor, unit`
  `, assemblies:{assmNum:{m, u1, c:[[itemNum, qty]], cm, v}}}`. Per-each normalization divides by `{M:1000, C:100, Q:100}`. `v:1` ("verified") iff computed material is within max($0.02, 2%) of reported material — **only v:1 assemblies get automatic price recompute** when supplier prices change. Current: 5,865 items; 24,291 assemblies; 13,055 verified (54%).
- **mc-labor-book.json**: `{meta:{tabs, skipped…, elliot}, tabs:{tabName:[{level1,level2,level3, section, subsection, name, supplier?, entries:[{name, labor, price, assmNum}]}]}}`. Supplier sections' entries carry `partNumber` instead of `assmNum`. Currently `meta.elliot` is `null` (no supplier data committed).
- **tab-mapping.json**: 22 MC level1 categories → the 6 app tabs (conduit/wire/devices/lighting/gear/specialSystems).
- **elliot-category-mapping.json**: 15 Elliot CSV categories → tab key or `null` (skip).
- **elliot-item-mappings.json**: `{version:1, mappings:{partNumber: itemNum}}` — repo-committed confirmed matches (currently 173 auto matches from the `--match` run; grows as review-queue items are confirmed in-app and re-committed).
- **vendor-profiles.json**: per-vendor CSV column indices, header validation strings, unit divisors, `bundledFile`.
- **elliot-price-overlay.json** (committed; built by the app or apply-elliot-prices.js): `{version:1, vendor, sourceFile, importedAt, enabledCategories, itemPrices:{itemNum: perEach}, newItems:[[category,name,partNumber,price]]}`.
- **source-data/mcPriceBook.json** (8.8 MB, 43,049 records): **dead data** — zero references in js/, index.html, or scripts/. Per-item MC price book from an earlier approach (formerly at `js/data/`), superseded by mc-price-model.json. Candidate for deletion.

## Runtime Elliot flow (browser)

1. `McElliotState.loadReferenceData()` fetches mc-price-model.json + the three mapping JSONs + vendor-profiles.json (cached).
2. "Update Supplier Prices" modal (`McElliotUpdate.processText`): parse CSV (`McElliotCore.parseVendorCsv`) → dedupe (keep lowest price) → `McElliotMatch.runMatching` (saved mappings first, then token-index fuzzy matching in 500-row chunks; score = 0.65·coverage + 0.35·jaccard with trade-size/wire-size boosts; auto ≥ 0.8 with 0.15 margin, review ≥ 0.45, price-sanity ratio 0.2–5).
3. Result → overlay in `mc-elliot-overlay` localStorage; ambiguous matches → review queue; auto matches persisted to `mc-elliot-mappings`.
4. `McElliotState.getPatchedBook(book)` applies overlay: `recomputeAssemblies` (only `v===1` assemblies scale `u1` by material ratio; others flagged ⚠ unverified) + `patchLaborBook` (patches entry prices, appends per-category `supplier:true` sections).
5. Summary tab download buttons produce updated mc-labor-book.json / overlay / mappings for committing back into the repo, making supplier prices permanent for all users.

## Known issues

- `scripts/hierarchy/align.py` reads `merged.jsonl` + `overrides.json` from its own directory — those inputs are not committed, so the align step can't be re-run as-is (one-time tool; its outputs are preserved in `source-data/review/`).
- Elliot outputs are **committed** (from `HCP_1272501.csv` via `apply-elliot-prices.js --match`): the overlay, 173 auto-generated item mappings, and a patched `mc-labor-book.json` (~7.8 MB with 27,556 supplier entries; `meta.elliot` records the import). 2,525 fuzzy candidates still need human confirmation — they're saved in `source-data/elliot-review-queue.json` for reference, and the in-app "Update Supplier Prices" review tab re-derives them (confirmed matches should be downloaded from the app and committed into `elliot-item-mappings.json`). Note the recompute showed **avg −36.5% price delta** on verified assemblies — the pre-Elliot book prices were dated.
- Hierarchy coverage: of 4,629 section heads, 3,776 assigned, 853 unmatched (see `source-data/review/stats.txt`).
- `scripts/build-mc-labor-book.js` re-applies the overlay at the end of a rebuild specifically so full rebuilds don't drop Elliot prices — keep that step if you touch the build.
