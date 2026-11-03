'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration hub-directrice-authorizations-postgres.test.js
 * @brief P04 — deux autorisations distinctes de la directrice (engagement d'achat, paiement fournisseur) : grants attribués/révoqués par l'Admin central, décisions tracées append-only, gardes d'écriture sur la soumission de PO et le paiement fournisseur.
 */

jest.setTimeout(60000);

if (!process.env.DATABASE_URL) {
  describe.skip('hub-directrice-authorizations (needs DATABASE_URL)', () => { test('skipped', () => {}); });
} else {
  const crypto = require('crypto');
  const db = require('../../db');
  const auth = require('../../services/hub-authorization-service');
  const engagement = require('../../services/purchasing-engagement-service');

  const id = () => crypto.randomUUID();
  const q = (sql, params) => db.query(sql, params);
  const tag = `DIR-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  let admin; let directrice; let agent; let km; let supplier; let po; let po2; let relais;

  async function user(role, label) {
    const uid = id();
    await q('INSERT INTO users(id,full_name,email,phone,role) VALUES($1,$2,$3,$4,$5)',
      [uid, `${label} ${tag}`, `${label}-${tag}@komerce.test`.toLowerCase(), `+2693${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`, role]);
    return { id: uid, role };
  }

  async function draftPo(unitPrice) {
    const orderId = id(); const itemId = id(); const productId = id(); const poId = id();
    await q(`INSERT INTO orders(id,user_id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur)
             VALUES($1,$2,$3,$4,$5,'ordered','paid','stripe_eur',10000,20)`, [orderId, admin.id, relais, km, `${tag}-${poId.slice(0, 4)}`]);
    await q(`INSERT INTO products(id,name,price_kmf,cost_kmf,volume_cm3,stock,price_aed,inventory_model) VALUES($1,$2,10000,3000,1000,0,100,'SKU')`, [productId, `Prod ${poId}`]);
    await q('INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf,fulfillment_source) VALUES($1,$2,$3,3,10000,\'IMPORT\')', [itemId, orderId, productId]);
    await q(`INSERT INTO purchase_orders(id,order_id,supplier_id,status,trigger_mode,procurement_hub_ref,market_id,qty,supplier_sku)
             VALUES($1,NULL,$2,'draft','manual','DXB',$3,NULL,NULL)`, [poId, supplier, km]);
    const { rows: [line] } = await q(`INSERT INTO purchase_lines(order_item_id,supplier_id,supplier_sku,quantity,supplier_unit_price,supplier_currency,procurement_hub_ref)
             VALUES($1,$2,$3,3,$4,$5,'DXB') RETURNING id`, [itemId, supplier, `${tag}-S`, unitPrice, unitPrice == null ? null : 'AED']);
    await q('UPDATE purchase_lines SET purchase_order_id=$2 WHERE id=$1', [line.id, poId]);
    return poId;
  }

  beforeAll(async () => {
    // Modèle d'achat unique (369) : le garde de rattachement n'exige l'identité fournisseur exacte qu'aux PO en mode API.
    // Idempotent ; garantit le garde attendu même si la baseline CI (snapshot Railway) porte encore celui de 266.
    await q(require('fs').readFileSync(require('path').join(__dirname, '../../migrations/369_single_purchase_model.sql'), 'utf8'));
    km = (await q("SELECT id FROM markets WHERE code='KM'")).rows[0].id;
    admin = await user('admin', 'admin');
    directrice = await user('agent_hub', 'directrice');
    agent = await user('agent_hub', 'agent');
    relais = id();
    await q("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,$2,'A','+2693000021','R',$3)", [relais, `R-${tag}`, km]);
    supplier = id();
    await q("INSERT INTO suppliers(id,name,platform,is_active) VALUES($1,$2,'local',true)", [supplier, `S ${tag}`]);
    po = await draftPo(10);
    po2 = await draftPo(null);
  });
  afterAll(async () => { await db.pool.end().catch(() => {}); });

  test('seul l\'Admin central attribue et révoque ; la cible doit être un compte Hub', async () => {
    await expect(auth.grant({ userId: directrice.id, authorizationType: 'purchase_commitment', actor: agent })).rejects.toMatchObject({ status: 403, code: 'AUTHORIZATION_ADMIN_REQUIRED' });
    await expect(auth.grant({ userId: admin.id, authorizationType: 'purchase_commitment', actor: admin })).rejects.toMatchObject({ status: 409, code: 'AUTHORIZATION_TARGET_NOT_HUB' });
    await expect(auth.grant({ userId: directrice.id, authorizationType: 'autre', actor: admin })).rejects.toMatchObject({ status: 400 });
  });

  test('sans grant (agent ou admin), aucune décision : les agents n\'acquièrent aucun pouvoir implicite', async () => {
    await expect(auth.decide({ purchaseOrderId: po, authorizationType: 'purchase_commitment', actor: agent, body: { proof_ref: 'P' } })).rejects.toMatchObject({ status: 403, code: 'AUTHORIZATION_GRANT_REQUIRED' });
    await expect(auth.decide({ purchaseOrderId: po, authorizationType: 'purchase_commitment', actor: admin, body: { proof_ref: 'P' } })).rejects.toMatchObject({ status: 403, code: 'AUTHORIZATION_GRANT_REQUIRED' });
  });

  test('une PO préparée n\'est pas un engagement validé : la soumission est refusée tant que la directrice n\'a pas décidé', async () => {
    await expect(engagement.submitPurchaseOrder(po, { actor: agent })).rejects.toMatchObject({ status: 409, code: 'PURCHASE_COMMITMENT_NOT_AUTHORIZED' });
    expect((await q('SELECT status FROM purchase_orders WHERE id=$1', [po])).rows[0].status).toBe('draft');
  });

  test('les deux autorisations sont distinctes : le grant engagement ne vaut pas autorisation de paiement', async () => {
    const g = await auth.grant({ userId: directrice.id, authorizationType: 'purchase_commitment', actor: admin });
    expect((await auth.grant({ userId: directrice.id, authorizationType: 'purchase_commitment', actor: admin })).idempotent_replay).toBe(true);
    expect(g.revoked_at).toBeNull();
    await expect(auth.decide({ purchaseOrderId: po, authorizationType: 'supplier_payment', actor: directrice, body: { proof_ref: 'P', amount: 30, currency: 'AED' } })).rejects.toMatchObject({ status: 403, code: 'AUTHORIZATION_GRANT_REQUIRED' });
    await expect(auth.decide({ purchaseOrderId: po, authorizationType: 'purchase_commitment', actor: directrice, body: {} })).rejects.toMatchObject({ status: 400, code: 'AUTHORIZATION_PROOF_REQUIRED' });
  });

  test('décision d\'engagement tracée (décideur, horodatage, montant dérivé des lignes, pièce) puis soumission possible ; rejeu idempotent ; append-only', async () => {
    const d = await auth.decide({ purchaseOrderId: po, authorizationType: 'purchase_commitment', actor: directrice, body: { proof_ref: 'BC-1' } });
    expect(d).toMatchObject({ decided_by: directrice.id, currency: 'AED', proof_ref: 'BC-1' });
    expect(Number(d.amount)).toBe(30);
    expect(d.decided_at).toBeTruthy();
    expect((await auth.decide({ purchaseOrderId: po, authorizationType: 'purchase_commitment', actor: directrice, body: { proof_ref: 'BC-2' } })).idempotent_replay).toBe(true);
    await expect(q('UPDATE purchase_order_authorizations SET amount = 1 WHERE id=$1', [d.id])).rejects.toThrow(/purchase_order_authorization_immutable/);
    await expect(q('DELETE FROM purchase_order_authorizations WHERE id=$1', [d.id])).rejects.toThrow(/purchase_order_authorization_immutable/);
    await expect(auth.assertCommitmentAuthorized(db, po)).resolves.toBeUndefined();
  });

  test('PO sans prix fournisseur : montant et devise obligatoires dans la décision', async () => {
    await expect(auth.decide({ purchaseOrderId: po2, authorizationType: 'purchase_commitment', actor: directrice, body: { proof_ref: 'P' } })).rejects.toMatchObject({ status: 400, code: 'AUTHORIZATION_AMOUNT_REQUIRED' });
    const d = await auth.decide({ purchaseOrderId: po2, authorizationType: 'purchase_commitment', actor: directrice, body: { proof_ref: 'P', amount: 45, currency: 'aed' } });
    expect(d).toMatchObject({ currency: 'AED' });
  });

  test('paiement fournisseur : refusé sans autorisation, ne découle jamais de la soumission, borné en montant et devise', async () => {
    await expect(auth.assertPaymentAuthorized(db, po, 30, 'AED')).rejects.toMatchObject({ status: 409, code: 'SUPPLIER_PAYMENT_NOT_AUTHORIZED' });
    // PO encore en brouillon : le paiement ne s'autorise pas (et la soumission n'autorise rien).
    await auth.grant({ userId: directrice.id, authorizationType: 'supplier_payment', actor: admin });
    await expect(auth.decide({ purchaseOrderId: po, authorizationType: 'supplier_payment', actor: directrice, body: { proof_ref: 'P', amount: 30, currency: 'AED' } })).rejects.toMatchObject({ status: 409, code: 'PURCHASE_ORDER_NOT_SUBMITTED' });
    await q("UPDATE purchase_orders SET status='notified' WHERE id=$1", [po]);
    await expect(auth.assertPaymentAuthorized(db, po, 30, 'AED')).rejects.toMatchObject({ code: 'SUPPLIER_PAYMENT_NOT_AUTHORIZED' });
    const p = await auth.decide({ purchaseOrderId: po, authorizationType: 'supplier_payment', actor: directrice, body: { proof_ref: 'VIR-1', amount: 30, currency: 'AED' } });
    expect(p).toMatchObject({ authorization_type: 'supplier_payment', decided_by: directrice.id });
    await expect(auth.assertPaymentAuthorized(db, po, 30, 'AED')).resolves.toBeUndefined();
    await expect(auth.assertPaymentAuthorized(db, po, 31, 'AED')).rejects.toMatchObject({ code: 'SUPPLIER_PAYMENT_EXCEEDS_AUTHORIZATION' });
    await expect(auth.assertPaymentAuthorized(db, po, 30, 'USD')).rejects.toMatchObject({ code: 'SUPPLIER_PAYMENT_EXCEEDS_AUTHORIZATION' });
  });

  test('paiement non autorisable sans engagement validé', async () => {
    const po3 = await draftPo(5);
    await q("UPDATE purchase_orders SET status='notified' WHERE id=$1", [po3]);
    await expect(auth.decide({ purchaseOrderId: po3, authorizationType: 'supplier_payment', actor: directrice, body: { proof_ref: 'P', amount: 15, currency: 'AED' } })).rejects.toMatchObject({ status: 409, code: 'PURCHASE_COMMITMENT_REQUIRED' });
  });

  test('révocation : motif obligatoire, le détenteur perd immédiatement le pouvoir, les décisions passées restent', async () => {
    const [g] = (await auth.listGrants({ userId: directrice.id })).filter((x) => x.authorization_type === 'purchase_commitment');
    await expect(auth.revoke({ grantId: g.id, reason: '', actor: admin })).rejects.toMatchObject({ status: 400 });
    await expect(auth.revoke({ grantId: g.id, reason: 'x', actor: agent })).rejects.toMatchObject({ status: 403 });
    await auth.revoke({ grantId: g.id, reason: 'Départ', actor: admin });
    const po4 = await draftPo(2);
    await expect(auth.decide({ purchaseOrderId: po4, authorizationType: 'purchase_commitment', actor: directrice, body: { proof_ref: 'P' } })).rejects.toMatchObject({ status: 403, code: 'AUTHORIZATION_GRANT_REQUIRED' });
    expect((await q("SELECT count(*)::int AS n FROM purchase_order_authorizations WHERE decided_by=$1", [directrice.id])).rows[0].n).toBeGreaterThanOrEqual(2);
    await expect(auth.revoke({ grantId: g.id, reason: 'x', actor: admin })).rejects.toMatchObject({ status: 404 });
  });
}
