'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn() }));

const { analyze } = require('../../tools/economic-variables/preflight-1a4');

function row(key, value) {
  return { key, value_used: value, value_supposed: value, is_computed: false };
}

const migratedRows = [
  row('customs_rate_default_pct', 42),
  row('mix_rail_a', 60), row('mix_rail_b', 25), row('mix_rail_c', 10), row('mix_rail_d', 5),
  row('margin_rail_a', 45), row('margin_rail_b', 18), row('margin_rail_c', 35), row('margin_rail_d', 70),
];

describe('LOT 1A-4 — preflight economic_variables', () => {
  test('accepte les correspondances existantes strictement identiques', () => {
    const result = analyze(
      { objectif_commandes_mois: 100, target_panier_moyen_kmf: 15000, hub_monthly_cost_aed: 3500 },
      [row('orders_per_month', 100), row('target_basket_avg', 15000), row('hub_monthly_cost_aed', 3500), ...migratedRows]
    );

    expect(result.blockers).toEqual([]);
    expect(result.migrate.map((x) => [x.legacy, x.value_to_copy])).toEqual([
      ['customs_rate_default_pct', 42],
      ['mix_rail_a', 60], ['mix_rail_b', 25], ['mix_rail_c', 10], ['mix_rail_d', 5],
      ['margin_rail_a', 45], ['margin_rail_b', 18], ['margin_rail_c', 35], ['margin_rail_d', 70],
    ]);
  });

  test('refuse une dérive finance_config existante au lieu de la masquer', () => {
    const result = analyze(
      { objectif_commandes_mois: 100, target_panier_moyen_kmf: 15000, hub_monthly_cost_aed: 3500 },
      [row('orders_per_month', 100), row('target_basket_avg', 15000), row('hub_monthly_cost_aed', 7000), ...migratedRows]
    );

    expect(result.blockers).toEqual([
      expect.objectContaining({ legacy: 'hub_monthly_cost_aed', legacy_value: 7000, canonical_value: 3500, equal: false }),
    ]);
  });

  test('capture un legacy absent comme fallback CURRENT explicite', () => {
    const result = analyze(
      { objectif_commandes_mois: 100, target_panier_moyen_kmf: 15000, hub_monthly_cost_aed: 7000 },
      [row('orders_per_month', 100), row('target_basket_avg', 15000), row('hub_monthly_cost_aed', 7000)]
    );

    expect(result.missing_legacy_to_migrate).toHaveLength(9);
    expect(result.migrate.find((x) => x.legacy === 'customs_rate_default_pct')).toMatchObject({
      value_to_copy: 42,
      source: 'CURRENT_fallback',
    });
  });

  test('value_used gagne sur value_supposed exactement comme l’ancien moteur', () => {
    const rows = [
      { key: 'orders_per_month', value_used: 100, value_supposed: 90 },
      { key: 'target_basket_avg', value_used: 15000, value_supposed: 12000 },
      { key: 'hub_monthly_cost_aed', value_used: 3500, value_supposed: 7000 },
      { key: 'mix_rail_a', value_used: 61, value_supposed: 60 },
      ...migratedRows.filter((r) => r.key !== 'mix_rail_a'),
    ];
    const result = analyze(
      { objectif_commandes_mois: 100, target_panier_moyen_kmf: 15000, hub_monthly_cost_aed: 3500 },
      rows
    );
    expect(result.blockers).toEqual([]);
    expect(result.migrate.find((x) => x.legacy === 'mix_rail_a').value_to_copy).toBe(61);
  });
});
