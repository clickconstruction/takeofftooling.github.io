/**
 * Type selection modal
 */

const TakeoffModal = (function () {
  function handleTypeSelect(type) {
    const itemId = TakeoffState.getModalItemId();
    if (!itemId) return;

    TakeoffState.setType(itemId, type);
    TakeoffApp.hideTypeModal();

    if (type === 'devices') {
      TakeoffApp.navigateToDevice(itemId);
    } else if (type === 'conduit') {
      TakeoffApp.navigateToConduit(itemId);
    } else if (type === 'wire') {
      TakeoffApp.navigateToWire(itemId);
    } else {
      TakeoffApp.render();
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
