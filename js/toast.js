/**
 * TakeoffToast — the app's one feedback channel.
 *
 * Before this existed the app said "that worked" six different ways: a native
 * alert(), a 1.2 s check swapped into a button, a status line the next render
 * wiped, a bar under the header, or nothing at all. Every one of those was
 * invented for a single caller, and none of them was announced to a screen
 * reader.
 *
 * One aria-live region, one stack of at most three, outside #main-content so
 * TakeoffApp.render() cannot wipe it, and above the modals (z-index) because
 * most of the confirmations come from inside the Labor & Price Book.
 *
 * What does NOT belong here:
 *  - a question. Native confirm() stays for the discard guard, remove row and
 *    delete bid — a toast cannot block, and those need to.
 *  - a message that must still be on screen ten minutes later (a kept conflict
 *    copy, "the shared book was updated"). Those stay in the notice bars.
 *
 *   TakeoffToast.show('Added 2x4 LED — x1 under Panel LP-2', { kind: 'success' })
 *   TakeoffToast.show('Could not copy', { kind: 'warn', action: { label: 'Retry', onClick } })
 *   TakeoffToast.show('Matching...', { key: 'elliot', timeout: 0 })   // sticky, replaceable
 */

const TakeoffToast = (function () {
  const MAX_VISIBLE = 3;
  const DEFAULT_TIMEOUT = 5000;
  const KINDS = ['info', 'success', 'warn'];

  // handles for every toast currently on screen, oldest first
  const live = [];

  /**
   * The live region is in index.html so assistive tech is already watching it
   * at boot; this recreates it if a test (or a stray innerHTML) removed it.
   * It hangs off <body>, never off #app or #main-content.
   */
  function ensureRegion() {
    let el = document.getElementById('toast-region');
    const host = document.body || document.documentElement;
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast-region';
      el.className = 'toast-region';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      el.setAttribute('aria-atomic', 'false');
    }
    if (el.parentElement !== host) host.appendChild(el);
    return el;
  }

  function forget(handle) {
    const i = live.indexOf(handle);
    if (i !== -1) live.splice(i, 1);
  }

  function dismiss(handle) {
    if (!handle || handle.gone) return;
    handle.gone = true;
    if (handle.timer) clearTimeout(handle.timer);
    handle.timer = null;
    handle.el.remove();
    forget(handle);
  }

  function arm(handle, ms) {
    if (handle.timer) clearTimeout(handle.timer);
    handle.timer = null;
    if (!(ms > 0)) return; // 0 / null = stays until dismissed
    handle.timer = setTimeout(() => dismiss(handle), ms);
  }

  /**
   * @param {string} text                 what happened, in trade language
   * @param {object} [opts]
   * @param {'info'|'success'|'warn'} [opts.kind]
   * @param {{label: string, onClick: Function}} [opts.action]
   * @param {number} [opts.timeout]       ms; 0 keeps it until dismissed
   * @param {string} [opts.key]           same key replaces in place instead of
   *                                      stacking (repeat adds from the book)
   * @returns {{dismiss: Function}|null}
   */
  function show(text, opts) {
    const message = text == null ? '' : String(text);
    if (!message.trim()) return null;
    const o = opts || {};
    const kind = KINDS.includes(o.kind) ? o.kind : 'info';
    const timeout = o.timeout === undefined ? DEFAULT_TIMEOUT : Number(o.timeout);
    const region = ensureRegion();

    // A key means "this is the same piece of news": swap the text rather than
    // pile a fourth line of it onto the stack.
    if (o.key) {
      const prior = live.find((h) => h.key === o.key);
      if (prior) dismiss(prior);
    }
    while (live.length >= MAX_VISIBLE) dismiss(live[0]);

    const el = document.createElement('div');
    el.className = 'toast toast-' + kind;
    el.dataset.kind = kind;

    const body = document.createElement('span');
    body.className = 'toast-text';
    body.textContent = message; // textContent, so no caller has to escape
    el.appendChild(body);

    const handle = { el, key: o.key || null, timer: null, gone: false, dismiss: null };
    handle.dismiss = () => dismiss(handle);

    if (o.action && o.action.label && typeof o.action.onClick === 'function') {
      const act = document.createElement('button');
      act.type = 'button';
      act.className = 'toast-action';
      act.textContent = o.action.label;
      act.addEventListener('click', () => {
        dismiss(handle);
        o.action.onClick();
      });
      el.appendChild(act);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-dismiss';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    close.addEventListener('click', () => dismiss(handle));
    el.appendChild(close);

    // reading a long line takes longer than five seconds when the pointer is
    // parked on it, so hovering holds it open
    el.addEventListener('mouseenter', () => { if (handle.timer) { clearTimeout(handle.timer); handle.timer = null; } });
    el.addEventListener('mouseleave', () => arm(handle, timeout));

    region.appendChild(el);
    live.push(handle);
    arm(handle, timeout);
    return handle;
  }

  /** Clear the stack (or just the one carrying this key). */
  function clear(key) {
    for (const handle of live.slice()) {
      if (!key || handle.key === key) dismiss(handle);
    }
  }

  function count() {
    return live.length;
  }

  return { show, clear, count, MAX_VISIBLE };
})();
