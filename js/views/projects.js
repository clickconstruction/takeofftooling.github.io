/**
 * TakeoffProjectsView — the project switcher in the header (current project
 * name + dropdown) and the Manage Projects modal (#projects-modal): rename,
 * duplicate, delete, create. Management verbs mirror Count Tooling's Manage
 * Projects. The open project is marked and can't be deleted.
 */

const TakeoffProjectsView = (function () {
  function escapeHtml(str) {
    return TakeoffUtils.escapeHtml(str);
  }

  function fmtAgo(iso) {
    const t = Date.parse(iso) || 0;
    if (!t) return '';
    const days = Math.floor((Date.now() - t) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 14) return `${days}d ago`;
    if (days < 60) return `${Math.floor(days / 7)}w ago`;
    return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function updateHeader() {
    const name = TakeoffState.getCurrentProject().name;
    const el = document.getElementById('project-switch-name');
    if (el) el.textContent = name;
    document.title = `${name} — Takeoff Tooling`;
  }

  // ---------- header dropdown ----------

  function menuEl() {
    return document.getElementById('project-menu');
  }

  function isMenuOpen() {
    return menuEl()?.getAttribute('aria-hidden') === 'false';
  }

  function closeMenu() {
    menuEl()?.setAttribute('aria-hidden', 'true');
    document.getElementById('project-switch-btn')?.setAttribute('aria-expanded', 'false');
  }

  function openMenu() {
    const el = menuEl();
    if (!el) return;
    const current = TakeoffState.getCurrentProject();
    el.innerHTML =
      TakeoffState.getProjects()
        .map(
          (p) => `
        <button type="button" class="project-menu-item${p.id === current.id ? ' active' : ''}" data-id="${escapeHtml(p.id)}">
          <span class="project-menu-dot"></span>
          <span class="project-menu-name">${escapeHtml(p.name)}</span>
          <span class="project-menu-ago">${fmtAgo(p.updatedAt)}</span>
        </button>`
        )
        .join('') +
      `<div class="project-menu-footer">
        <button type="button" class="btn btn-primary" id="project-menu-new">+ New project</button>
        <button type="button" class="btn btn-secondary" id="project-menu-manage">Manage projects…</button>
      </div>`;
    el.setAttribute('aria-hidden', 'false');
    document.getElementById('project-switch-btn')?.setAttribute('aria-expanded', 'true');
  }

  function switchTo(id) {
    if (TakeoffState.switchProject(id)) {
      TakeoffApp.render();
      updateHeader();
    }
  }

  // ---------- inline create row (in the Manage Projects modal footer) ----------

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
  }

  function createFromRow() {
    const input = document.getElementById('projects-new-name');
    TakeoffState.createProject(input ? input.value : '');
    hideCreateRow();
    TakeoffApp.render();
    updateHeader();
    renderModal();
  }

  // ---------- Manage Projects modal ----------

  function isModalOpen() {
    return document.getElementById('projects-modal')?.getAttribute('aria-hidden') === 'false';
  }

  // opts.create opens with the inline new-project row showing and focused
  function openModal(opts) {
    closeMenu();
    document.getElementById('projects-modal')?.setAttribute('aria-hidden', 'false');
    renderModal();
    if (opts && opts.create) showCreateRow();
    else hideCreateRow();
  }

  function closeModal() {
    const modal = document.getElementById('projects-modal');
    if (modal?.contains(document.activeElement)) document.activeElement?.blur();
    modal?.setAttribute('aria-hidden', 'true');
    hideCreateRow();
  }

  function renderModal() {
    const listEl = document.getElementById('projects-list');
    if (!listEl) return;
    const current = TakeoffState.getCurrentProject();
    const projects = TakeoffState.getProjects();
    const rows = projects
      .map((p) => {
        const data = TakeoffStorage.loadProject(p.id);
        const count = data && Array.isArray(data.manifest) ? data.manifest.filter((m) => !m.parentId).length : 0;
        const isOpen = p.id === current.id;
        return `
        <tr data-id="${escapeHtml(p.id)}">
          <td><span class="projects-name">${escapeHtml(p.name)}</span>${isOpen ? '<span class="projects-open-chip">Open</span>' : ''}</td>
          <td class="projects-meta">${count}</td>
          <td class="projects-meta">${fmtAgo(p.updatedAt)}</td>
          <td><div class="projects-actions">
            ${isOpen ? '' : `<button type="button" class="btn btn-secondary projects-switch-btn" data-id="${escapeHtml(p.id)}">Open</button>`}
            <button type="button" class="btn btn-secondary projects-rename-btn" data-id="${escapeHtml(p.id)}">Rename</button>
            <button type="button" class="btn btn-secondary projects-duplicate-btn" data-id="${escapeHtml(p.id)}">Duplicate</button>
            ${isOpen ? '' : `<button type="button" class="btn btn-secondary projects-delete-btn" data-id="${escapeHtml(p.id)}">Delete</button>`}
          </div></td>
        </tr>`;
      })
      .join('');
    listEl.innerHTML = `
      <table class="projects-table">
        <thead><tr><th>Name</th><th>Rows</th><th>Updated</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    const countEl = document.getElementById('projects-count');
    if (countEl) countEl.textContent = `${projects.length} project${projects.length === 1 ? '' : 's'}`;
  }

  function renameFlow(id) {
    const current = TakeoffState.getCurrentProject();
    const entry = TakeoffState.getProjects().find((p) => p.id === id);
    const name = prompt('Project name:', entry ? entry.name : '');
    if (name === null || !name.trim()) return;
    if (id === current.id) {
      TakeoffState.setProjectName(name);
      TakeoffState.persistNow();
    } else {
      const data = TakeoffStorage.loadProject(id);
      if (!data) return;
      data.name = name.trim();
      data.savedAt = new Date().toISOString();
      TakeoffStorage.saveProject(data);
      const idx = TakeoffStorage.loadProjectsIndex();
      const e = idx && idx.projects.find((p) => p.id === id);
      if (e) {
        e.name = data.name;
        e.updatedAt = data.savedAt;
        TakeoffStorage.saveProjectsIndex(idx);
      }
    }
    renderModal();
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
    if (e.target.closest('#project-menu-new')) {
      openModal({ create: true });
      return;
    }
    if (e.target.closest('#project-menu-manage')) {
      openModal();
      return;
    }
    const item = e.target.closest('.project-menu-item');
    if (item) {
      closeMenu();
      switchTo(item.dataset.id);
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
    if (e.key === 'Escape') {
      e.stopPropagation();
      hideCreateRow();
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
      renameFlow(rn.dataset.id);
      return;
    }
    const dup = e.target.closest('.projects-duplicate-btn');
    if (dup) {
      TakeoffState.duplicateProject(dup.dataset.id);
      renderModal();
      return;
    }
    const del = e.target.closest('.projects-delete-btn');
    if (del) {
      const entry = TakeoffState.getProjects().find((p) => p.id === del.dataset.id);
      if (entry && confirm(`Delete "${entry.name}"? This can't be undone.`)) {
        TakeoffState.deleteProject(del.dataset.id);
        renderModal();
      }
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

  return { updateHeader, openModal };
})();
