# source-data/ — build-time inputs & intermediates (NOT needed at runtime)

Everything in this folder feeds the offline pipeline in `scripts/` that generates the runtime JSON in `mc-assemblies/`. The deployed app never fetches anything from here — **this whole folder can be pulled out of the repo (or excluded from the Count Tooling integration) without affecting the app**, as long as you don't need to re-run the pipeline.

| File(s) | What |
|---|---|
| `mc1to10000.csv` … `mc30001to34810.csv` | Raw MC (McCormick) "Assemblies & Byproducts" report exports — the original source of truth (~14 MB) |
| `mc-assemblies.json` | 40 MB intermediate: the CSVs parsed + hierarchy propagated. Input to `build-mc-price-model.js` and `build-mc-labor-book.js` |
| `hierarchy-images/` | ~809 screenshots of the MC category picker (one-time hierarchy recovery input) |
| `hierarchy-staging.jsonl`, `hierarchy-extracted.jsonl`, `extraction-log.txt` | LLM image-extraction outputs/logs |
| `mc-hierarchy.csv`, `mc-section-heads.csv` | Hierarchy review artifacts |
| `review/` | align.py outputs: `heads-assigned.csv`, unmatched reports, `stats.txt` |
| `file1_final.csv`, `file1_improved.csv` | Old per-item price exports (superseded; kept for reference) |

What stays behind (still required):
- `mc-assemblies/` — the five JSONs the app fetches at runtime + `tab-mapping.json` (build config)
- `import-files/HCP_1272501.csv` — fetched at runtime as the bundled Elliot sample (`vendor-profiles.json → bundledFile`)

See [docs/DATA-PIPELINE.md](../docs/DATA-PIPELINE.md) for the full build DAG.
