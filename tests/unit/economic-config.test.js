'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn() }));

const db = require('../../db');
const cfg = require('../../services/economic-config');

beforeEach(() => jest.clearAllMocks());

const finance = {
  objectif_commandes_mois: 100,
  target_panier_moyen_kmf: 15000,
  hub_monthly_cost_aed: 7000,
  customs_rate_default_pct: 42,
  mix_rail_a: 60,
  mix_rail_b: 25,
  mix_rail_c: 10,
  mix_rail_d: 5,
  margin_rail_a: 45,
  margin_rail_b: 18,
  margin_rail_c: 35,
  margin_rail_d: 70,
};

describe('economic-config LOT 1A-4', () => {
  test('buildModelInputs reproduit exactement les valeurs CURRENT', () => {
    expect(cfg.buildModelInputs(finance)).toEqual({
      ordersPerMonth: 100,
      targetBasket: 15000,
      mixA: 60,
      mixB: 25,
      mixC: 10,
      mixD: 5,
      margA: 45,
      margB: 18,
      margC: 35,
      margD: 70,
    });
  });

  test('numeric utilise le fallback pour null/undefined/chaîne vide sans fabriquer zéro', () => {
    expect(cfg.numeric(null, 42)).toBe(42);
    expect(cfg.numeric(undefined, 42)).toBe(42);
    expect(cfg.numeric('', 42)).toBe(42);
    expect(cfg.numeric('0', 42)).toBe(0);
  });

  test('projectLegacyRows superpose finance_config sans modifier la valeur supposée forensic', () => {
    const rows = [{
      key: 'mix_rail_a', value_used: 59, value_supposed: 60,
      source_used: 'manual', is_computed: false,
    }];
    const [row] = cfg.projectLegacyRows(rows, finance, null);
    expect(row.value_used).toBe(60);
    expect(row.value_supposed).toBe(60);
    expect(row.source_used).toBe('finance_config');
    expect(row.runtime_source).toBe('finance_config.mix_rail_a');
    expect(row.legacy_read_only).toBe(true);
  });

  test('projectLegacyRows projette les computed sans écriture DB', () => {
    const rows = [{ key: 'net_profit_per_order', value_used: 1, is_computed: true }];
    const [row] = cfg.projectLegacyRows(rows, finance, { netProfit: 2345 });
    expect(row.value_used).toBe(2345);
    expect(row.source_used).toBe('computed_projection');
    expect(row.runtime_source).toBe('economic_engine_projection');
    expect(db.query).not.toHaveBeenCalled();
  });

  test('effectiveLegacyWriteValue respecte la valeur réellement utilisée par le vieux formulaire', () => {
    expect(cfg.effectiveLegacyWriteValue({
      value_supposed: 60,
      value_observed: 61,
      source_used: 'observed',
      value_used: 61,
    })).toBe(61);
  });

  test('effectiveLegacyWriteValue refuse null/vide au lieu de les convertir en zéro', () => {
    expect(cfg.effectiveLegacyWriteValue({ value_used: null })).toBeUndefined();
    expect(cfg.effectiveLegacyWriteValue({ value_used: '' })).toBeUndefined();
    expect(cfg.effectiveLegacyWriteValue({ value_used: '0' })).toBe(0);
  });

  test('writeThroughLegacyInput écrit uniquement finance_config pour une clé canonisée', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ ...finance, mix_rail_a: 61 }] });
    const result = await cfg.writeThroughLegacyInput('mix_rail_a', { value_used: 61 }, '00000000-0000-0000-0000-000000000001');

    expect(result).toMatchObject({ key: 'mix_rail_a', canonical_field: 'mix_rail_a', value: 61 });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toContain('UPDATE finance_config');
    expect(db.query.mock.calls[0][0]).not.toContain('economic_variables');
    expect(db.query.mock.calls[0][1]).toEqual([61, '00000000-0000-0000-0000-000000000001']);
  });

  test('writeThroughLegacyInput refuse une valeur vide sans aucune écriture', async () => {
    const result = await cfg.writeThroughLegacyInput('mix_rail_a', { value_used: null });
    expect(result).toMatchObject({ error: 'effective_value_required', status: 400, key: 'mix_rail_a' });
    expect(db.query).not.toHaveBeenCalled();
  });

  test('writeThroughLegacyInput refuse explicitement une clé legacy sans mapping runtime', async () => {
    const result = await cfg.writeThroughLegacyInput('marge_cible_pct', { value_used: 12 });
    expect(result).toMatchObject({
      error: 'economic_variable_editor_retired',
      status: 410,
      source_of_truth: 'finance_config',
    });
    expect(db.query).not.toHaveBeenCalled();
  });
});
