import { createClient } from 'npm:@supabase/supabase-js@2'
import '../_shared/explode.js'
import '../_shared/handoff.js'
import defaultsJson from '../_shared/laborBookDefaults.json' with { type: 'json' }

// import-manifest — the agent door into TakeoffTooling (the electrical estimator's
// STG-4: explode and cost). Modeled on CountTooling's import-takeoff: instead of
// robot-mousing the device flows, a twin POSTs the counts it already has — the same
// payload v2 items CountTooling's "Open in TakeoffTooling" emits — and the manifest
// lands as a NORMAL project it owns, exploded into assemblies and priced from a book,
// reviewable by a human through the bridge (twin_manifest → share_url) and readable
// by PipeTooling (twin_manifest rows carry unit cost + hours).
//
// Deliberate limits, mirroring import-takeoff:
//   * TWIN-ONLY (takeoff_profiles.is_digital_twin) — people have the flows;
//   * always the caller's OWN project;
//   * idempotent by (owner, external_ref), else by (owner, name): re-import REPLACES
//     the project's rows (review status resets to draft), never duplicates;
//   * nothing is inferred that the caller could have stated — a row with no type
//     stays untyped; a child no book row prices is flagged, never guessed;
//   * rejections are 400s that NAME the field.
//
// Body: { name, external_ref?, note?, plans_url?, labor_rate?, tax_rate?,
//         explode? (default true), items: [ { description, quantity, unit?: ea|ft|px,
//         type?, pages?|page?, group?, meta?, children?: [{ description, quantity,
//         unit?, type?, labor?, price? }] } ] }
// Book for pricing: the twin's own synced Labor & Price Book (takeoff_store key
// 'book'), else the shipped defaults bundled as _shared/laborBookDefaults.json.
//
// Deploy: supabase functions deploy import-manifest --project-ref awjcdxqhvgnqsrlnoyxr

