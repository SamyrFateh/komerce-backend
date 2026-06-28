'use strict';

/**
 * tests/unit/cost-allocation-allocate.test.js
 * Tests de caractérisation — fonctions allocate* de cost-allocation.js
 *
 * Couvre :
 *   allocateShipmentRealCosts   — shipment_not_found, no_parcels, nominal (customs+freight)
 *   allocateParcelRealCosts     — parcel_not_found, no_items, nominal (relay per_item)
 *   allocateMonthlyFixedCosts   — format invalide, dryRun, no_items, nominal
 *   allocateProductPurchaseCosts — nominal, aucune allocation si cost_kmf=0
 *
 * Ces fonctions utilisent db.pool.connect() → mock via makeClient + pool.connect.
 * Les fonctions pures et de lecture sont couvertes dans cost-allocation.test.js.
 */

const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } =
  require('../integration/test-harness/mock-db');

jest.mock('../../db', () => ({
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));
jest.mock('../../services/order-cost-snapshot', () => ({
  lockEstimatedCostsForOrder: jest.fn().mockResolvedValue({ locked: true }),
}));

const db = require('../../db');
const {
  allocateShipmentRealCosts,
  allocateParcelRealCosts,
  allocateMonthlyFixedCosts,
  allocateProductPurchaseCosts,
} = require('../../services/cost-allocation');

beforeEach(() => jest.clearAllMocks());

// ════════════════════════════════════════════════════════════════
// 1. allocateShipmentRealCosts
// ════════════════════════════════════════════════════════════════

describe('allocateShipmentRealCosts', () => {
  it('retourne shipment_not_found si shipment inconnu', async () => {
    const client = makeClient([
      { rows: [] }, // customs_shipments SELECT → vide
    ]);
    db.pool.connect.mockResolvedValue(client);

    const result = await allocateShipmentRealCosts('ship-001');

    expect(result.error).toBe('shipment_not_found');
    expect(result.allocations_count).toBe(0);
    expectTransactionRolledBack(client);
  });

  it('retourne no_parcels si shipment sans parcels', async () => {
    const client = makeClient([
      { rows: [{ id: 'ship-001', customs_paid_kmf: '5000', freight_kmf: '2000', allocation_method: 'by_cif_value' }] },
      { rows: [] }, // customs_shipment_parcels → vide
    ]);
    db.pool.connect.mockResolvedValue(client);

    const result = await allocateShipmentRealCosts('ship-001');

    expect(result.reason).toBe('no_parcels');
    expect(result.allocations_count).toBe(0);
    expectTransactionCommitted(client);
  });

  it('nominal : 1 parcel, 1 item → 2 allocations (customs + freight)', async () => {
    const shipment = { id: 'ship-001', customs_paid_kmf: '4000', freight_kmf: '1000', allocation_method: 'by_cif_value' };
    const parcel   = { parcel_id: 'parcel-001', order_id: 'order-001', parcel_cif_kmf: '8000', parcel_weight_kg: '2', customs_share_kmf: null, allocation_basis: null };
    const item     = { order_item_id: 'oi-001', parcel_qty: '2', price_kmf: '2000', order_item_qty: '2', product_id: 'prod-001', weight_kg: '1', cost_kmf: '1500' };

    const client = makeClient([
      { rows: [shipment] },         // 1. SELECT customs_shipments
      { rows: [parcel] },           // 2. SELECT customs_shipment_parcels JOIN parcels
      { rows: [], rowCount: 0 },    // 3. DELETE allocations existantes
      { rows: [item] },             // 4. SELECT parcel_items JOIN order_items pour parcel-001
      { rows: [], rowCount: 1 },    // 5. INSERT customs
      { rows: [], rowCount: 1 },    // 6. INSERT freight
    ]);
    db.pool.connect.mockResolvedValue(client);

    const result = await allocateShipmentRealCosts('ship-001');

    expect(result.shipment_id).toBe('ship-001');
    expect(result.allocations_count).toBe(2);
    expect(result.total_customs_kmf).toBe(4000);
    expect(result.total_freight_kmf).toBe(1000);
    expect(result.parcels_processed).toBe(1);
    expectTransactionCommitted(client);
  });
});

// ════════════════════════════════════════════════════════════════
// 2. allocateParcelRealCosts
// ════════════════════════════════════════════════════════════════

describe('allocateParcelRealCosts', () => {
  it('retourne parcel_not_found si parcel inconnu', async () => {
    const client = makeClient([{ rows: [] }]);
    db.pool.connect.mockResolvedValue(client);

    const result = await allocateParcelRealCosts('parcel-xxx');

    expect(result.error).toBe('parcel_not_found');
    expectTransactionRolledBack(client);
  });

  it('retourne no_items si parcel sans parcel_items', async () => {
    const client = makeClient([
      { rows: [{ id: 'parcel-001', order_id: 'order-001', status: 'collected' }] },
      { rows: [], rowCount: 0 },  // DELETE
      { rows: [] },               // parcel_items → vide
    ]);
    db.pool.connect.mockResolvedValue(client);

    const result = await allocateParcelRealCosts('parcel-001');

    expect(result.reason).toBe('no_items');
    expect(result.allocations_count).toBe(0);
    expectTransactionCommitted(client);
  });

  it('nominal : 2 items → 2 allocations relay (per_item)', async () => {
    const client = makeClient([
      { rows: [{ id: 'parcel-001', order_id: 'order-001', status: 'collected' }] },
      { rows: [], rowCount: 0 },  // DELETE local_distribution + relay
      { rows: [                   // parcel_items
        { order_item_id: 'oi-001', quantity: '1', weight_kg: '0.5' },
        { order_item_id: 'oi-002', quantity: '2', weight_kg: '1.0' },
      ]},
      { rows: [{ commission_relais_standard_kmf: '600' }] }, // finance_config
      { rows: [], rowCount: 1 },  // INSERT relay oi-001
      { rows: [], rowCount: 1 },  // INSERT relay oi-002
    ]);
    db.pool.connect.mockResolvedValue(client);

    const result = await allocateParcelRealCosts('parcel-001');

    expect(result.allocations_count).toBe(2);
    expect(result.items_count).toBe(2);
    expectTransactionCommitted(client);
  });
});

// ════════════════════════════════════════════════════════════════
// 3. allocateMonthlyFixedCosts
// ════════════════════════════════════════════════════════════════

describe('allocateMonthlyFixedCosts', () => {
  it('lève une erreur si yearMonth mal formaté', async () => {
    await expect(allocateMonthlyFixedCosts('2026/06')).rejects.toThrow('yearMonth must be YYYY-MM');
    await expect(allocateMonthlyFixedCosts('26-06')).rejects.toThrow('yearMonth must be YYYY-MM');
  });

  it('dryRun : retourne la proposition sans BEGIN ni écriture', async () => {
    const client = makeClient([
      { rows: [{ items_count: 10, orders_count: 4 }] },          // count items
      { rows: [{ taux_aed_kmf: '138', hub_monthly_cost_aed: '7000', provision_risque_pct: '0.01' }] }, // finance_config
      { rows: [{ revenue: '200000' }] },                          // revenue du mois
      // Pas de DELETE ni d'INSERT car dryRun
    ]);
    db.pool.connect.mockResolvedValue(client);

    const result = await allocateMonthlyFixedCosts('2026-05', { dryRun: true });

    expect(result.dry_run).toBe(true);
    expect(result.proposal.items_count).toBe(10);
    expect(result.proposal.hub_monthly_kmf).toBe(7000 * 138);
    expect(result.proposal.risk_monthly_kmf).toBe(Math.round(200000 * 0.01));
    // Pas de transaction en dryRun
    const sqls = client.calls.map(c => String(c.sql).trim());
    expect(sqls).not.toContain('BEGIN');
    expect(sqls).not.toContain('COMMIT');
  });

  it('retourne no_items_for_month si aucune commande payée', async () => {
    const client = makeClient([
      { rows: [{ items_count: 0, orders_count: 0 }] },
      // COMMIT géré par makeClient sans consommer de script
    ]);
    db.pool.connect.mockResolvedValue(client);

    const result = await allocateMonthlyFixedCosts('2026-05');

    expect(result.reason).toBe('no_items_for_month');
    expect(result.allocations_count).toBe(0);
    expectTransactionCommitted(client);
  });

  it('nominal : 1 item → 2 allocations (hub + risk)', async () => {
    const client = makeClient([
      { rows: [{ items_count: 1, orders_count: 1 }] },
      { rows: [{ taux_aed_kmf: '138', hub_monthly_cost_aed: '7000', provision_risque_pct: '0.01' }] },
      { rows: [{ revenue: '100000' }] },
      { rows: [], rowCount: 0 },  // DELETE allocations existantes
      { rows: [{ order_item_id: 'oi-001', order_id: 'order-001' }] }, // SELECT items du mois
      { rows: [], rowCount: 1 },  // INSERT hub
      { rows: [], rowCount: 1 },  // INSERT risk_provision
    ]);
    db.pool.connect.mockResolvedValue(client);

    const result = await allocateMonthlyFixedCosts('2026-05');

    expect(result.year_month).toBe('2026-05');
    expect(result.allocations_count).toBe(2);
    expect(result.items_count).toBe(1);
    expect(result.dry_run).toBe(false);
    expectTransactionCommitted(client);
  });
});

// ════════════════════════════════════════════════════════════════
// 4. allocateProductPurchaseCosts
// ════════════════════════════════════════════════════════════════

describe('allocateProductPurchaseCosts', () => {
  it('nominal : 2 items avec cost_kmf → 2 allocations product_purchase', async () => {
    const client = makeClient([
      { rows: [], rowCount: 0 },  // DELETE product_purchase existants
      { rows: [                   // SELECT order_items
        { order_item_id: 'oi-001', quantity: '2', cost_kmf: '3000' },
        { order_item_id: 'oi-002', quantity: '1', cost_kmf: '1500' },
      ]},
      { rows: [], rowCount: 1 },  // INSERT oi-001
      { rows: [], rowCount: 1 },  // INSERT oi-002
    ]);
    db.pool.connect.mockResolvedValue(client);

    const result = await allocateProductPurchaseCosts('order-001');

    expect(result.order_id).toBe('order-001');
    expect(result.allocations_count).toBe(2);
    expectTransactionCommitted(client);
  });

  it('aucune allocation si cost_kmf = 0 ou null pour tous les items', async () => {
    const client = makeClient([
      { rows: [], rowCount: 0 },  // DELETE
      { rows: [
        { order_item_id: 'oi-001', quantity: '1', cost_kmf: '0' },
        { order_item_id: 'oi-002', quantity: '2', cost_kmf: null },
      ]},
      // Pas d'INSERT car amounts = 0
    ]);
    db.pool.connect.mockResolvedValue(client);

    const result = await allocateProductPurchaseCosts('order-001');

    expect(result.allocations_count).toBe(0);
    expectTransactionCommitted(client);
  });
});
