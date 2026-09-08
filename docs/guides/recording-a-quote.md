# Recording a quote

A supply house calls back with a number. This is where you write down who quoted
what, and when — so that three months from now the bid can still tell you where
every price came from.

Quotes live in the **Labor & Price Book**, on the part itself. One part can carry
a quote from every house you deal with, and you pick which one the book uses.

## Write down a quote

1. **Open the book on the part.** Click the book icon on the bid row the part
   belongs to — the book opens on that row's tab (a panel opens on Gear) with a
   banner saying what you are adding to. If you just want to price a part and are
   not adding anything, the **Labor & Price Book** button in the header opens the
   same book with no bid row attached.
2. **Find the row.** Open the section — Panels, Switchboards, EMT fittings — or
   type into the search box at the top, which looks through your own book, the MC
   assemblies and the supply-house catalog at once.
3. **Click the price pill.** Every row carries one in the **In use** column:
   either a badge like `Elliot · 50d`, or a dashed **+ price** on a part nobody
   has priced yet. That pill is the door to the part card — clicking it is the
   only way in.
4. **Record the quote.** The card opens on the part, headed by its trail —
   `Gear · Panels · 1PH` — with **Part #** and **Labor (hrs)** at the top, then
   **Prices by supply house** (Supplier · Price · When · By), then a form: a
   **Supply house** box, a **Price** box, a date, and **Record price**. Type the
   house's name, the number they gave you, and the date they gave it. Leave the
   date blank if you don't know it — the row then reads the house's name with no
   age, rather than pretending it was quoted today.

   > **What you'll see:** the first quote you record becomes the row's price. Type
   > `1,975` or `$19.75` — dollar signs and commas are read as money. Type
   > something that isn't money and the field turns red and keeps your text,
   > rather than quietly storing nothing.

5. **Record the next house.** Every quote after the first is added beside the
   first, and does **not** move the price. Each row in the table has a **Use**
   button; the one the book is using reads **In use**. Click **Use** on the house
   you're buying from and the row's price and date follow it.

   > **What you'll see:** `CED · $1,180.00 · today · In use` on one line and
   > `Elliot · $1,215.00 · 31d · Use` on the next. Click Use on Elliot and the
   > row's price becomes $1,215.00, dated the day Elliot quoted it — not today.

## Reading the pill

The colour is the age of the quote the row is using, not the price:
**green** under 30 days, **amber** 30 to 90, **red** over 90, and no colour at all
when the quote has no date. Hover or tap the pill and it says the whole thing:
*"Price recorded 2026-05-29 from Platt"*.

## What "In use" does not mean

**In use is the price this book row carries. Parts already on a bid keep the price
they were added with.** The card says this in a line under the table, and it is
the rule that catches people out.

A part that is already on a bid is a snapshot. If you added a 42-circuit panel to
the Maple St bid at $1,200 and then record a cheaper quote in the book, the bid
still says $1,200 — deliberately, because a bid you already sent should not move
under you.

> **What you'll see:** a book-sourced row whose book price has since moved shows a
> quiet amber chip reading `book: $1,140.00` beside its price. Click the chip to
> take the new number — and the book's hours with it, when those moved too — onto
> the bid in one undo step. Rows whose price still matches the book carry no chip
> at all.

## Pricing a supply-house part

Supply-house sections sit in the book beside your own — thousands of parts, each
badged with the house's own price and import date. Type into one of those rows
(a price, hours, a part number) and the part is **copied into your own book**,
under a section with the same name. The house's number stays behind as their
quote, so the card shows their offer and yours side by side.

Once it is your row, it behaves like every other row in your book: record quotes
on it, switch which one is in use, and it survives an app update. Your **first**
real quote takes over from the house's catalog number — an import is not a quote.

The section you were reading stays open and the cursor stays in the field you
were typing in, so you can price ten parts in a row without losing your place.
The part disappears from the supply-house block below, because it is now yours.

## Good to know

- Recording a quote never touches a bid. It changes what the book offers the
  *next* time you add that part.
- The three age bands are exact: under 30 days green, 30 through 90 amber, over
  90 red.
- Two quotes from the same house merge into one line — the newest wins — and the
  earlier one stays in **History** underneath, in date order.
- Typing a price straight into the book row is recorded too, as a
  **Hand-priced** quote with a history line. Clear that price and the row goes
  back to the dashed **+ price**.
- Got a date wrong? The **When** cell is editable in place, and correcting it does
  not count as changing the part.
- Leave the Supply house box empty and the card says *"Which supply house quoted
  this? Type their name first."* Type something that isn't a number and it says
  *"Type the price as money — 1,975 or $19.75."* Neither one fails silently.
- A quote from a house that is **not** in use never moves the row's price. You can
  log the whole market and still buy from one house.
- **Esc** closes the card first and the book second, so you never lose your place.
- Book edits are not covered by Undo. Undo is the bid only.
- A quote you record is yours alone unless you have turned on **Improve the
  shared book** — see [Sharing fixes to the book](sharing-fixes-to-the-book.md).
