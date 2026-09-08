import { createClient } from 'npm:@supabase/supabase-js@2'

// Digital twin sign-in mint — the TakeoffTooling half (PipeTooling
// docs/DIGITAL_TWINS_PLAN.md Phase E1; byte-for-byte the CountTooling design).
// A cloud-hosted agent harness (or PipeTooling's twin-mcp `mint_session`
// with app: 'takeofftooling') POSTs here and gets a magic-link action_link;
// navigating a headless browser to it — or walking the verify redirect — yields
// a signed-in session on the deployed app. No passwords anywhere.
//
// Two credential paths:
//   * X-Twin-Token — the PER-TWIN fleet token, verified against twin_credentials
//     (sha256 hashes mirrored from PipeTooling over manage-user at mint time).
//     The token IS the identity: the email must belong to that credential's
//     account. Revoking the row severs this one twin on this app.
//   * X-Twin-Login-Secret — the shared fleet secret (owner/ops path); rotating
//     it is the fleet-wide kill switch for this app.
// Hard guards on both paths: the fleet email pattern (estimator-only program)
// and takeoff_profiles.is_digital_twin — a leaked credential can only ever
// mint a twin session, never a person's.
//
// Deploy: supabase functions deploy twin-login --project-ref awjcdxqhvgnqsrlnoyxr
// Secrets: TWIN_LOGIN_SECRET (SUPABASE_URL / SERVICE_ROLE_KEY are injected).

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info, x-twin-login-secret, x-twin-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const TWIN_EMAIL_RE = /^twin-estimator-\d+@twins\.takeofftooling\.local$/

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST only' })
  try {
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!serviceRoleKey) return json(500, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Credential: per-twin token first, fleet secret otherwise.
    const twinToken = req.headers.get('X-Twin-Token')?.trim()
    let credentialUserId: string | null = null
    let credentialId: string | null = null
    if (twinToken) {
      const hash = await sha256Hex(twinToken)
      const { data: cred } = await admin.from('twin_credentials').select('id, user_id, revoked_at').eq('token_hash', hash).maybeSingle()
      if (!cred || cred.revoked_at) return json(401, { error: 'Unknown or revoked twin token' })
      credentialUserId = cred.user_id as string
      credentialId = cred.id as string
    } else {
      const secret = req.headers.get('X-Twin-Login-Secret')
      const expected = Deno.env.get('TWIN_LOGIN_SECRET')
      if (!expected || !secret || (await sha256Hex(secret)) !== (await sha256Hex(expected))) {
        return json(401, { error: 'Unauthorized - invalid or missing twin credential' })
      }
    }

    const { email, redirectTo, run } = (await req.json().catch(() => ({}))) as { email?: string; redirectTo?: string; run?: string }
    const cleanEmail = (email ?? '').trim().toLowerCase()
    if (!TWIN_EMAIL_RE.test(cleanEmail)) return json(400, { error: 'Not a twin account email' })

    const { data: listed, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 })
    if (listErr) return json(500, { error: `User lookup failed: ${listErr.message}` })
    const user = listed.users.find((u) => (u.email ?? '').toLowerCase() === cleanEmail)
    if (!user) return json(404, { error: 'Twin account not found' })
    if (credentialUserId && credentialUserId !== user.id) return json(403, { error: 'Twin token does not belong to that account' })

    const { data: profile, error: profErr } = await admin.from('takeoff_profiles').select('is_digital_twin').eq('user_id', user.id).maybeSingle()
    if (profErr) return json(500, { error: `Profile lookup failed: ${profErr.message}` })
    if (profile?.is_digital_twin !== true) return json(403, { error: 'Account is not flagged as a digital twin' })

    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: cleanEmail,
      options: { redirectTo: redirectTo || undefined },
    })
    if (linkError || !linkData) return json(500, { error: `Failed to generate magic link: ${linkError?.message || 'unknown error'}` })

    if (credentialId) await admin.from('twin_credentials').update({ last_used_at: new Date().toISOString() }).eq('id', credentialId).then(() => {}, () => {})
    console.log(`twin-login mint: ${cleanEmail} via=${credentialId ? 'token' : 'secret'} run=${run ?? '-'} redirect=${redirectTo ?? '-'}`)
    return json(200, { success: true, action_link: linkData.properties.action_link })
  } catch (e) {
    return json(500, { error: String(e) })
  }
})
