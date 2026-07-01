module.exports = {
  testEnvironment: 'jsdom',
  testMatch: ['**/tests/unit/**/*.test.js'],
  transform: { '\\.js$': ['babel-jest', { presets: [['@babel/preset-env', { targets: { node: 'current' } }]] }] },
  transformIgnorePatterns: ['/node_modules/'],
  setupFiles: ['./tests/unit/setup.js'],
  collectCoverageFrom: ['admin/js/**/*.js', '!admin/js/views/**'],
  clearMocks: true, restoreMocks: true,
};
