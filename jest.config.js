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

  // Coverage thresholds (start low, increase as tests grow)
  coverageThreshold: {
    global: {
      branches:   20,
      functions:  30,
      lines:      30,
      statements: 30,
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
