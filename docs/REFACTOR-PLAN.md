# Refactor Plan — making the codebase manageable

Status: **in progress.** Done so far: step 1 (labor-book defaults → `js/data/laborBookDefaults.js`; state.js 1,388 → ~700 lines), the persistence half of step 2 (`js/storage.js` adapter — all `takeoff-*` writes go through it), dead-code removal (`detectFormat`, several unused locals), and the repo now has a quality gate (`npm run check` + Playwright specs) to protect the remaining extractions.

Remaining goal: split the large files along their natural seams and remove duplication/dead weight, without changing behavior or introducing a build step.

## Constraints every split must respect

1. **No build step.** New files are added as additional `<script>` tags in index.html, in dependency order. Keep the IIFE-global pattern (or agree to migrate to ES modules as a separate, deliberate step).
2. **Closure state.** Everything in state.js closes over shared mutable bindings (`manifest`, `laborBook`, temp buffers) inside one IIFE. A split needs a shared internal state object passed between sub-modules, or an accessor layer — sub-modules can't just be cut-and-pasted.
3. **The `render`/`attachListeners` contract.** app.js and mcElliotUpdate.js call these externally; any view split must keep the same exported pair.
4. **Public API stability.** Other files reference `TakeoffState.*` / `TakeoffApp.*` by name ~200 times. Keep the facade objects and delegate internally.

## Targets, in suggested order

### 1. ~~Extract labor-book default data from state.js~~ ✅ DONE
Now `js/data/laborBookDefaults.js` (`LABOR_BOOK_DEFAULTS` + `LABOR_BOOK_DEFAULT_GROUPS`); state.js deep-clones the defaults at load.

### 2. Split the rest of state.js (~700 lines now)
✅ **Persistence adapter done** — `js/storage.js` (`TakeoffStorage`); state.js keeps only the debounce/restore logic. Remaining seams:
- **Manifest CRUD + import sanitization**.
- **UI/ephemeral state**: current view, modal ids, temp buffers, fill targets — independent of manifest data.
- **Computed selectors**: pure functions over manifest (`getTotalLabor`, `getPurchaseList`, `getSummaryBreakdown`, …).
- **Labor-book CRUD + assemblies**.
Keep `TakeoffState` as the single exported facade composing the parts.

### 3. Split views/laborBook.js (1,030 lines)
Self-contained seams:
- **Apply-to-takeoff logic** (`addEntryToTarget`, `addComponentsToTarget`, `hasFillTarget`, `describeBookRow`; ~L21–125, 331–417): no rendering, also consumed by McBook — best first extraction.
- **Elliot parts group** (~L419–548): fully self-contained (own listeners, own debounced filter).
- **Global search** (~L554–648 + its delegated listener L974–1023).
- **Parts rendering + listeners** (~L127–283, 816–908).
- **Modal chrome / apply-to header / one-time init** (~L650–723, 911–1027).

### 4. Split views/conduit.js (481 lines)
Cleanly splits by wizard step (render + listeners per step): step1 trenching L23–104/210–336, step2 fittings L106–162/338–425, step3 overage L164–198/427–477. Alternatively keep one file but factor the shared overage logic (see 5).

### 5. Deduplicate shared view code → `js/views/shared.js` (or fold into utils.js)
- `TRASH_SVG` / `BOOK_SVG` duplicated verbatim in manifest.js, device.js, conduit.js.
- Local `escapeHtml` alias in every view.
- Overage render/compute/save logic near-identical in conduit step 3 and wire.js.
- Blank-row-reseed idiom repeated in device/conduit/wire remove handlers.
- `TYPE_LABELS` / `CHILD_TYPE_LABELS` (manifest.js) overlap `LABOR_BOOK_TYPE_LABELS` (state.js).

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
