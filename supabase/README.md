# Supabase migrations (Takeoff Tooling test instance)

SQL to apply on the app's Supabase project (`awjcdxqhvgnqsrlnoyxr`). Earlier
schema (the `takeoff_store` and `takeoff_suggestions` tables and their RLS)
was created directly from the dashboard before this folder existed; new
schema lands here as numbered files.

**To apply:** Supabase Dashboard → SQL Editor → paste the entire file →
Run. Apply files in filename order.

## Apply before deploy

The five things to do on the Supabase side before this build goes out. The app
works without every one of them — that is deliberate, and each row says what
stays dormant until it is done. This is the only list; the tables below carry
the detail behind each row.

- [ ] **`005_takeoff_project_upsert.sql`** — SQL Editor. Without it, project
      sync falls back to read-compare-then-upsert: the same decisions, but not
      atomic, so two devices saving one bid can race.
- [ ] **`004_takeoff_events.sql`** — SQL Editor. Without it no telemetry is
      recorded at all: `js/events.js` posts once, reads the 404 / `42P01`, and
      stays silent for the session.
- [ ] **Redeploy the `takeoff-admin` Edge Function** —
      `supabase functions deploy takeoff-admin --project-ref awjcdxqhvgnqsrlnoyxr --use-api`.
      Manage Users (create / delete accounts) calls it; it must be running the
      current `supabase/functions/takeoff-admin/index.ts`.
- [ ] **Auth → URL Configuration → Redirect URLs** — add
      `https://takeofftooling.github.io/` and every dev origin you use
      (`http://localhost:4173/`). Without it "Forgot your password?" silently
      sends people to the Site URL and the new-password form never appears.
- [ ] **Auth → Email Templates → Reset Password** — leave it as the default
      link template (`{{ .ConfirmationURL }}`). The app expects a link back to
      itself, not a code. (The **Magic Link / OTP** template is the separate one
      that is edited to send `{{ .Token }}`.)

`001` is recorded below as applied (2026-08-17). `002` carries no applied date
here — check the dashboard for a `takeoff_profiles` table before assuming roles
are live.

