'use strict';
// Naming split (Count Tooling convention): *.spec.js = Playwright, *.test.js = node:test unit tests.
const { defineConfig } = require('@playwright/test');

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
