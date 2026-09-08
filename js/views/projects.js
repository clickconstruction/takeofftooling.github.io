/**
 * TakeoffProjectsView — the project switcher in the header (current project
 * name + "Saved …" line + dropdown) and the Manage Projects modal
 * (#projects-modal): rename, duplicate, archive, delete, create. Management
 * verbs mirror Count Tooling's Manage Projects. The open project is pinned to
 * the top of both lists and can be neither deleted nor archived. The switcher
 * lists live bids only; closed-out ones are a section of the modal.
 */

const TakeoffProjectsView = (function () {
  function escapeHtml(str) {
    return TakeoffUtils.escapeHtml(str);
  }

  // Ages an estimator can act on. "Is it saved?" is a question about the last
  // few seconds, so the minute branch comes first — day granularity alone
  // can't tell "saved 2 seconds ago" from "saved this morning".
  function fmtAgo(iso) {
    const t = Date.parse(iso) || 0;
    if (!t) return '';
    const mins = Math.floor((Date.now() - t) / 60000);
    if (mins <= 0) return 'just now';
    if (mins === 1) return '1 min ago';
    if (mins < 60) return `${mins} min ago`;
    const days = Math.floor((Date.now() - t) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 14) return `${days}d ago`;
    if (days < 60) return `${Math.floor(days / 7)}w ago`;
    return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // Bids are named by building and then by area, so three names can share the
  // first forty characters and differ only in the last five. A tail ellipsis
  // renders them as one identical line; the middle one keeps the suffix.
  function middleEllipsis(name, max) {
    const s = String(name || '');
    if (s.length <= max) return s;
    const head = Math.ceil((max - 1) / 2);
    const tail = Math.max(1, max - 1 - head);
    return `${s.slice(0, head).trimEnd()}…${s.slice(s.length - tail)}`;
  }

  // "(copy)" and "(shared 3/4)" are bookkeeping the app added, not part of the
  // name the estimator typed — they render as a chip so they stop eating the
  // width the real name needs.
  const CHIP_RE = /\s*\((copy(?: \d+)?|shared[^()]*)\)\s*$/i;

  function splitChip(name) {
    const s = String(name || '');
    const m = CHIP_RE.exec(s);
    if (!m) return { stem: s, chip: '' };
    return { stem: s.slice(0, m.index), chip: m[1] };
  }

  function isArchived(p) {
    return !!(p && p.archived);
  }

  // The open bid stays at the top: sorting the whole list by updatedAt means it
  // moves every time you leave it, so it is never where you last saw it.
  // The switcher lists live bids only — closed-out bids are behind Manage
  // projects. The open bid is always in it, even if it is archived: it is the
  // bid the header names, so leaving it out would show a menu with nothing
  // marked as current.
  function switcherProjects() {
    const currentId = TakeoffState.getCurrentProject().id;
    const list = TakeoffState.getProjects();
    return list.filter((p) => p.id === currentId).concat(list.filter((p) => p.id !== currentId && !isArchived(p)));
  }

  // Closed-out bids, most recently closed first: "what did I just put away" is
  // the question this list answers, and updatedAt can't answer it.
  function archivedProjects() {
    return TakeoffState.getProjects()
      .filter(isArchived)
      .sort((a, b) => (Date.parse(b.archivedAt) || 0) - (Date.parse(a.archivedAt) || 0));
  }

  // Every line on the bid — parents and their components. The column says
  // "Lines"; counting only the top level under-reported an 11-line bid as 8.
  function countLines(manifest) {
    if (!Array.isArray(manifest)) return 0;
    let n = 0;
    for (const item of manifest) {
      if (!item || item.parentId) continue;
      n += 1;
      if (Array.isArray(item.children)) n += item.children.length;
    }
    return n;
  }

  // ---------- "Saved …" line under the project name ----------

  // Read-only probe of the cloud module: it does not export its sync clock
  // today, so the suffix simply doesn't render until it does.
  function cloudSyncedAt() {
    try {
      if (typeof TakeoffCloud === 'undefined') return null;
      if (typeof TakeoffCloud.isSignedIn !== 'function' || !TakeoffCloud.isSignedIn()) return null;
      if (typeof TakeoffCloud.getLastSyncedAt !== 'function') return null;
      const raw = TakeoffCloud.getLastSyncedAt();
      if (!raw) return null;
      const d = raw instanceof Date ? raw : new Date(raw);
      return isNaN(d.getTime()) ? null : d;
    } catch (_) {
      return null;
    }
  }

  function savedLine() {
    try {
      const cur = TakeoffState.getCurrentProject();
      if (!cur || !cur.id) return '';
      const entry = TakeoffState.getProjects().find((p) => p.id === cur.id);
      const ago = entry ? fmtAgo(entry.updatedAt) : '';
      if (!ago) return '';
      let text = `Saved ${ago}`;
      const synced = cloudSyncedAt();
      if (synced) text += ` · synced ${synced.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
      return text;
    } catch (_) {
      return '';
    }
  }

  function updateSavedLine() {
    const line = savedLine();
    const el = document.getElementById('project-switch-saved');
    if (el) el.textContent = line;
    const btn = document.getElementById('project-switch-btn');
    if (btn) {
      const name = TakeoffState.getCurrentProject().name || '';
      btn.title = `${name}${line ? ` — ${line}` : ''}\nSwitch project`;
    }
  }

  // Nothing re-renders the header on a keystroke (field edits deliberately
  // skip render), so the age ticks on its own.
  setInterval(updateSavedLine, 5000);

  function updateHeader() {
    const project = TakeoffState.getCurrentProject();
    const name = project.name;
    const el = document.getElementById('project-switch-name');
    const { stem, chip } = splitChip(name);
    if (el) el.textContent = middleEllipsis(stem, 30);
    const chipEl = document.getElementById('project-switch-chip');
    if (chipEl) {
      chipEl.textContent = chip;
      chipEl.hidden = !chip;
    }
    document.title = `${name} — Takeoff Tooling`;
    updateSavedLine();
    // the CountTooling plans link the counts came from (set by the import)
    const plans = document.getElementById('project-plans-link');
    if (plans) {
      if (project.plansUrl) {
        plans.href = project.plansUrl;
        plans.hidden = false;
      } else {
        plans.hidden = true;
        plans.removeAttribute('href');
      }
    }
  }

  // ---------- header dropdown ----------

  let menuRenaming = false; // the open bid's menu row is an input

  function menuEl() {
    return document.getElementById('project-menu');
  }

  function isMenuOpen() {
    return menuEl()?.getAttribute('aria-hidden') === 'false';
  }

  function closeMenu() {
    menuRenaming = false;
    menuEl()?.setAttribute('aria-hidden', 'true');
    document.getElementById('project-switch-btn')?.setAttribute('aria-expanded', 'false');
  }

  function openMenu() {
    const el = menuEl();
    if (!el) return;
    const current = TakeoffState.getCurrentProject();
    const items = switcherProjects()
      .map((p) => {
        if (menuRenaming && p.id === current.id) {
          return `
        <div class="project-menu-rename">
          <input type="text" id="project-menu-rename-input" aria-label="Project name" value="${escapeHtml(p.name)}" autocomplete="off" />
          <button type="button" class="btn btn-success" id="project-menu-rename-save">Save</button>
        </div>`;
        }
        const { stem, chip } = splitChip(p.name);
        return `
        <button type="button" class="project-menu-item${p.id === current.id ? ' active' : ''}" data-id="${escapeHtml(p.id)}" title="${escapeHtml(p.name)}">
          <span class="project-menu-dot"></span>
          <span class="project-menu-name">${escapeHtml(middleEllipsis(stem, 26))}</span>
          ${chip ? `<span class="project-chip">${escapeHtml(chip)}</span>` : ''}
          <span class="project-menu-ago">${escapeHtml(fmtAgo(p.updatedAt))}</span>
        </button>`;
      })
      .join('');
    const archivedCount = archivedProjects().length;
    el.innerHTML =
      `<div class="project-menu-list">${items}</div>` +
      `<div class="project-menu-footer">
        ${menuRenaming
          ? '<button type="button" class="btn btn-secondary" id="project-menu-rename-cancel">Cancel</button>'
          : '<button type="button" class="btn btn-secondary" id="project-menu-rename">Rename</button>'}
        <button type="button" class="btn btn-primary" id="project-menu-new">New project</button>
        <button type="button" class="btn btn-secondary" id="project-menu-manage">Manage projects…</button>
        ${archivedCount
          ? `<button type="button" class="project-menu-archived" id="project-menu-archived">${archivedCount} archived</button>`
          : ''}
      </div>`;
    el.setAttribute('aria-hidden', 'false');
    document.getElementById('project-switch-btn')?.setAttribute('aria-expanded', 'true');
    if (menuRenaming) {
      const input = document.getElementById('project-menu-rename-input');
      input?.focus();
      input?.select();
    }
  }

  function commitMenuRename() {
    const input = document.getElementById('project-menu-rename-input');
    if (input) applyRename(TakeoffState.getCurrentProject().id, input.value);
    closeMenu();
  }

  // A flow editor holds a temp buffer keyed on a row id from the open bid, so
  // it has to be closed before the manifest underneath is swapped.
  // navigateToManifest() asks when there are unsaved edits; if the estimator
  // keeps them we stay put and the switch is abandoned.
  function leaveFlowEditor() {
    if (TakeoffState.getCurrentView() === 'manifest') return true;
    TakeoffApp.navigateToManifest();
    return TakeoffState.getCurrentView() === 'manifest';
  }

  function switchTo(id) {
    const from = { fromView: TakeoffState.getCurrentView(), flowDirty: !!TakeoffState.getFlowDirty() }; // read before the editor is left
    if (!leaveFlowEditor()) return false;
    if (TakeoffState.switchProject(id)) {
      TakeoffEvents.log('project_switched', from);
      TakeoffApp.render();
      updateHeader();
    }
    return true;
  }

  // ---------- inline create row (in the Manage Projects modal footer) ----------

  // true while the modal is standing in for "name this job" rather than
  // "manage the list": on Create it gets out of the way again.
  let openedForCreate = false;

  function showCreateRow() {
    const row = document.getElementById('projects-new-row');
    if (!row) return;
    row.hidden = false;
    const input = document.getElementById('projects-new-name');
    if (input) {
      input.value = '';
      input.focus();
    }
  }

  function hideCreateRow() {
    const row = document.getElementById('projects-new-row');
    if (row) row.hidden = true;
    const input = document.getElementById('projects-new-name');
    if (input) input.value = '';
  }

  // A bid nobody has touched is a placeholder, not work: naming a job should
  // claim it rather than leave it behind as a second "Untitled project".
  function openBidIsPristine() {
    try {
      const cur = TakeoffState.getCurrentProject();
      if (!cur || cur.name !== 'Untitled project') return false;
      if (TakeoffState.getLaborRate()) return false;
      for (const item of TakeoffState.getManifest() || []) {
        if (!item) continue;
        if ((item.description || '').trim()) return false;
        if (item.type) return false;
        if (Array.isArray(item.children) && item.children.length) return false;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function createFromRow() {
    if (!leaveFlowEditor()) return;
    const input = document.getElementById('projects-new-name');
    const name = input ? input.value : '';
    if (openBidIsPristine() && name.trim()) {
      TakeoffState.setProjectName(name);
      TakeoffState.persistNow();
    } else {
      TakeoffState.createProject(name);
    }
    hideCreateRow();
    TakeoffApp.render();
    updateHeader();
    // the estimator came here to name a job, not to manage a list
    if (openedForCreate) closeModal();
    else renderModal();
  }

  // ---------- Manage Projects modal ----------

  let renamingId = null; // the project whose name cell is an input
  let confirmDeleteId = null; // the project whose row is asking to be deleted
  let archivedOpen = false; // the Archived section stays shut until asked for

  function isModalOpen() {
    return document.getElementById('projects-modal')?.getAttribute('aria-hidden') === 'false';
  }

  // opts.create opens with the inline new-project row showing and focused;
  // opts.archived opens with the Archived section expanded (the switcher's
  // "N archived" line lands here)
  function openModal(opts) {
    closeMenu();
    openedForCreate = !!(opts && opts.create);
    renamingId = null;
    confirmDeleteId = null;
    if (opts && opts.archived) archivedOpen = true;
    document.getElementById('projects-modal')?.setAttribute('aria-hidden', 'false');
    renderModal();
    if (openedForCreate) showCreateRow();
    else hideCreateRow();
    if (opts && opts.archived) {
      document.getElementById('projects-archived')?.scrollIntoView({ block: 'nearest' });
    }
  }

  function closeModal() {
    const modal = document.getElementById('projects-modal');
    if (modal?.contains(document.activeElement)) document.activeElement?.blur();
    modal?.setAttribute('aria-hidden', 'true');
    hideCreateRow();
    renamingId = null;
    confirmDeleteId = null;
    openedForCreate = false;
  }

  // One pass over the list. The line count needs the stored document anyway,
  // so this is also where an index entry cloud sync left behind — a bid closed
  // out on another device arrives in the document, not the index — is healed.
  // The open bid's count comes from state: its stored copy lags the 400 ms save
  // debounce, so reading storage left the count one behind what was just typed.
  function projectFacts() {
    const current = TakeoffState.getCurrentProject();
    return TakeoffState.getProjects().map((entry) => {
      const isOpen = entry.id === current.id;
      const data = isOpen ? null : TakeoffStorage.loadProject(entry.id);
      const archived = isOpen ? TakeoffState.isProjectArchived() : !!(data && data.archived === true);
      const archivedAt = (data && data.archivedAt) || entry.archivedAt;
      if (archived !== isArchived(entry)) TakeoffState.reconcileArchivedEntry(entry.id, archived, archivedAt);
      return {
        p: entry,
        isOpen,
        archived,
        archivedAt,
        count: isOpen ? countLines(TakeoffState.getManifest()) : countLines(data && data.manifest),
      };
    });
  }

  function renderModal() {
    const listEl = document.getElementById('projects-list');
    if (!listEl) return;
    const facts = projectFacts();
    // the open bid is pinned to the top of the live list, as in the switcher
    const live = facts.filter((f) => f.isOpen && !f.archived).concat(facts.filter((f) => !f.isOpen && !f.archived));
    const archived = facts
      .filter((f) => f.archived)
      .sort((a, b) => (Date.parse(b.archivedAt) || 0) - (Date.parse(a.archivedAt) || 0));

    const rowHtml = ({ p, isOpen, archived: isClosed, count }) => {
        if (p.id === renamingId) {
          return `
        <tr data-id="${escapeHtml(p.id)}" class="projects-renaming">
          <td colspan="3"><div class="inline-name-row projects-rename-row"><input type="text" class="projects-rename-input" aria-label="Project name" value="${escapeHtml(p.name)}" autocomplete="off" /></div></td>
          <td><div class="projects-actions">
            <button type="button" class="btn btn-success projects-rename-save" data-id="${escapeHtml(p.id)}">Save</button>
            <button type="button" class="btn btn-secondary projects-rename-cancel">Cancel</button>
          </div></td>
        </tr>`;
        }
        if (p.id === confirmDeleteId) {
          return `
        <tr data-id="${escapeHtml(p.id)}" class="projects-confirming">
          <td colspan="3" class="projects-confirm-text">Delete "${escapeHtml(p.name)}" and its ${count} line${count === 1 ? '' : 's'}? This can't be undone.</td>
          <td><div class="projects-actions">
            <button type="button" class="btn btn-secondary projects-delete-yes" data-id="${escapeHtml(p.id)}">Delete</button>
            <button type="button" class="btn btn-secondary projects-delete-no">Cancel</button>
          </div></td>
        </tr>`;
        }
        const { stem, chip } = splitChip(p.name);
        // Archive is the closed-out state, not a delete: the open bid can't take
        // it (open another one first), the same reason Delete gives.
        const archiveBtn = isClosed
          ? `<button type="button" class="btn btn-secondary projects-unarchive-btn" data-id="${escapeHtml(p.id)}">Unarchive</button>`
          : isOpen
            ? '<button type="button" class="btn btn-secondary projects-archive-btn" disabled title="This is the bid you have open — open another bid first">Archive</button>'
            : `<button type="button" class="btn btn-secondary projects-archive-btn" data-id="${escapeHtml(p.id)}">Archive</button>`;
        return `
        <tr data-id="${escapeHtml(p.id)}">
          <td><span class="projects-name" title="${escapeHtml(p.name)}">${escapeHtml(middleEllipsis(stem, 46))}</span>${chip ? `<span class="project-chip">${escapeHtml(chip)}</span>` : ''}${isOpen ? '<span class="projects-open-chip">Open</span>' : ''}</td>
          <td class="projects-meta" data-label="Lines">${count}</td>
          <td class="projects-meta" data-label="Last edited">${escapeHtml(fmtAgo(p.updatedAt))}</td>
          <td><div class="projects-actions">
            ${isOpen ? '' : `<button type="button" class="btn btn-secondary projects-switch-btn" data-id="${escapeHtml(p.id)}">Open</button>`}
            <button type="button" class="btn btn-secondary projects-rename-btn" data-id="${escapeHtml(p.id)}">Rename</button>
            <button type="button" class="btn btn-secondary projects-duplicate-btn" data-id="${escapeHtml(p.id)}">Duplicate</button>
            ${archiveBtn}
            ${isOpen
              ? '<button type="button" class="btn btn-secondary projects-delete-btn" disabled title="This is the bid you have open — open another bid first">Delete</button>'
              : `<button type="button" class="btn btn-secondary projects-delete-btn" data-id="${escapeHtml(p.id)}">Delete</button>`}
          </div></td>
        </tr>`;
    };

    const table = (facts_, cls) => `
      <table class="projects-table${cls ? ` ${cls}` : ''}">
        <thead><tr><th>Name</th><th>Lines</th><th>Last edited</th><th></th></tr></thead>
        <tbody>${facts_.map(rowHtml).join('')}</tbody>
      </table>`;

    // With nothing closed out there is one list and no headings to read past.
    listEl.innerHTML = archived.length
      ? `<h3 class="projects-section-title">Live</h3>
      ${table(live)}
      <details class="projects-archived" id="projects-archived"${archivedOpen ? ' open' : ''}>
        <summary class="projects-section-title">Archived (${archived.length})</summary>
        ${table(archived, 'projects-table-archived')}
      </details>`
      : table(live);
    const countEl = document.getElementById('projects-count');
    if (countEl) {
      countEl.textContent = archived.length
        ? `${live.length} live · ${archived.length} archived`
        : `${live.length} project${live.length === 1 ? '' : 's'}`;
    }
    if (renamingId) {
      const input = listEl.querySelector('.projects-rename-input');
      input?.focus();
      input?.select();
    }
  }

  // A rename is not an edit to the bid: stamping updatedAt moved the renamed
  // bid to row 1 and pushed everything else down a line.
  function applyRename(id, rawName) {
    const current = TakeoffState.getCurrentProject();
    const name = (rawName || '').trim();
    if (!name) return;
    if (id === current.id) {
      TakeoffState.setProjectName(name);
      TakeoffState.persistNow();
    } else {
      const data = TakeoffStorage.loadProject(id);
      if (!data) return;
      data.name = name;
      TakeoffStorage.saveProject(data);
      const idx = TakeoffStorage.loadProjectsIndex();
      const entry = idx && idx.projects.find((p) => p.id === id);
      if (entry) {
        entry.name = name;
        TakeoffStorage.saveProjectsIndex(idx);
      }
    }
    if (isModalOpen()) renderModal();
    updateHeader();
  }

  // ---------- one-time listeners ----------

  document.getElementById('project-switch-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isMenuOpen()) closeMenu();
    else openMenu();
  });

  document.getElementById('project-menu')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.target.closest('#project-menu-rename')) {
      menuRenaming = true;
      openMenu();
      return;
    }
    if (e.target.closest('#project-menu-rename-cancel')) {
      menuRenaming = false;
      openMenu();
      return;
    }
    if (e.target.closest('#project-menu-rename-save')) {
      commitMenuRename();
      return;
    }
    if (e.target.closest('#project-menu-new')) {
      openModal({ create: true });
      return;
    }
    if (e.target.closest('#project-menu-manage')) {
      openModal();
      return;
    }
    if (e.target.closest('#project-menu-archived')) {
      openModal({ archived: true });
      return;
    }
    const item = e.target.closest('.project-menu-item');
    if (item) {
      const id = item.dataset.id;
      closeMenu();
      switchTo(id);
    }
  });

  document.getElementById('project-menu')?.addEventListener('keydown', (e) => {
    if (!e.target.closest('#project-menu-rename-input')) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      commitMenuRename();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      menuRenaming = false;
      openMenu();
    }
  });

  document.addEventListener('click', () => closeMenu());

  document.getElementById('projects-modal-close')?.addEventListener('click', closeModal);
  document.getElementById('projects-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'projects-modal') closeModal();
  });
  document.getElementById('projects-new-btn')?.addEventListener('click', () => {
    const row = document.getElementById('projects-new-row');
    if (row && !row.hidden) hideCreateRow();
    else showCreateRow();
  });
  document.getElementById('projects-new-create')?.addEventListener('click', createFromRow);
  document.getElementById('projects-new-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createFromRow();
    // Esc closes from the field: it used to be swallowed here, so two presses
    // shut nothing and the dialog stayed up with the typed name still in it.
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeModal();
    }
  });

  document.getElementById('projects-list')?.addEventListener('click', (e) => {
    const sw = e.target.closest('.projects-switch-btn');
    if (sw) {
      switchTo(sw.dataset.id);
      renderModal();
      return;
    }
    const rn = e.target.closest('.projects-rename-btn');
    if (rn) {
      renamingId = rn.dataset.id;
      confirmDeleteId = null;
      renderModal();
      return;
    }
    const rnSave = e.target.closest('.projects-rename-save');
    if (rnSave) {
      const input = rnSave.closest('tr')?.querySelector('.projects-rename-input');
      const value = input ? input.value : '';
      renamingId = null;
      applyRename(rnSave.dataset.id, value);
      renderModal();
      return;
    }
    if (e.target.closest('.projects-rename-cancel')) {
      renamingId = null;
      renderModal();
      return;
    }
    const dup = e.target.closest('.projects-duplicate-btn');
    if (dup) {
      TakeoffState.duplicateProject(dup.dataset.id);
      renderModal();
      return;
    }
    // the section remembers whether it was open across the re-render below
    const summary = e.target.closest('#projects-archived > summary');
    if (summary) {
      archivedOpen = !archivedOpen;
      return;
    }
    const arch = e.target.closest('.projects-archive-btn');
    if (arch && !arch.disabled) {
      TakeoffState.setProjectArchived(arch.dataset.id, true);
      archivedOpen = true; // the row leaves the live list — show where it went
      confirmDeleteId = null;
      renderModal();
      return;
    }
    const unarch = e.target.closest('.projects-unarchive-btn');
    if (unarch) {
      TakeoffState.setProjectArchived(unarch.dataset.id, false);
      confirmDeleteId = null;
      renderModal();
      return;
    }
    const del = e.target.closest('.projects-delete-btn');
    if (del && !del.disabled) {
      confirmDeleteId = del.dataset.id;
      renamingId = null;
      renderModal();
      return;
    }
    const yes = e.target.closest('.projects-delete-yes');
    if (yes) {
      TakeoffState.deleteProject(yes.dataset.id);
      confirmDeleteId = null;
      renderModal();
      return;
    }
    if (e.target.closest('.projects-delete-no')) {
      confirmDeleteId = null;
      renderModal();
    }
  });

  document.getElementById('projects-list')?.addEventListener('keydown', (e) => {
    const input = e.target.closest('.projects-rename-input');
    if (!input) return;
    if (e.key === 'Enter') {
      const id = input.closest('tr')?.dataset.id;
      const value = input.value;
      renamingId = null;
      applyRename(id, value);
      renderModal();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      renamingId = null;
      renderModal();
    }
  });

  document.addEventListener('keydown', function projectsKeyHandler(e) {
    if (e.key !== 'Escape') return;
    if (isMenuOpen()) {
      closeMenu();
      return;
    }
    if (isModalOpen()) {
      e.preventDefault();
      closeModal();
    }
  });

  return { updateHeader, openModal, fmtAgo, middleEllipsis, splitChip, countLines };
})();
