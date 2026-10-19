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

  test('l’absence de mécanisme de collecte reste un manque fonctionnel, jamais « non applicable »', () => {
    const d = ce.describeOrderCosts({ ...IMPORTED, status: 'preparation', missing_cost_types: ['packaging', 'product_purchase'] });
    const packaging = d.missing.find(m => m.type === 'packaging');
    expect(packaging).toMatchObject({ state: 'unknown', collection_mechanism: false });
    expect(packaging.note).toMatch(/collecte absent/);
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

describe('L2 — applicabilité du Hub variable déduite du parcours', () => {
  const base = { status: 'preparation', payment_mode: 'cash_relais', relay_beneficiary: true };

  test('ligne IMPORT ou opération Hub : hub variable attendu en préparation', () => {
    expect(ce.expectedTypes({ ...base, hub_route: true })).toContain('hub');
  });

  test('toutes lignes LOCAL_STOCK sans opération Hub : non applicable avec motif', () => {
    expect(ce.expectedTypes({ ...base, hub_route: false })).not.toContain('hub');
    const d = ce.describeOrderCosts({ ...base, hub_route: false, missing_cost_types: [] });
    const na = d.not_applicable.find((x) => x.type === 'hub');
    expect(na.motif).toMatch(/stock local/);
    expect(na.motif).toMatch(/charge de période/);
  });

  test('parcours inconnu (drapeau absent) : jamais non applicable', () => {
    expect(ce.expectedTypes({ ...base })).toContain('hub');
    expect(ce.expectedTypes({ ...base, hub_route: null })).toContain('hub');
  });

  test('provenance de ligne inconnue : manquant signalé comme applicabilité présumée', () => {
    const d = ce.describeOrderCosts({ ...base, hub_route: true, hub_route_unknown: true, missing_cost_types: ['hub'] });
    expect(d.missing[0]).toMatchObject({ type: 'hub', applicability: 'presumed' });
    expect(d.missing[0].applicability_note).toMatch(/donnée manquante/);
  });

  test('SQL : LOCAL_STOCK exclut, NULL ne prouve rien, opération Hub rend applicable', () => {
    const sql = ce.expectedTypesSql('o');
    expect(sql).toContain("fulfillment_source IS DISTINCT FROM 'LOCAL_STOCK'");
    expect(sql).toContain('hub_preparation_at IS NOT NULL');
    expect(ce.contextColumnsSql('o')).toContain('ctx_hub_route_unknown');
  });
});
