# Runtime Architecture

Vanilla JS, no build step. Every file is an IIFE assigned to a top-level `const` global, loaded by `<script>` tags in [index.html](../index.html). Load order (must be preserved):

```
jspdf (CDN 2.5.1)
js/utils.js            → TakeoffUtils
js/data/fittings.js    → FITTINGS_LIST
js/data/laborBookDefaults.js → LABOR_BOOK_DEFAULTS, LABOR_BOOK_DEFAULT_GROUPS
js/storage.js          → TakeoffStorage  (persistence adapter)
js/uiState.js          → TakeoffUiState  (ephemeral UI state; re-exported by TakeoffState)
js/selectors.js        → TakeoffSelectors (pure manifest selectors; dual browser/Node)
js/state.js            → TakeoffState
js/import.js           → TakeoffImport
js/elliotPriceCore.js  → McElliotCore   (dual browser/Node)
js/mcElliotState.js    → McElliotState
js/mcElliotMatch.js    → McElliotMatch
js/mcElliotUpdate.js   → McElliotUpdate
js/mcBook.js           → McBook
js/pdf.js              → TakeoffPDF
js/views/shared.js     → TakeoffViewShared (icons, overage helpers)
js/views/manifest.js   → TakeoffManifestView
js/views/modal.js      → TakeoffModal
js/views/laborBookTargets.js → TakeoffLaborBookTargets (apply-to-takeoff logic)
js/views/laborBookElliot.js  → TakeoffLaborBookElliot  (supplier parts group)
js/views/laborBookSearch.js  → TakeoffLaborBookSearch  (global search, owns the term)
js/views/laborBook.js  → TakeoffLaborBookView (facade; stable public API)
js/views/device.js     → TakeoffDeviceView
js/views/conduit.js    → TakeoffConduitView
js/views/wire.js       → TakeoffWireView
js/app.js              → window.TakeoffApp  (runs init)
```

Only `TakeoffApp` is explicitly on `window`; the rest are top-level `const` (visible cross-script via global lexical scope, but **not** `window.X` properties).

## Dependency table

| File | Defines | Consumes |
|---|---|---|
| utils.js | `TakeoffUtils` (`escapeHtml` only) | — |
| data/fittings.js | `FITTINGS_LIST` | — |
| data/laborBookDefaults.js | `LABOR_BOOK_DEFAULTS`, `LABOR_BOOK_DEFAULT_GROUPS` (pure data) | — |
| storage.js | `TakeoffStorage` (load/saveWorkspace, load/saveAssemblies) | localStorage |
| uiState.js | `TakeoffUiState` (view/modal ids, temp buffers, fill targets, toggles) | — |
| selectors.js | `TakeoffSelectors` (pure fns over a manifest arg; CommonJS export for tests) | — |
| state.js | `TakeoffState` (facade, ~70 exports; spreads TakeoffUiState) | TakeoffStorage, TakeoffUiState, TakeoffSelectors, LABOR_BOOK_DEFAULTS |
| import.js | `TakeoffImport` | TakeoffState, TakeoffApp, TakeoffUtils |
| pdf.js | `TakeoffPDF` | TakeoffState, `jspdf` |
| elliotPriceCore.js | `McElliotCore` | — (pure; also `require`d by Node scripts) |
| mcElliotState.js | `McElliotState` | McElliotCore, localStorage, fetch |
| mcElliotMatch.js | `McElliotMatch` | McElliotCore |
| mcElliotUpdate.js | `McElliotUpdate` | McElliotState/Core/Match, McBook, TakeoffLaborBookView, TakeoffUtils |
| mcBook.js | `McBook` | TakeoffState, TakeoffUtils, McElliotState, TakeoffLaborBookView, TakeoffApp |
| views/shared.js | `TakeoffViewShared` (TRASH_SVG, BOOK_SVG, computeOverage, renderOverageSection) | — |
| views/manifest.js | `TakeoffManifestView` | TakeoffState, TakeoffApp, TakeoffPDF, TakeoffUtils, TakeoffViewShared |
| views/modal.js | `TakeoffModal` | TakeoffState, TakeoffApp |
| views/laborBookTargets.js | `TakeoffLaborBookTargets` (describeBookRow, addEntryToTarget, addComponentsToTarget, hasFillTarget) | TakeoffState, TakeoffApp |
| views/laborBookElliot.js | `TakeoffLaborBookElliot` (injectElliotParts) | McBook, TakeoffState, TakeoffLaborBookTargets, TakeoffUtils |
| views/laborBookSearch.js | `TakeoffLaborBookSearch` (getTerm/setTerm/renderResults + one-time search listeners) | TakeoffState, McBook, TakeoffLaborBookTargets, TakeoffLaborBookView, TakeoffApp, TakeoffUtils |
| views/laborBook.js | `TakeoffLaborBookView` (facade — re-exports the Targets API) | TakeoffState (heavily), TakeoffApp, McBook, TakeoffUtils, TakeoffLaborBook{Targets,Elliot,Search}, TakeoffViewShared |
| views/device.js | `TakeoffDeviceView` | TakeoffState, TakeoffApp, TakeoffUtils |
| views/conduit.js | `TakeoffConduitView` | TakeoffState, TakeoffApp, TakeoffUtils, FITTINGS_LIST |
| views/wire.js | `TakeoffWireView` | TakeoffState, TakeoffApp, TakeoffUtils |
| app.js | `window.TakeoffApp` | everything above |

