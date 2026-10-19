'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const ce = require('../../services/cost-allocation/cost-expectation');

const IMPORTED = { imported: true, payment_mode: 'stripe_eur', relay_beneficiary: true };

describe('coûts applicables et attendus (D1) — règles et scénarios', () => {
  test('aucune charge de structure n’est jamais exigée par commande', () => {
    const types = ce.COST_RULES.map(r => r.type);
    expect(types).not.toContain('fixed_overhead');
    expect(types).not.toContain('risk_provision');
    expect(ce.expectedTypes({ ...IMPORTED, status: 'collected', customs_event: true })).not.toContain('fixed_overhead');
  });

  test('S0 commande en attente : rien n’est attendu', () => {
    expect(ce.expectedTypes({ status: 'pending', ...IMPORTED })).toEqual([]);
    expect(ce.describeOrderCosts({ status: 'pending' }).nothing_expected_yet).toBe(true);
  });

  test('S1 commande importée avant déclaration douane : douane inconnue mais NON attendue (visible, pas anormale)', () => {
    const ctx = { ...IMPORTED, status: 'in_transit', customs_event: false };
    expect(ce.expectedTypes(ctx)).not.toEqual(expect.arrayContaining(['customs']));
    const d = ce.describeOrderCosts({ ...ctx, missing_cost_types: ['product_purchase'] });
    expect(d.missing.map(m => m.type)).toEqual(['product_purchase']);
    expect(d.not_yet_expected.find(x => x.type === 'customs').expected_when).toBe('expédition douane déclarée');
  });

  test('S2 expédition douane déclarée : douane, fret et port deviennent attendus (indépendamment du statut « disponible »)', () => {
    const types = ce.expectedTypes({ ...IMPORTED, status: 'shipped', customs_event: true });
    expect(types).toEqual(expect.arrayContaining(['customs', 'freight', 'port_transitaire']));
    const d = ce.describeOrderCosts({ ...IMPORTED, status: 'shipped', customs_event: true, missing_cost_types: ['customs'] });
    expect(d.missing[0]).toMatchObject({ type: 'customs', state: 'unknown' });
  });

  test('S3 commande sans ligne importée : douane, fret et port non applicables, avec motif', () => {
    const d = ce.describeOrderCosts({ status: 'collected', payment_mode: 'stripe_eur', imported: false, customs_event: false, relay_beneficiary: true });
    expect(d.not_applicable.map(x => x.type)).toEqual(expect.arrayContaining(['customs', 'freight', 'port_transitaire']));
    d.not_applicable.forEach(x => expect(x.motif).toBeTruthy());
  });

  test('S5 cash au relais : pas de frais de prestataire de paiement, commission relais et collecte restent distincts', () => {
    expect(ce.expectedTypes({ status: 'confirmed', payment_mode: 'cash_relais', relay_beneficiary: true })).not.toContain('payment');
    expect(ce.expectedTypes({ status: 'confirmed', payment_mode: 'stripe_eur' })).toContain('payment');
    const d = ce.describeOrderCosts({ status: 'confirmed', payment_mode: 'cash_relais', relay_beneficiary: true });
    const motif = d.not_applicable.find(x => x.type === 'payment').motif;
    expect(motif).toMatch(/aucun prestataire/);
    expect(motif).toMatch(/commission relais/);
    expect(motif).toMatch(/collecte ou de transfert/);
  });

  test('S6 relais : commission attendue à la remise, seulement avec un bénéficiaire identifié', () => {
    expect(ce.expectedTypes({ ...IMPORTED, status: 'available', customs_event: true })).not.toContain('relay');
    expect(ce.expectedTypes({ ...IMPORTED, status: 'collected', customs_event: true })).toContain('relay');
    const d = ce.describeOrderCosts({ status: 'collected', payment_mode: 'stripe_eur', relay_beneficiary: false });
    expect(d.not_applicable.find(x => x.type === 'relay').motif).toMatch(/bénéficiaire/);
  });

  test('L1 : coût sans collecteur automatique = saisie manuelle traçable requise, inconnu jamais zéro ni « non applicable »', () => {
    const d = ce.describeOrderCosts({ ...IMPORTED, status: 'preparation', missing_cost_types: ['packaging', 'product_purchase'] });
    const packaging = d.missing.find(m => m.type === 'packaging');
    expect(packaging).toMatchObject({ state: 'unknown', collection_mechanism: true, mechanism: 'manual_entry' });
    expect(packaging.note).toMatch(/saisie manuelle traçable/);
    expect(packaging.note).toMatch(/jamais zéro/);
    expect(d.missing.find(m => m.type === 'product_purchase').mechanism).toBe('automatic');
    expect(d.not_applicable.map(x => x.type)).not.toContain('packaging');
    expect(d.missing.find(m => m.type === 'product_purchase').collection_mechanism).toBe(true);
  });

  test('S7 coûts complets à son stade ≠ marge réelle finale calculable', () => {
    const early = ce.describeOrderCosts({ ...IMPORTED, status: 'preparation', missing_cost_types: [] });
    expect(early.costs_complete_at_stage).toBe(true);
    expect(early.margin).toMatchObject({ final_computable: false, reason: 'not_final_stage' });

    const customsUnknown = ce.describeOrderCosts({ ...IMPORTED, status: 'collected', customs_event: false, customs_unknown: true, missing_cost_types: [] });
    expect(customsUnknown.costs_complete_at_stage).toBe(true);
    expect(customsUnknown.margin).toMatchObject({ final_computable: false, reason: 'customs_unknown' });

    const missing = ce.describeOrderCosts({ ...IMPORTED, status: 'collected', customs_event: true, missing_cost_types: ['relay'] });
    expect(missing.margin).toMatchObject({ final_computable: false, reason: 'costs_missing' });

    const ready = ce.describeOrderCosts({ ...IMPORTED, status: 'collected', customs_event: true, customs_unknown: false, missing_cost_types: [] });
    expect(ready.margin).toMatchObject({ final_computable: true });
  });

  test('SQL : événement douane déclarée, seul le réel justifié compte, zéro confirmé accepté, héritage exclu', () => {
    const sql = ce.expectedTypesSql('o');
    expect(sql).toContain("ce_cs.status = 'declared'");
    expect(sql).toContain('o.relais_id IS NOT NULL');
    expect(sql).not.toContain('fixed_overhead');
    const customsClause = sql.match(/SELECT 'customs'::text AS t WHERE[\s\S]*?(?=UNION ALL)/)[0];
    expect(customsClause).not.toContain('CASE o.status'); // la douane ne dépend pas d'un statut universel
    const present = ce.realCostPresentSql('o', 'e.t');
    expect(present).toContain('is_actual = TRUE');
    expect(present).toContain("<> 'monthly_recalc'");
    expect(present).not.toMatch(/amount_kmf\s*>/); // un réel à 0 = zéro confirmé
    const final = ce.finalMarginReadySql('o');
    expect(final).toContain("o.status::text = 'collected'");
    expect(final).toContain('NOT EXISTS');
  });
});
