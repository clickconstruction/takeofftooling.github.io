# Conduit and wire runs

A 220 ft homerun from Panel A to the RTU at $0.68 a foot is one line on the bid.
Part of it goes underground, so it needs a trench, a backhoe, some sand, a
handful of fittings and 10–12% waste. That all lives in the run's own editor.

## Open the wizard

The **pencil** on a row's **Conduit** chip opens it, or press `C` in the type
picker and you are already there. Wire runs work the same way with `W`.

The conduit editor is three steps — **Trenching → Fittings → Overage** — with
clickable pills across the top. **Next, Back and the pills are navigation and
nothing else. Only Save writes to the bid**, in one batch, so Cancel on any step
really cancels and the whole run costs one undo step. Cancel is on every step.

## Step 1 — the trench

1. **Use Quick Add if the trench is standard.** Seven presets —
   *Dirt to 24in $15*, *Dirt to 36in $30*, *Rock to 24in $150*,
   *Asphalt/Concrete to 36in $250* and the rest. One click fills the material,
   the depth, the price per foot **and the footage**, taken from the run itself.

   > **What you'll see:** on a 220 ft run, *Dirt to 24in - $15.00* fills
   > 220 / Dirt / 24in / 15 — $3,300.00 of trenching.

2. **Or type it.** Quantity (feet of trenching), material to dig through, depth,
   price per foot. Leave all four blank and no trenching line is written at all.

3. **Add the equipment and the fill.** Two groups of buttons, because they are
   priced in different units and taxed differently.

   - **Rentals** — BACKHOE, SAW CUTTING, DRILLING, HAUL-OFF, MANLIFT. Priced
     *hours or days × rate*.
   - **Fill & site** — ASPHALT PATCH, TRENCHING SAND, POLE BASES, CONCRETE PADS,
     MANHOLES. Priced *quantity × unit price*.

   Each group gets its own table, with its own column heads, as soon as it holds
   a row. Both tables have an *Additional labor (hrs)* column — those hours land
   in the run's labor.

   > **What you'll see:** BACKHOE at 4 hours × $350 is **$1,400.00**; TRENCHING
   > SAND at 10 × $24.00 is **$240.00**. On the bid they land in different
   > places: the trench and the backhoe under **Site work & rentals** in OTHER
   > CHARGES — untaxed, and off the purchase list, because nobody orders a
   > backhoe from the supply house — while the sand is real stock, taxed and on
   > the list.

## Step 2 — fittings

1. **Pick from the list.** *Select from list* holds the presets in
   `js/data/fittings.js` — 90° Elbow, 45° Elbow, Coupling, Connector, LB and T
   conduit bodies. Picking one **fills the blank row you are looking at** rather
   than landing under it. The presets carry a name only; the hours and the price
   are yours.

2. **Or fill the row from the book.** The **Book** button on any fitting row
   opens the Labor & Price Book pointed at that row, with the search box focused.
   The entry you pick replaces the row's description, hours and price, and lands
   at quantity 1 — set the count yourself, because a run's quantity is footage,
   not a number of couplings.

3. **Add Fitting Row** for the next one; the trash on a row removes it.

   > **What you'll see:** four 90° elbows at 0.15 hrs / $3.25 add **$13.00** and
   > **0.60 hrs** to the run.

## Step 3 — overage

The waste footage you buy with the run. Four preset buttons — 5%, 10%, 15%,
20% — and a box for anything else. The one you press stays lit until you type a
different number.

> **What you'll see:** on 220 ft, typing 12 gives *220 + 27 additional = 247
> total* as you type — 26.4 ft rounded **up** to 27 — and 27 × $0.68 =
> **$18.36** on the bid.

Overage is bought at the run's own price per foot and carries **no labor** — you
are buying material, not pulling it. There is one overage line per run: change
the percentage and Save and it is replaced, never duplicated. Clear the
percentage and it goes away.

Press **Save and Back to Manifest** and everything from all three steps lands
together.

## Wire runs

The wire editor is one page: the same overage section, plus a **MAC Adapters**
table with Description, Quantity, Labor and **Price** — same columns as conduit
fittings, and the same **Book** button on every row.

> **What you'll see:** 4,500 ft of #12 THHN at $0.18 with 10% overage reads
> *4500 + 450 additional = 4950 total*, and the bid's **Wire** line goes from
> **$810.00** to **$891.00**.

Search the book for **mac adapter** and you will find the MC connectors — the
book writes them "MC CONN" and the search knows both spellings.

## When the run's length changes

Change a run's footage or its price per foot on the bid table and **the overage
line follows**: 220 ft at 20% becomes 300 ft at 20% = 60 ft the moment you type
the 300, priced at whatever the run now costs per foot. You do not have to
re-open the editor.

Type over the overage line's own quantity and you have taken it over by hand:
it relabels itself *(manual)* and stops recomputing, so your number stays. The
same goes for the trench line — correct its footage or its price on the table and
re-opening the wizard shows your correction, not the old one.

## Good to know

- **Nothing is on the bid until Save.** Cancel, the app's name, and Undo all ask
  first if you have typed anything, and Cancel keeps your work.
- **One run, one undo step.** Trench, add-ons, fittings and overage all land in
  the same frame.
- **Re-opening a run lands on the step it can infer** — a run that already has an
  overage line opens on Overage. The pills take you anywhere; nothing is
  committed by moving between them.
- **The header says the run's length once, with its unit** — *Length: 220 ft* —
  on every step.
- **A supplier's four-decimal price reads the way it reads everywhere else**:
  $58.4697 shows as `58.47`, and a part under a dollar keeps four places so a
  $0.1334 fitting is not rounded away.
- **The trench line is a sub-contract, and a rental is hired.** Neither is stock,
  so neither is taxed and neither is on the purchase list — but their hours still
  count in the run's labor.
- Number boxes ask your phone for the decimal keypad, and the flow's action
  buttons sit at the bottom of the screen on a narrow one.