Circular-ish coupling (views ↔ TakeoffApp, McBook ↔ McElliotState ↔ TakeoffLaborBookView) works because all cross-calls happen after load; several use `typeof X !== 'undefined'` guards.

## State (`js/state.js`, `TakeoffState`)

### Manifest item (canonical shape)

```js
{ id,                    // 'id_' + Date.now() + '_' + rand
  type,                  // string|null — see type lists below
  description, quantity,
  labor,                 // per-unit hours (number)
  price,                 // number|null
  planPage,              // string
  parentId,              // string|null
  children,              // [item] — max depth 2 (getItemById only searches top + children)
  conduitMeta, meta }    // meta: trenching {feet, material, depth, pricePerFoot}; overage {overagePercent}
```

Top-level `type` values (`ITEM_TYPES`): `lighting gear devices conduit wire specialSystems permits powerCoCharges temporaryPower`.

Child `type` values by flow:
- **devices**: `outletsAndSwitches box backBoxSupport cover conduit wire screws misc`
- **conduit**: `trenching trenchingAddon fitting overage`
- **wire**: `overage macAdapter`

### Assemblies (device-flow presets)

`{id, name, sections: {sectionKey: [{description, quantity, labor, price}]}, createdAt}` — 8 device section keys. Created via "Save as Assembly" in device.js; loaded back into the device temp buffer, not directly into the manifest.

### Labor Book (editable "Parts" side)

`laborBook[type][sectionName] = [{name, labor, price}]`. Defaults live in `js/data/laborBookDefaults.js` (pure data); state.js deep-clones `LABOR_BOOK_DEFAULTS` at load so user edits never mutate the defaults. Conduit tab has extra grouping config (`LABOR_BOOK_DEFAULT_GROUPS`).

### Undo/redo

Snapshot-based (full JSON clone of manifest), 50 deep. `beginBatch()`/`endBatch()` collapse multi-step mutations into one frame; `updateItem` coalesces same-item edits within 1200 ms. **Manifest only** — laborBook/assemblies/laborRate changes are not undoable.

### Computed selectors (pure functions over manifest)

`getTotalLabor`, `getTotalPrice`, `getPurchaseList` (merges identical descriptions, skips permits/powerCo/tempPower), `getFlattenedItems` (adds `_depth`), `getSummaryBreakdown` (materials + 8.5% `SALES_TAX_RATE` + labor + other charges).

## localStorage keys

All `takeoff-*` writes go through the `TakeoffStorage` adapter (js/storage.js) — swap that file's four functions to move persistence to a database; nothing else touches storage directly. The `mc-elliot-*` keys are still written directly by mcElliotState.js.

| Key | Owner | Content |
|---|---|---|
| `takeoff-workspace` | storage.js (via state.js) | `{v:1, savedAt, manifest, laborBook, laborRate}` — 400 ms debounced write, flushed on `beforeunload`; restore hard-requires `v===1` |
| `takeoff-assemblies` | storage.js (via state.js) | assemblies array — written immediately |
| `mc-elliot-overlay` | mcElliotState.js | supplier price overlay (max ~2.5 MB, `newItems` dropped if over) |
| `mc-elliot-mappings` | mcElliotState.js | `{version:2, vendors:{vendor:{partNumber: itemNum}}}` (v1 migration exists) |
| `mc-elliot-review-queue` | mcElliotState.js | fuzzy-match review queue (truncated to 2,000) |
| `mc-elliot-category-overrides` | mcElliotState.js | per-category destination tab overrides |

app.js also deletes a set of retired `part-book-*` / `labor-book-import-progress` keys on boot.

## View pattern

Every view exports `{ render, attachListeners }`. `TakeoffApp.render()` switches on `TakeoffState.getCurrentView()` (`'manifest'|'device'|'conduit'|'wire'`), sets `#main-content.innerHTML = View.render(...)`, then calls `View.attachListeners(...)`. Nearly every interaction triggers a full re-render; listeners are re-bound wholesale each time (exceptions: laborBook module-init one-time listeners, a few delegated handlers in laborBook/mcBook, and `TakeoffManifestView.updateSummaryOnly()` which patches only the summary).

