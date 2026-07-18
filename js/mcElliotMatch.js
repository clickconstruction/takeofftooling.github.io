/**
 * Chunked async matcher: MC component items vs Elliot rows.
 * Inverted token index keeps candidate sets small; setTimeout chunking keeps
 * the UI responsive on the ~5,900-item first run.
 */

const McElliotMatch = (function () {
  // Dual browser/Node: in the browser McElliotCore is a prior <script>;
  // in Node (scripts/apply-elliot-prices.js --match) we require it.
  const core = typeof McElliotCore !== 'undefined'
    ? McElliotCore
    : require('./elliotPriceCore.js');
  const CHUNK_SIZE = 500;
  const MAX_CANDIDATES = 500;

  // Yield to the event loop without setTimeout: timer chains get throttled
  // hard in backgrounded/occluded tabs, but MessageChannel posts do not.
  // In Node use setImmediate — open MessageChannel ports would keep the
  // process alive after the run completes.
  const yieldToLoop = (() => {
    if (typeof setImmediate === 'function') {
      return (fn) => setImmediate(fn);
    }
    if (typeof MessageChannel !== 'undefined') {
      return (fn) => {
        const ch = new MessageChannel();
        ch.port1.onmessage = () => {
          ch.port1.close();
          fn();
        };
        ch.port2.postMessage(null);
      };
    }
    return (fn) => setTimeout(fn, 0);
  })();

  /**
   * rows: normalized Elliot rows. Returns {index: Map<token, number[]>, metas: []}
   */
  function buildElliotIndex(rows) {
    const index = new Map();
    const metas = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const meta = core.metaFor(rows[i].description + ' ' + rows[i].name);
      metas[i] = meta;
      for (const t of meta.tokens) {
        let list = index.get(t);
        if (!list) index.set(t, (list = []));
        list.push(i);
      }
    }
    return { index, metas };
  }

  function candidatesFor(meta, elliotIndex) {
    // union of postings for the item's 3 rarest tokens
    const postings = [];
    for (const t of meta.tokens) {
      const list = elliotIndex.index.get(t);
      if (list) postings.push(list);
    }
    postings.sort((a, b) => a.length - b.length);
    const cand = new Set();
    for (const list of postings.slice(0, 3)) {
      for (const i of list) {
        cand.add(i);
        if (cand.size >= MAX_CANDIDATES) break;
      }
      if (cand.size >= MAX_CANDIDATES) break;
    }
    return cand;
  }

  /**
   * Match all unmapped MC items against Elliot rows.
   *
   * items: priceModel.items ({itemNum: {n, p, u}})
   * rows: deduped Elliot rows
   * mappings: effective partNumber -> itemNum (already-confirmed matches skip scoring)
   * onProgress(done, total)
   *
   * Resolves {auto: {itemNum: {partNumber, perEach}}, review: [queueEntry], mappedApplied: n}
   */
  function runMatching(items, rows, mappings, onProgress) {
    return new Promise((resolve) => {
      const rowByPn = new Map(rows.map((r) => [r.partNumber, r]));
      const mappedItemNums = new Set();
      const auto = {};
      let mappedApplied = 0;

      // saved mappings resolve instantly
      for (const [pn, itemNum] of Object.entries(mappings)) {
        const row = rowByPn.get(pn);
        if (row && items[itemNum]) {
          auto[itemNum] = { partNumber: pn, perEach: row.perEach, via: 'saved' };
          mappedItemNums.add(String(itemNum));
          mappedApplied++;
        }
      }

      const todo = Object.entries(items).filter(([num]) => !mappedItemNums.has(num));
      const total = todo.length;
      if (total === 0) {
        resolve({ auto, review: [], mappedApplied });
        return;
      }

      const elliotIndex = buildElliotIndex(rows);
      const review = [];
      let pos = 0;

      function chunk() {
        const end = Math.min(pos + CHUNK_SIZE, total);
        for (; pos < end; pos++) {
          const [itemNum, item] = todo[pos];
          const meta = core.metaFor(item.n);
          if (!meta.tokens.size) continue;
          const scored = [];
          for (const i of candidatesFor(meta, elliotIndex)) {
            const s = core.scoreMatch(meta, elliotIndex.metas[i]);
            if (s > 0.2) scored.push({ row: rows[i], score: s });
          }
          scored.sort((a, b) => b.score - a.score);
          const cls = core.classifyMatches(scored, item.p);
          if (cls.kind === 'auto') {
            auto[itemNum] = { partNumber: cls.best.row.partNumber, perEach: cls.best.row.perEach, via: 'auto', score: cls.best.score };
          } else if (cls.kind === 'review') {
            review.push({
              itemNum: Number(itemNum),
              itemName: item.n,
              oldPerEach: item.p,
              candidates: cls.candidates.map((c) => ({
                pn: c.row.partNumber,
                desc: c.row.description || c.row.name,
                perEach: Math.round(c.row.perEach * 10000) / 10000,
                score: Math.round(c.score * 100) / 100,
              })),
            });
          }
        }
        if (onProgress) onProgress(pos, total);
        if (pos < total) {
          yieldToLoop(chunk);
        } else {
          resolve({ auto, review, mappedApplied });
        }
      }

      yieldToLoop(chunk);
    });
  }

  return { runMatching, buildElliotIndex };
})();

// Node (scripts/); inert in the browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = McElliotMatch;
}
