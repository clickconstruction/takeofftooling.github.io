/**
 * Import from Count Tooling clipboard format
 * Format: fixture\tcount\tpage per line
 * fixture — Item name
 * count — Count or length (number)
 * page — Comma-separated page numbers (e.g. 1, 3, 5)
 * Line types: [unit] of [name] (e.g. ft of Conduit, in of Pipe)
 */

const TakeoffImport = (function () {
  function inferType(description) {
    const d = (description || '').trim().toLowerCase();
    if (/of\s+conduit/.test(d)) return 'conduit';
    if (/of\s+wire/.test(d)) return 'wire';
    if (/receptacle|switch|outlet/.test(d)) return 'devices';
    if (/light\s*fixture|lighting|fixture/.test(d)) return 'lighting';
    if (/panel|gear|transformer/.test(d)) return 'gear';
    return null;
  }

  function parseCountToolingClipboard(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const items = [];
    for (const line of lines) {
      const parts = line.split(/\t/).map((p) => p.trim());
      if (parts.length < 2) continue;
      const fixture = parts[0] || '';
      const count = parseFloat(parts[1]) || 0;
      const page = parts[2] || '';
      if (!fixture) continue;
      items.push({
        description: fixture,
        quantity: count,
        labor: null,
        planPage: page,
        type: inferType(fixture),
      });
    }
    return items;
  }

  async function importFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      const items = parseCountToolingClipboard(text);
      if (items.length === 0) {
        alert('No valid rows found. Expected format: fixture\\tcount\\tpage (tab-separated, one per line)');
        return;
      }
      for (const item of items) {
        TakeoffState.addItem({
          type: item.type,
          description: item.description,
          quantity: item.quantity,
          labor: item.labor,
          planPage: item.planPage,
          parentId: null,
        });
      }
      TakeoffApp.render();
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        alert('Clipboard access denied. Please allow clipboard permission and try again.');
      } else {
        alert('Failed to import: ' + (err.message || 'Unknown error'));
      }
    }
  }

  return { importFromClipboard, parseCountToolingClipboard };
})();
