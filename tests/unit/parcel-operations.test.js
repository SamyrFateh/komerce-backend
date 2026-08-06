'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/parcel-operations.test.js
 * Tests unitaires du lot R4 — parcel-operations.js
 *
 * Couvre :
 *   markAvailability    — 4 cas
 *   partialShip         — 5 cas
 *   updateParcelStatus  — 5 cas
 *   cancelBackorder     — 4 cas
 */

const {
  makeClient,
  expectTransactionCommitted,
  expectTransactionRolledBack,
} = require('../integration/test-harness/mock-db');

// ── Mocks ────────────────────────────────────────────────────────────────────
jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock('../../services/notification-service', () => ({
  notifyText:        jest.fn().mockResolvedValue(undefined),
  notifyParcelScan:  jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../utils/rules', () => ({
  getRule:       jest.fn().mockResolvedValue(true),
  getRuleNumber: jest.fn().mockImplementation((key, def) => Promise.resolve(def)),
}));
jest.mock('../../utils/reference', () => ({
  generateParcelRef: jest.fn().mockResolvedValue('COLIS-AUTO-001'),
}));
jest.mock('../../services/refund-service', () => ({
  processRefundWithFallback: jest.fn().mockResolvedValue({ method: 'store_credit', storeCreditId: 'sc-01' }),
}));
jest.mock('../../services/order-status-machine', () => ({
  transitionOrderStatus: jest.fn().mockResolvedValue({ success: true }),
  // Sprint A — délègue réellement à client.query pour ne pas décaler les
  // scripts de mock positionnels (voir tests-harness/mock-db.js) : le nombre
  // d'appels client.query doit rester identique à avant l'extraction.
  appendOrderHistoryNote: jest.fn((client, orderId, status, note, changedBy) =>
    client.query(
      'INSERT INTO order_status_history (order_id, status, note, changed_by) VALUES ($1, $2, $3, $4)',
      [orderId, status, note, changedBy],
    )
  ),
}));

const pool = require('../../db');
const { markAvailability, partialShip, updateParcelStatus, cancelBackorder } =
  require('../../services/parcel-operations');

// ── Fixtures ─────────────────────────────────────────────────────────────────

const USER_ADMIN   = { id: 'user-admin', role: 'admin' };
const USER_CLIENT  = { id: 'user-client', role: 'client' };
const ORDER_ID     = 'order-001';
const PARCEL_ID    = 'parcel-001';

function makeOrder(overrides = {}) {
  return {
    id: ORDER_ID,
    reference: 'CMD-001',
    status: 'ordered',
    user_id: USER_CLIENT.id,
    user_phone: '+269600000001',
    ordered_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(), // 8 jours
    relais_id: 'relais-001',
    payment_status: 'paid',
    total_kmf: 10000,
    total_eur: 20,
    ...overrides,
  };
}

function makeParcel(overrides = {}) {
  return {
    id: PARCEL_ID,
    order_id: ORDER_ID,
    type: 'backorder',
    status: 'draft',
    reference: 'COLIS-BO-001',
    parent_reference: 'CMD-001',
    parent_id: ORDER_ID,
    user_id: USER_CLIENT.id,
    user_phone: '+269600000001',
    relais_id: 'relais-001',
    relais_name: 'Relais Moroni',
    parent_status: 'ordered',
    ...overrides,
  };
}

