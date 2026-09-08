# J<N> — <Title in trade language>

Personas: <letters> · Status: ☐ not started / ◐ dossier drafted / ● walked <date> (<how: browser, server, signed in/out, seed>)

> Trigger — what just happened in the estimator's world that sends them down this route.
> One or two sentences; the reason this journey exists.

## Entry points

- **<surface>** — `#element` "<label>" → what it opens/does (click / keypress / hash / automatic)
- …every way in, including the ones the docs don't mention

## Current route (walked <date>)

Happy path: **N steps, M decisions.** Then the numbered steps as actually driven, each
with what the screen showed, screenshots as `![alt](img/<slug>-NN.png)`.

1. …
2. …

Divergences from the documented route (README / CLAUDE.md / ARCHITECTURE.md):

- …

## Naive attempt

A first-timer's discovery path before reading anything: where they looked, what they
clicked on faith, where they hesitated, dead ends. Written in the first person, past tense.

## Evidence

- **Telemetry visibility:** none exists in Takeoff Tooling yet — state that plainly, and
  name the event(s) a rework on this route should ship with.
- **Doc coverage:** README.md sections / CLAUDE.md / ARCHITECTURE.md lines that describe
  this route, and what they get wrong.
- **Specs:** `*.spec.js` / `*.test.js` that exercise any step; steps with no coverage.
- **Modals:** which of the 11 open on this route.
- **Hotkeys:** which apply.
- **Storage / state touched:** keys written, undo frames pushed, cloud pushes triggered.

## Friction findings

| # | Severity | What happens | Why it hurts | Verdict stamp (Phase 2b) |
|---|---|---|---|---|
| 1 | blocker / stumble / papercut | exact behavior, with numbers | the estimator's cost | CONFIRMED / downgraded / killed — evidence |

Numbers matter: this app's failure mode is a wrong dollar figure that looks right.
Record the value shown *and* the value that should have shown.

## Proposals

For each: **verdict** (keep / polish / rework / teach / hide / gap), the change, and the
four spirit-test answers — (1) steps or decisions removed, (2) trade words used,
(3) what it removes or makes unnecessary, (4) how a guide-less electrician finds it.
`spiritPass: true|false` with the verifier's caveat.

## Guide actions

What the first guide article for this journey must carry (Phase 5 backlog — no guides
exist yet), and any README row to add or fix.

## Demo moment

The ≤10-second thing that sells this journey. One sentence, plus which screenshot shows it.

## Walk notes

Server, port, profile state, seed data, what was stubbed (cloud is production — never
write to it from a walk), and anything the verifier should re-drive first.
