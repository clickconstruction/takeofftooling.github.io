# CLAUDE.md — Takeoff Tooling

Static web app for electrical estimators: build a manifest-based bid (fixtures, runs, child items), look up labor/prices in the MC assemblies book, update supplier (Elliot) prices, export to PDF or a shareable link. Hosted on GitHub Pages; everything is client-side.

## Quick facts

- **No build step, no framework, no runtime dependencies.** Plain HTML/CSS/JS. Every JS file is an IIFE assigned to a top-level `const` global, loaded via `<script>` tags at the bottom of [index.html](index.html). No ES modules, no `defer`. npm is dev-only (eslint + Playwright).
- **Quality gate**: `npm run check` (eslint `--max-warnings 0` + `node --test` unit tests) and `npx playwright test` (browser smoke specs; starts the dev server itself). Run both before committing. Naming: `*.test.js` = node:test units, `*.spec.js` = Playwright.
- **Script load order matters**: `utils.js` and `state.js` must load before everything; `app.js` loads last and runs init. Circular-ish references between views and `TakeoffApp` work only because calls happen post-load; some modules use `typeof X !== 'undefined'` guards.
- **Dev server**: `python3 scripts/dev-server.py 4173` (plain `http.server` with `Cache-Control: no-store`). Also configured in [.claude/launch.json](.claude/launch.json) as `takeoff-tooling`. Needed because the app `fetch()`es JSON from `mc-assemblies/` — opening `index.html` via `file://` breaks those.
- **Persistence is local-first localStorage, organized as projects** (per-project keys + a device-local index + an account-level labor-book key; see the table in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)), optionally mirrored to Supabase when signed in (email/password with an email-code fallback; `js/cloud.js`, project `awjcdxqhvgnqsrlnoyxr`, tables `takeoff_store` + `takeoff_suggestions`, RLS per-user). The app must keep working fully signed out. Labor-book rows carry provenance flags (`edited`/`userAdded`, plus `priceSource`/`pricedAt` and per-supplier `offers`/`history` — see the part card in views/laborBookCard.js); when editing `js/data/laborBookDefaults.js`, bump `LABOR_BOOK_DEFAULTS_VERSION` so existing workspaces merge the change (js/laborBookMerge.js).
- **Two codebases in one repo**: the runtime app (`js/`, `index.html`, `css/`) and an offline Node/Python data pipeline (`scripts/` → `mc-assemblies/*.json`). They meet at `js/elliotPriceCore.js`, which is dual browser/Node.

## Where things live

| Path | What |
|---|---|
| `index.html` | App shell + all modal skeletons (6 modals) + script load order |
| `js/state.js` | `TakeoffState` — the state facade: manifest CRUD, undo/redo, labor-book data, assemblies |
| `js/storage.js` | `TakeoffStorage` — the persistence adapter (currently localStorage). **The seam to swap for a database backend** |
| `js/uiState.js`, `js/selectors.js` | Ephemeral UI state (re-exported by TakeoffState) and pure manifest selectors (unit-tested) |
| `js/data/laborBookDefaults.js` | Default Labor & Price Book data (pure data; state.js deep-clones it) |
| `js/app.js` | `TakeoffApp` — init, view routing, navigation, modal open/close, export-via-link, `#d=`/`#import=` hash routes |
| `js/views/` | `manifest.js` (main table), `device.js` / `conduit.js` / `wire.js` (flow editors), `shared.js` (icons/overage helpers), `laborBook*.js` (Labor & Price Book modal: facade + targets/Elliot/search modules), `modal.js` (type-select modal only), `organize.js` (full-page category organizer, preview — edits a scratch copy, Apply is a stub) |
| `js/mcBook.js`, `js/mcElliot*.js`, `js/elliotPriceCore.js` | MC assemblies tree + supplier price-update pipeline (runtime side) |
| `js/import.js`, `js/pdf.js` | CountTooling clipboard import; jsPDF exports |
| `js/data/fittings.js` | Conduit fitting presets (user-editable) |
| `mc-assemblies/` | Runtime data: the five JSONs the app fetches (labor book, price model, mappings) + `tab-mapping.json` build config |
| `source-data/` | Build-only inputs & intermediates (MC CSVs, 40 MB mc-assemblies.json, hierarchy artifacts) — removable; see its README |
| `scripts/` | Offline pipeline that builds `mc-assemblies/*.json` — see docs/DATA-PIPELINE.md |
| `import-files/` | Sample supplier CSV, hierarchy screenshots (pipeline inputs) |
| `css/styles.css` | Single stylesheet, ~2,900 lines, organized by `/* section */` comments |

## Documentation index

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — runtime modules, globals dependency table, state/data shapes, view pattern, flow-editor mechanics, modal ownership, localStorage keys, import/export formats, known quirks.
- [docs/DATA-PIPELINE.md](docs/DATA-PIPELINE.md) — the offline build DAG (MC CSVs → JSON artifacts), schema of every JSON file, the Elliot supplier price-update flow, known pipeline issues.
- [docs/REFACTOR-PLAN.md](docs/REFACTOR-PLAN.md) — agreed extraction seams for the large files and the constraints any split must respect.
- [README.md](README.md) — user-facing feature documentation.

## Conventions & gotchas (read before editing)

- **Rendering model**: views export `{ render, attachListeners }`; almost every interaction calls `TakeoffApp.render()`, which replaces `#main-content` innerHTML and re-attaches listeners wholesale. There is no virtual DOM or event delegation (except a few delegated handlers in laborBook/mcBook). Preserve the `render`/`attachListeners` contract when refactoring.
- **Undo/redo covers the manifest only** (snapshot-based, 50 deep). Labor-book edits, assemblies, and labor rate are not undoable. Multi-step mutations must be wrapped in `TakeoffState.beginBatch()`/`endBatch()` to make one undo frame.
- **Manifest structure**: top-level items with children nested in `parent.children`. `TakeoffState.getItemById` only searches two levels deep (top level + children) — don't create grandchildren.
- **Persistence**: all durable writes go through `TakeoffStorage` (js/storage.js). Two debounced (400 ms) documents: the open PROJECT (`{v:1, id, savedAt, name, manifest, laborRate}`) and the account-level BOOK (`{v:1, savedAt, laborBook, laborBookMeta}`); assemblies write immediately. Projects mirror to the `takeoff_projects` Supabase table (schema-aligned with Count Tooling's `projects`; SQL in `supabase/`). The legacy `takeoff-workspace` key migrates into project #1 on first boot and stays behind as a frozen backup. Share links (`v:2` envelope, now with `name`) import into a NEW project.
- **Flow editors** (device/conduit/wire) edit a temp buffer in TakeoffState, then on save strip the relevant child types from `parent.children` and re-add. The conduit wizard commits children at **each step transition**, not just at the end.
- **escapeHtml everything** user-visible; every view aliases `TakeoffUtils.escapeHtml`.
- Generated JSON in `mc-assemblies/` and `source-data/` should not be hand-edited — regenerate via scripts. `scripts/hierarchy/align.py` was a one-time tool whose inputs (`merged.jsonl`, `overrides.json`) are not committed.
