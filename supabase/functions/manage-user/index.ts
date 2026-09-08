import { createClient } from 'npm:@supabase/supabase-js@2'
import '../_shared/handoff.js'

// TT↔PT bridge — the TakeoffTooling half, modeled verb-for-verb on CountTooling's
// manage-user (PipeTooling is the single system of record for people; this is the
// COMMANDED path for provisioning, flagging and reading twin accounts here). Called
// exclusively server → server by PipeTooling (its tt-bridge proxy and twin-mcp),
// never by a browser. TakeoffTooling's own Manage Users stays the manual escape hatch.
//
// Auth: X-Bridge-Secret must match TT_MANAGE_USER_SECRET (compared as SHA-256 digests).
// Rotating the secret severs the bridge.
//
// Verbs (POST JSON { verb, ... }):
//   create                 { email, name?, is_digital_twin? } → { tt_user_id, existed }  (idempotent)
//   lookup                 { email } → { found, tt_user_id?, is_digital_twin? }
//   set_twin_flag          { email, is_digital_twin }
//   set_twin_credential    { email, token_hash }        (sha256 hex of PT's per-twin token)
//   revoke_twin_credential { token_hash }
//   twin_projects          { email } → the twin's manifests with bid stamp + review state
//   twin_manifest          { email, project_id | external_ref } → the manifest as
//                          PipeTooling rows (unit cost + hours per row) + a share URL a
//                          human can open in their own TakeoffTooling
//   set_twin_project_review{ project_id, status: ready|changes|reviewed, note? }
//
// Deploy: supabase functions deploy manage-user --project-ref awjcdxqhvgnqsrlnoyxr
// Secrets: TT_MANAGE_USER_SECRET.

declare const TakeoffHandoff: {
  buildPipeToolingRows: (manifest: unknown[], project: { plansUrl?: string }) => Array<Record<string, unknown>>
  buildPipeToolingText: (manifest: unknown[], project: { plansUrl?: string }) => { text: string; counts: number; feet: number; unscaled: number; rows: number }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info, x-bridge-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

type AdminUser = { id: string; email?: string | null }
// deno-lint-ignore no-explicit-any
type Admin = any

async function findByEmail(admin: Admin, email: string): Promise<AdminUser | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`listUsers failed: ${error.message}`)
    const hit = (data.users as AdminUser[]).find((u) => (u.email ?? '').toLowerCase() === email)
    if (hit) return hit
    if (data.users.length < 1000) break
  }
  return null
}

async function twinProfile(admin: Admin, userId: string): Promise<boolean> {
  const { data } = await admin.from('takeoff_profiles').select('is_digital_twin').eq('user_id', userId).maybeSingle()
  return data?.is_digital_twin === true
}

// A share link a human opens in THEIR OWN TakeoffTooling: the app's existing
// `#d=` import (js/app.js) lands the manifest as a new project, nothing replaced.
function shareUrl(project: { name: string; data: Record<string, unknown> }): string {
  const envelope = { v: 2, app: 'takeoff-tooling', exportedAt: new Date().toISOString(), name: project.name, manifest: project.data.manifest ?? [] }
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(envelope))))
  return `https://takeofftooling.com/#d=${b64}`
}

