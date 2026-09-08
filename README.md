# Takeoff Tooling

A static web app for electrical estimators to create manifest-based bids. Enter fixtures and runs, add type-specific child items (boxes, covers, trenching, fittings, overage, MAC adapters), save reusable assemblies, look up labor and prices in the MC assemblies book, update supplier prices, import from CountTooling.com, and export to PDF or shareable links.

## Documentation

- [docs/guides/](docs/guides/README.md) — **user guides**: fifteen short articles, from your first bid to loading a supply house's price file
- [docs/JOURNEY-MAP.md](docs/JOURNEY-MAP.md) — the UX program: personas, fourteen journeys, findings and the ranked shortlist
- [CLAUDE.md](CLAUDE.md) — orientation for coding agents: layout, conventions, gotchas
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — runtime modules, state shapes, view pattern, storage keys
- [docs/DATA-PIPELINE.md](docs/DATA-PIPELINE.md) — how `mc-assemblies/*.json` is built and updated
- [docs/REFACTOR-PLAN.md](docs/REFACTOR-PLAN.md) — planned file splits and cleanup

## Features

### Manifest Table

- **Columns**: Assembly Description, Type, Quantity, Labor, Price, Plan Page
- **Item types**: Lighting, Gear, Devices, Conduit, Wire, Special Systems, PERMITS, POWER CO. CHARGES, TEMPORARY POWER
- **Type shortcuts**: `G` Gear, `L` Lighting, `D` Devices, `C` Conduit, `W` Wire, `S` Special Systems
- **Quantity**: Spinner controls (+, −) and direct input; a new row starts at 1, a component at 0. A row at 0 is none of it — no material, no hours, no purchase line — so zeroing a row is a clean what-if. Typing a description sets the quantity to 1; a described, priced row you spin back down to 0 shows its quantity greyed.
- **Summary**: Materials, labor hours by type and other charges, live as you type. Hours typed on a PERMITS / POWER CO. CHARGES / TEMPORARY POWER row bill under Other Charges but still count in the labor total, on the "Other" line. Money carries thousands separators and hours print to two places, so the hours and the dollars beside them always agree. Every number in the block says how it is built when you rest on it, and a type whose hours come from both the assembly rows and their parts shows the split in place of the bare figure — `11.28 · runs 5.28 + parts 6.00`.
- **Sales tax (%)**: The job's own rate, typed beside the labor rate and saved with the bid (a new bid starts at 8.5%; bids saved before the box existed keep 8.5%). It travels with a share link, so both people read the same grand total.
- **Site work is not stock**: A trenching line and any add-on from the flow's **Rentals** group (backhoe, saw cutting, haul-off…) bill under Other Charges — untaxed, and off the purchase list, because nobody orders a backhoe from the supply house. Their hours still count in the run's labor. Fill materials (sand, asphalt patch, pole bases, concrete pads, manholes) are real stock: taxed, and on the list.
- **Keyboard**: Tab walks the row's fields (the row's buttons are one stop, with ← and → walking the rest). Enter in the last field adds the next row and lands in it, as does **Add Row**; picking a type that is not Devices/Conduit/Wire puts the caret in that row's Labor. Ctrl/Cmd-Z outside a field is Undo (Shift adds Redo); inside a field, the browser's own undo is left alone.
- **Negative numbers**: A price, an hours figure, a quantity or a rate typed below zero is corrected to 0 when you leave the field, and the field says so.
- **Purchase list**: "Generate purchase list (PO)" totals the job's material as lines you can order, and stays in step with the bid while you correct it. One material at two prices shows the range (`$1,100.00–$1,250.00`) with the extended cost exact; a run's overage is bought with the run, so it reads as one line — `242 · 3/4" EMT Homerun (incl. 10% overage)`. **Copy** puts the same rows on the clipboard as tab-separated text.
- **Labor and Price Book**: Book icon on each row opens the Labor and Price Book for quick lookup
- **Edit in flow**: For Devices, Conduit, and Wire types — the pencil on the type chip opens the type-specific flow editor in one click
- **Change a row's type**: Click the chip's own text. The picker opens with the row's current type still set, and **No type** at the bottom is how a row goes back to untyped (its money moves to Misc.)
- **Remove a row**: The trash appears at the left of a row when the pointer is over it, and sits there permanently on a touch screen or a narrow window. It asks first, and Undo brings the row back.
- **The book moved on**: A row added or priced from the Labor and Price Book keeps a link back to that book row. If the book's price later differs from the row's — a quote landed, a supplier update ran — a quiet amber `book: $1,140` sits under the row's price. Clicking it brings the book's price (and its hours, if those changed too) onto the row as one undo. No chip means the two still agree.

