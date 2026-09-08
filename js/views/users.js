/**
 * TakeoffUsersView — the Manage Users modal (#users-modal), dev role only:
 * list accounts with role/created/last-seen, change roles (RPC
 * takeoff_set_user_role), and add/delete accounts (takeoff-admin Edge
 * Function). The menu entry is shown by cloud.js when the signed-in
 * profile's role is 'dev'; every operation is re-checked server-side.
 *
 * This is a directory, not a gate: the emailed sign-in code creates an
 * account for any address, so adding one here is about giving it a role and
 * seeing it in the list. It sets no password — there is no safe way to hand
 * one over — and passwords are the account's own business (Cloud Sync).
 */

const TakeoffUsersView = (function () {
  const ROLES = ['user', 'admin', 'dev'];

  function escapeHtml(str) {
    return TakeoffUtils.escapeHtml(str);
  }

  function fmtDate(iso) {
    const t = Date.parse(iso) || 0;
    return t ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  }

  function isModalOpen() {
    return document.getElementById('users-modal')?.getAttribute('aria-hidden') === 'false';
  }

  function openModal() {
    document.getElementById('users-modal')?.setAttribute('aria-hidden', 'false');
    load();
  }

  function closeModal() {
    const modal = document.getElementById('users-modal');
    if (modal?.contains(document.activeElement)) document.activeElement?.blur();
    modal?.setAttribute('aria-hidden', 'true');
  }

  function setStatus(text, isError) {
    const el = document.getElementById('users-status');
    if (el) {
      el.textContent = text || '';
      el.classList.toggle('users-status-error', !!isError);
    }
  }

  async function load() {
    const listEl = document.getElementById('users-list');
    if (!listEl) return;
    listEl.innerHTML = '<p class="users-loading">Loading users...</p>';
    setStatus('');
    const { rows, error } = await TakeoffCloud.listUsers();
    if (error) {
      listEl.innerHTML = `<p class="users-loading">Could not load users: ${escapeHtml(error)}</p>`;
      return;
    }
    if (!rows.length) {
      // the RPC returns no rows for non-dev callers by design
      listEl.innerHTML = '<p class="users-loading">No users visible — the dev role is required.</p>';
      return;
    }
    const me = (TakeoffCloud.getEmail() || '').toLowerCase();
    listEl.innerHTML = `
      <table class="users-table">
        <thead><tr><th>Email</th><th>Role</th><th>Created</th><th>Last sign-in</th><th></th></tr></thead>
        <tbody>
          ${rows
            .map((u) => {
              const self = (u.email || '').toLowerCase() === me;
              return `
          <tr data-id="${escapeHtml(u.user_id)}">
            <td class="users-email">${escapeHtml(u.email || '')}${u.is_digital_twin ? '<span class="users-twin-chip" title="Digital twin — an agent-operated account (never a person)">🤖 twin</span>' : ''}${self ? '<span class="users-you-chip">You</span>' : ''}</td>
            <td>
              <select class="users-role-select" data-id="${escapeHtml(u.user_id)}" ${self ? 'disabled title="You can’t change your own role"' : ''}>
                ${ROLES.map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}
              </select>
            </td>
            <td class="users-meta">${fmtDate(u.created_at)}</td>
            <td class="users-meta">${fmtDate(u.last_sign_in_at)}</td>
            <td>${self ? '' : `<button type="button" class="btn btn-secondary users-delete-btn" data-id="${escapeHtml(u.user_id)}" data-email="${escapeHtml(u.email || '')}">Delete</button>`}</td>
          </tr>`;
            })
            .join('')}
        </tbody>
      </table>`;
  }

  // ---------- one-time listeners ----------

  document.getElementById('manage-users-btn')?.addEventListener('click', openModal);
  document.getElementById('users-modal-close')?.addEventListener('click', closeModal);
  document.getElementById('users-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'users-modal') closeModal();
  });
  document.getElementById('users-refresh-btn')?.addEventListener('click', load);

  document.getElementById('users-list')?.addEventListener('change', async (e) => {
    const sel = e.target.closest('.users-role-select');
    if (!sel) return;
    setStatus('Saving role...');
    const err = await TakeoffCloud.setUserRole(sel.dataset.id, sel.value);
    if (err) {
      setStatus(err, true);
      load();
    } else {
      setStatus(`Role saved: ${sel.value}`);
      // The role this session runs on is read once at sign-in; re-read it so
      // a role change is not waiting on a sign-out to take effect.
      TakeoffCloud.refreshRole?.();
    }
  });

  document.getElementById('users-list')?.addEventListener('click', async (e) => {
    const del = e.target.closest('.users-delete-btn');
    if (!del) return;
    if (!confirm(`Delete the account ${del.dataset.email}? Their cloud data rows are removed with it. This can't be undone.`)) return;
    setStatus('Deleting...');
    const err = await TakeoffCloud.adminDeleteUser(del.dataset.id);
    if (err) setStatus(err, true);
    else setStatus('Account deleted.');
    load();
  });

  document.getElementById('users-add-btn')?.addEventListener('click', async () => {
    const email = document.getElementById('users-add-email')?.value.trim();
    if (!email || !email.includes('@')) {
      setStatus('Enter the email address for the account.', true);
      return;
    }
    setStatus('Creating account...');
    const result = await TakeoffCloud.adminCreateUser(email);
    if (result.error) {
      setStatus(result.error, true);
      return;
    }
    document.getElementById('users-add-email').value = '';
    // No password is set here: there is no safe way to hand one over and the
    // app sends no mail. They sign in with the emailed code and set their own
    // password in Cloud Sync.
    setStatus(`Account created: ${email}. They sign in with the emailed code and can set a password from Cloud Sync.`);
    load();
  });

  document.addEventListener('keydown', function usersKeyHandler(e) {
    if (e.key === 'Escape' && isModalOpen()) {
      e.preventDefault();
      closeModal();
    }
  });

  return { openModal };
})();
