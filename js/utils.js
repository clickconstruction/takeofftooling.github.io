/**
 * Shared utilities. Load before all other app scripts.
 */

const TakeoffUtils = (function () {
  const HTML_ESCAPES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };

  // Safe for both element content and double/single-quoted attribute values.
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
  }

  // Normalize for part-name matching: lowercase, inch marks stripped
  // ('3/4 emt' should hit '3/4" EMT').
  function searchNorm(s) {
    return (s == null ? '' : String(s)).toLowerCase().replace(/["“”]/g, '');
  }

  /**
   * Build a matcher for a search query: every whitespace-separated token
   * must appear somewhere in the haystack, in any order — so
   * '3/4 EMT coupling' matches '3/4" MIGHTY-SEAL PUSH STEEL EMT COUPLING'.
   * Returns fn(haystack) → boolean; an empty query matches everything.
   * Pre-tokenizes once, so build it outside loops over large lists.
   */
  function makeTokenMatcher(query) {
    const tokens = searchNorm(query).split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return () => true;
    return (haystack) => {
      const h = searchNorm(haystack);
      return tokens.every((t) => h.includes(t));
    };
  }

  /**
   * In-app notice, replacing window.alert() everywhere user-facing. Renders
   * into #toast-region (index.html); stacks, auto-dismisses (errors linger
   * longer), click to dismiss. `kind`: 'info' | 'success' | 'error'.
   * Inert outside a document (unit tests) — falls back to console.
   */
  function toast(message, opts) {
    const o = opts || {};
    const kind = o.kind || 'info';
    if (typeof document === 'undefined') {
      (kind === 'error' ? console.error : console.log)('[toast] ' + message);
      return null;
    }
    const region = document.getElementById('toast-region');
    if (!region) {
      console.warn('[toast]', message);
      return null;
    }
    const el = document.createElement('div');
    el.className = 'toast toast-' + kind;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.textContent = message;
    const dismiss = () => {
      if (!el.isConnected) return;
      el.classList.add('toast-leaving');
      setTimeout(() => el.remove(), 180);
    };
    el.addEventListener('click', dismiss);
    region.appendChild(el);
    const ms = o.durationMs || (kind === 'error' ? 7000 : 3500);
    setTimeout(dismiss, ms);
    return el;
  }

  return { escapeHtml, searchNorm, makeTokenMatcher, toast };
})();

// Node (unit tests); inert in the browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TakeoffUtils;
}
