# Entry-point & modal surface inventory — Phase 1 seed (2026-09-06)

**4 views · 11 modals · 2 hash routes** in [index.html](../../index.html) and `js/`.
Derived from the two interactive walks of 2026-09-06 (build `fda00e5` + the N-series on the
review branch) plus the code; **Phase 2 verifies**. Node IDs match the UX-map artifact from
the same day so the two can be read together.

## Header (always present; wraps below 900px, action strip scrolls below 640px)

- `#app-title` "Takeoff Tooling" wordmark — returns to the manifest (asks first when a flow has unsaved edits)
- `#project-switch-btn` — project name + caret → `#project-menu` (current project marked, recency, "+ New project", "Manage projects…")
- `#import-count-tooling-btn` "Paste from CountTooling.com" (gold primary) → clipboard read → `#import-preview-modal`
- `#labor-book-open-btn` "Labor & Price Book" → `#labor-book-modal` (no preselected fixture)
- `#undo-btn` / `#redo-btn` (disabled when empty; return to the manifest view)
- `#cloud-btn` — "Sign In" / "✓ Cloud" / "Syncing…" / "⚠ Cloud" → `#cloud-modal`
- `#header-menu-btn` ☰ → `#header-menu`: New Project · Export via link · Remove items (toggle, aria-pressed) · Review suggestions *(admin)* · Manage users *(dev)* · Hard reload (danger)

## Manifest view (`TakeoffManifestView`; table ≥901px, cards ≤900px)

Per top-level row: `.remove-btn` (visible only when Remove items is on) · `.labor-book-icon-btn` (book, preselects this fixture) · `.add-child-btn` ↳ (childless rows only) · description input · type cell (`.select-type-btn` "Add" when untyped; `.type-badge` chip — a button with a pencil for devices/conduit/wire — plus `.clear-type-btn` ×) · qty spinner (− input +) · labor input · price input · plan-page input. Per child row: same minus type controls and plan page; child chips of a flow parent open the parent's flow. Ghost `.add-child-row-btn` "Add component" closes each child block.

Below the table: `#add-row-btn` · summary (materials by type + 8.5% tax · labor hours by type · `#labor-rate-input` · other charges · grand total) · `#print-options-toggle` → Print for Review / Print for Purchase Order / Print with Form · `#purchase-list-toggle-btn` "Generate Purchase List" → inline report with Copy (TSV) / Hide. First-run state: `#manifest-first-run-hint` and the summary block hidden until a row has a description.

## Flow editors (`#main-content` replaces the manifest; all centered, `.flow-page`)

- **Devices** — header "Save as Assembly →" (inline name row) · assemblies browser (select + Load into Ledger; cards with Load / Delete) · parent summary + "Components (extended)" panel with the labor rollup · 8 sections × (book icon, PB, description, qty with ×2 / ÷2, labor, price, trash) · "+ <Section>" per section · Cancel · Save and Back to Manifest
- **Conduit** — step pills Trenching / Fittings / Overage (clickable; forward commits) · step 1: feet / material / depth / $-per-foot, Quick Add table (7 presets), Rentals (5) + Fill Materials (5) add-on buttons, add-on rows table · Cancel / Next · step 2: book icon (opens Fittings group), preset `<select>`, fittings rows (PB, description, qty, labor, price, trash), Add Fitting Row · Back / Next · step 3: 5/10/15/20 % buttons, custom % input, live total line · Back / Save
- **Wire** — overage section (same as conduit step 3) · MAC Adapters table (PB, description, qty, labor, trash) · Add MAC Adapter · Cancel / Save

## Modals (11, all skeletons in index.html; `aria-hidden` toggled)

| Modal | Opened by | Closes via | Owner |
|---|---|---|---|
| `#type-modal` | manifest "Add" | pick / hotkey G L D C W S / Cancel / Esc / click-out | app.js + views/modal.js |
| `#labor-book-modal` | header button, row book icons, PB buttons, conduit fittings book | Close / Esc (clears search first) / click-out | app.js + views/laborBook*.js |
| `#part-card-modal` | provenance badge, catalog part name | Close / Esc (stops propagation) / click-out | views/laborBookCard.js |
| `#abbreviation-key-modal` | book header link | Close / Esc / click-out | laborBook.js |
| `#mc-elliot-modal` Update Supplier Prices | book footer button *(admin/dev)* | Close / Esc | mcElliotUpdate.js |
| `#import-preview-modal` | paste, `#import=` route, `importFromPayload` | state-aware primary (Add N fixtures / Update N counts · add N fixtures) / "Add as separate rows" when a line matched / per-line type picker / Cancel / Esc / click-out; focus trapped | import.js |
| `#projects-modal` Manage Projects | switcher "Manage…", header menu "New Project" | Close / Esc / click-out | views/projects.js |
| `#cloud-modal` | header cloud button | Close / Esc / click-out | cloud.js |
| `#suggestions-modal` Review suggestions | header menu *(admin)* | Close | suggestionsReview.js |
| `#users-modal` Manage Users | header menu *(dev)* | Close | views/users.js |
| `#form-modal` Print with Form | Print Options | Cancel / Print with Form / Esc | app.js → pdf.js |

Inside the book: Parts / Assemblies toggle · global search (`#labor-book-global-search`, three result buckets) · "Add to fixture" `<select>` (or the fill / add-to banner) · tabs Gear Lighting Devices Conduit Wire Special Systems · tab filter · curated sections (Add row, inline edits, provenance badge / "+ price") · supplier sections (100-row cap + "Show all N parts") · Assemblies tree (level1 → level2 → section → entries with ▸ BOM) · footer: Export Groups & Sections · Update Supplier Prices *(admin)* · Close.

## Hotkeys

- Type modal open: `G` `L` `D` `C` `W` `S` pick a type; `Esc` cancels
- Book open, focus outside an input: `g` `l` `d` `c` `w` `s` switch tabs; `Esc` clears search → closes book; abbreviation key and part card intercept `Esc` first
- Inline name fields (project create/rename, assembly name, section name): `Enter` confirms, `Esc` dismisses
- Header menu / project menu: `Esc` closes

## Hash routes (boot **and** `hashchange`)

- `#d=<base64 {v:2, name, manifest}>` — imports into a NEW project "<name> (shared <Mon D>)", strips the hash
- `#import=<base64 {v:1, items:[{description, count, page, type?}]}>` — opens the import preview, strips the hash

## Storage (all through `TakeoffStorage`; cloud mirror when signed in)

`takeoff-projects-index` · `takeoff-project-<id>` · `takeoff-book` · `takeoff-assemblies` · `takeoff-share-corrections` · legacy `takeoff-workspace` (frozen backup) · `mc-elliot-*` (supplier overlay, mappings, review queue — written directly by mcElliotState.js)

## Duplicate-surface moments to walk deliberately

- Three doors into the book with different targeting: manifest row book icon (preselects the fixture, "Add to fixture" select hidden), flow-row book icon (targets that device row), PB button (fill mode — replaces the row). Phase 2: does an estimator predict which one they need?
- Two ways to give a row a type (Add button → modal, hotkey) and two ways to enter a flow (parent chip, any child chip).
- Header "New Project" vs switcher "+ New project" — same inline row, two entrances.
- Overage lives in two flows with identical UI (shared renderer) — good; but the custom % input is a different control from the four presets.
