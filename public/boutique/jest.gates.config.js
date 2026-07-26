/**
 * jest.gates.config.js â€” config Jest pour les tests de dÃ©tection des gates.
 *
 * SÃ©parÃ© de jest.config.js (qui cible tests/unit/ avec jsdom) parce que :
 *   1. Les tests de dÃ©tection nÃ©cessitent l'environnement node (ils exÃ©cutent
 *      des scripts via spawnSync, pas du code navigateur).
 *   2. Ils sont lents (chaque test lance un script node + parfois deploy-css)
 *      et doivent tourner en sÃ©rie pour Ã©viter les conflits d'accÃ¨s aux mÃªmes
 *      fichiers sources. La sÃ©rialisation est assurÃ©e par --runInBand en CLI
 *      (voir package.json, scripts test:gates*) + maxWorkers: 1 ci-dessous ;
 *      --runInBand n'est pas une clÃ© de config valide, seulement un flag CLI.
 *   3. Aucun setup jsdom, aucun babel-jest (scripts node pur).
 *
 * Usage :
 *   npx jest --config jest.gates.config.js
 *   npm run test:gates
 */
'use strict';

module.exports = {
  testEnvironment: 'node',
  testMatch:       ['**/tests/gates/**/*.test.js'],
  testTimeout:     90_000,      // les tests avec deploy-css peuvent prendre 30-40s
  maxWorkers:      1,           // accÃ¨s concurrent aux mÃªmes fichiers source â†’ sÃ©rie
  // Pas de coverage : ces tests dÃ©tectent des violations, pas des branches de code
  collectCoverage: false,
};
