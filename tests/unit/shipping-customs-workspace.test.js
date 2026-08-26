'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
const mockProcessScan = jest.fn();
const mockCreateShipment = jest.fn();
const mockDeleteShipment = jest.fn();

jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));
jest.mock('../../services/scan-engine', () => ({ processScan: (...args) => mockProcessScan(...args) }));
jest.mock('../../services/customs-shipment-service', () => ({
  createShipment: (...args) => mockCreateShipment(...args),
  deleteShipment: (...args) => mockDeleteShipment(...args),
  updateShipment: jest.fn(),
  declareCustomsPayment: jest.fn(),
  deactivateShipment: jest.fn(),
  activateShipment: jest.fn(),
}));

const workspace = require('../../services/shipping-customs-workspace');

const MARKET = Object.freeze({ id: 'market-cm-id', code: 'CM', name: 'Cameroun', currency: 'XAF' });

beforeEach(() => {
  jest.clearAllMocks();
});

test('resolveParcelRefs impose marché + statuts expédition/transit côté serveur', async () => {
  mockQuery.mockResolvedValue({
    rows: [{ id: 'parcel-internal-1', reference: 'PCL-CM-001', status: 'shipped' }],
  });

  const rows = await workspace._test.resolveParcelRefs(['PCL-CM-001'], MARKET.id);

  expect(rows).toHaveLength(1);
  expect(mockQuery).toHaveBeenCalledWith(
    expect.stringContaining('p.status = ANY($3::text[])'),
    [['PCL-CM-001'], MARKET.id, ['shipped', 'in_transit']]
  );
});

test('un colis hors flux douane est rejeté avant customs-shipment-service', async () => {
  mockQuery.mockResolvedValue({ rows: [] });

  await expect(workspace.createCustomsShipment({
    reference: 'CUS-CM-001',
    shipment_date: '2026-08-26',
    cif_value_kmf: 100000,
    parcel_refs: ['PCL-CM-COLLECTED'],
  }, MARKET, { id: 'admin-1', role: 'admin' }))
    .rejects.toMatchObject({ code: 'customs_parcel_scope_mismatch', status: 404 });

  expect(mockCreateShipment).not.toHaveBeenCalled();
});

test('transit utilise l id interne résolu et délègue à scan-engine', async () => {
  mockQuery.mockResolvedValueOnce({
    rows: [{
      id: 'parcel-internal-1',
      reference: 'PCL-CM-001',
      status: 'shipped',
      relais_id: 'relay-1',
      order_id: 'order-1',
      market_id: MARKET.id,
      relais_market_id: MARKET.id,
    }],
  });
  mockProcessScan.mockResolvedValue({ success: true, parcel: { status: 'in_transit' } });

  const result = await workspace.confirmTransit(
    'PCL-CM-001',
    MARKET,
    { id: 'transit-1', role: 'agent_transitaire', full_name: 'Transit Test' },
    'Départ confirmé'
  );

  expect(mockQuery).toHaveBeenCalledWith(
    expect.stringContaining('p.reference = $1'),
    ['PCL-CM-001', MARKET.id, ['shipped']]
  );
  expect(mockProcessScan).toHaveBeenCalledWith(expect.objectContaining({
    parcel_id: 'parcel-internal-1',
    event_type: 'transit_confirmed',
    scanned_by: 'transit-1',
    actor_role: 'agent_transitaire',
    metadata: { source: 'canonical_shipping_customs_workspace', market_code: 'CM' },
  }));
  expect(result).toEqual({ parcel_ref: 'PCL-CM-001', status: 'in_transit', event_applied: true });
});

test('échec du tag market compense la création douane', async () => {
  mockQuery
    .mockResolvedValueOnce({
      rows: [{ id: 'parcel-internal-1', reference: 'PCL-CM-001', status: 'in_transit' }],
    })
    .mockResolvedValueOnce({ rows: [] });
  mockCreateShipment.mockResolvedValue({
    shipment: { id: 'shipment-internal-1', reference: 'CUS-CM-001' },
    allocations: [],
  });
  mockDeleteShipment.mockResolvedValue({ deleted: true });

  await expect(workspace.createCustomsShipment({
    reference: 'CUS-CM-001',
    shipment_date: '2026-08-26',
    cif_value_kmf: 100000,
    parcel_refs: ['PCL-CM-001'],
  }, MARKET, { id: 'admin-1', role: 'admin' }))
    .rejects.toThrow('customs_market_tag_failed');

  expect(mockDeleteShipment).toHaveBeenCalledWith(expect.anything(), 'shipment-internal-1');
});
