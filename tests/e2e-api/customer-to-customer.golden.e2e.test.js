'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * GOLDEN E2E — Customer-to-Customer Closure.
 *
 * Feature propriétaire : orders.
 * Features traversées : payments, purchasing, logistics, incident-management, refunds.
 *
 * Ce Golden ne rejoue pas les appels réseau provider déjà certifiés séparément.
 * Il injecte uniquement les faits canoniques persistants minimaux, puis appelle
 * les vrais réconciliateurs de frontières :
 *
 * CLIENT PAID
 * -> SUPPLIER ORDER
 * -> SUPPLIER PAYMENT
 * -> SUPPLIER FULFILLMENT
 * -> HUB INBOUND
 * -> MARKET LEG
 * -> CUSTOMER HANDOFF
 * -> FINANCIAL CLOSE
 *
 * Invariants prouvés :
 * - un fulfillment fournisseur + tracking ne vaut jamais réception Hub ;
 * - un parcel available ne vaut jamais remise client ;
 * - un handoff non prouvé bloque la fermeture financière ;
 * - chaque frontière devient verte uniquement après son propre fait canonique.
 */

const { describeE2E, createCleanup, RUN_TAG, tag, uuid } = require('../helpers/e2eDbKit');

jest.setTimeout(90000);

describeE2E('E2E-GOLDEN — customer-to-customer complete closure', ({ db }) => {
  const { reconcileHubInbound } = require('../../services/hub-inbound-reconciliation');
  const { reconcileCustomerHandoff } = require('../../services/customer-handoff-reconciliation');
  const { reconcileOrderFinancialClose } = require('../../services/order-financial-closure-reconciliation');

  const userId = uuid();
  const relaisId = uuid();
  const supplierId = uuid();
  const productId = uuid();
  const skuId = uuid();
  const orderId = uuid();
  const itemId = uuid();
  const poId = uuid();
  const lineId = uuid();
  const executionOrderId = uuid();
  const supplierPaymentId = uuid();
  const fulfillmentId = uuid();
  const allocationId = uuid();
  const hubUnitId = uuid();
  const parcelId = uuid();
  const scanId = uuid();

  const ORDER_REF = `K-GOLDEN-${RUN_TAG}`.toUpperCase();
  const SUPPLIER_ORDER_ID = `CJ-GOLDEN-${RUN_TAG}`.toUpperCase();
  const SUPPLIER_UNIT_REF = `VID-GOLDEN-${RUN_TAG}`.toUpperCase();
  const HUB_REF = `KOM-RCV-GOLDEN-${RUN_TAG}`.toUpperCase();
  const PARCEL_REF = `KOM-BOX-GOLDEN-${RUN_TAG}`.toUpperCase();
  const TRACKING_REF = `TRK-GOLDEN-${RUN_TAG}`.toUpperCase();
  const PAYMENT_REF = `PAY-GOLDEN-${RUN_TAG}`.toUpperCase();

  const soi = {
    provider: 'cj',
    version: 1,
    payload: {
      supplier_unit_ref: SUPPLIER_UNIT_REF,
      supplier_sku: `CJ-SKU-${RUN_TAG}`,
    },
  };

  let cleanup;
  let marketId;

  const q = (sql, params) => db.query(sql, params);
  const one = async (sql, params) => (await q(sql, params)).rows[0];

  beforeAll(async () => {
    cleanup = createCleanup(db);

    const market = await one(`SELECT id FROM markets WHERE code = 'KM' LIMIT 1`);
    if (!market) throw new Error('Golden customer-to-customer exige le marché canonique KM');
    marketId = market.id;

    cleanup.trackSql(`
      SET session_replication_role = replica;

      DELETE FROM supplier_execution_fulfillments WHERE id = '${fulfillmentId}';
      DELETE FROM supplier_execution_payments WHERE id = '${supplierPaymentId}';
      DELETE FROM supplier_execution_order_lines WHERE supplier_execution_order_id = '${executionOrderId}';
      DELETE FROM supplier_execution_orders WHERE id = '${executionOrderId}';

      DELETE FROM scans WHERE id = '${scanId}';
      DELETE FROM parcel_events WHERE parcel_id = '${parcelId}';
      DELETE FROM parcel_items WHERE parcel_id = '${parcelId}';
      DELETE FROM parcels WHERE id = '${parcelId}';

      DELETE FROM hub_physical_unit_placements WHERE allocation_id = '${allocationId}';
      DELETE FROM hub_purchase_allocations WHERE id = '${allocationId}';
      DELETE FROM hub_physical_units WHERE id = '${hubUnitId}';

      DELETE FROM incidents WHERE order_id = '${orderId}' OR parcel_id = '${parcelId}';
      DELETE FROM refunds WHERE order_id = '${orderId}';

      DELETE FROM purchase_lines WHERE id = '${lineId}';
      DELETE FROM purchase_orders WHERE id = '${poId}';
      DELETE FROM order_items WHERE id = '${itemId}';
      DELETE FROM orders WHERE id = '${orderId}';

      DELETE FROM product_skus WHERE id = '${skuId}';
      DELETE FROM products WHERE id = '${productId}';
      DELETE FROM suppliers WHERE id = '${supplierId}';
      DELETE FROM relais WHERE id = '${relaisId}';
      DELETE FROM users WHERE id = '${userId}';

      SET session_replication_role = origin;
    `);

    await q(
      `INSERT INTO users (id, full_name, email, phone, role)
       VALUES ($1,'Golden Customer',$2,$3,'client')`,
      [userId, `${tag('golden-customer')}@komerce.test`, '+2693000000']
    );

    await q(
      `INSERT INTO relais (id, name, agent_name, phone, address, market_id)
       VALUES ($1,$2,'Golden Agent','+2693000001','Golden Relay',$3)`,
      [relaisId, `Golden Relay ${tag('relay')}`, marketId]
    );

    await q(
      `INSERT INTO suppliers (id, name, platform, contact_phone, auto_order, is_active)
       VALUES ($1,$2,'cj','+971500000001',true,true)`,
      [supplierId, `Golden CJ Supplier ${tag('supplier')}`]
    );

    await q(
      `INSERT INTO products (id, name, price_kmf, stock, price_aed, inventory_model)
       VALUES ($1,$2,25000,0,200,'SKU')`,
      [productId, `Golden Product ${tag('product')}`]
    );

    await q(
      `INSERT INTO product_skus
         (id, product_id, sku, stock, is_active, source, supplier_sku, supplier_unit_ref, supplier_order_identity)
       VALUES ($1,$2,$3,10,true,'SUPPLIER',$4,$5,$6::jsonb)`,
      [
        skuId,
        productId,
        `K-${tag('golden-sku')}`,
        soi.payload.supplier_sku,
        SUPPLIER_UNIT_REF,
        JSON.stringify(soi),
      ]
    );

    // 1 — CLIENT PAID
    await q(
      `INSERT INTO orders
         (id, user_id, relais_id, market_id, reference, status, payment_status,
          payment_mode, total_kmf, total_eur)
       VALUES ($1,$2,$3,$4,$5,'ordered','paid','stripe_eur',25000,50)`,
      [orderId, userId, relaisId, marketId, ORDER_REF]
    );

    await q(
      `INSERT INTO order_items
         (id, order_id, product_id, quantity, price_kmf, sku_id, fulfillment_source)
       VALUES ($1,$2,$3,1,25000,$4,'IMPORT')`,
      [itemId, orderId, productId, skuId]
    );

    // 2 — PO + SUPPLIER ORDER exact
    await q(
      `INSERT INTO purchase_orders
         (id, order_id, supplier_id, status, trigger_mode, procurement_hub_ref,
          qty, supplier_sku, supplier_order_id, confirmed_at)
       VALUES ($1,NULL,$2,'confirmed','auto','DXB',NULL,NULL,$3,NOW())`,
      [poId, supplierId, SUPPLIER_ORDER_ID]
    );

    await q(
      `INSERT INTO purchase_lines
         (id, purchase_order_id, order_item_id, supplier_id, product_sku_id,
          supplier_sku, supplier_unit_ref, supplier_order_identity, quantity,
          supplier_unit_price, supplier_currency, procurement_hub_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,1,7,'USD','DXB')`,
      [
        lineId,
        poId,
        itemId,
        supplierId,
        skuId,
        soi.payload.supplier_sku,
        SUPPLIER_UNIT_REF,
        JSON.stringify(soi),
      ]
    );

    await q(
      `INSERT INTO supplier_execution_orders
         (id, purchase_order_id, provider, supplier_order_id, supplier_order_code, provider_status)
       VALUES ($1,$2,'cj',$3,$4,'SHIPPED')`,
      [executionOrderId, poId, SUPPLIER_ORDER_ID, `CODE-${RUN_TAG}`]
    );

    await q(
      `INSERT INTO supplier_execution_order_lines
         (supplier_execution_order_id, purchase_line_id, quantity)
       VALUES ($1,$2,1)`,
      [executionOrderId, lineId]
    );

    // 3 — SUPPLIER PAYMENT evidence-backed
    await q(
      `INSERT INTO supplier_execution_payments
         (id, purchase_order_id, provider, payment_execution_key,
          supplier_execution_order_id, payment_ref,
          expected_amount, observed_amount, currency,
          status, reconciliation_status, real_debit_verified)
       VALUES ($1,$2,'cj',$3,$4,$5,7,7,'USD','succeeded','matched',true)`,
      [
        supplierPaymentId,
        poId,
        `golden-payment:${RUN_TAG}`,
        executionOrderId,
        PAYMENT_REF,
      ]
    );

    // 4 — SUPPLIER FULFILLMENT evidence-backed.
    await q(
      `INSERT INTO supplier_execution_fulfillments
         (id, supplier_execution_order_id, provider, fulfillment_execution_key,
          expected_quantity, observed_quantity, provider_status,
          carrier, tracking_number, shipped_at,
          reconciliation_status, evidence_source, evidence_ref, facts)
       VALUES ($1,$2,'cj',$3,1,1,'SHIPPED',
               'CJ', $4, NOW(),
               'matched','cj_order_detail',$5,$6::jsonb)`,
      [
        fulfillmentId,
        executionOrderId,
        `fulfillment:${executionOrderId}:${SUPPLIER_UNIT_REF}`,
        TRACKING_REF,
        `EVIDENCE-${RUN_TAG}`,
        JSON.stringify({ supplier_unit_ref: SUPPLIER_UNIT_REF }),
      ]
    );
  });

  afterAll(async () => {
    if (cleanup) await cleanup.run();
  });

  it('ferme une boucle customer-to-customer en prouvant chaque couture indépendamment', async () => {
    // FULFILLMENT fournisseur + tracking ne prouvent pas le Hub.
    let inbound = await reconcileHubInbound(db, { supplierFulfillmentId: fulfillmentId });
    expect(inbound).toMatchObject({
      verdict: 'PENDING',
      reason: 'HUB_INBOUND_NOT_RECEIVED',
      expected_quantity: 1,
      received_quantity: 0,
      supplier_tracking_present: true,
      supplier_tracking_number: TRACKING_REF,
    });

    // La fermeture financière est encore impossible : aucune remise client.
    let close = await reconcileOrderFinancialClose(db, { orderId });
    expect(close).toMatchObject({
      verdict: 'FINANCIAL_CLOSE_PENDING',
      reason: 'FINANCIAL_CLOSE_HANDOFF_PENDING',
      payment_status: 'paid',
    });

    // 5 — HUB INBOUND : vérité physique indépendante.
    await q(
      `INSERT INTO hub_purchase_allocations
         (id, purchase_order_id, order_id, order_item_id, product_sku_id, supplier_id,
          supplier_unit_ref, supplier_order_identity, quantity, market_id,
          destination_ref, purchase_line_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,1,$9,$10,$11)`,
      [
        allocationId,
        poId,
        orderId,
        itemId,
        skuId,
        supplierId,
        SUPPLIER_UNIT_REF,
        JSON.stringify(soi),
        marketId,
        `relais:${relaisId}`,
        lineId,
      ]
    );

    await q(
      `INSERT INTO hub_physical_units
         (id, reference, unit_type, state, external_ref, current_location_ref)
       VALUES ($1,$2,'SUPPLIER_PACKAGE','RECEIVED',$3,'DXB-HUB')`,
      [hubUnitId, HUB_REF, TRACKING_REF]
    );

    await q(
      `INSERT INTO hub_physical_unit_placements
         (physical_unit_id, allocation_id, quantity, operation_type)
       VALUES ($1,$2,1,'RECEIVE')`,
      [hubUnitId, allocationId]
    );

    inbound = await reconcileHubInbound(db, { supplierFulfillmentId: fulfillmentId });
    expect(inbound).toMatchObject({
      verdict: 'INBOUND_MATCHED',
      reason: null,
      expected_quantity: 1,
      received_quantity: 1,
      hub_unit_refs: [HUB_REF],
    });

    // 6 — MARKET LEG jusqu'au relais. AVAILABLE n'est toujours pas un handoff.
    await q(
      `INSERT INTO parcels
         (id, order_id, reference, status, type, relais_id,
          shipped_at, in_transit_at, arrived_at, available_at)
       VALUES ($1,$2,$3,'available','standard',$4,
               NOW() - INTERVAL '3 hours',
               NOW() - INTERVAL '2 hours',
               NOW() - INTERVAL '1 hour',
               NOW())`,
      [parcelId, orderId, PARCEL_REF, relaisId]
    );

    await q(
      `INSERT INTO parcel_items
         (parcel_id, order_item_id, product_id, quantity)
       VALUES ($1,$2,$3,1)`,
      [parcelId, itemId, productId]
    );

    await q(
      `UPDATE orders
          SET status='available', available_at=NOW(), updated_at=NOW()
        WHERE id=$1`,
      [orderId]
    );

    let handoff = await reconcileCustomerHandoff(db, { orderId });
    expect(handoff).toMatchObject({
      verdict: 'HANDOFF_PENDING',
      reason: 'CUSTOMER_HANDOFF_NOT_COLLECTED',
      parcel_count: 1,
      collected_parcel_count: 0,
    });

    close = await reconcileOrderFinancialClose(db, { orderId });
    expect(close).toMatchObject({
      verdict: 'FINANCIAL_CLOSE_PENDING',
      reason: 'FINANCIAL_CLOSE_HANDOFF_PENDING',
      supplier_payments: [
        expect.objectContaining({
          id: supplierPaymentId,
          provider: 'cj',
          status: 'succeeded',
          reconciliation_status: 'matched',
          real_debit_verified: true,
        }),
      ],
    });

    // 7 — CUSTOMER HANDOFF : preuve canonique, distincte du statut parcel.
    await q(
      `INSERT INTO scans
         (id, order_id, parcel_id, step, scanned_by, scan_code, notes,
          pickup_method, pickup_relais_id)
       VALUES ($1,$2,$3,'collected',$4,$5,
               'Retrait confirmé — code secret vérifié au guichet relais',
               'PICKUP_CODE',$6)`,
      [scanId, orderId, parcelId, userId, ORDER_REF, relaisId]
    );

    await q(
      `UPDATE parcels
          SET status='collected', collected_at=NOW(), updated_at=NOW()
        WHERE id=$1`,
      [parcelId]
    );

    await q(
      `UPDATE orders
          SET status='collected', collected_at=NOW(), updated_at=NOW()
        WHERE id=$1`,
      [orderId]
    );

    handoff = await reconcileCustomerHandoff(db, { orderId });
    expect(handoff).toMatchObject({
      verdict: 'HANDOFF_MATCHED',
      reason: null,
      order_status: 'collected',
      parcel_count: 1,
      collected_parcel_count: 1,
      proofs: [
        expect.objectContaining({
          scan_id: scanId,
          parcel_id: parcelId,
          method: 'PICKUP_CODE',
          pickup_relais_id: relaisId,
        }),
      ],
    });

    // 8 — FINANCIAL CLOSE : toutes les frontières sont maintenant vertes.
    close = await reconcileOrderFinancialClose(db, { orderId });
    expect(close).toMatchObject({
      verdict: 'FINANCIAL_CLOSE_MATCHED',
      reason: null,
      mode: 'normal',
      order_reference: ORDER_REF,
      order_status: 'collected',
      payment_status: 'paid',
      handoff_verdict: 'HANDOFF_MATCHED',
      incidents: [],
      refunds: [],
      supplier_payments: [
        expect.objectContaining({
          id: supplierPaymentId,
          provider: 'cj',
          status: 'succeeded',
          reconciliation_status: 'matched',
          real_debit_verified: true,
          expected_amount: 7,
          observed_amount: 7,
          currency: 'USD',
        }),
      ],
    });
  });
});
