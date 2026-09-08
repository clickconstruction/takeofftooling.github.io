# Takeoff Tooling guides

Short, trade-language articles that follow the fourteen journeys in
[docs/JOURNEY-MAP.md](../JOURNEY-MAP.md). Each one walks a real route through the app with
the numbers you will actually see, then ends with a **Good to know** list of the design facts
behind it. Read them in order the first week; after that, jump to the one you need.

## Building a bid

1. [Your first bid in five minutes](your-first-bid.md) — type a fixture, give it a type, price it, set the rate, read the total.
2. [From count to bid](from-count-to-bid.md) — pasting counts from Count Tooling, what the preview's "Update 1 count · add 2 fixtures" means, and the `#import=` link contract for the people on the other side of it.
3. [Shaping the bid](shaping-the-bid.md) — types, components, removing rows, and exactly what Undo covers.
4. [Parts under a device run](parts-under-a-device-run.md) — the devices editor: component quantities are totals for the whole line, filling rows from the book, saving a run as a recipe.
5. [Conduit and wire runs](conduit-runs.md) — trench, fittings and waste; the wizard writes to the bid only when you press Save.
6. [Finding a part](finding-a-part.md) — the three lists (your book, MC assemblies, the supply house), what Add does under a fixture versus under a run, and how to read the MC tree.

## Pricing, checking and delivering

7. [Recording a quote](recording-a-quote.md) — the price pill is the door; supplier, price, date; the freshness colours; what "In use" means.
8. [Checking the bid before it goes out](checking-the-bid.md) — where every number in the totals comes from, the purchase list, sales tax, site work and rentals.
9. [Delivering the bid](delivering-the-bid.md) — the three prints, the job details, and sending someone the bid by link.

## Running the office

10. [Running several bids](running-several-bids.md) — create, switch, rename, duplicate as a template, archive, delete.
11. [Saving, signing in, and two computers](saving-and-signing-in.md) — there is no Save button; what signing in is for; what syncs and what wins; offline and installing.
12. [Fix a number once, fix it for everyone](sharing-fixes-to-the-book.md) — sharing corrections to the book: what leaves the machine, how to withdraw, how fixes come back.
13. [Loading the supply house's price file](loading-supplier-prices.md) — admins: the price update, the review list, and the hand-off to the site maintainer.
14. [Letting a new estimator in](letting-an-estimator-in.md) — admins: the emailed-code sign-in is self-serve; Manage users is for roles.
15. [On a tablet or a phone](on-a-tablet-or-phone.md) — cards below 900 px, the book on a phone, the pinned Save bar, working offline.

Behaviour these articles describe is pinned by the Playwright specs at the repo root
(`*.spec.js`); when the app and a guide disagree, the spec is the tie-breaker and the guide
is the thing to fix.
