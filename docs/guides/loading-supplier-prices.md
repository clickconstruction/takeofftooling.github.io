# Loading the supply house's price file

Elliot sends this month's price file. This is how it gets into the book — first
on your computer, then on everyone's.

## Who has the button

**Signed-in admins only** (roles `admin` and `dev`). An estimator signed in as
`user`, or anyone signed out, does not see it — the button is not there to be
found.

It hides in one more place: it lives at the bottom of the Labor & Price Book's
**Parts** side, and it disappears while you have something typed in the search
box. Clear the search and it comes back.

## Load the file

1. Open the **Labor & Price Book** and scroll to the footer → **Update Supplier
   Prices**. The tool opens with three tabs: **Upload**, **Review Matches**,
   **Summary**.
2. Read the first line before you do anything.

   > **What you'll see:** *"The book's supply-house prices are from the file
   > published 2026-08-14 (12,345 parts). Nothing has been changed on this
   > computer."* That is the file everyone is looking at. If you have already
   > loaded one here, it says so instead — *"This computer is showing elliot.csv
   > from 2026-09-07 — 3,201 prices moved, 12,345 parts. Nobody else has these
   > yet."*

3. Pick the supplier, then choose the CSV, paste it in, or press **Load bundled
   …**. Press **Process**; it lands on the Summary in a second or two.

## Read the summary

Every line is the computer telling you what it did with the file.

> **What you'll see, in trade terms:**
>
> | Line | What it means |
> |---|---|
> | `Rows in file — 34,099 (33,177 unique parts)` | how big the file was, after the duplicates |
> | `Matched by a saved match` | parts you or a previous admin already confirmed |
> | `Matched automatically` | the computer was sure enough on its own |
> | `Held back — the part number already prices another item` | the file wants to move a part number onto a different item; it refuses and sends it to Review |
> | `Part prices that moved` | how many parts changed price |
> | `Assemblies repriced — 5,780 (avg change 36.5%)` | assemblies the new prices flowed through |
> | `Assemblies left at the old price ⚠` | the book's formula didn't add up, so the old price was kept |
> | `Needs review — 2,525` | plausible matches the computer would not take alone |
> | `Passed over before, not asked again` | rows you already said no to |
> | `Duplicate part numbers with differing prices — 610 (lowest price kept)` | the file quoted one part twice; the cheaper won |

Underneath, **Sort supplier categories into tabs** decides where each of the
file's categories shows up in the book — Gear, Lighting, Conduit and so on.

**"Skip" means two different things in this tool, so read which one you're
looking at.** In the category table, **Skip** is a destination: it leaves that
whole category out of the book. In the review list, the button that passes on a
single part is called **Not this** — there is no "Skip" there at all.

## Work the review list

Open **Review Matches**. These are the ones the computer would not take alone.

> **What you'll see:** *"2,525 parts have a likely match the computer would not
> take on its own. Match one, or say Not this — both are remembered for every
> future price file."*

- Rows are **grouped by supplier category**, biggest group first, with a
  **Filter by part name** box and a category picker beside it. The list draws the
  first 200 and says so: *"Showing the first 200 of 2,525 — narrow it down with
  the box above."*
- Every row says **why** it is uncertain — *"Another part fits the name just as
  well but costs a different price: THHN 14 STR ORANGE at $0.1541."*, or that the
  supplier's price is 20× the book's.
- **Match** takes the candidate in the dropdown. **Not this** passes. Both stick:
  the next price file does not ask you again.
- There is no bulk decision here: every row is one person's call, one at a time.
- Each decision confirms out loud — *"Matched … Remembered for future price
  files."* / *"Passed on … it will not come back on the next price file."* — and
  removes just that row. The other 199 don't move.

You do not have to finish. Whatever you leave is still there next time.

## Send the prices to everyone

Nothing you have done so far has left this computer. The book on your screen has
the new prices; nobody else's does.

Under **Send the new prices to everyone**, download four files:

- `mc-labor-book.json`
- `elliot-price-overlay.json`
- `elliot-item-mappings.json`
- `elliot-category-mapping.json`

Hand all four to whoever maintains the site. They replace the files of the same
name in `mc-assemblies/` and publish — a code change and a deploy, not something
you can do from here. Once published, **every estimator's book updates on their
next reload.**

> **What you'll see:** each download reports its size against the file it
> replaces — *"Downloaded elliot-price-overlay.json — 12,345 parts (published
> file: 12,300)."* If a file would arrive smaller than the published one, it says
> so; and if the book would lose parts outright it refuses to download at all:
> *"Not downloaded — this book would drop 4,000 supply-house parts (12,345 →
> 8,345). Load the price file again before sending prices to everyone."*

## If you want to undo it

**Remove this price file**, on the Upload tab, puts your book back to the
published prices. It asks first: *"Remove the price file loaded on this computer?
The book goes back to the published prices and parts. Your saved matches and the
review list are kept."*

## Good to know

- Loading a price file can only add to the supply-house catalog. It can never
  shrink it, and a part number is never allowed to price two different items.
- Parts whose price didn't move keep the date they already had, so *"priced 50
  days ago"* stays true after a re-import.
- Changing a category's destination applies immediately.
- Adding a second supply house is a file change, not a setting: the tool says
  *"More suppliers can be added in mc-assemblies/vendor-profiles.json"*.
- **Review suggestions** in the ☰ menu is the other admin surface — the queue of
  corrections estimators sent from their own books. See
  [Fix a number once, fix it for everyone](sharing-fixes-to-the-book.md).
