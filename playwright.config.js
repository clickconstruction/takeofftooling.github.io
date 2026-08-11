'use strict';
// Naming split (Count Tooling convention): *.spec.js = Playwright, *.test.js = node:test unit tests.
const fs = require('fs');
const path = require('path');
const { defineConfig } = require('@playwright/test');

// .env.local (gitignored) supplies the cloud-sync test account:
//   TAKEOFF_TEST_EMAIL=...
//   TAKEOFF_TEST_PASSWORD=...
// cloud-sync.spec.js skips itself when these are absent.
try {
  const env = fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch (_) { /* no .env.local — cloud spec will skip */ }

module.exports = defineConfig({
  testMatch: '*.spec.js',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:4173',
  },
  webServer: {
    command: 'python3 scripts/dev-server.py 4173',
    port: 4173,
    reuseExistingServer: true,
  },
});