// The bid stamp, review lane and agent-door provenance live INSIDE data (the
// 005 compare-and-swap RPC carries data whole; no columns) — read them from there.
const projectSelect = 'id, name, updated_at, data'
const fieldsOf = (p: Record<string, unknown>) => {
  const d = (p.data as Record<string, unknown>) ?? {}
  return {
    external_ref: typeof d.externalRef === 'string' ? d.externalRef : null,
    review_status: typeof d.reviewStatus === 'string' ? d.reviewStatus : 'draft',
    review_note: typeof d.reviewNote === 'string' ? d.reviewNote : null,
    review_requested_at: typeof d.reviewRequestedAt === 'string' ? d.reviewRequestedAt : null,
    reviewed_at: typeof d.reviewedAt === 'string' ? d.reviewedAt : null,
    agent_import: d.agentImport ?? null,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST only' })
  try {
    const expected = Deno.env.get('TT_MANAGE_USER_SECRET')
    const got = req.headers.get('X-Bridge-Secret')
    if (!expected || !got || (await sha256Hex(got)) !== (await sha256Hex(expected))) return json(403, { error: 'Forbidden' })

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body.verb !== 'string') return json(400, { error: 'Missing verb' })
    const verb = body.verb
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!serviceRoleKey) return json(500, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const email = String(body.email ?? '').trim().toLowerCase()

    switch (verb) {
      case 'create': {
        if (!email || !email.includes('@')) return json(400, { error: 'Valid email required' })
        const name = typeof body.name === 'string' ? body.name.trim() : ''
        const isTwin = body.is_digital_twin === true
        const existing = await findByEmail(admin, email)
        if (existing) {
          if (isTwin) await admin.from('takeoff_profiles').upsert({ user_id: existing.id, is_digital_twin: true }, { onConflict: 'user_id' })
          return json(200, { tt_user_id: existing.id, email, existed: true })
        }
        const password = crypto.randomUUID() + crypto.randomUUID() // random, never used or shown
        const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: name ? { name } : undefined })
        if (error || !created?.user) return json(500, { error: `createUser failed: ${error?.message ?? 'unknown'}` })
        // the signup trigger inserts the profile; upsert sets the twin flag either way
        const { error: profErr } = await admin.from('takeoff_profiles').upsert({ user_id: created.user.id, is_digital_twin: isTwin }, { onConflict: 'user_id' })
        if (profErr) return json(500, { error: `Profile write failed: ${profErr.message}`, tt_user_id: created.user.id })
        console.log(`manage-user create: ${email} → ${created.user.id} twin=${isTwin}`)
        return json(200, { tt_user_id: created.user.id, email, existed: false })
      }
      case 'lookup': {
        if (!email) return json(400, { error: 'email required' })
        const u = await findByEmail(admin, email)
        if (!u) return json(200, { found: false })
        return json(200, { found: true, tt_user_id: u.id, is_digital_twin: await twinProfile(admin, u.id) })
      }
      case 'set_twin_flag': {
        if (!email) return json(400, { error: 'email required' })
        const u = await findByEmail(admin, email)
        if (!u) return json(404, { error: 'no such TakeoffTooling user' })
        const { error } = await admin.from('takeoff_profiles').upsert({ user_id: u.id, is_digital_twin: body.is_digital_twin === true }, { onConflict: 'user_id' })
        if (error) return json(500, { error: `flag write failed: ${error.message}` })
        return json(200, { ok: true })
      }
      case 'set_twin_credential': {
        const tokenHash = String(body.token_hash ?? '').trim().toLowerCase()
        if (!email || !/^[0-9a-f]{64}$/.test(tokenHash)) return json(400, { error: 'email + token_hash (sha256 hex) required' })
        const u = await findByEmail(admin, email)
        if (!u) return json(404, { error: 'no such TakeoffTooling user' })
        if (!(await twinProfile(admin, u.id))) return json(400, { error: 'credentials are twin-only' })
        const { error } = await admin.from('twin_credentials').insert({ user_id: u.id, token_hash: tokenHash, label: typeof body.label === 'string' ? body.label.slice(0, 80) : null })
        if (error && !/duplicate key/.test(error.message)) return json(500, { error: `credential insert failed: ${error.message}` })
        return json(200, { ok: true, existed: !!error })
      }
      case 'revoke_twin_credential': {
        const tokenHash = String(body.token_hash ?? '').trim().toLowerCase()
        if (!/^[0-9a-f]{64}$/.test(tokenHash)) return json(400, { error: 'token_hash (sha256 hex) required' })
        const { error } = await admin.from('twin_credentials').update({ revoked_at: new Date().toISOString() }).eq('token_hash', tokenHash).is('revoked_at', null)
        if (error) return json(500, { error: `revoke failed: ${error.message}` })
        return json(200, { ok: true })
      }
      case 'twin_projects': {
        if (!email) return json(400, { error: 'email required' })
        const u = await findByEmail(admin, email)
        if (!u) return json(200, { found: false, projects: [] })
        if (!(await twinProfile(admin, u.id))) return json(400, { error: 'twin_projects is twin-scoped — not a twin account' })
        const { data: projects, error } = await admin.from('takeoff_projects').select(projectSelect).eq('user_id', u.id).order('updated_at', { ascending: false }).limit(20)
        if (error) return json(500, { error: `projects read failed: ${error.message}` })
        return json(200, {
          found: true,
          projects: (projects ?? []).map((p: Record<string, unknown>) => {
            const manifest = ((p.data as Record<string, unknown>)?.manifest as unknown[]) ?? []
            const summary = TakeoffHandoff.buildPipeToolingText(manifest, {})
            return {
              id: p.id, name: p.name, updated_at: p.updated_at, ...fieldsOf(p),
              rows: summary.rows, counts: summary.counts, line_types: summary.feet, unscaled: summary.unscaled,
            }
          }),
        })
      }
      case 'twin_manifest': {
        if (!email) return json(400, { error: 'email required' })
        const u = await findByEmail(admin, email)
        if (!u) return json(404, { error: 'no such TakeoffTooling user' })
        if (!(await twinProfile(admin, u.id))) return json(400, { error: 'twin_manifest is twin-scoped — not a twin account' })
        const projectId = String(body.project_id ?? '').trim()
        const ref = String(body.external_ref ?? '').trim()
        if (!projectId && !ref) return json(400, { error: 'project_id or external_ref required' })
        let q = admin.from('takeoff_projects').select(projectSelect).eq('user_id', u.id)
        q = projectId ? q.eq('id', projectId) : q.eq('data->>externalRef', ref)
        const { data: proj, error } = await q.order('updated_at', { ascending: false }).limit(1).maybeSingle()
        if (error) return json(500, { error: `project read failed: ${error.message}` })
        if (!proj) return json(404, { error: 'no such project for this twin' })
        const data = (proj.data as Record<string, unknown>) ?? {}
        const manifest = (data.manifest as unknown[]) ?? []
        const project = { plansUrl: typeof data.plansUrl === 'string' ? data.plansUrl : '' }
        const f = fieldsOf(proj)
        return json(200, {
          project: {
            id: proj.id, name: proj.name, external_ref: f.external_ref, review_status: f.review_status, review_note: f.review_note,
            updated_at: proj.updated_at, plans_url: project.plansUrl || null, labor_rate: data.laborRate ?? null, tax_rate: data.taxRate ?? null,
            agent_import: f.agent_import,
          },
          rows: TakeoffHandoff.buildPipeToolingRows(manifest, project),
          counts_text: TakeoffHandoff.buildPipeToolingText(manifest, project).text,
          share_url: shareUrl({ name: String(proj.name), data }),
        })
      }
      case 'set_twin_project_review': {
        const projectId = String(body.project_id ?? '').trim()
        const status = String(body.status ?? '').trim()
        const note = typeof body.note === 'string' ? body.note.slice(0, 500) : null
        if (!projectId) return json(400, { error: 'project_id required' })
        if (!['reviewed', 'ready', 'changes'].includes(status)) return json(400, { error: "status must be 'reviewed', 'ready', or 'changes'" })
        const { data: proj, error: projErr } = await admin.from('takeoff_projects').select('id, user_id, data').eq('id', projectId).maybeSingle()
        if (projErr) return json(500, { error: `project read failed: ${projErr.message}` })
        if (!proj) return json(404, { error: 'no such project' })
        if (!(await twinProfile(admin, proj.user_id))) return json(400, { error: 'set_twin_project_review is twin-scoped — project is not twin-owned' })
        // the lane lives inside data: read-modify-write the document, bump updated_at so
        // a device holding an older copy sees the newer row on its next pull
        const cur = ((proj.data as Record<string, unknown>) ?? {})
        const previous = typeof cur.reviewStatus === 'string' ? cur.reviewStatus : 'draft'
        const next: Record<string, unknown> = { ...cur, reviewStatus: status }
        const now = new Date().toISOString()
        if (status === 'ready') next.reviewRequestedAt = now
        if (status === 'reviewed') next.reviewedAt = now
        if (note != null) next.reviewNote = note
        const { error } = await admin.from('takeoff_projects').update({ data: next, updated_at: now }).eq('id', projectId)
        if (error) return json(500, { error: `review update failed: ${error.message}` })
        console.log(`manage-user set_twin_project_review: ${projectId} → ${status}`)
        return json(200, { ok: true, previous, status })
      }
      default:
        return json(400, { error: `Unknown verb: ${verb}` })
    }
  } catch (e) {
    return json(500, { error: String(e) })
  }
})
