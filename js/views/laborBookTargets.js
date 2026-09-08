/**
 * Labor & Price Book "apply to takeoff" logic — no rendering.
 *
 * How a picked entry (Parts row, Assemblies entry, Elliot part, or search
 * hit) lands on the current target: a fill-mode row (PB buttons), a device
 * temp row, the conduit fittings list, or a manifest fixture. Consumed by
 * TakeoffLaborBookView, TakeoffLaborBookSearch, TakeoffLaborBookElliot, and
 * McBook. Loaded before js/views/laborBook.js.
 */

const TakeoffLaborBookTargets = (function () {
  /**
   * Names that appear in more than one section of one tab — the only names a
   * section has to disambiguate. `sections` is a tab's {section: rows} map.
   */
  function duplicatedNames(sections) {
    const firstSection = new Map();
    const dup = new Set();
    for (const section of Object.keys(sections || {})) {
      for (const row of sections[section] || []) {
        if (!row || !row.name) continue;
        const seen = firstSection.get(row.name);
        if (seen === undefined) firstSection.set(row.name, section);
        else if (seen !== section) dup.add(row.name);
      }
    }
    return dup;
  }

  function isAmbiguous(name, tab) {
    if (!tab) return false;
    return (tab instanceof Set ? tab : duplicatedNames(tab)).has(name);
  }

  /**
   * How a book row reads on the bid. Some sections carry the whole meaning of
   * a terse name ("600a" → "600a Panel (3PH)") and always join it. Otherwise
   * the section is appended ONLY when the bare name also lives in another
   * section of the same tab: an elbow and a coupling that share a name must
   * stay two orderable lines, but a name that is unique on its tab needs no
   * suffix — appending one wrote `4" Square Box, 1-1/2" deep Boxes & Rings`.
   *
   * `tab` is that tab's {section: rows} map, or a precomputed Set of its
   * duplicated names (duplicatedNames above); with no tab, nothing is
   * ambiguous and the bare name stands.
   */
  function describeBookRow(name, section, tab) {
    if (section === 'Panels.1PH') return `${name} Panel (1PH)`;
    if (section === 'Panels.3PH') return `${name} Panel (3PH)`;
    if (section === 'THHN CU' || section === 'THW AL') return `${section} ${name}`;
    if (section.startsWith('Cable Tray.')) return `${name} Cable Tray (${section.replace('Cable Tray.', '')})`;
    if (section && isAmbiguous(name, tab)) return `${name} — ${section}`;
    return name;
  }

  /** describeBookRow for a row identified by tab + section (looks the tab up). */
  function describeBookRowIn(tab, section, name) {
    const sections = typeof TakeoffState !== 'undefined' && TakeoffState.getLaborBookType
      ? TakeoffState.getLaborBookType(tab)
      : null;
    return describeBookRow(name, section, sections || null);
  }

  /**
   * X1: which book row a bid row came from, so the manifest can notice later
   * that the book has moved on ({type, section, name, partNumber?}, stored as
   * item.meta.book — see js/views/manifest.js).
   *
   * The reference is resolved from the description the caller built, which is
   * describeBookRow's own output for every book path (Parts rows, search hits,
   * pricing a fixture). An Elliot catalog part or an assembly is not a book
   * row and resolves to null, which is the right answer: there is nothing to
   * watch. An ambiguous name (two sections, same derived description) also
   * resolves to null rather than guessing.
   */
  function resolveBookRef(description) {
    const desc = (description || '').trim();
    if (!desc || typeof TakeoffState === 'undefined' || !TakeoffState.getLaborBook) return null;
    const book = TakeoffState.getLaborBook() || {};
    let found = null;
    for (const type of Object.keys(book)) {
      // one dup-name Set per tab: describeBookRow must build the same string
      // here as it did when the description was written, or nothing resolves
      const dup = duplicatedNames(book[type]);
      for (const section of Object.keys(book[type] || {})) {
        for (const row of book[type][section] || []) {
          if (!row || !row.name) continue;
          if (describeBookRow(row.name, section, dup) !== desc) continue;
          if (found) return null; // two rows answer to this name: don't guess
          found = { type, section, name: row.name };
          if (row.partNumber) found.partNumber = row.partNumber;
        }
      }
    }
    return found;
  }

  // Stamp the reference onto the meta the item already carries (never replace
  // it: the conduit flow writes overagePercent/addonGroup into the same field).
  function withBookRef(meta, ref) {
    if (!ref) return meta || null;
    return Object.assign({}, meta, { book: ref });
  }

  // A count can be inherited; a footage cannot. A part added under a 220-ft
  // conduit run arrived 220 times because the run's quantity is feet, not a
  // number of parts. Only the types whose quantity IS a count inherit it.
  const QTY_INHERITING_TYPES = ['gear', 'lighting', 'devices', 'specialSystems'];

  function inheritedQtyFor(parent) {
    if (!parent || !QTY_INHERITING_TYPES.includes(parent.type)) return 1;
    const q = Number(parent.quantity);
    return q > 0 ? q : 1;
  }

  /** True when this parent's quantity is a count parts can be multiplied by. */
  function inheritsQuantity(parent) {
    return !!parent && QTY_INHERITING_TYPES.includes(parent.type);
  }

  // What just landed on the bid, said once, in the app's one feedback region
  // (js/toast.js). It used to be a bar drawn under the "Add to" banner, which
  // meant the book had its own notion of feedback separate from every other
  // surface — and it was invisible the moment the modal scrolled. The key
  // makes a run of adds replace one line instead of stacking three.
  const BOOK_TOAST_KEY = 'book-add';
  function flashTargetNote(msg, kind) {
    if (typeof TakeoffToast === 'undefined') return;
    if (!msg) {
      TakeoffToast.clear(BOOK_TOAST_KEY);
      return;
    }
    TakeoffToast.show(msg, { kind: kind || 'success', key: BOOK_TOAST_KEY, timeout: 6000 });
  }

  // Where the last add landed and at what count, so a caller that knows more
  // about the entry (McBook knows the price it used) can say both in one line.
  let lastTargetNote = '';
  function quantityNote(parent, qty, many) {
    const where = parent?.description || 'this row';
    if (inheritsQuantity(parent)) return `×${qty} under ${where}`;
    return `×1 under ${where} — set the ${many ? 'counts' : 'count'}`;
  }
  function getLastTargetNote() {
    return lastTargetNote;
  }

  // Fill one flow row from a book entry. A filled row counts once until the
  // estimator says otherwise: a row left at qty 0 is a part that is on the
  // screen and not on the bid, which is how the preset rows already behave.
  //
  // The book reference rides on the buffer row (`row.book`) so the flow's save
  // can put it on the child as meta.book — a part filled here watches its book
  // row exactly like a fixture priced from the book does (X1).
  function fillRow(row, description, laborHours, priceNum, bookRef) {
    row.description = description;
    row.labor = laborHours;
    row.price = priceNum != null ? priceNum : '';
    if (!(Number(row.quantity) > 0)) row.quantity = 1;
    if (bookRef) row.book = bookRef;
    else delete row.book;
  }

  /**
   * Add one entry (from Parts rows or Assemblies entries) to the current
   * target: a device temp row, the conduit fittings list, or a manifest
   * fixture (child inherits the parent's quantity). Returns true if added.
   */
  function addEntryToTarget({ description, labor, price }) {
    const applyToEl = document.getElementById('labor-book-apply-to');
    const laborHours = Number(labor) || 0;
    // which book row this came from, resolved once, at the moment it lands
    const bookRef = resolveBookRef(description);

    // FILL mode: replace the targeted row's fields in place (PB buttons)
    const fill = TakeoffState.getLaborBookFillTarget?.();
    if (fill) {
      const priceNum = price != null && String(price).trim() !== '' ? parseFloat(price) : null;
      if (fill.kind === 'manifest-row') {
        // keepDescription: pricing a fixture from a book row of its own type
        // replaces the money, not the estimator's own name for the row.
        const updates = { labor: laborHours, price: priceNum };
        if (!fill.keepDescription) updates.description = description;
        let meta = TakeoffState.getItemById(fill.id)?.meta || null;
        if (fill.priceSource) meta = Object.assign({}, meta, {
          priceSource: fill.priceSource,
          pricedAt: fill.pricedAt || new Date().toISOString().slice(0, 10),
        });
        // a fixture priced from the book is watching that row too (X1)
        meta = withBookRef(meta, bookRef);
        if (meta) updates.meta = meta;
        TakeoffState.updateItem(fill.id, updates);
      } else if (fill.kind === 'device-row') {
        const temp = TakeoffState.getDeviceTempData();
        const row = temp[fill.section]?.[fill.index];
        if (!row) return false;
        fillRow(row, description, laborHours, priceNum, bookRef);
        TakeoffState.setDeviceTempData(temp);
      } else if (fill.kind === 'conduit-fitting') {
        const temp = TakeoffState.getConduitTempData();
        const row = (temp.fittings || [])[fill.index];
        if (!row) return false;
        fillRow(row, description, laborHours, priceNum, bookRef);
        TakeoffState.setConduitTempData(temp);
      } else if (fill.kind === 'wire-mac') {
        const temp = TakeoffState.getWireTempData();
        const row = (temp.macAdapters || [])[fill.index];
        if (!row) return false;
        fillRow(row, description, laborHours, priceNum, bookRef);
        TakeoffState.setWireTempData(temp);
      } else {
        return false;
      }
      TakeoffEvents.log('book_add_to_target', { door: fill.kind, bucket: TakeoffState.getActiveLaborBookTab(), exploded: false, inheritedQty: 1 });
      TakeoffApp.render();
      TakeoffApp.hideLaborBookModal();
      return true;
    }
    const targetId = applyToEl?.dataset.targetFixtureId || document.getElementById('labor-book-target-select')?.value;
    if (!targetId) {
      // no dialog: say it where the add would have landed
      flashTargetNote('Pick a fixture in "Add to fixture" first — parts land under a fixture.', 'warn');
      return false;
    }
    if (
      targetId === TakeoffState.getCurrentItemId() &&
      TakeoffState.getCurrentView() === 'conduit' &&
      TakeoffState.getConduitStep() === 2
    ) {
      const temp = TakeoffState.getConduitTempData();
      temp.fittings = temp.fittings || [];
      // same book reference a filled fitting row carries (saveAll copies it)
      temp.fittings.push(Object.assign({ description, quantity: 1, labor: laborHours, price: price || '' }, bookRef ? { book: bookRef } : null));
      TakeoffState.setConduitTempData(temp);
      lastTargetNote = '×1 in this run’s fittings — set the count';
      // the book stays open over the wizard: say where the add landed
      flashTargetNote(`Added ${description} — ${lastTargetNote}`);
    } else {
      // Inherit the parent's quantity only when it is a count: pricing a qty-24
      // fixture from the book should count 24 units, but a 220-ft run is
      // footage, not 220 couplings.
      const parent = TakeoffState.getItemById(targetId);
      const inheritedQty = inheritedQtyFor(parent);
      TakeoffState.addItem({
        parentId: targetId,
        description,
        quantity: inheritedQty,
        labor: laborHours,
        planPage: '',
        type: null,
        price: price,
        meta: withBookRef(null, bookRef),
      });
      lastTargetNote = quantityNote(parent, inheritedQty, false);
      flashTargetNote(`Added ${description} — ${lastTargetNote}`);
    }
    TakeoffEvents.log('book_add_to_target', { door: TakeoffState.getCurrentView() === 'conduit' ? 'conduit-fittings' : 'fixture', bucket: TakeoffState.getActiveLaborBookTab(), exploded: false, inheritedQty: inheritedQtyFor(TakeoffState.getItemById(targetId)) });
    TakeoffApp.render();
    return true;
  }

  const round2 = (n) => Math.round(n * 100) / 100;

  function hasFillTarget() {
    return !!TakeoffState.getLaborBookFillTarget?.();
  }

  /**
   * Exploded assembly add: each component lands individually on the target.
   * components: [{description, qty (per assembly unit), labor (hrs/each), price (per each)}]
   * - manifest fixture: one child per component, qty scaled by the fixture qty, single undo frame
   * - conduit fittings: one fittings row per component, qty scaled by the run's footage
   * Returns true if added.
   */
  function addComponentsToTarget(components) {
    if (!components || !components.length) return false;
    // FILL mode fills one row: component explosion doesn't apply here
    if (hasFillTarget()) return false;
    const applyToEl = document.getElementById('labor-book-apply-to');

    const targetId = applyToEl?.dataset.targetFixtureId || document.getElementById('labor-book-target-select')?.value;
    if (!targetId) {
      // no dialog: say it where the add would have landed
      flashTargetNote('Pick a fixture in "Add to fixture" first — parts land under a fixture.', 'warn');
      return false;
    }
    const targetItem = TakeoffState.getItemById(targetId);
    // Same rule as a single add: a count scales the components, a footage does
    // not. The wizard's fittings branch uses it too, or an assembly added
    // inside the conduit wizard still lands ×145.
    const scale = inheritedQtyFor(targetItem);

    if (
      targetId === TakeoffState.getCurrentItemId() &&
      TakeoffState.getCurrentView() === 'conduit' &&
      TakeoffState.getConduitStep() === 2
    ) {
      const temp = TakeoffState.getConduitTempData();
      temp.fittings = temp.fittings || [];
      for (const c of components) {
        temp.fittings.push({ description: c.description, quantity: round2(c.qty * scale), labor: c.labor || 0, price: c.price != null ? String(round2(Number(c.price))) : '' });
      }
      TakeoffState.setConduitTempData(temp);
      lastTargetNote = `${components.length} rows ×1 in this run’s fittings — set the counts`;
    } else {
      lastTargetNote = quantityNote(targetItem, scale, true);
      TakeoffState.beginBatch(); // whole assembly explosion = one undo frame
      for (const c of components) {
        TakeoffState.addItem({
          parentId: targetId,
          description: c.description,
          quantity: round2(c.qty * scale),
          labor: c.labor || 0,
          planPage: '',
          type: null,
          price: c.price != null ? round2(Number(c.price)) : null,
        });
      }
      TakeoffState.endBatch();
    }
    TakeoffEvents.log('book_add_to_target', { door: TakeoffState.getCurrentView() === 'conduit' ? 'conduit-fittings' : 'fixture', bucket: TakeoffState.getActiveLaborBookTab(), exploded: true, inheritedQty: scale });
    TakeoffApp.render();
    return true;
  }

  return {
    describeBookRow,
    describeBookRowIn,
    duplicatedNames,
    addEntryToTarget,
    addComponentsToTarget,
    hasFillTarget,
    inheritsQuantity,
    inheritedQtyFor,
    flashTargetNote,
    getLastTargetNote,
  };
})();
