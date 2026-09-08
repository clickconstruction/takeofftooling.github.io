# Runtime Architecture

Vanilla JS, no build step. Every file is an IIFE assigned to a top-level `const` global, loaded by `<script>` tags in [index.html](../index.html). Load order (must be preserved):

```
jspdf (CDN 2.5.1)
js/utils.js            → TakeoffUtils
js/data/fittings.js    → FITTINGS_LIST
js/data/laborBookDefaults.js → LABOR_BOOK_DEFAULTS, LABOR_BOOK_DEFAULT_GROUPS, LABOR_BOOK_DEFAULTS_VERSION
js/laborBookMerge.js   → TakeoffLaborBookMerge (defaults merge + corrections diff; dual browser/Node)
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
js/views/laborBookElliot.js  → TakeoffLaborBookElliot  (supplier parts in universal sections)
js/views/laborBookSearch.js  → TakeoffLaborBookSearch  (global search, owns the term)
js/views/laborBookCard.js    → TakeoffLaborBookCard    (part card modal: offers, quotes, history, catalog promotion)
js/views/projects.js         → TakeoffProjectsView     (project switcher + Manage Projects modal)
js/views/users.js            → TakeoffUsersView        (Manage Users modal, dev role only)
js/views/laborBook.js  → TakeoffLaborBookView (facade; stable public API)
js/views/device.js     → TakeoffDeviceView
js/views/conduit.js    → TakeoffConduitView
js/views/wire.js       → TakeoffWireView
js/views/organize.js   → TakeoffOrganizeView (full-page category organizer, preview)
js/cloud.js            → TakeoffCloud     (Supabase sync + password/email-code auth; CDN: @supabase/supabase-js UMD)
js/suggestionsReview.js → TakeoffSuggestionsReview (admin review of shared corrections)
js/app.js              → window.TakeoffApp  (runs init)
```

Only `TakeoffApp` is explicitly on `window`; the rest are top-level `const` (visible cross-script via global lexical scope, but **not** `window.X` properties).

## Dependency table

