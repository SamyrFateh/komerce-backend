'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * GOLDEN E2E — Logistics Control Chain.
 *
 * Feature propriétaire : dashboard.
 * Features traversées : orders, purchasing, logistics, customs, decision-signals.
 *
 * Le sujet testé est la projection Control Tower sur des faits canoniques réels
 * persistés en PostgreSQL. Les fixtures écrivent directement les états minimaux,
 * comme les autres E2E Feature First : elles ne prétendent pas rejouer chaque
 * moteur propriétaire déjà certifié séparément.
 *
 * Preuves :
 *   - même commande : ORDER -> PURCHASING -> SUPPLIER -> HUB_RECEIVING
 *     -> HUB_CONTROL -> FORWARDER -> TRANSPORT -> CUSTOMS -> RELAY ;
 *   - exception individuelle : GREEN -> RED -> GREEN puis poursuite ;
 *   - cause structurelle : 3 commandes, même stage + même reason_code => 1 alerte ;
 *   - split : une seule ligne commande, étape gouvernée par la branche la moins avancée ;
 *   - handover : COLLECTED sort de la chaîne active ;
 *   - Order 360 relit exactement la même position canonique.
 */

const { describeE2E, createCleanup, RUN_TAG, tag, uuid } = require('../helpers/e2eDbKit');

jest.setTimeout(90000);

