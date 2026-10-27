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
const FP_GOLDEN_PO_SHAPE=process.env.FP_GOLDEN_PO_SHAPE||'grouped';
if(!['grouped','historical'].includes(FP_GOLDEN_PO_SHAPE))throw Error('FP_GOLDEN_PO_SHAPE invalid');


describeE2E('E2E-GOLDEN — customer-to-customer complete closure', ({ db }) => {
  const { reconcileHubInbound } = require('../../services/hub-inbound-reconciliation');
  const { reconcileCustomerHandoff } = require('../../services/customer-handoff-reconciliation');
  const { reconcileOrderFinancialClose } = require('../../services/order-financial-closure-reconciliation');
  const { transitionOrderStatus } = require('../../services/order-status-machine');
  const {
    createShipment,
    declareCustomsPayment,
    isCustomsDeclaredForOrder,
  } = require('../../services/customs-shipment-service');

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
  const CUSTOMS_REF = `CUS-GOLDEN-${RUN_TAG}`.toUpperCase();

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
  let unsubmittedPoProof;
  let preSubmissionHubProbe;

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
      DELETE FROM order_item_real_cost_allocations WHERE order_id = '${orderId}';
      DELETE FROM order_item_cost_imputations WHERE order_id = '${orderId}';
      DELETE FROM customs_shipment_parcels
       WHERE shipment_id IN (SELECT id FROM customs_shipments WHERE reference = '${CUSTOMS_REF}')
          OR parcel_id = '${parcelId}';
      DELETE FROM customs_shipments WHERE reference = '${CUSTOMS_REF}';
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
      `INSERT INTO products
         (id, name, price_kmf, cost_kmf, volume_cm3, stock, price_aed, inventory_model)
       VALUES ($1,$2,25000,7000,100000,0,200,'SKU')`,
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

    // Snapshot économique minimal attendu par pricing-maturity :
    // achat fournisseur + fret + douane doivent tous être réconciliés par du réel.
    await q(
      `INSERT INTO order_item_cost_imputations
         (order_id, order_item_id, product_id, quantity,
          sale_unit_price_kmf, sale_total_kmf,
          estimated_landed_relay_cost_kmf, estimated_business_complete_cost_kmf,
          estimated_margin_kmf, estimated_margin_pct,
          cost_breakdown, pricing_source)
       VALUES ($1,$2,$3,1,25000,25000,11000,11000,14000,56,
               $4::jsonb,'golden-e2e')`,
      [orderId, itemId, productId, JSON.stringify({
        landed_relay: {
          product_purchase: 7000,
          freight: 1500,
          customs: 2500,
        },
        business: { payment: 0 },
      })]
    );

    // Le paiement fournisseur prouvé donne le coût d'achat réel au grain item.
    await q(
      `INSERT INTO order_item_real_cost_allocations
         (order_id, order_item_id, cost_type, amount_kmf,
          allocation_method, source, is_actual, confidence)
       VALUES ($1,$2,'product_purchase',7000,'direct',
               'supplier_execution_payment',TRUE,'high')`,
      [orderId, itemId]
    );

    // 2 — PO + SUPPLIER ORDER exact
    if(FP_GOLDEN_PO_SHAPE==='grouped') {
    await q(
      `INSERT INTO purchase_orders
         (id, order_id, supplier_id, status, trigger_mode, procurement_hub_ref,
          qty, supplier_sku)
       VALUES ($1,NULL,$2,'draft','auto','DXB',NULL,NULL)`,
      [poId, supplierId]
    );

    // Une ligne destinée à une PO regroupée naît ouverte, puis est rattachée
    // explicitement. La garde DB interdit volontairement un INSERT déjà attaché.
    } else {
      await q(
        `INSERT INTO purchase_orders
           (id,order_id,order_item_id,product_sku_id,supplier_id,status,trigger_mode,
            procurement_hub_ref,qty,supplier_sku,supplier_unit_ref,supplier_order_identity)
         VALUES ($1,$2,$3,$4,$5,'pending','auto','DXB',1,$6,$7,$8::jsonb)`,
        [poId,orderId,itemId,skuId,supplierId,soi.payload.supplier_sku,
          SUPPLIER_UNIT_REF,JSON.stringify(soi)]
      );
    }

    await q(
      `INSERT INTO purchase_lines
         (id, purchase_order_id, order_item_id, supplier_id, product_sku_id,
          supplier_sku, supplier_unit_ref, supplier_order_identity, quantity,
          supplier_unit_price, supplier_currency, procurement_hub_ref)
       VALUES ($1,$8,$2,$3,$4,$5,$6,$7::jsonb,1,7,'USD','DXB')`,
      [
        lineId,
        itemId,
        supplierId,
        skuId,
        soi.payload.supplier_sku,
        SUPPLIER_UNIT_REF,
        JSON.stringify(soi), FP_GOLDEN_PO_SHAPE==='historical'?poId:null,
      ]
    );

    if(FP_GOLDEN_PO_SHAPE==='grouped') {
    await q(
      `UPDATE purchase_lines
          SET purchase_order_id = $2,
              updated_at = NOW()
        WHERE id = $1`,
      [lineId, poId]
    );

    }
    // Independent R&D SQL checkpoint: actual unsubmitted PO form before
    // any supplier execution/payment fixture is inserted. This is an
    // observation of persisted facts, not proof of a provider-side action.
    const {collectUnsubmittedPo}=require('../../scripts/research/golden-po-unsubmitted-proof');
    unsubmittedPoProof=await collectUnsubmittedPo(db,{
      shape:FP_GOLDEN_PO_SHAPE,poId,lineId,orderId,orderItemId:itemId,
    });
    expect(unsubmittedPoProof.verdict).toBe('NO_RECORDED_SUPPLIER_EXECUTION');
    expect(unsubmittedPoProof.issues).toEqual([]);

    // The negative checkpoint uses the REAL Hub writer on a transaction
    // that is always rolled back. Do not manufacture supplier execution.
    // This exposes a possible early-receipt asymmetry without changing
    // the nominal Golden or claiming a production incident.
    const {receiveSupplierPackage}=require('../../services/hub-physical-identity');
    const probeClient=await db.getClient();
    try {
      await probeClient.query('BEGIN');
      try {
        const receipt=await receiveSupplierPackage(probeClient,{
          reference:'FP-UNSUBMITTED-'+FP_GOLDEN_PO_SHAPE+'-'+RUN_TAG,
          actorId:userId,locationRef:'DXB-HUB',
          contents:[{purchase_order_id:poId,product_sku_id:skuId,quantity:1}],
        });
        const count=await probeClient.query(
          'SELECT COUNT(*)::integer AS n FROM hub_purchase_allocations WHERE purchase_order_id=$1',
          [poId]
        );
        preSubmissionHubProbe={
          outcome:receipt.quarantined?'QUARANTINED':'RECEIVED',
          reason_code:receipt.reason_code||null,
          allocation_count:Number(count.rows[0].n),
        };
      } catch(error) {
        preSubmissionHubProbe={outcome:'ERROR',reason_code:error.code||error.name||'UNKNOWN',
          allocation_count:null};
      }
    } finally {
      await probeClient.query('ROLLBACK');
      probeClient.release();
    }
    const noResidualHub=await one(
      'SELECT COUNT(*)::integer AS n FROM hub_purchase_allocations WHERE purchase_order_id=$1',
      [poId]
    );
    expect(noResidualHub.n).toBe(0);

    await q(
      `UPDATE purchase_orders
          SET status = 'confirmed',
              supplier_order_id = $2,
              confirmed_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [poId, SUPPLIER_ORDER_ID]
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

    const {collectGoldenTrail,analyzeGoldenTrail}=require('../../scripts/research/golden-identity-trail');
    const stageProofs=[];
    const preHubTrail=await collectGoldenTrail(db,orderId);
    expect(preHubTrail.issues).toEqual([]);
    expect(preHubTrail.gaps.map(x=>x.code)).toEqual(expect.arrayContaining([
      'NO_HUB_ALLOCATION','NO_HUB_PHYSICAL_UNIT_PLACEMENT',
      'NO_PARCEL_MEMBERSHIP','NO_CUSTOMER_HANDOFF_SCAN',
    ]));
    stageProofs.push({stage:'SUPPLIER_EXECUTION_NOT_HUB_RECEIPT',status:preHubTrail.status,
      gaps:preHubTrail.gaps.map(x=>x.code)});
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

    const afterHubTrail=await collectGoldenTrail(db,orderId);
    expect(afterHubTrail.issues).toEqual([]);
    expect(afterHubTrail.gaps.some(x=>x.code==='NO_HUB_ALLOCATION')).toBe(false);
    expect(afterHubTrail.gaps.some(x=>x.code==='NO_HUB_PHYSICAL_UNIT_PLACEMENT')).toBe(false);
    expect(afterHubTrail.gaps.some(x=>x.code==='NO_PARCEL_MEMBERSHIP')).toBe(true);
    stageProofs.push({stage:'HUB_RECEIPT_BEFORE_PARCEL',status:afterHubTrail.status,
      gaps:afterHubTrail.gaps.map(x=>x.code)});
    inbound = await reconcileHubInbound(db, { supplierFulfillmentId: fulfillmentId });
    expect(inbound).toMatchObject({
      verdict: 'INBOUND_MATCHED',
      reason: null,
      expected_quantity: 1,
      received_quantity: 1,
      hub_unit_refs: [HUB_REF],
    });

    // 6 — MARKET LEG arrive d'abord en douane : ARRIVED n'est pas AVAILABLE.
    await q(
      `INSERT INTO parcels
         (id, order_id, reference, status, type, relais_id,
          shipped_at, in_transit_at, arrived_at)
       VALUES ($1,$2,$3,'in_transit','standard',$4,
               NOW() - INTERVAL '3 hours',
               NOW() - INTERVAL '2 hours',
               NOW() - INTERVAL '1 hour')`,
      [parcelId, orderId, PARCEL_REF, relaisId]
    );

    await q(
      `INSERT INTO parcel_items
         (parcel_id, order_item_id, product_id, quantity)
       VALUES ($1,$2,$3,1)`,
      [parcelId, itemId, productId]
    );

    // 7 — CUSTOMS : le dossier pending bloque explicitement la progression.
    const createdCustoms = await createShipment(db, {
      reference: CUSTOMS_REF,
      shipment_date: new Date().toISOString().slice(0, 10),
      transitaire_name: 'Golden Forwarder',
      transport_mode: 'sea',
      cif_value_kmf: 25000,
      allocation_method: 'by_cif_value',
      parcel_ids: [parcelId],
    }, userId, { marketId });

    const customsShipmentId = createdCustoms.shipment.id;
    // Le colis arrive ensuite (le groupage se constitue sur des colis expédiés, la déclaration suit l'arrivée).
    await q(`UPDATE parcels SET status = 'arrived' WHERE id = $1`, [parcelId]);

    let customsGate = await isCustomsDeclaredForOrder(db, orderId);
    expect(customsGate).toMatchObject({ allowed: false });
    expect(customsGate.reason).toContain(CUSTOMS_REF);

    const declaration = await declareCustomsPayment(db, customsShipmentId, {
      customs_paid_kmf: 2500,
      freight_kmf: 1500,
      notes: 'Golden customs declaration',
    }, userId);

    expect(declaration).toMatchObject({
      shipment_id: customsShipmentId,
      status: 'declared',
      customs_paid_kmf: 2500,
      parcels_updated: 1,
    });

    customsGate = await isCustomsDeclaredForOrder(db, orderId);
    expect(customsGate).toEqual({ allowed: true });

    const customsFacts = await one(
      `SELECT cs.status,
              cs.customs_paid_kmf,
              csp.customs_share_kmf,
              p.customs_cleared_at
         FROM customs_shipments cs
         JOIN customs_shipment_parcels csp ON csp.shipment_id = cs.id
         JOIN parcels p ON p.id = csp.parcel_id
        WHERE cs.id = $1 AND p.id = $2`,
      [customsShipmentId, parcelId]
    );
    expect(customsFacts).toMatchObject({
      status: 'declared',
      customs_paid_kmf: 2500,
      customs_share_kmf: 2500,
    });
    expect(customsFacts.customs_cleared_at).toBeTruthy();

    // 8 — Le colis peut maintenant devenir AVAILABLE au relais.
    await q(
      `UPDATE parcels
          SET status='available', available_at=NOW(), updated_at=NOW()
        WHERE id=$1`,
      [parcelId]
    );

    // Passe par l'autorité canonique : le gate douane est revalidé et le
    // shipment declared est promu confirmed de façon group-safe.
    const availableTransition = await transitionOrderStatus({
      orderId,
      newStatus: 'available',
      actor: { id: userId, role: 'admin' },
      source: 'scan',
      dbClient: db,
    });
    expect(availableTransition).toMatchObject({
      success: true,
      newStatus: 'available',
    });

    const confirmedCustoms = await one(
      `SELECT status FROM customs_shipments WHERE id = $1`,
      [customsShipmentId]
    );
    expect(confirmedCustoms).toMatchObject({ status: 'confirmed' });

    const beforePickupTrail=await collectGoldenTrail(db,orderId);
    expect(beforePickupTrail.issues).toEqual([]);
    expect(beforePickupTrail.gaps).toEqual([{code:'NO_CUSTOMER_HANDOFF_SCAN',stage:'HANDOFF'}]);
    stageProofs.push({stage:'AT_RELAY_NO_CUSTOMER_SCAN',status:beforePickupTrail.status,
      gaps:beforePickupTrail.gaps.map(x=>x.code)});
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

    // 9 — CUSTOMER HANDOFF : preuve canonique, distincte du statut parcel.
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

    // 10 — FINANCIAL CLOSE : toutes les frontières sont maintenant vertes.
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
      economic_maturity: {
        mature: true,
        maturity_status: 'MATURE',
        blocking_reasons: [],
      },
      economic_actuals: {
        sale_total_kmf: 25000,
        real_cost_kmf: 11000,
        consolidated_margin_kmf: 14000,
      },
    });

    // Ground the compared shapes in actual persisted PO headers, not just
    // the environment variable that selected the fixture construction.
    const persistedPoForm=await one(
      'SELECT order_id,order_item_id,qty,supplier_sku FROM purchase_orders WHERE id=$1',
      [poId]
    );
    const actualPoShape=persistedPoForm?.order_id?'historical':'grouped';
    expect(actualPoShape).toBe(FP_GOLDEN_PO_SHAPE);
    if(FP_GOLDEN_PO_SHAPE==='historical'){
      expect(persistedPoForm.order_id).toBe(orderId);
      expect(persistedPoForm.order_item_id).toBe(itemId);
      expect(Number(persistedPoForm.qty)).toBe(1);
    } else {
      expect(persistedPoForm.order_id).toBeNull();
      expect(persistedPoForm.order_item_id).toBeNull();
    }
    const persistedLine=await one(
      'SELECT purchase_order_id,order_item_id FROM purchase_lines WHERE id=$1',
      [lineId]
    );
    expect(persistedLine.purchase_order_id).toBe(poId);
    expect(persistedLine.order_item_id).toBe(itemId);

    // R&D seam: independent canonical foreign-key trail on THIS SAME Golden
    // order, after all owners made their own verdicts. Read-only and never GO.
    const identityTrail = await collectGoldenTrail(db, orderId);
    stageProofs.push({stage:'CUSTOMER_HANDOFF_AND_FINANCIAL_CLOSE',status:identityTrail.status,
      gaps:identityTrail.gaps.map(x=>x.code)});
    expect(identityTrail.status).toBe('NO_IDENTITY_CONTRADICTION_OBSERVED');
    expect(identityTrail.issues).toEqual([]);
    expect(identityTrail.gaps).toEqual([]);
    expect(identityTrail.observed).toEqual(expect.objectContaining({
      orderId,
      itemIds: [itemId],
      purchaseLineIds: [lineId],
      executionLineIds: [lineId],
      supplierPaymentIds: [supplierPaymentId],
      fulfillmentIds: [fulfillmentId],
      hubAllocationIds: [allocationId],
      physicalUnitIds: [hubUnitId],
      parcelIds: [parcelId],
      scanIds: [scanId],
    }));
    expect(close.verdict).toBe('FINANCIAL_CLOSE_MATCHED');

    // Connected P1/P2/P7 R&D: the SAME persisted order-item and market,
    // owner services read-only. Simulated Golden objects are NOT real checkout.
    const {collectP1P7Canonical}=require('../../scripts/research/p1-p7-canonical-collector');
    const wiredP1P7=await collectP1P7Canonical(db,{
      productId,orderItemId:itemId,marketCode:'KM',orderReference:ORDER_REF,
    });
    expect(wiredP1P7.wired_edges).toHaveLength(13);
    expect(wiredP1P7.totals.notWired).toBe(0);
    expect(wiredP1P7.context.actual_product_id).toBe(productId);
    expect(wiredP1P7.context.actual_sku_id).toBe(skuId);
    expect(wiredP1P7.context.persisted_order_market).toBe('KM');
    expect(wiredP1P7.stagingCertified).toBe(false);
    expect(wiredP1P7.liveCheckoutCertified).toBe(false);
    // Failing owner reads are evidence gaps, never silently a green status.
    expect(wiredP1P7.owner_read_errors).toEqual([]);
    expect(wiredP1P7.price_review?.facts?.price_status).toBeNull();
    expect(wiredP1P7.price_review?.diagnostics?.gaps)
      .toContain('NO_HUMAN_MARKET_PRICE_DECISION');
    expect(wiredP1P7.boundaries.find(e=>e.id==='P6_P1_PRICE_REVIEW')?.status)
      .toBe('EVIDENCE_GAP');
    expect(wiredP1P7.country_settlement?.facts?.settlement_count).toBe(0);
    expect(wiredP1P7.country_settlement?.diagnostics?.gaps)
      .toContain('NO_COUNTRY_SETTLEMENT_ATTESTATION');
    expect(wiredP1P7.boundaries.find(e=>e.id==='P7_P5_COUNTRY_SETTLEMENT')?.status)
      .toBe('EVIDENCE_GAP');
    expect(wiredP1P7.funds_cost?.facts?.mode).toBe('stripe_eur');
    expect(wiredP1P7.funds_cost?.facts?.collections).toBe(0);
    expect(wiredP1P7.funds_cost?.facts?.actual_fee_allocations).toBe(0);
    expect(wiredP1P7.funds_cost?.diagnostics?.gaps)
      .toContain('SYNTHETIC_GOLDEN_PAYMENT_NOT_EXTERNAL_PROOF');
    expect(wiredP1P7.funds_cost?.diagnostics?.contradictions).toEqual([]);
    expect(wiredP1P7.boundaries.find(e=>e.id==='P5_P6_CASH_REALITY')?.status)
      .toBe('EVIDENCE_GAP');
    expect(wiredP1P7.logistics_cost?.facts?.member_parcel_count).toBe(1);
    expect(wiredP1P7.logistics_cost?.facts?.item_parcel_count).toBe(1);
    expect(wiredP1P7.logistics_cost?.facts?.allocated_kmf).toMatchObject({
      freight:1500,customs:2500,
    });
    expect(wiredP1P7.logistics_cost?.facts?.compared_owner_cost_types).toBe(2);
    expect(wiredP1P7.logistics_cost?.diagnostics?.contradictions).toEqual([]);
    expect(wiredP1P7.boundaries.find(e=>e.id==='P4_P6_LOGISTICS_COST')?.status)
      .toBe('NO_CONTRADICTION_OBSERVED');
    // A manual/product cost allocation is NOT a settled KMF supplier debit.
    expect(wiredP1P7.supplier_cost?.facts?.product_purchase_actual_count).toBe(1);
    expect(wiredP1P7.supplier_cost?.facts?.allocation_amount_kmf).toBe(7000);
    expect(wiredP1P7.supplier_cost?.facts?.settlement_real_kmf).toBeNull();
    expect(wiredP1P7.supplier_cost?.diagnostics?.gaps)
      .toContain('ACTUAL_ALLOCATION_WITHOUT_SETTLEMENT_PROOF');
    expect(wiredP1P7.boundaries.find(e=>e.id==='P3_P6_PURCHASE_COST')?.status)
      .toBe('EVIDENCE_GAP');
    expect(wiredP1P7.customer_finance?.facts?.closure_verdict).toBe('FINANCIAL_CLOSE_MATCHED');
    expect(wiredP1P7.customer_finance?.facts?.psp_reference_present).toBe(false);
    expect(wiredP1P7.customer_finance?.diagnostics?.gaps)
      .toContain('SYNTHETIC_PAYMENT_NOT_PSP_PROOF');
    expect(wiredP1P7.boundaries.find(e=>e.id==='P5_P2_PAYMENT_CLOSURE')?.status)
      .toBe('EVIDENCE_GAP');
    expect(wiredP1P7.physical_handoff?.facts?.handoff_verdict).toBe('HANDOFF_MATCHED');
    expect(wiredP1P7.boundaries.find(e=>e.id==='P4_P2_RELAY_HANDOFF')?.status)
      .toBe('NO_CONTRADICTION_OBSERVED');
    // Adversarial PostgreSQL A/B at P4 -> P2 (not a fake in-memory scan):
    // scan points to a second real relay, while collection owner can still
    // report MATCHED. Always rollback and verify the original scan survives.
    const relayProbeClient=await db.getClient();
    const wrongRelayId=uuid();
    let relayProbe;
    try {
      await relayProbeClient.query('BEGIN');
      await relayProbeClient.query(
        "INSERT INTO relais (id,name,agent_name,phone,address,market_id) "+
        "VALUES($1,$2,'Research Agent','+2693000002','R&D checkpoint',$3)",
        [wrongRelayId,'FP-WRONG-RELAY-'+RUN_TAG,marketId]
      );
      await relayProbeClient.query(
        'UPDATE scans SET pickup_relais_id=$2 WHERE id=$1',
        [scanId,wrongRelayId]
      );
      const owner=await reconcileCustomerHandoff(relayProbeClient,{orderId});
      const {collectP4P2Canonical}=require('../../scripts/research/p4-p2-canonical-collector');
      const seam=await collectP4P2Canonical(relayProbeClient,{
        item:{order_id:orderId,order_item_id:itemId,relais_id:relaisId},
      });
      relayProbe={
        canonical_handoff_verdict:owner.verdict,
        scanner_hypotheses:seam.diagnostics.contradictions,
        actual_relay_differs_from_order:true,
      };
      // The fixture is a controlled counterexample, not production history.
      expect(seam.diagnostics.contradictions)
        .toContain('COLLECTION_SCAN_FOREIGN_RELAY');
      expect(owner.verdict).toBe('HANDOFF_MATCHED');
    } finally {
      await relayProbeClient.query('ROLLBACK');
      relayProbeClient.release();
    }
    const unchangedRelay=await one('SELECT pickup_relais_id FROM scans WHERE id=$1',[scanId]);
    expect(unchangedRelay.pickup_relais_id).toBe(relaisId);
    expect(await one('SELECT id FROM relais WHERE id=$1',[wrongRelayId])).toBeUndefined();

    // P5->P2 negative real-PG proof: a delivered order with unreceived
    // customer payment cannot financial-close. The probe is transaction
    // isolated, never touches Stripe and leaves no persisted mutation.
    const financeClient=await db.getClient();
    let unpaidClosureProbe=null;
    try {
      await financeClient.query('BEGIN');
      await financeClient.query('SAVEPOINT p5_customer_payment');
      try {
        await financeClient.query(
          "UPDATE orders SET payment_status='pending' WHERE id=$1",[orderId]);
        const unpaid=await reconcileOrderFinancialClose(financeClient,{orderId});
        unpaidClosureProbe={
          outcome:'OWNER_RECONCILED_AFTER_TEMP_UNPAID',
          verdict:unpaid.verdict,
          reason:unpaid.reason||null,
          payment_status:unpaid.payment_status,
        };
        expect(unpaid.verdict).toBe('FINANCIAL_CLOSE_MISMATCH');
        expect(unpaid.reason).toBe('FINANCIAL_CLOSE_CUSTOMER_PAYMENT_NOT_PAID');
      } catch(error) {
        if(error.code==='23514'||error.code==='P0001'){
          await financeClient.query('ROLLBACK TO SAVEPOINT p5_customer_payment');
          unpaidClosureProbe={outcome:'DATABASE_GUARD_REJECTED_UNPAID_REWRITE',
            code:error.code};
        }else throw error;
      }
    } finally {
      await financeClient.query('ROLLBACK');
      financeClient.release();
    }
    expect((await one("SELECT payment_status::text AS payment_status FROM orders WHERE id=$1",
      [orderId])).payment_status).toBe('paid');
    expect(unpaidClosureProbe).toBeTruthy();

    // Real-PG adversarial P3->P6 allocation ownership: a valid second
    // same-market order is made ONLY inside a discarded transaction; then
    // the existing product-purchase allocation is pointed at that order.
    // A SQL guard rejection is acceptable and MUST be reported as such.
    const costProbeClient=await db.getClient();
    const foreignCostOrderId=uuid();
    let foreignCostProbe;
    try {
      await costProbeClient.query('BEGIN');
      await costProbeClient.query(
        "INSERT INTO orders(id,user_id,relais_id,market_id,reference,status,"+
        "payment_status,payment_mode,total_kmf,total_eur) "+
        "SELECT $2,user_id,relais_id,market_id,$3,'pending','pending',"+
        "payment_mode,total_kmf,total_eur FROM orders WHERE id=$1",
        [orderId,foreignCostOrderId,'K-GOLDEN-COST-FOREIGN-'+RUN_TAG]
      );
      await costProbeClient.query('SAVEPOINT p3p6_allocation_move');
      try {
        await costProbeClient.query(
          "UPDATE order_item_real_cost_allocations SET order_id=$2 "+
          "WHERE order_item_id=$1 AND cost_type='product_purchase' AND is_actual=TRUE",
          [itemId,foreignCostOrderId]
        );
        const {collectP3P6Canonical}=require('../../scripts/research/p3-p6-canonical-collector');
        const poisoned=await collectP3P6Canonical(costProbeClient,{
          item:{order_id:orderId,order_item_id:itemId},
        });
        expect(poisoned.diagnostics.contradictions)
          .toContain('COST_ALLOCATION_FOREIGN_ORDER');
        foreignCostProbe={outcome:'CROSS_ORDER_COST_ALLOCATION_REPRODUCED',
          hypothesis:'COST_ALLOCATION_FOREIGN_ORDER'};
      }catch(error){
        if(['23514','23503','P0001'].includes(error.code)){
          await costProbeClient.query('ROLLBACK TO SAVEPOINT p3p6_allocation_move');
          foreignCostProbe={outcome:'SQL_COST_ALLOCATION_ORDER_GUARD',
            sqlstate:error.code};
        }else throw error;
      }
    }finally{
      await costProbeClient.query('ROLLBACK');
      costProbeClient.release();
    }
    expect(foreignCostProbe).toBeTruthy();
    const restoredAllocation=await one(
      "SELECT order_id FROM order_item_real_cost_allocations "+
      "WHERE order_item_id=$1 AND cost_type='product_purchase' AND is_actual=TRUE LIMIT 1",
      [itemId]
    );
    expect(restoredAllocation.order_id).toBe(orderId);

    // P4->P6 adversarial physical-cost cross-check: an actual cost can only
    // be charged to the correct parcel. Use a second physically valid parcel
    // without this item, and ROLLBACK irrespective of test result.
    const logisticsProbeClient=await db.getClient();
    const unlinkedParcelId=uuid();
    let foreignParcelCostProbe;
    try{
      await logisticsProbeClient.query('BEGIN');
      await logisticsProbeClient.query(
        "INSERT INTO parcels(id,order_id,reference,status,type,relais_id) "+
        "SELECT $2,order_id,$3,'draft',type,relais_id FROM parcels WHERE id=$1",
        [parcelId,unlinkedParcelId,'FP-UNLINKED-COST-'+RUN_TAG]
      );
      await logisticsProbeClient.query('SAVEPOINT p4p6_parcel_cost');
      try{
        const changed=await logisticsProbeClient.query(
          "UPDATE order_item_real_cost_allocations SET parcel_id=$2 "+
          "WHERE order_id=$1 AND order_item_id=$3 AND cost_type='freight' "+
          "AND is_actual=TRUE RETURNING id",
          [orderId,unlinkedParcelId,itemId]
        );
        expect(changed.rowCount).toBe(1);
        const {collectP4P6Canonical}=require('../../scripts/research/p4-p6-canonical-collector');
        const poisoned=await collectP4P6Canonical(logisticsProbeClient,{
          item:{order_id:orderId,order_item_id:itemId},
        });
        // Header-only legacy parcel is a valid ORDER member, but does
        // not actually contain this item and is absent from the shipment.
        expect(poisoned.diagnostics.contradictions)
          .toContain('LOGISTICS_COST_PARCEL_NOT_CONTAINING_ITEM');
        expect(poisoned.diagnostics.contradictions)
          .toContain('LOGISTICS_COST_SHIPMENT_PARCEL_UNLINKED');
        foreignParcelCostProbe={outcome:'UNLINKED_LOGISTICS_COST_PARCEL_REPRODUCED',
          hypotheses:poisoned.diagnostics.contradictions};
      }catch(error){
        if(['23514','23503','P0001'].includes(error.code)){
          await logisticsProbeClient.query('ROLLBACK TO SAVEPOINT p4p6_parcel_cost');
          foreignParcelCostProbe={outcome:'SQL_LOGISTICS_COST_PARCEL_GUARD',
            sqlstate:error.code};
        }else throw error;
      }
    }finally{
      await logisticsProbeClient.query('ROLLBACK');
      logisticsProbeClient.release();
    }
    expect(foreignParcelCostProbe).toBeTruthy();
    const restoredFreight=await one(
      "SELECT parcel_id FROM order_item_real_cost_allocations "+
      "WHERE order_id=$1 AND order_item_id=$2 AND cost_type='freight' "+
      "AND is_actual=TRUE LIMIT 1",[orderId,itemId]
    );
    expect(restoredFreight.parcel_id).toBe(parcelId);
    expect(await one('SELECT id FROM parcels WHERE id=$1',[unlinkedParcelId]))
      .toBeUndefined();

    // P5->P6 real PostgreSQL counterexample: a cash collection recorded
    // against a Stripe-only order is a cross-rail custody contradiction,
    // even while the margin owner considers payment costs separately.
    // This is NOT a service-writer attack; it checks persisted DB integrity.
    const fundsProbeClient=await db.getClient();
    let crossRailFundsProbe;
    try{
      await fundsProbeClient.query('BEGIN');
      await fundsProbeClient.query('SAVEPOINT p5p6_cross_rail');
      try{
        await fundsProbeClient.query(
          'INSERT INTO cash_collections(order_id,amount_kmf,collected_by,relais_id) '+
          'VALUES($1,$2,$3,$4)',[orderId,25000,userId,relaisId]
        );
        const {collectP5P6Canonical}=require('../../scripts/research/p5-p6-canonical-collector');
        const poisoned=await collectP5P6Canonical(fundsProbeClient,{
          item:{order_id:orderId},
        });
        expect(poisoned.diagnostics.contradictions)
          .toContain('STRIPE_ORDER_HAS_CASH_COLLECTION');
        expect(poisoned.facts.collection_kmf).toBe(25000);
        crossRailFundsProbe={outcome:'STRIPE_ORDER_CASH_COLLECTION_ACCEPTED',
          hypothesis:'STRIPE_ORDER_HAS_CASH_COLLECTION'};
      }catch(error){
        if(['23514','23503','P0001'].includes(error.code)){
          await fundsProbeClient.query('ROLLBACK TO SAVEPOINT p5p6_cross_rail');
          crossRailFundsProbe={outcome:'SQL_CROSS_RAIL_COLLECTION_GUARD',
            sqlstate:error.code};
        }else throw error;
      }
    }finally{
      await fundsProbeClient.query('ROLLBACK');
      fundsProbeClient.release();
    }
    expect(crossRailFundsProbe).toBeTruthy();
    expect((await q('SELECT id FROM cash_collections WHERE order_id=$1',[orderId])).rows)
      .toEqual([]);

    // P6->P1: insert an unattributed ACTIVATE *event*, not an actual buyer
    // price. The adapter must call it a suspect orphan audit trace, not
    // pretend there was an actual market-local activation. Transaction rolled back.
    const priceProbeClient=await db.getClient();
    let unauditedPriceProbe;
    try{
      await priceProbeClient.query('BEGIN');
      await priceProbeClient.query('SAVEPOINT p6p1_orphan_event');
      try{
        const native=(await priceProbeClient.query(
          'SELECT currency FROM markets WHERE id=$1',[marketId])).rows[0].currency;
        await priceProbeClient.query(
          "INSERT INTO product_market_price_draft_events "+
          "(market_id,product_id,action,old_amount,new_amount,currency,old_status,"+
          "new_status,reason,source,actor_id) "+
          "VALUES($1,$2,'ACTIVATE',25000,25000,$3,"+
          "'LOCAL_AUTHORIZED_PENDING_CUTOVER','LOCAL_ACTIVE',"+
          "'Research unattributed event','research_negative',NULL)",
          [marketId,productId,native]
        );
        const {collectP6P1Canonical}=require('../../scripts/research/p6-p1-canonical-collector');
        const bad=await collectP6P1Canonical(priceProbeClient,{
          item:{order_id:orderId,product_id:productId},
          market:{id:marketId,code:'KM',currency:native},
        });
        expect(bad.diagnostics.contradictions)
          .toContain('UNATTRIBUTED_PRICE_ACTIVATE_EVENT');
        unauditedPriceProbe={outcome:'PRICE_ACTIVATE_EVENT_WITHOUT_ACTOR_ACCEPTED',
          hypothesis:'UNATTRIBUTED_PRICE_ACTIVATE_EVENT'};
      }catch(error){
        if(['23514','23503','23502','P0001'].includes(error.code)){
          await priceProbeClient.query('ROLLBACK TO SAVEPOINT p6p1_orphan_event');
          unauditedPriceProbe={outcome:'SQL_PRICE_ACTIVATION_EVENT_GUARD',sqlstate:error.code};
        }else throw error;
      }
    }finally{
      await priceProbeClient.query('ROLLBACK');priceProbeClient.release();
    }
    expect(unauditedPriceProbe).toBeTruthy();
    expect((await q("SELECT id FROM product_market_price_draft_events "+
      "WHERE market_id=$1 AND product_id=$2 AND source='research_negative'",
      [marketId,productId])).rows).toEqual([]);

    // P7->P5: a never-active DRAFT assignment is NOT an eligible country
    // settlement mandate. If SQL admits a READY settlement anyway, the
    // cross-process observer must detect the disagreement with the owner.
    const settlementProbeClient=await db.getClient();
    const draftAssignmentId=uuid();let draftSettlementProbe;
    try{
      await settlementProbeClient.query('BEGIN');
      await settlementProbeClient.query(
        "INSERT INTO market_operating_assignments(id,market_id,status) "+
        "VALUES($1,$2,'DRAFT')",[draftAssignmentId,marketId]);
      await settlementProbeClient.query('SAVEPOINT p7p5_draft_settlement');
      try{
        const native=(await settlementProbeClient.query(
          'SELECT currency FROM markets WHERE id=$1',[marketId])).rows[0].currency;
        await settlementProbeClient.query(
          "INSERT INTO market_settlements "+
          "(market_id,assignment_id,amount,currency,source,status,attested_by) "+
          "VALUES($1,$2,10000,$3,'CENTRAL_ATTESTATION','READY',$4)",
          [marketId,draftAssignmentId,native,userId]
        );
        const {collectP7P5Canonical}=require('../../scripts/research/p7-p5-canonical-collector');
        const currentPlane=await require('../../services/market-control-plane')
          .getControlPlane(settlementProbeClient,'KM');
        const bad=await collectP7P5Canonical(settlementProbeClient,{plane:currentPlane});
        expect(bad.diagnostics.contradictions)
          .toContain('NEW_READY_SETTLEMENT_ON_INACTIVE_ASSIGNMENT');
        draftSettlementProbe={outcome:'DRAFT_ASSIGNMENT_SETTLEMENT_ACCEPTED',
          hypothesis:'NEW_READY_SETTLEMENT_ON_INACTIVE_ASSIGNMENT'};
      }catch(error){
        if(['23514','23503','23502','P0001'].includes(error.code)){
          await settlementProbeClient.query('ROLLBACK TO SAVEPOINT p7p5_draft_settlement');
          draftSettlementProbe={outcome:'SQL_DRAFT_SETTLEMENT_GUARD',sqlstate:error.code};
        }else throw error;
      }
    }finally{
      await settlementProbeClient.query('ROLLBACK');settlementProbeClient.release();
    }
    expect(draftSettlementProbe).toBeTruthy();
    expect((await q("SELECT id FROM market_operating_assignments WHERE id=$1",
      [draftAssignmentId])).rows).toEqual([]);

    const wiredSummary={schema:wiredP1P7.schema,execution:wiredP1P7.execution,
      context:wiredP1P7.context,wired_edges:wiredP1P7.wired_edges,
      totals:wiredP1P7.totals,owner_read_errors:wiredP1P7.owner_read_errors,
      purchasing_hub:wiredP1P7.purchasing_hub,
      physical_handoff:wiredP1P7.physical_handoff,
      customer_finance:wiredP1P7.customer_finance,
      supplier_cost:wiredP1P7.supplier_cost,
      logistics_cost:wiredP1P7.logistics_cost,
      funds_cost:wiredP1P7.funds_cost,
      price_review:wiredP1P7.price_review,
      country_settlement:wiredP1P7.country_settlement,
      unaudited_price_probe:unauditedPriceProbe,
      draft_settlement_probe:draftSettlementProbe,
      cross_rail_funds_probe:crossRailFundsProbe,
      foreign_parcel_logistics_cost_probe:foreignParcelCostProbe,
      foreign_cost_allocation_probe:foreignCostProbe,
      unpaid_closure_probe:unpaidClosureProbe,
      wrong_relay_probe:relayProbe,
      boundaries:wiredP1P7.boundaries.filter(b=>wiredP1P7.wired_edges.includes(b.id)),
      stagingCertified:false};
    console.log('FP_P1_P7_CANONICAL_WIRING '+JSON.stringify(wiredSummary));

    // Stronger second A/B: attempt a real SQL substitution using a second
    // valid SKU on a transaction-bound client. The canonical purchase-line
    // immutability guard must reject it. Entire probe is ROLLED BACK.
    const auditClient = await db.getClient();
    let mutationRejected = false;
    let mutationCode = null;
    let mutationMessage = null;
    try {
      await auditClient.query('BEGIN');
      const otherSku = uuid();
      await auditClient.query(
        `INSERT INTO product_skus(id,product_id,sku,stock,variant_combo)
         VALUES($1,$2,$3,5,$4::jsonb)`,
        [otherSku,productId,'FP-ALT-'+RUN_TAG,JSON.stringify({size:'ALT'})]
      );
      await auditClient.query('SAVEPOINT fp_purchase_sku');
      try {
        await auditClient.query(
          'UPDATE purchase_lines SET product_sku_id=$2 WHERE id=$1',
          [lineId,otherSku]
        );
      } catch(error) {
        mutationRejected=true;
        mutationCode=error.code;
        mutationMessage=error.message;
        await auditClient.query('ROLLBACK TO SAVEPOINT fp_purchase_sku');
      }
      // Evaluate after real attempted write, while still in the transaction.
      const during=await collectGoldenTrail(auditClient,orderId);
      expect(during.issues).toEqual([]);
      expect(mutationRejected).toBe(true);
      expect(mutationCode).toBe('23514');
      expect(mutationMessage).toContain('purchase_line_frozen');
    } finally {
      await auditClient.query('ROLLBACK');
      auditClient.release();
    }
    const afterProbe=await collectGoldenTrail(db,orderId);
    expect(afterProbe.digest).toBe(identityTrail.digest);

    // Tamper a COPY of the observation only — no SQL mutation. This tests
    // the scanner's independent oracle, not exploitability of a route.
    const corrupted = analyzeGoldenTrail({
      order:{id:orderId,market_id:marketId},
      items:[{id:itemId,order_id:orderId,sku_id:skuId,product_id:productId}],
      purchaseLines:[{id:lineId,order_item_id:itemId,product_sku_id:uuid(),
        purchase_order_id:poId,supplier_id:supplierId,po_order_id:null,po_supplier_id:supplierId}],
      executionLines:[{purchase_line_id:lineId,supplier_execution_order_id:executionOrderId,purchase_order_id:poId}],
      supplierPayments:[{id:supplierPaymentId}],
      fulfillments:[{id:fulfillmentId}],
      allocations:[{id:allocationId,order_id:orderId,order_item_id:itemId,purchase_line_id:lineId,
        product_sku_id:skuId,purchase_order_id:poId,market_id:marketId,supplier_id:supplierId}],
      placements:[{id:uuid(),allocation_id:allocationId,physical_unit_id:hubUnitId}],
      parcels:[{id:uuid(),parcel_id:parcelId,order_item_id:itemId,product_id:productId,carrier_order_id:orderId}],
      scans:[{id:scanId,order_id:orderId,parcel_id:parcelId}],
    });
    expect(corrupted.issues.map(x=>x.code)).toEqual(expect.arrayContaining([
      'PURCHASE_SKU_SUBSTITUTION','HUB_ALLOCATION_SKU_MISMATCH',
    ]));
    const evidence = {schema:identityTrail.schema,level:'L4 isolated persisted Golden fixture',
      order_reference:ORDER_REF,canonical_order_id:orderId,
      checkpoint:'FINANCIAL_CLOSE_MATCHED',
      po_shape:FP_GOLDEN_PO_SHAPE,
      persisted_po_shape:actualPoShape,
      header_carries_order_item:!!persistedPoForm.order_item_id,
      pre_submission:unsubmittedPoProof,
      pre_submission_hub_probe:preSubmissionHubProbe,
      p1_p7_wiring:wiredSummary,
      identity_status:identityTrail.status,
      progressive_checkpoints:stageProofs,
      verified_counts:Object.fromEntries(Object.entries(identityTrail.observed)
        .filter(([key,value])=>Array.isArray(value)).map(([key,value])=>[key,value.length])),
      perturbation:'IN_MEMORY_SKU_REPLACEMENT_AND_SQL_SKU_UPDATE_ATTEMPT',
      real_sql_mutation_rejected:mutationRejected,
      real_sql_guard_code:mutationCode,
      perturbation_detected:corrupted.issues.map(x=>x.code),
      no_staging_or_external_http:true,
      fingerprint:identityTrail.digest};
    console.log('FP_GOLDEN_IDENTITY_TRAIL '+JSON.stringify(evidence));
    if(process.env.FP_IDENTITY_OUTPUT){
      require('node:fs').writeFileSync(process.env.FP_IDENTITY_OUTPUT,JSON.stringify(evidence,null,2)+'\n');
    }
  });
});
