'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const ce = require('../../services/cost-allocation/cost-expectation');

describe('coûts applicables et attendus selon le stade (D1)', () => {
  test('aucune charge de structure n’est jamais exigée par commande', () => {
    expect(ce.COST_RULES.map(r => r.type)).not.toContain('fixed_overhead');
    expect(ce.COST_RULES.map(r => r.type)).not.toContain('risk_provision');
    expect(ce.expectedTypes({ status: 'collected', payment_mode: 'stripe_eur' })).not.toContain('fixed_overhead');
  });

  test('commande en attente : rien n’est attendu', () => {
    expect(ce.expectedTypes({ status: 'pending' })).toEqual([]);
    expect(ce.describeOrderCosts({ status: 'pending' }).nothing_expected_yet).toBe(true);
  });

  test('commande récente : douane non encore attendue, ce n’est pas un manque', () => {
    const d = ce.describeOrderCosts({ status: 'preparation', payment_mode: 'stripe_eur', missing_cost_types: ['product_purchase'] });
    expect(d.missing.map(m => m.type)).toEqual(['product_purchase']);
    expect(d.not_yet_expected.map(m => m.type)).toEqual(expect.arrayContaining(['customs', 'port_transitaire', 'freight']));
    expect(ce.expectedTypes({ status: 'preparation' })).not.toContain('customs');
  });

  test('douane attendue une fois la commande disponible', () => {
    expect(ce.expectedTypes({ status: 'available', payment_mode: 'stripe_eur' })).toEqual(expect.arrayContaining(['customs', 'port_transitaire', 'local_distribution']));
    expect(ce.expectedTypes({ status: 'available' })).not.toContain('relay');
    expect(ce.expectedTypes({ status: 'collected' })).toContain('relay');
  });

  test('cash au relais : frais de paiement non applicables, avec motif', () => {
    expect(ce.expectedTypes({ status: 'confirmed', payment_mode: 'cash_relais' })).not.toContain('payment');
    expect(ce.expectedTypes({ status: 'confirmed', payment_mode: 'stripe_eur' })).toContain('payment');
    const d = ce.describeOrderCosts({ status: 'confirmed', payment_mode: 'cash_relais' });
    expect(d.not_applicable).toEqual([expect.objectContaining({ type: 'payment', motif: expect.stringContaining('espèces') })]);
  });

  test('l’absence de mécanisme de collecte reste un manque fonctionnel, jamais « non applicable »', () => {
    const d = ce.describeOrderCosts({ status: 'preparation', payment_mode: 'stripe_eur', missing_cost_types: ['packaging', 'product_purchase'] });
    const packaging = d.missing.find(m => m.type === 'packaging');
    expect(packaging.state).toBe('unknown');
    expect(packaging.collection_mechanism).toBe(false);
    expect(packaging.note).toMatch(/collecte absent/);
    expect(d.not_applicable.map(x => x.type)).not.toContain('packaging');
    expect(d.missing.find(m => m.type === 'product_purchase').collection_mechanism).toBe(true);
  });

  test('SQL : seul le réel justifié compte, l’héritage monthly_recalc et les estimations sont exclus', () => {
    const sql = ce.realCostPresentSql('o', 'e.t');
    expect(sql).toContain('is_actual = TRUE');
    expect(sql).toContain("<> 'monthly_recalc'");
    expect(ce.hasMissingExpectedSql('o')).toContain('NOT EXISTS'.length ? 'NOT' : '');
    expect(ce.expectedTypesSql('o')).not.toContain('fixed_overhead');
    expect(ce.nothingExpectedYetSql('o')).toContain('< 1');
  });
});
