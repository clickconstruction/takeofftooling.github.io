'use strict';
/**
 * Flat ESLint config. The app is classic <script>-tag JS: every js/ file is an
 * IIFE assigned to a top-level const that later scripts read by bare name, so
 * those names are declared as globals here (writable in the file that defines
 * them via no-redeclare builtinGlobals:false).
 */
const js = require('@eslint/js');
const globals = require('globals');

// Cross-file app globals (each defined in exactly one js/ file)
const appGlobals = {
  TakeoffUtils: 'readonly',
  TakeoffStorage: 'readonly',
  TakeoffCloud: 'readonly',
  TakeoffUiState: 'readonly',
  TakeoffSelectors: 'readonly',
  TakeoffState: 'readonly',
  TakeoffImport: 'readonly',
  TakeoffPDF: 'readonly',
  TakeoffApp: 'readonly',
  TakeoffViewShared: 'readonly',
  TakeoffManifestView: 'readonly',
  TakeoffModal: 'readonly',
  TakeoffLaborBookView: 'readonly',
  TakeoffLaborBookTargets: 'readonly',
  TakeoffLaborBookElliot: 'readonly',
  TakeoffLaborBookSearch: 'readonly',
  TakeoffLaborBookCard: 'readonly',
  TakeoffProjectsView: 'readonly',
  TakeoffUsersView: 'readonly',
  TakeoffDeviceView: 'readonly',
  TakeoffConduitView: 'readonly',
  TakeoffWireView: 'readonly',
  McElliotCore: 'readonly',
  McElliotState: 'readonly',
  McElliotMatch: 'readonly',
  McElliotUpdate: 'readonly',
  McBook: 'readonly',
  FITTINGS_LIST: 'readonly',
  LABOR_BOOK_DEFAULTS: 'readonly',
  LABOR_BOOK_DEFAULT_GROUPS: 'readonly',
  LABOR_BOOK_DEFAULTS_VERSION: 'readonly',
  TakeoffLaborBookMerge: 'readonly',
  TakeoffSuggestionsReview: 'readonly',
  jspdf: 'readonly',
  supabase: 'readonly', // @supabase/supabase-js UMD (CDN)
};

module.exports = [
  {
    ignores: ['node_modules/**', 'source-data/**', 'mc-assemblies/**', 'test-results/**', 'playwright-report/**'],
  },
  js.configs.recommended,
  {
    rules: {
      'no-undef': 'error',
      'no-redeclare': ['error', { builtinGlobals: false }],
      // varsIgnorePattern: top-level IIFE module globals are "unused" within
      // their own file but consumed cross-file by later <script>s.
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        caughtErrors: 'none',
        varsIgnorePattern: '^(Takeoff[A-Z]|Mc[A-Z]|FITTINGS_LIST$|LABOR_BOOK_DEFAULT)',
      }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...appGlobals },
    },
  },
  {
    // dual browser/Node modules use guarded require/module.exports
    files: ['js/elliotPriceCore.js', 'js/mcElliotMatch.js', 'js/selectors.js', 'js/laborBookMerge.js'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...appGlobals },
    },
  },
  {
    files: ['scripts/**/*.js', '*.test.js', 'eslint.config.js', 'playwright.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
  {
    // Playwright specs run in Node but page.evaluate callbacks reference
    // browser + app globals.
    files: ['*.spec.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser, ...appGlobals },
    },
  },
];