### Devices Flow

The page is titled with the run's own name ("Office receptacle runs — parts"). A section you have not used yet shows as a chip ("+ Box"); clicking it opens that section's table and puts the caret in the new row's description. Sections:

- **Outlets and Switches** — Receptacles, switches, etc.
- **Boxes** — Junction boxes, device boxes
- **Back Box Support** — Mounting hardware
- **Covers** — Plates and covers
- **Conduit** — Conduit runs
- **Wire** — Wire runs
- **Screws** — Fasteners
- **Misc.** — Other materials

Each row has Description, Quantity, Labor, Price, and a **Book** button that fills the row from the Labor and Price Book. **Quantities are totals for the whole line, not per run** — a row on a 20-run line is seeded at 20, the column head says "Quantity (all 20 runs)", and the components panel prints both the extended price and the per-run price. Use **×2** / **÷2** for quick quantity adjustments. The two saves have different scopes: **Save as an assembly →** keeps these parts as a recipe for other runs (nothing reaches the bid), **Save parts to the bid** puts them on this bid and returns to the manifest. A save that changes nothing is not written at all, and rows that survive an edit keep their identity.

### Assemblies

Saved presets are recipes, not snapshots: each row is stored per run (its quantity divided by the run count it was saved from) and multiplied back up when loaded, rounding up to whole parts. Presets saved before this load at their original quantities, with a note on the page saying so.

- **Collapsible cards** — Expand to see the rows, with "$8.75 per run · 0.46 hrs per run · 4 parts" on the header
- **Load into Ledger** — Fills this run's sections from the preset, scaled to this line's run count. It replaces what is there: when parts were already on the page the note says how many were replaced and offers **Undo load**. Nothing reaches the bid until **Save parts to the bid**
- **Update from this run** — Replaces the recipe's parts with the ones on the page, keeping the same recipe (and the same name) rather than saving a second copy of it. The rows are re-recorded per run from *this* line's count, exactly as a first save would; if the page is empty the update is refused rather than blanking the recipe, and **Undo update** puts the old parts back
- **Rename** — Renames the recipe in place, so the name on the card, in the picker and on other devices all follow it
- **Delete** — Trash icon when expanded removes the assembly (with confirmation)

Saving, renaming, re-recording or deleting a recipe is not an edit to this bid — the recipes are a side cabinet, not the ledger. None of it marks the run unsaved, so **Cancel** still leaves without asking; the way back from an update is **Undo update**, not Cancel.

### Conduit Flow

Multi-step flow: **Trenching → Fittings → Overage**. Trench add-ons come in two groups, each with its own table and its own units: **Rentals** priced by the hour or day (backhoe, saw cutting, drilling, haul-off, manlift) and **Fill & site** priced by the unit (asphalt patch, trenching sand, pole bases, concrete pads, manholes) — fill is stock on the bid, a rental is not. Fittings come from a configurable list in `js/data/fittings.js`; picking one fills the blank row you are looking at.

### Wire Flow

Overage percentage and optional MAC Adapters.

Both flows head their panel with the run's length and its unit ("220 ft"), keep the overage percentage you picked lit until you type a different one, and print prices the way the rest of the app does — two decimals at or above a dollar, four below.

### Import from CountTooling.com

Paste clipboard data (fixture, count, page per line), or open an `#import=` link from Count Tooling. A **preview modal** shows what is on the bid beside what the count says, and every line's type in a picker you can correct before the rows exist.

