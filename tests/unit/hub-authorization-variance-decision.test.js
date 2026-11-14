'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @brief L5: achat vendeur réel et écart financier autorisé par la directrice, séparé et immuable.
 */
jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
const auth = require('../../services/hub-authorization-service');
const PO = '00000000-0000-4000-8000-000000000001';
const ADMIN = '00000000-0000-4000-8000-000000000002';
function clientWith({ paid = 20, justified = 40, entries = 2, decision = null, wrong = 0 } = {}) {
  const client = { query: jest.fn(async (sql, args) => {
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (sql.includes('FROM purchase_order_authorizations') && sql.includes("'purchase_commitment'") && sql.includes('IN ('))
      return { rows: [{ authorization_type: 'supplier_payment', amount: '100', currency: 'AED' }, { authorization_type: 'purchase_commitment', amount: '100', currency: 'AED' }] };
    if (sql.includes('FROM purchase_order_authorizations'))
      return { rows: [{ amount: '100', currency: 'AED' }] };
    if (sql.includes('FROM supplier_execution_payments'))
      return { rows: [{ total: String(paid), other_currency: 0 }] };
    if (sql.includes('FROM manual_purchase_executions'))
      return { rows: [{ entries, wrong_currency: wrong, total: String(justified) }] };
    if (sql.includes('FROM purchase_variance_decisions'))
      return { rows: decision ? [{ approved_total: String(decision) }] : [] };
    throw new Error('Unexpected SQL: ' + sql);
  }) };
  return client;
}
describe('L5: garde paiement justifié par vendeur', () => {
  test('un cumul inférieur aux justificatifs passe normalement', async () => {
    const client = clientWith();
    await expect(auth.assertPaymentAuthorized(client, PO, 20, 'AED')).resolves.toBeUndefined();
    expect(client.query.mock.calls.some(([s]) => s.includes('FROM manual_purchase_executions'))).toBe(true);
  });
  test('un cumul supérieur aux achats vendeur refuse sans décision distincte', async () => {
    await expect(auth.assertPaymentAuthorized(clientWith(), PO, 21, 'AED'))
      .rejects.toMatchObject({ code: 'SUPPLIER_PAYMENT_EXCEEDS_JUSTIFIED_TOTAL' });
  });
  test('une décision signée plafonne le cumul sans dépasser autorisation initiale', async () => {
    await expect(auth.assertPaymentAuthorized(clientWith({ decision: 70 }), PO, 50, 'AED')).resolves.toBeUndefined();
    await expect(auth.assertPaymentAuthorized(clientWith({ decision: 70 }), PO, 51, 'AED'))
      .rejects.toMatchObject({ code: 'SUPPLIER_PAYMENT_EXCEEDS_JUSTIFIED_TOTAL' });
    await expect(auth.assertPaymentAuthorized(clientWith({ decision: 110 }), PO, 81, 'AED'))
      .rejects.toMatchObject({ code: 'SUPPLIER_PAYMENT_EXCEEDS_AUTHORIZATION' });
  });
  test('devise de justificatif différente -> refus même si cap restant', async () => {
    await expect(auth.assertPaymentAuthorized(clientWith({ wrong: 1 }), PO, 1, 'AED'))
      .rejects.toMatchObject({ code: 'SUPPLIER_PAYMENT_JUSTIFICATION_CURRENCY_MISMATCH' });
  });
  test('les parcours automatiques sans achats manuels conservent leur plafond historique', async () => {
    await expect(auth.assertPaymentAuthorized(clientWith({ entries: 0 }), PO, 70, 'AED')).resolves.toBeUndefined();
  });
});
function decisionDb({ grant = true, existing = null, justified = 40, entries = 2, cap = 100 } = {}) {
  const client = { query: jest.fn(async (sql) => {
    if (sql.includes('FROM purchase_orders')) return { rows: [{ id: PO }] };
    if (sql.includes('FROM hub_authorization_grants')) return { rows: grant ? [{ '?column?': 1 }] : [] };
    if (sql.includes('FROM purchase_order_authorizations')) return { rows: [{ amount: String(cap), currency: 'AED' }] };
    if (sql.includes('FROM manual_purchase_executions')) return { rows: [{ entries, total: String(justified) }] };
    if (sql.includes('FROM purchase_variance_decisions')) return { rows: existing ? [existing] : [] };
    if (sql.includes('INSERT INTO purchase_variance_decisions')) return { rows: [{ id: 'decision-1', approved_total: '70', currency: 'AED' }] };
    throw new Error('Unexpected SQL ' + sql);
  }) };
  return { withTransaction: (fn) => fn(client), client };
}
const body = { currency: 'AED', approved_total: 70, reason: 'Ajustement vendeur documenté', proof_ref: 'PJ-123' };
describe('L5: décision indépendante de la directrice Hub', () => {
  test('détenteur de délégation paiement valide une preuve append-only', async () => {
    const db = decisionDb();
    const decision = await auth.decideVariance({ purchaseOrderId: PO, actor: { id: ADMIN, role: 'agent_hub' }, body }, db);
    expect(decision.id).toBe('decision-1');
    expect(db.client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO purchase_variance_decisions'))).toBe(true);
  });
  test('absence de délégation ou de preuve refuse avant écriture', async () => {
    await expect(auth.decideVariance({ purchaseOrderId: PO, actor: { id: ADMIN }, body }, decisionDb({ grant: false })))
      .rejects.toMatchObject({ code: 'AUTHORIZATION_GRANT_REQUIRED' });
    await expect(auth.decideVariance({ purchaseOrderId: PO, actor: { id: ADMIN }, body: { ...body, proof_ref: '' } }, decisionDb()))
      .rejects.toMatchObject({ code: 'PURCHASE_VARIANCE_PROOF_REQUIRED' });
  });
  test('réémission même décision idempotente, modification impossible', async () => {
    const existing = { approved_total: '70', currency: 'AED', reason: body.reason, proof_ref: body.proof_ref };
    const db = decisionDb({ existing });
    const replay = await auth.decideVariance({ purchaseOrderId: PO, actor: { id: ADMIN }, body }, db);
    expect(replay.idempotent_replay).toBe(true);
    expect(db.client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO purchase_variance_decisions'))).toBe(false);
    await expect(auth.decideVariance({ purchaseOrderId: PO, actor: { id: ADMIN }, body: { ...body, approved_total: 80 } }, db))
      .rejects.toMatchObject({ code: 'PURCHASE_VARIANCE_ALREADY_DECIDED' });
  });
  test('montant approuvé ne peut dépasser autorisation de paiement', async () => {
    await expect(auth.decideVariance({ purchaseOrderId: PO, actor: { id: ADMIN }, body }, decisionDb({ cap: 60 })))
      .rejects.toMatchObject({ code: 'SUPPLIER_PAYMENT_EXCEEDS_AUTHORIZATION' });
  });
});
