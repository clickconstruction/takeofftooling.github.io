#!/usr/bin/env node
/**
 * Keep the Deno-side copies of the pure kernels and the shipped book in step with
 * the browser sources. Edge functions only bundle their own directory plus
 * supabase/functions/_shared, so:
 *   js/explode.js               → supabase/functions/_shared/explode.js   (byte-identical)
 *   js/handoff.js               → supabase/functions/_shared/handoff.js   (byte-identical)
 *   js/data/laborBookDefaults.js → supabase/functions/_shared/laborBookDefaults.json
 *                                 (LABOR_BOOK_DEFAULTS evaluated and serialized —
 *                                  the agent door prices with it when a twin has
 *                                  no synced book of its own)
 * Run after editing any of the three: `npm run build:shared`. `--check` exits 1
 * when a copy is stale (part of `npm run check`).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const shared = path.join(root, 'supabase', 'functions', '_shared');
const check = process.argv.includes('--check');

const copies = [
  ['js/explode.js', 'explode.js'],
  ['js/handoff.js', 'handoff.js'],
];

function bookJson() {
  const src = fs.readFileSync(path.join(root, 'js/data/laborBookDefaults.js'), 'utf8');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src + ';globalThis.__book = LABOR_BOOK_DEFAULTS; globalThis.__v = LABOR_BOOK_DEFAULTS_VERSION;', ctx);
  return JSON.stringify({ version: ctx.__v, laborBook: ctx.__book }, null, 1) + '\n';
}

const wanted = [
  ...copies.map(([from, to]) => [to, fs.readFileSync(path.join(root, from), 'utf8')]),
  ['laborBookDefaults.json', bookJson()],
];

let stale = 0;
fs.mkdirSync(shared, { recursive: true });
for (const [name, content] of wanted) {
  const target = path.join(shared, name);
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  if (current === content) continue;
  stale++;
  if (check) console.error(`stale: supabase/functions/_shared/${name} (run npm run build:shared)`);
  else {
    fs.writeFileSync(target, content);
    console.log(`wrote supabase/functions/_shared/${name}`);
  }
}
if (check) {
  if (stale) process.exit(1);
  console.log('shared kernels + book JSON are current');
} else if (!stale) console.log('shared kernels + book JSON already current');
