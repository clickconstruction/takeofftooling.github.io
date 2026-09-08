-- 005 — takeoff_upsert_project (conditional project write)
--
-- APPLY THIS BEFORE DEPLOYING the conflict-safe project sync. The app works
-- either way: js/cloud.js calls this function when it exists and falls back to
-- read-then-upsert (js/cloudSync.js decides in both cases). Without it the
-- check is not atomic — two devices pushing inside the same round trip can
-- still have one overwrite the other, which is exactly what this closes.
--
-- Contract: write the project row only if the caller's view of it is current.
--   p_expected_updated_at is the updated_at the client last reconciled with.
--     null      → the client believes no row exists (insert only)
--     a stamp   → write only if the row still carries that stamp
-- Returns jsonb {applied, row}. When applied is false, `row` is the row as it
-- now stands, so the client can keep that copy as its own project before
-- deciding what to do — it never loses a bid to a refused write.
--
-- RLS still applies: the function is security invoker, so a caller can only
-- touch their own rows.

create or replace function public.takeoff_upsert_project(
  p_id uuid,
  p_name text,
  p_data jsonb,
  p_updated_at timestamptz,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  existing public.takeoff_projects%rowtype;
  written public.takeoff_projects%rowtype;
begin
  select * into existing from public.takeoff_projects where id = p_id;

  if not found then
    insert into public.takeoff_projects (id, user_id, name, data, updated_at)
    values (p_id, auth.uid(), coalesce(p_name, 'Untitled project'), coalesce(p_data, '{}'::jsonb), coalesce(p_updated_at, now()))
    returning * into written;
    return jsonb_build_object('applied', true, 'row', to_jsonb(written));
  end if;

  if p_expected_updated_at is null or existing.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('applied', false, 'row', to_jsonb(existing));
  end if;

  update public.takeoff_projects
     set name = coalesce(p_name, name),
         data = coalesce(p_data, data),
         updated_at = coalesce(p_updated_at, now())
   where id = p_id
     and updated_at = p_expected_updated_at
  returning * into written;

  if not found then
    select * into existing from public.takeoff_projects where id = p_id;
    return jsonb_build_object('applied', false, 'row', to_jsonb(existing));
  end if;

  return jsonb_build_object('applied', true, 'row', to_jsonb(written));
end;
$$;

grant execute on function public.takeoff_upsert_project(uuid, text, jsonb, timestamptz, timestamptz) to authenticated;
