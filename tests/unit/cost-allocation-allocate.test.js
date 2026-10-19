'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
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

jest.mock('../../services/cost-allocation/canonical-margin-writer', () => ({ isEnabled: jest.fn().mockResolvedValue(false), refreshCanonicalMarginForOrders: jest.fn() }));
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

  it('refuse (422, rollback) un montant réel > 0 sans colis porteur — pas de perte silencieuse', async () => {
    const client = makeClient([
      { rows: [{ id: 'ship-001', customs_paid_kmf: '5000', freight_kmf: '2000', allocation_method: 'by_cif_value' }] },
      { rows: [] }, // customs_shipment_parcels → vide
    ]);
    db.pool.connect.mockResolvedValue(client);

    await expect(allocateShipmentRealCosts('ship-001')).rejects.toMatchObject({ code: 'COST_ALLOCATION_INCOMPLETE', status: 422 });
    expectTransactionRolledBack(client);
  });

  it('retourne no_parcels si montants inconnus ou 0 et aucun colis', async () => {
    const client = makeClient([
      { rows: [{ id: 'ship-001', customs_paid_kmf: '0', freight_kmf: null, allocation_method: 'by_cif_value' }] },
      { rows: [] },
    ]);
    db.pool.connect.mockResolvedValue(client);

    const result = await allocateShipmentRealCosts('ship-001');

    expect(result.reason).toBe('no_parcels');
    expect(result.allocations_count).toBe(0);
    expectTransactionCommitted(client);
  });

  it('frais typés: net 1000.01 sur 2 colis × 1 ligne → port_transitaire conservé au centime, source customs_shipment_fees', async () => {
    const shipment = { id: 'ship-fee', customs_paid_kmf: '0', freight_kmf: null, allocation_method: 'by_cif_value', fees_net_kmf: '1000.01' };
    const parcels  = [
      { parcel_id: 'p1', order_id: 'o1', parcel_cif_kmf: '5000', parcel_weight_kg: '1', customs_share_kmf: null },
      { parcel_id: 'p2', order_id: 'o2', parcel_cif_kmf: '5000', parcel_weight_kg: '1', customs_share_kmf: null },
    ];
    const item = (id) => ({ order_item_id: id, parcel_qty: '1', price_kmf: '5000', order_item_qty: '1', product_id: 'x', weight_kg: '1', cost_kmf: '1000' });
    const client = makeClient([
      { rows: [shipment] }, { rows: parcels }, { rows: [], rowCount: 0 },
      { rows: [item('oi1')] }, { rows: [], rowCount: 1 },
      { rows: [item('oi2')] }, { rows: [], rowCount: 1 },
    ]);
    db.pool.connect.mockResolvedValue(client);

    const result = await allocateShipmentRealCosts('ship-fee');

    const inserts = client.query.mock.calls.filter(c => String(c[0]).includes("'port_transitaire'"));
    const cents = inserts.reduce((sum, c) => sum + Math.round(Number(c[1][4]) * 100), 0);
    expect(inserts).toHaveLength(2);
    expect(cents).toBe(100001);
    expect(String(inserts[0][0])).toContain("'customs_shipment_fees'");
    expect(result.total_fees_kmf).toBe(1000.01);
    expectTransactionCommitted(client);
  });

  it('frais typés > 0 sans colis porteur → 422 et rollback (rien perdu en silence)', async () => {
    const client = makeClient([
      { rows: [{ id: 'ship-fee', customs_paid_kmf: '0', freight_kmf: null, allocation_method: 'by_cif_value', fees_net_kmf: '50' }] },
      { rows: [] },
    ]);
    db.pool.connect.mockResolvedValue(client);
    await expect(allocateShipmentRealCosts('ship-fee')).rejects.toMatchObject({ code: 'COST_ALLOCATION_INCOMPLETE', status: 422 });
    expectTransactionRolledBack(client);
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

  it('colis groupé (audit P0-PRE) : chaque allocation va à la commande de SA ligne, pas à la commande porteuse', async () => {
    const shipment = { id: 'ship-grp', customs_paid_kmf: '1000', freight_kmf: '0', allocation_method: 'by_cif_value' };
    const parcel   = { parcel_id: 'parcel-grp', order_id: 'order-A', parcel_cif_kmf: '2000', parcel_weight_kg: '2', customs_share_kmf: null, allocation_basis: null };
    const itemA    = { order_item_id: 'oi-A', order_id: 'order-A', parcel_qty: '1', price_kmf: '1000', order_item_qty: '1', product_id: 'p1', weight_kg: '1', cost_kmf: '1000' };
    const itemB    = { order_item_id: 'oi-B', order_id: 'order-B', parcel_qty: '1', price_kmf: '1000', order_item_qty: '1', product_id: 'p2', weight_kg: '1', cost_kmf: '1000' };
    const client = makeClient([
      { rows: [shipment] }, { rows: [parcel] }, { rows: [], rowCount: 0 },
      { rows: [itemA, itemB] }, { rows: [], rowCount: 1 }, { rows: [], rowCount: 1 },
    ]);
    db.pool.connect.mockResolvedValue(client);

    await allocateShipmentRealCosts('ship-grp');

    const inserts = client.query.mock.calls.filter(c => String(c[0]).includes('INSERT INTO order_item_real_cost_allocations'));
    const byItem = Object.fromEntries(inserts.map(c => [c[1][1], c[1][0]]));
    expect(byItem).toEqual({ 'oi-A': 'order-A', 'oi-B': 'order-B' });
    const total = inserts.reduce((sum, c) => sum + Number(c[1][4]), 0);
    expect(total).toBe(1000);
  });

  it('maritime + volume snapshoté → freight ventilé par volume (pas par poids)', async () => {
    // Doctrine : fret maritime acheté au m³, pas au kg. Colis A est lourd/compact
    // (peu de volume, beaucoup de poids) ; colis B est léger/volumineux.
    // Ventilation par poids donnerait A > B ; par volume, B > A.
    const shipment = {
      id: 'ship-001', customs_paid_kmf: '0', freight_kmf: '1000',
      allocation_method: 'by_cif_value', transport_mode: 'sea',
    };
    const parcelA = { parcel_id: 'parcel-A', order_id: 'order-A', parcel_cif_kmf: '1000', parcel_weight_kg: '18', parcel_volume_cm3: '10000', customs_share_kmf: null, allocation_basis: null };
    const parcelB = { parcel_id: 'parcel-B', order_id: 'order-B', parcel_cif_kmf: '1000', parcel_weight_kg: '2',  parcel_volume_cm3: '90000', customs_share_kmf: null, allocation_basis: null };
    const itemA = { order_item_id: 'oi-A', parcel_qty: '1', price_kmf: '1000', order_item_qty: '1', product_id: 'prod-A', weight_kg: '18', volume_cm3: '10000', cost_kmf: '1000' };
    const itemB = { order_item_id: 'oi-B', parcel_qty: '1', price_kmf: '1000', order_item_qty: '1', product_id: 'prod-B', weight_kg: '2',  volume_cm3: '90000', cost_kmf: '1000' };

    const client = makeClient([
      { rows: [shipment] },
      { rows: [parcelA, parcelB] },
      { rows: [], rowCount: 0 },
      { rows: [itemA] },
      { rows: [], rowCount: 1 },   // freight A (customsShare=0 → pas d'insert customs)
      { rows: [itemB] },
      { rows: [], rowCount: 1 },   // freight B
    ]);
    db.pool.connect.mockResolvedValue(client);

    const result = await allocateShipmentRealCosts('ship-001');

    expect(result.freight_allocation_method).toBe('by_volume');

    // Vérifie que l'INSERT freight de parcel-A (10% du volume total) porte bien
    // amount_kmf ≈ 100 et allocation_method='by_volume', pas 900 (poids: 18/20=90%).
    const freightInsertA = client.query.mock.calls.find(
      c => c[0].includes("'freight'") && c[1][2] === 'parcel-A'
    );
    expect(freightInsertA[1][4]).toBeCloseTo(100, 0);
    expect(freightInsertA[1][5]).toBe('by_volume');
    expectTransactionCommitted(client);
  });

  it('maritime sans volume snapshoté (legacy) → répartition égale, PAS par poids', async () => {
    // Doctrine : le poids sort de l'équation en maritime, même en fallback.
    // Colis A (18kg) et colis B (2kg) : si on utilisait le poids, A prendrait
    // 90% du fret. Ici, sans volume connu, la répartition doit être égale
    // (50/50), pas influencée par le poids.
    const shipment = {
      id: 'ship-001', customs_paid_kmf: '0', freight_kmf: '1000',
      allocation_method: 'by_cif_value', transport_mode: 'sea',
    };
    // parcel_volume_cm3 absent sur les deux (shipment lié avant migration 095)
    const parcelA = { parcel_id: 'parcel-A', order_id: 'order-A', parcel_cif_kmf: '1000', parcel_weight_kg: '18', customs_share_kmf: null, allocation_basis: null };
    const parcelB = { parcel_id: 'parcel-B', order_id: 'order-B', parcel_cif_kmf: '1000', parcel_weight_kg: '2',  customs_share_kmf: null, allocation_basis: null };
    const itemA = { order_item_id: 'oi-A', parcel_qty: '1', price_kmf: '1000', order_item_qty: '1', product_id: 'prod-A', weight_kg: '18', cost_kmf: '1000' };
    const itemB = { order_item_id: 'oi-B', parcel_qty: '1', price_kmf: '1000', order_item_qty: '1', product_id: 'prod-B', weight_kg: '2',  cost_kmf: '1000' };

    const client = makeClient([
      { rows: [shipment] },
      { rows: [parcelA, parcelB] },
      { rows: [], rowCount: 0 },
      { rows: [itemA] },
      { rows: [], rowCount: 1 },
      { rows: [itemB] },
      { rows: [], rowCount: 1 },
    ]);
    db.pool.connect.mockResolvedValue(client);

    const result = await allocateShipmentRealCosts('ship-001');

    expect(result.freight_allocation_method).toBe('estimated_fallback');

    const freightInsertA = client.query.mock.calls.find(
      c => c[0].includes("'freight'") && c[1][2] === 'parcel-A'
    );
    const freightInsertB = client.query.mock.calls.find(
      c => c[0].includes("'freight'") && c[1][2] === 'parcel-B'
    );
    // 50/50, pas 90/10 comme le donnerait le poids
    expect(freightInsertA[1][4]).toBeCloseTo(500, 0);
    expect(freightInsertB[1][4]).toBeCloseTo(500, 0);
    expect(freightInsertA[1][5]).toBe('estimated_fallback');
    expect(freightInsertA[1][6]).toBe('low');
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

  it('dryRun : retourne la proposition sans BEGIN ni écriture, hub non alloué, provision = hypothèse', async () => {
    const client = makeClient([
      { rows: [{ items_count: 10, orders_count: 4 }] },          // count items
      { rows: [{ taux_aed_kmf: '138', hub_monthly_cost_aed: '7000', provision_risque_pct: '0.01' }] }, // finance_config
      { rows: [{ revenue: '200000' }] },                          // revenue du mois
      { rows: [{ legacy_count: 0 }] },                            // lignes monthly_recalc héritées
    ]);
    db.pool.connect.mockResolvedValue(client);

    const result = await allocateMonthlyFixedCosts('2026-05', { dryRun: true });

    expect(result.dry_run).toBe(true);
    expect(result.proposal.items_count).toBe(10);
    expect(result.proposal.hub_structure).toEqual({ monthly_kmf: 7000 * 138, treatment: 'period_structure_not_allocated', validated: false });
    expect(result.proposal.risk_monthly_kmf).toBe(Math.round(200000 * 0.01));
    expect(result.proposal.risk_is_actual).toBe(false);
    expect(result.legacy_allocations_present).toBe(0);
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

  function monthlyClient(legacy, extra = []) {
    return makeClient([
      { rows: [{ items_count: 1, orders_count: 1 }] },
      { rows: [{ taux_aed_kmf: '138', hub_monthly_cost_aed: '7000', provision_risque_pct: '0.01' }] },
      { rows: [{ revenue: '100000' }] },
      { rows: [{ legacy_count: legacy }] },
      ...extra,
    ]);
  }
  const insertsOf = (client) => client.calls.filter(c => String(c.sql).includes('INSERT INTO order_item_real_cost_allocations'));

  it('nominal : 1 item → 1 allocation de provision (hypothèse), aucune allocation hub', async () => {
    const client = monthlyClient(0, [
      { rows: [], rowCount: 0 },  // DELETE de la seule source monthly_recalc_provision
      { rows: [{ order_item_id: 'oi-001', order_id: 'order-001' }] }, // SELECT items du mois
      { rows: [], rowCount: 1 },  // INSERT risk_provision
    ]);
    db.pool.connect.mockResolvedValue(client);

    const result = await allocateMonthlyFixedCosts('2026-05');

    expect(result.allocations_count).toBe(1);
    expect(result.dry_run).toBe(false);
    expect(result.hub_structure.treatment).toBe('period_structure_not_allocated');
    const inserts = insertsOf(client);
    expect(inserts).toHaveLength(1);
    const sql = String(inserts[0].sql);
    expect(sql).toContain("'risk_provision'");
    expect(sql).toContain("'monthly_recalc_provision'");
    expect(sql).toContain('FALSE');
    expect(sql).not.toContain("'hub'");
    expectTransactionCommitted(client);
  });

  it('idempotence : ne supprime que la source monthly_recalc_provision, jamais les anciennes lignes monthly_recalc', async () => {
    const client = monthlyClient(0, [
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
    ]);
    db.pool.connect.mockResolvedValue(client);
    await allocateMonthlyFixedCosts('2026-05');
    const deletes = client.calls.filter(c => String(c.sql).includes('DELETE FROM order_item_real_cost_allocations'));
    expect(deletes).toHaveLength(1);
    expect(String(deletes[0].sql)).toContain("'monthly_recalc_provision'");
    expect(String(deletes[0].sql)).not.toMatch(/source = 'monthly_recalc'\s/);
  });

  it('mois déjà alloué selon l’ancienne règle : aucune écriture, aucune suppression, signalé', async () => {
    const client = monthlyClient(42);
    db.pool.connect.mockResolvedValue(client);
    const result = await allocateMonthlyFixedCosts('2026-05');
    expect(result.skipped).toBe('legacy_allocations_present');
    expect(result.legacy_allocations_present).toBe(42);
    expect(result.allocations_count).toBe(0);
    expect(insertsOf(client)).toHaveLength(0);
    expect(client.calls.some(c => String(c.sql).includes('DELETE FROM'))).toBe(false);
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
