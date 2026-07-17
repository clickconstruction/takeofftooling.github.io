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

  return { escapeHtml };
})();
