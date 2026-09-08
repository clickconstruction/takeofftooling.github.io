# Delivering the bid

Three pieces of paper and one link. The paper is under **Print Options**, below
the summary; the link is in the same panel. The panel is hidden until a row has a
description — an empty bid has nothing to print.

Click **Print Options** and five things appear: three print buttons, then **Copy
share link**, then **Job details**.

## The three prints

1. **Print for review** — the bid as a second pair of eyes reads it. Page 1 is
   the summary the screen shows: materials by type, sales tax at the job's own
   rate, hours by type, the labor rate, other charges, the grand total — dollars
   and cents. Page 2 on is the line items: **Type · Description · Qty · Hrs each ·
   Hrs total · Price each · Price total · Plan page**, with components indented
   under their run, and a footer on every page reading
   `Labor TOTAL (hrs): …` on the left and `Grand Total: $…` on the right.

   > **What you'll see:** the same Labor TOTAL (hrs) the screen shows, printed to
   > two decimals, so 3,000 ft of wire at 0.006 hrs/ft prints **0.01** each and
   > **18.00** extended — never 0.0. Types print as labels — `POWER CO. CHARGES`,
   > `Box` — not internal keys.

2. **Print purchase list (PO)** — the purchase list on paper, the same merged
   report the screen shows. **Qty · Material · Unit $ · Extended $**, the
   **Materials total (before tax)**, the job name, the date, and a count of
   anything still without a price. Grouping rows, permits, power-company charges
   and site work are all off it: the supply house gets only what it can quote.

   > **What you'll see:** a meta line under the job name reading
   > `15 materials · 1 without a price`, the same **Materials total (before tax)**
   > as the screen, and underneath it
   > `1 without a price — not in the total.`

3. **Print with form** — the line items with the job's own details printed under
   the project name on page 1: **Client**, **Address**, **Permit no.**, **Builder
   or occupant**, **Due date**. They print at the top, above the items, not as a
   footer after the last row. A bid with none of them filled in still prints.

**Job details** is the collapsed row at the foot of the panel. Open it, type
what you have, and it stays with that bid — through a reload, through a project
switch, and onto a copy someone opens from your link. All five are optional and
nothing asks for them before you type the first fixture.

## Copy the purchase list into a spreadsheet

Press **Generate purchase list (PO)** under the summary, then **Copy**. The
clipboard gets tab-separated text — a header row, the merged materials, and a
TOTAL row — which pastes straight into Excel or Sheets. No dollar signs in the
cells, so the columns add up as numbers.

## Send someone the bid

**Copy share link**, under Print Options, puts a link on your clipboard.

1. Press it. A message says *"Share link copied — anyone who opens it gets their
   own copy at these numbers."*
2. Paste it into a text, an email, or a chat.
3. They open it. There is nothing to sign into.

The link carries the whole bid — every run and every component — plus **the labor
rate, the sales tax rate and the job details**, so the two of you read the same
grand total.

> **What you'll see on their end:** a copy of your bid in its own project, at your
> rate, above a line reading *"Copy of Northgate Retail, shared Sep 6 by link —
> edits stay on this device."* The date is the day you copied the link, not the
> day they opened it.

Two things to say out loud when you send it:

- **They get a copy.** Their edits do not come back to you, and yours do not go to
  them. If the number changes, send a new link.
- **The link is the bid.** Nothing is stored on a server — the part after the `#`
  never leaves the browser — so it works offline and there is no account to
  create. It is also long: about 320 characters per line, so a 300-line bid is
  around 95 kB of URL.

That length is the one thing that goes wrong. Some text messengers and mail
clients wrap or cut long links. If yours is cut, the app says so instead of
opening half a bid:

> **What you'll see:** *"That share link could not be opened — it may be truncated
> or corrupted."* If they see that — or if nothing opens at all — send the link
> again from a desktop mail client, or send the Review PDF instead.

If they open the same link twice, they get the one copy back, not two identical
bids. A link you copy again later, after more work on the bid, is a new bid on
their side and comes in beside the first.

## Good to know

- Every PDF is named after the job and the day:
  `northgate-retail-purchase-list-2026-09-07.pdf`. Slashes and colons in a job
  name are stripped, so `Bldg 3/4: North wing` becomes `bldg-3-4-north-wing-…`.
- The three prints are three different documents, not three views of one: Review
  has the totals, PO has the prices a counter needs, the form has the job's
  header details. Send the one the reader asked for.
- Job details ride the share link but nothing else about your account does — no
  book, no other bids, no email address.
- A link whose payload arrives with no rows says so — *"That share link carried no
  takeoff rows — ask the sender to copy the link again."* — rather than silently
  doing nothing.
- The printed labor total is the screen's labor total by construction, including
  hours typed on permit and power-company rows.
- Nothing on this route changes the bid. Printing and copying are reads.
