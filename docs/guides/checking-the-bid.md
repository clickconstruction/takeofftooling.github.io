# Checking the bid before it goes out

The takeoff is done and the bid leaves in an hour. This is the pass where you
read every figure against a calculator, find anything nobody priced, and make
sure the order you send the supply house says the same thing your total does.

Everything you need is under the table: the summary, the labor rate, the sales
tax rate, and the purchase list.

## Read the summary

The summary appears under the manifest as soon as a row has a description, in
three panels — **MATERIALS**, **LABOR**, **OTHER CHARGES** — with the Grand Total
underneath. It moves as you type; there is nothing to press.

1. **Materials, by type.** Each bucket is quantity × price, added up for every
   row of that type — plus every component underneath those rows. A part you
   added under a fixture is counted in the fixture's bucket, not in a bucket of
   its own.

   > **What you'll see:** Lighting at 24 × $89.50 plus 36 × $42.00 reads
   > **$3,660.00**. Money carries thousands separators, so a five-figure bucket
   > is readable at a glance.

2. **Sub Total, Sales tax, Materials TOTAL.** The tax rate is the job's own —
   type it in the **Sales tax (%)** box beside the labor rate. A new bid starts at
   8.5%, and the rate is saved with the bid.

   > **What you'll see:** set the box to `10.25` on $1,000 of gear and Sales tax
   > reads **$102.50** with Materials TOTAL at **$1,102.50**. Reload the bid and
   > the rate is still 10.25.

3. **Labor.** Hours by type, then **Labor TOTAL (hrs)**, the **Labor Rate ($/Hr)**
   box, and the dollars. A run's hours are the run's own hours *plus* every
   component's hours — this is the number people re-derive on a calculator and
   get wrong.

   > **What you'll see:** a 15-run switch line at 0.35 hrs each is 5.25 hrs; its
   > switch, box and plate components add 6.0 more. The Devices cell reads
   > **11.30 · runs 5.30 + parts 6.00** — the split is printed in the cell, so
   > there is nothing left to hunt for. A type with hours on one side only shows
   > the bare number.

4. **Other charges.** `PERMITS`, `POWER CO. CHARGES`, `TEMPORARY POWER`, and
   **Site work & rentals** — a trenching line and anything from a conduit run's
   **Rentals** group (backhoe, saw cutting, haul-off). Site work is hired work,
   not stock: it is not taxed and it is not on the purchase list, because nobody
   orders a backhoe from the supply house. Its hours still count in the run's
   labor. Fill materials — sand, asphalt patch, pole bases — are real stock and
   stay in Materials.

   > **What you'll see:** $3,300 of trenching plus a $1,400 backhoe reads
   > **$4,700.00** under Other charges, while the 220 ft of pipe and $240 of
   > trenching sand read **$460.00** of conduit material and draw **$39.10** of
   > tax at 8.5%.

5. **Hours typed on a permit row** still count. They bill under Other charges and
   show on the labor panel's **Other** line, so the hours and the dollars beside
   them always agree.

   > **What you'll see:** a panel at 6.5 hrs and a permit carrying 3 hrs gives
   > Other **3.00** and Labor TOTAL **9.50** — the same 9.5 the Review PDF prints.

## Read the purchase list

**Generate purchase list (PO)**, under the summary, turns the job's material into
lines a counter can pull. It stays in step with the bid while you correct it —
edit a quantity with the list open and the list moves with the summary.

- Columns are **Qty · Material · Unit $ · Extended $**, and the foot reads
  **Materials total (before tax)**. Before tax, because the supply house quotes
  material and adds their own tax.
- The materials total equals the summary's Sub Total to the cent.
- Identical descriptions merge into one line. If the same material sits on the
  bid at two prices, Unit $ shows the range and Extended $ is still exact.

  > **What you'll see:** two panels at $1,100 and $1,250 read
  > `2 · Panel LP-2 · $1,100.00–$1,250.00 · $2,350.00`.

- A run's overage is bought with the run, so it is one line, not two.

  > **What you'll see:** 220 ft of pipe with 10% waste reads
  > `242 · 3/4" EMT Homerun (incl. 10% overage)`.

- Grouping rows (a device run that carries no price of its own), permits, power
  company charges and site work are all left off — the supply house only gets
  what it can quote.
- **n without a price** counts the lines whose price is blank. Those rows are
  greyed with a dash in both money columns, and they are exactly what to price
  before you send.

  > **What you'll see:** an owner-furnished panel typed at 0 reads
  > `$0.00 · $0.00` and is **not** counted as missing; a disconnect with an empty
  > price reads `— · —` and the meta line says **1 without a price**.

- **Copy** puts the same rows on the clipboard as tab-separated text — header,
  lines, and a TOTAL row — which pastes straight into a spreadsheet. It tells you
  how many lines it took.

## Good to know

- Every figure in the summary explains itself on hover: *"Materials sub total ×
  the sales tax rate above"*, *"Labor total hours × the labor rate"*,
  *"Trenching and rentals: hired work, so it is not taxed and not on the purchase
  list"*.

- A row at quantity 0 is none of it: no material, no hours, no purchase line. Its
  quantity greys out so the zero reads as deliberate. Spinning a row to 0 is a
  clean what-if.
- A price, an hours figure, a quantity or a rate typed below zero is corrected to
  0 when you leave the field, and the field marks itself so you can see it
  happened.
- Hours print to two decimals and money to the cent, both from one formatter, so
  86.25 hrs never prints as 86.3 beside dollars calculated from 86.25.
- The labor rate is per bid. A new bid starts from the rate on the bid you were
  in; a bid that arrives by share link opens at the sender's rate.
- The summary is hidden until a row has a description — an empty bid has nothing
  to total.
- Undo covers the bid, 50 steps deep, and refreshes the purchase list with it.
