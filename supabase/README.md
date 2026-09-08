# Supabase migrations (Takeoff Tooling test instance)

SQL to apply on the app's Supabase project (`awjcdxqhvgnqsrlnoyxr`). Earlier
schema (the `takeoff_store` and `takeoff_suggestions` tables and their RLS)
was created directly from the dashboard before this folder existed; new
schema lands here as numbered files.

**To apply:** Supabase Dashboard → SQL Editor → paste the entire file →
Run. Apply files in filename order.

| File | What |
|---|---|
| `004_takeoff_twins.sql` | **Digital twins — the TakeoffTooling seat** (PipeTooling `docs/DIGITAL_TWINS_PLAN.md` Phase E, mirrored from CountTooling): `takeoff_profiles.is_digital_twin`; `twin_credentials` (sha256 hashes of PipeTooling's per-twin tokens, service-role only); `takeoff_projects` gains `external_ref` (the PipeTooling bid number), `review_status` (draft → ready → reviewed \| changes), `review_note`, `review_requested_at`, `reviewed_at`, `agent_import`; `takeoff_list_users` returns the twin flag. Until applied, the client syncs base columns only and logs a console note; the twin functions below need it. |
| `003_takeoff_layout_suggestions.sql` | Shared Organize Categories layouts: one row per consenting user (their group config + section order), RLS owner-managed with admin review via `is_takeoff_admin()`. Until applied, the app detects the missing table and skips layout sharing; corrections sharing is unaffected. |
| `002_takeoff_profiles.sql` | Roles (`user` < `admin` < `dev`): profile table + signup trigger (seed emails get their roles automatically: robert@douglasmining.com → dev, stephen@pipetexas.com → admin), `takeoff_role()`/`is_takeoff_admin()` helpers (the latter replaces the old email-match version), and the dev-only RPCs `takeoff_list_users` / `takeoff_set_user_role`. Pairs with the `takeoff-admin` Edge Function (`supabase/functions/takeoff-admin/`, deployed via `supabase functions deploy takeoff-admin --project-ref awjcdxqhvgnqsrlnoyxr --use-api`) which creates/deletes accounts for dev callers. |
| `001_takeoff_projects.sql` | **Applied 2026-08-17.** Per-user project rows (schema-aligned with Count Tooling's `projects` table for the future merge). Until applied, project cloud sync is dormant — the app detects the missing table, keeps projects local-only, and logs a console note. Book/assemblies sync via `takeoff_store` is unaffected. |

## Edge Functions

Deploy each with `supabase functions deploy <name> --project-ref awjcdxqhvgnqsrlnoyxr`.

| Function | Caller | Auth | Purpose |
|---|---|---|---|
| `takeoff-admin` | the app (dev role) | user JWT + `takeoff_profiles.role = 'dev'` | create / delete accounts (unchanged) |
| `twin-login` | agent harnesses, PipeTooling twin-mcp `mint_session app:'takeofftooling'` | `X-Twin-Token` (per-twin, verified against `twin_credentials`) or `X-Twin-Login-Secret` (fleet master); plus the fleet email pattern `twin-estimator-<n>@twins.takeofftooling.local` **and** `is_digital_twin` | mints a magic-link session for a twin — the seat |
| `manage-user` | PipeTooling only (server → server) | `X-Bridge-Secret` = `TT_MANAGE_USER_SECRET` | the TT↔PT bridge: `create`, `lookup`, `set_twin_flag`, `set_twin_credential`, `revoke_twin_credential`, `twin_projects`, `twin_manifest` (priced rows + a `#d=` share URL a human opens in their own TakeoffTooling), `set_twin_project_review` |
| `import-manifest` | twins (their own session JWT) | `Authorization: Bearer` + `is_digital_twin` | the agent door: payload v2 items → a normal project, exploded through `_shared/explode.js` and priced from the twin's synced book (else `_shared/laborBookDefaults.json`); idempotent by `(owner, external_ref)` else `(owner, name)` |

Secrets (`supabase secrets set …`): `TWIN_LOGIN_SECRET` (twin-login master path — rotating it is this app's fleet kill switch), `TT_MANAGE_USER_SECRET` (the bridge; PipeTooling holds the same value as `TT_MANAGE_USER_SECRET` beside `TT_MANAGE_USER_URL`, `TT_TWIN_LOGIN_URL`, `TAKEOFFTOOLING_TWIN_LOGIN_SECRET`). `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are injected.

`supabase/functions/_shared/` holds GENERATED copies: `explode.js` and `handoff.js` are byte-identical to `js/explode.js` / `js/handoff.js`, and `laborBookDefaults.json` is `LABOR_BOOK_DEFAULTS` serialized — edge functions bundle only their own directory plus `_shared`. `npm run build:shared` refreshes them; `npm run check` fails when they are stale.

### Twin bootstrap (operator, once per twin)

1. PipeTooling mints the twin and issues its per-twin token (Settings → Digital twins); its TT seat is created over the bridge (`create` with `is_digital_twin: true`, email `twin-estimator-<n>@twins.takeofftooling.local`) and the token's hash mirrored (`set_twin_credential`). PipeTooling's `mint_session app:'takeofftooling'` does the mirror lazily too.
2. A harness POSTs `twin-login` with `X-Twin-Token` → `action_link` → a signed-in session; its JWT authorizes `import-manifest`.
3. A human reviews through `twin_manifest.share_url` (opens in their own app as a new project) and flips the lane with `set_twin_project_review` — or PipeTooling's audit does it.
