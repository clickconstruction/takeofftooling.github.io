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
- **Remove toggle**: "Remove items" in the header ☰ menu shows/hides remove buttons on rows

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

**Paste from CountTooling.com** reads the clipboard (or opens a paste box when the browser won't share it) and understands everything CountTooling's **Copy to /Tooling** puts there:

- `[Group] ` prefixes become a **group tag** on the row (a circuit, a panel, an area) and stay off the part name so it can match the book
- `ft of …` rows import as **feet**; `px of …` rows (pages with no scale in CountTooling) import **flagged as unscaled** and stay out of every total until you set the scale there and copy again
- indented rows (CountTooling child counts — couplings under a conduit, boxes under a device) import as **children** of the row above
- the **plans link** in the footer is saved on the project (a **Plans** chip in the header) and travels on to PipeTooling
- each row gets a **type** from its name and unit (`1/2" EMT` → Conduit, `MC 12/2` → Wire, `Type A` → Lighting, `Panel LP-1` → Gear, `Data Drop` → Special Systems)

CountTooling can also open Takeoff Tooling directly with a structured handoff link (`#import=`), which carries units, types, groups and children explicitly. Either way a **preview modal** shows the manifest beside the import, with **Add All** or **Add Overages Only** (an existing row is raised to the import's total when higher — counts are totals, never added twice).

### Copy for PipeTooling

Header ☰ → **Copy for PipeTooling** puts the manifest on the clipboard in the exact text PipeTooling's **Bids → Counts → Import from /Tooling** reads (groups, `ft of`, children, the plans link), so an electrical bid's counts land on a PipeTooling bid with no retyping. Prices and labor stay here for now; PipeTooling prices the bid.

### Export

- **Print for Review** — PDF for internal review (type, description, quantity with unit, hours, unit and extended price, page; cost totals with the project's tax rate)
- **Print for Purchase Order** — the purchase list as a PDF
- **Print with Form** — description and quantity, then the permit form block (Address, Permit NO, Builder or Occupant, Electrical Count)

All three wrap long descriptions, paginate, and stamp the project name, date and page numbers on every page.

### Totals

The summary below the table is a **cost summary**: materials by type, sales tax at the project's rate (editable beside the line; default 8.25%), labor hours × the project's labor rate, other charges. Margin and the bid price are set in PipeTooling.
- **Export via link** — Generates a shareable base64 URL with full manifest data

### Labor and Price Book

Two sides, toggled at the top of the modal:

- **Parts** — Editable per-tab sections (labor hours + price per item, each price badged with who supplied it and how old it is), woven together with the live supplier catalog: supplier categories render as regular sections (merging into a curated section or group of the same name), with a per-tab filter that searches both together
- **Assemblies** — The MC assemblies book (24k+ entries) as a browsable category tree; add entries rolled-up or exploded into their component items
- **Global search** — Searches parts, assemblies, and supplier parts together
- **Add to fixture / fill mode** — Apply a selected entry to a manifest row, or fill a specific flow row via the per-row "PB" buttons
- **Organize Categories** — A full-page board (one lane per tab) for restructuring the book: drag sections and groups (create your own groups on any tab), or pick one up with ✥ and click where it goes; drop onto a section's center to merge; click a section to edit its rows in a side drawer. Changes accumulate in a pending tray until you **Apply** them to the book in one confirmed step (or Discard to reset); moved and renamed sections keep their rows, prices, and history, and your group layout syncs with the rest of the book
- **Update Supplier Prices** — Import a vendor CSV (e.g. Elliot Electric), auto-match against MC items with a review queue, and download updated JSON to commit back into `mc-assemblies/`
- **Abbreviation Key** — Reference for labor codes
- **Export Groups & Sections** — Export structure for customization

### Cloud Sync

Optional — the app works fully offline in this browser without it. **Sign In** (header) takes your email and password (or can email you a 6-digit code instead); once signed in, the manifest, labor book, labor rate, and saved assemblies sync to Supabase so the same takeoff follows you across devices. Each account sees only its own data. Newest save wins for the workspace; assemblies merge. Signing out keeps the local copy.

**Improve the shared book** (opt-in, in the Cloud Sync dialog): share your price and labor corrections so the shared parts book gets more accurate for everyone. Only Labor & Price Book edits are shared — never your takeoffs or job data — and you can see exactly what's shared or turn it off (which withdraws it) at any time. Accepted corrections ship to all users in an app update, and updated defaults merge into your book without touching rows you've customized.

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

The cloud-sync round trip (`cloud-sync.spec.js`) runs against the real Supabase
project and needs a dedicated **non-admin** test account in a gitignored
`.env.local` (it skips when absent):

```
TAKEOFF_TEST_EMAIL=your-test-account@example.com
TAKEOFF_TEST_PASSWORD=its-password
```

## Customization

- **Conduit fittings list**: Edit `js/data/fittings.js` and add your pre-made fittings. Each entry can be a string or `{ description: string }`.