describeE2E('E2E-DASHBOARD — Golden Logistics Control Chain', ({ db }) => {
  const projection = require('../../services/logistics-control-chain-projection');
  const order360 = require('../../services/order-360');

  const userId = uuid();
  const relaisId = uuid();
  const supplierId = uuid();
  const productId = uuid();
  const skuId = uuid();

  const HAPPY_REF = `CTG-${RUN_TAG}-HAPPY`.toUpperCase();
  const SPLIT_REF = `CTG-${RUN_TAG}-SPLIT`.toUpperCase();
  const STRUCTURAL_REFS = [1, 2, 3].map(n => `CTG-${RUN_TAG}-ROOT-${n}`.toUpperCase());
  const HUB_REF = `E2ECT-HU-${RUN_TAG}`.toUpperCase();
  const PARCEL_REF = `E2ECT-P-${RUN_TAG}`.toUpperCase();
  const CUSTOMS_REF = `E2ECT-CUS-${RUN_TAG}`.toUpperCase();
  const SOI = {
    provider: 'noon',
    version: 1,
    payload: { supplier_unit_ref: `UNIT-${RUN_TAG}` },
  };

  let cleanup;
  let marketId;
  let happyOrderId;
  let happyItemId;
  let happyPoId;
  let happyLineId;
  let happyHubUnitId;
  let happyParcelId;

  const q = (sql, params) => db.query(sql, params);
  const one = async (sql, params) => (await q(sql, params)).rows[0];

  async function seedOrder(reference, status = 'confirmed') {
    const id = uuid();
    await q(
      `INSERT INTO orders
         (id, user_id, relais_id, market_id, reference, status, payment_status, payment_mode, total_kmf, total_eur)
       VALUES ($1,$2,$3,$4,$5,$6,'paid','cash_relais',25000,50)`,
      [id, userId, relaisId, marketId, reference, status]
    );
    return id;
  }

  async function snapshot(orderId, reference) {
    return projection.getOrderControlSnapshot({
      id: orderId,
      market_id: marketId,
      reference,
    });
  }

  async function seedSignal(orderId, code, {
    severity = 'critical',
    ownerRole = 'operations',
    summary = code,
  } = {}) {
    const id = uuid();
    await q(
      `INSERT INTO signals
         (id, signal_type, severity, title, summary, owner_role, status, entity_type, entity_id, market_id)
       VALUES ($1,$2,$3,$4,$5,$6,'open','order',$7,$8)`,
      [id, code, severity, summary, summary, ownerRole, orderId, marketId]
    );
    return id;
  }

  beforeAll(async () => {
    cleanup = createCleanup(db);

    const market = await one(`SELECT id FROM markets WHERE code = 'KM' LIMIT 1`);
    if (!market) throw new Error('Golden Control Tower exige le marché canonique KM dans la base E2E');
    marketId = market.id;

    const ordersOfRun = `SELECT id FROM orders WHERE user_id = '${userId}'`;
    const itemsOfRun = `SELECT id FROM order_items WHERE order_id IN (${ordersOfRun})`;

    // HUB allocations/placements sont append-only en production. Comme les E2E
    // Purchasing, le nettoyage désactive les triggers uniquement pour supprimer
    // les fixtures uniques de CE run, puis rétablit immédiatement le mode normal.
    cleanup.trackSql(`
      SET session_replication_role = replica;
      DELETE FROM customs_shipment_parcels
       WHERE parcel_id IN (SELECT id FROM parcels WHERE order_id IN (${ordersOfRun}));
      DELETE FROM customs_shipments WHERE reference = '${CUSTOMS_REF}';
      DELETE FROM signals WHERE entity_id IN (SELECT id::text FROM orders WHERE user_id = '${userId}');
      DELETE FROM hub_physical_unit_placements
       WHERE allocation_id IN (SELECT id FROM hub_purchase_allocations WHERE order_id IN (${ordersOfRun}));
      DELETE FROM hub_purchase_allocations WHERE order_id IN (${ordersOfRun});
      DELETE FROM hub_physical_units WHERE reference = '${HUB_REF}';
      DELETE FROM purchase_lines WHERE order_item_id IN (${itemsOfRun});
      DELETE FROM purchase_orders WHERE supplier_id = '${supplierId}';
      DELETE FROM parcels WHERE order_id IN (${ordersOfRun});
      DELETE FROM order_items WHERE order_id IN (${ordersOfRun});
      DELETE FROM orders WHERE user_id = '${userId}';
      DELETE FROM product_skus WHERE id = '${skuId}';
      DELETE FROM products WHERE id = '${productId}';
      DELETE FROM suppliers WHERE id = '${supplierId}';
      DELETE FROM relais WHERE id = '${relaisId}';
      DELETE FROM users WHERE id = '${userId}';
      SET session_replication_role = origin;
    `);

    await q(
      `INSERT INTO users (id, full_name, email, phone, role)
       VALUES ($1, 'E2E Control Tower Client', $2, $3, 'client')`,
      [userId, `${tag('control-tower')}@komerce.test`, `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`]
    );
    await q(
      `INSERT INTO relais (id, name, agent_name, phone, address, market_id)
       VALUES ($1,$2,'E2E Agent','+269000333','E2E Control Tower',(SELECT id FROM markets WHERE code = 'KM'))`,
      [relaisId, `E2E Control Tower Relais ${tag('relay')}`]
    );
    await q(
      `INSERT INTO suppliers (id, name, platform, contact_phone, auto_order, is_active)
       VALUES ($1,$2,'noon','+971500000099',false,true)`,
      [supplierId, `E2E Control Tower Supplier ${tag('supplier')}`]
    );
    await q(
      `INSERT INTO products (id, name, price_kmf, stock, price_aed, inventory_model)
       VALUES ($1,$2,25000,0,200,'SKU')`,
      [productId, `E2E Control Tower Product ${tag('product')}`]
    );
    await q(
      `INSERT INTO product_skus
         (id, product_id, sku, stock, is_active, source, supplier_sku, supplier_unit_ref, supplier_order_identity)
       VALUES ($1,$2,$3,50,true,'SUPPLIER',$4,$5,$6::jsonb)`,
      [
        skuId,
        productId,
        `K-${tag('sku')}`,
        `SKU-${RUN_TAG}`,
        SOI.payload.supplier_unit_ref,
        JSON.stringify(SOI),
      ]
    );

    happyOrderId = await seedOrder(HAPPY_REF, 'confirmed');
    happyItemId = uuid();
    await q(
      `INSERT INTO order_items
         (id, order_id, product_id, quantity, price_kmf, sku_id, fulfillment_source)
       VALUES ($1,$2,$3,1,25000,$4,'IMPORT')`,
      [happyItemId, happyOrderId, productId, skuId]
    );
  });

  afterAll(async () => {
    if (cleanup) await cleanup.run();
  });

  it('happy path : une même commande traverse les 9 étapes puis sort au handover', async () => {
    let current = await snapshot(happyOrderId, HAPPY_REF);
    expect(current).toMatchObject({
      order_reference: HAPPY_REF,
      stage: 'ORDER',
      health: 'GREEN',
      envelope: { type: 'ORDER', refs: [HAPPY_REF] },
    });

    await q(`UPDATE orders SET status = 'ordered', ordered_at = NOW(), updated_at = NOW() WHERE id = $1`, [happyOrderId]);
    current = await snapshot(happyOrderId, HAPPY_REF);
    expect(current).toMatchObject({ stage: 'PURCHASING', health: 'GREEN' });

    happyPoId = uuid();
    await q(
      `INSERT INTO purchase_orders
         (id, order_id, supplier_id, status, trigger_mode, procurement_hub_ref, qty, supplier_sku)
       VALUES ($1,NULL,$2,'draft','manual','DXB',NULL,NULL)`,
      [happyPoId, supplierId]
    );
    happyLineId = uuid();
    await q(
      `INSERT INTO purchase_lines
         (id, purchase_order_id, order_item_id, supplier_id, product_sku_id,
          supplier_sku, supplier_unit_ref, supplier_order_identity, quantity,
          supplier_unit_price, supplier_currency, procurement_hub_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,1,10,'USD','DXB')`,
      [
        happyLineId,
        happyPoId,
        happyItemId,
        supplierId,
        skuId,
        `SKU-${RUN_TAG}`,
        SOI.payload.supplier_unit_ref,
        JSON.stringify(SOI),
      ]
    );
    await q(
      `UPDATE purchase_orders
          SET status = 'confirmed', supplier_order_id = $2, confirmed_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [happyPoId, `SUP-${RUN_TAG}`]
    );

    current = await snapshot(happyOrderId, HAPPY_REF);
    expect(current).toMatchObject({
      stage: 'SUPPLIER',
      health: 'GREEN',
      envelope: { type: 'PURCHASE_ORDER', refs: [happyPoId] },
    });

    const allocationId = uuid();
    await q(
      `INSERT INTO hub_purchase_allocations
         (id, purchase_order_id, order_id, order_item_id, product_sku_id, supplier_id,
          supplier_unit_ref, supplier_order_identity, quantity, market_id, destination_ref, purchase_line_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,1,$9,$10,$11)`,
      [
        allocationId,
        happyPoId,
        happyOrderId,
        happyItemId,
        skuId,
        supplierId,
        SOI.payload.supplier_unit_ref,
        JSON.stringify(SOI),
        marketId,
        `RELAY:${relaisId}`,
        happyLineId,
      ]
    );
    happyHubUnitId = uuid();
    await q(
      `INSERT INTO hub_physical_units (id, reference, unit_type, state)
       VALUES ($1,$2,'SUPPLIER_PACKAGE','RECEIVED')`,
      [happyHubUnitId, HUB_REF]
    );
    await q(
      `INSERT INTO hub_physical_unit_placements
         (physical_unit_id, allocation_id, quantity, operation_type)
       VALUES ($1,$2,1,'RECEIVE')`,
      [happyHubUnitId, allocationId]
    );
    await q(`UPDATE orders SET status = 'preparation', preparation_at = NOW(), updated_at = NOW() WHERE id = $1`, [happyOrderId]);

    current = await snapshot(happyOrderId, HAPPY_REF);
    expect(current).toMatchObject({
      stage: 'HUB_RECEIVING',
      health: 'GREEN',
      envelope: { type: 'HUB_UNIT', refs: [HUB_REF] },
    });

    await q(`UPDATE hub_physical_units SET state = 'IDENTIFIED' WHERE id = $1`, [happyHubUnitId]);
    current = await snapshot(happyOrderId, HAPPY_REF);
    expect(current).toMatchObject({ stage: 'HUB_CONTROL', health: 'GREEN' });

    // Incident unitaire : health bouge, l'étape et l'identité ne bougent pas.
    const incidentSignal = await seedSignal(happyOrderId, 'hub_non_compliant', {
      ownerRole: 'hub',
      summary: 'Article non conforme au contrôle HUB',
    });
    current = await snapshot(happyOrderId, HAPPY_REF);
    expect(current).toMatchObject({
      stage: 'HUB_CONTROL',
      health: 'RED',
      exception: { code: 'hub_non_compliant', owner_role: 'hub' },
    });

    await q(
      `UPDATE signals SET status = 'resolved', resolved_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [incidentSignal]
    );
    current = await snapshot(happyOrderId, HAPPY_REF);
    expect(current).toMatchObject({ stage: 'HUB_CONTROL', health: 'GREEN', exception: null });

    happyParcelId = uuid();
    await q(
      `INSERT INTO parcels (id, order_id, reference, status, shipped_at)
       VALUES ($1,$2,$3,'shipped',NOW())`,
      [happyParcelId, happyOrderId, PARCEL_REF]
    );
    await q(`UPDATE orders SET status = 'shipped', shipped_at = NOW(), updated_at = NOW() WHERE id = $1`, [happyOrderId]);

    current = await snapshot(happyOrderId, HAPPY_REF);
    expect(current).toMatchObject({
      stage: 'FORWARDER',
      health: 'GREEN',
      envelope: { type: 'PARCEL', refs: [PARCEL_REF] },
    });

    await q(
      `UPDATE parcels SET status = 'in_transit', in_transit_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [happyParcelId]
    );
    await q(`UPDATE orders SET status = 'in_transit', in_transit_at = NOW(), updated_at = NOW() WHERE id = $1`, [happyOrderId]);

    current = await snapshot(happyOrderId, HAPPY_REF);
    expect(current).toMatchObject({ stage: 'TRANSPORT', health: 'GREEN' });

    await q(
      `UPDATE parcels SET status = 'arrived', arrived_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [happyParcelId]
    );
    const customsId = uuid();
    await q(
      `INSERT INTO customs_shipments
         (id, reference, shipment_date, transitaire_name, transport_mode,
          cif_value_kmf, customs_paid_kmf, status, declared_at, market_id)
       VALUES ($1,$2,CURRENT_DATE,'E2E Forwarder','air',25000,2500,'declared',NOW(),$3)`,
      [customsId, CUSTOMS_REF, marketId]
    );
    await q(
      `INSERT INTO customs_shipment_parcels
         (shipment_id, parcel_id, parcel_cif_kmf, parcel_weight_kg, customs_share_kmf, allocation_basis)
       VALUES ($1,$2,25000,1,2500,'by_cif_value')`,
      [customsId, happyParcelId]
    );

    current = await snapshot(happyOrderId, HAPPY_REF);
    expect(current).toMatchObject({ stage: 'CUSTOMS', health: 'GREEN' });

    await q(
      `UPDATE parcels SET status = 'available', available_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [happyParcelId]
    );
    await q(`UPDATE orders SET status = 'available', available_at = NOW(), updated_at = NOW() WHERE id = $1`, [happyOrderId]);

    current = await snapshot(happyOrderId, HAPPY_REF);
    expect(current).toMatchObject({ stage: 'RELAY', health: 'GREEN' });

    // Order 360 consomme le même projecteur : aucune seconde vérité.
    const resolved = await order360.resolveOrder(HAPPY_REF);
    expect(resolved.order).toBeTruthy();
    const detail = await order360.loadOrder360(resolved.order, { includePurchasing: true });
    expect(detail.control_position).toMatchObject({
      stage: 'RELAY',
      health: 'GREEN',
      envelope: { type: 'PARCEL', refs: [PARCEL_REF] },
    });

    // Handover client : la commande n'est plus une opération active.
    await q(
      `UPDATE parcels SET status = 'collected', collected_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [happyParcelId]
    );
    await q(`UPDATE orders SET status = 'collected', collected_at = NOW(), updated_at = NOW() WHERE id = $1`, [happyOrderId]);
    expect(await snapshot(happyOrderId, HAPPY_REF)).toBeNull();
  });

  it('cause structurelle : trois exceptions identiques deviennent un seul signal supérieur', async () => {
    const orderIds = [];
    const signalIds = [];

    for (let i = 0; i < STRUCTURAL_REFS.length; i += 1) {
      const orderId = await seedOrder(STRUCTURAL_REFS[i], 'ordered');
      orderIds.push(orderId);
      signalIds.push(await seedSignal(orderId, 'supplier_payment_blocked', {
        ownerRole: 'finance',
        summary: 'Paiement fournisseur bloqué',
      }));
    }

    let chain = await projection.getControlChain({ market: { id: marketId }, limit: 100 });
    const root = chain.structural_alerts.find(row =>
      row.stage === 'PURCHASING' && row.reason_code === 'supplier_payment_blocked'
    );

    expect(root).toEqual(expect.objectContaining({
      stage: 'PURCHASING',
      health: 'RED',
      reason_code: 'supplier_payment_blocked',
      owner_role: 'finance',
      order_count: 3,
    }));
    expect(new Set(root.order_references)).toEqual(new Set(STRUCTURAL_REFS));

    await q(
      `UPDATE signals
          SET status = 'resolved', resolved_at = NOW(), updated_at = NOW()
        WHERE id = ANY($1::uuid[])`,
      [signalIds]
    );
    chain = await projection.getControlChain({ market: { id: marketId }, limit: 100 });
    expect(chain.structural_alerts.some(row => row.reason_code === 'supplier_payment_blocked')).toBe(false);
  });

  it('split : une seule commande reste sur la branche nécessaire la moins avancée', async () => {
    const orderId = await seedOrder(SPLIT_REF, 'in_transit');
    const slowParcel = uuid();
    const fastParcel = uuid();
    const slowRef = `E2ECT-SLOW-${RUN_TAG}`.toUpperCase();
    const fastRef = `E2ECT-FAST-${RUN_TAG}`.toUpperCase();

    await q(
      `INSERT INTO parcels (id, order_id, reference, status, in_transit_at)
       VALUES ($1,$3,$4,'in_transit',NOW()), ($2,$3,$5,'arrived',NULL)`,
      [slowParcel, fastParcel, orderId, slowRef, fastRef]
    );

    const current = await snapshot(orderId, SPLIT_REF);
    expect(current).toMatchObject({
      order_reference: SPLIT_REF,
      stage: 'TRANSPORT',
      health: 'GREEN',
      split: true,
      envelope: { type: 'PARCEL' },
    });
    expect(new Set(current.envelope.refs)).toEqual(new Set([slowRef, fastRef]));
    expect(new Set(current.lineage.parcels)).toEqual(new Set([slowRef, fastRef]));

    const chain = await projection.getControlChain({ market: { id: marketId }, limit: 100 });
    expect(chain.orders.filter(row => row.order_reference === SPLIT_REF)).toHaveLength(1);
    expect(chain.by_stage.TRANSPORT.filter(row => row.order_reference === SPLIT_REF)).toHaveLength(1);
  });
});
