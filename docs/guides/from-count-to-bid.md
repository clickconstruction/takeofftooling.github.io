# From count to bid

The count is done in Count Tooling. This is how it gets onto the bid — and how
it gets there again next week when the sheet is revised and half the numbers
have moved.

**The count's numbers are totals, not additions.** A line whose description
already exists on the bid is *set* to the count's number — up or down — and
takes the count's plan page. Its price and hours are left alone. Lines that
aren't on the bid yet are added. Bring the same count over twice and the second
time changes nothing.

## Bring the counts over

1. **Copy from Count Tooling.** Use its **Copy to /Tooling** button and pick the
   scope. What lands on your clipboard is one line per fixture —
   `fixture ⇥ count ⇥ page`. A signed-in Count Tooling user also gets a
   `View link:` footer line; Takeoff Tooling drops it rather than importing it as
   a fixture.

2. **Paste it.** **Paste from CountTooling.com** is the gold button in the
   header — the same one the *Start here* line points at on an empty bid. Click
   it and the preview opens.

   If your colleague sent you an `#import=` link instead, just open it. Same
   preview, whether the app was already up or not, and the long hash disappears
   from the address bar before the preview shows.

3. **Read the preview.** Your bid is on the left, the count on the right, with
   the difference spelled out per line.

   > **What you'll see:** `2x4 LED Troffer - A1 × 30 · was 24, +6 | E2.1` on a
   > fixture you already carry, `LED Wall Pack - WP1 × 7 · was 10, −3` on one the
   > count has dropped, a green **NEW** badge on anything you don't have yet, and
   > `· page FA1.1, was FA1.0` where the sheet has moved.

4. **Fix anything that arrived without a type.** A line the app couldn't type
   shows a dashed **Needs a type** picker right there in the list. Set it before
   the rows exist — it is one click here and two clicks after the import.

   A count the app can't read shows as **× ?** and is never guessed. A line
   starting `px of …` means the plan page was never scaled in Count Tooling, so
   the number is pixels, not feet — the preview says so.

5. **Press the primary button.** It names what it is about to do before you press
   it: **Add 3 fixtures** on an empty bid, **Update 1 count · add 1 fixture** on
   a re-count, **Update 1 count** when nothing is new, and **Nothing to change**
   (greyed out) when the count already matches the bid.

   > **What you'll see:** on a bid carrying 24 troffers at $89.50 and 0.75 hrs, a
   > re-count of 30 leaves the price and the hours alone and moves Lighting from
   > **$3,660.00** to **$4,197.00** (+6 × $89.50 = $537.00) and Lighting hours
   > from 36.00 to **40.50**.

6. **Check the totals, and Undo if it isn't what you meant.** The whole import is
   **one undo frame**, including the blank starter row it swallows on a first
   bid. One press puts everything back.

**Add as separate rows** is the other door, and it only appears when at least one
line already matched. It makes every line its own new row, duplicates included.
Use it when the count really is a second batch of the same fixture — a second
floor counted separately — and not otherwise.

## What arrives from Count Tooling

- Fixtures land with their count and plan page. Price and hours are yours to
  fill in — the import never touches them.
- `ft of …` lines become Conduit and Wire runs, with the footage as the quantity.
- The trade's own lighting names are typed correctly on the way in — troffers,
  downlights, exit signs, wall packs.
- The `View link:` footer from a signed-in Count Tooling user is dropped, not
  imported.

## The `#import=` contract

For anyone building the other side of this hand-off. The URL is
`<app>/#import=<base64 of a JSON payload>`, read at boot and on `hashchange`;
the hash is stripped from the address bar before the preview shows.

```
{ v: 1, source?: string, items: [{ description, count|quantity, page|planPage?, type? }] }
```

- **`v` must be the number 1**, pinned literally. Any other value is refused with
  a message naming the version it saw — it is not reported as an empty link.
- **`description`** — required, trimmed; blank items are dropped silently. It is
  the merge key: normalised as trim → lowercase → internal whitespace collapsed,
  the same key the purchase list merges on. `"2X4 led troffer - a1 "` and
  `"2x4  LED Troffer - A1"` both match `2x4 LED Troffer - A1`.
- **`count` or `quantity`** — a number or a numeric string. `$`, commas, quotes,
  spaces and a trailing unit are stripped (`"1,800"` → 1800, `"220 ft"` → 220).
  Anything else is *unreadable*: the preview shows `× ?`, a matched row keeps its
  count, and a new row lands at 0.
- **`page` or `planPage`** — optional free text. On a matched row it replaces a
  stale page.
- **`type`** — optional, compared **case-sensitively** against the app's own type
  list: `lighting gear devices conduit wire specialSystems permits
  powerCoCharges temporaryPower`. Anything else — including `Gear` or
  `receptacles` — falls back to inference from the description, and the
  estimator can correct it in the preview.
- A description starting `px of ` means the plan page was never scaled upstream;
  the preview flags it as pixels, not feet.
- Unreadable base64 or JSON → *This import link could not be loaded — it may be
  truncated or corrupted.*; a payload that isn't an object, or has no `items`
  array → *This import link did not carry any counts.*; an `items` array with
  nothing usable in it → *This import link contained no valid items.* Nothing is
  written to the bid in any of those cases, and each arrives as a toast, not a
  blocking dialog.

`source` is accepted and ignored — nothing on the bid records where a count came
from.

## Good to know

- **The preview owns the keyboard.** It opens with the primary button focused,
  Tab stays inside it, and Esc closes it without importing.
- Counts are totals in **both** directions. A count that dropped is shown as a
  drop (`was 10, −3`) and taken.
- A matched row keeps its type. If you typed a row Special Systems and the count
  says Lighting, your type wins — the count knows what was counted, you know what
  it is.
- Rows land at the bottom of the table, in the count's order.
- Bringing the same link over twice is safe: the second time the button reads
  **Nothing to change** and is disabled.
- Nothing about the import is cloud-dependent. It works signed out, offline, on a
  phone.
