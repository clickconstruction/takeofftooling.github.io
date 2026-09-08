-- 004 — digital twins: the TakeoffTooling seat
--
-- Mirrors CountTooling's twin identity (PipeTooling docs/DIGITAL_TWINS_PLAN.md,
-- Phase E) so one per-twin token signs into all three apps:
--   * takeoff_profiles.is_digital_twin — the flag every twin guard checks. A leaked
--     credential can only ever mint a session as a flagged account.
--   * twin_credentials — sha256 hashes of PipeTooling's per-twin tokens, mirrored
--     over the manage-user bridge at mint time; twin-login verifies X-Twin-Token
--     against active rows. RLS on with NO policies: service role only.
--   * takeoff_projects gains the bid stamp and review lane CountTooling's
--     projects table carries (external_ref = the PipeTooling bid number;
--     review_status draft → ready → reviewed | changes) so the manifest a twin
--     imports is a reviewable fact PipeTooling can read over the bridge.
--   * takeoff_list_users returns the twin flag so Manage Users can badge twins.
--
-- Apply after 003 (Supabase Dashboard → SQL Editor, whole file). Idempotent.

alter table public.takeoff_profiles
  add column if not exists is_digital_twin boolean not null default false;

create table if not exists public.twin_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
alter table public.twin_credentials enable row level security;
create index if not exists twin_credentials_user_id_idx on public.twin_credentials(user_id);

alter table public.takeoff_projects
  add column if not exists external_ref text,
  add column if not exists review_status text not null default 'draft'
    check (review_status in ('draft', 'ready', 'changes', 'reviewed')),
  add column if not exists review_note text,
  add column if not exists review_requested_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists agent_import jsonb;

create index if not exists takeoff_projects_user_external_ref_idx
  on public.takeoff_projects(user_id, external_ref);

-- dev-only: list every account with role, twin flag, and activity
drop function if exists public.takeoff_list_users();
create or replace function public.takeoff_list_users()
returns table (user_id uuid, email text, role text, is_digital_twin boolean, created_at timestamptz, last_sign_in_at timestamptz)
language sql stable security definer set search_path = public as $$
  select u.id, u.email::text, coalesce(p.role, 'user'), coalesce(p.is_digital_twin, false), u.created_at, u.last_sign_in_at
  from auth.users u
  left join public.takeoff_profiles p on p.user_id = u.id
  where public.takeoff_role() = 'dev'
  order by u.created_at
$$;

-- the caller's own twin flag (the client reads it beside the role for the banner)
drop policy if exists "Users can read own takeoff profile" on public.takeoff_profiles;
create policy "Users can read own takeoff profile"
  on public.takeoff_profiles for select
  using (auth.uid() = user_id);
