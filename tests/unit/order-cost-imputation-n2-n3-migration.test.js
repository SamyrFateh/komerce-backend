'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const migration = fs.readFileSync(
  path.join(__dirname, '../../migrations/164_order_item_cost_imputations_split_n2_n3.sql'),
  'utf8'
);

describe('migration 164 — split N2/N3 order cost snapshots', () => {
  it('ajoute les deux colonnes sans casser le champ CDR legacy', () => {
    expect(migration).toContain('estimated_business_variable_cost_kmf');
    expect(migration).toContain('estimated_fixed_overhead_kmf');
    expect(migration).not.toContain('DROP COLUMN estimated_business_complete_cost_kmf');
  });

  it('backfill N2 depuis payment + risk_provision et N3 depuis fixed_overhead', () => {
    expect(migration).toContain("{business,payment}");
    expect(migration).toContain("{business,risk_provision}");
    expect(migration).toContain("{business,fixed_overhead}");
    expect(migration).toContain('* quantity');
  });

  it('laisse NULL quand le breakdown historique ne permet pas une reconstruction fiable', () => {
    expect(migration).toContain("IS NOT NULL");
    expect(migration).not.toMatch(/estimated_business_variable_cost_kmf\s*=\s*0/);
    expect(migration).not.toMatch(/estimated_fixed_overhead_kmf\s*=\s*0/);
  });
});
