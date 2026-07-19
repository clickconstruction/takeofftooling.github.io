# Refactor Plan — making the codebase manageable

Status: **steps 1–5 done** (2026-07-18). Landed: labor-book defaults extraction, the `TakeoffStorage` adapter, the full state.js split (`js/uiState.js` + `js/selectors.js`; state.js 1,388 → ~400 lines), the laborBook.js split (1,030 → ~540 + 3 modules), the shared-view module (`js/views/shared.js`: icons + overage helpers), dead-code removal, and the quality gate (`npm run check` + Playwright). Remaining: item 6 dead-weight candidates and the optional/later items below.

## Constraints every split must respect

1. **No build step.** New files are added as additional `<script>` tags in index.html, in dependency order. Keep the IIFE-global pattern (or agree to migrate to ES modules as a separate, deliberate step).
2. **Closure state.** Everything in state.js closes over shared mutable bindings (`manifest`, `laborBook`, temp buffers) inside one IIFE. A split needs a shared internal state object passed between sub-modules, or an accessor layer — sub-modules can't just be cut-and-pasted.
3. **The `render`/`attachListeners` contract.** app.js and mcElliotUpdate.js call these externally; any view split must keep the same exported pair.
4. **Public API stability.** Other files reference `TakeoffState.*` / `TakeoffApp.*` by name ~200 times. Keep the facade objects and delegate internally.

## Targets, in suggested order

### 1. ~~Extract labor-book default data from state.js~~ ✅ DONE
Now `js/data/laborBookDefaults.js` (`LABOR_BOOK_DEFAULTS` + `LABOR_BOOK_DEFAULT_GROUPS`); state.js deep-clones the defaults at load.

### 2. ~~Split the rest of state.js~~ ✅ DONE
`js/storage.js` (persistence adapter), `js/uiState.js` (ephemeral UI state, re-exported by the facade via spread), `js/selectors.js` (pure manifest selectors, dual browser/Node, unit-tested in selectors.test.js). state.js (~400 lines) keeps manifest CRUD, undo/redo, labor-book CRUD, assemblies, and the facade.

### 3. ~~Split views/laborBook.js~~ ✅ DONE
`js/views/laborBookTargets.js` (apply-to-takeoff; also consumed by McBook), `js/views/laborBookElliot.js` (supplier parts group), `js/views/laborBookSearch.js` (global search + its one-time listeners; owns the search term). laborBook.js (~540 lines) is the facade — its public API is unchanged and delegates the target functions.

### 4. Split views/conduit.js (481 lines) — deferred
Still splits cleanly by wizard step if it grows further; the shared overage logic was extracted in step 5, which was the load-bearing part.

### 5. ~~Deduplicate shared view code~~ ✅ DONE (the valuable parts)
`js/views/shared.js` (`TakeoffViewShared`): `TRASH_SVG`/`BOOK_SVG` (now aliased in manifest/device/conduit/laborBook), `computeOverage`, and `renderOverageSection` (used by conduit step 3 and wire). Deliberately not done: the blank-row-reseed idiom (shapes differ per flow; low value) and merging `TYPE_LABELS`/`CHILD_TYPE_LABELS` with `LABOR_BOOK_TYPE_LABELS` (different label sets).

### 6. Dead weight removal
- `source-data/mcPriceBook.json` — 8.8 MB, referenced nowhere (moved out of `js/data/` with the rest of the build-only data). Delete whenever, or let it leave with `source-data/`.
- Retired "Part Book" CSS sections in styles.css (~L807–1700 region markers: Labor Book Import, Part Book Elliot Import/Matching/Set Section/Search) — verify selectors are unused, then prune.
- `scripts/merge-hierarchy.js` — superseded by align/propagate; delete or mark legacy.

### 7. Optional / later
- Split css/styles.css by feature area (only worthwhile if we accept more `<link>` tags or a concat step).
- ES-module migration (would remove load-order fragility and the globals table; requires touching every file — do only after the splits above settle).
- Real event delegation instead of wholesale listener re-binding (perf/robustness, larger change).

## Verification per step

Run `npm run check` (lint + unit tests) and `npx playwright test` (boot/manifest/undo/import-handoff/labor-book smoke) after each extraction. The specs don't cover everything yet — additionally hand-exercise whatever the extraction touched: flow editors (device incl. Save-as-Assembly, conduit all 3 steps, wire), fill-mode "PB" buttons, PDF exports, export-via-link round-trip, reload (workspace restore). Load-order mistakes fail loudly in the console on boot.
