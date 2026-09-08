# Known-and-fixed baseline — 2026-09-06

Two interactive passes ran the same day the journey frame was written: a pre-alpha punch
list (A/B/C series, 30 findings) and a UX-map walk (N series, 9 findings). **All 39 are
fixed and were re-verified live.** A/B/C landed on `main` in PR #1 (`fda00e5`); the N
series sits on the review branch pending commit. Phase 2 walkers: **confirm these hold,
don't re-report them.** If one has regressed, that is a finding — cite the ID.

Journey letters point at where each would surface.

## A — were blocker-grade (wrong numbers, blocked entry, wrong visibility)

| ID | Was | Fixed by | Journeys |
|---|---|---|---|
| A-1 | Purchase list dropped any parent with children (the EMT footage, a panel with a coupling) — disagreed with the summary by thousands | `getPurchaseList` emits a parent's own line when it carries a price; price-less parents stay groupings | J8 |
| A-2 | Conduit/wire overage children had no price or labor — 10% overage added $0 | Overage inherits the run's unit price (labor stays 0: waste is bought, not installed) | J5 J8 |
| A-3 | "Add Overages Only" silently dropped quantity increases | Raises an existing item to the import's count when higher; new items add | J2 |
| A-4 | Search was whole-phrase substring — "3/4 EMT coupling" found nothing | Per-token, any order, inch marks normalized (`TakeoffUtils.makeTokenMatcher`), used by every search/filter path | J6 |
| A-5 | Review suggestions / Manage users visible signed out (`display:flex` beat `[hidden]`) | `.header-menu-item[hidden]` and `.btn[hidden]` rules | J13 |
| A-6 | Tablet (641–900px): Price half-clipped, Plan Page behind an invisible scroll | Card layout now applies below 900px; styled scrollbar on the strip | J14 |
| A-7 | Phone: flow tables overflowed the page, qty input crushed to 15px | Flow tables scroll in their own strips (min 560px under 640px) | J14 |

## B — were should-fix (friction on the daily path)

| ID | Was | Fixed by | Journeys |
|---|---|---|---|
| B-1 | Flow editors hugged the left edge at 700px | Centered; devices flow two columns ≥1200px | J4 J5 |
| B-2 | "Edit in flow" hidden inside the type chip | Pencil icon on flow chips | J3 J4 J5 |
| B-3 | No Cancel in devices flow; leaving via the title silently discarded edits | Dirty flag + "Discard unsaved changes?" on every exit; devices Cancel | J4 J5 |
| B-4 | Devices "Cumulative Child" counted blank rows, summed per-unit, updated only on blur | Meaningful rows, extended math, live on keystroke | J4 |
| B-5 | One expanded supplier section = ~72k DOM nodes | 100-row cap + "Show all N parts" | J6 |
| B-6 | Blank starter row leaked into the fixture picker and import preview | Description-less rows excluded | J2 J6 |
| B-7 | Trenching quick-add left footage at 0 | Prefills from the run's length | J5 |
| B-8 | Recording a quote collapsed the section you were in | Open sections/groups/supplier blocks survive re-renders | J7 |
| B-9 | Part card titled just "6" | Trail: "Gear · Panels · 1PH" | J7 |
| B-10 | Update Supplier Prices shipped to every user | Admin/dev-gated | J13 |
| B-11 | Parent labor + child labor both count, invisibly | Flow shows "Job labor: parent 3.6 + components 6.0 = 9.6 hrs" | J4 J8 |
| B-12 | Assembly BOM showed $0.0000 components and a bogus computed price | "N of M components unpriced — using the book price" | J6 |

## C — were polish

| ID | Was | Fixed by | Journeys |
|---|---|---|---|
| C-1 | `$2.6912399999999996/ea` in the review queue | 2 decimals ≥$1, 4 below | J13 |
| C-2 | "no date" badge on every unpriced row | Quiet dashed "+ price" affordance | J7 |
| C-3 | Unstyled Remove button (wire) and blue progress bar | Trash icon; accent-color | J5 J13 |
| C-4 | "1 matches"; "First 100 matches" with no total | Pluralized; "First 100 of N matches" | J6 |
| C-5 | Type modal had no visible way out | Cancel button | J3 |
| C-6 | New Project used `prompt()` | Inline name field in Manage Projects | J10 |
| C-7 | Fitting "select from list" appended below the blank row | *(not changed — folded into J5's walk as an observation)* | J5 |
| C-8 | Import preview showed no delta | "× 34 · now 30, +4" / "already 6 — no change" | J2 |
| C-9 | "Junk" MC categories in the assemblies tree | Misdiagnosed: real adjustment units / TI budget rates / grounding — now labeled with a note | J6 |
| C-10 | Sign-in modal silent on account creation | Copy: the emailed code creates your account | J11 |
| C-11 | Header buttons clipped at 375px; fixture picker overflowed | Tighter padding; picker flexes | J14 |

## N — from the UX-map walk (same day)

| ID | Was | Fixed by | Journeys |
|---|---|---|---|
| N-1 | Search didn't know supplier abbreviations ("receptacle" vs RECP) | 60 synonym groups on the token matcher, both directions, plurals | J6 |
| N-2 | Fill banner leaked `outletsAndSwitches` | Complete section-label map | J4 J6 |
| N-3 | Shared link imported under the identical project name | "(shared Sep 6)" suffix | J9 J10 |
| N-4 | Pasting a share link into an already-open tab did nothing | Hash route runs on `hashchange` too (asks first if a flow is dirty) | J9 |
| N-5 | Three `prompt()`s remained (Save as Assembly, Add Section, Rename) | All inline fields | J4 J6 J10 |
| N-6 | Assembly card price summed unit prices | Extended qty × unit | J4 |
| N-7 | First run had no "start here"; zeroed summary dominated | Hint line; summary hidden until a described row | J1 |
| N-8 | Custom overage % lost focus after one digit | Total line patched in place, no re-render | J5 |
| N-9 | A project created at runtime had no rows at all | `createProject` seeds one blank row | J10 J1 |

## Still true (not findings — design facts walkers should know)

- Conduit wizard commits children at **each step transition**; Back does not undo them.
- Undo/redo covers the manifest only — book edits, assemblies, labor rate are not undoable.
- Rows nest two levels deep only; the app never creates grandchildren.
- The app must keep working fully signed out; cloud is a mirror, last-write-wins by `savedAt`.
- PDF downloads and two-device sync could not be exercised in the review sandbox — those remain manual checks (J9, J11).

## 2026-09-07 — program executed

The ranked shortlist this baseline fed into has shipped: all 26 Tier-1 rows, 21 Tier-2 rows,
14 Tier-3 batches, 13 Tier-4 guide articles and 14 of the 17 Tier-5 gaps, with three
deliberate deferrals (X5, X7, X14). Several "still true" facts above are no longer true —
the conduit wizard now writes only on Save, and the trash is on every row — so read that
list against the code, not as current. The dated summary, the gate numbers and the owner
decisions taken along the way are in the **STATUS 2026-09-07 (evening)** block at the top of
[../JOURNEY-MAP.md](../JOURNEY-MAP.md); per-row status is in
[_shortlist.json](_shortlist.json)'s new `status` / `statusNote` keys.
