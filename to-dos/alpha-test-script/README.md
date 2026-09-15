# Alpha test script — run it, and file what it finds

Status: **not started** · script finished 2026-09-14 against `main @ 93e914b` · nobody has run it yet · same content as the private artifact, kept here so it is not only on a chat link.

## The ask, in the owner's words

> what should I tell someone else to test to verify the things this touch work now?

Then, six days later: *"nobody ran the test script yet"* and *"Save this alpha test script to the apps to-dos"*. The September journey-map program (docs/JOURNEY-MAP.md — 14 journeys walked, the five-tier shortlist fixed, the guides written, the Supabase checklist applied) is closed on the engineering side. **The one open loop is a human running this script on the deployed app.**

## The decision

One script, seven rounds, about forty minutes plus ten on a real phone. Every step prints the figure the screen must show, because this app's failure mode is a wrong dollar amount that looks right. Rounds are in the order a bid is built — the bid made in Round 1 is reused — so they are not independent. Round 6 lists the changes that are deliberate so they are not filed as bugs; Round 7 is the one known pair.

The tester needs no account for Rounds 1–4. Round 5 (signed in) is fully testable as of 2026-09-14: all six migrations and the three auth items are applied (see `supabase/README.md`).

**Rendered version:** [`script.html`](./script.html) — the same content with tick boxes (ticks save in the tester's own browser). Open it locally, or from the private artifact if it is still shared.

## Where it plugs in

- App under test: **https://takeofftooling.com/** (Pages CNAME; `takeofftooling.github.io` 404s).
- The behaviours below are each pinned by a Playwright spec at the repo root; when a step and the app disagree, the spec is the tie-breaker: `manifest-summary.spec.js`, `manifest-keyboard.spec.js`, `import-preview.spec.js`, `device-flow.spec.js`, `flow-editors.spec.js`, `book-search.spec.js`, `book-defaults.spec.js`, `share-link.spec.js`, `review-pdf.spec.js`, `project-switch.spec.js`, `phone-widths.spec.js`, `offline-shell.spec.js`, `cloud-local.spec.js`, `explode.spec.js`.
- The guides the tester can be pointed at: `docs/guides/README.md`.

## How to report

For anything that looks wrong: **which screen, what you did, what you expected, what you saw**, plus the numbers and the browser width. A wrong number — a total, an hour count, a purchase line — is the highest-value find even without exact steps. File as a GitHub issue on `clickconstruction/takeofftooling.github.io`.

---

## The script

**Set up in thirty seconds.** Open the app in a private / incognito window on a desktop browser. The app saves into that browser, so a private window guarantees a clean first run and throws the test bid away when closed. Don't sign in until Round 5.

### R1 — Ten minutes that have to pass

If anything here fails, stop and report it; the rest is built on this bid.

- [ ] **1. Open the app cold.** Load the URL in the private window.
  *Right:* a line reading `Start here.` above one empty row. No totals panel yet — it appears once a row has a description. No error banner.
- [ ] **2. Build one priced line.** Description `2x4 LED Troffer`. Click the **type…** chip, pick **Lighting** (or press `L`). Quantity `24`, Labor `0.75`, Price `89.50`. Labor rate `92`.
  *Right — check all five:* Lighting materials **$2,148.00** · Sales tax (%) pre-filled **8.25** giving **$177.21** · Labor **18.00** hrs · Labor total **$1,656.00** · Grand Total **$3,981.21**.
- [ ] **3. Type a number, then immediately click something else** *(was broken)*. Click into Quantity, type `25`, and without pressing Tab click straight into the Labor rate box.
  *Right:* the click lands (cursor in the Labor rate box) and the quantity keeps `25`. Until this month the click was swallowed and the typed number lost. Try it on Price and Labor too.
- [ ] **4. Correct the bid with the purchase list open** *(was broken)*. Set quantity back to `24`. Press **Generate purchase list (PO)**, then with the list on screen change the quantity to `30`.
  *Right:* the list updates as you type — `30` and **$2,685.00**. List total and summary never disagree.
- [ ] **5. Undo right after typing** *(was broken)*. Type a different quantity, then press **Undo** in the header (or ⌘Z / Ctrl-Z with the cursor outside a field).
  *Right:* Undo is lit and works on the first press. Set the quantity back to `24`.
- [ ] **6. Print for review.** Print Options → Print for review. Open the PDF.
  *Right:* page 1 is the on-screen summary with dollars and cents; page 2 the line items — every description inside its own column, nothing overlapping Quantity or Price, hours to two decimals, file named after the job and today's date.

### R2 — The routes that changed

Keep the same bid. Each block is independent.

**Counts arriving from Count Tooling**

- [ ] **7. A re-count must not duplicate the fixture** *(was broken)*. Copy these two tab-separated lines, then **Paste from CountTooling.com**:
  `2x4 LED Troffer ⇥ 30 ⇥ E2.1` and `LED Wall Pack - WP1 ⇥ 7 ⇥ E1.0`
  *Right:* one primary button reading **Update 1 count · add 1 fixture**. Press it: the troffer row becomes `30`, keeps its price and hours, and there is **no second troffer row**. The wall pack arrives typed Lighting. (The old "Add All" turned 24 + 30 into 54.)
- [ ] **8. A count that went down.** Paste again with the troffer at `18`.
  *Right:* the preview shows **× 18 · was 30, −12** and the button takes it. Put it back to `24`.

**A device run**

- [ ] **9. Quantities are totals for the whole line.** Add a row `Duplex receptacle 20A`, quantity `20`, type **Devices** — the editor opens by itself.
  *Right:* eight **chips** ("+ Box", "+ Cover"…), not eight empty tables. Click **+ Box**: the new row is seeded at `20`, the header reads **Quantity (all 20 runs)**, and the panel prints the extended price *and* the per-run price.
- [ ] **10. Fill a row from the book.** On the box row press **Book**, search `1900 box`, add `4" Square Box, 1-1/2" deep`.
  *Right:* the description is exactly the part name — no section name pasted on the end. Hours `0.25`, price `3.90`. **Save parts to the bid**: Devices materials **$78.00**, Devices labor **5.00** hrs.

**A conduit run**

- [ ] **11. Nothing reaches the bid until Save** *(was broken)*. Add `3/4" EMT Homerun`, quantity `150`, price `1.10`, type **Conduit**. In the wizard: quick-add **Dirt to 24in**, **+ BACKHOE**, **Next**, pick the `90° Elbow` preset, quantity `4` / labor `0.12` / price `2.40`, then **Back**, then **Cancel**.
  *Right:* Cancel **asks first** ("Discard unsaved changes in this editor?"). Say no, go forward, set overage `10%`, **Save parts to the bid**.
- [ ] **12. Trenching and rentals are not stock.** Read the totals panel, then the purchase list.
  *Right:* Conduit materials **$191.10**. The trench (**$2,250.00**) and the backhoe sit under **Other charges → Site work & rentals**, untaxed and **not** on the purchase list. The conduit line reads **165 · 3/4" EMT Homerun (incl. 10% overage)** — one line.
- [ ] **13. Change the run afterwards.** On the manifest change the homerun from `150` to `200`.
  *Right:* the overage child follows on its own — `20` ft, not a stale 15.

**Finding a part**

- [ ] **14. Four searches that used to return nothing** *(was broken)*. Labor & Price Book, one at a time: `2p 20a breaker` · `exit sign` · `mac adapter` · `single pole switch`.
  *Right:* all four return hits, closest first, under **Your book (hours)**, **MC assemblies (hours + material)**, **Supply house · Elliot (prices)**. Anything you'd actually say that returns nothing is worth reporting.
- [ ] **15. The assemblies side.** Switch to **Assemblies**, use the filter box; open **Abbreviation Key**.
  *Right:* the filter narrows the tree; the key decodes the codes on screen (`nf`, `n3r`, `gd` …).

**Proving the number**

- [ ] **16. A row spun down to zero** *(changed on purpose)*. Spin the troffer to `0`; read totals and the list; put it back to `24`.
  *Right:* at zero the row contributes **nothing** — no material, no hours, no purchase line — and its quantity cell greys. This changes the total on any old bid that parked a row at zero: say so if it surprises you.
- [ ] **17. One material at two prices.** Add a second row with the same description and a different price; regenerate the list.
  *Right:* one line, unit column a range (e.g. **$89.50–$92.00**), extended column exact; list total still matches the summary to the cent.

**Delivering it**

- [ ] **18. The share link carries the rate** *(was broken)*. Print Options → **Copy share link**; open it in a different browser or a second private window.
  *Right:* a banner says it is a copy, and the **same Grand Total** as the sender. Opening the same link twice returns your copy, not a second identical bid.
- [ ] **19. The other two prints.** Under Print Options fill in **Job details** (client, address, permit); then **Print purchase list (PO)** and **Print with form**.
  *Right:* the PO PDF is the on-screen purchase list with quantities, unit prices, extended costs and a materials total; the form prints the job details on page 1; the details stay with *this* bid.

**Several bids at once**

- [ ] **20. Name, rename, archive.** Name this bid, make a second, rename one from the switcher, open **Manage projects**, archive it.
  *Right:* naming a job **closes** the dialog; the header shows **Saved just now**; **Lines** counts components; an archived bid leaves the switcher, which reads **1 archived**.
- [ ] **21. Switch bids from inside an editor** *(was broken)*. Open a conduit or device editor, type something, and without saving switch bids from the header.
  *Right:* it asks about the unsaved edit, and either way you land on a **working manifest** (it used to leave a blank page, or save into the wrong job).

### R3 — On a real phone or tablet (actual hardware, same URL)

- [ ] **22. The bid on a phone.** Type a five-digit quantity like `12000`, tap the +/− spinners, scroll the page.
  *Right:* stacked cards; the quantity fully readable; nothing scrolls sideways; tapping a field does **not** zoom; the trash is on every row.
- [ ] **23. The book and the editors on a phone** *(was broken)*. Open the book and search; open a device run.
  *Right:* every part's **name** is readable — search results and supply-house rows alike (it was clipped to three characters). In the editor, **Save parts to the bid** is pinned at the bottom of the screen.

### R4 — Offline, and installed

- [ ] **24. Reload with no signal** *(new)*. Airplane mode, then reload.
  *Right:* the app comes back with your bid instead of the browser's "no internet" page; typing, totals and the Parts side of the book keep working; the Assemblies side needs one online visit first and says so.
- [ ] **25. Add to home screen.** Phone: Share → Add to Home Screen. Desktop Chrome: the install icon.
  *Right:* opens in its own window with an icon, no address bar.

### R5 — Signed in

The account side is fully set up as of 2026-09-14 — sync, the conflict-safe project write, and the password-reset address. If "Forgot your password?" does nothing, that is now a real bug.

- [ ] **26. Sign in and sync.** Sign in with the emailed six-digit code; open the app on a second device and sign in there.
  *Right:* your bids arrive on the second device. Edit the same bid on both machines: neither copy vanishes — a collision yields a second bid named **(conflict — time)**.
- [ ] **27. Set a password.** Signed in, Cloud dialog → **Set a password**; sign out and back in with it.
- [ ] **28. Forgot your password?** *(new)*. Sign out; on the sign-in form type your email, press **Forgot your password?**, open the email.
  *Right:* a **link** (not a code) that opens **takeofftooling.com** itself with a "choose a new password" form. Set one, sign in with it.

### R6 — Changed on purpose — do not file these

- **A row at quantity 0 bills nothing** (it used to count as one unit).
- **Sales tax starts at 8.25%** — a field per bid, not a fixed 8.5%; travels with a share link.
- **Trenching and rentals are Other charges** — untaxed, off the purchase list. Sand, patch and pole bases are still stock.
- **"Book", not "PB"** — same button.
- **The trash is on every row** — the ☰ "Remove items" mode is gone.
- **The chip's text opens the type picker**; the pencil opens the run's editor; the old × is gone ("No type" instead).
- **Print with form has no pop-up** — job details live under Print Options and belong to the bid.
- **Hours print to two decimals.**
- **Permit hours count** in the labor total, on screen and in the PDF.
- **One row per part in "Your book"** — where two curated rows named the same part, the priced assembly-hours row stayed (a 20A single-pole switch reads 0.45 h / $12.50, not 0.20 h). "1900 box" still finds the 4" square box.

### R7 — Already known

- **Two "occupancy sensor" rows** — *Occupancy sensor, wall switch* (Occupancy Sensors) and *Occupancy Sensor Switch* (Switches). Deliberately left; not a bug.

## When it has been run

Record who ran it and on what (browser, phone), attach the issue numbers filed, and either delete this folder in the fix PR or move the `Status:` line to `blocked on …` with the issue list.
