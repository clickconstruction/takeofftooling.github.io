# Supabase migrations (Takeoff Tooling test instance)

SQL to apply on the app's Supabase project (`awjcdxqhvgnqsrlnoyxr`). Earlier
schema (the `takeoff_store` and `takeoff_suggestions` tables and their RLS)
was created directly from the dashboard before this folder existed; new
schema lands here as numbered files.

**To apply:** Supabase Dashboard → SQL Editor → paste the entire file →
Run. Apply files in filename order.

| File | What |
|---|---|
| `002_takeoff_profiles.sql` | Roles (`user` < `admin` < `dev`): profile table + signup trigger (seed emails get their roles automatically: robert@douglasmining.com → dev, stephen@pipetexas.com → admin), `takeoff_role()`/`is_takeoff_admin()` helpers (the latter replaces the old email-match version), and the dev-only RPCs `takeoff_list_users` / `takeoff_set_user_role`. Pairs with the `takeoff-admin` Edge Function (`supabase/functions/takeoff-admin/`, deployed via `supabase functions deploy takeoff-admin --project-ref awjcdxqhvgnqsrlnoyxr --use-api`) which creates/deletes accounts for dev callers. |
| `001_takeoff_projects.sql` | **Applied 2026-08-17.** Per-user project rows (schema-aligned with Count Tooling's `projects` table for the future merge). Until applied, project cloud sync is dormant — the app detects the missing table, keeps projects local-only, and logs a console note. Book/assemblies sync via `takeoff_store` is unaffected. |
