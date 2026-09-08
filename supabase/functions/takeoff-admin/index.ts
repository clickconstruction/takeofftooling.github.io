// takeoff-admin — dev-only user management (create/delete accounts).
//
// Runs with the service role key (injected by Supabase); every request must
// carry a signed-in user's JWT, and the caller's takeoff_profiles.role must
// be 'dev'. Deployed with: supabase functions deploy takeoff-admin
// --project-ref awjcdxqhvgnqsrlnoyxr
//
// Actions (POST JSON):
//   { action: 'create-user', email, password } -> { ok, userId }
//   { action: 'delete-user', userId }          -> { ok }

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: caller, error: authError } = await admin.auth.getUser(jwt);
    if (authError || !caller?.user) return json(401, { error: 'Not signed in' });

    const { data: profile } = await admin
      .from('takeoff_profiles')
      .select('role')
      .eq('user_id', caller.user.id)
      .maybeSingle();
    if (!profile || profile.role !== 'dev') return json(403, { error: 'Dev role required' });

    const { action, email, password, userId } = await req.json();

    if (action === 'create-user') {
      if (!email) return json(400, { error: 'email is required' });
      // The password is optional and the app no longer sends one: an account
      // with none signs in with the emailed 6-digit code and sets its own
      // password from the cloud dialog. Still accepted so an older client, or
      // a curl from the dashboard, keeps working.
      const { data, error } = await admin.auth.admin.createUser({
        email,
        ...(password ? { password } : {}),
        email_confirm: true, // admin-provisioned: no confirmation email dance
      });
      if (error) return json(400, { error: error.message });
      return json(200, { ok: true, userId: data.user.id });
    }

    if (action === 'delete-user') {
      if (!userId) return json(400, { error: 'userId is required' });
      if (userId === caller.user.id) return json(400, { error: "You can't delete your own account" });
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) return json(400, { error: error.message });
      return json(200, { ok: true });
    }

    return json(400, { error: `Unknown action: ${action}` });
  } catch (err) {
    return json(500, { error: String((err as Error)?.message || err) });
  }
});
