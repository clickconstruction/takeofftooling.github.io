# Takeoff Tooling

A static web app for electrical estimators to create manifest-based bids. Enter fixtures and runs, add type-specific child items (boxes, covers, trenching, fittings, overage, MAC adapters), save reusable assemblies, import from CountTooling.com, and export to PDF or shareable links.

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

- **Abbreviation Key** — Reference for labor codes
- **Add to fixture** — Apply selected items to a manifest row
- **Export Groups & Sections** — Export structure for customization

### Other

- **Undo / Redo** — History for manifest changes
- **Search MC Prince Book** — External reference link

## Hosting on GitHub Pages

1. Push this repo to GitHub
2. In repo Settings → Pages, set source to the `main` branch
3. The site will be available at `https://<username>.github.io/takeofftooling.github.io/` (or your custom domain)

## Local Development

Open `index.html` in a browser, or serve the folder with any static server:

```bash
npx serve .
```

## Customization

- **Conduit fittings list**: Edit `js/data/fittings.js` and add your pre-made fittings. Each entry can be a string or `{ description: string }`.
