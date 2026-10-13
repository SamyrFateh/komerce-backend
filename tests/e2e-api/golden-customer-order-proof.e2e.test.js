'use strict';
/**
 * @test-kind e2e-api
 * @test-runner jest
 * @test-requires postgres
 */
// GOLDEN P0b — CUSTOMER_ORDER_PROVED sur vraie base PostgreSQL de test (L4) : filiation order_items → purchase_lines → PO,
// SKU et unité fournisseur exacts, aucune substitution. Fixture dédiée (journey Golden), aucune donnée staging.
const db = require('../../db');
const { describeE2E, createCleanup, uuid } = require('../helpers/e2eDbKit');
const { createGoldenJourney } = require('../helpers/goldenJourneySetup');
const { projectUpstreamEvidence, GATE } = require('../../services/golden-upstream-evidence');

const gateFor = async (journey) => {
  const productId = (await db.query('SELECT product_id FROM order_items WHERE order_id=$1', [journey.orderId])).rows[0].product_id;
  const report = await projectUpstreamEvidence(db, { productId, marketCode: journey.marketCode, orderReference: journey.reference, fetchImpl: null });
  return report.gates.find((g) => g.key === 'CUSTOMER_ORDER_PROVED');
};

describeE2E('Golden P0b — commande client → achat fournisseur exact', () => {
  const cleanup = createCleanup(db);
  afterAll(async () => cleanup.run());

  async function journey() {
    const j = await createGoldenJourney(db, { marketCode: 'KM' });
    cleanup.trackSql("UPDATE orders SET status='cancelled', updated_at=NOW() WHERE id=$1", [j.orderId]);
    return j;
  }

  test('filiation exacte : porte prouvée', async () => {
    const gate = await gateFor(await journey());
    expect(gate.status).toBe(GATE.PROVED);
    expect(gate.evidence.items[0]).toMatchObject({ sold_quantity: 1, purchased_quantity: 1 });
  });

  test('SKU similaire substitué à la vente (la ligne d’achat garde le SKU sourcé) : ANOMALIE', async () => {
    const j = await journey();
    const productId = (await db.query('SELECT product_id FROM order_items WHERE order_id=$1', [j.orderId])).rows[0].product_id;
    const similar = uuid();
    await db.query(`INSERT INTO product_skus(id,product_id,sku,stock,is_active,source,supplier_sku,supplier_unit_ref,variant_combo)
      VALUES($1,$2,$3,5,true,'SUPPLIER','CJ-SIMILAR',$4,'{"couleur":"rouge"}'::jsonb)`, [similar, productId, `SIMILAR-${similar.slice(0, 8)}`, `VID-SIM-${similar.slice(0, 8)}`]);
    await db.query('UPDATE order_items SET sku_id=$1 WHERE order_id=$2', [similar, j.orderId]);
    const gate = await gateFor(j);
    expect(gate.status).toBe(GATE.ANOMALIE);
    expect(gate.anomalies.join(' ')).toContain('SKU_SUBSTITUTION');
  });

  test('unité fournisseur du SKU différente de celle achetée : ANOMALIE', async () => {
    const j = await journey();
    await db.query(`UPDATE product_skus SET supplier_unit_ref='VID-AUTRE', supplier_order_identity=NULL WHERE id IN (SELECT sku_id FROM order_items WHERE order_id=$1)`, [j.orderId]);
    const gate = await gateFor(j);
    expect(gate.status).toBe(GATE.ANOMALIE);
    expect(gate.anomalies.join(' ')).toContain('SUPPLIER_UNIT_MISMATCH');
  });

  test('achat partiel (quantité vendue supérieure) : NON_PROUVE ; ligne d’achat absente : NON_PROUVE', async () => {
    const j = await journey();
    await db.query('UPDATE order_items SET quantity = 2 WHERE order_id=$1', [j.orderId]);
    const partial = await gateFor(j);
    expect(partial.status).toBe(GATE.NON_PROUVE);
    expect(partial.checks.find((c) => c.key.startsWith('quantity_exactly_covered')).ok).toBe(false);
    const k = await journey();
    // Une ligne d'achat annulée ne couvre rien (les lignes ne se suppriment jamais, elles s'annulent).
    await db.query(`UPDATE purchase_lines SET cancelled_at=NOW(), cancel_reason='e2e' WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id=$1)`, [k.orderId]);
    expect((await gateFor(k)).status).toBe(GATE.NON_PROUVE);
  });

  test('commande inconnue : NON_PROUVE ; projection : dossier jamais complet (synthétique) et empreinte stable', async () => {
    const j = await journey();
    const productId = (await db.query('SELECT product_id FROM order_items WHERE order_id=$1', [j.orderId])).rows[0].product_id;
    const unknown = await projectUpstreamEvidence(db, { productId, marketCode: 'KM', orderReference: 'K-INCONNUE-0', fetchImpl: null });
    expect(unknown.gates.find((g) => g.key === 'CUSTOMER_ORDER_PROVED').status).toBe(GATE.NON_PROUVE);
    const a = await projectUpstreamEvidence(db, { productId, marketCode: 'KM', orderReference: j.reference, fetchImpl: null });
    const b = await projectUpstreamEvidence(db, { productId, marketCode: 'KM', orderReference: j.reference, fetchImpl: null });
    expect(a.dossier.provenance).toBe('SYNTHETIC_GOLDEN_CREATE');
    expect(a.dossier.complete).toBe(false);
    expect(a.dossier.sha256).toBe(b.dossier.sha256);
  });
});
