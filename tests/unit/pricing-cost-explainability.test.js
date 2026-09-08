'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const explainability = require('../../services/pricing-cost-explainability');

describe('pricing-cost-explainability', () => {
  test('charge variable configurée reste une hypothèse et impacte la contribution', () => {
    const result = explainability.explainComponent({
      key: 'freight',
      family: 'landed_relay',
      category: 'freight',
      economic_nature: 'variable',
      allocation_perimeter: 'direct',
      source: 'default',
      confidence: 'medium',
      allocation_method: 'by_weight',
    });

    expect(result.layer).toBe('VARIABLE_DIRECT');
    expect(result.economic_nature).toBe('variable');
    expect(result.allocation_perimeter).toBe('direct');
    expect(result.evidence.truth_state).toBe('configured');
    expect(result.evidence.is_observed_real).toBe(false);
    expect(result.evidence.needs_reconciliation).toBe(true);
    expect(result.impact.affects_price_floor).toBe(true);
    expect(result.impact.affects_contribution).toBe(true);
    expect(result.movement.allocation_method).toBe('by_weight');
  });

  test('source real est la seule source projetée comme réel constaté', () => {
    const real = explainability.explainComponent({
      family: 'landed_relay', category: 'packaging', source: 'real', confidence: 'high',
    });
    const supplier = explainability.explainComponent({
      family: 'landed_relay', category: 'product_purchase', source: 'supplier', confidence: 'high',
    });

    expect(real.evidence.truth_state).toBe('observed_real');
    expect(real.evidence.is_observed_real).toBe(true);
    expect(supplier.evidence.truth_state).toBe('external_reference');
    expect(supplier.evidence.is_observed_real).toBe(false);
  });

  test('override marché explique base, marché et note humaine', () => {
    const result = explainability.explainComponent({
      family: 'landed_relay',
      category: 'freight',
      source: 'market_override',
      base_source: 'supplier',
      confidence: 'medium',
      inherited: false,
      override_notes: 'Tarif maritime CM négocié pour septembre',
      override_updated_at: '2026-09-06T10:00:00.000Z',
    }, { marketCode: 'CM' });

    expect(result.origin).toMatchObject({
      source: 'market_override',
      source_label: 'Override CM sur base globale',
      base_source: 'supplier',
      inherited: false,
      market_code: 'CM',
    });
    expect(result.hypothesis).toEqual({
      text: 'Tarif maritime CM négocié pour septembre',
      is_explicit_human_note: true,
    });
  });

  test('charge fixe directe couvre la période sans devenir dette SKU', () => {
    const result = explainability.explainComponent({
      family: 'business',
      category: 'fixed_overhead',
      economic_nature: 'fixed',
      allocation_perimeter: 'direct',
      source: 'default',
      confidence: 'medium',
    });

    expect(result.layer).toBe('FIXED_DIRECT');
    expect(result.impact.affects_price_floor).toBe(false);
    expect(result.impact.affects_contribution).toBe(false);
    expect(result.impact.affects_period_coverage).toBe(true);
    expect(result.impact.path).toContain('charges de période à couvrir');
  });

  test('charge fixe mutualisée reste distincte de sa nature économique', () => {
    const result = explainability.explainComponent({
      family: 'business', category: 'fixed_overhead', economic_nature: 'fixed',
      allocation_perimeter: 'mutualized', source: 'default', confidence: 'medium',
    });
    expect(result.layer).toBe('FIXED_MUTUALIZED');
    expect(result.economic_nature).toBe('fixed');
    expect(result.allocation_perimeter).toBe('mutualized');
    expect(result.impact.path).toContain('Quote-part fixe mutualisée');
  });

  test('risk provision reste une hypothèse de période, pas une preuve cash commande', () => {
    const result = explainability.explainComponent({
      family: 'business',
      category: 'risk_provision',
      economic_nature: 'variable',
      allocation_perimeter: 'direct',
      source: 'default',
      confidence: 'medium',
    });

    expect(result.layer).toBe('VARIABLE_DIRECT');
    expect(result.hypothesis.text).toMatch(/statistique/);
    expect(result.hypothesis.text).toMatch(/cash/);
    expect(result.evidence.is_observed_real).toBe(false);
  });

  test('missing est fail-closed et jamais transformé en zéro', () => {
    const result = explainability.explainComponent({
      family: 'landed_relay', category: 'local_distribution', source: 'missing', confidence: 'low',
    });

    expect(result.evidence.truth_state).toBe('missing');
    expect(result.evidence.needs_reconciliation).toBe(true);
    expect(result.evidence.caution).toMatch(/ni l’inventer ni la transformer en zéro/);
  });
});