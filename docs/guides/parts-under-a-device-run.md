# Parts under a device run

"Duplex receptacle runs — break room, 12 runs" is one line on the bid. The
receptacles, boxes, covers and screws that make it real live in the run's own
editor. This is where you price them, and where you keep the recipe so the next
20-run office line takes ten seconds instead of five minutes.

## Open the editor

The **pencil** on a row's green **Devices** chip is the door — one click, from
the bid table. If you are typing the row now, pressing `D` in the type picker
sets the type *and* drops you straight into the editor; you never see the chip.

The page is titled with the run's own name — *Duplex receptacle runs — break
room — parts* — and it edits a working copy. **Nothing reaches the bid until you
press Save parts to the bid.**

## Fill in the parts

1. **Pick a section.** A section you haven't used yet is a chip, not a table:
   **+ Outlet/Switch**, **+ Box**, **+ Back Box Support**, **+ Cover**,
   **+ Conduit**, **+ Wire**, **+ Screws**, **+ Misc.** Click one and its table
   opens with a row ready and the cursor in the description.

2. **Type the part.** Description, quantity, hours each, price each. Empty a
   section again and it folds back to its chip; a blank row never reaches the
   bid.

3. **Read the quantity column head.** **Component quantities are totals for the
   whole line, not per run.** A row you add on a 12-run line is seeded at 12, and
   the column head says **Quantity (all 12 runs)** so there is nothing to guess.
   If a part is one per run, leave the 12 alone; if it is one per *four* runs,
   type 3.

4. **Use ×2 and /2** on a row for the common corrections — two receptacles per
   run, one box per two runs.

5. **Watch the panel.** *Components (extended)* is the money that will land in
   the bid's **Devices** bucket, and it prints both readings of it.

   > **What you'll see:** with `Duplex receptacle 20A` 12 × 0.25 hrs / $3.85,
   > `4" square box` 12 × 0.20 / $2.60 and `1-gang plastic cover` 12 × 0.05 /
   > $0.75, the panel reads Labor **6.00** hrs, Price **$86.40 — $7.20 per
   > run**, and under it *Job labor: parent 3.60 + components 6.00 = 9.60 hrs*.

6. **Fill a row from the book.** The **Book** button at the left of every row
   opens the Labor & Price Book pointed at that row: the banner names the row,
   the search box has the cursor, and picking an entry replaces that row's
   description, hours and price. It is the row's only book door. See
   [Finding a part](finding-a-part.md).

7. **Save.** **Save parts to the bid** writes the parts under the run and returns
   you to the table.

   > **What you'll see:** three component rows under the parent, each with its
   > own chip, and the bid's **Devices** line reading **$86.40** with 9.60 hrs.
   > It is one undo step — one press removes all of them.

## Two saves, and you want both

The page has two buttons with "save" in them, and they do different things.

- **Save as an assembly →** keeps these parts as a **recipe** for other runs.
  Nothing reaches the bid. Type a name and press **Save assembly**.
- **Save parts to the bid** puts them on *this* bid and takes you back.

Do both, in that order, the first time you build a recipe you will use again.

## Reuse the recipe

An assembly is stored **per run**, not as a lump. Each row's quantity is divided
by the run count it was saved from and multiplied back up when you load it,
rounding **up** to whole parts — nobody orders 0.4 of a box support.

1. **Open the Assemblies bar** at the top of any device run's editor.

   > **What you'll see:** the card header reads **$7.20 per run · 0.50 hrs per
   > run · 3 parts** — per run, so it means the same thing on every line you load
   > it onto.

2. **Press Load into Ledger.** The preset fills this run's sections, scaled to
   this line's run count.

   > **What you'll see:** the same recipe on a 20-run line comes back as 20 / 20
   > / 20, the panel reads **$144.00**, and the note says *quantities set for 20
   > runs*.

3. **Load into Ledger replaces what is on the page.** If there was anything
   there, the note says how many parts were replaced and offers **Undo load** —
   one click and your rows are back. On an empty page it just loads, with no
   question asked.

4. **Delete a preset** with the trash icon on the expanded card. It asks first.
   Deleting a preset never touches a bid that used it.

A preset saved before per-run scaling existed loads at its original quantities,
and the note on the page says *saved as totals* so you know to check them.

## Good to know

- **Nothing here is on the bid until you Save.** Cancel, the app's name in the
  header, and Undo all ask *Discard unsaved changes in this editor?* first if you
  have typed anything — and Cancel really cancels.
- **A save that changes nothing is not written at all.** No new undo step, and
  rows that survived an edit keep their identity.
- **The panel's Price is the extended price** — quantity × price, for the whole
  line. The per-run figure beside it is the same money divided by the run count.
- **"Job labor" is the whole line's hours**: the parent's hours-per-run × the run
  count, plus the components' hours. It is the number the bid's Devices labor
  line will read.
- **The run count on the bid does not follow into the parts.** Change a 12-run
  line to 20 and the components stay at 12 — open the editor and correct them, or
  load a per-run preset over the top.
- **Saved assemblies belong to you, not to a bid.** They are on every bid on this
  device, and they sync if you are signed in.
- Components inherit the parent's type on the bid, carry no plan page of their
  own, and list individually on the purchase list while the price-less parent
  stays off it.
