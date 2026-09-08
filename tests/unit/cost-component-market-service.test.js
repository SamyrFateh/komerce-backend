'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
const db = require('../../db');
const service = require('../../services/cost-component-market-service');

describe('cost-component-market-service', () => {
  beforeEach(() => jest.clearAllMocks());

  test('projection hérite du global sans override et qualifie la charge', () => {
    expect(service.effectiveRow({
      id: 'cc-1', key: 'freight', label: 'Fret', family: 'landed_relay', category: 'freight',
      economic_nature: 'variable', allocation_perimeter: 'direct',
      base_default_value: '1000', unit: 'kmf_per_shipment', scope: 'global', source: 'default',
      confidence: 'medium', base_is_active: true, is_exceptional: false, override_id: null,
    })).toMatchObject({
      key: 'freight', default_value: 1000, is_active: true, inherited: true,
      economic_nature: 'variable', allocation_perimeter: 'direct',
    });
  });

  test('projection garde un fallback de compatibilité pour les lignes non migrées', () => {
    expect(service.effectiveRow({
      id: 'cc-2', key: 'fixed', label: 'Structure', family: 'business', category: 'fixed_overhead',
      base_default_value: '5000', unit: 'kmf', scope: 'global', source: 'default',
      confidence: 'medium', base_is_active: true, is_exceptional: false, override_id: null,
    })).toMatchObject({ economic_nature: 'fixed', allocation_perimeter: 'direct' });
  });

  test('projection applique valeur et activation du marché', () => {
    expect(service.effectiveRow({
      id: 'cc-1', key: 'freight', label: 'Fret', family: 'landed_relay', category: 'freight',
      economic_nature: 'variable', allocation_perimeter: 'mutualized',
      base_default_value: '1000', unit: 'kmf_per_shipment', scope: 'global', source: 'default',
      confidence: 'medium', base_is_active: true, is_exceptional: false,
      override_id: 'ov-1', override_default_value: '1250', override_is_active: false, override_notes: 'CM',
    })).toMatchObject({
      key: 'freight', default_value: 1250, is_active: false, base_default_value: 1000, inherited: false,
      economic_nature: 'variable', allocation_perimeter: 'mutualized',
    });
  });

  test('listEffectiveComponents borne la jointure par market_id et sélectionne la classification économique', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await service.listEffectiveComponents('market-cm');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('o.market_id = $1'), ['market-cm']);
    expect(db.query.mock.calls[0][0]).toContain('cc.economic_nature');
    expect(db.query.mock.calls[0][0]).toContain('cc.allocation_perimeter');
  });
});