**The count's numbers are totals, not additions.** A line whose description already exists on the bid sets that row to the import's number — up or down — and takes its plan page; the row's price and labor are left alone. Lines that don't exist yet are added.

- **The primary button** names what it will do before you press it: *Add 5 fixtures* on an empty bid, *Update 1 count · add 2 fixtures* on a re-count, *Nothing to change* (disabled) when the count matches the bid.
- **Add as separate rows** — only offered when at least one line already exists: every line becomes its own new row, duplicates included. Use it when the count really is a second batch of the same fixture.
- A line the app can't type shows a dashed **Needs a type** picker — set it in the preview instead of after the import.
- A count the app can't read shows as **× ?** and is never guessed as 0 or 1.
- A `px of …` line means the plan page was never scaled in Count Tooling; the preview says so.
- The whole import is **one undo frame**, including the blank starter row it replaces on a first bid.
- Count Tooling's signed-in `View link:` footer line is dropped rather than imported as a fixture. The link itself is not kept — the project document has no field for it.

### Export

- **Print for review** — the bid as a reviewer reads it: page 1 is the same summary the screen shows (materials by type, sales tax at the job's own rate, hours by type, labor rate, other charges, grand total — dollars and cents), then the line items with quantity, hours each and total, price each and total, and the plan page. Its labor total is the screen's labor total.
- **Print purchase list (PO)** — the purchase list on paper: the same merged materials the screen shows, with Qty, Material, Unit $ (a range when one material was bought at two prices), Extended $ and the materials total before tax, plus the job name, the date and a count of anything still without a price. Grouping rows, permits and power-company charges are not on it — the supply house gets only what it can quote.
- **Print with form** — the line items with the job's own details (client, address, permit no., builder or occupant, due date) printed under the job name on page 1. The details are filled in once, under **Print Options → Job details**, and stay with that bid; all of them are optional.
- **Copy share link** (Print Options) — copies a link carrying the full manifest, **the labor rate and the job details**, so whoever opens it sees the same grand total you do. It lands in a new bid on their device, above a line saying whose bid it is and when it was shared; their own bids keep their own rate. Opening the same link twice reopens the one copy instead of making a second.
- PDFs are named after the job and the day: `northgate-retail-purchase-list-2026-09-07.pdf`.

### Labor and Price Book

Two sides, toggled at the top of the modal:

- **Parts** — Editable per-tab sections (labor hours + price per item, each price badged with who supplied it and how old it is), woven together with the live supplier catalog: supplier categories render as regular sections (merging into a curated section or group of the same name), with a per-tab filter that searches both together. The Devices tab covers switches, occupancy sensors, boxes (the 1900 box, 4" square, 4-11/16", octagon, handy and gang boxes), rings and covers, wall plates and MC/romex connectors; Gear carries disconnects 30A–600A, Lighting carries photocells, Wire carries NM-B (romex) and MC cable by the foot, and Conduit carries pull string, mule tape and pull rope. Those rows ship with hours and no price on purpose — the supply house is where today's price comes from, and this book is where the hours live
- **Assemblies** — The MC assemblies book (24k+ entries) as a browsable category tree. An entry explodes into its component items only when those components add back up to the book price (within 10%); otherwise it lands rolled up at the book's own labor and price. Either way a line under the banner says which price was used, and unpriced components stay unpriced rather than becoming $0
- **Global search** — Searches all three at once, each named for what it brings: *Your book (hours)*, *MC assemblies (hours + material)* and *Supply house · Elliot (prices)*. It speaks the trade's shorthand in both directions (`2p 20a breaker` finds MC's "ENCL CB 2P", `exit sign` finds the exit lights, `emt 90` finds the 90D elbows), and rows holding the words you actually typed rank above ones an abbreviation reached
- **The part card** — the price badge on any row opens it: every supply house's current quote for that part, with **In use** marking the one the row carries, an append-only history in date order, and a form to record a new quote (leave the date blank if you don't know it). A price typed straight into the row is recorded too, as a hand-priced quote. Editing a supplier-catalog part copies it into your own book under the same section name, keeping the supplier's price as their quote — and your first real quote becomes the row's price. Parts already on a bid keep the price they were added with
- **Add to fixture / fill mode** — Apply a selected entry to a manifest row, or fill a specific flow row via the per-row "Book" buttons. A part added under a fixture inherits the fixture's count (gear, lighting, devices, special systems); under a conduit or wire run — whose quantity is footage, not a number of parts — it lands at 1 and says to set the count. Opening the book from a top-level row that already carries its own price offers to **use the book row as that row's price** (replacing price and labor, keeping your description), with "Add as a part underneath" one click away
- **Update Supplier Prices** — Import a vendor CSV (e.g. Elliot Electric), auto-match against MC items, work through what the computer wasn't sure about, and download the four files that publish the new prices to everyone. The first screen says which price file the book is showing and whether anything has been changed on this computer; every download reports its size against the file it replaces. Loading a price file can only add to the supply-house catalog: if the parts list cannot be stored, or a part number is already pricing another item, the book keeps what it has and the tool says so — and it refuses to build a book carrying fewer supply-house parts than the published one. Parts whose price didn't move keep the date they already had, so "priced 50 days ago" stays true after a re-import
- **The review list** — the uncertain matches, grouped by supplier category with a filter box, each row saying *why* it is uncertain (usually another part that fits the name just as well but costs a different price). **Match** confirms one; **Not this** passes on it — and both are remembered, so the next price file doesn't ask again
- **Abbreviation Key** — Decodes the shorthand on the screen behind it: the fitting codes on your own rows (D/S, S/S, D/C, S/C, W/C), enclosure and gear codes (N3R, MLO, 1PH/3PH), and the assemblies tree's own section codes (encl cb, nf/f, gd/hd, seb). The tree's section names carry the same decoding as a tooltip
- **Filter assembly sections** — The Assemblies side has its own per-tab filter, beside the "N assemblies loaded" line
- **Export Groups & Sections** — Export structure for customization (admin only — it is maintenance tooling, like Update Supplier Prices)

