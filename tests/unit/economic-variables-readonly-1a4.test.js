'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const RUNTIME_FILES = [
  'services/economic-engine-queries.js',
  'services/dashboard-ops-queries.js',
  'utils/eco-bridge.js',
  'routes/economic.js',
];

function source(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('LOT 1A-4 — economic_variables runtime read-only ratchet', () => {
  test.each(RUNTIME_FILES)('%s ne contient aucun writer economic_variables', (rel) => {
    const text = source(rel);
    expect(text).not.toMatch(/UPDATE\s+economic_variables/i);
    expect(text).not.toMatch(/INSERT\s+INTO\s+economic_variables/i);
    expect(text).not.toMatch(/DELETE\s+FROM\s+economic_variables/i);
  });

  test('le moteur garde seulement des lectures forensic de economic_variables', () => {
    const text = source('services/economic-engine-queries.js');
    expect(text).toMatch(/FROM economic_variables WHERE is_active = TRUE/i);
    expect(text).toMatch(/ABS\(value_observed - value_supposed\)/i);
  });

  test('le bridge historique déclare finance_config comme source et pas economic_variables', () => {
    const text = source('utils/eco-bridge.js');
    expect(text).toMatch(/economicConfig\.loadFinanceConfig\(\)/);
    expect(text).not.toMatch(/FROM economic_variables/i);
  });
});