## Flow editors (device / conduit / wire)

Shared pattern: `TakeoffApp.navigateToX(itemId)` hydrates a per-flow **temp buffer** in TakeoffState from `parent.children` (mapping child `type` → section); the view edits only the buffer; save strips the relevant child types from `parent.children` (direct mutation) and re-adds each meaningful row via `TakeoffState.addItem(..., parentId)`, wrapped in `beginBatch()/endBatch()`. `navigateToManifest()` clears all temp buffers.

- **Device**: single page, 8 sections, ×2/÷2 qty helpers, Save-as-Assembly + assemblies browser.
- **Conduit**: 3-step wizard (Trenching → Fittings → Overage), step inferred from existing children on entry. **Each step transition commits children immediately** — "Back" does not undo them. Fitting presets come from `FITTINGS_LIST`. Legacy items without `meta` are re-parsed from description strings.
- **Wire**: overage % + MAC adapters (no price column in UI; price can still arrive via PB fill).

"PB" buttons everywhere open the Labor & Price Book in **fill mode**: fill-target kinds are `{kind:'manifest-row'|'device-row'|'conduit-fitting'|'wire-mac', ...}`; the picked part fills the clicked row in place (`TakeoffLaborBookView.addEntryToTarget`).

## Modal ownership

Six modal skeletons live in index.html:

| Modal | Open/close | Content/logic |
|---|---|---|
| `#type-modal` | app.js (`showTypeModal`) | views/modal.js (selection + `G/L/D/C/W/S` hotkeys) |
| `#labor-book-modal` | app.js (`showLaborBookModal*`, `openLaborBookFill`) | views/laborBook.js (+ McBook for Assemblies side) |
| `#mc-elliot-modal` | mcElliotUpdate.js | mcElliotUpdate.js |
| `#abbreviation-key-modal` | laborBook.js one-time init | static HTML |
| `#import-preview-modal` | import.js | import.js |
| `#form-modal` | manifest.js opens; app.js wires cancel/print | app.js → `TakeoffPDF.printWithForm` |

## Import / export formats

- **CountTooling clipboard import** (import.js): one line per row, tab-separated `fixture \t count \t page`. Type inferred by regex on description. Preview modal offers Add All vs Add Overages Only (skips existing descriptions; never merges quantities). Single undo frame.
- **Structured import handoff** (import.js `importFromPayload` + app.js `#import=` hash route): the no-clipboard path for Count Tooling integration. URL: `<app>/#import=<base64 JSON>` with payload `{v:1, source, items:[{description, count|quantity, page?, type?}]}`. Invalid `type` values fall back to regex inference; items flow through the same preview modal. The hash is stripped before the preview shows.
- **Export via link** (app.js): `#d=` + base64 of `{v:2, app:'takeoff-tooling', exportedAt, manifest}`; on load, hash import sanitizes recursively (`sanitizeImportedItem`), confirms if unsaved work exists, then strips the hash. Import accepts the envelope or a legacy bare array; `v` is ignored.
- **PDF exports** (pdf.js): review (full columns + total labor), purchase order (item+qty), with-form (details block). Manual jsPDF layout, letter format.

## Labor & Price Book modal (two sides)

- **Parts** (views/laborBook.js): editable per-tab sections from `TakeoffState.getLaborBook()`, plus a live-injected "Elliot Parts" group per tab from supplier sections.
- **Assemblies** (mcBook.js): fetches `mc-assemblies/mc-labor-book.json`, patches with the local Elliot overlay (`McElliotState.getPatchedBook`), renders a lazy level1→level2→section tree; entries can be added rolled-up or exploded into components (`getComposition` via `mc-price-model.json`). Global search spans both sides.
- **Update Supplier Prices** (mcElliotUpdate.js): parse vendor CSV → dedupe → match against MC items (saved mappings first, then token-index fuzzy matching in chunks) → build overlay → auto/review/summary tabs → download buttons to commit updated JSON back into `mc-assemblies/`. See [DATA-PIPELINE.md](DATA-PIPELINE.md).

## Known quirks

- Export envelope is `v:2`, workspace persistence is `v:1`; neither has real migration logic (`restoreWorkspace` silently drops anything not `v===1`).
- `getItemById` reaches depth 2 only; `sanitizeImportedItem` recurses arbitrarily deep — grandchildren would import but be unreachable.
- `TRASH_SVG`/`BOOK_SVG` constants duplicated verbatim in manifest.js, device.js, conduit.js; overage render/save logic near-duplicated between conduit step 3 and wire.js; blank-row-reseed idiom repeats across flows.
- css/styles.css is one 3,541-line file organized by `/* section */` comments (several sections belong to retired "Part Book" features).