### Projects

The bid's name sits in the header, under it the time of the last save ("Saved just now", "2 min ago" — everything autosaves, there is no Save button on the manifest). Click the name for the switcher: your live bids, newest first with the open one pinned at the top, plus **Rename** (renames in place, in the header), **New project** and **Manage projects…**. When you have closed bids out, a "3 archived" line under those buttons opens the archive.

**Manage projects** lists every bid with its line count and when it was last edited, and offers Open, Rename, Duplicate, Archive and Delete. Delete asks inside the row and says how many lines go with it; the bid you have open can't be deleted or archived — open another one first. Naming a new job closes the dialog as soon as you press Create, and if the bid you were on was still untouched it is simply given the name instead of being left behind.

**Archive** is for a bid you are done with: it keeps every line, price and rate, it just leaves the switcher so a season of finished jobs stops standing between you and today's work. Archived bids sit in their own section of Manage projects (shut until you open it, most recently archived first) with **Unarchive** on each row to put one back. Archiving changes nothing else — the bid keeps its place in the "last edited" order, a duplicate of an archived bid is a live bid, and a bid that arrives over a share link is always live.

### Cloud Sync

Optional — the app works fully offline in this browser without it. **Sign In** (header) takes your email and password (or can email you a 6-digit code instead); once signed in, the manifest, labor book, labor rate, and saved assemblies sync to Supabase so the same takeoff follows you across devices. Each account sees only its own data. Each bid is its own record and the newer save wins per bid; the book follows its newest edit as a whole; assemblies merge. Signing in on a new machine opens your most recent bid rather than the empty one the app started with, and an empty bid you never typed in is not sent up at all. If the same bid was changed on two devices, neither version is thrown away: the newer one stays under the bid's name, the other is kept beside it as "<name> (conflict — <time>)", and a line under the header tells you it happened. A bid or an assembly you delete on one machine stays deleted on the others. **Sync now** reconciles this computer with the cloud — the newer copy wins each way; the header button says "Syncing…" until the last change has actually gone up, and a sync problem shows on the button itself.

