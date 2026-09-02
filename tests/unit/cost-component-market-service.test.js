'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
const db = require('../../db');
const service = require('../../services/cost-component-market-service');

describe('cost-component-market-service', () => {
  beforeEach(() => jest.clearAllMocks());

  test('projection hérite du global sans override', () => {
    expect(service.effectiveRow({
      id: 'cc-1', key: 'freight', label: 'Fret', family: 'landed_relay', category: 'freight',
      base_default_value: '1000', unit: 'kmf_per_shipment', scope: 'global', source: 'default',
      confidence: 'medium', base_is_active: true, is_exceptional: false, override_id: null,
    })).toMatchObject({ key: 'freight', default_value: 1000, is_active: true, inherited: true });
  });

  test('projection applique valeur et activation du marché', () => {
    expect(service.effectiveRow({
      id: 'cc-1', key: 'freight', label: 'Fret', family: 'landed_relay', category: 'freight',
      base_default_value: '1000', unit: 'kmf_per_shipment', scope: 'global', source: 'default',
      confidence: 'medium', base_is_active: true, is_exceptional: false,
      override_id: 'ov-1', override_default_value: '1250', override_is_active: false, override_notes: 'CM',
    })).toMatchObject({ key: 'freight', default_value: 1250, is_active: false, base_default_value: 1000, inherited: false });
  });

  test('listEffectiveComponents borne la jointure par market_id', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await service.listEffectiveComponents('market-cm');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('o.market_id = $1'), ['market-cm']);
  });
});
