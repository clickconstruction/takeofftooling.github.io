# Shaping the bid

The counts are in. Now you make the list look like the bid: every row typed,
quantities corrected against the sheets, breakers listed under their panel, the
stray line gone — and Undo standing behind all of it.

## Give a row its type

1. **Click `type…` in the Type column**, or press one of the six letters once the
   picker is open: `L` lighting, `G` gear, `D` devices, `C` conduit, `W` wire,
   `S` special systems. **Other ▾** holds Permits, Power co. charges and
   Temporary power; it stays open for the rest of the session once you use it.

2. **Know which types leave the table.** Lighting, Gear, Special Systems and the
   three Other types stay put and drop the cursor into that row's Labor box.
   **Devices, Conduit and Wire open their own editor immediately** — the picker
   says so under each one. Nothing is lost if you didn't mean it: the app's name
   in the top left takes you straight back.

3. **Change a type later.** Click the chip's **text** and the picker opens again,
   with **No type** at the bottom. A Devices, Conduit or Wire chip also carries a
   **pencil** — that is the one-click door back into that row's editor, so
   opening your run stays one click and re-typing it is two.

   A row you set back to **No type** keeps its money: it lands on the **Misc.**
   line in the totals until you type it again. Its components stay too — clear a
   Devices row's type, set it back to Devices, and the editor opens with all your
   boxes and covers still in it.

   > **What you'll see:** clearing the type on a Devices line carrying $47.40 of
   > components and 9.00 hrs moves exactly that — $47.40 and 9.00 hrs — from the
   > Devices line to Misc., and nothing else changes.

## Put parts under a fixture

Some lines are one thing. Others — a panel and its breakers, a fixture and its
whip — read better as a parent with components underneath.

1. **Click the `↳` arrow** under the book icon on a childless row. A blank
   indented row appears with the cursor already in its description.
2. **Type the part, then Tab through quantity, hours and price.** Components have
   no plan page and no type of their own; they count into the parent's bucket.
3. **Use the ghost `↳ Add component` row** at the bottom of the block for the
   next one. Once a row has components the `↳` on the parent goes away — the
   ghost row is where the next one lands, and it shows you exactly where.

   > **What you'll see:** put `Breaker 20A 1P` × 30 at $14.25 under a $1,250
   > panel and the Gear line climbs from **$1,250.00** to **$1,677.50** as you
   > type (+30 × $14.25 = $427.50), taking the Grand Total from **$15,687.72** to
   > **$16,151.55**.

Components go two levels deep and no further — a component cannot have
components of its own.

## Take a row off the bid

**Every row carries a trash icon.** It appears when you hover the row on a
desktop and is always there on a touch screen — parents and components alike.
Click it, confirm, and the row is gone.

Removing a parent removes its components with it, in **one** undo frame: one
press of Undo brings the panel *and* all thirty breakers back. Delete the last
row on the bid and a blank one is put in its place — that is one undo step too,
not two.

**Do not delete a row by zeroing its quantity.** Quantity 0 is a real answer —
no material, no hours, no purchase line, and the quantity box greys out to say
so — which makes it a clean what-if. But the row is still on the bid, and it
will still be there next week when you have forgotten why.

## Undo, and what it covers

- **Undo and Redo are the bid table only.** Price-book edits, saved assemblies,
  the labor rate and the sales-tax rate are not undoable. That is deliberate: the
  book outlives the bid.
- **One typing burst is one step.** Keep typing and it stays one; pause a little
  over a second (1.2 s) and the next keystroke starts a new one. Three quick
  clicks on the `+` spinner are one step. A whole import is one step. A whole
  flow-editor save is one step.
- **Fifty steps deep**, then the oldest falls off the back.
- **Ctrl/Cmd-Z outside a box** does what the header button does. Inside a box,
  your browser's own per-field undo is left alone, so you can back out a typo
  without backing out the row.
- **Undo from inside a flow editor asks first.** If you have unsaved changes in a
  Devices, Conduit or Wire editor, Undo raises *Discard unsaved changes in this
  editor?* **before** it touches anything. Cancel really cancels: the editor
  stays open, your edits stay in it, and the bid underneath is untouched. Say OK
  and you land back on the table with the undo applied.

## Good to know

- **Typing a description on a blank row sets its quantity to 1.** A component row
  starts at 0 and becomes 1 the moment you name it — a row you are filling in is
  never silently worth nothing.
- **A negative number is corrected to 0** when you leave the box, and the box
  says so. This goes for price, hours, quantity and both rates.
- **A price-less parent is a grouping.** It contributes no material of its own,
  its components list individually on the purchase list, and it never appears
  there itself.
- **Hours typed on a Permits / Power co. charges / Temporary power row** bill
  under Other Charges but still count in the labor total, on the *Other* line —
  the screen and the printed bid read the same number.
- **Tab walks the boxes, not the buttons.** Description → quantity → hours →
  price → plan page. A row's icons are a single Tab stop of their own at the head
  of the row, and the arrow keys walk from one icon to the next — so nothing is
  out of reach from the keyboard and nothing costs five presses to skip.
- **Enter in the last box of a row** adds the next row and puts you in it — same
  as **Add Row**.
- The summary moves as you type. You never have to press anything to see the
  bid's total.