| File | What |
|---|---|
| `006_takeoff_twins.sql` | **Digital twins — the TakeoffTooling seat** (PipeTooling `docs/DIGITAL_TWINS_PLAN.md` Phase E, mirrored from CountTooling): `takeoff_profiles.is_digital_twin`; `twin_credentials` (sha256 hashes of PipeTooling's per-twin tokens, service-role only); an expression index on `takeoff_projects (user_id, data->>'externalRef')` — the bid stamp (`externalRef`), review lane (`reviewStatus`, `reviewNote`, `reviewRequestedAt`, `reviewedAt`) and `agentImport` live inside `data` like every other project field; `takeoff_list_users` returns the twin flag. The twin functions below need it. |
| `003_takeoff_layout_suggestions.sql` | Shared Organize Categories layouts: one row per consenting user (their group config + section order), RLS owner-managed with admin review via `is_takeoff_admin()`. Until applied, the app detects the missing table and skips layout sharing; corrections sharing is unaffected. |
| `002_takeoff_profiles.sql` | Roles (`user` < `admin` < `dev`): profile table + signup trigger (seed emails get their roles automatically: robert@douglasmining.com → dev, stephen@pipetexas.com → admin), `takeoff_role()`/`is_takeoff_admin()` helpers (the latter replaces the old email-match version), and the dev-only RPCs `takeoff_list_users` / `takeoff_set_user_role`. Pairs with the `takeoff-admin` Edge Function (`supabase/functions/takeoff-admin/`, deployed via `supabase functions deploy takeoff-admin --project-ref awjcdxqhvgnqsrlnoyxr --use-api`) which creates/deletes accounts for dev callers. |
| `001_takeoff_projects.sql` | **Applied 2026-08-17.** Per-user project rows (schema-aligned with Count Tooling's `projects` table for the future merge). Until applied, project cloud sync is dormant — the app detects the missing table, keeps projects local-only, and logs a console note. Book/assemblies sync via `takeoff_store` is unaffected. |
| `004_takeoff_events.sql` | *(on the checklist above.)* `takeoff_events` — product telemetry: an event name, a small jsonb props bag (counts, booleans, short enums), the viewport width, whether the pointer is coarse, an anonymous per-install id, and a `user_id` only when the sender was signed in. RLS: insert for anon **and** authenticated (the app must keep working signed out) with a CHECK that the row is anonymous or the caller's own; select for the `dev` role via 002's `takeoff_role()`; no update/delete. Until it is applied, js/events.js posts once, reads the 404 / `42P01`, and stays silent for the session — the app is unaffected. No bid content is ever sent (js/events.js `sanitizeProps`; see docs/ARCHITECTURE.md → Telemetry). |
| `005_takeoff_project_upsert.sql` | *(on the checklist above.)* `takeoff_upsert_project(...)` writes a project row only when the caller's `updated_at` matches the row's — so two devices saving the same bid cannot silently overwrite each other. The app works either way: js/cloud.js calls the function when it exists and otherwise falls back to read-compare-then-upsert, which makes the same decisions but is not atomic. |

## Dashboard settings the app depends on

Two things live in the Supabase dashboard rather than in a file here, and the
app cannot set them itself.

| Where | Setting | Why |
|---|---|---|
| Authentication → URL Configuration → **Redirect URLs** | Add `https://takeofftooling.github.io/` **and** `http://localhost:4173/` (any dev port you use) | "Forgot your password?" calls `resetPasswordForEmail` with `redirectTo` = the app's own address (origin + path, no hash). Supabase only honours an address on this allow-list; anything else silently sends the user to the Site URL, and the "choose a new password" form never appears. Sign-in itself still needs no redirect URL — the 6-digit code path is unchanged. |
| Authentication → Email Templates → **Reset Password** | Leave it as the default link template (`{{ .ConfirmationURL }}`) | The app expects a link back to itself, not a code. It arrives with a recovery session in the URL hash; `js/cloud.js` catches the `PASSWORD_RECOVERY` event and shows the new-password form. (The **Magic Link / OTP** template is the one edited to send `{{ .Token }}`.) |

Accounts created from Manage Users carry **no password** (the `takeoff-admin`
function omits it): the person signs in with the emailed code and sets their
own password from the Cloud Sync dialog, which is also the only place a
password can be changed (`auth.updateUser`).

## Rows that need no migration

Two account-level facts live in `takeoff_store` (one jsonb row per user per
key) rather than in a table of their own, so they need no SQL at all:

| Key | Value | Why |
|---|---|---|
| `share` | `{v:1, on, at}` | Whether this account has opted into sharing book corrections. It was a device-local localStorage flag, which meant two devices disagreed, an opt-out only worked from the device showing "On", and consent survived sign-out on a shared machine. |
| `deleted` | `{v:1, projects:{id: deletedAt}, assemblies:{id: deletedAt}}` | Tombstones. Deleting the `takeoff_projects` row is not enough: another device still holds the project in its own device-local index and re-uploads it on its next sync. Assemblies have no table at all — they are one `takeoff_store` row — so a tombstone is the only way a delete can travel. A row saved *after* its tombstone wins (that is deliberate work, not a resurrection). |

A `deleted_at` column on `takeoff_projects` would be tidier for projects, and
could be added later; it would not cover assemblies, and the client must keep
working without it (that is why the record lives here).

## Edge Functions

Deploy each with `supabase functions deploy <name> --project-ref awjcdxqhvgnqsrlnoyxr`.

| Function | Caller | Auth | Purpose |
|---|---|---|---|
| `takeoff-admin` | the app (dev role) | user JWT + `takeoff_profiles.role = 'dev'` | create / delete accounts (unchanged) |
| `twin-login` | agent harnesses, PipeTooling twin-mcp `mint_session app:'takeofftooling'` | `X-Twin-Token` (per-twin, verified against `twin_credentials`) or `X-Twin-Login-Secret` (fleet master); plus the fleet email pattern `twin-estimator-<n>@twins.takeofftooling.local` **and** `is_digital_twin` | mints a magic-link session for a twin — the seat |
| `manage-user` | PipeTooling only (server → server) | `X-Bridge-Secret` = `TT_MANAGE_USER_SECRET` | the TT↔PT bridge: `create`, `lookup`, `set_twin_flag`, `set_twin_credential`, `revoke_twin_credential`, `twin_projects`, `twin_manifest` (priced rows + a `#d=` share URL a human opens in their own TakeoffTooling), `set_twin_project_review` |
| `import-manifest` | twins (their own session JWT) | `Authorization: Bearer` + `is_digital_twin` | the agent door: payload v2 items → a normal project, exploded through `_shared/explode.js` and priced from the twin's synced book (else `_shared/laborBookDefaults.json`); idempotent by `(owner, data->>externalRef)` else `(owner, name)` |

Secrets (`supabase secrets set …`): `TWIN_LOGIN_SECRET` (twin-login master path — rotating it is this app's fleet kill switch), `TT_MANAGE_USER_SECRET` (the bridge; PipeTooling holds the same value as `TT_MANAGE_USER_SECRET` beside `TT_MANAGE_USER_URL`, `TT_TWIN_LOGIN_URL`, `TAKEOFFTOOLING_TWIN_LOGIN_SECRET`). `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are injected.

`supabase/functions/_shared/` holds GENERATED copies: `explode.js` and `handoff.js` are byte-identical to `js/explode.js` / `js/handoff.js`, and `laborBookDefaults.json` is `LABOR_BOOK_DEFAULTS` serialized — edge functions bundle only their own directory plus `_shared`. `npm run build:shared` refreshes them; `npm run check` fails when they are stale.

### Twin bootstrap (operator, once per twin)

1. PipeTooling mints the twin and issues its per-twin token (Settings → Digital twins); its TT seat is created over the bridge (`create` with `is_digital_twin: true`, email `twin-estimator-<n>@twins.takeofftooling.local`) and the token's hash mirrored (`set_twin_credential`). PipeTooling's `mint_session app:'takeofftooling'` does the mirror lazily too.
2. A harness POSTs `twin-login` with `X-Twin-Token` → `action_link` → a signed-in session; its JWT authorizes `import-manifest`.
3. A human reviews through `twin_manifest.share_url` (opens in their own app as a new project) and flips the lane with `set_twin_project_review` — or PipeTooling's audit does it.
