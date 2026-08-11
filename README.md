# Takeoff Tooling

A static web app for electrical estimators to create manifest-based bids. Enter fixtures and runs, add type-specific child items (boxes, covers, trenching, fittings, overage, MAC adapters), save reusable assemblies, look up labor and prices in the MC assemblies book, update supplier prices, import from CountTooling.com, and export to PDF or shareable links.

## Documentation

- [CLAUDE.md](CLAUDE.md) — orientation for coding agents: layout, conventions, gotchas
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — runtime modules, state shapes, view pattern, storage keys
- [docs/DATA-PIPELINE.md](docs/DATA-PIPELINE.md) — how `mc-assemblies/*.json` is built and updated
- [docs/REFACTOR-PLAN.md](docs/REFACTOR-PLAN.md) — planned file splits and cleanup

## Features

### Manifest Table

- **Columns**: Assembly Description, Type, Quantity, Labor, Price, Plan Page
- **Item types**: Lighting, Gear, Devices, Conduit, Wire, Special Systems, PERMITS, POWER CO. CHARGES, TEMPORARY POWER
- **Type shortcuts**: `G` Gear, `L` Lighting, `D` Devices, `C` Conduit, `W` Wire, `S` Special Systems
- **Quantity**: Spinner controls (+, −) and direct input; default 0
- **Labor and Price Book**: Book icon on each row opens the Labor and Price Book for quick lookup
- **Edit in flow**: For Devices, Conduit, and Wire types — opens the type-specific flow editor
- **Remove toggle**: Header trash icon shows/hides remove buttons on rows

### Devices Flow

When editing a Devices item, add child items in sections:

- **Outlets and Switches** — Receptacles, switches, etc.
- **Boxes** — Junction boxes, device boxes
- **Back Box Support** — Mounting hardware
- **Covers** — Plates and covers
- **Conduit** — Conduit runs
- **Wire** — Wire runs
- **Screws** — Fasteners
- **Misc.** — Other materials

Each row has Description, Quantity, Labor, Price. Use **×2** / **÷2** for quick quantity adjustments. **Save as Assembly** stores the configuration for reuse.

### Assemblies

- **Collapsible cards** — Expand to see sections and totals
- **Load into Ledger** — Add assembly items to the manifest
- **Delete** — Trash icon when expanded removes the assembly (with confirmation)

### Conduit Flow

Multi-step flow: **Trenching → Fittings → Overage**. Fittings come from a configurable list in `js/data/fittings.js`.

### Wire Flow

Overage percentage and optional MAC Adapters.

### Import from CountTooling.com

Paste clipboard data (fixture, count, page per line). A **preview modal** shows:

- Current manifest items vs. import items
- **Add All** — Add all import items to the manifest
- **Add Overages Only** — Add only items that increase quantities (merge overages into existing)

### Export

- **Print for Review** — PDF for internal review
- **Print for Purchase Order** — PDF for PO
- **Print with Form** — PDF with Address, Permit NO, Builder or Occupant, Electrical Count
- **Export via link** — Generates a shareable base64 URL with full manifest data

### Labor and Price Book

Two sides, toggled at the top of the modal:

- **Parts** — Editable per-tab sections (labor hours + price per item), plus a live "Elliot Parts" supplier group
- **Assemblies** — The MC assemblies book (24k+ entries) as a browsable category tree; add entries rolled-up or exploded into their component items
- **Global search** — Searches parts, assemblies, and supplier parts together
- **Add to fixture / fill mode** — Apply a selected entry to a manifest row, or fill a specific flow row via the per-row "PB" buttons
- **Update Supplier Prices** — Import a vendor CSV (e.g. Elliot Electric), auto-match against MC items with a review queue, and download updated JSON to commit back into `mc-assemblies/`
- **Abbreviation Key** — Reference for labor codes
- **Export Groups & Sections** — Export structure for customization

### Cloud Sync

Optional — the app works fully offline in this browser without it. **Sign In** (header) emails you a 6-digit code; once signed in, the manifest, labor book, labor rate, and saved assemblies sync to Supabase so the same takeoff follows you across devices. Newest save wins for the workspace; assemblies merge. Signing out keeps the local copy.

### Other

- **Undo / Redo** — History for manifest changes (manifest only)

## Hosting on GitHub Pages

1. Push this repo to GitHub
2. In repo Settings → Pages, set source to the `main` branch
3. The site will be available at `https://<username>.github.io/takeofftooling.github.io/` (or your custom domain)

## Local Development

Serve the folder with the bundled dev server (disables caching, which matters when iterating on the large JSON data files):

```bash
python3 scripts/dev-server.py 4173
```

Then open http://localhost:4173. Don't open `index.html` directly via `file://` — the Labor & Price Book fetches JSON from `mc-assemblies/`, which requires an HTTP server.

### Tests & lint

```bash
npm install            # dev-only deps (eslint, Playwright)
npm run check          # eslint + unit tests
npx playwright test    # browser smoke tests (starts the dev server itself)
```

## Customization

- **Conduit fittings list**: Edit `js/data/fittings.js` and add your pre-made fittings. Each entry can be a string or `{ description: string }`.
