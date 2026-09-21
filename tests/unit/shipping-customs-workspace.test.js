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

test('création douane délègue market_id au owner transactionnel sans mutation compensatoire', async () => {
  mockQuery.mockResolvedValueOnce({
    rows: [{ id: 'parcel-internal-1', reference: 'PCL-CM-001', status: 'in_transit' }],
  });
  mockCreateShipment.mockResolvedValue({
    shipment: {
      id: 'shipment-internal-1',
      reference: 'CUS-CM-001',
      status: 'pending',
      is_active: true,
      shipment_date: '2026-08-26',
    },
    allocations: [],
  });

  const result = await workspace.createCustomsShipment({
    reference: 'CUS-CM-001',
    shipment_date: '2026-08-26',
    cif_value_kmf: 100000,
    parcel_refs: ['PCL-CM-001'],
  }, MARKET, { id: 'admin-1', role: 'admin' });

  expect(mockCreateShipment).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ parcel_ids: ['parcel-internal-1'] }),
    'admin-1',
    { marketId: MARKET.id }
  );
  expect(mockDeleteShipment).not.toHaveBeenCalled();
  expect(mockQuery).toHaveBeenCalledTimes(1); // résolution colis uniquement, aucun UPDATE market post-COMMIT
  expect(result).toEqual({
    shipment: {
      reference: 'CUS-CM-001',
      status: 'pending',
      is_active: true,
      shipment_date: '2026-08-26',
    },
    allocations: [],
  });
});

describe('buildSignals — couche de pilotage additive, calcul pur sur données déjà récupérées', () => {
  const { buildSignals } = workspace._test;

  test('calcule les 5 signaux à partir de transit/shipments/candidates déjà fournis', () => {
    const now = Date.now();
    const transit = {
      ready: [{ reference: 'PCL-1' }],
      in_transit: [
        { reference: 'PCL-2', shipped_at: new Date(now - 20 * 86400000).toISOString() }, // 20j : en retard
        { reference: 'PCL-3', shipped_at: new Date(now - 5 * 86400000).toISOString() },  // 5j : pas en retard
      ],
    };
    const shipments = [
      {
        status: 'pending', is_active: true,
        freight_kmf: '28000', customs_paid_kmf: '45000',
        shipment_date: '2026-09-01', declared_at: null,
      },
      {
        status: 'declared', is_active: true,
        freight_kmf: '10000', customs_paid_kmf: '20000',
        shipment_date: '2026-08-01', declared_at: '2026-08-11T00:00:00Z', // 10 jours
      },
      {
        status: 'declared', is_active: false, // inactif : exclu des totaux
        freight_kmf: '999999', customs_paid_kmf: '999999',
        shipment_date: '2026-01-01', declared_at: '2026-01-02T00:00:00Z',
      },
    ];
    const candidates = [{ reference: 'PCL-4' }];

    const signals = buildSignals(transit, shipments, candidates);

    expect(signals.dossiers_a_traiter).toBe(1);
    expect(signals.transit_plus_14j).toBe(1);
    expect(signals.colis_sans_dossier).toBe(1);
    expect(signals.couts_logistiques_kmf).toBe(28000 + 45000 + 10000 + 20000); // le dossier inactif est exclu
    expect(signals.delai_moyen_jours).toBe(10);
    expect(signals.expeditions_en_cours).toBe(3);
    expect(signals.dossiers_douane_ouverts).toBe(2);
  });

  test('délai moyen reste null si aucun dossier déclaré — jamais 0 par défaut trompeur', () => {
    const signals = buildSignals({ ready: [], in_transit: [] }, [
      { status: 'pending', is_active: true, freight_kmf: '1000', customs_paid_kmf: '0', shipment_date: '2026-09-01', declared_at: null },
    ], []);
    expect(signals.delai_moyen_jours).toBeNull();
  });

  test('ne propose jamais de signal "documents expirants" ou "conformité" — donnée absente du schéma, jamais inventée', () => {
    const signals = buildSignals({ ready: [], in_transit: [] }, [], []);
    expect(signals).not.toHaveProperty('documents_expirants');
    expect(signals).not.toHaveProperty('conformite_documentaire');
    expect(Object.keys(signals)).toEqual([
      'dossiers_a_traiter', 'transit_plus_14j', 'colis_sans_dossier',
      'couts_logistiques_kmf', 'delai_moyen_jours', 'expeditions_en_cours', 'dossiers_douane_ouverts',
    ]);
  });
});
