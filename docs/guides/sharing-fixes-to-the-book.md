# Fix a number once, fix it for everyone

The Labor & Price Book ships with a set of labor hours and prices. When your crew
knows better — a 12-circuit 1PH panel is 8.5 hours on this crew, not 8 — you can
fix it in your own book and stop there, or you can offer the fix back so the book
everyone starts from gets more accurate.

Offering it back is opt-in, off by default, and reversible.

## Turn it on

You need to be signed in; there is nothing to share from a signed-out browser.

1. Click **✓ Cloud** in the header.
2. Find **Improve the shared book** in the dialog and switch it **On**.

The line under it says exactly what the deal is:

> *Share your price and labor corrections so the shared parts book gets more
> accurate for everyone. Only book edits are shared — never your takeoffs or job
> data.*
>
> *Your sign-in email (you@yourshop.com) goes with each correction, so we can ask
> you about it.*

## What counts as a correction

Anything in your book that differs from what the app shipped:

- **an edit** — you changed the hours or the price on a row that came with the
  app;
- **a new part** — you added a row that was not in the book (its part number goes
  with it, if it has one);
- **a removed part** — you deleted a row the app shipped.

Nothing else. A row you typed and then typed back to the shipped numbers stops
being a correction; so does a row you deleted and then added back at the shipped
values. Quotes you record on the part card are yours — the supplier names, the
dates and the history stay on your machine.

## What leaves this computer

Per correction, one line: the tab, the section, the part name, whether it is an
edit / a new part / a removal, and the old and new hours and price. Plus **your
sign-in email**, so a reviewer can ask you about it.

Nothing about a bid ever goes with it: no job name, no client, no quantities, no
totals. Not in a correction, and not by any other route on this screen.

## See exactly what you sent

With the toggle on, the dialog shows **N corrections shared · see what's
shared**. Open it and each line reads as the book reads, plus where it stands:

> **What you'll see:** `12 · Gear · Panels · 1PH · 8 hrs → 8.5 hrs · $450.00 ·
> waiting for review` — the part name, where it lives, what moved, and where it
> stands. A row with no price says nothing about price rather than `$—`.

The last word is one of five:

| It says | It means |
|---|---|
| **waiting for review** | sent, nobody has looked yet |
| **accepted** | a reviewer agreed with you |
| **in the shared book** | it shipped — it is in the app now |
| **not adopted** | a reviewer disagreed, or it did not apply generally |
| **not sent yet** | it's a correction here that hasn't reached the cloud |

Rows you are sharing are marked in the book itself: a small **shared** chip beside
the hours on that row.

## Withdraw

Switch **Improve the shared book** back to **Off**. Every correction you shared is
deleted, all of them, immediately.

The setting belongs to your **account**, not to this browser — it reads the same
on every machine you sign in on, and you can turn it off from any of them.
Signing out resets it, so the next person to sign in on a shared computer starts
at Off and shares nothing until they say so themselves.

Undoing one correction is the same move as making it: type the row back to the
shipped numbers, and that one line is pruned from what you're sharing the next
time the app syncs.

## When a fix comes back

Accepted corrections ship to everyone as part of an app update — a commit and a
deploy, not a live push — so expect days, not minutes. When the update reaches
your browser, your book merges it:

- **rows you never touched** take the new number;
- **rows you edited, added or deleted are left alone** — your book wins, always;
- and you are told which rows moved.

> **What you'll see:** a line under the header reading *"The shared parts book was
> updated — 3 parts you had not changed: 1/2" EMT strap, 3/4" EMT connector, 12
> THHN CU"*, with a Dismiss button. A book already up to date says nothing.

That is the whole loop: your 8.5 becomes everybody's 8.5, and the parts you know
better than the book stay yours.

## Good to know

- Every estimator has this toggle. It is not an admin feature — the admin side is
  the review queue, which only admins see.
- The toggle is off for a brand-new account, and off for you until you turn it on.
- A price the app cannot read as money is never shared: if the row reads red, it
  goes out as no price at all rather than as text.
- Corrections are keyed by part name within a section, so renaming a row reads as
  "removed the old one, added a new one".
- Nothing here is covered by Undo — book edits never were. The way back is to
  type the number you want.
- Sharing has no effect on your bids, your assemblies, or anyone else's book
  until a reviewer accepts and the change ships.
