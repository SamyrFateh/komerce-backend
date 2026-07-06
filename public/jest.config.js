module.exports = {
  testEnvironment: 'jsdom',
  testMatch: ['**/tests/unit/**/*.test.js', '**/tests/views/**/*.test.js'],
  // Ancré avec <rootDir> : sans ça, un checkout dans un dossier nommé
  // "dashboards" (le nom naturel du repo) fait matcher CE dossier lui-même
  // sur le pattern "/dashboards/tests/", et Jest ignore alors TOUS les
  // tests réels (audit 2026-07-07 — "No tests found" en CI comme en local).
  // Cette règle vise l'ancien sous-dossier dupliqué dashboards/dashboards/tests/
  // (backup historique), pas le repo courant.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/dashboards/tests/'],
  transform: { '\\.js$': ['babel-jest', { presets: [['@babel/preset-env', { targets: { node: 'current' } }]] }] },
  transformIgnorePatterns: ['/node_modules/'],
  setupFiles: ['./tests/unit/setup.js'],
  // Idem : le repo a été aplati, admin/js est à la racine, pas sous dashboards/.
  collectCoverageFrom: ['admin/js/**/*.js'],
  clearMocks: true, restoreMocks: true,
};
