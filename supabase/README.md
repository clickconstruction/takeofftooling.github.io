# Supabase migrations (Takeoff Tooling test instance)

SQL to apply on the app's Supabase project (`awjcdxqhvgnqsrlnoyxr`). Earlier
schema (the `takeoff_store` and `takeoff_suggestions` tables and their RLS)
was created directly from the dashboard before this folder existed; new
schema lands here as numbered files.

**To apply:** Supabase Dashboard → SQL Editor → paste the entire file →
Run. Apply files in filename order.

| File | What |
|---|---|
| `001_takeoff_projects.sql` | **Applied 2026-08-17.** Per-user project rows (schema-aligned with Count Tooling's `projects` table for the future merge). Until applied, project cloud sync is dormant — the app detects the missing table, keeps projects local-only, and logs a console note. Book/assemblies sync via `takeoff_store` is unaffected. |
