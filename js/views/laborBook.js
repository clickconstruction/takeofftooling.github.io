/**
 * Labor and Price Book modal — the view facade: Parts tabs/sections, the
 * Parts/Assemblies toggle, the apply-to header, and modal chrome.
 *
 * Split-out pieces (loaded before this file):
 *   js/views/laborBookTargets.js — apply-to-takeoff logic (add/fill/explode)
 *   js/views/laborBookElliot.js  — live Elliot supplier parts group
 *   js/views/laborBookSearch.js  — global search (owns the search term)
 * The public API here is stable — app.js, McBook, and McElliotUpdate call it.
 */

const TakeoffLaborBookView = (function () {
  const TRASH_SVG = TakeoffViewShared.TRASH_SVG;

  const TAB_HOTKEYS = { g: 'gear', l: 'lighting', d: 'devices', c: 'conduit', w: 'wire', s: 'specialSystems' };
  const TAB_TO_KEY = { gear: 'G', lighting: 'L', devices: 'D', conduit: 'C', wire: 'W', specialSystems: 'S' };
  // device-flow section keys → the labels the flow shows (banners must never
  // leak the raw key: "Fill: outletsAndSwitches row 1")
  const DEVICE_SECTION_LABELS = {
    outletsAndSwitches: 'Outlets and Switches',
    boxes: 'Boxes',
    backBoxSupport: 'Back Box Support',
    covers: 'Covers',
    conduit: 'Conduit',
    wire: 'Wire',
    screws: 'Screws',
    misc: 'Misc.',
  };

  // 'parts' | 'assemblies' — remembered across modal opens (in-memory only)
  let activeSection = 'parts';

  // When the book is opened from a top-level row that already carries its own
  // price, Add on a row of that fixture's own type prices the fixture instead
  // of hanging a second copy of it underneath. `addUnderneath` is the
  // estimator's opt-out; it resets when the banner points at another row.
  let bannerFixtureId = null;
  let addUnderneath = false;

  function canPriceFixture(fixture) {
    if (!fixture || fixture.parentId) return false;
    if ((fixture.children || []).length) return false;
    if (!TakeoffState.getLaborBookTabOrder().includes(fixture.type)) return false;
    // Only rows whose quantity is a count of the thing itself: a conduit run's
    // price is per foot, so a coupling's price is not a replacement for it.
    if (!TakeoffLaborBookTargets.inheritsQuantity(fixture)) return false;
    return fixture.price != null && fixture.price !== '' && Number(fixture.price) > 0;
  }

  // Open/closed state survives the wholesale re-renders (recording a quote
  // used to collapse the section the user was pricing in). Keys: `tab::name`.
  const openSections = new Set();
  const openGroups = new Set();
  function sectionStateKey(name) {
    return `${TakeoffState.getActiveLaborBookTab()}::${name}`;
  }

  // Promotion puts a part in a section that did not exist a moment ago; open
  // it, or the row the estimator just edited re-renders inside a closed
  // heading and reads as lost.
  function markSectionOpen(name) {
    if (name) openSections.add(sectionStateKey(name));
  }

  function escapeHtml(str) {
    return TakeoffUtils.escapeHtml(str);
  }

  function renderTabs() {
    const tabs = TakeoffState.getLaborBookTabOrder();
    const active = TakeoffState.getActiveLaborBookTab();
    const labels = TakeoffState.LABOR_BOOK_TYPE_LABELS || {};
    return tabs
      .map(
        (t) =>
          `<button type="button" class="labor-book-tab ${t === active ? 'active' : ''}" data-tab="${t}" title="${TAB_TO_KEY[t] ? 'Press ' + TAB_TO_KEY[t] : ''}">${escapeHtml(labels[t] || t)}${TAB_TO_KEY[t] ? ` <kbd class="labor-book-tab-kbd">${TAB_TO_KEY[t]}</kbd>` : ''}</button>`
      )
      .join('');
  }

  // "In use" is the one name for the price a row carries — the same words the
  // part card's pill uses, so the column, the card and the pill agree.
  const ROWS_THEAD_ROW = '<tr><th>Add</th><th>Name</th><th>Labor (hrs)</th><th>Price</th><th>Part #</th><th title="Where the price this row is using came from, and how old it is">In use</th><th></th></tr>';
  const ROWS_THEAD = `<thead>${ROWS_THEAD_ROW}</thead>`;

  // Rows this user is sharing back to the shared book, so the row itself says
  // so (the price badge cannot: a labor-only fix has no price to stamp).
  function sharedKeys() {
    return typeof TakeoffCloud !== 'undefined' && TakeoffCloud.getSharedRowKeys ? TakeoffCloud.getSharedRowKeys() : null;
  }

  function renderSectionRows(type, section, data) {
    const rows = data[section] || [];
    const shared = sharedKeys();
    const isShared = (name) => !!shared && shared.has([type, section, name || ''].join('\u0001'));
    return rows
      .map(
        (r, i) => `
        <tr class="labor-book-row" data-type="${type}" data-section="${escapeHtml(section)}" data-index="${i}" data-labor="${r.labor || 0}">
          <td><button type="button" class="btn labor-book-add-btn" data-type="${type}" data-section="${escapeHtml(section)}" data-index="${i}" title="Add as child to fixture">${TakeoffViewShared.CHILD_ARROW_SVG} Add</button></td>
          <td><input type="text" class="labor-book-name" value="${escapeHtml(r.name || '')}" data-type="${type}" data-section="${escapeHtml(section)}" data-index="${i}" placeholder="Name" /></td>
          <td class="lb-hrs-cell"><input type="number" class="labor-book-hrs" value="${r.labor ?? ''}" min="0" step="0.1" data-type="${type}" data-section="${escapeHtml(section)}" data-index="${i}" placeholder="hrs" />${isShared(r.name) ? '<span class="lb-shared-chip" title="Shared with the shared parts book">shared</span>' : ''}</td>
          <td><input type="text" class="labor-book-price" value="${escapeHtml(r.price ?? '')}" data-type="${type}" data-section="${escapeHtml(section)}" data-index="${i}" placeholder="Price" /></td>
          <td><input type="text" class="labor-book-partnum" value="${escapeHtml(r.partNumber ?? '')}" data-type="${type}" data-section="${escapeHtml(section)}" data-index="${i}" placeholder="Part #" /></td>
          <td class="lb-prov-cell">${TakeoffViewShared.renderPriceProvenance(r.priceSource, r.pricedAt, { button: true, hasPrice: r.price !== '' && r.price != null, data: ` data-type="${type}" data-section="${escapeHtml(section)}" data-index="${i}"` })}</td>
          <td><button type="button" class="btn-link labor-book-remove-row icon-btn" data-type="${type}" data-section="${escapeHtml(section)}" data-index="${i}" title="Remove">${TRASH_SVG}</button></td>
        </tr>
      `
      )
      .join('');
  }

  function renderSectionBlock(type, section, data) {
    const rowHtml = renderSectionRows(type, section, data);
    const collapsed = openSections.has(sectionStateKey(section)) ? '' : ' labor-book-section-collapsed';
    return `
        <div class="labor-book-section${collapsed}" data-section="${escapeHtml(section)}">
          <h3 class="labor-book-section-header"><span class="labor-book-section-chevron"></span>${escapeHtml(section)}</h3>
          <div class="labor-book-section-body">
            <div class="lb-parts-scroll">
            <table>
              ${ROWS_THEAD}
              <tbody>${rowHtml}</tbody>
            </table>
            </div>
            <button type="button" class="btn add-row-btn" data-type="${type}" data-section="${escapeHtml(section)}">Add Row</button>
          </div>
        </div>
      `;
  }

  function renderContent() {
    const type = TakeoffState.getActiveLaborBookTab();
    const data = TakeoffState.getLaborBookType(type);
    const sections = Object.keys(data);
    const groups = TakeoffState.getLaborBookGroups(type);
    const filterHtml = '<input type="text" class="labor-book-tab-filter" placeholder="Filter parts in this tab by name or part number..." autocomplete="off" />';

    if (sections.length === 0) {
      // if the supplier catalog has parts for this tab, injectElliotParts
      // demotes this block to a footer below the (auto-expanded) catalog
      return `
        ${filterHtml}
        <div class="labor-book-empty">
          <p>No parts sections yet. Browse Assemblies for priced entries, or start a section from scratch.</p>
          <button type="button" class="btn btn-success labor-book-browse-assemblies-btn">Browse Assemblies</button>
          <button type="button" class="btn add-section-btn" data-type="${type}">Add Section</button>
          <div class="inline-name-row lb-add-section-row" hidden>
            <input type="text" class="lb-add-section-name" placeholder="Section name" autocomplete="off" />
            <button type="button" class="btn btn-success lb-add-section-confirm" data-type="${type}">Create</button>
          </div>
        </div>
      `;
    }

    let html = filterHtml;

    // Grouped rendering wherever groups exist: the conduit defaults config,
    // or any tab the user gave groups via Organize Categories.
    if (groups && groups.length) {
      const expandGroup = TakeoffState.getLaborBookExpandGroup?.() || null;
      const grouped = new Set();
      for (const group of groups) {
        for (const section of group.sections) grouped.add(section);
      }
      for (const group of groups) {
        let groupSectionsHtml = '';
        for (const section of group.sections) {
          if (!data[section]) continue;
          groupSectionsHtml += renderSectionBlock(type, section, data);
        }
        if (groupSectionsHtml) {
          const collapsedClass = expandGroup === group.name || openGroups.has(sectionStateKey(group.name)) ? '' : ' labor-book-group-collapsed';
          html += `
        <div class="labor-book-group${collapsedClass}" data-group="${escapeHtml(group.name)}">
          <h2 class="labor-book-group-header"><span class="labor-book-section-chevron"></span>${escapeHtml(group.name)}</h2>
          <div class="labor-book-group-body">
            ${groupSectionsHtml}
          </div>
        </div>
      `;
        }
      }
      let ungroupedSectionsHtml = '';
      for (const section of sections) {
        if (grouped.has(section)) continue;
        ungroupedSectionsHtml += renderSectionBlock(type, section, data);
      }
      if (ungroupedSectionsHtml) {
        // was labeled "Imported" before Organize Categories made the
        // ungrouped bucket a first-class concept (state key kept for both)
        const isOpen = ['Ungrouped', 'Imported'].some((k) => expandGroup === k || openGroups.has(sectionStateKey(k)));
        html += `
        <div class="labor-book-group${isOpen ? '' : ' labor-book-group-collapsed'}" data-group="Ungrouped">
          <h2 class="labor-book-group-header"><span class="labor-book-section-chevron"></span>Ungrouped</h2>
          <div class="labor-book-group-body">
            ${ungroupedSectionsHtml}
          </div>
        </div>
      `;
      }
    } else {
      const transformersSections = sections.filter((s) => s.startsWith('Transformers.'));
      const panelsSections = sections.filter((s) => s.startsWith('Panels.'));
      const otherSections = sections.filter(
        (s) => !s.startsWith('Transformers.') && !s.startsWith('Panels.') && !s.startsWith('Cable Tray.')
      );

      for (const section of otherSections) {
        html += renderSectionBlock(type, section, data);
      }

    if (panelsSections.length > 0 && type === 'gear') {
      let panelsHtml = '<div class="labor-book-section' + (openSections.has(sectionStateKey('Panels')) ? '' : ' labor-book-section-collapsed') + '" data-section="Panels"><h3 class="labor-book-section-header"><span class="labor-book-section-chevron"></span>Panels</h3><div class="labor-book-section-body">';
      for (const section of panelsSections) {
        const subLabel = section.replace('Panels.', '');
        const rowHtml = renderSectionRows(type, section, data);
        panelsHtml += `
          <table>
            <thead><tr class="labor-book-subsection-row"><th></th><th colspan="6">${escapeHtml(subLabel)}</th></tr>${ROWS_THEAD_ROW}</thead>
            <tbody>${rowHtml}</tbody>
          </table>
          <button type="button" class="btn add-row-btn" data-type="${type}" data-section="${escapeHtml(section)}">Add Row</button>
        `;
      }
      panelsHtml += '</div></div>';
      html += panelsHtml;
    }

    if (transformersSections.length > 0 && type === 'gear') {
      let transformersHtml = '<div class="labor-book-section' + (openSections.has(sectionStateKey('Transformers')) ? '' : ' labor-book-section-collapsed') + '" data-section="Transformers"><h3 class="labor-book-section-header"><span class="labor-book-section-chevron"></span>Transformers</h3><div class="labor-book-section-body">';
      for (const section of transformersSections) {
        const subLabel = section.replace('Transformers.', '');
        const rowHtml = renderSectionRows(type, section, data);
        transformersHtml += `
          <table>
            <thead><tr class="labor-book-subsection-row"><th></th><th colspan="6">${escapeHtml(subLabel)}</th></tr>${ROWS_THEAD_ROW}</thead>
            <tbody>${rowHtml}</tbody>
          </table>
          <button type="button" class="btn add-row-btn" data-type="${type}" data-section="${escapeHtml(section)}">Add Row</button>
        `;
      }
      transformersHtml += '</div></div>';
      html += transformersHtml;
    }
    }

    return html;
  }

  // Tab-level filter: narrows the curated sections in the DOM (rows are live
  // inputs) and hands the term to the supplier group's data-driven filter.
  function applyTabFilter(termRaw) {
    const partsEl = document.getElementById('labor-book-content');
    if (!partsEl) return;
    const term = (termRaw || '').trim();
    // every query token must match, in any order ('panels 6', '3/4 emt')
    const matches = TakeoffUtils.makeTokenMatcher(term);
    // supplier-only sections have no curated rows; partsEl._elliotFilter
    // below owns their visibility
    partsEl.querySelectorAll('.labor-book-section:not(.lb-supplier-section)').forEach((sec) => {
      // row names can be bare sizes ("12", "3/4\"") — the meaning often lives
      // in the section or group title, so titles join the haystack and a
      // full title match shows the whole block
      const groupEl = sec.closest('.labor-book-group');
      const titles = `${sec.dataset.section || ''} ${groupEl?.dataset.group || ''}`;
      const titleMatch = term && matches(titles);
      let any = false;
      sec.querySelectorAll('.labor-book-row').forEach((row) => {
        const name = row.querySelector('.labor-book-name')?.value || '';
        const show = !term || titleMatch || matches(`${name} ${titles}`);
        row.style.display = show ? '' : 'none';
        if (show) any = true;
      });
      sec.style.display = !term || any ? '' : 'none';
      // clearing the term restores the default all-collapsed view
      sec.classList.toggle('labor-book-section-collapsed', term ? !any : true);
    });
    // supplier filter runs before the group pass so a group whose only
    // matches are supplier parts stays visible (and one with none hides)
    partsEl._elliotFilter?.(term);
    partsEl.querySelectorAll('.labor-book-group').forEach((g) => {
      const anyVisible = Array.from(g.querySelectorAll('.labor-book-section')).some((s) => s.style.display !== 'none');
      g.style.display = !term || anyVisible ? '' : 'none';
      g.classList.toggle('labor-book-group-collapsed', term ? !anyVisible : true);
    });
  }

  let tabFilterTimer = null;

  function renderApplyToSelect() {
    // blank starter rows aren't real fixtures — keep them out of the picker
    const items = TakeoffState.getTopLevelItems().filter((i) => (i.description || '').trim());
    return items
      .map((item) => {
        const desc = (item.description || '').slice(0, 40) + ((item.description || '').length > 40 ? '...' : '');
        const label = `${desc} | Quantity: ${item.quantity || 0} | ${item.planPage || '-'}`;
        return `<option value="${item.id}">${escapeHtml(label)}</option>`;
      })
      .join('');
  }

  function syncSectionToggle() {
    document.querySelectorAll('#labor-book-section-toggle .labor-book-section-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.section === activeSection);
    });
  }

  function updateAssemblyTabCounts() {
    if (activeSection !== 'assemblies' || typeof McBook === 'undefined') return;
    document.querySelectorAll('#labor-book-tabs .labor-book-tab').forEach((btn) => {
      const n = McBook.sectionCount(btn.dataset.tab);
      if (n > 0 && !btn.querySelector('.mc-book-tab-count')) {
        btn.insertAdjacentHTML('beforeend', ` <span class="mc-book-tab-count">${n}</span>`);
      }
    });
  }

  function setActiveSection(section) {
    if (section !== 'parts' && section !== 'assemblies') return;
    activeSection = section;
    // choosing a section exits search mode
    TakeoffLaborBookSearch.setTerm('');
    const input = document.getElementById('labor-book-global-search');
    if (input) input.value = '';
    render();
    attachListeners();
  }

  function refreshAssembliesIfVisible() {
    const modal = document.getElementById('labor-book-modal');
    if (modal?.getAttribute('aria-hidden') === 'false' && activeSection === 'assemblies') {
      render();
      attachListeners();
    }
  }

  function render() {
    syncSectionToggle();
    const partsEl = document.getElementById('labor-book-content');
    const asmEl = document.getElementById('labor-book-assemblies');
    const searchEl = document.getElementById('labor-book-search-results');
    const tabsEl = document.getElementById('labor-book-tabs');
    const searchTerm = TakeoffLaborBookSearch.getTerm();
    // Update Elliot Prices is a Parts-section action (bottom of the modal)
    document.getElementById('mc-elliot-update-btn')?.classList.toggle('lb-hidden', activeSection !== 'parts' || !!searchTerm);
    // Export Groups & Sections copies a maintenance outline of the book — it
    // belongs behind the same role gate as the other maintainer tooling, not
    // in every estimator's footer.
    const maintainer =
      typeof TakeoffCloud !== 'undefined' && !!TakeoffCloud.isSignedIn?.() && !!TakeoffCloud.isAdmin?.();
    document.getElementById('labor-book-export-structure-btn')?.classList.toggle('lb-hidden', !maintainer);

    if (searchTerm) {
      partsEl.classList.add('lb-hidden');
      partsEl.innerHTML = '';
      asmEl?.classList.add('lb-hidden');
      tabsEl.classList.add('lb-hidden');
      tabsEl.innerHTML = '';
      searchEl?.classList.remove('lb-hidden');
      TakeoffLaborBookSearch.renderResults();
    } else {
      searchEl?.classList.add('lb-hidden');
      if (searchEl) searchEl.innerHTML = '';
      tabsEl.classList.remove('lb-hidden');
      tabsEl.innerHTML = renderTabs();
      if (activeSection === 'assemblies') {
        partsEl.classList.add('lb-hidden');
        partsEl.innerHTML = '';
        asmEl?.classList.remove('lb-hidden');
        if (typeof McBook !== 'undefined') McBook.renderAssemblies().then(updateAssemblyTabCounts);
      } else {
        asmEl?.classList.add('lb-hidden');
        partsEl.classList.remove('lb-hidden');
        partsEl.innerHTML = renderContent();
        TakeoffLaborBookElliot.injectElliotParts(partsEl, () => activeSection);
      }
    }
    const fillTarget = TakeoffState.getLaborBookFillTarget?.();
    const preselectedId = TakeoffState.getLaborBookPreselectedItemId();
    const applyToEl = document.getElementById('labor-book-apply-to');
    // last add's receipt belongs to the target it was added to, not the next one
    TakeoffLaborBookTargets.flashTargetNote('');
    if (fillTarget) {
      const labels = {
        'manifest-row': 'manifest row',
        'device-row': `${DEVICE_SECTION_LABELS[fillTarget.section] || fillTarget.section || ''} row ${(fillTarget.index ?? 0) + 1}`,
        'conduit-fitting': `fitting row ${(fillTarget.index ?? 0) + 1}`,
        'wire-mac': `MAC adapter row ${(fillTarget.index ?? 0) + 1}`,
      };
      applyToEl.innerHTML = `<div class="labor-book-preselected">Fill: <strong>${escapeHtml(labels[fillTarget.kind] || 'row')}</strong> — selecting an entry replaces this row's description, labor, and price</div>`;
      applyToEl.removeAttribute('data-target-fixture-id');
    } else if (preselectedId) {
      const fixtureId = TakeoffState.getTopLevelParentId(preselectedId);
      const fixture = TakeoffState.getItemById(fixtureId);
      if (fixtureId !== bannerFixtureId) {
        bannerFixtureId = fixtureId;
        addUnderneath = false; // a new row starts on its own default again
      }
      const desc = (fixture?.description || '').slice(0, 50) + ((fixture?.description || '').length > 50 ? '...' : '');
      const name = desc ? escapeHtml(desc) : 'this unnamed row';
      const qty = Number(fixture?.quantity) || 0;
      // The fittings door (conduit wizard, step 2) does not add children at
      // all: the pick lands in this run's fittings table, ×1.
      const toFittings =
        fixtureId === TakeoffState.getCurrentItemId() &&
        TakeoffState.getCurrentView() === 'conduit' &&
        TakeoffState.getConduitStep() === 2;
      // A count can be inherited; a run's footage cannot, so say which of the
      // two the parts will land at rather than promising "×220 on the bid".
      const countBit = toFittings
        ? ' · each lands ×1 in this run’s fittings — set the count'
        : TakeoffLaborBookTargets.inheritsQuantity(fixture) && qty
          ? ` · ×${qty} on the bid`
          : ' · parts land ×1 — set the count';
      if (canPriceFixture(fixture) && !addUnderneath) {
        // The row already carries its own price, so a quote for the same thing
        // belongs ON it — adding a child beside it double-counts the fixture.
        applyToEl.innerHTML =
          `<div class="labor-book-preselected">Pricing: <strong>${name}</strong> — Add on a ${escapeHtml(TakeoffState.LABOR_BOOK_TYPE_LABELS[fixture.type] || fixture.type)} row replaces this row's price and labor` +
          ` <button type="button" class="btn btn-link labor-book-mode-btn" id="labor-book-add-underneath-btn">Add as a part underneath</button></div>`;
      } else {
        applyToEl.innerHTML =
          `<div class="labor-book-preselected">${TakeoffViewShared.CHILD_ARROW_SVG} ${toFittings ? 'Adding fittings to' : 'Adding parts under'}: <strong>${name}</strong>${countBit}` +
          (canPriceFixture(fixture) ? ` <button type="button" class="btn btn-link labor-book-mode-btn" id="labor-book-use-as-price-btn">Use as ${name}'s price</button>` : '') +
          '</div>';
      }
      applyToEl.dataset.targetFixtureId = fixtureId;
    } else {
      applyToEl.removeAttribute('data-target-fixture-id');
      const prevSelect = document.getElementById('labor-book-target-select');
      const currentVal = prevSelect?.value || '';
      applyToEl.innerHTML = '<label>Add to fixture: <select id="labor-book-target-select"><option value="">-- Select fixture --</option>' + renderApplyToSelect() + '</select></label>';
      const select = document.getElementById('labor-book-target-select');
      if (select && currentVal) select.value = currentVal;
    }
  }

  function exportGroupsAndSectionsAsText() {
    const tabs = TakeoffState.getLaborBookTabOrder();
    const labels = TakeoffState.LABOR_BOOK_TYPE_LABELS || {};
    const lines = [];

    for (const type of tabs) {
      const data = TakeoffState.getLaborBookType(type);
      const sections = Object.keys(data);
      const groups = TakeoffState.getLaborBookGroups(type);

      if (sections.length === 0) continue;

      lines.push(labels[type] || type);
      lines.push('');

      if (groups && groups.length) {
        const grouped = new Set(groups.flatMap((g) => g.sections));
        for (const group of groups) {
          lines.push('  ' + group.name);
          for (const section of group.sections) {
            if (data[section]) lines.push('    - ' + section);
          }
          lines.push('');
        }
        const ungrouped = sections.filter((s) => !grouped.has(s));
        if (ungrouped.length) {
          lines.push('  Ungrouped');
          for (const section of ungrouped) lines.push('    - ' + section);
          lines.push('');
        }
      } else {
        const panelsSections = sections.filter((s) => s.startsWith('Panels.'));
        const transformersSections = sections.filter((s) => s.startsWith('Transformers.'));
        const cableTraySections = sections.filter((s) => s.startsWith('Cable Tray.'));
        const otherSections = sections.filter(
          (s) => !s.startsWith('Panels.') && !s.startsWith('Transformers.') && !s.startsWith('Cable Tray.')
        );

        for (const section of otherSections) {
          lines.push('  - ' + section);
        }
        if (panelsSections.length > 0) {
          lines.push('  Panels');
          for (const s of panelsSections) {
            lines.push('    - ' + s.replace('Panels.', ''));
          }
        }
        if (transformersSections.length > 0) {
          lines.push('  Transformers');
          for (const s of transformersSections) {
            lines.push('    - ' + s.replace('Transformers.', ''));
          }
        }
        if (cableTraySections.length > 0) {
          lines.push('  Cable Tray');
          for (const s of cableTraySections) {
            lines.push('    - ' + s.replace('Cable Tray.', ''));
          }
        }
        lines.push('');
      }
    }

    const text = lines.join('\n').trim();
    if (!text) return;

    // one feedback region for the whole app (js/toast.js), including inside
    // this modal — the toast sits above it
    navigator.clipboard
      .writeText(text)
      .then(() => TakeoffToast.show('Book outline copied.', { kind: 'success' }))
      .catch((err) => TakeoffToast.show('Could not reach the clipboard: ' + (err.message || 'unknown error'), { kind: 'warn', timeout: 9000 }));
  }

  // the provenance badge opens the part card (offers, quotes, history)
  function attachProvBadge(btn) {
    btn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const { type, section, index } = btn.dataset;
      TakeoffLaborBookCard.openForBookRow(type, section, parseInt(index, 10));
    });
  }

  function attachListeners() {
    document.getElementById('labor-book-close-btn')?.addEventListener('click', () => {
      TakeoffApp.hideLaborBookModal();
    });

    document.getElementById('labor-book-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'labor-book-modal') TakeoffApp.hideLaborBookModal();
    });

    document.querySelectorAll('.labor-book-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        TakeoffState.setActiveLaborBookTab(btn.dataset.tab);
        render();
        attachListeners();
      });
    });

    document.querySelector('.labor-book-tab-filter')?.addEventListener('input', (e) => {
      if (tabFilterTimer) clearTimeout(tabFilterTimer);
      tabFilterTimer = setTimeout(() => applyTabFilter(e.target.value), 200);
    });

    // The fixture this book was opened from, when Add should price it rather
    // than add a part under it: a top-level priced row with no children, and a
    // book row of that fixture's own type.
    function fixtureToPriceFrom(row) {
      if (addUnderneath) return null;
      if (TakeoffState.getLaborBookFillTarget?.()) return null;
      const preselectedId = TakeoffState.getLaborBookPreselectedItemId();
      if (!preselectedId) return null;
      const fixture = TakeoffState.getItemById(TakeoffState.getTopLevelParentId(preselectedId));
      if (!canPriceFixture(fixture)) return null;
      return row.dataset.type === fixture.type ? fixture : null;
    }

    function addRowToFixture(row) {
      // read the field, not the row: an unsaved edit should ride along — but
      // only as money, never as text the bid would render blank
      const typed = TakeoffUtils.parseMoney(row.querySelector('.labor-book-price')?.value);
      const entry = {
        description: TakeoffLaborBookTargets.describeBookRow(row.querySelector('.labor-book-name')?.value || '', row.dataset.section || ''),
        labor: parseFloat(row.dataset.labor) || 0,
        price: Number.isFinite(typed) ? String(typed) : null,
      };
      const fixture = fixtureToPriceFrom(row);
      if (fixture) {
        const bookRow = TakeoffState.getLaborBookType(row.dataset.type)?.[row.dataset.section]?.[parseInt(row.dataset.index, 10)];
        // keepDescription: the estimator's own name for the row survives; only
        // the money and its provenance come from the book.
        TakeoffState.setLaborBookFillTarget({
          kind: 'manifest-row',
          id: fixture.id,
          keepDescription: true,
          priceSource: bookRow?.priceSource || 'Labor & Price Book',
          pricedAt: bookRow?.pricedAt,
        });
      }
      TakeoffLaborBookTargets.addEntryToTarget(entry);
    }

    document.getElementById('labor-book-add-underneath-btn')?.addEventListener('click', () => {
      addUnderneath = true;
      render();
      attachListeners();
    });

    document.getElementById('labor-book-use-as-price-btn')?.addEventListener('click', () => {
      addUnderneath = false;
      render();
      attachListeners();
    });

    document.querySelectorAll('.labor-book-add-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const row = btn.closest('.labor-book-row');
        if (row) addRowToFixture(row);
      });
    });

    // No whole-row click handler: a stray click on the padding beside the
    // trash or in the Name cell silently added the row to the bid — two of
    // them put +50 labor hrs under a fixture with nothing on screen to say so.
    // Add is the button that says Add.

    document.querySelectorAll('.lb-prov-cell .lb-prov-badge').forEach(attachProvBadge);

    document.querySelectorAll('.labor-book-name, .labor-book-hrs, .labor-book-price, .labor-book-partnum').forEach((input) => {
      input.addEventListener('change', (e) => {
        const { type, section, index } = e.target.dataset;
        let field, value;
        if (e.target.classList.contains('labor-book-name')) {
          field = 'name';
          value = e.target.value;
        } else if (e.target.classList.contains('labor-book-hrs')) {
          field = 'labor';
          value = parseFloat(e.target.value) || 0;
        } else if (e.target.classList.contains('labor-book-partnum')) {
          field = 'partNumber';
          value = e.target.value.trim();
        } else {
          field = 'price';
          value = e.target.value;
        }
        const result = TakeoffState.updateLaborBookRow(type, section, parseInt(index, 10), { [field]: value });
        const row = e.target.closest('.labor-book-row');
        if (row && field === 'labor') row.dataset.labor = value;
        if (field === 'price') {
          // text that isn't money stays on screen, flagged — the row is left
          // unpriced rather than looking priced at nothing (TakeoffUtils.parseMoney)
          const rejected = !!result?.priceRejected;
          e.target.classList.toggle('lb-price-invalid', rejected);
          e.target.setAttribute('aria-invalid', rejected ? 'true' : 'false');
          if (rejected) return;
          // show what was stored: '$21,450.75' reads back as 21450.75
          const stored = TakeoffState.getLaborBookType(type)?.[section]?.[parseInt(index, 10)]?.price;
          if (stored != null && String(stored) !== e.target.value) e.target.value = String(stored);
        }
        if (row && field === 'price') {
          // reflect the freshly stamped provenance without a full re-render
          const updated = TakeoffState.getLaborBookType(type)?.[section]?.[parseInt(index, 10)];
          const cell = row.querySelector('.lb-prov-cell');
          if (updated && cell) {
            cell.innerHTML = TakeoffViewShared.renderPriceProvenance(updated.priceSource, updated.pricedAt, {
              button: true,
              // same test the full render uses — clearing a price must fall back
              // to the quiet '+ price' ghost, not a "no date" pill
              hasPrice: updated.price !== '' && updated.price != null,
              data: ` data-type="${type}" data-section="${escapeHtml(section)}" data-index="${index}"`,
            });
            attachProvBadge(cell.querySelector('.lb-prov-badge'));
          }
        }
      });
    });

    document.querySelectorAll('.labor-book-remove-row').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const { type, section, index } = btn.dataset;
        TakeoffState.removeLaborBookRow(type, section, parseInt(index, 10));
        render();
        attachListeners();
      });
    });

    document.querySelectorAll('.add-row-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const { type, section } = btn.dataset;
        TakeoffState.addLaborBookRow(type, section, { name: '', labor: 0, price: '' });
        render();
        attachListeners();
      });
    });

    document.querySelectorAll('.add-section-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = btn.parentElement.querySelector('.lb-add-section-row');
        if (!row) return;
        row.hidden = !row.hidden;
        if (!row.hidden) row.querySelector('.lb-add-section-name')?.focus();
      });
    });
    const createSection = (confirmBtn) => {
      const row = confirmBtn.closest('.lb-add-section-row');
      const name = (row?.querySelector('.lb-add-section-name')?.value || '').trim();
      if (!name) return;
      TakeoffState.addLaborBookSection(confirmBtn.dataset.type, name);
      openSections.add(sectionStateKey(name)); // open the section you just made
      render();
      attachListeners();
    };
    document.querySelectorAll('.lb-add-section-confirm').forEach((btn) => {
      btn.addEventListener('click', () => createSection(btn));
    });
    document.querySelectorAll('.lb-add-section-name').forEach((input) => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') createSection(input.closest('.lb-add-section-row').querySelector('.lb-add-section-confirm'));
        if (e.key === 'Escape') {
          e.stopPropagation();
          input.closest('.lb-add-section-row').hidden = true;
        }
      });
    });

    document.querySelectorAll('.labor-book-browse-assemblies-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        setActiveSection('assemblies');
      });
    });

    document.querySelectorAll('.labor-book-section-header').forEach((header) => {
      header.addEventListener('click', () => {
        const section = header.closest('.labor-book-section');
        if (!section) return;
        const collapsed = section.classList.toggle('labor-book-section-collapsed');
        const key = sectionStateKey(section.dataset.section || '');
        if (collapsed) openSections.delete(key);
        else openSections.add(key);
      });
    });

    document.querySelectorAll('.labor-book-group-header').forEach((header) => {
      header.addEventListener('click', () => {
        const group = header.closest('.labor-book-group');
        if (!group) return;
        const collapsed = group.classList.toggle('labor-book-group-collapsed');
        const key = sectionStateKey(group.dataset.group || '');
        if (collapsed) openGroups.delete(key);
        else openGroups.add(key);
      });
    });
  }

  // ---------- one-time listeners (modal chrome) ----------

  document.getElementById('labor-book-export-structure-btn')?.addEventListener('click', () => {
    exportGroupsAndSectionsAsText();
  });

  // The key is generated from McBook.ABBREVIATIONS — the same table the
  // assemblies tree decodes its section names with, so the key always covers
  // the codes on the screen behind it.
  function renderAbbreviationKey() {
    const body = document.getElementById('abbreviation-key-body');
    if (!body || typeof McBook === 'undefined') return;
    body.innerHTML = McBook.ABBREVIATIONS.map(
      (g) => `
        <h3 class="abbreviation-key-group">${escapeHtml(g.group)}</h3>
        <dl class="abbreviation-key-list">
          ${g.items.map(([code, meaning]) => `<dt>${escapeHtml(code)}</dt><dd>${escapeHtml(meaning)}</dd>`).join('')}
        </dl>`
    ).join('');
  }
  document.getElementById('labor-book-organize-btn')?.addEventListener('click', () => {
    TakeoffApp.hideLaborBookModal();
    TakeoffApp.navigateToOrganize();
  });

  document.getElementById('labor-book-abbreviation-key-btn')?.addEventListener('click', () => {
    const modal = document.getElementById('abbreviation-key-modal');
    renderAbbreviationKey();
    if (modal) modal.setAttribute('aria-hidden', 'false');
  });

  document.getElementById('abbreviation-key-close-btn')?.addEventListener('click', () => {
    const modal = document.getElementById('abbreviation-key-modal');
    if (modal) modal.setAttribute('aria-hidden', 'true');
  });

  document.getElementById('abbreviation-key-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'abbreviation-key-modal') {
      e.target.setAttribute('aria-hidden', 'true');
    }
  });

  document.addEventListener('keydown', function laborBookHotkeyHandler(e) {
    const modal = document.getElementById('labor-book-modal');
    if (!modal || modal.getAttribute('aria-hidden') !== 'false') return;
    const el = document.activeElement;
    if (e.key === 'Escape') {
      // the supplier-prices modal sits on top of the labor book; its own
      // handler closes it (the part card stops propagation itself)
      const elliotModal = document.getElementById('mc-elliot-modal');
      if (elliotModal && elliotModal.getAttribute('aria-hidden') === 'false') return;
      const abbrevModal = document.getElementById('abbreviation-key-modal');
      if (abbrevModal && abbrevModal.getAttribute('aria-hidden') === 'false') {
        abbrevModal.setAttribute('aria-hidden', 'true');
        return;
      }
      // Escape means "back one level" from anywhere in the book, not only
      // from the search box: a term on screen is a level. Otherwise Esc from
      // an Add button closed the book while the term survived, and the next
      // open showed stale results with the tabs hidden.
      const asmFilter = document.getElementById('mc-book-search');
      if (TakeoffLaborBookSearch.getTerm()) {
        TakeoffLaborBookSearch.clearTerm();
        render();
        attachListeners();
        document.getElementById('labor-book-global-search')?.focus();
        return;
      }
      if (activeSection === 'assemblies' && asmFilter && asmFilter.value) {
        asmFilter.value = '';
        if (typeof McBook !== 'undefined') McBook.renderAssemblies();
        asmFilter.focus();
        return;
      }
      TakeoffApp.hideLaborBookModal();
      return;
    }
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
    const key = (e.key || '').toLowerCase();
    const tab = TAB_HOTKEYS[key];
    if (tab) {
      e.preventDefault();
      TakeoffState.setActiveLaborBookTab(tab);
      TakeoffLaborBookView.render();
      TakeoffLaborBookView.attachListeners();
    }
  });

  document.getElementById('labor-book-section-toggle')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-section]');
    if (btn) setActiveSection(btn.dataset.section);
  });

  document.getElementById('labor-book-open-btn')?.addEventListener('click', () => {
    TakeoffApp.showLaborBookModal();
  });

  return {
    render,
    attachListeners,
    setActiveSection,
    refreshAssembliesIfVisible,
    markSectionOpen,
    // apply-to-takeoff API delegates to TakeoffLaborBookTargets (stable
    // surface for McBook and older callers)
    addEntryToTarget: TakeoffLaborBookTargets.addEntryToTarget,
    addComponentsToTarget: TakeoffLaborBookTargets.addComponentsToTarget,
    hasFillTarget: TakeoffLaborBookTargets.hasFillTarget,
  };
})();
