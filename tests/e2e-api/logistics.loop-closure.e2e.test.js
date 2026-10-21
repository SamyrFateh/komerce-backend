'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * LOOP CLOSURE — un seul écrivain canonique, quatre vues consommatrices.
 *
 * Écrivain : services/order-status-machine#transitionOrderStatus (acteur admin,
 * source « patch » : transitions strictes, mêmes règles que l'API).
 * Consommateurs : projection chaîne de contrôle (Opérations / Pilotage / Commande 360),
 * liste Opérations, file Hub Live, liste Relais Live, Commande 360.
 *
 * Aucune fixture n'écrit le statut : seul l'écrivain canonique le change.
 */

const { describeE2E, createCleanup, RUN_TAG, tag, uuid } = require('../helpers/e2eDbKit');

jest.setTimeout(90000);

describeE2E('E2E-LOOP — écrivain canonique → vues consommatrices', ({ db }) => {
  const { transitionOrderStatus } = require('../../services/order-status-machine');
  const projection = require('../../services/logistics-control-chain-projection');
  const order360 = require('../../services/order-360');
  const opsQueries = require('../../services/dashboard-operations');
  const hubQueries = require('../../services/hub-dashboard-queries');
  const relayQueries = require('../../services/relay-dashboard-queries');

  const userId = uuid();
  const relaisId = uuid();
  const productId = uuid();
  const REF = `LOOP-${RUN_TAG}`.toUpperCase();
  const ADMIN = { id: null, role: 'admin' };
  const q = (sql, params) => db.query(sql, params);
  let cleanup;
  let marketId;
  let orderId;

  async function views() {
    const order = { id: orderId, market_id: marketId, reference: REF };
    const status = (await q('SELECT status::text AS s FROM orders WHERE id=$1', [orderId])).rows[0].s;
    const control = await projection.getOrderControlSnapshot(order);
    const ops = await opsQueries.getActiveOrders({});
    const hub = await hubQueries.getQueue({ tab: 'all', limit: 100, search: REF });
    const relay = await relayQueries.getOrders({ role: 'admin' }, {
      status: 'confirmed,ordered,preparation,shipped,in_transit,available,collected', search: REF, limit: 100,
    });
    const o360 = await order360.loadOrder360((await order360.resolveOrder(REF)).order);
    return {
      status,
      stage: control && control.stage,
      ops: (ops.orders || ops || []).some && (ops.orders || ops).some(o => o.reference === REF),
      hub: JSON.stringify(hub).includes(REF),
      relay: JSON.stringify(relay).includes(REF),
      o360stage: o360 && o360.control_position && o360.control_position.stage,
      o360status: o360 && o360.order && o360.order.status,
    };
  }

  beforeAll(async () => {
    cleanup = createCleanup(db);
    marketId = (await q(`SELECT id FROM markets WHERE code = 'KM' LIMIT 1`)).rows[0].id;
    cleanup.trackSql(`
      SET session_replication_role = replica;
      DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE user_id = '${userId}');
      DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = '${userId}');
      DELETE FROM orders WHERE user_id = '${userId}';
      DELETE FROM products WHERE id = '${productId}';
      DELETE FROM relais WHERE id = '${relaisId}';
      DELETE FROM users WHERE id = '${userId}';
      SET session_replication_role = origin;
    `);
    await q(`INSERT INTO users (id, full_name, email, phone, role) VALUES ($1,'E2E Loop Client',$2,$3,'client')`,
      [userId, `${tag('loop')}@komerce.test`, `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`]);
    await q(`INSERT INTO relais (id, name, agent_name, phone, address, market_id) VALUES ($1,$2,'E2E Agent','+269000444','E2E Loop',$3)`,
      [relaisId, `E2E Loop Relais ${tag('relay')}`, marketId]);
    await q(`INSERT INTO products (id, name, price_kmf, stock, price_aed, inventory_model) VALUES ($1,$2,25000,0,200,'SKU')`,
      [productId, `E2E Loop Product ${tag('product')}`]);
    orderId = uuid();
    await q(`INSERT INTO orders (id, user_id, relais_id, market_id, reference, status, payment_status, payment_mode, total_kmf, total_eur)
             VALUES ($1,$2,$3,$4,$5,'confirmed','paid','cash_relais',25000,50)`, [orderId, userId, relaisId, marketId, REF]);
    await q(`INSERT INTO order_items (id, order_id, product_id, quantity, price_kmf, fulfillment_source) VALUES ($1,$2,$3,1,25000,'IMPORT')`,
      [uuid(), orderId, productId]);
  });

  afterAll(async () => { if (cleanup) await cleanup.run(); });

  // Visibilité attendue par vue après chaque transition (écrivain unique, vérité relue en base).
  // Hub Live : file d'exécution jusqu'au transit ; Opérations : chaîne active ; Relais Live : jusqu'à la remise.
  const EXPECTED = [
    { target: 'ordered',     stage: 'PURCHASING', ops: true,  hub: true,  relay: true },
    { target: 'preparation', stage: 'HUB_CONTROL', ops: true, hub: true,  relay: true },
    { target: 'shipped',     stage: 'FORWARDER',  ops: true,  hub: true,  relay: true },
    { target: 'in_transit',  stage: 'TRANSPORT',  ops: true,  hub: true,  relay: true },
    { target: 'available',   stage: 'RELAY',      ops: true,  hub: false, relay: true },
    { target: 'collected',   stage: null,         ops: false, hub: false, relay: true },
  ];

  test('chaque transition canonique est relue à l’identique par Opérations, Hub Live, Relais Live et Commande 360', async () => {
    const seed = await views();
    expect(seed).toMatchObject({ status: 'confirmed', stage: 'ORDER', ops: true, hub: true, relay: true, o360stage: 'ORDER' });
    for (const step of EXPECTED) {
      const result = await transitionOrderStatus({ orderId, newStatus: step.target, actor: ADMIN, source: 'patch' });
      expect(result.success).toBe(true);
      const v = await views();
      expect(v).toMatchObject({
        status: step.target, stage: step.stage, o360stage: step.stage, o360status: step.target,
        ops: step.ops, hub: step.hub, relay: step.relay,
      });
    }
  });

  test('refus et idempotence : une transition invalide ou rejouée ne déplace aucune vue', async () => {
    const before = await views();
    expect(before.status).toBe('collected');
    const refused = await transitionOrderStatus({ orderId, newStatus: 'available', actor: ADMIN, source: 'patch' });
    expect(refused.success).toBe(false);
    const replay = await transitionOrderStatus({ orderId, newStatus: 'collected', actor: ADMIN, source: 'patch' });
    expect(replay).toMatchObject({ success: true, noop: true });
    expect(await views()).toEqual(before);
  });
});
