# Finding a part

You need a 3/4" EMT coupling for the homerun, a 2-pole 20A breaker for Panel A, a
20A duplex for the break room. The **Labor & Price Book** holds three different
kinds of answer, and knowing which one you are looking at is most of the job.

## Look it up and put it on the bid

1. **Point the book at the fixture first.** The quickest way is the **book icon**
   on the bid row itself — the book opens on that row's tab with a banner saying
   what you are adding to. From the header button, use the **Add to fixture**
   picker at the top instead. Add without a fixture and the book says *Pick a
   fixture* on the page — it does not stop you with a dialog.

2. **Type the trade name.** The big **Search everything** box looks through all
   three sources at once and answers in about a quarter of a second. Type the way
   you talk: `3/4 emt coupling`, `2p 20a breaker`, `exit sign`, `4 square box`,
   `single pole switch`, `emt 90`. The book knows the shorthand in both
   directions — `cb` and `breaker` are the same thing, `1900` and `4 square` are
   the same box, an `emt 90` is an elbow — and the rows holding the words you
   actually typed sort above the ones an abbreviation reached.

3. **Read the three lists for what they carry.** Each is named for it:

   - **Your book (hours)** — the curated book. 621 rows, 606 of them with
     hours and only 98 with a price. This is where the labor comes from.
   - **Supply house · Elliot (prices)** — the supplier catalog. 27,556 parts,
     27,544 of them priced and **not one of them carrying hours**. This is where
     today's money comes from.
   - **MC assemblies (hours + material)** — 24,291 MC entries, the only source
     that carries both.

   > **What you'll see:** `3/4 emt coupling` returns 3 assemblies, 2 rows from
   > your book (hours, no price) and 27 supply-house couplings (priced, no
   > hours). None of them is wrong; they are three incomplete shapes of the same
   > coupling.

4. **Press `↳ Add`** on the row you want. A toast says what landed, where, and at
   what count.

## What Add actually does

- **Under a counted fixture** — gear, lighting, devices, special systems — the
  part lands as one component at the fixture's own count. Add a termination under
  a line of 24 panels and you get 24 of them.

  > **What you'll see:** *×24 under Panel LP-2*.

- **Under a conduit or wire run**, whose quantity is footage rather than a number
  of parts, the part lands at **×1** and says so — you are not buying a coupling
  per foot.

  > **What you'll see:** *×1 under 3/4" EMT Homerun — set the count*. The banner
  > says the same thing before you press anything.

- **An MC assembly** is added one of two ways, and the app picks:

  - If its components are all priced and they add back up to the book's own price
    (within 10%), it explodes into those components as separate lines. The toast
    says *from components*.
  - If they don't — an unpriced component, or a sum that doesn't reconstruct the
    row — the whole thing lands as **one line at the book's own hours and
    price**, which is the number you read on the row. The toast says *book
    price*.

  Either way the number on the bid is a number you saw. Press `▸` on any entry
  to see its bill of materials and the footer line that says which price will be
  used.

- **Pricing a fixture from its own book row.** Open the book from a top-level row
  that already carries a price, and Add on a book row of the same type
  **replaces that row's price and hours** while keeping your own description for
  it. *Add as a part underneath* is one click away in the banner if you meant the
  other thing.

A row's description on the bid carries its section, so an elbow and a coupling
that share a name in the book stay apart on the bid and on the purchase list —
`1/2" EMT(S) EMT fittings (SS) - Couplings`, not a bare `1/2" EMT(S)`.

## Browsing instead of searching

**Assemblies** at the top of the modal is the MC book as a tree:
level 1 → level 2 → section. It has its own filter box beside the
*N assemblies loaded* line — type `encl cb` and the tree narrows to the matching
sections with a count.

The section names are MC's own shorthand, and every one carries its decoding as
a tooltip. The ones you will meet first:

- **Equipment → Switchs/Breakers → encl cb** — enclosed circuit breaker.
- **nf / f** — non-fused / fused.
- **n1 / n3r / n4x** — enclosure ratings: indoor, rain-tight, washdown.
- **gd / hd** — general duty / heavy duty. **seb** — service entrance.

The **Abbreviation Key** button decodes the whole screen — those tree codes, and
the fitting codes on your own rows (D/S, S/S, D/C, S/C, W/C) as well.

## Good to know

- **The curated book covers devices too** — 1900 boxes, single-pole switches, MC
  connectors and the rest — so a device search returns hours, not just supplier
  prices.
- **A book-sourced row on the bid keeps the price it was added with.** When the
  book's price for it later moves, the row shows a quiet amber `book: $…` chip;
  one click takes the new number. See
  [Recording a quote](recording-a-quote.md).
- **The per-tab filter narrows your rows and the supplier's together**, with a
  count on each block — *First 100 of 555 matches*.
- **A big supplier section shows its first 100 rows** with a **Show all 3,937
  parts** button, and **Show the first 100 again** to get back. Showing all
  3,937 parts is slow on purpose.
- **`Esc` steps back one level**: it clears the search term first, then the
  assemblies filter, then closes the book. Closing the book drops the term, so it
  never reopens on a stale search with its tabs hidden.
- **`g l d c w s` switch tabs** on either side of the book.
- The book icon on a *flow* row is the **Book** button, and it fills that row in
  place rather than adding a new one. See
  [Parts under a device run](parts-under-a-device-run.md).
- Adding from the book is one undo step, an exploded assembly included.
- Prices in the book are per the unit the supply house sells in. A curated wire
  row priced per roll and a supplier row priced per foot both say "12 THHN" —
  read the section name before you take the number.
