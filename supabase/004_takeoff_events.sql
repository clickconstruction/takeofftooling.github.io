-- 004 — takeoff_events: product telemetry (structural counts, never bid content)
--
-- APPLY THIS BEFORE EVENTS CAN FLOW. Until it is applied the client (js/events.js)
-- posts once, gets a 404 / 42P01 back, and goes silent for the session — the app
-- behaves exactly as it does today, so this migration is safe to apply late.
--
-- Rows carry an ANONYMOUS per-install id (a random UUID the browser keeps in
-- localStorage) and, only while someone is signed in, their user_id. Everything
-- else is counts, booleans, short enums, durations, the viewport width and
-- whether the pointer is coarse. The client's sanitizer drops descriptions,
-- names, emails and per-row prices before a row is ever built; this table adds
-- the server-side ceilings (name length, props size) so a future client cannot
-- widen the contract by accident.
--
-- Inserts are open to anon + authenticated (the app must keep working signed
-- out) with a CHECK that a row either claims no user or claims the caller.
-- Reads are dev-only, via the takeoff_role() helper from 002.

create table if not exists public.takeoff_events (
  id uuid primary key default gen_random_uuid(),
  install_id text not null check (char_length(install_id) between 8 and 64),
  user_id uuid references auth.users(id) on delete set null,
  name text not null check (char_length(name) between 3 and 40),
  props jsonb not null default '{}' check (pg_column_size(props) < 2048),
  vw int check (vw is null or vw between 0 and 20000),
  coarse_pointer boolean,
  created_at timestamptz not null default now()
);

create index if not exists takeoff_events_created_idx on public.takeoff_events (created_at desc);
create index if not exists takeoff_events_name_created_idx on public.takeoff_events (name, created_at desc);
create index if not exists takeoff_events_install_created_idx on public.takeoff_events (install_id, created_at desc);

alter table public.takeoff_events enable row level security;

-- Signed out is a first-class state in this app, so anon inserts too. A row may
-- be anonymous (user_id null) or the caller's own — never anybody else's.
drop policy if exists "Anyone can log their own events" on public.takeoff_events;
create policy "Anyone can log their own events"
  on public.takeoff_events for insert
  to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

-- Reading the feed is a dev-role act (002's role ladder: user < admin < dev).
drop policy if exists "Devs can read events" on public.takeoff_events;
create policy "Devs can read events"
  on public.takeoff_events for select
  to authenticated
  using (public.takeoff_role() = 'dev');

-- No update/delete policies: events are append-only for every client role.
