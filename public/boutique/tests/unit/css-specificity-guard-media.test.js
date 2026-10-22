'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

describe('css-specificity-guard — @media disjoints', () => {
  test('mobile (<900px) vs desktop (>=900px) ne produit aucun override', () => {
    const r = spawnSync('node', [path.join(__dirname, '../../scripts/css-specificity-guard.js'), '--strict'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toMatch(/Overrides silencieux détectés/);
  });
});
