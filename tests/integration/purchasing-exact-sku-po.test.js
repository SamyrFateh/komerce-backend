'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * PREUVE MODEL_SIMULATION_READY — raccord vente → achat exact.
 *
 * Ce test utilise une vraie Postgres et le vrai trigger Purchasing. Il crée un
 * produit avec DEUX SKU fournisseur, vend explicitement le SKU B, laisse un
 * product_suppliers.supplier_sku volontairement générique, puis exige que la
 * Purchase Order snapshotte le SKU B, sa Supplier Order Identity exacte et la
 * monnaie native de sa Canonical Unit.
 *
 * Le prix product-level historique n'est pas une autorité pour un SKU/SOI
 * canonique : la preuve attend 29.90 PLN sur la PO et unit_price_aed = NULL.
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('Purchasing exact SKU PO (REAL_DB) — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const db = require('../../db');
  const { triggerPurchasing } = require('../../services/purchasing-trigger-service');

  const TAG = `itest-exact-po-${Date.now()}`;
  const created = { orderIds: [], productIds: [], supplierIds: [], relaisIds: [], marketIds: [] };

  async function resolveKmMarket() {
    let { rows: [market] } = await db.query(
      `SELECT id FROM markets WHERE code = 'KM' LIMIT 1`
    );
    if (market) return market;

    const inserted = await db.query(
      `INSERT INTO markets (code, name, currency, minor_unit, is_active)
       VALUES ('KM','Comores','KMF',0,true)
       ON CONFLICT (code) DO NOTHING
       RETURNING id`
    );
    market = inserted.rows[0];
    if (market) created.marketIds.push(market.id);

    if (!market) {
      ({ rows: [market] } = await db.query(`SELECT id FROM markets WHERE code = 'KM' LIMIT 1`));
    }
    if (!market) throw new Error('Impossible de résoudre le marché KM pour la fixture REAL_DB');
    return market;
  }

  async function bindCanonicalObservation(observationId, grain, canonicalEntityId) {
    const { rows: [decision] } = await db.query(
      `INSERT INTO sourcing_resolution_decisions
         (decision_type, grain, observation_id, canonical_entity_id,
          actor_type, actor_ref, rationale, evidence_snapshot)
       VALUES ('LINK',$1,$2,$3,'system',$4,$5,'{}'::jsonb)
       RETURNING decision_id`,
      [grain, observationId, canonicalEntityId, 'itest-exact-sku-po', `${TAG} canonical fixture`]
    );
    await db.query(
      `INSERT INTO sourcing_resolution_bindings
         (observation_id, grain, canonical_entity_id, asserted_by_decision_id)
       VALUES ($1,$2,$3,$4)`,
      [observationId, grain, canonicalEntityId, decision.decision_id]
    );
  }

  async function seedCanonicalSupplierMoney(product, identity) {
    const sourceId = `api:aliexpress:${TAG}`;
    const supplierProductRef = `${TAG}-supplier-product`;
    const offerRef = `${TAG}-offer`;
    const unitRef = '14:Black;5:M';

    const { rows: [catalogImport] } = await db.query(
      `INSERT INTO supplier_catalog_imports
         (supplier_name, source_type, total_items, notes)
       VALUES ($1,'api',1,$2)
       RETURNING id`,
      [`${TAG} AliExpress`, `${TAG} canonical native-money fixture`]
    );

    await db.query(
      `INSERT INTO sourcing_candidates
         (import_id, supplier_name, supplier_product_id, product_name,
          purchase_price, currency, state, product_id)
       VALUES ($1,$2,$3,$4,29.90,'PLN','imported_to_catalog',$5)`,
      [catalogImport.id, `${TAG} AliExpress`, supplierProductRef, `${TAG} source product`, product.id]
    );

    await db.query(
      `INSERT INTO sourcing_sources
         (source_id, adapter_type, acquisition, continuity, status)
       VALUES ($1,'aliexpress','pull','recurring','active')`,
      [sourceId]
    );

    const { rows: [capture] } = await db.query(
      `INSERT INTO sourcing_captures
         (source_id, status, completed_at, stats)
       VALUES ($1,'complete',NOW(),$2::jsonb)
       RETURNING capture_id`,
      [sourceId, JSON.stringify({ import_id: catalogImport.id })]
    );

    const { rows: [productObservation] } = await db.query(
      `INSERT INTO sourcing_observations
         (capture_id, grain, source_ref, observed_at, normalized, raw_fragment)
       VALUES ($1,'product',$2,NOW(),$3::jsonb,$4::jsonb)
       RETURNING observation_id`,
      [capture.capture_id, supplierProductRef,
        JSON.stringify({ title: `${TAG} source product` }), JSON.stringify({})]
    );

    const { rows: [offerObservation] } = await db.query(
      `INSERT INTO sourcing_observations
         (capture_id, grain, source_ref, parent_observation_id,
          observed_at, normalized, raw_fragment)
       VALUES ($1,'offer',$2,$3,NOW(),$4::jsonb,$5::jsonb)
       RETURNING observation_id`,
      [capture.capture_id, offerRef, productObservation.observation_id,
        JSON.stringify({ purchase_price: 29.9, currency: 'PLN' }), JSON.stringify({})]
    );

    const { rows: [unitObservation] } = await db.query(
      `INSERT INTO sourcing_observations
         (capture_id, grain, source_ref, parent_observation_id,
          observed_at, normalized, raw_fragment)
       VALUES ($1,'unit',$2,$3,NOW(),$4::jsonb,$5::jsonb)
       RETURNING observation_id`,
      [capture.capture_id, unitRef, offerObservation.observation_id,
        JSON.stringify({
          supplier_unit_ref: unitRef,
          supplier_sku: 'AE-BLACK-M',
          purchase_price: 29.9,
          currency: 'PLN',
          stock_available: 20,
          availability: 'available',
          is_active: true,
          supplier_order_identity: identity,
        }),
        JSON.stringify({})]
    );

    const { rows: [canonicalProduct] } = await db.query(
      `INSERT INTO sourcing_canonical_entities (grain)
       VALUES ('product') RETURNING canonical_entity_id`
    );
    const { rows: [canonicalOffer] } = await db.query(
      `INSERT INTO sourcing_canonical_entities (grain, parent_entity_id)
       VALUES ('offer',$1) RETURNING canonical_entity_id`,
      [canonicalProduct.canonical_entity_id]
    );
    const { rows: [canonicalUnit] } = await db.query(
      `INSERT INTO sourcing_canonical_entities (grain, parent_entity_id)
       VALUES ('unit',$1) RETURNING canonical_entity_id`,
      [canonicalOffer.canonical_entity_id]
    );

    await bindCanonicalObservation(
      productObservation.observation_id, 'product', canonicalProduct.canonical_entity_id
    );
    await bindCanonicalObservation(
      offerObservation.observation_id, 'offer', canonicalOffer.canonical_entity_id
    );
    await bindCanonicalObservation(
      unitObservation.observation_id, 'unit', canonicalUnit.canonical_entity_id
    );

    await db.query(
      `INSERT INTO sourcing_canonical_entity_refs
         (canonical_entity_id, source_id, ref_kind, ref_value)
       VALUES ($1,$2,'supplier_unit_ref',$3)`,
      [canonicalUnit.canonical_entity_id, sourceId, unitRef]
    );

    return { canonicalUnitId: canonicalUnit.canonical_entity_id };
  }

  async function seedFixture() {
    const market = await resolveKmMarket();

    const { rows: [relais] } = await db.query(
      `INSERT INTO relais (name, agent_name, phone, address, island, market_id, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING id`,
      [`${TAG} relais`, `${TAG} agent`, '+2693999999', 'ITest Moroni', 'Ngazidja', market.id]
    );
    created.relaisIds.push(relais.id);

    const { rows: [product] } = await db.query(
      `INSERT INTO products (name, price_kmf, stock, is_active, inventory_model)
       VALUES ($1,10000,0,true,'SKU') RETURNING id`,
      [`${TAG} produit`]
    );
    created.productIds.push(product.id);

    const { rows: [supplier] } = await db.query(
      `INSERT INTO suppliers (name, platform, auto_order, is_active)
       VALUES ($1,'aliexpress',false,true) RETURNING id`,
      [`${TAG} AliExpress`]
    );
    created.supplierIds.push(supplier.id);

    await db.query(
      `INSERT INTO product_suppliers
         (product_id, supplier_id, supplier_sku, supplier_price_aed,
          supplier_url, priority, is_active)
       VALUES ($1,$2,'GENERIC-PRODUCT-SKU',NULL,'https://example.invalid/product',1,true)`,
      [product.id, supplier.id]
    );

    const identityA = {
      provider: 'aliexpress', version: 1,
      payload: { sku_attr: '14:Red;5:L' },
    };
    const identityB = {
      provider: 'aliexpress', version: 1,
      payload: { sku_attr: '14:Black;5:M' },
    };

    await db.query(
      `INSERT INTO product_skus
         (product_id, sku, variant_combo, stock, is_active, source,
          supplier_sku, supplier_unit_ref, supplier_order_identity)
       VALUES ($1,'K-RED-L',$2::jsonb,20,true,'SUPPLIER',
               'AE-RED-L','14:Red;5:L',$3::jsonb)`,
      [product.id, JSON.stringify({ color: 'Red', size: 'L' }), JSON.stringify(identityA)]
    );

    const { rows: [skuB] } = await db.query(
      `INSERT INTO product_skus
         (product_id, sku, variant_combo, stock, is_active, source,
          supplier_sku, supplier_unit_ref, supplier_order_identity)
       VALUES ($1,'K-BLACK-M',$2::jsonb,20,true,'SUPPLIER',
               'AE-BLACK-M','14:Black;5:M',$3::jsonb)
       RETURNING id`,
      [product.id, JSON.stringify({ color: 'Black', size: 'M' }), JSON.stringify(identityB)]
    );

    const { canonicalUnitId } = await seedCanonicalSupplierMoney(product, identityB);

    const ref = `ITEST-EXACT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const { rows: [order] } = await db.query(
      `INSERT INTO orders
         (reference, relais_id, market_id, total_kmf, payment_mode, payment_status, status)
       VALUES ($1,$2,$3,10000,'cash_relais','paid','ordered') RETURNING id, reference`,
      [ref, relais.id, market.id]
    );
    created.orderIds.push(order.id);

    const { rows: [orderItem] } = await db.query(
      `INSERT INTO order_items
         (order_id, product_id, quantity, price_kmf, sku_id,
          variant_combo, fulfillment_source)
       VALUES ($1,$2,1,10000,$3,$4::jsonb,'IMPORT')
       RETURNING id`,
      [order.id, product.id, skuB.id, JSON.stringify({ color: 'Black', size: 'M' })]
    );

    return { order, orderItem, skuB, identityB, canonicalUnitId };
  }

  async function cleanup() {
    for (const id of created.orderIds) {
      await db.query('DELETE FROM purchase_orders WHERE order_id = $1', [id]).catch(() => {});
      await db.query('DELETE FROM order_items WHERE order_id = $1', [id]).catch(() => {});
      await db.query('DELETE FROM orders WHERE id = $1', [id]).catch(() => {});
    }
    for (const id of created.productIds) {
      await db.query('DELETE FROM product_suppliers WHERE product_id = $1', [id]).catch(() => {});
      await db.query('DELETE FROM product_skus WHERE product_id = $1', [id]).catch(() => {});
      await db.query('DELETE FROM products WHERE id = $1', [id]).catch(() => {});
    }
    for (const id of created.supplierIds) {
      await db.query('DELETE FROM suppliers WHERE id = $1', [id]).catch(() => {});
    }
    for (const id of created.relaisIds) {
      await db.query('DELETE FROM relais WHERE id = $1', [id]).catch(() => {});
    }
    for (const id of created.marketIds) {
      await db.query('DELETE FROM markets WHERE id = $1', [id]).catch(() => {});
    }
    // sourcing_observations est append-only par doctrine. Le run CI utilise une
    // DB from-scratch jetable ; ces lignes de preuve, namespacées par TAG,
    // restent donc dans l'audit jusqu'à la destruction de la DB de test.
    created.orderIds = [];
    created.productIds = [];
    created.supplierIds = [];
    created.relaisIds = [];
    created.marketIds = [];
  }

  describe('Purchasing — exact sold SKU → exact supplier PO (REAL_DB)', () => {
    afterEach(cleanup);
    afterAll(async () => { await db.pool?.end?.(); });

    it('rachète exactement le SKU vendu et snapshotte sa SOI + monnaie native canonique', async () => {
      const { order, orderItem, skuB, identityB, canonicalUnitId } = await seedFixture();

      const result = await triggerPurchasing(order.id);
      expect(result.purchase_orders).toHaveLength(1);
      expect(result.purchase_orders[0].purchase_order_id).toBeTruthy();

      const { rows: [po] } = await db.query(
        `SELECT order_item_id, product_sku_id, supplier_sku,
                supplier_unit_ref, supplier_order_identity, qty,
                unit_price_aed, supplier_unit_price, supplier_currency,
                supplier_total_price
           FROM purchase_orders
          WHERE id = $1`,
        [result.purchase_orders[0].purchase_order_id]
      );

      expect(po.order_item_id).toBe(orderItem.id);
      expect(po.product_sku_id).toBe(skuB.id);
      expect(po.supplier_sku).toBe('AE-BLACK-M');
      expect(po.supplier_sku).not.toBe('GENERIC-PRODUCT-SKU');
      expect(po.supplier_unit_ref).toBe('14:Black;5:M');
      expect(po.supplier_order_identity).toEqual(identityB);
      expect(po.qty).toBe(1);
      expect(po.unit_price_aed).toBeNull();
      expect(Number(po.supplier_unit_price)).toBe(29.9);
      expect(po.supplier_currency).toBe('PLN');
      expect(Number(po.supplier_total_price)).toBe(29.9);
      expect(canonicalUnitId).toBeTruthy();
    });
  });
}