**Your password is yours.** Signed in, the Cloud Sync dialog has **Set a password** (or **Change password** if you already use one) — an account that has only ever signed in with an emailed code can give itself a password from there. Forgotten it? **Forgot your password?** on the sign-in screen emails you a link back to the app, which asks for a new one. Nobody hands out temporary passwords: **Manage users** (dev role) adds an account to the list and gives it a role, and the person signs in with the code the app emails them.

When you close the tab or the lid with a change still on its way up, that last push is sent in a way the browser finishes after the page is gone, instead of dying with it.

**Improve the shared book** (opt-in, in the Cloud Sync dialog): share your price and labor corrections so the shared parts book gets more accurate for everyone. Only Labor & Price Book edits are shared — never your takeoffs or job data — and you can see exactly what's shared, what became of each correction (waiting for review / accepted / in the shared book / not adopted), or turn it off — which withdraws everything you shared, from any of your devices — at any time. Your sign-in email goes with each correction so we can ask you about it. The setting belongs to your account, not to the computer: it reads the same on every machine you sign in on, and it does not carry over to the next person who signs in here. Rows you are sharing are marked "shared" in the book. A supply-house part you copy into your book is not shared until you put your own hours or your own quote on it — until then it is the supplier's catalog price, which everyone already has. Accepted corrections ship to all users in an app update, and updated defaults merge into your book without touching rows you've customized — when that happens, a line under the header names the parts that changed.

### On a tablet or a phone

Same URL, no app to install and nothing device-specific to set. The layout follows the window's **width**, not which way you are holding the device: below **900 px** the manifest is a stack of labelled cards (Qty · Labor · Price · Plan page) and above it the desktop table comes back, so a 768-px iPad turned sideways gets the office table. Below 900 px the flow editors' Cancel/Save bar is pinned to the bottom of the window, so **Save parts to the bid** is always one tap away.

Below **640 px** the book's part rows become cards too — curated sections, supply-house sections and global search results all give the part's name a full line — and the parts tables inside a run editor scroll sideways in their own strip rather than pushing the page wide. On a touch screen every input is at least 16 px (so iPhone Safari stops zooming on focus), number fields raise the number pad, and the quantity spinner, book icon and trash are 44 px targets.

### Offline and installing

The app keeps a copy of itself on the device the first time you open it over a connection, so a refresh in the truck with no signal opens your bid instead of a browser error page. Everything local keeps working with no signal: adding rows, typing, totals, the Parts side of the book, PDF export.

Two things do need a connection at least once. The **Assemblies** side of the book is a large data file, so it is saved on the device the first time you open it — until then, offline it says so. And cloud sync obviously waits for a signal; your work is on the device either way, and syncs when you are back.

You can also **install** it: in Chrome or Edge use the install icon in the address bar, on an iPhone or iPad use Share → Add to Home Screen. It then opens in its own window, with no browser bar, from the home screen or the dock.

If the app ever looks stale after an update, use **Reload app (keeps your data)** in the ☰ menu. It throws away the saved copy of the app and fetches a fresh one — your takeoffs and your book are untouched.

### Other

- **Undo / Redo** — History for manifest changes (manifest only)
- **What we measure** — the app records which features get used (that a takeoff was saved, how many rows a purchase list had, which PDF was printed) so the next round of work goes where estimators actually spend their time. It never sends anything from your bid: no descriptions, no job or client names, no prices, no email. To turn it off entirely, set `takeoff-telemetry-off` in this browser's local storage — the app also honours Do Not Track.

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

The offline service worker (`sw.js`) registers on localhost too. It is network-first for the app's own code, so edits still show up on a reload; if you ever suspect a stale copy, use **Reload app (keeps your data)** in the ☰ menu, which clears the caches and unregisters the worker. **Bump `CACHE_VERSION` in `sw.js` when you deploy a change to the shell** — that is what retires the offline copy on everyone else's device. The app icons are generated: `python3 scripts/make-icons.py` after a palette change.

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
