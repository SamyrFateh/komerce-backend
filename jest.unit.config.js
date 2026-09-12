'use strict';

const base = require('./jest.config');

module.exports = {
  ...base,
  // `roots` scope la haste map de Jest (le graphe require() utilisé par
  // --findRelatedTests), pas seulement la recherche de fichiers de test.
  // Un roots limité aux dossiers tests/* rend le tier 1 du gate
  // (scripts/run-staged-related-tests.js -> --findRelatedTests) inopérant
  // pour tout require() venant de routes/, services/, middleware/, etc. :
  // ces fichiers sont invisibles au graphe, donc jamais "related". On élargit
  // à <rootDir> pour que le code source backend soit dans la haste map, et on
  // restreint testMatch (au lieu de roots) pour continuer à n'exécuter que les
  // suites unitaires visées par ce config (pas integration/e2e/governance).
  roots: ['<rootDir>'],
  testMatch: [
    '<rootDir>/tests/unit/**/*.test.js',
    '<rootDir>/tests/invariants/**/*.test.js',
    '<rootDir>/tests/contract/**/*.test.js',
    '<rootDir>/tests/notifications/**/*.test.js',
    '<rootDir>/tests/parcelOptimization.test.js',
  ],
};
