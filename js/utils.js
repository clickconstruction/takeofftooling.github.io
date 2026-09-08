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

  // Identity key for "the same manifest description": every place that merges
  // or matches rows by description (purchase list, import preview, import
  // merge) must use this one key so a badge and its outcome can't disagree.
  function descKey(s) {
    return (s == null ? '' : String(s)).trim().toLowerCase().replace(/\s+/g, ' ');
  }

  // Supply-house catalogs abbreviate; estimators type the word. Spellings in
  // one group find each other in either direction ("receptacle" finds RECP,
  // "recp" finds RECEPTACLE). A spelling the estimator did NOT type only ever
  // matches as a whole word: "support" reaches "BOX SUPP BRKT" through "supp"
  // without dragging in "POWER SUPPLY".
  const SEARCH_SYNONYMS = [
    ['receptacle', 'recept', 'recp', 'rcpt'],
    // MC writes an enclosed breaker "ENCL CB 2P"; the trade says breaker
    ['breaker', 'brkr', 'bkr', 'cb'],
    ['coupling', 'cplg', 'coup'],
    ['connector', 'connr', 'conn'],
    ['transformer', 'xfrmr', 'xfmr', 'transf'],
    ['switch', 'swtch', 'sw'],
    ['fixture', 'fixt'],
    ['flexible', 'flex'],
    ['galvanized', 'galv'],
    ['aluminum', 'alum', 'al'],
    ['copper', 'cu'],
    ['stranded', 'strd', 'str'],
    ['solid', 'sol'],
    ['insulated', 'insl', 'ins'],
    ['liquidtight', 'liq', 'lt'],
    ['nipple', 'nip'],
    ['cover', 'cvr'],
    ['plate', 'plt'],
    ['weatherproof', 'wp'],
    ['grounding', 'ground', 'grnd', 'grd', 'gnd'],
    ['bushing', 'bshg', 'bush'],
    ['locknut', 'lknt'],
    ['panel', 'pnl'],
    ['circuit', 'ckt'],
    ['rigid', 'rgd'],
    ['steel', 'stl'],
    ['compression', 'compr', 'comp'],
    ['setscrew', 'ss'],
    ['gfci', 'gfi'],
    ['duplex', 'dplx'],
    ['single', 'sgl'],
    ['dimmer', 'dim'],
    ['occupancy', 'occ'],
    ['sensor', 'sens'],
    ['junction', 'junc', 'jct'],
    // a "90" is an elbow on every job; the catalog writes '90D EMT ELB'
    ['elbow', 'elb', 'ell', '90', '90d'],
    // MC cable connectors: the trade says "mac", the book says "MC"
    ['mac', 'mc'],
    ['fitting', 'ftg'],
    ['adapter', 'adpt', 'adap'],
    ['reducer', 'rdcr'],
    ['washer', 'wshr'],
    ['screw', 'scr'],
    ['anchor', 'anch'],
    ['terminal', 'term'],
    ['emergency', 'emerg'],
    ['cable', 'cbl'],
    ['clamp', 'clmp'],
    ['bracket', 'brkt', 'bkt'],
    ['support', 'supp'],
    ['mounting', 'mount', 'mtg'],
    ['surface', 'surf'],
    ['threaded', 'thrd', 'thd'],
    ['conduit', 'cndt'],
    ['ballast', 'blst'],
    ['black', 'blk'],
    ['white', 'wht'],
    ['green', 'grn'],
    ['yellow', 'yel'],
    ['gray', 'grey', 'gry'],
  ];
  const SYNONYM_GROUP = new Map();
  for (const group of SEARCH_SYNONYMS) for (const word of group) SYNONYM_GROUP.set(word, group);

  // A query token's alternatives: its synonym group when it has one (also
  // tried singular — "breakers" → breaker), otherwise just itself.
  function tokenAlternatives(token) {
    const group =
      SYNONYM_GROUP.get(token) ||
      (token.endsWith('es') && SYNONYM_GROUP.get(token.slice(0, -2))) ||
      (token.endsWith('s') && SYNONYM_GROUP.get(token.slice(0, -1)));
    return group ? Array.from(new Set([token, ...group])) : [token];
  }

  // Phrases the trade writes more than one way. These can't live in
  // SEARCH_SYNONYMS because a phrase spans tokens: a query holding one becomes
  // several candidate queries, and a row matching any of them is a hit.
  const SEARCH_PHRASES = [
    ['circuit breaker', 'breaker', 'cb'],
    ['exit sign', 'exit light', 'exit fixture'],
    ['4 square', '4s', '4sq', '1900'],
    ['single pole', '1p', 'sp'],
    ['pull string', 'pull line', 'pull tape'],
    // the wire flow's MAC adapter is the book's MC connector
    ['mac adapter', 'mc connector', 'mc conn'],
  ];

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // The candidate queries for one typed query: itself, plus the phrase
  // rewrites. Only the first matching phrase group fires, so the candidate
  // list stays short.
  function queryVariants(q) {
    for (const group of SEARCH_PHRASES) {
      for (const member of group) {
        const re = new RegExp(`(^|\\s)${escapeRegExp(member)}(\\s|$)`);
        if (re.test(q)) return group.map((alt) => q.replace(re, `$1${alt}$2`));
      }
    }
    return [q];
  }

  /**
   * Build a ranker for a search query: every whitespace-separated token must
   * appear somewhere in the haystack, in any order — so '3/4 EMT coupling'
   * matches '3/4" MIGHTY-SEAL PUSH STEEL EMT COUPLING' and
   * 'duplex receptacle 20a' matches 'TR DUPLEX RECP 20A 125V' via synonyms.
   *
   * Returns fn(haystack) → score: 0 for no match, higher for a better one.
   * The score is what keeps the synonyms usable — a row holding the words the
   * estimator actually typed outranks one reached only through an
   * abbreviation, so 'cb → breaker' can exist without burying every
   * breaker query under 52 ENCL CB rows.
   *
   * An empty query matches everything at score 1. Pre-tokenizes once, so
   * build it outside loops over large lists.
   */
  function makeSearchRanker(query) {
    const raw = searchNorm(query).trim();
    if (!raw) return () => 1;
    const typedTokens = new Set(raw.split(/\s+/).filter(Boolean));
    const variants = queryVariants(raw).map((text) => ({
      text,
      // per token: the alternatives that would satisfy it, typed spelling first
      tests: text
        .split(/\s+/)
        .filter(Boolean)
        .map((token) =>
          tokenAlternatives(token).map((alt) => {
            const typed = alt === token && typedTokens.has(token);
            // Only the spelling the estimator typed may match inside a word
            // (and only when it's long enough to mean something). Everything
            // reached through a synonym must be a whole word.
            const test =
              typed && alt.length >= 4
                ? (h) => h.includes(alt)
                : ((re) => (h) => re.test(h))(new RegExp(`(^|[^a-z0-9])${escapeRegExp(alt)}([^a-z0-9]|$)`));
            return { typed, test };
          })
        ),
    }));
    return (haystack) => {
      const h = searchNorm(haystack);
      let best = 0;
      for (const variant of variants) {
        let literal = 0;
        let ok = true;
        for (const alts of variant.tests) {
          const hit = alts.find((a) => a.test(h));
          if (!hit) {
            ok = false;
            break;
          }
          if (hit.typed) literal++;
        }
        if (!ok) continue;
        // 1 for matching + 1 per token matched in the words typed + the
        // words in the typed order + the row that starts with them
        let score = 1 + literal;
        if (h.includes(variant.text)) score += 1;
        if (h.startsWith(variant.text)) score += 1;
        if (score > best) best = score;
      }
      return best;
    };
  }

  /** The same rule as a yes/no: fn(haystack) → boolean. */
  function makeTokenMatcher(query) {
    const rank = makeSearchRanker(query);
    return (haystack) => rank(haystack) > 0;
  }

  /**
   * Sort search hits best-match-first without disturbing equal ones: the
   * book's own order is meaningful (sizes run small to large), so ties keep it.
   * `hits` is [{ score, ... }]; returns a new array.
   */
  function rankedByScore(hits) {
    return hits
      .map((hit, i) => ({ hit, i }))
      .sort((a, b) => b.hit.score - a.hit.score || a.i - b.i)
      .map((x) => x.hit);
  }

  /**
   * The one money parser. Estimators type prices the way they write them —
   * '$21,450.75', '1,975', ' 2400 ' — so strip the dollar sign, thousands
   * commas and whitespace before believing a number.
   *
   * Returns:
   *   number  a finite amount
   *   null    the field is blank (a deliberate "no price")
   *   NaN     the text is not money — the caller must reject it, keep the
   *           typed text on screen and flag the field
   *
   * Exponent, hex and multi-dot forms are rejected on purpose: '1e5' is not
   * a price anyone writes on a quote.
   */
  function parseMoney(value) {
    if (value == null) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    const cleaned = String(value).replace(/[$,\s\u00a0]/g, '');
    if (cleaned === '') return null;
    if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(cleaned)) return NaN;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }

  // One money formatter and one hours formatter for every surface (summary,
  // purchase list, flows, PDFs), so the same job never prints two totals.
  // Money: thousands separators, 2 decimals at or above $1, 4 below (a
  // supplier's $0.1334 must not round to $0.13). Hours: 2 decimals.
  function formatMoney(n, opts) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '0.00';
    const abs = Math.abs(v);
    const decimals = abs > 0 && abs < 1 && !(opts && opts.fixed2) ? 4 : 2;
    return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }
  function formatHours(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '0.00';
    return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  return {
    escapeHtml,
    searchNorm,
    descKey,
    makeTokenMatcher,
    makeSearchRanker,
    rankedByScore,
    parseMoney,
    formatMoney,
    formatHours,
  };
})();

// Node (unit tests); inert in the browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TakeoffUtils;
}
