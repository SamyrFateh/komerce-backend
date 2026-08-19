'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const SQL = fs.readFileSync(
  path.resolve(__dirname, '../../migrations/135_transport_freight_canonization.sql'),
  'utf8'
);

describe('migration 135 — freight canonization', () => {
  test('crée le coût SEA depuis finance_config, pas depuis une constante', () => {
    expect(SQL).toMatch(/SEA_EUR_PER_M3_COST/);
    expect(SQL).toMatch(/jsonb_build_object\('value',\s*fret_eur_per_m3\)/);
    expect(SQL).toMatch(/FROM\s+finance_config/i);
  });

  test('ne crée jamais un coût AIR non calibré', () => {
    expect(SQL).not.toMatch(/INSERT[\s\S]*AIR_KMF_PER_KG_COST/i);
  });

  test('désactive les valorisations freight génériques et pose un ratchet DB', () => {
    expect(SQL).toMatch(/UPDATE\s+cost_components[\s\S]*category\s*=\s*'freight'/i);
    expect(SQL).toMatch(/is_active\s*=\s*FALSE/i);
    expect(SQL).toMatch(/cost_components_no_active_dedicated_freight/);
    expect(SQL).toMatch(/CHECK\s*\(NOT\s*\(category\s*=\s*'freight'\s+AND\s+is_active\s*=\s*TRUE\)\)/i);
  });
});
