'use strict';

const base = require('./jest.config');

module.exports = {
  ...base,
  roots: [
    '<rootDir>/tests/unit',
    '<rootDir>/tests/invariants',
    '<rootDir>/tests/contract',
    '<rootDir>/tests/notifications',
  ],
  // tests/parcelOptimization.test.js est à la racine de tests/ —
  // déclaré explicitement car les roots ne couvrent que les sous-dossiers.
  testMatch: [
    '**/*.test.js',
    '<rootDir>/tests/parcelOptimization.test.js',
  ],

};
