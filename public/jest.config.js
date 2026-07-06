module.exports = {
  testEnvironment: 'jsdom',
  testMatch: ['**/tests/unit/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '/dashboards/tests/'],
  transform: { '\\.js$': ['babel-jest', { presets: [['@babel/preset-env', { targets: { node: 'current' } }]] }] },
  transformIgnorePatterns: ['/node_modules/'],
  setupFiles: ['./tests/unit/setup.js'],
  collectCoverageFrom: ['dashboards/admin/js/**/*.js'],
  clearMocks: true, restoreMocks: true,
};
