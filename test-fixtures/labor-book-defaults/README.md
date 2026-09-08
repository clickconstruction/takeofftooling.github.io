# Shipped labor-book defaults, as they were

Byte-for-byte copies of `js/data/laborBookDefaults.js` at each version that
ever reached a browser, so `laborBookMerge.test.js` can prove a book saved at
any of them converges on the current defaults through `mergeDefaults` with no
phantom corrections.

| File | Version | Where it shipped |
|---|---|---|
| `v2.js` | 2 | the pre-branch book (two conduit rows both named "PVC GLUE") |
| `v3-main.js` | 3 | main: PVC GLUE QUART / PINT rename + curated Devices / Lighting / Special Systems starters |
| `v4-ours.js` | 4 | the journey-map branch: PVC GLUE collapsed to one row + 141 X6 device / cable / connector rows (v3-ours is this file minus the X6 sections; the test derives it) |

Do not edit these. Add a new file when a defaults version ships, never
rewrite an old one.
