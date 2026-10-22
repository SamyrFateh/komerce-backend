'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * bootstrap/feature-wiring.js : plus de fournisseur de repli de taux injecté dans utils/rates (autorité FX unique).
 */
const fs = require('fs');
const path = require('path');

describe('feature-wiring — taux de change', () => {
  test("n'injecte plus de repli de taux (configureRatesFallbackProvider supprimé)", () => {
    const src = fs.readFileSync(path.join(__dirname, '../../bootstrap/feature-wiring.js'), 'utf8');
    expect(src).not.toMatch(/configureRatesFallbackProvider|require\('\.\.\/utils\/rates'\)/);
    const rates = require('../../utils/rates');
    expect(rates.configureRatesFallbackProvider).toBeUndefined();
  });
});
