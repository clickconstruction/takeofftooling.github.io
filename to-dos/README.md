# To-dos

Work that was designed, discussed or partly built but cannot be finished in the session that
started it. Any editor — a person or an agent session — should be able to pick one up cold.

Each to-do is one folder or file here. It leaves enough behind that the next session does not
re-derive the decision:

- **The ask, in the owner's words** — what was wanted and why.
- **The decision** — what was picked, what was rejected, any open questions.
- **The spec or mock-up** — kept here (an `.html` next to the `.md`), not only on a chat link.
- **Where it plugs in** — the files, specs, tables and functions already involved.
- **How to verify** — the live-test recipe, test data, and the gotchas hit along the way.
- **State** — a `Status:` line at the top (`not started` · `in progress` · `blocked on …` ·
  `shipped, delete me`).

When you pick one up, put your branch name on the `Status:` line. When it ships, delete the
folder in the same PR — the record is the commit.

| To-do | Status | Summary |
|---|---|---|
| [`alpha-test-script/`](./alpha-test-script/README.md) | not started · script ready 2026-09-14, nobody has run it | The hand-to-a-tester script for the pre-alpha build: 28 checks in seven rounds with the exact figures to compare, the deliberate changes not to file, and the one known pair. The only open loop of the September journey-map program. |
