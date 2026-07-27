/**
 * jest.gates.config.js — config Jest pour les tests de détection des gates.
 *
 * Séparé de jest.config.js (qui cible tests/unit/ avec jsdom) parce que :
 *   1. Les tests de détection nécessitent l'environnement node (ils exécutent
 *      des scripts via spawnSync, pas du code navigateur).
 *   2. Ils sont lents (chaque test lance un script node + parfois deploy-css)
 *      et doivent tourner en série pour éviter les conflits d'accès aux mêmes
 *      fichiers sources. La sérialisation est assurée par --runInBand en CLI
 *      (voir package.json, scripts test:gates*) + maxWorkers: 1 ci-dessous ;
 *      --runInBand n'est pas une clé de config valide, seulement un flag CLI.
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
  maxWorkers:      1,           // accès concurrent aux mêmes fichiers source → série
  // Pas de coverage : ces tests détectent des violations, pas des branches de code
  collectCoverage: false,
};
