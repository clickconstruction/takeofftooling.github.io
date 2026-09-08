# CLAUDE.md — Takeoff Tooling

Static web app for electrical estimators: build a manifest-based bid (fixtures, runs, child items), look up labor/prices in the MC assemblies book, update supplier (Elliot) prices, export to PDF or a shareable link. Hosted on GitHub Pages; everything is client-side.

## Quick facts

- **No build step, no framework, no runtime dependencies.** Plain HTML/CSS/JS. Every JS file is an IIFE assigned to a top-level `const` global, loaded via `<script>` tags at the bottom of [index.html](index.html). No ES modules, no `defer`. npm is dev-only (eslint + Playwright). The two third-party libs (jsPDF, supabase-js) are **vendored** in `vendor/` with version-pinned filenames — no CDN in the boot path.
- **Quality gate**: `npm run check` (eslint `--max-warnings 0` + `node --test` unit tests + `build:shared --check`) and `npx playwright test` (browser smoke specs; starts the dev server itself). Run both before committing. Naming: `*.test.js` = node:test units, `*.spec.js` = Playwright. ESLint ignores `.claude/**` (Claude Code worktrees are full repo copies) and `vendor/**`.
- **User-facing feedback is a toast, never `alert()`**: `TakeoffToast.show(text, { kind: 'info'|'success'|'warn', action?, timeout?, key? })` (js/toast.js — one aria-live `#toast-region` outside `#app`, a stack of three, an optional action button, `key` replaces in place). `TakeoffUtils.toast(message, { kind })` is a thin alias onto it (`kind: 'error'` → the warn style). `confirm()` stays for the questions that must block (discard guard, remove row, delete bid, Organize Apply).
- **Script load order matters**: `utils.js` and `state.js` must load before everything; `app.js` loads last and runs init. Circular-ish references between views and `TakeoffApp` work only because calls happen post-load; some modules use `typeof X !== 'undefined'` guards.
- **Dev server**: `python3 scripts/dev-server.py 4173` (plain `http.server` with `Cache-Control: no-store`). Also configured in [.claude/launch.json](.claude/launch.json) as `takeoff-tooling`. Needed because the app `fetch()`es JSON from `mc-assemblies/` — opening `index.html` via `file://` breaks those.
- **Persistence is local-first localStorage, organized as projects** (per-project keys + a device-local index + an account-level labor-book key; see the table in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)), optionally mirrored to Supabase when signed in (email/password with an email-code fallback; `js/cloud.js`, project `awjcdxqhvgnqsrlnoyxr`, tables `takeoff_store` + `takeoff_suggestions`, RLS per-user). The app must keep working fully signed out. Labor-book rows carry provenance flags (`edited`/`userAdded`, plus `priceSource`/`pricedAt` and per-supplier `offers`/`history` — see the part card in views/laborBookCard.js); when editing `js/data/laborBookDefaults.js`, bump `LABOR_BOOK_DEFAULTS_VERSION` so existing workspaces merge the change (js/laborBookMerge.js).
- **Offline app shell**: `sw.js` + `manifest.webmanifest` + `icons/` at the repo root (GitHub Pages serves them at the site root). The worker reads the shell list out of index.html at install, is network-first for code and cache-first for the `mc-assemblies` JSONs, never touches anything cross-origin (Supabase/CDNs), is not registered under `navigator.webdriver`, and needs `CACHE_VERSION` bumped on any deploy that changes the shell.
- **Two codebases in one repo**: the runtime app (`js/`, `index.html`, `css/`) and an offline Node/Python data pipeline (`scripts/` → `mc-assemblies/*.json`). They meet at `js/elliotPriceCore.js`, which is dual browser/Node.

## Where things live

