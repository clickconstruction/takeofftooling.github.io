/**
 * Type selection modal
 */

const TakeoffModal = (function () {
  function handleTypeSelect(rawType) {
    const itemId = TakeoffState.getModalItemId();
    if (!itemId) return;

    // "No type" is the last option in the picker (X12): it is where the row's
    // × used to be, and the only way back to an untyped row.
    const type = rawType || null;
    TakeoffState.setType(itemId, type);
    TakeoffApp.hideTypeModal();
    // Flow types go straight into their editor; the type badge on the
    // manifest reopens it later.
    if (type === 'devices') TakeoffApp.navigateToDevice(itemId);
    else if (type === 'conduit') TakeoffApp.navigateToConduit(itemId);
    else if (type === 'wire') TakeoffApp.navigateToWire(itemId);
    else {
      // Everything else stays on the table, and the next thing typed on that
      // row is its hours — so land there instead of on <body>. (D/C/W don't:
      // they navigate into their own editor.)
      TakeoffApp.render();
      document.querySelector(`.manifest-view input[data-field="labor"][data-id="${itemId}"]`)?.focus();
    }
  }

  function attachListeners() {
    document.querySelectorAll('#type-modal [data-type]').forEach((btn) => {
      btn.replaceWith(btn.cloneNode(true));
    });
    document.querySelectorAll('#type-modal [data-type]').forEach((btn) => {
      btn.addEventListener('click', () => handleTypeSelect(btn.dataset.type));
    });

    const otherToggle = document.getElementById('modal-other-toggle');
    const otherContent = document.getElementById('modal-other-content');
    if (otherToggle && otherContent) {
      otherToggle.replaceWith(otherToggle.cloneNode(true));
      document.getElementById('modal-other-toggle').addEventListener('click', (e) => {
        e.stopPropagation();
        const expanded = otherContent.classList.toggle('modal-other-collapsed');
        document.getElementById('modal-other-toggle').setAttribute('aria-expanded', !expanded);
      });
    }

    document.getElementById('type-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'type-modal') {
        TakeoffApp.hideTypeModal();
      }
    });
  }

  function initKeyboardShortcuts() {
    document.addEventListener('keydown', function typeModalKeyHandler(e) {
      const modal = document.getElementById('type-modal');
      if (!modal || modal.getAttribute('aria-hidden') !== 'false') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        TakeoffApp.hideTypeModal();
        return;
      }
      const key = e.key?.toUpperCase();
      const btn = document.querySelector(`#type-modal [data-macro="${key}"]`);
      if (btn) {
        e.preventDefault();
        handleTypeSelect(btn.dataset.type);
      }
    });
  }

  initKeyboardShortcuts();

  return { attachListeners };
})();
