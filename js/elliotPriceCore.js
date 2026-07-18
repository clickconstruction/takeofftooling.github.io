/**
 * Elliot price-update core: pure logic shared by the browser UI
 * (Update Elliot Prices modal) and Node scripts (apply-elliot-prices.js).
 *
 * No DOM, no localStorage, no fetch in this file.
 */

const McElliotCore = (function () {
  // ---------- CSV parsing ----------

  function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += c;
      }
    }
    result.push(current.trim());
    return result;
  }

  const ELLIOT_PROFILE = {
    label: 'Elliot Electric',
    columns: { category: 0, name: 1, description: 2, partNumber: 3, price: 4, cost: 5, unit: 6 },
    headerMustInclude: ['category', 'part number'],
    unitDivisors: { THOUSAND: 1000, HUNDRED: 100, EACH: 1 },
  };

  /**
   * Parse a supplier price CSV into rows with prices normalized to per-EACH,
   * driven by a vendor profile {columns, headerMustInclude, unitDivisors}.
   *
   * Handles exports with bare inch-mark quotes (1/2" EMT) that break standard
   * CSV parsing: when the file is uniformly N columns by naive comma split,
   * split naively; otherwise fall back to quote-aware parsing.
   */
  function parseVendorCsv(text, profile) {
    const cols = profile.columns;
    const colCount = Math.max(...Object.values(cols)) + 1;
    const divisors = profile.unitDivisors || {};
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return { rows: [], errors: ['File has no data rows'] };
    const header = parseCSVLine(lines[0]).map((h) => h.toLowerCase());
    const must = profile.headerMustInclude || [];
    const looksRight = must.every((m) => header.some((h) => h.includes(m)));
    if (!looksRight) {
      return { rows: [], errors: [`Header row does not look like a ${profile.label || 'supplier'} export (expected columns containing: ${must.join(', ')})`] };
    }
    const sample = lines.slice(0, Math.min(200, lines.length));
    const naiveOk = sample.every((l) => l.split(',').length === colCount);
    const splitLine = naiveOk ? (l) => l.split(',').map((c) => c.trim()) : parseCSVLine;
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = splitLine(lines[i]);
      if (cells.length < colCount) continue;
      const partNumber = (cells[cols.partNumber] || '').trim();
      if (!partNumber) continue;
      const unit = cols.unit != null ? (cells[cols.unit] || '').trim().toUpperCase() || 'EACH' : 'EACH';
      const raw = parseFloat(cells[cols.price]) || 0;
      const perEach = raw / (divisors[unit] || 1);
      rows.push({
        category: cols.category != null ? (cells[cols.category] || '').trim() : '',
        name: cols.name != null ? (cells[cols.name] || '').trim() : '',
        description: cols.description != null ? (cells[cols.description] || '').trim() : '',
        partNumber,
        perEach,
        rawPrice: raw,
        unit,
      });
    }
    return { rows, errors: [] };
  }

  /** Back-compat wrapper: Elliot's format via the built-in profile. */
  function parseElliotCsvNormalized(text) {
    return parseVendorCsv(text, ELLIOT_PROFILE);
  }

  /**
   * Collapse duplicate part numbers: prefer rows whose category maps to a tab;
   * among survivors with disagreeing prices, keep the lowest and warn.
   */
  function dedupeElliotRows(rows, categoryMapping) {
    const byPn = new Map();
    for (const r of rows) {
      if (!byPn.has(r.partNumber)) byPn.set(r.partNumber, []);
      byPn.get(r.partNumber).push(r);
    }
    const out = [];
    const warnings = [];
    for (const [pn, group] of byPn) {
      if (group.length === 1) {
        out.push(group[0]);
        continue;
      }
      const mapped = group.filter((r) => categoryMapping && categoryMapping[r.category]);
      const pool = mapped.length ? mapped : group;
      let keep = pool[0];
      let disagree = false;
      for (const r of pool.slice(1)) {
        if (keep.perEach > 0 && Math.abs(r.perEach - keep.perEach) / keep.perEach > 0.01) disagree = true;
        if (r.perEach > 0 && (keep.perEach === 0 || r.perEach < keep.perEach)) keep = r;
      }
      if (disagree) warnings.push({ partNumber: pn, prices: pool.map((r) => r.perEach) });
      out.push(keep);
    }
    return { rows: out, duplicateWarnings: warnings };
  }

  // ---------- Normalization / tokenization ----------

  const SYNONYMS = {
    conn: 'connector',
    connector: 'connector',
    coup: 'coupling',
    cplg: 'coupling',
    coupling: 'coupling',
    stp: 'strap',
    strap: 'strap',
    flex: 'flexible',
    flexible: 'flexible',
    gal: 'galvanized',
    galv: 'galvanized',
    galvanized: 'galvanized',
    stl: 'steel',
    steel: 'steel',
    sol: 'solid',
    solid: 'solid',
    str: 'stranded',
    strd: 'stranded',
    stranded: 'stranded',
    recept: 'receptacle',
    recpt: 'receptacle',
    receptacle: 'receptacle',
    cond: 'conduit',
    conduit: 'conduit',
    grnd: 'ground',
    gnd: 'ground',
    ground: 'ground',
    lug: 'lug',
    bushing: 'bushing',
    bush: 'bushing',
    locknut: 'locknut',
    lkn: 'locknut',
    cu: 'copper',
    cop: 'copper',
    copper: 'copper',
    al: 'aluminum',
    alu: 'aluminum',
    alum: 'aluminum',
    aluminum: 'aluminum',
  };

  // Colors and packaging words appear in Elliot SKUs but never in MC item
  // names, and don't affect price — treat as noise.
  const STOPWORDS = new Set([
    'each', 'per', 'ft', 'foot', 'the', 'of', 'with', 'w',
    'black', 'white', 'red', 'blue', 'green', 'yellow', 'brown', 'orange',
    'purple', 'gray', 'grey', 'pink', 'ivory', 'tan',
    'spool', 'reel', 'coil', 'carton', 'box', 'roll',
  ]);

  function canonFractions(s) {
    // "1 1/2", "1-1/2", "1.5" -> "1-1/2"; bare "1/2" stays "1/2"
    s = s.replace(/(\d)\s+(\d\/\d)/g, '$1-$2');
    s = s.replace(/\b1\.25\b/g, '1-1/4').replace(/\b1\.5\b/g, '1-1/2').replace(/\b2\.5\b/g, '2-1/2').replace(/\b3\.5\b/g, '3-1/2');
    return s;
  }

  function normalizeTokens(str) {
    let s = (str || '').toLowerCase();
    s = s.replace(/½/g, '1/2').replace(/¾/g, '3/4').replace(/¼/g, '1/4');
    s = canonFractions(s);
    // wire sizes: "#12", "12 awg", "12ga" -> awg12 ; "250 mcm|kcmil" -> kcmil250
    s = s.replace(/#\s*(\d+)\b/g, ' awg$1 ');
    s = s.replace(/\b(\d+)\s*(?:awg|ga)\b/g, ' awg$1 ');
    s = s.replace(/\b(\d+)\s*(?:mcm|kcmil)\b/g, ' kcmil$1 ');
    s = s.replace(/(\d)\s*x\s*(\d)/g, '$1 x $2'); // split dimensions: 3/8X4 -> 3/8 x 4
    s = s.replace(/\b\d+\s*'/g, ' ');       // spool lengths: 500', 2500'
    s = s.replace(/[^a-z0-9/\-\s]/g, ' ');
    const out = new Set();
    for (let t of s.split(/\s+/)) {
      if (!t || t.length < 2 && !/\d/.test(t)) continue;
      if (STOPWORDS.has(t)) continue;
      if (SYNONYMS[t]) t = SYNONYMS[t];
      out.add(t);
    }
    return out;
  }

  const TRADE_SIZES = ['1/2', '3/4', '1-1/4', '1-1/2', '2-1/2', '3-1/2', '1', '2', '3', '4', '5', '6'];

  function extractTradeSize(str) {
    const s = canonFractions((str || '').toLowerCase().replace(/½/g, '1/2').replace(/¾/g, '3/4').replace(/¼/g, '1/4'));
    for (const size of TRADE_SIZES) {
      // [^\d/-] guard: without excluding '-', the '1/2' in '1-1/2' matches
      // first and compound sizes are never reached.
      const re = new RegExp(`(^|[^\\d/-])${size.replace(/[/-]/g, '\\$&')}(\\s|"|in\\b|$)`);
      if (re.test(s)) return size;
    }
    return null;
  }

  function extractWireSize(str) {
    const m = (str || '').toLowerCase().match(/(?:#\s*|\b)(\d+)\s*(?:awg|ga|thhn|xhhw|thw|str|sol)\b/);
    return m ? m[1] : null;
  }

  const SYSTEMS = ['emt', 'pvc', 'rmc', 'imc', 'grc', 'ent', 'thhn', 'xhhw', 'thw', 'romex', 'nm'];

  function extractSystem(str) {
    const s = (str || '').toLowerCase();
    for (const sys of SYSTEMS) {
      if (new RegExp(`\\b${sys}\\b`).test(s)) return sys;
    }
    return null;
  }

  // ---------- Scoring ----------

  function jaccard(a, b) {
    if (!a.size || !b.size) return 0;
    let inter = 0;
    for (const t of a) if (b.has(t)) inter++;
    return inter / (a.size + b.size - inter);
  }

  /**
   * Score one MC item against one Elliot row. Both sides pre-tokenized/extracted.
   * mcMeta/elMeta: {tokens, tradeSize, wireSize, system}
   *
   * Coverage-weighted: MC item names are terse; Elliot descriptions carry
   * extra tokens. What matters most is how much of the MC name the Elliot
   * row accounts for, with plain Jaccard as a tiebreaker against rows that
   * are supersets of a generic name.
   */
  function scoreMatch(mcMeta, elMeta) {
    if (!mcMeta.tokens.size || !elMeta.tokens.size) return 0;
    let inter = 0;
    for (const t of mcMeta.tokens) if (elMeta.tokens.has(t)) inter++;
    const coverage = inter / mcMeta.tokens.size;
    let score = 0.65 * coverage + 0.35 * jaccard(mcMeta.tokens, elMeta.tokens);
    if (mcMeta.tradeSize && elMeta.tradeSize) {
      score = mcMeta.tradeSize === elMeta.tradeSize ? Math.min(1, score + 0.2) : score * 0.1;
    }
    if (mcMeta.wireSize && elMeta.wireSize) {
      score = mcMeta.wireSize === elMeta.wireSize ? Math.min(1, score + 0.2) : score * 0.1;
    }
    if (mcMeta.system && elMeta.system && mcMeta.system !== elMeta.system) {
      score *= 0.2;
    }
    // Any fraction on the MC side missing from the Elliot side (or vice versa
    // when both carry fractions) is a size mismatch: 5/8 lag bolt ≠ 3/8.
    if (mcMeta.fractions && elMeta.fractions && mcMeta.fractions.size && elMeta.fractions.size) {
      for (const f of mcMeta.fractions) {
        if (!elMeta.fractions.has(f)) {
          score *= 0.1;
          break;
        }
      }
    }
    return score;
  }

  function extractFractions(tokens) {
    const out = new Set();
    for (const t of tokens) {
      if (/^\d+(?:-\d+)?\/\d+$/.test(t)) out.add(t);
    }
    return out;
  }

  function metaFor(str) {
    const tokens = normalizeTokens(str);
    return {
      tokens,
      tradeSize: extractTradeSize(str),
      wireSize: extractWireSize(str),
      system: extractSystem(str),
      fractions: extractFractions(tokens),
    };
  }

  const AUTO_SCORE = 0.8;
  const AUTO_MARGIN = 0.15;
  const REVIEW_SCORE = 0.45;
  const PRICE_RATIO_MIN = 0.2;
  const PRICE_RATIO_MAX = 5;

  /**
   * Classify scored candidates for one MC item.
   * candidates: [{row, score}] sorted desc. oldPerEach: current model price.
   * Returns {kind: 'auto'|'review'|'none', best, candidates}
   */
  function classifyMatches(candidates, oldPerEach) {
    if (!candidates.length) return { kind: 'none', best: null, candidates: [] };
    const best = candidates[0];
    const second = candidates[1];
    let margin = second ? best.score - second.score : 1;
    // Ambiguity between near-tied candidates is immaterial when they agree on
    // price (e.g. the 10 colors of THHN #12 all cost the same) — treat as clear.
    if (margin < AUTO_MARGIN && best.row.perEach > 0) {
      const rivals = candidates.filter((c) => best.score - c.score < AUTO_MARGIN);
      const samePrice = rivals.every((c) => Math.abs(c.row.perEach - best.row.perEach) / best.row.perEach <= 0.01);
      if (samePrice) margin = 1;
    }
    const ratio = oldPerEach > 0 && best.row.perEach > 0 ? best.row.perEach / oldPerEach : 1;
    const priceOk = ratio >= PRICE_RATIO_MIN && ratio <= PRICE_RATIO_MAX;
    // No old price = no sanity band; demand near-certainty before auto-accepting.
    const scoreBar = oldPerEach > 0 ? AUTO_SCORE : 0.92;
    if (best.score >= scoreBar && margin >= AUTO_MARGIN && priceOk) {
      return { kind: 'auto', best, candidates };
    }
    if (best.score >= REVIEW_SCORE) {
      return { kind: 'review', best, candidates: candidates.slice(0, 3) };
    }
    return { kind: 'none', best: null, candidates: [] };
  }

  // ---------- Recompute ----------

  /**
   * priceModel: parsed mc-price-model.json. overlayPrices: {itemNum: newPerEach}.
   * Returns {assemblyPrices: {assmNum: {price, flag?}}, stats}.
   */
  function recomputeAssemblies(priceModel, overlayPrices) {
    const items = priceModel.items;
    const out = {};
    const stats = { updated: 0, flagged: 0, unchanged: 0, deltas: [] };
    for (const [assmNum, a] of Object.entries(priceModel.assemblies)) {
      let touched = 0;
      let newComputed = 0;
      for (const [num, qty] of a.c) {
        const ov = overlayPrices[num];
        if (ov !== undefined) touched++;
        newComputed += (ov !== undefined ? ov : items[num] ? items[num].p : 0) * qty;
      }
      if (touched === 0) {
        stats.unchanged++;
        continue;
      }
      if (a.v === 1 && a.cm > 0) {
        const newMaterial = a.m * (newComputed / a.cm);
        const oldPrice = a.u1 || a.m;
        const newPrice = a.u1 > 0 && a.m > 0 ? a.u1 * (newMaterial / a.m) : newMaterial;
        out[assmNum] = { price: Math.round(newPrice * 100) / 100 };
        stats.updated++;
        if (oldPrice > 0) stats.deltas.push((newPrice - oldPrice) / oldPrice);
      } else {
        out[assmNum] = { flag: 'unverified', computedDelta: Math.round((newComputed - a.cm) * 100) / 100 };
        stats.flagged++;
      }
    }
    const d = stats.deltas;
    stats.avgDeltaPct = d.length ? Math.round((d.reduce((s, x) => s + x, 0) / d.length) * 1000) / 10 : 0;
    delete stats.deltas;
    return { assemblyPrices: out, stats };
  }

  // ---------- Book patching ----------

  /**
   * Patch a parsed mc-labor-book.json (mutates a deep copy; returns it).
   * recompute: result of recomputeAssemblies. overlay: full overlay object.
   * categoryMapping: elliot category -> tab (null = skip).
   */
  function patchLaborBook(book, recompute, overlay, categoryMapping) {
    const patched = JSON.parse(JSON.stringify(book));
    const prices = recompute ? recompute.assemblyPrices : {};
    for (const tab of Object.values(patched.tabs)) {
      for (const section of tab) {
        for (const entry of section.entries) {
          const p = prices[entry.assmNum];
          if (!p) continue;
          if (p.price !== undefined) entry.price = p.price;
          if (p.flag) entry.flag = p.flag;
        }
      }
    }
    // Elliot branch: new items grouped per category section, appended per tab
    if (overlay && Array.isArray(overlay.newItems) && overlay.newItems.length) {
      const enabled = new Set(overlay.enabledCategories || []);
      const byTab = {};
      for (const [category, name, partNumber, price] of overlay.newItems) {
        if (enabled.size && !enabled.has(category)) continue;
        const tabName = categoryMapping ? categoryMapping[category] : null;
        if (!tabName) continue;
        if (!byTab[tabName]) byTab[tabName] = {};
        if (!byTab[tabName][category]) byTab[tabName][category] = [];
        byTab[tabName][category].push({ name, labor: 0, price, partNumber });
      }
      for (const [tabName, cats] of Object.entries(byTab)) {
        if (!patched.tabs[tabName]) patched.tabs[tabName] = [];
        // drop any previous supplier sections (idempotent re-patch)
        patched.tabs[tabName] = patched.tabs[tabName].filter((s) => !s.supplier && s.level1 !== 'Elliot');
        const vendorLabel = overlay.vendorLabel || 'Elliot';
        for (const [category, entries] of Object.entries(cats)) {
          patched.tabs[tabName].push({
            level1: vendorLabel,
            level2: category,
            level3: '',
            section: category,
            subsection: '',
            name: category,
            supplier: true,
            entries,
          });
        }
      }
    } else {
      for (const tabName of Object.keys(patched.tabs)) {
        patched.tabs[tabName] = patched.tabs[tabName].filter((s) => !s.supplier && s.level1 !== 'Elliot');
      }
    }
    patched.meta = patched.meta || {};
    patched.meta.elliot = overlay
      ? {
          sourceFile: overlay.sourceFile,
          importedAt: overlay.importedAt,
          updated: recompute ? recompute.stats.updated : 0,
          flagged: recompute ? recompute.stats.flagged : 0,
          newItems: (overlay.newItems || []).length,
        }
      : undefined;
    return patched;
  }

  return {
    parseCSVLine,
    parseVendorCsv,
    ELLIOT_PROFILE,
    parseElliotCsvNormalized,
    dedupeElliotRows,
    normalizeTokens,
    extractTradeSize,
    extractWireSize,
    extractSystem,
    metaFor,
    scoreMatch,
    classifyMatches,
    recomputeAssemblies,
    patchLaborBook,
    AUTO_SCORE,
    REVIEW_SCORE,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = McElliotCore;
