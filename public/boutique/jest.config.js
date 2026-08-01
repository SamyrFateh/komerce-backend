module.exports = {
  testEnvironment: 'jsdom',
  testMatch: ['**/tests/unit/**/*.test.js'],
  transform: {
    '\\.js$': ['babel-jest', {
      presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
    }],
  },
  transformIgnorePatterns: ['/node_modules/'],
  setupFiles: ['./tests/unit/setup.js'],
  setupFilesAfterEnv: ['./tests/unit/setup-after-env.js'],
  collectCoverageFrom: [
    'js/**/*.js',
    '!js/dist/**',
    '!js/**/*.test.js',
    '!js/**/__tests__/**',
  ],
  coveragePathIgnorePatterns: [
    '/js/dist/',
    '\\.test\\.js$',
  ],
  coverageReporters: ['text-summary', 'json-summary', 'lcov'],
  clearMocks: true,
  restoreMocks: true,
};
