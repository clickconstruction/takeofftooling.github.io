/**
 * TakeoffCloud — optional Supabase-backed sync for the workspace + assemblies.
 *
 * The app stays local-first: TakeoffStorage (localStorage) remains the
 * synchronous source the app boots from. When signed in, this module
 *   - pulls on sign-in: book conflicts resolve by newest savedAt; projects
 *     (takeoff_projects, schema-aligned with Count Tooling) merge as a
 *     union by id with per-project last-write-wins
 *     (last write wins); assemblies merge as a union by id,
 *   - pushes on every save (TakeoffStorage notifies via onBookSaved /
 *     onProjectSaved / onAssembliesSaved), debounced; pending pushes flush
 *     when the tab hides.
 *
 * Signed out (or with the CDN blocked) the app behaves exactly as before.
 * Auth is Supabase email OTP: a 6-digit code, no passwords and no redirect
 * URLs, so the same flow works on localhost and GitHub Pages.
 *
 * Cloud rows live in public.takeoff_store (user_id, key, value jsonb) with
 * row-level security scoping every operation to auth.uid() = user_id.
 * Keys mirror localStorage: 'workspace' and 'assemblies'.
 *
 * Shared-book corrections (opt-in): after each workspace push, a consenting
 * user's Parts-book diff (TakeoffState.getBookCorrections) is upserted into
 * public.takeoff_suggestions; the admin account reviews it via
 * js/suggestionsReview.js. Opting out deletes the user's shared rows.
 */