| File | Defines | Consumes |
|---|---|---|
| utils.js | `TakeoffUtils` (`escapeHtml` only) | — |
| data/fittings.js | `FITTINGS_LIST` | — |
| data/laborBookDefaults.js | `LABOR_BOOK_DEFAULTS`, `LABOR_BOOK_DEFAULT_GROUPS` (pure data) | — |
| laborBookMerge.js | `TakeoffLaborBookMerge` (bootstrap/mergeDefaults/computeCorrections; pure, CommonJS export for tests) | — |
| storage.js | `TakeoffStorage` (load/saveWorkspace, load/saveAssemblies) | localStorage; notifies TakeoffCloud after saves (typeof-guarded) |
| cloud.js | `TakeoffCloud` (password + email-code auth, cloud pull/push, corrections sharing, #cloud-modal UI) | `supabase` UMD (CDN), TakeoffStorage, TakeoffState, TakeoffApp, TakeoffUtils |
| suggestionsReview.js | `TakeoffSuggestionsReview` (#suggestions-modal; admin-only) | TakeoffCloud, TakeoffUtils |
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
| views/laborBookElliot.js | `TakeoffLaborBookElliot` (injectElliotParts — supplier sections/offers) | McBook, TakeoffState, TakeoffLaborBookTargets, TakeoffViewShared, TakeoffUtils |
| views/laborBookSearch.js | `TakeoffLaborBookSearch` (getTerm/setTerm/renderResults + one-time search listeners) | TakeoffState, McBook, TakeoffLaborBookTargets, TakeoffLaborBookView, TakeoffApp, TakeoffUtils |
| views/laborBookCard.js | `TakeoffLaborBookCard` (openForBookRow/openForCatalogPart/close/isOpen) | TakeoffState, TakeoffViewShared, TakeoffLaborBookView, TakeoffUtils |
| views/projects.js | `TakeoffProjectsView` (updateHeader/openModal) | TakeoffState, TakeoffStorage, TakeoffApp, TakeoffUtils |
| views/users.js | `TakeoffUsersView` (openModal) | TakeoffCloud, TakeoffUtils |
| views/laborBook.js | `TakeoffLaborBookView` (facade — re-exports the Targets API) | TakeoffState (heavily), TakeoffApp, McBook, TakeoffUtils, TakeoffLaborBook{Targets,Elliot,Search}, TakeoffViewShared |
| views/device.js | `TakeoffDeviceView` | TakeoffState, TakeoffApp, TakeoffUtils |
| views/conduit.js | `TakeoffConduitView` | TakeoffState, TakeoffApp, TakeoffUtils, FITTINGS_LIST |
| views/wire.js | `TakeoffWireView` | TakeoffState, TakeoffApp, TakeoffUtils |
| views/organize.js | `TakeoffOrganizeView` (category organizer board; Apply commits via `TakeoffState.applyBookReorganization`) | TakeoffState, TakeoffApp, TakeoffUtils |
| app.js | `window.TakeoffApp` | everything above |

Circular-ish coupling (views ↔ TakeoffApp, McBook ↔ McElliotState ↔ TakeoffLaborBookView) works because all cross-calls happen after load; several use `typeof X !== 'undefined'` guards.

## State (`js/state.js`, `TakeoffState`)

### Manifest item (canonical shape)

```js
{ id,                    // uuid (legacy 'id_…' ids still accepted)
  type,                  // string|null — see type lists below
  description, quantity,
  unit,                  // 'ea' | 'ft' | 'px' — px = CountTooling unscaled run: flagged, excluded from all totals
  labor,                 // per-unit hours (number)
  price,                 // number|null
  planPage,              // string (pages / location)
  group,                 // string|null — CountTooling [Group] (circuit, panel, area); shown as a tag, never part of the name
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

`laborBook[type][sectionName] = [{name, labor, price, partNumber?, edited?, userAdded?, priceSource?, pricedAt?, offers?, history?}]`. `offers` holds one current quote per supply house (`{supplier, price, at, by}`); `history` is an append-only capped (50) change log (`{at, kind: 'price'|'labor', supplier?, value, by}`), `by` being the signed-in email's short name via `TakeoffCloud.getEmail()` (or `You`). `recordPartPrice` updates an offer (first quote, or a quote from the in-use supplier, moves the working price; `usePartOffer` switches it explicitly); `refreshSupplierOffers` syncs promoted parts' vendor offers from the catalog by part #, following the working price only when that vendor is in use. `priceSource`/`pricedAt` (YYYY-MM-DD) record who supplied a price and when: `updateLaborBookRow` stamps `You`/today whenever the price value changes (callers can pass explicit values), and the badge popover in the view can set them without touching the price — such provenance-only updates deliberately do **not** set `edited`, so the row still upgrades with future defaults merges. Defaults live in `js/data/laborBookDefaults.js` (pure data); state.js deep-clones `LABOR_BOOK_DEFAULTS` at load so user edits never mutate the defaults. Conduit tab has extra grouping config (`LABOR_BOOK_DEFAULT_GROUPS`).

**Provenance + defaults versioning** (js/laborBookMerge.js): `updateLaborBookRow` stamps `edited`, `addLaborBookRow` stamps `userAdded`, and deleting/renaming a default row records its name in a `removed` map. The workspace stores `laborBookMeta: {defaultsVersion, removed}`; on restore/adopt, a workspace older than `LABOR_BOOK_DEFAULTS_VERSION` gets `mergeDefaults` (untouched rows upgrade to new defaults, user-touched rows win, removed defaults stay removed) — bump the version constant whenever the defaults data changes. Pre-versioning workspaces are bootstrapped by diffing against the current defaults. The same flags drive `TakeoffState.getBookCorrections()` — the edit/new/remove diff a consenting user shares (see Cloud sync).

### Undo/redo

Snapshot-based (full JSON clone of manifest), 50 deep. `beginBatch()`/`endBatch()` collapse multi-step mutations into one frame; `updateItem` coalesces same-item edits within 1200 ms. **Manifest only** — laborBook/assemblies/laborRate changes are not undoable.

### Computed selectors (pure functions over manifest)

`getTotalLabor`, `getTotalPrice`, `getPurchaseList` (merges identical descriptions, skips permits/powerCo/tempPower; a parent with children contributes its own line only when it carries a price — price-less parents are groupings), `getFlattenedItems` (adds `_depth`), `getSummaryBreakdown(manifest, taxRate)` (materials + sales tax at the passed FRACTION, default `SALES_TAX_RATE` 0.0825 + labor + other charges; returns `taxRate` and `unscaledCount`), `countUnscaled`. Every selector skips `unit === 'px'` rows' own labor and price.

## Assembly kernel (js/explode.js, `TakeoffExplode`)

Pure, UMD (browser global / Deno module scope / `module.exports`). `TEMPLATES` match a parent by
`type` + a description regex (GFCI before receptacle; switch/dimmer/sensor; data drop; lay-in
fixture; EMT, PVC, MC runs) and list child rules `{ name, qty, per: 'count'|'run'|'ft', ftInterval,
childType }` — `{size}` in a name takes the trade size parsed off the parent (`sizeOf`).
`explodeItem(item, { book })` returns child rows priced by `lookup` over a flat book (`flattenBook`
of `laborBook[type][section][]`): exact normalized name, else every-token containment; a miss
leaves `labor`/`price` null with `meta.needsPricing` — never a guess. px (unscaled) parents never
explode. `explodeManifest` fills only childless parents (hand-built children win). Consumers: the
⚡ Explode button (manifest.js, the live book) and the agent door (`import-manifest`, the twin's
synced book or the bundled defaults JSON).

## Digital twins (the seat, the door, the bridge)

Mirrors CountTooling's half of PipeTooling's twin program. `supabase/004_takeoff_twins.sql`
adds `takeoff_profiles.is_digital_twin`, `twin_credentials`, and the bid-stamp/review columns on
`takeoff_projects`. Functions (`supabase/README.md` has auth + secrets): `twin-login` mints a
magic-link session (per-twin token or fleet secret; fleet email pattern + twin flag required);
`manage-user` is the server→server bridge PipeTooling commands (`create`, `lookup`, `set_twin_flag`,
`set_twin_credential`, `revoke_twin_credential`, `twin_projects`, `twin_manifest`,
`set_twin_project_review`); `import-manifest` is the agent door (twin JWT; payload v2 items →
normalized rows, exploded + priced through `_shared/explode.js`, upserted idempotently by
`(owner, external_ref)` else `(owner, name)`, review lane reset to `draft`). `twin_manifest` returns
the priced rows (`buildPipeToolingRows`), the counts text, and a `#d=` share URL so a human opens
the twin's manifest in their own app. The client shows the 🤖 banner for a flagged session and a
twin chip in Manage Users; humans get the same chips (bid stamp, review lane) on their own projects.

## Cloud sync (js/cloud.js, `TakeoffCloud`)

Optional Supabase mirror of the book, assemblies, and projects; the app stays local-first (boots synchronously from localStorage, works fully signed out or with the CDN blocked). Supabase project `takeoff-tooling` (`awjcdxqhvgnqsrlnoyxr`, us-east-2): `public.takeoff_store` (`user_id, key, value jsonb, updated_at`) holds the `book` and `assemblies` rows (a legacy `workspace` row is read once as a stand-in for a missing `book` row and left as backup), and `public.takeoff_projects` (`id, user_id, name, data jsonb, created_at, updated_at` — schema-aligned with Count Tooling's `projects` table; SQL in `supabase/001_takeoff_projects.sql`) holds one row per project (`data` = `{manifest, laborRate}`, `updated_at` = the client's savedAt). Both under RLS scoping every operation to `auth.uid() = user_id`. Roles live in `takeoff_profiles` (`user`/`admin`/`dev`, 002 migration): `admin` unlocks the suggestions review (via `is_takeoff_admin()`, now role-driven with the hardcoded-email check as a pre-002 fallback), `dev` additionally gets Manage Users (list/set-role RPCs + the `takeoff-admin` Edge Function for create/delete, which re-verifies the caller's dev role server-side). Projects sync per-row with last-write-wins by `updated_at` and union-merge on sign-in; a missing `takeoff_projects` table (SQL not yet applied) disables project sync gracefully.

**Shared-book corrections** (opt-in, `takeoff-share-corrections` localStorage flag, toggle in the cloud modal): after each workspace push, `TakeoffState.getBookCorrections()` is upserted into `public.takeoff_suggestions` (`user_id, email, tab, section, part_name, kind edit|new|remove, old_value, new_value, status pending|accepted|dismissed`; unique per user+part; RLS: users see only their own rows, `is_takeoff_admin()` — email match — sees all). Reverted edits are pruned on the next push; opting out deletes the user's rows. The admin account gets a "Review suggestions" ☰ menu item (js/suggestionsReview.js): pending rows aggregated per part (distinct users, median, ≥20× price-outlier flag), Accept/Dismiss updates status, and "Download accepted as defaults patch" emits JSON to apply to `js/data/laborBookDefaults.js` + version bump — the shared book only changes through a commit, like the supplier-price flow. A `takeoff_suggestion_summary` view exists for reviewing straight from the Supabase dashboard.

**Shared layouts** (same opt-in flag): alongside corrections, `TakeoffState.getBookLayout()` (non-null only after an Organize Categories Apply — group config + per-tab section order) is upserted as the user's single row in `public.takeoff_layout_suggestions` (004 migration; RLS: owner-managed, `is_takeoff_admin()` reviews all; the app skips layout sharing gracefully while the table is unapplied). Reverting to the default layout, or opting out, withdraws the row. The review panel shows layout rows above part corrections — per-user group summary + cross-tab moves vs the shipped defaults — with **Copy as code** producing a `LABOR_BOOK_DEFAULT_GROUPS` literal (plus move/order comments) to hard-code into `js/data/laborBookDefaults.js`: like corrections, member layouts only reach everyone through a commit. Auth is Supabase email/password (accounts are provisioned in the project's auth tables) with an email OTP fallback (6-digit code — the "Magic link or OTP" email template was edited to send `{{ .Token }}`); neither path uses redirect URLs, so localhost and GitHub Pages behave identically. Sync rules: on sign-in, workspace conflicts resolve by newest `savedAt` (last write wins) and assemblies merge as a union by id; afterwards every `TakeoffStorage.save*` queues a debounced (1.2 s) upsert, flushed when the tab hides. Pulling remote data goes through `TakeoffState.adoptWorkspace` / `setAssemblies` (clears undo history) + `TakeoffApp.render()`. The publishable API key ships in cloud.js by design; RLS is the access control.

## localStorage keys

All `takeoff-*` writes go through the `TakeoffStorage` adapter (js/storage.js) — swap that file's four functions to move persistence to a database; nothing else touches storage directly (cloud sync taps the same seam via save-notifications). The `mc-elliot-*` keys are still written directly by mcElliotState.js.

| Key | Owner | Content |
|---|---|---|
| `takeoff-projects-index` | storage.js (via state.js) | `{v:1, currentId, projects:[{id,name,createdAt,updatedAt}]}` — device-local, never synced (cloud rebuilds the list from `takeoff_projects` rows) |
| `takeoff-project-<id>` | storage.js (via state.js) | `{v:1, id, savedAt, name, manifest, laborRate, taxRate?, plansUrl?, externalRef?, reviewStatus?, reviewNote?, agentImport?}` — 400 ms debounced write, flushed on `beforeunload`/project switch. `taxRate` is a percent (absent = default 8.25); `plansUrl` is the CountTooling view link; `externalRef` the PipeTooling bid number; `reviewStatus` absent = draft. The cloud row carries the last four as columns (004) |
| `takeoff-book` | storage.js (via state.js) | `{v:1, savedAt, laborBook, laborBookGroups, laborBookMeta}` — account-level, own 400 ms debounce; `laborBookGroups` (null until the user applies an Organize Categories layout) holds per-tab `[{name, sections}]`, `laborBookMeta` = `{defaultsVersion, removed, relocated}` |
| `takeoff-workspace` | legacy | pre-projects single workspace; migrated into the keys above on first boot (`TakeoffStorage.migrateLegacyWorkspace`), then left untouched as a rollback backup |
| `takeoff-assemblies` | storage.js (via state.js) | assemblies array — written immediately |
| `takeoff-share-corrections` | cloud.js | `'1'` when the user opted into sharing book corrections |
| `mc-elliot-overlay` | mcElliotState.js | supplier price overlay (max ~2.5 MB, `newItems` dropped if over) |
| `mc-elliot-mappings` | mcElliotState.js | `{version:2, vendors:{vendor:{partNumber: itemNum}}}` (v1 migration exists) |
| `mc-elliot-review-queue` | mcElliotState.js | fuzzy-match review queue (truncated to 2,000) |
| `mc-elliot-category-overrides` | mcElliotState.js | per-category destination tab overrides |

app.js also deletes a set of retired `part-book-*` / `labor-book-import-progress` keys on boot.

## View pattern

Every view exports `{ render, attachListeners }`. `TakeoffApp.render()` switches on `TakeoffState.getCurrentView()` (`'manifest'|'device'|'conduit'|'wire'|'organize'`), sets `#main-content.innerHTML = View.render(...)`, then calls `View.attachListeners(...)`. Nearly every interaction triggers a full re-render; listeners are re-bound wholesale each time (exceptions: laborBook module-init one-time listeners, a few delegated handlers in laborBook/mcBook, and `TakeoffManifestView.updateSummaryOnly()` which patches only the summary).

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
| `#part-card-modal` | views/laborBookCard.js (from row badges/catalog part names) | views/laborBookCard.js (stacks above the labor book; Escape stops propagation) |
| `#projects-modal` | views/projects.js (header switcher → Manage projects) | views/projects.js |
| `#users-modal` | views/users.js (header menu, dev role only) | views/users.js → TakeoffCloud RPCs + takeoff-admin Edge Function |

## Import / export formats

- **CountTooling clipboard / paste import** (import.js `parseCountToolingClipboard`): one line per row, tab-separated `fixture \t quantity \t pages` (a 4-cell `fixture \t quantity \t group \t pages` is read too). Honors CountTooling's export conventions, the same ones PipeTooling's importer reads: `[Group] ` prefix → `group`; `ft of …` → unit `ft`; `px of …` → unit `px` (unscaled; imported flagged, excluded from totals, called out in the preview); a two-space indent → a child of the row above; the `View link:\t<url>` footer (detected by its `t=<uuid>` param) → the project's `plansUrl`. Type is inferred from name + unit (lengths are `conduit` unless the name says cable/wire). When the browser refuses clipboard access the paste modal (`#import-paste-modal`) takes the same text. Preview modal offers Add All vs Add Overages Only (matched by description + unit; raised to the import's total when higher — counts are totals, never summed; children follow the same rule under their parent). Single undo frame. On commit the plans link is saved on the project and, if the open project is still the blank starter, the payload's project name is adopted.
- **Structured import handoff** (import.js `importFromPayload` + app.js `#import=` hash route): the no-clipboard path for CountTooling. URL: `<app>/#import=<base64 JSON>`. **v2** payload: `{v:2, source, project?:{name?, plansUrl?}, items:[{description, quantity|count, unit?:'ea'|'ft'|'px', type?, pages?|page?, group?, meta?, children?:[{description, quantity, unit?, type?}]}]}` — CountTooling states facts, nothing it provided is inferred; an invalid `type` falls back to inference, a missing `unit` reads the name convention, then `ea`. **v1** (`{v:1, source, items:[{description, count, page?, type?}]}`) still imports. Both land in the same preview modal; the hash is stripped first. Checked-in contracts: `import-files/counttooling-export.fixture.txt` (a hand-built export covering every convention; asserted by import.test.js and import-fixture.spec.js) and `import-files/counttooling-export.real.fixture.txt` (the file CountTooling's own `takeoff-handoff.spec.js` generates and asserts as `takeoff-handoff.fixture.txt` — copy it over when that changes; import.test.js asserts its shape).
- **Copy for PipeTooling** (handoff.js `buildPipeToolingText`, header ☰ menu): the manifest as PipeTooling's Counts-import text — exactly the CountTooling format above (`[Group] `, `ft of `, `px of `, two-space children, `View link:` footer from `plansUrl`) — so an electrical bid's counts land on a PipeTooling bid with no PipeTooling change. Other-charge rows, blank rows and qty-0 rows are left out. Prices and labor do not travel (the v1 priced handoff needs a PipeTooling import of priced rows).
- **Export via link** (app.js): `#d=` + base64 of `{v:2, app:'takeoff-tooling', exportedAt, name, manifest}`; on load, hash import sanitizes recursively (`sanitizeImportedItem`) and lands in a NEW project named from the payload (nothing is replaced), then strips the hash. Import accepts the envelope or a legacy bare array; `v` is ignored.
- **PDF exports** (pdf.js): review (type, description, qty with unit, hrs/unit, unit $, extended, page; totals block with tax at the project rate), purchase order (the purchase list with unit and extended $), with-form (description + qty, then the permit form block). One wrapping table engine sized to the letter page's 532pt printable width, header row repeated after page breaks, project name / date / "page n of N" on every page. px rows print with no money.

## Labor & Price Book modal (two sides)

- **Parts** (views/laborBook.js): editable per-tab sections from `TakeoffState.getLaborBook()`, woven together with the supplier catalog by views/laborBookElliot.js — sections are universal: each supplier catalog section merges by name (case-insensitive) — into a matching curated section as a collapsed "Supplier parts" block below the curated rows, into a matching curated group (conduit tab) as a "Supplier parts" section at the end of the group, and otherwise renders standalone beside the curated ones (styled at group level on grouped tabs so the top-level list stays uniform). Supplier attribution is per part (the provenance badge, `TakeoffViewShared.renderPriceProvenance`: source · age with freshness tiers <30d/30–90d/>90d; supplier entries date from `McBook.elliotImportDate()` until they carry per-part `pricedAt`). Clicking a row's badge (or a catalog part's name) opens the **part card** (views/laborBookCard.js): per-supply-house offers with Use, a record-quote form, and named history; Catalog rows render as live inputs (same columns as curated rows); the first edit — inline or from the card — **promotes** the part into the editable book in its universal section (`TakeoffState.promoteCatalogPart`) with the edit applied, after which its catalog row is superseded (deduped by part #) and its vendor offer refreshes from the catalog on load. An always-visible tab-level filter narrows curated rows and supplier parts together (laborBook.js `applyTabFilter` → `partsEl._elliotFilter`). On tabs with no curated sections (lighting/devices/specialSystems) the "no sections yet" block is demoted to a footer below the catalog sections.
- **Assemblies** (mcBook.js): fetches `mc-assemblies/mc-labor-book.json`, patches with the local Elliot overlay (`McElliotState.getPatchedBook`), renders a lazy level1→level2→section tree; entries can be added rolled-up or exploded into components (`getComposition` via `mc-price-model.json`). Global search spans both sides.
- **Organize Categories** (views/organize.js, opened from the modal's action bar): full-page board — one lane per tab, groups/sections as a draggable tree with click-and-place, merge-on-drop, a section editor drawer, and per-tab Ungrouped buckets. Edits a scratch copy built on entry (`enter()`, sections tagged with their `origin`); staged changes ride the flow-dirty guard, and **Apply** commits the whole structure through `TakeoffState.applyBookReorganization` (confirm first — not undoable). Applying stores the user's group layout as `laborBookGroups` in the book doc (null → the conduit defaults config) and re-derives provenance: defaults whose section survived elsewhere become `laborBookMeta.relocated` (the merge won't resurrect them at the old spot, and they are **not** shared as remove-corrections), while deleted sections/rows land in `removed` as usual. Row edits in the drawer stamp `edited`/`userAdded`/`priceSource`/`pricedAt` like `updateLaborBookRow`. Moved/renamed sections fork from the defaults — future defaults upgrades no longer reach them.
- **Update Supplier Prices** (mcElliotUpdate.js): parse vendor CSV → dedupe → match against MC items (saved mappings first, then token-index fuzzy matching in chunks) → build overlay → auto/review/summary tabs → download buttons to commit updated JSON back into `mc-assemblies/`. See [DATA-PIPELINE.md](DATA-PIPELINE.md).

## Known quirks

- Export envelope is `v:2`, workspace persistence is `v:1`; neither has real migration logic (`restoreWorkspace` silently drops anything not `v===1`). Project documents gained optional `taxRate` / `plansUrl` and rows gained `unit` / `group` without a version bump — readers default anything missing.
- Project cloud sync is per-project last-write-wins with no checkout lock. `pushProjectNow` compares the remote `updated_at` against the value this device last saw and toasts when it overwrote a newer save (the stale-write guard) — the push still wins. The real fix is the checkout/turn-in model the schema mirrors from CountTooling.
- `getItemById` reaches depth 2 only; `sanitizeImportedItem` recurses arbitrarily deep — grandchildren would import but be unreachable.
- `TRASH_SVG`/`BOOK_SVG` constants duplicated verbatim in manifest.js, device.js, conduit.js; overage render/save logic near-duplicated between conduit step 3 and wire.js; blank-row-reseed idiom repeats across flows.
- css/styles.css is one ~2,870-line file organized by `/* section */` comments.
