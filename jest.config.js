/**
 * KOMERCE — Jest Configuration (V2.7)
 *
 * Unit tests: tests/unit/     — no DB needed, fast
 * Integration: tests/integration/ — needs PostgreSQL
 */

module.exports = {
  testEnvironment: 'node',
  testTimeout: 15000,

  // Collect coverage from source files
  collectCoverageFrom: [
    'routes/**/*.js',
    'services/**/*.js',
    'middleware/**/*.js',
    'validators/**/*.js',
    'utils/**/*.js',
    '!**/node_modules/**',
  ],

  // Coverage thresholds — mesurés le 2026-09-19 : lignes 86.76%,
  // statements 84.96%, functions 84.36%, branches 72.6% (tests unit
  // seuls, npm run test:unit:coverage). Seuils fixés avec une marge de
  // sécurité sous ces valeurs réelles — protègent contre une régression
  // significative sans bloquer sur la moindre fluctuation normale.
  coverageThreshold: {
    global: {
      branches:   65,
      functions:  78,
      lines:      80,
      statements: 78,
    },
  },

  // Test file patterns
  testMatch: [
    '**/tests/**/*.test.js',
  ],

  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/',
    '/public/',
    '/dashboard-app/',
  ],

  // Clear mocks between tests
  clearMocks: true,
  restoreMocks: true,
};