const TakeoffCloud = (function () {
  const SUPABASE_URL = 'https://awjcdxqhvgnqsrlnoyxr.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_vMFyQ4I0LqZD6yhfoF_Zbw_9MsPoC9G'; // publishable key — safe to ship; RLS enforces access
  const TABLE = 'takeoff_store';
  const PROJECTS_TABLE = 'takeoff_projects';
  const SUGGESTIONS_TABLE = 'takeoff_suggestions';
  const ADMIN_EMAIL = 'stephen@pipetexas.com'; // legacy fallback while takeoff_profiles is unapplied; RLS enforces the real access
  const SHARE_KEY = 'takeoff-share-corrections'; // '1' when the user opted into sharing book corrections
  const PUSH_DEBOUNCE_MS = 1200;

  let client = null;
  let session = null;
  let profileRole = null; // 'user' | 'admin' | 'dev' — from takeoff_profiles
  let syncedThisLoad = false;
  let suppressPush = false; // true while adopting remote data locally
  let lastSyncedAt = null;
  let status = 'signedOut'; // disabled | signedOut | syncing | synced | error
  let statusDetail = '';
  let pendingEmail = ''; // email a code was sent to (modal state)
  const pushTimers = {};
  const pendingValues = {};

  const escapeHtml = (s) => (typeof TakeoffUtils !== 'undefined' ? TakeoffUtils.escapeHtml(s) : String(s));

  try {
    if (typeof supabase !== 'undefined' && SUPABASE_URL && !SUPABASE_KEY.startsWith('__')) {
      client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }
  } catch (err) {
    console.warn('Takeoff: cloud sync unavailable', err);
  }
  if (!client) status = 'disabled';

  function isSignedIn() {
    return !!session;
  }

  function getEmail() {
    return session?.user?.email || null;
  }

  function setStatus(next, detail) {
    status = next;
    statusDetail = detail || '';
    updateUi();
  }

  // --- Sync ---

  async function syncDown() {
    if (!client || !session) return;
    setStatus('syncing');
    const { data, error } = await client.from(TABLE).select('key,value').in('key', ['book', 'assemblies', 'workspace']);
    if (error) {
      setStatus('error', error.message);
      return;
    }
    const remote = Object.fromEntries((data || []).map((r) => [r.key, r.value]));

    // Book: newest savedAt wins. A legacy pre-projects 'workspace' row
    // stands in for a missing 'book' row (its book half); the row itself is
    // left untouched as a backup.
    const legacyWs = !remote.book && remote.workspace && remote.workspace.v === 1 ? remote.workspace : null;
    const remoteBook = remote.book && remote.book.v === 1
      ? remote.book
      : legacyWs && legacyWs.laborBook
        ? { v: 1, savedAt: legacyWs.savedAt, laborBook: legacyWs.laborBook, laborBookMeta: legacyWs.laborBookMeta || null }
        : null;
    const localBook = TakeoffStorage.loadBook();
    const localT = localBook ? Date.parse(localBook.savedAt) || 0 : 0;
    const remoteT = remoteBook ? Date.parse(remoteBook.savedAt) || 0 : 0;
    if (remoteBook && remoteT > localT) {
      suppressPush = true;
      try {
        TakeoffStorage.saveBook(remoteBook);
        TakeoffState.adoptBook(remoteBook);
      } finally {
        suppressPush = false;
      }
    } else if (localBook && localT > 0 && localT > remoteT) {
      queuePush('book', localBook, { immediate: true });
    }

    // Assemblies: union by id (local entries win on id collision).
    const localAsm = TakeoffStorage.loadAssemblies();
    const remoteAsm = Array.isArray(remote.assemblies) ? remote.assemblies : [];
    const byId = new Map();
    for (const a of remoteAsm) if (a && a.id) byId.set(a.id, a);
    for (const a of localAsm) if (a && a.id) byId.set(a.id, a);
    const merged = Array.from(byId.values());
    const changedLocally = merged.length !== localAsm.length;
    const changedRemotely = merged.length !== remoteAsm.length;
    if (changedLocally) {
      suppressPush = !changedRemotely;
      try {
        TakeoffState.setAssemblies(merged); // persists via TakeoffStorage → pushes if suppressPush is false
      } finally {
        suppressPush = false;
      }
    } else if (changedRemotely) {
      queuePush('assemblies', merged, { immediate: true });
    }

    await syncProjects(legacyWs);

    lastSyncedAt = new Date();
    setStatus('synced');
    pushSuggestions();
    if (typeof TakeoffApp !== 'undefined') TakeoffApp.render();
  }

  // --- Projects sync (takeoff_projects; schema mirrors Count Tooling's
  //     projects table). Per-project last-write-wins by updated_at; sign-in
  //     merges as a union by id. Missing table (SQL not applied yet on the
  //     test instance) disables project sync gracefully. ---

  let projectsTableAvailable = true;
  let projectsTableWarned = false;
  const pendingProjects = {}; // id -> project payload
  const projectPushTimers = {};

  function noteProjectsError(error) {
    const msg = (error && error.message) || '';
    if ((error && error.code === '42P01') || /does not exist|Could not find the table|schema cache/i.test(msg)) {
      projectsTableAvailable = false;
      if (!projectsTableWarned) {
        projectsTableWarned = true;
        console.warn('Takeoff: takeoff_projects table not found — project cloud sync is off until the SQL migration is applied (supabase/001_takeoff_projects.sql).');
      }
    } else {
      setStatus('error', msg);
    }
  }

  function rowToProject(r) {
    return {
      v: 1,
      id: r.id,
      savedAt: r.updated_at,
      name: r.name || 'Untitled project',
      manifest: r.data && Array.isArray(r.data.manifest) ? r.data.manifest : [],
      laborRate: r.data && typeof r.data.laborRate === 'number' ? r.data.laborRate : 0,
    };
  }

  async function syncProjects(legacyWs) {
    if (!projectsTableAvailable) return;
    const { data, error } = await client.from(PROJECTS_TABLE).select('id,name,data,updated_at');
    if (error) {
      noteProjectsError(error);
      return;
    }
    const remoteRows = data || [];
    const remoteById = new Map(remoteRows.map((r) => [r.id, r]));
    const idx = TakeoffStorage.loadProjectsIndex() || { v: 1, currentId: null, projects: [] };
    let indexChanged = false;
    const current = TakeoffState.getCurrentProject();

    for (const r of remoteRows) {
      const localEntry = idx.projects.find((p) => p.id === r.id);
      const localT = localEntry ? Date.parse(localEntry.updatedAt) || 0 : 0;
      const remoteT = Date.parse(r.updated_at) || 0;
      if (!localEntry || remoteT > localT) {
        const project = rowToProject(r);
        TakeoffStorage.saveProjectLocalOnly(project);
        if (localEntry) {
          localEntry.name = project.name;
          localEntry.updatedAt = r.updated_at;
        } else {
          idx.projects.push({ id: r.id, name: project.name, createdAt: r.updated_at, updatedAt: r.updated_at });
        }
        indexChanged = true;
        if (r.id === current.id) {
          suppressPush = true;
          try {
            TakeoffState.adoptProject(project);
          } finally {
            suppressPush = false;
          }
        }
      } else if (localT > remoteT) {
        const localData = TakeoffStorage.loadProject(r.id);
        if (localData) queueProjectPush(localData, { immediate: true });
      }
    }

    // local-only projects go up
    for (const p of idx.projects) {
      if (!remoteById.has(p.id)) {
        const localData = TakeoffStorage.loadProject(p.id);
        if (localData) queueProjectPush(localData, { immediate: true });
      }
    }
    if (indexChanged) TakeoffStorage.saveProjectsIndex(idx);

    // A legacy cloud workspace with real content, no remote projects, and
    // nothing local beyond empty starters: a fresh device signing in before
    // any migrated device pushed. Surface it as a project once.
    if (
      legacyWs && Array.isArray(legacyWs.manifest) && legacyWs.manifest.length && remoteRows.length === 0 &&
      idx.projects.every((p) => {
        const d = TakeoffStorage.loadProject(p.id);
        return !d || !Array.isArray(d.manifest) || d.manifest.length === 0;
      })
    ) {
      const when = new Date(Date.parse(legacyWs.savedAt) || Date.now());
      const project = {
        v: 1,
        id: TakeoffStorage.generateProjectId(),
        savedAt: legacyWs.savedAt || new Date().toISOString(),
        name: `Takeoff — ${when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
        manifest: legacyWs.manifest,
        laborRate: typeof legacyWs.laborRate === 'number' ? legacyWs.laborRate : 0,
      };
      TakeoffStorage.saveProjectLocalOnly(project);
      idx.projects.push({ id: project.id, name: project.name, createdAt: project.savedAt, updatedAt: project.savedAt });
      TakeoffStorage.saveProjectsIndex(idx);
      queueProjectPush(project, { immediate: true });
    }
  }

  function queueProjectPush(project, opts) {
    if (!client || !session || !projectsTableAvailable) return;
    pendingProjects[project.id] = project;
    clearTimeout(projectPushTimers[project.id]);
    if (opts && opts.immediate) {
      pushProjectNow(project.id);
    } else {
      projectPushTimers[project.id] = setTimeout(() => pushProjectNow(project.id), PUSH_DEBOUNCE_MS);
    }
  }

  async function pushProjectNow(id) {
    if (!client || !session || !(id in pendingProjects)) return;
    const project = pendingProjects[id];
    delete pendingProjects[id];
    const { error } = await client.from(PROJECTS_TABLE).upsert({
      id: project.id,
      user_id: session.user.id,
      name: project.name,
      data: { manifest: project.manifest, laborRate: project.laborRate },
      updated_at: project.savedAt,
    });
    if (error) {
      pendingProjects[id] = project; // retry on the next save or flush
      noteProjectsError(error);
    } else {
      lastSyncedAt = new Date();
      setStatus('synced');
    }
  }

  function queuePush(key, value, opts) {
    if (!client || !session) return;
    pendingValues[key] = value;
    clearTimeout(pushTimers[key]);
    if (opts && opts.immediate) {
      pushNow(key);
    } else {
      pushTimers[key] = setTimeout(() => pushNow(key), PUSH_DEBOUNCE_MS);
    }
  }

  async function pushNow(key) {
    if (!client || !session || !(key in pendingValues)) return;
    const value = pendingValues[key];
    delete pendingValues[key];
    const { error } = await client.from(TABLE).upsert({ user_id: session.user.id, key, value });
    if (error) {
      pendingValues[key] = value; // retry on the next save or flush
      setStatus('error', error.message);
    } else {
      lastSyncedAt = new Date();
      setStatus('synced');
      if (key === 'book') pushSuggestions();
    }
  }

  function flushPending() {
    for (const key of Object.keys(pendingValues)) pushNow(key);
    for (const id of Object.keys(pendingProjects)) pushProjectNow(id);
  }

  // --- Shared-book corrections (opt-in; see docs/ARCHITECTURE.md) ---

  // Roles come from takeoff_profiles (002 migration): admin reviews shared
  // corrections; dev additionally manages users. The email check is a
  // fallback so the review panel keeps working until 002 is applied.
  async function fetchProfileRole() {
    if (!client || !session) {
      profileRole = null;
      return;
    }
    try {
      const { data } = await client.from('takeoff_profiles').select('role').eq('user_id', session.user.id).maybeSingle();
      profileRole = data ? data.role : null;
    } catch (_) {
      profileRole = null;
    }
    updateUi();
  }

  function getRole() {
    return session ? profileRole || 'user' : null;
  }

  function isAdmin() {
    if (profileRole) return profileRole === 'admin' || profileRole === 'dev';
    return (getEmail() || '').toLowerCase() === ADMIN_EMAIL;
  }

  function isDev() {
    return profileRole === 'dev';
  }

  // --- Dev-only user management (RPCs + the takeoff-admin Edge Function) ---

  async function listUsers() {
    if (!client || !session) return { rows: [], error: 'Not signed in' };
    const { data, error } = await client.rpc('takeoff_list_users');
    return { rows: data || [], error: error ? error.message : null };
  }

  async function setUserRole(userId, role) {
    if (!client || !session) return 'Not signed in';
    const { error } = await client.rpc('takeoff_set_user_role', { target: userId, new_role: role });
    return error ? error.message : null;
  }

  async function adminCreateUser(email, password) {
    if (!client || !session) return { error: 'Not signed in' };
    const { data, error } = await client.functions.invoke('takeoff-admin', {
      body: { action: 'create-user', email, password },
    });
    if (error) {
      // supabase-js wraps non-2xx responses; surface the function's message
      try {
        const body = await error.context.json();
        return { error: body.error || error.message };
      } catch (_) {
        return { error: error.message };
      }
    }
    return data && data.ok ? { userId: data.userId } : { error: (data && data.error) || 'Unknown error' };
  }

  async function adminDeleteUser(userId) {
    if (!client || !session) return 'Not signed in';
    const { data, error } = await client.functions.invoke('takeoff-admin', {
      body: { action: 'delete-user', userId },
    });
    if (error) {
      try {
        const body = await error.context.json();
        return body.error || error.message;
      } catch (_) {
        return error.message;
      }
    }
    return data && data.ok ? null : (data && data.error) || 'Unknown error';
  }

  function isSharing() {
    try {
      return localStorage.getItem(SHARE_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  async function setSharing(on) {
    try {
      if (on) localStorage.setItem(SHARE_KEY, '1');
      else localStorage.removeItem(SHARE_KEY);
    } catch (_) { /* private mode: sharing just won't persist */ }
    if (on) {
      await pushSuggestions();
    } else if (client && session) {
      // stop sharing = withdraw what was shared
      await client.from(SUGGESTIONS_TABLE).delete().eq('user_id', session.user.id);
    }
    updateUi();
  }

  // Upsert the user's current correction list; prune rows they've reverted.
  // Fire-and-forget from the sync path — a failure here never blocks the
  // workspace sync itself.
  async function pushSuggestions() {
    if (!client || !session || !isSharing()) return;
    if (typeof TakeoffState === 'undefined' || !TakeoffState.getBookCorrections) return;
    try {
      const list = TakeoffState.getBookCorrections();
      const keyOf = (t, s, n) => [t, s, n].join('\u0001');
      if (list.length) {
        const rows = list.map((c) => ({
          user_id: session.user.id,
          email: getEmail(),
          tab: c.tab,
          section: c.section,
          part_name: c.name,
          kind: c.kind,
          old_value: c.old,
          new_value: c.new,
          updated_at: new Date().toISOString(),
        }));
        const { error } = await client.from(SUGGESTIONS_TABLE).upsert(rows, { onConflict: 'user_id,tab,section,part_name' });
        if (error) {
          console.warn('Takeoff: sharing corrections failed', error.message);
          return;
        }
      }
      const current = new Set(list.map((c) => keyOf(c.tab, c.section, c.name)));
      const { data } = await client.from(SUGGESTIONS_TABLE).select('id,tab,section,part_name').eq('user_id', session.user.id);
      const stale = (data || []).filter((r) => !current.has(keyOf(r.tab, r.section, r.part_name))).map((r) => r.id);
      if (stale.length) await client.from(SUGGESTIONS_TABLE).delete().in('id', stale);
    } catch (err) {
      console.warn('Takeoff: sharing corrections failed', err);
    }
  }

  // Review-panel IO (RLS: only the admin sees rows beyond their own).
  async function fetchSuggestions(status) {
    if (!client || !session) return { data: [], error: 'Not signed in' };
    const { data, error } = await client
      .from(SUGGESTIONS_TABLE)
      .select('id,user_id,email,tab,section,part_name,kind,old_value,new_value,status,updated_at')
      .eq('status', status)
      .order('updated_at', { ascending: false })
      .limit(2000);
    return { data: data || [], error: error ? error.message : null };
  }

  async function setSuggestionStatus(ids, status) {
    if (!client || !session || !ids.length) return null;
    const { error } = await client.from(SUGGESTIONS_TABLE).update({ status }).in('id', ids);
    return error ? error.message : null;
  }

  // Called by TakeoffStorage after each local save.
  function onBookSaved(data) {
    if (suppressPush) return;
    queuePush('book', data);
  }

  function onProjectSaved(project) {
    if (suppressPush) return;
    queueProjectPush(project);
  }

  function onProjectDeleted(id) {
    if (!client || !session || !projectsTableAvailable) return;
    delete pendingProjects[id];
    client.from(PROJECTS_TABLE).delete().eq('id', id).then(({ error }) => {
      if (error) noteProjectsError(error);
    });
  }

  function onAssembliesSaved(list) {
    if (suppressPush) return;
    queuePush('assemblies', list);
  }

  // --- Auth ---

  async function sendCode(email) {
    const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (!error) pendingEmail = email;
    return error ? error.message : null;
  }

  async function verifyCode(email, token) {
    const { error } = await client.auth.verifyOtp({ email, token, type: 'email' });
    return error ? error.message : null;
  }

  async function signInWithPassword(email, password) {
    const { error } = await client.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  }

  async function signOut() {
    // Local data stays on this device; only the cloud link is removed.
    for (const key of Object.keys(pushTimers)) clearTimeout(pushTimers[key]);
    await client.auth.signOut();
    pendingEmail = '';
    syncedThisLoad = false;
    setStatus('signedOut');
  }

  if (client) {
    client.auth.onAuthStateChange((event, s) => {
      session = s;
      if (session) fetchProfileRole();
      else profileRole = null;
      if (session && !syncedThisLoad) {
        syncedThisLoad = true;
        renderModal();
        syncDown();
      } else {
        updateUi();
      }
    });
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushPending();
    });
  }

  // --- UI (header button + #cloud-modal; one-time listeners) ---

  function buttonLabel() {
    if (status === 'disabled') return 'Cloud';
    if (!session) return 'Sign In';
    if (status === 'syncing') return 'Syncing…';
    if (status === 'error') return '⚠ Cloud';
    return '✓ Cloud';
  }

  function updateUi() {
    const btn = document.getElementById('cloud-btn');
    if (btn) {
      btn.textContent = buttonLabel();
      btn.title = session ? `Signed in as ${getEmail()}` + (lastSyncedAt ? ` — last synced ${lastSyncedAt.toLocaleTimeString()}` : '') : 'Sync this takeoff across devices';
      btn.classList.toggle('cloud-btn-error', status === 'error');
    }
    // the review panel is admin-only chrome
    document.getElementById('review-suggestions-btn')?.toggleAttribute('hidden', !(session && isAdmin()));
    document.getElementById('manage-users-btn')?.toggleAttribute('hidden', !(session && isDev()));
    // supplier price updates are maintainer tooling (CSV matching, JSON
    // downloads meant to be committed to the repo) — admin/dev only
    document.getElementById('mc-elliot-update-btn')?.toggleAttribute('hidden', !(session && isAdmin()));
    const modal = document.getElementById('cloud-modal');
    if (modal && modal.getAttribute('aria-hidden') === 'false') renderModal();
  }

  function renderSharingSection() {
    const sharing = isSharing();
    const corrections = typeof TakeoffState !== 'undefined' && TakeoffState.getBookCorrections ? TakeoffState.getBookCorrections() : [];
    const n = corrections.length;
    return [
      '<div class="cloud-share-section">',
      '<div class="cloud-share-head"><strong>Improve the shared book</strong>',
      `<label class="cloud-share-toggle"><input type="checkbox" id="cloud-share-toggle" ${sharing ? 'checked' : ''} /> <span>${sharing ? 'On' : 'Off'}</span></label></div>`,
      '<p class="cloud-hint">Share your price and labor corrections so the shared parts book gets more accurate for everyone. Only book edits are shared — never your takeoffs or job data.</p>',
      sharing
        ? `<p class="cloud-hint cloud-share-status">${n} correction${n === 1 ? '' : 's'} shared${n ? ' · <button type="button" id="cloud-share-view-btn" class="btn-link cloud-share-view-btn">see what’s shared</button>' : ''}</p><div id="cloud-share-list" class="cloud-share-list" hidden></div>`
        : '',
      '</div>',
    ].join('');
  }

  function attachSharingListeners() {
    document.getElementById('cloud-share-toggle')?.addEventListener('change', (e) => {
      setSharing(e.target.checked).then(renderModal);
    });
    document.getElementById('cloud-share-view-btn')?.addEventListener('click', () => {
      const listEl = document.getElementById('cloud-share-list');
      if (!listEl) return;
      if (!listEl.hidden) {
        listEl.hidden = true;
        return;
      }
      const corrections = TakeoffState.getBookCorrections();
      const fmt = (v) => (v ? `${v.labor} hrs · $${v.price || '—'}` : '');
      listEl.innerHTML = corrections
        .map((c) => {
          const change = c.kind === 'edit' ? `${fmt(c.old)} → ${fmt(c.new)}` : c.kind === 'new' ? fmt(c.new) : 'removed';
          return `<div class="cloud-share-row"><span class="cloud-share-part">${escapeHtml(c.name)}</span><span class="cloud-share-where">${escapeHtml(c.tab)} · ${escapeHtml(c.section)}</span><span class="cloud-share-change">${escapeHtml(change)}</span></div>`;
        })
        .join('') || '<p class="cloud-hint">Nothing shared yet.</p>';
      listEl.hidden = false;
    });
  }

  function renderModal() {
    const body = document.getElementById('cloud-modal-body');
    if (!body) return;
    if (status === 'disabled') {
      body.innerHTML = '<p class="cloud-hint">Cloud sync is not available (the sync library failed to load). The app keeps saving to this browser.</p>';
      return;
    }
    if (session) {
      body.innerHTML = [
        `<p>Signed in as <strong>${escapeHtml(getEmail() || '')}</strong></p>`,
        `<p class="cloud-hint">${status === 'error' ? 'Sync error: ' + escapeHtml(statusDetail) : lastSyncedAt ? 'Last synced ' + escapeHtml(lastSyncedAt.toLocaleTimeString()) : 'Waiting for first sync…'}</p>`,
        '<div class="cloud-form-row"><button type="button" id="cloud-sync-now-btn" class="btn btn-secondary">Sync Now</button>',
        '<button type="button" id="cloud-sign-out-btn" class="btn btn-secondary">Sign Out</button></div>',
        renderSharingSection(),
      ].join('');
      document.getElementById('cloud-sync-now-btn').addEventListener('click', () => {
        syncedThisLoad = true;
        syncDown();
      });
      document.getElementById('cloud-sign-out-btn').addEventListener('click', signOut);
      attachSharingListeners();
      return;
    }
    if (pendingEmail) {
      body.innerHTML = [
        `<p>Enter the 6-digit code sent to <strong>${escapeHtml(pendingEmail)}</strong>.</p>`,
        '<div class="cloud-form-row"><input type="text" id="cloud-code-input" class="cloud-code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" />',
        '<button type="button" id="cloud-verify-btn" class="btn btn-success">Verify</button></div>',
        '<p class="cloud-hint" id="cloud-modal-msg"></p>',
        '<button type="button" id="cloud-restart-btn" class="btn btn-link">Use a different email</button>',
      ].join('');
      const verify = async () => {
        const token = document.getElementById('cloud-code-input').value.trim();
        if (token.length < 6) return;
        const msg = document.getElementById('cloud-modal-msg');
        msg.textContent = 'Verifying…';
        const err = await verifyCode(pendingEmail, token);
        if (err) msg.textContent = err;
        else pendingEmail = ''; // onAuthStateChange re-renders
      };
      document.getElementById('cloud-verify-btn').addEventListener('click', verify);
      document.getElementById('cloud-code-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') verify();
      });
      document.getElementById('cloud-restart-btn').addEventListener('click', () => {
        pendingEmail = '';
        renderModal();
      });
      document.getElementById('cloud-code-input').focus();
      return;
    }
    body.innerHTML = [
      '<p>Sign in to sync this takeoff across devices.</p>',
      '<div class="cloud-form-row"><input type="email" id="cloud-email-input" class="cloud-email-input" placeholder="you@example.com" autocomplete="email" /></div>',
      '<div class="cloud-form-row"><input type="password" id="cloud-password-input" class="cloud-email-input" placeholder="Password" autocomplete="current-password" />',
      '<button type="button" id="cloud-password-btn" class="btn btn-success">Sign In</button></div>',
      '<p class="cloud-hint" id="cloud-modal-msg"></p>',
      '<div class="cloud-or-divider"><span></span>or<span></span></div>',
      '<button type="button" id="cloud-send-code-btn" class="btn btn-secondary cloud-send-code-btn">Email me a 6-digit sign-in code</button>',
      '<p class="cloud-hint">No password, or new here? The emailed code signs you in — and creates your account if you don’t have one yet.</p>',
    ].join('');
    const getEmailValue = () => document.getElementById('cloud-email-input').value.trim();
    const msgEl = () => document.getElementById('cloud-modal-msg');
    const signIn = async () => {
      const email = getEmailValue();
      const password = document.getElementById('cloud-password-input').value;
      if (!email || !email.includes('@') || !password) return;
      msgEl().textContent = 'Signing in…';
      const err = await signInWithPassword(email, password);
      if (err) msgEl().textContent = err; // onAuthStateChange re-renders on success
    };
    const send = async () => {
      const email = getEmailValue();
      if (!email || !email.includes('@')) {
        msgEl().textContent = 'Enter your email first.';
        return;
      }
      msgEl().textContent = 'Sending code…';
      const err = await sendCode(email);
      if (err) msgEl().textContent = err;
      else renderModal();
    };
    document.getElementById('cloud-password-btn').addEventListener('click', signIn);
    document.getElementById('cloud-password-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') signIn();
    });
    document.getElementById('cloud-send-code-btn').addEventListener('click', send);
    document.getElementById('cloud-email-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('cloud-password-input').focus();
    });
    document.getElementById('cloud-email-input').focus();
  }

  function openModal() {
    const modal = document.getElementById('cloud-modal');
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'false');
    renderModal();
  }

  function closeModal() {
    const modal = document.getElementById('cloud-modal');
    if (modal) modal.setAttribute('aria-hidden', 'true');
  }

  document.getElementById('cloud-btn')?.addEventListener('click', openModal);
  document.getElementById('cloud-modal-close')?.addEventListener('click', closeModal);
  document.getElementById('cloud-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.addEventListener('keydown', function cloudModalKeyHandler(e) {
    const modal = document.getElementById('cloud-modal');
    if (!modal || modal.getAttribute('aria-hidden') !== 'false') return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
    }
  });
  updateUi();

  return { isSignedIn, getEmail, isAdmin, isDev, getRole, listUsers, setUserRole, adminCreateUser, adminDeleteUser, onBookSaved, onProjectSaved, onProjectDeleted, onAssembliesSaved, flushPending, openModal, fetchSuggestions, setSuggestionStatus };
})();
