-- 003 — takeoff_layout_suggestions: shared Organize Categories layouts
--
-- One row per consenting user: their applied book layout (group config +
-- per-tab section order) so an admin can review member reorganizations and
-- hard-code the good ones into js/data/laborBookDefaults.js — the same
-- trust model as row corrections (takeoff_suggestions): sharing is opt-in
-- (the existing corrections toggle), nothing changes the shipped book
-- except a commit. Until this migration is applied, the app detects the
-- missing table and simply skips layout sharing.

create table if not exists public.takeoff_layout_suggestions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  value jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
  updated_at timestamptz not null default now()
);

alter table public.takeoff_layout_suggestions enable row level security;

-- owners manage their own row (share, update, withdraw)
drop policy if exists "Users manage own layout suggestion" on public.takeoff_layout_suggestions;
create policy "Users manage own layout suggestion"
  on public.takeoff_layout_suggestions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- admins (and devs, via is_takeoff_admin) review everyone's layouts
drop policy if exists "Admins read all layout suggestions" on public.takeoff_layout_suggestions;
create policy "Admins read all layout suggestions"
  on public.takeoff_layout_suggestions for select
  using (public.is_takeoff_admin());

drop policy if exists "Admins update layout suggestion status" on public.takeoff_layout_suggestions;
create policy "Admins update layout suggestion status"
  on public.takeoff_layout_suggestions for update
  using (public.is_takeoff_admin())
  with check (public.is_takeoff_admin());