function makeOrderItem(overrides = {}) {
  return {
    id:           'oi-001',
    order_id:     ORDER_ID,
    product_id:   'prod-001',
    product_name: 'Robe Kanga',
    quantity:     3,
    price_kmf:    5000,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// markAvailability
// ─────────────────────────────────────────────────────────────────────────────

describe('markAvailability', () => {
  test('nominal — met à jour 2 items et insère historique', async () => {
    const client = makeClient([
      { rows: [makeOrder()] },                                     // SELECT order
      { rows: [{ id: 'oi-001' }, { id: 'oi-002' }] },             // check items appartient commande
      { rows: [{ id: 'oi-001', availability_status: 'available', estimated_available_at: null, backorder_reason: null }] }, // UPDATE oi-001
      { rows: [{ id: 'oi-002', availability_status: 'backorder', estimated_available_at: null, backorder_reason: 'stock' }] }, // UPDATE oi-002
      { rows: [], rowCount: 1 },                                   // INSERT history
    ]);
    pool.getClient.mockResolvedValue(client);

    const items = [
      { order_item_id: 'oi-001', status: 'available' },
      { order_item_id: 'oi-002', status: 'backorder', reason: 'stock' },
    ];
    const result = await markAvailability(ORDER_ID, items, USER_ADMIN);

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.items).toHaveLength(2);
    expectTransactionCommitted(client);
  });

  test('404 — commande introuvable', async () => {
    const client = makeClient([
      { rows: [] }, // SELECT order → vide
    ]);
    pool.getClient.mockResolvedValue(client);

    const result = await markAvailability('ordre-inexistant', [], USER_ADMIN);
    expect(result.status).toBe(404);
    expectTransactionRolledBack(client);
  });

  test('400 — items n\'appartiennent pas à la commande', async () => {
    const client = makeClient([
      { rows: [makeOrder()] },
      { rows: [{ id: 'oi-001' }] }, // seulement 1 trouvé vs 2 attendus
    ]);
    pool.getClient.mockResolvedValue(client);

    const items = [
      { order_item_id: 'oi-001', status: 'available' },
      { order_item_id: 'oi-PIRATE', status: 'available' },
    ];
    const result = await markAvailability(ORDER_ID, items, USER_ADMIN);
    expect(result.status).toBe(400);
    expect(result.body.expected).toBe(2);
    expect(result.body.found).toBe(1);
    expectTransactionRolledBack(client);
  });

  test('rollback sur erreur DB inattendue', async () => {
    const client = makeClient([
      { rows: [makeOrder()] },
      { rows: [{ id: 'oi-001' }] },
      { error: new Error('DB crash') }, // UPDATE explose
    ]);
    pool.getClient.mockResolvedValue(client);

    await expect(
      markAvailability(ORDER_ID, [{ order_item_id: 'oi-001', status: 'available' }], USER_ADMIN)
    ).rejects.toThrow('DB crash');
    expectTransactionRolledBack(client);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// partialShip
// ─────────────────────────────────────────────────────────────────────────────

describe('partialShip', () => {
  // Script DB pour un envoi partiel nominal (2 items dont 1 seul expédié)
  function makePartialShipScript({ order, allItems, withBackorder = true } = {}) {
    const o  = order || makeOrder();
    const ai = allItems || [
      makeOrderItem({ id: 'oi-001', quantity: 2, product_id: 'prod-001' }),
      makeOrderItem({ id: 'oi-002', quantity: 3, product_id: 'prod-002', product_name: 'Sac B', price_kmf: 3000 }),
    ];

    return [
      { rows: [o] },          // SELECT order + user_phone
      { rows: ai },           // SELECT order_items FOR UPDATE
      // INSERT colis partial
      { rows: [], rowCount: 1 },
      // INSERT parcel_item oi-001
      { rows: [], rowCount: 1 },
      // UPDATE order_items SET availability = available (oi-001)
      { rows: [], rowCount: 1 },
      ...(withBackorder ? [
        // INSERT colis backorder
        { rows: [], rowCount: 1 },
        // INSERT parcel_item oi-002 (backorder)
        { rows: [], rowCount: 1 },
        // UPDATE order_items SET availability = backorder (oi-002)
        { rows: [], rowCount: 1 },
      ] : []),
      // INSERT order_status_history
      { rows: [], rowCount: 1 },
    ];
  }

  test('nominal — 1 article expédié, 1 en backorder', async () => {
    const client = makeClient(makePartialShipScript());
    pool.getClient.mockResolvedValue(client);

    const body = {
      available_items: [{ order_item_id: 'oi-001', quantity: 2 }],
      notes: 'Premier envoi',
    };
    const result = await partialShip(ORDER_ID, body, USER_ADMIN);

    expect(result.status).toBe(201);
    expect(result.body.success).toBe(true);
    expect(result.body.partial_ship.type).toBe('partial');
    expect(result.body.partial_ship.status).toBe('preparation');
    expect(result.body.backorder).not.toBeNull();
    expect(result.body.summary.shipped_qty).toBe(2);
    expectTransactionCommitted(client);
  });

  test('422 — commande en statut shipped (guard validateParcelCreate)', async () => {
    const order = makeOrder({ status: 'shipped' });
    const client = makeClient([
      { rows: [order] }, // SELECT order
      // les règles (getRuleNumber) sont mockées avant la query
    ]);
    pool.getClient.mockResolvedValue(client);

    const result = await partialShip(ORDER_ID, { available_items: [{ order_item_id: 'oi-001', quantity: 1 }] }, USER_ADMIN);
    expect(result.status).toBe(422);
    expect(result.body.current_status).toBe('shipped');
    expectTransactionRolledBack(client);
  });

  test('422 — délai insuffisant (commande trop récente — override getRuleNumber)', async () => {
    const { getRuleNumber } = require('../../utils/rules');
    getRuleNumber.mockImplementation((key) => {
      if (key === 'PARTIAL_SHIP_DELAY_THRESHOLD_DAYS') return Promise.resolve(30); // seuil 30j
      return Promise.resolve(30);
    });

    const recentOrder = makeOrder({
      ordered_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 jours
    });
    const client = makeClient([{ rows: [recentOrder] }]);
    pool.getClient.mockResolvedValue(client);

    const result = await partialShip(ORDER_ID, { available_items: [{ order_item_id: 'oi-001', quantity: 1 }] }, USER_ADMIN);
    expect(result.status).toBe(422);
    expect(result.body.threshold_days).toBe(30);

    // Restaurer le mock par défaut
    getRuleNumber.mockImplementation((key, def) => Promise.resolve(def));
    expectTransactionRolledBack(client);
  });

  test('400 — validateSplitItems : article inexistant dans la commande', async () => {
    const client = makeClient([
      { rows: [makeOrder()] },
      { rows: [makeOrderItem({ id: 'oi-001' })] }, // seul oi-001 existe
    ]);
    pool.getClient.mockResolvedValue(client);

    const result = await partialShip(ORDER_ID, {
      available_items: [{ order_item_id: 'oi-FANTOME', quantity: 1 }],
    }, USER_ADMIN);
    expect(result.status).toBe(400);
    expectTransactionRolledBack(client);
  });

  test('201 — tous les articles expédiés (pas de backorder)', async () => {
    const allItems = [makeOrderItem({ id: 'oi-001', quantity: 2, product_id: 'prod-001' })];
    const client = makeClient(makePartialShipScript({ allItems, withBackorder: false }));
    pool.getClient.mockResolvedValue(client);

    const result = await partialShip(ORDER_ID, {
      available_items: [{ order_item_id: 'oi-001', quantity: 2 }],
    }, USER_ADMIN);

    expect(result.status).toBe(201);
    expect(result.body.backorder).toBeNull();
    expectTransactionCommitted(client);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateParcelStatus
// ─────────────────────────────────────────────────────────────────────────────

describe('updateParcelStatus', () => {
  const { transitionOrderStatus } = require('../../services/order-status-machine');

  function makeStatusScript(parcel, newStatus, allParcels = null) {
    const script = [
      { rows: [parcel] },                         // SELECT parcel + order (updateParcelStatus)
      { rows: [{ status: parcel.status }] },       // SELECT status FROM parcels (transitionParcelStatus)
      { rows: [], rowCount: 1 },                   // UPDATE parcels SET status (transitionParcelStatus)
      { rows: [], rowCount: 1 },                   // INSERT order_status_history (appendOrderHistoryNote)
    ];
    if (newStatus === 'collected') {
      script.push({ rows: allParcels || [{ id: parcel.id, status: 'collected' }] });
    }
    return script;
  }

  test('nominal — draft → preparation', async () => {
    const parcel = makeParcel({ status: 'draft' });
    const client = makeClient(makeStatusScript(parcel, 'preparation'));
    pool.getClient.mockResolvedValue(client);

    const result = await updateParcelStatus(PARCEL_ID, { status: 'preparation' }, USER_ADMIN);
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('preparation');
    expectTransactionCommitted(client);
  });

  test('404 — colis introuvable', async () => {
    const client = makeClient([{ rows: [] }]);
    pool.getClient.mockResolvedValue(client);

    const result = await updateParcelStatus('colis-fantome', { status: 'preparation' }, USER_ADMIN);
    expect(result.status).toBe(404);
    expectTransactionRolledBack(client);
  });

  test('422 — transition illégale collected → preparation', async () => {
    const parcel = makeParcel({ status: 'collected' });
    const client = makeClient([
      { rows: [parcel] },
      { rows: [{ status: 'collected' }] },
    ]);
    pool.getClient.mockResolvedValue(client);

    const result = await updateParcelStatus(PARCEL_ID, { status: 'preparation' }, USER_ADMIN);
    expect(result.status).toBe(422);
    expect(result.body.current_status).toBe('collected');
    expectTransactionRolledBack(client);
  });

  test('collected + tous colis terminés → transitionOrderStatus appelé', async () => {
    transitionOrderStatus.mockClear();
    const parcel = makeParcel({ status: 'available' });
    const allParcels = [
      { id: PARCEL_ID,   status: 'collected' },
      { id: 'parcel-2',  status: 'cancelled' },
    ];
    const client = makeClient(makeStatusScript(parcel, 'collected', allParcels));
    pool.getClient.mockResolvedValue(client);

    const result = await updateParcelStatus(PARCEL_ID, { status: 'collected' }, USER_ADMIN);
    expect(result.status).toBe(200);
    expect(transitionOrderStatus).toHaveBeenCalledWith(
      expect.objectContaining({ newStatus: 'collected', orderId: ORDER_ID })
    );
    expectTransactionCommitted(client);
  });

  test('collected + d\'autres colis encore actifs → pas de transition commande', async () => {
    transitionOrderStatus.mockClear();
    const parcel = makeParcel({ status: 'available' });
    const allParcels = [
      { id: PARCEL_ID,  status: 'collected' },
      { id: 'parcel-2', status: 'in_transit' }, // encore actif
    ];
    const client = makeClient(makeStatusScript(parcel, 'collected', allParcels));
    pool.getClient.mockResolvedValue(client);

    await updateParcelStatus(PARCEL_ID, { status: 'collected' }, USER_ADMIN);
    expect(transitionOrderStatus).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cancelBackorder
// ─────────────────────────────────────────────────────────────────────────────

describe('cancelBackorder', () => {
  function makeCancelScript(order, parcel, items = []) {
    const boItems = items.length > 0 ? items : [
      { id: 'pi-001', product_id: 'prod-001', product_name: 'Robe', quantity: 2, price_kmf: 5000, order_item_id: 'oi-001' },
    ];
    return [
      { rows: [order] },          // SELECT order
      { rows: [parcel] },         // SELECT parcel backorder
      { rows: boItems },          // SELECT parcel_items
      { rows: [], rowCount: 1 },  // UPDATE parcels cancelled
      { rows: [], rowCount: 1 },  // UPDATE products stock (1 item)
      { rows: [], rowCount: 1 },  // INSERT order_status_history
    ];
  }

  test('nominal — backorder draft annulé, stock restauré, crédit boutique', async () => {
    const order  = makeOrder();
    const parcel = makeParcel();
    const client = makeClient(makeCancelScript(order, parcel));
    pool.getClient.mockResolvedValue(client);

    const result = await cancelBackorder(ORDER_ID, { parcel_id: PARCEL_ID, reason: 'Client change d\'avis' }, USER_ADMIN);
    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.cancelled_items).toHaveLength(1);
    expect(result.body.refund).not.toBeNull();
    expect(result.body.refund.method).toBe('store_credit');
    expectTransactionCommitted(client);
  });

  test('404 — commande introuvable', async () => {
    const client = makeClient([{ rows: [] }]);
    pool.getClient.mockResolvedValue(client);

    const result = await cancelBackorder('ordre-fantome', { parcel_id: PARCEL_ID }, USER_ADMIN);
    expect(result.status).toBe(404);
    expectTransactionRolledBack(client);
  });

  test('403 — client ne peut pas annuler le backorder d\'un autre', async () => {
    const order  = makeOrder({ user_id: 'autre-user' });
    const client = makeClient([{ rows: [order] }]);
    pool.getClient.mockResolvedValue(client);

    const intrus = { id: USER_CLIENT.id, role: 'client' };
    const result = await cancelBackorder(ORDER_ID, { parcel_id: PARCEL_ID }, intrus);
    expect(result.status).toBe(403);
    expectTransactionRolledBack(client);
  });

  test('422 — backorder déjà en statut shipped (non annulable)', async () => {
    const order  = makeOrder();
    const parcel = makeParcel({ status: 'shipped' });
    const client = makeClient([
      { rows: [order] },
      { rows: [parcel] },
    ]);
    pool.getClient.mockResolvedValue(client);

    const result = await cancelBackorder(ORDER_ID, { parcel_id: PARCEL_ID }, USER_ADMIN);
    expect(result.status).toBe(422);
    expect(result.body.current_status).toBe('shipped');
    expectTransactionRolledBack(client);
  });

  // Lot 4 — régression bug backorder : le SELECT parcel_items doit ramener
  // variant_combo/sku_id/has_variants, sinon adjustStock() ne restaure que
  // products.stock et le stock variante/SKU reste silencieusement perdu.
  // PDC-7 (Lot 7) — inventory_model est désormais également requis : le
  // dispatch d'adjustStock() est gouverné exclusivement par inventory_model,
  // plus par la seule présence de sku_id.

  test('restaure aussi product_variants quand l\'article a un variant_combo (chemin legacy 2 axes)', async () => {
    const order  = makeOrder();
    const parcel = makeParcel();
    const items = [{
      id: 'pi-001', product_id: 'prod-001', product_name: 'Robe',
      quantity: 2, price_kmf: 5000, order_item_id: 'oi-001',
      has_variants: true, variant_combo: { color: 'Rouge' }, sku_id: null,
      inventory_model: 'LEGACY_VARIANTS',
    }];
    const client = makeClient([
      { rows: [order] },          // SELECT order
      { rows: [parcel] },         // SELECT parcel backorder
      { rows: items },            // SELECT parcel_items (avec variant_combo/has_variants/sku_id)
      { rows: [], rowCount: 1 },  // UPDATE parcels cancelled
      { rows: [], rowCount: 1 },  // adjustStock: UPDATE products (stock global)
      { rows: [], rowCount: 1 },  // adjustStock: UPDATE product_variants (axe color)
      { rows: [], rowCount: 1 },  // INSERT order_status_history
    ]);
    pool.getClient.mockResolvedValue(client);

    const result = await cancelBackorder(ORDER_ID, { parcel_id: PARCEL_ID, reason: 'Client change d\'avis' }, USER_ADMIN);

    expect(result.status).toBe(200);
    const sqls = client.calls.map(c => String(c.sql).replace(/\s+/g, ' ').trim());
    expect(sqls.some(s => s.startsWith('UPDATE products SET stock'))).toBe(true);
    expect(sqls.some(s => s.startsWith('UPDATE product_variants SET stock'))).toBe(true);
    expectTransactionCommitted(client);
  });

  test('restaure product_skus (chemin SKU exclusif, pas products.stock) quand l\'article a un sku_id', async () => {
    const order  = makeOrder();
    const parcel = makeParcel();
    const items = [{
      id: 'pi-001', product_id: 'prod-001', product_name: 'Robe',
      quantity: 1, price_kmf: 5000, order_item_id: 'oi-001',
      has_variants: true, variant_combo: { color: 'Rouge', size: 'M' }, sku_id: 'sku-001',
      inventory_model: 'SKU',
    }];
    const client = makeClient([
      { rows: [order] },          // SELECT order
      { rows: [parcel] },         // SELECT parcel backorder
      { rows: items },            // SELECT parcel_items (avec sku_id + inventory_model)
      { rows: [], rowCount: 1 },  // UPDATE parcels cancelled
      { rows: [{ id: 'sku-001' }], rowCount: 1 },  // adjustStock: UPDATE product_skus (chemin exclusif, RETURNING id)
      { rows: [], rowCount: 1 },  // INSERT order_status_history
    ]);
    pool.getClient.mockResolvedValue(client);

    const result = await cancelBackorder(ORDER_ID, { parcel_id: PARCEL_ID, reason: 'Client change d\'avis' }, USER_ADMIN);

    expect(result.status).toBe(200);
    const sqls = client.calls.map(c => String(c.sql).replace(/\s+/g, ' ').trim());
    expect(sqls.some(s => s.startsWith('UPDATE product_skus SET stock'))).toBe(true);
    expect(sqls.some(s => s.startsWith('UPDATE products SET stock'))).toBe(false);
    expect(sqls.some(s => s.startsWith('UPDATE product_variants SET stock'))).toBe(false);
    expectTransactionCommitted(client);
  });
});
