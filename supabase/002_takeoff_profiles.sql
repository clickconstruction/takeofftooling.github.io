-- 002 — takeoff_profiles: user roles (user < admin < dev)
--
-- 'admin' reviews shared book corrections (previously a hardcoded email
-- check); 'dev' is the super role — everything admin has, plus user
-- management (list users, change roles, and the takeoff-admin Edge Function
-- for creating/deleting accounts). Seeds: stephen@pipetexas.com -> admin,
-- robert@douglasmining.com -> dev — applied to existing users now AND baked
-- into the signup trigger, so the seed emails get their roles even if their
-- accounts are created after this migration runs.

create table if not exists public.takeoff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('user', 'admin', 'dev')),
  created_at timestamptz not null default now()
);

alter table public.takeoff_profiles enable row level security;

drop policy if exists "Users can read own takeoff profile" on public.takeoff_profiles;
create policy "Users can read own takeoff profile"
  on public.takeoff_profiles for select
  using (auth.uid() = user_id);

-- default role for a given email (seed emails get their roles automatically)
create or replace function public.takeoff_default_role(email text)
returns text language sql immutable as $$
  select case lower(coalesce(email, ''))
    when 'robert@douglasmining.com' then 'dev'
    when 'stephen@pipetexas.com' then 'admin'
    else 'user'
  end
$$;

-- auto-create a profile on signup
create or replace function public.takeoff_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.takeoff_profiles (user_id, role)
  values (new.id, public.takeoff_default_role(new.email))
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists takeoff_on_auth_user_created on auth.users;
create trigger takeoff_on_auth_user_created
  after insert on auth.users
  for each row execute function public.takeoff_handle_new_user();

-- backfill profiles for existing users, seeding roles by email
insert into public.takeoff_profiles (user_id, role)
  select u.id, public.takeoff_default_role(u.email) from auth.users u
  on conflict (user_id) do nothing;
update public.takeoff_profiles p
  set role = public.takeoff_default_role(u.email)
  from auth.users u
  where u.id = p.user_id and public.takeoff_default_role(u.email) <> 'user';

-- the caller's role ('user' when signed out or unprofiled)
create or replace function public.takeoff_role()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.takeoff_profiles where user_id = auth.uid()), 'user')
$$;

-- suggestions-review gate: was an email match, now role-driven (admin + dev)
create or replace function public.is_takeoff_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.takeoff_role() in ('admin', 'dev')
$$;

-- dev-only: list every account with role and activity
create or replace function public.takeoff_list_users()
returns table (user_id uuid, email text, role text, created_at timestamptz, last_sign_in_at timestamptz)
language sql stable security definer set search_path = public as $$
  select u.id, u.email::text, coalesce(p.role, 'user'), u.created_at, u.last_sign_in_at
  from auth.users u
  left join public.takeoff_profiles p on p.user_id = u.id
  where public.takeoff_role() = 'dev'
  order by u.created_at
$$;

-- dev-only: change a user's role (a dev can't demote themselves)
create or replace function public.takeoff_set_user_role(target uuid, new_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.takeoff_role() <> 'dev' then
    raise exception 'Dev role required';
  end if;
  if new_role not in ('user', 'admin', 'dev') then
    raise exception 'Invalid role';
  end if;
  if target = auth.uid() and new_role <> 'dev' then
    raise exception 'You can''t remove your own dev role';
  end if;
  insert into public.takeoff_profiles (user_id, role) values (target, new_role)
  on conflict (user_id) do update set role = excluded.role;
end $$;