| Path | What |
|---|---|
| `index.html` | App shell + all modal skeletons + script load order |
| `js/state.js` | `TakeoffState` — the state facade: manifest CRUD, undo/redo, labor-book data, assemblies |
| `js/storage.js` | `TakeoffStorage` — the persistence adapter (currently localStorage). **The seam to swap for a database backend** |
| `js/uiState.js`, `js/selectors.js` | Ephemeral UI state (re-exported by TakeoffState) and pure manifest selectors (unit-tested) |
| `js/data/laborBookDefaults.js` | Default Labor & Price Book data (pure data; state.js deep-clones it) |
| `js/app.js` | `TakeoffApp` — init, view routing, navigation, modal open/close, export-via-link, `#d=`/`#import=` hash routes |
| `js/views/` | `manifest.js` (main table), `device.js` / `conduit.js` / `wire.js` (flow editors), `shared.js` (icons/overage helpers), `laborBook*.js` (Labor & Price Book modal: facade + targets/Elliot/search modules), `modal.js` (type-select modal only), `organize.js` (full-page category organizer — stages changes on a scratch copy, Apply commits via `TakeoffState.applyBookReorganization`) |
| `js/mcBook.js`, `js/mcElliot*.js`, `js/elliotPriceCore.js` | MC assemblies tree + supplier price-update pipeline (runtime side) |
| `js/import.js` | CountTooling import: the clipboard/paste parser (units, `[Group]` prefixes, indented children, the plans-link footer) and the `#import=` payload (v1/v2) — pure parts unit-tested in `import.test.js` against `import-files/counttooling-export.fixture.txt` |
| `js/handoff.js` | UMD kernel — `buildPipeToolingText` ("Copy for PipeTooling": PipeTooling's Counts-import text, v0 of the onward seam) and `buildPipeToolingRows` (the priced rows PipeTooling reads over the bridge, v1); `handoff.test.js` |
| `js/explode.js` | UMD kernel — the assembly templates and `explodeItem` / `explodeManifest`: what parts a device or run needs, priced from a book by name (exact, then every-token); the Explode ⚡ button and the agent door both call it; `explode.test.js` |
| `supabase/functions/` | `twin-login` (the twin seat), `manage-user` (the TT↔PT bridge), `import-manifest` (the agent door), `takeoff-admin`; `_shared/` holds GENERATED copies of the two kernels + the book JSON (`npm run build:shared`, checked by `npm run check`) — see `supabase/README.md` |
| `js/pdf.js` | jsPDF exports (review / purchase order / permit form) — one wrapping table engine, paginated, footer on every page |
| `vendor/` | Vendored third-party libs (`jspdf.umd-2.5.1.min.js`, `supabase-js-2.49.4.min.js`) |
| `js/data/fittings.js` | Conduit fitting presets (user-editable) |
| `mc-assemblies/` | Runtime data: the five JSONs the app fetches (labor book, price model, mappings) + `tab-mapping.json` build config |
| `source-data/` | Build-only inputs & intermediates (MC CSVs, 40 MB mc-assemblies.json, hierarchy artifacts) — removable; see its README |
| `scripts/` | Offline pipeline that builds `mc-assemblies/*.json` — see docs/DATA-PIPELINE.md |
| `import-files/` | Sample supplier CSV, hierarchy screenshots (pipeline inputs), and `counttooling-export.fixture.txt` — the CountTooling export both repos test against |
| `css/styles.css` | Single stylesheet, ~6,100 lines, organized by `/* section */` comments |

## Documentation index

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — runtime modules, globals dependency table, state/data shapes, view pattern, flow-editor mechanics, modal ownership, localStorage keys, import/export formats, known quirks.
- [docs/DATA-PIPELINE.md](docs/DATA-PIPELINE.md) — the offline build DAG (MC CSVs → JSON artifacts), schema of every JSON file, the Elliot supplier price-update flow, known pipeline issues.
- [docs/REFACTOR-PLAN.md](docs/REFACTOR-PLAN.md) — agreed extraction seams for the large files and the constraints any split must respect.
- [docs/guides/README.md](docs/guides/README.md) — the fifteen user guides (trade language, one per journey); keep them in step with behaviour changes — the specs are the tie-breaker.
- [docs/JOURNEY-MAP.md](docs/JOURNEY-MAP.md) — the UX program (sibling of Count Tooling's): personas, 14 journeys, spirit test, verdict vocabulary, phases; dossiers live in `docs/journeys/` (`_surfaces.md` inventory, `_TEMPLATE.md`). Proposed UX changes must pass its spirit test.
- [README.md](README.md) — user-facing feature documentation.

## Conventions & gotchas (read before editing)

- **Rendering model**: views export `{ render, attachListeners }`; almost every interaction calls `TakeoffApp.render()`, which replaces `#main-content` innerHTML and re-attaches listeners wholesale. There is no virtual DOM or event delegation (except a few delegated handlers in laborBook/mcBook). Preserve the `render`/`attachListeners` contract when refactoring.
- **Undo/redo covers the manifest only** (snapshot-based, 50 deep). Labor-book edits, assemblies, and labor rate are not undoable. Multi-step mutations must be wrapped in `TakeoffState.beginBatch()`/`endBatch()` to make one undo frame.
- **Manifest structure**: top-level items with children nested in `parent.children`. `TakeoffState.getItemById` only searches two levels deep (top level + children) — don't create grandchildren. Every row carries a **`unit`** (`ea` | `ft` | `px`) and an optional **`group`** (a CountTooling `[Group]`, e.g. a circuit). `px` rows are CountTooling's UNSCALED runs: kept and flagged, **excluded from every total** (selectors), never priced — the estimator rescales in CountTooling and re-imports.
- **Project settings**: `laborRate` ($/hr) and **`taxRate`** (a PERCENT; a NEW bid starts at 8.25 — Texas' combined maximum — and a document saved before the field existed keeps the 8.5 it was bid at) live on the project document with **`plansUrl`** (the CountTooling view link the counts came from, shown in the header and forwarded to PipeTooling). Site work (trenching, rentals) is an other charge, untaxed.
- **Bid stamp + review lane**: **`externalRef`** (the PipeTooling bid number, a header chip), **`reviewStatus`** (`draft` | `ready` | `changes` | `reviewed`, with `reviewNote`; a header chip + a Review select in Manage Projects) and **`agentImport`** (the agent door's provenance, null for hand-built projects) ride the project document — inside the cloud row's `data`, like every other field, so the compare-and-swap RPC carries them and PipeTooling's bridge reads `data->>externalRef`.
- **Digital twins**: agent-operated accounts flagged `takeoff_profiles.is_digital_twin` wear the 🤖 banner (`#twin-banner`, cloud.js `renderTwinBanner`) and badge in Manage Users. They never drive the flows — they POST `import-manifest`, which runs the SAME explode kernel the ⚡ button runs. Never add a twin-only UI path (PipeTooling `docs/DIGITAL_TWINS_PLAN.md`).
- **Persistence**: all durable writes go through `TakeoffStorage` (js/storage.js). Two debounced (400 ms) documents: the open PROJECT (`{v:1, id, savedAt, name, manifest, laborRate, taxRate, plansUrl?, details, importedFrom, externalRef?, reviewStatus?, reviewNote?, agentImport?, archived?}` — `details` is the job's own optional facts, printed by Print with form; `importedFrom` stamps the share link a copy came from) and the account-level BOOK (`{v:1, savedAt, laborBook, laborBookGroups, laborBookMeta}` — `laborBookGroups` is null until Organize Categories saves a layout; `laborBookMeta` carries `removed` / `relocated` / `removedLegacy`, see ARCHITECTURE); assemblies write immediately. Projects mirror to the `takeoff_projects` Supabase table (schema-aligned with Count Tooling's `projects`; SQL in `supabase/`). The legacy `takeoff-workspace` key migrates into project #1 on first boot and stays behind as a frozen backup. Share links (`v:2` envelope, with `name`, rates, details and `plansUrl`) import into a NEW project.
- **Flow editors** (device/conduit/wire) edit a temp buffer in TakeoffState, then on save strip the relevant child types from `parent.children` and re-add. Nothing reaches the bid before Save — the conduit wizard's Next/Back/pills are pure navigation, and its Save writes trenching, add-ons, fittings and overage in one batch.
- **escapeHtml everything** user-visible; every view aliases `TakeoffUtils.escapeHtml`.
- Generated JSON in `mc-assemblies/` and `source-data/` should not be hand-edited — regenerate via scripts. `scripts/hierarchy/align.py` was a one-time tool whose inputs (`merged.jsonl`, `overrides.json`) are not committed.