declare const TakeoffExplode: {
  flattenBook: (book: unknown) => Array<{ name: string; labor: unknown; price: unknown }>
  explodeManifest: (manifest: unknown[], opts: { book: unknown[] }) => { manifest: unknown[]; exploded: number; unpriced: number }
}
declare const TakeoffHandoff: {
  buildPipeToolingText: (manifest: unknown[], project: { plansUrl?: string }) => { text: string; counts: number; feet: number; unscaled: number; rows: number }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const bad = (field: string, why: string) => json(400, { error: `items.${field}: ${why}` })

const ITEM_TYPES = ['lighting', 'gear', 'devices', 'conduit', 'wire', 'specialSystems', 'permits', 'powerCoCharges', 'temporaryPower']
const CHILD_TYPES = ['outletsAndSwitches', 'box', 'backBoxSupport', 'cover', 'conduit', 'wire', 'screws', 'misc', 'trenching', 'trenchingAddon', 'fitting', 'overage', 'macAdapter']
const UNITS = ['ea', 'ft', 'px']
const PLANS_LINK_RE = /^https:\/\/\S+$/
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const toNum = (v: unknown) => (v == null || v === '' ? null : num(Number(v)) ? Number(v) : NaN)

function shareUrl(name: string, manifest: unknown[]): string {
  const envelope = { v: 2, app: 'takeoff-tooling', exportedAt: new Date().toISOString(), name, manifest }
  return `https://takeofftooling.com/#d=${btoa(unescape(encodeURIComponent(JSON.stringify(envelope))))}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST only' })
  try {
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!serviceRoleKey) return json(500, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })

    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    const { data: caller, error: authError } = await admin.auth.getUser(jwt)
    if (authError || !caller?.user) return json(401, { error: 'Not signed in — send the twin session JWT as Authorization: Bearer' })
    const user = caller.user
    const { data: profile } = await admin.from('takeoff_profiles').select('is_digital_twin').eq('user_id', user.id).maybeSingle()
    if (profile?.is_digital_twin !== true) return json(403, { error: 'import-manifest is the agent door — twin accounts only; people have the flows.' })

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return json(400, { error: 'JSON body required' })
    const name = String(body.name ?? '').trim().slice(0, 120)
    if (!name) return json(400, { error: 'name required (the project name; re-import with the same external_ref or name replaces it)' })
    const externalRef = String(body.external_ref ?? '').trim().slice(0, 40) || null
    const note = String(body.note ?? '').trim().slice(0, 400) || null
    const plansUrl = String(body.plans_url ?? '').trim()
    if (plansUrl && !PLANS_LINK_RE.test(plansUrl)) return json(400, { error: 'plans_url must be an https URL' })
    const laborRate = toNum(body.labor_rate)
    if (laborRate != null && (Number.isNaN(laborRate) || laborRate < 0)) return json(400, { error: 'labor_rate must be a non-negative number' })
    const taxRate = toNum(body.tax_rate)
    if (taxRate != null && (Number.isNaN(taxRate) || taxRate < 0 || taxRate > 25)) return json(400, { error: 'tax_rate must be a percent between 0 and 25' })
    const doExplode = body.explode !== false
    const rawItems = body.items
    if (!Array.isArray(rawItems) || rawItems.length === 0) return json(400, { error: 'items[] required (1..500 rows)' })
    if (rawItems.length > 500) return json(400, { error: 'items[]: at most 500 rows' })

    // --- normalize (no inference: a missing type stays null) ---
    const manifest: Record<string, unknown>[] = []
    for (let i = 0; i < rawItems.length; i++) {
      const r = rawItems[i] as Record<string, unknown>
      if (!r || typeof r !== 'object') return bad(`[${i}]`, 'must be an object')
      const description = String(r.description ?? '').trim().slice(0, 300)
      if (!description) return bad(`[${i}].description`, 'required')
      const quantity = Number(r.quantity ?? r.count)
      if (!num(quantity) || quantity < 0) return bad(`[${i}].quantity`, 'non-negative number required')
      const unit = r.unit == null ? 'ea' : String(r.unit)
      if (!UNITS.includes(unit)) return bad(`[${i}].unit`, `one of ${UNITS.join('/')}`)
      const type = r.type == null ? null : String(r.type)
      if (type != null && !ITEM_TYPES.includes(type)) return bad(`[${i}].type`, `one of ${ITEM_TYPES.join('/')} (or omit)`)
      const group = typeof r.group === 'string' && r.group.trim() ? r.group.trim().slice(0, 80) : null
      const planPage = String(r.pages ?? r.page ?? r.planPage ?? '').trim().slice(0, 80)
      const meta = r.meta && typeof r.meta === 'object' && !Array.isArray(r.meta) ? r.meta : null
      const id = crypto.randomUUID()
      const children: Record<string, unknown>[] = []
      if (r.children != null) {
        if (!Array.isArray(r.children)) return bad(`[${i}].children`, 'must be an array')
        for (let j = 0; j < r.children.length; j++) {
          const c = r.children[j] as Record<string, unknown>
          const cdesc = String(c?.description ?? '').trim().slice(0, 300)
          if (!cdesc) return bad(`[${i}].children[${j}].description`, 'required')
          const cq = Number(c.quantity ?? c.count)
          if (!num(cq) || cq < 0) return bad(`[${i}].children[${j}].quantity`, 'non-negative number required')
          const cunit = c.unit == null ? 'ea' : String(c.unit)
          if (!UNITS.includes(cunit)) return bad(`[${i}].children[${j}].unit`, `one of ${UNITS.join('/')}`)
          const ctype = c.type == null ? null : String(c.type)
          if (ctype != null && !CHILD_TYPES.includes(ctype)) return bad(`[${i}].children[${j}].type`, `one of ${CHILD_TYPES.join('/')} (or omit)`)
          const clabor = toNum(c.labor)
          const cprice = toNum(c.price)
          if (clabor != null && Number.isNaN(clabor)) return bad(`[${i}].children[${j}].labor`, 'number or omit')
          if (cprice != null && Number.isNaN(cprice)) return bad(`[${i}].children[${j}].price`, 'number or omit')
          children.push({ id: crypto.randomUUID(), parentId: id, type: ctype, description: cdesc, quantity: cq, unit: cunit, labor: clabor ?? 0, price: cprice, planPage: '', group: null, children: [], conduitMeta: null, meta: c.meta && typeof c.meta === 'object' ? c.meta : null })
        }
      }
      const labor = toNum(r.labor)
      const price = toNum(r.price)
      if (labor != null && Number.isNaN(labor)) return bad(`[${i}].labor`, 'number or omit')
      if (price != null && Number.isNaN(price)) return bad(`[${i}].price`, 'number or omit')
      manifest.push({ id, type, description, quantity, unit, labor: labor ?? 0, price, planPage, group, parentId: null, children, conduitMeta: null, meta })
    }

    // --- the book: the twin's synced Labor & Price Book, else the shipped defaults ---
    let bookSource = 'defaults'
    let laborBook: unknown = (defaultsJson as { laborBook: unknown }).laborBook
    try {
      const { data: row } = await admin.from('takeoff_store').select('value').eq('user_id', user.id).eq('key', 'book').maybeSingle()
      const synced = (row?.value as { laborBook?: unknown } | null)?.laborBook
      if (synced && typeof synced === 'object') { laborBook = synced; bookSource = 'twin book' }
    } catch (_) { /* defaults stand */ }

    // --- explode childless parents through the shared kernel ---
    let finalManifest = manifest as unknown[]
    let exploded = 0
    let unpriced = 0
    if (doExplode) {
      const r = TakeoffExplode.explodeManifest(manifest, { book: TakeoffExplode.flattenBook(laborBook) })
      finalManifest = r.manifest
      exploded = r.exploded
      unpriced = r.unpriced
    }
    const summary = TakeoffHandoff.buildPipeToolingText(finalManifest, { plansUrl })

    // --- the project document (cloud row shape; the app's rowToProject reads it) ---
    const now = new Date().toISOString()
    const agentImport = { imported_at: now, source: 'manifest v2', note, book: bookSource, exploded, unpriced, rows: summary.rows }
    const data: Record<string, unknown> = { manifest: finalManifest, laborRate: laborRate ?? 0, agentImport }
    if (taxRate != null) data.taxRate = taxRate
    if (plansUrl) data.plansUrl = plansUrl

    // idempotent: by (owner, external_ref) when stamped, else by (owner, name)
    let existingQ = admin.from('takeoff_projects').select('id').eq('user_id', user.id)
    existingQ = externalRef ? existingQ.eq('external_ref', externalRef) : existingQ.eq('name', name)
    const { data: existing } = await existingQ.order('updated_at', { ascending: false }).limit(1).maybeSingle()
    const row = { name, data, external_ref: externalRef, review_status: 'draft', review_note: null, review_requested_at: null, reviewed_at: null, agent_import: agentImport, updated_at: now }
    let projectId: string
    if (existing?.id) {
      const { error } = await admin.from('takeoff_projects').update(row).eq('id', existing.id)
      if (error) return json(500, { error: `update failed: ${error.message}` })
      projectId = existing.id as string
    } else {
      const { data: ins, error } = await admin.from('takeoff_projects').insert({ ...row, id: crypto.randomUUID(), user_id: user.id }).select('id').single()
      if (error || !ins) return json(500, { error: `insert failed: ${error?.message ?? 'unknown'}` })
      projectId = ins.id as string
    }

    console.log(`[import-manifest] ${user.id} → ${projectId} "${name}" ref=${externalRef ?? '-'} rows=${summary.rows} exploded=${exploded} unpriced=${unpriced} book=${bookSource} replaced=${!!existing?.id}`)
    return json(200, {
      success: true,
      project_id: projectId,
      replaced: !!existing?.id,
      external_ref: externalRef,
      rows: summary.rows,
      counts: summary.counts,
      line_types: summary.feet,
      unscaled: summary.unscaled,
      exploded,
      unpriced,
      book: bookSource,
      review_status: 'draft',
      share_url: shareUrl(name, finalManifest),
      next: unpriced
        ? `${unpriced} exploded child row${unpriced === 1 ? '' : 's'} found no book price (meta.needsPricing) — extend the book or pass labor/price on those children, then re-import (same external_ref replaces).`
        : 'Mark the manifest review-ready over the bridge (set_twin_project_review) or via twin-mcp tt_finish_costing; twin_manifest returns the priced rows for PipeTooling.',
    })
  } catch (e) {
    return json(500, { error: String(e) })
  }
})
