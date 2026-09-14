#!/bin/bash
# Apply whatever is still pending from the "Apply before deploy" checklist in
# supabase/README.md: the numbered SQL migrations that are not on the project
# yet, and the password-reset redirect URLs. Reports the reset-email template.
#
# Every migration here is idempotent, and the redirect list is merged, never
# replaced — so re-running this is safe.
#
# Auth: your own Supabase access token, looked for in this order:
#   1. SUPABASE_ACCESS_TOKEN already in the environment
#   2. the same variable in the repo's gitignored .env.local
#   3. the CLI's keychain entry on macOS (`supabase login` puts it there) —
#      that read pops a one-time "allow access" prompt, so run from a terminal
#      you can click on
# Nothing is written to disk.
#
#   bash supabase/apply-pending.sh
#
# To keep a token on this machine: mint one at
# https://supabase.com/dashboard/account/tokens and add one line to .env.local:
#
#   SUPABASE_ACCESS_TOKEN=sbp_...
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
# .env.local is gitignored; it already holds the e2e test account.
if [ -f .env.local ]; then set -a; . ./.env.local; set +a; fi
# The CLI stopped logging the token under --debug (checked on 2.72.7), so the
# keychain is the only place to get it without minting a new one.
export SB_TOKEN="${SUPABASE_ACCESS_TOKEN:-$(security find-generic-password -s 'Supabase CLI' -a supabase -w 2>/dev/null || true)}"
if [ -z "${SB_TOKEN:-}" ]; then
  echo "No access token."
  echo "  - macOS: run 'supabase login' first. Reading the keychain pops an"
  echo "    'allow access' prompt — click Allow, then run this again."
  echo "  - Or pass one: SUPABASE_ACCESS_TOKEN=sbp_... bash supabase/apply-pending.sh"
  echo "    (mint one at https://supabase.com/dashboard/account/tokens)"
  exit 1
fi

python3 - <<'PY'
import json, os, urllib.request, urllib.error
REF, TOKEN = 'awjcdxqhvgnqsrlnoyxr', os.environ['SB_TOKEN']
API = 'https://api.supabase.com/v1/projects/' + REF

def api(path, method='GET', body=None):
    req = urllib.request.Request(API + path, method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json'})
    try:
        return 200, json.loads(urllib.request.urlopen(req, timeout=90).read().decode() or 'null')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:400]

sql = lambda q: api('/database/query', 'POST', {'query': q})

code, who = api('')          # cheapest call that proves the token is good
if code == 401:
    raise SystemExit('That access token was rejected. Run `supabase login` again, or mint a\n'
                     'fresh one at https://supabase.com/dashboard/account/tokens and pass it as\n'
                     'SUPABASE_ACCESS_TOKEN=sbp_... bash supabase/apply-pending.sh')
if code != 200:
    raise SystemExit('Could not reach the project: [%s] %s' % (code, who))

# What is already there? (to_regclass / to_regproc are null when absent)
code, state = sql("""select
    to_regclass('public.takeoff_projects')            is not null as m001,
    to_regclass('public.takeoff_profiles')            is not null as m002,
    to_regclass('public.takeoff_layout_suggestions')  is not null as m003,
    to_regclass('public.takeoff_events')              is not null as m004,
    to_regproc('public.takeoff_upsert_project')       is not null as m005,
    to_regclass('public.twin_credentials')            is not null as m006""")
if code != 200:
    raise SystemExit('Could not read the schema: [%s] %s' % (code, state))
have = state[0]
print('On the project now:', ', '.join(k for k, v in sorted(have.items()) if v) or '(nothing)')

FILES = {'m001': 'supabase/001_takeoff_projects.sql', 'm002': 'supabase/002_takeoff_profiles.sql',
         'm003': 'supabase/003_takeoff_layout_suggestions.sql', 'm004': 'supabase/004_takeoff_events.sql',
         'm005': 'supabase/005_takeoff_project_upsert.sql', 'm006': 'supabase/006_takeoff_twins.sql'}
pending = [f for k, f in sorted(FILES.items()) if not have.get(k)]
print('Migrations:', ' '.join(pending) if pending else 'nothing pending')
applied = 0
for f in pending:
    code, out = sql(open(f).read())
    applied += code == 200
    print(('  OK   ' if code == 200 else '  FAIL ') + f + ('' if code == 200 else '  [%s] %s' % (code, out)))
if applied:
    # PostgREST learns about new tables/functions from this NOTIFY. Supabase
    # sends one itself on DDL, but two statements seconds apart can leave the
    # second out of the schema cache (the app then sees PGRST202 / 404).
    code, out = sql("notify pgrst, 'reload schema'")
    print('  schema cache reload ' + ('requested' if code == 200 else 'FAILED [%s] %s' % (code, out)))

# The app's real origin is the custom domain on the Pages CNAME, not the
# *.github.io address — a reset link back to the wrong origin is silently
# swapped for the Site URL and the new-password form never appears.
WANT = ['https://takeofftooling.com/', 'http://localhost:4173/']
code, cfg = api('/config/auth')
if code != 200:
    print('Auth config: FAILED to read [%s] %s' % (code, cfg))
else:
    cur = [u for u in (cfg.get('uri_allow_list') or '').split(',') if u]
    missing = [u for u in WANT if u not in cur]
    if missing:
        code, out = api('/config/auth', 'PATCH', {'uri_allow_list': ','.join(cur + missing)})
        print('Redirect URLs: ' + ('added ' + ', '.join(missing) if code == 200
              else 'FAILED [%s] %s' % (code, out)))
    else:
        print('Redirect URLs: both already allow-listed')
    print('Reset-password email: ' + ('default link template — correct'
          if not cfg.get('mailer_templates_recovery_content')
          else 'CUSTOM — confirm it sends {{ .ConfirmationURL }}, not {{ .Token }}'))
PY
