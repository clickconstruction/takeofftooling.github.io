# Takeoff Tooling

A static web app for electrical estimators to create manifest-based bids. Enter fixtures and runs, add type-specific child items (boxes, covers, trenching, fittings, overage, MAC adapters), and export to PDF.

## Features

- **Manifest table**: Add items with Description, Quantity (whole numbers), Labor (hours), Plan Page, and optional Price
- **Item types**: Lighting, Gear, Devices, Conduit, Wire, Special Systems
- **Devices**: Add at least one Box and one Cover as child items
- **Conduit**: Multi-step flow — Trenching → Fittings → Overage
- **Wire**: Overage percentage + optional MAC Adapters
- **PDF exports**: Print for Review, Print for Purchase Order, Print with Form (Address, Permit NO, Builder or Occupant, Electrical Count)

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
