/**
 * @komerce-arch
 * @role          hub-authorization-service
 * @domain        purchasing
 * @layer         service
 * @criticality   critical
 * @inputs        user_id, authorization_type, purchase_order_id, proof_ref
 * @outputs       hub_authorization_grants, purchase_order_authorizations
 * @depends       db
 * @used-by       routes/purchasing.js, services/purchasing-engagement-service.js, services/supplier-payment-orchestrator.js
 * @db-read       hub_authorization_grants, purchase_lines, purchase_orders, purchase_order_authorizations, users
 * @db-write      hub_authorization_grants, purchase_order_authorizations
 * @db-txn        owns_transaction
 * @doctrine      two_distinct_directrice_authorizations, no_implicit_power, append_only_decisions
 * @impact-areas  purchasing, finance
 * @version       2026-11
 */
'use strict';

const db = require('../db');

const TYPES = Object.freeze(['purchase_commitment', 'supplier_payment']);

class HubAuthorizationError extends Error {
  constructor(status, code, message, extra = {}) { super(message); this.status = status; this.code = code; Object.assign(this, extra); }
}
const fail = (status, code, message, extra) => { throw new HubAuthorizationError(status, code, message, extra); };
const UUID = /^[0-9a-f-]{36}$/i;

function requireType(type) {
  if (!TYPES.includes(type)) fail(400, 'AUTHORIZATION_TYPE_INVALID', `authorization_type doit valoir ${TYPES.join(' ou ')}`);
}
function requireAdmin(actor) {
  if (!actor || !actor.id || actor.role !== 'admin') fail(403, 'AUTHORIZATION_ADMIN_REQUIRED', 'Seul l\'Admin central attribue ou révoque ces autorisations');
}

/** L'Admin central attribue une autorisation à un compte Hub (agent_hub). Idempotent : un grant actif existant est renvoyé. */
async function grant({ userId, authorizationType, actor }, database = db) {
  requireAdmin(actor);
  requireType(authorizationType);
  if (typeof userId !== 'string' || !UUID.test(userId)) fail(400, 'AUTHORIZATION_USER_INVALID', 'user_id invalide');
  return database.withTransaction(async (client) => {
    const { rows: [user] } = await client.query('SELECT id, role FROM users WHERE id = $1', [userId]);
    if (!user) fail(404, 'AUTHORIZATION_USER_NOT_FOUND', 'Utilisateur introuvable');
    if (user.role !== 'agent_hub') fail(409, 'AUTHORIZATION_TARGET_NOT_HUB', 'Ces autorisations ne s\'attribuent qu\'à un compte Hub');
    const { rows: [existing] } = await client.query(
      'SELECT * FROM hub_authorization_grants WHERE user_id = $1 AND authorization_type = $2 AND revoked_at IS NULL', [userId, authorizationType]);
    if (existing) return { ...existing, idempotent_replay: true };
    const { rows: [row] } = await client.query(
      'INSERT INTO hub_authorization_grants (user_id, authorization_type, granted_by) VALUES ($1,$2,$3) RETURNING *',
      [userId, authorizationType, actor.id]);
    return row;
  });
}

async function revoke({ grantId, reason, actor }, database = db) {
  requireAdmin(actor);
  if (typeof grantId !== 'string' || !UUID.test(grantId)) fail(400, 'AUTHORIZATION_GRANT_INVALID', 'grant_id invalide');
  const why = typeof reason === 'string' ? reason.trim() : '';
  if (!why) fail(400, 'AUTHORIZATION_REVOKE_REASON_REQUIRED', 'Motif de révocation obligatoire');
  const { rows: [row] } = await database.query(
    'UPDATE hub_authorization_grants SET revoked_at = now(), revoked_by = $2, revoke_reason = $3 WHERE id = $1 AND revoked_at IS NULL RETURNING *',
    [grantId, actor.id, why]);
  if (!row) fail(404, 'AUTHORIZATION_GRANT_NOT_ACTIVE', 'Autorisation introuvable ou déjà révoquée');
  return row;
}

async function listGrants({ userId = null, activeOnly = true } = {}, database = db) {
  const { rows } = await database.query(
    `SELECT g.*, u.full_name FROM hub_authorization_grants g JOIN users u ON u.id = g.user_id
      WHERE ($1::uuid IS NULL OR g.user_id = $1) AND (NOT $2 OR g.revoked_at IS NULL) ORDER BY g.granted_at DESC`,
    [userId, activeOnly]);
  return rows;
}

async function hasGrant(client, userId, type) {
  const { rows } = await client.query(
    'SELECT 1 FROM hub_authorization_grants WHERE user_id = $1 AND authorization_type = $2 AND revoked_at IS NULL', [userId, type]);
  return rows.length > 0;
}

async function poAmount(client, po, body) {
  const { rows } = await client.query(
    `SELECT quantity, supplier_unit_price, supplier_currency FROM purchase_lines WHERE purchase_order_id = $1 AND cancelled_at IS NULL`, [po.id]);
  if (!rows.length) fail(409, 'PURCHASE_ORDER_EMPTY', 'PO sans ligne');
  const priced = rows.every((r) => r.supplier_unit_price != null && r.supplier_currency);
  if (priced && new Set(rows.map((r) => r.supplier_currency)).size === 1) {
    const amount = rows.reduce((s, r) => s + Number(r.quantity) * Number(r.supplier_unit_price), 0);
    return { amount, currency: rows[0].supplier_currency };
  }
  const amount = Number(body.amount);
  const currency = typeof body.currency === 'string' ? body.currency.toUpperCase() : '';
  if (!(amount > 0) || !/^[A-Z]{3}$/.test(currency)) {
    fail(400, 'AUTHORIZATION_AMOUNT_REQUIRED', 'Montant et devise requis : les lignes de la PO ne portent pas un prix fournisseur unique');
  }
  return { amount, currency };
}

/** Décision tracée d'une des deux autorisations sur une PO. Le décideur doit détenir le grant ACTIF correspondant. */
async function decide({ purchaseOrderId, authorizationType, actor, body = {} }, database = db) {
  requireType(authorizationType);
  if (typeof purchaseOrderId !== 'string' || !UUID.test(purchaseOrderId)) fail(400, 'PURCHASE_ORDER_INVALID', 'po_id invalide');
  const proof = typeof body.proof_ref === 'string' ? body.proof_ref.trim() : '';
  if (!proof || proof.length > 240) fail(400, 'AUTHORIZATION_PROOF_REQUIRED', 'proof_ref obligatoire (pièce associée)');
  if (!actor || !actor.id) fail(403, 'AUTHORIZATION_GRANT_REQUIRED', 'Authentification requise');
  return database.withTransaction(async (client) => {
    const { rows: [po] } = await client.query('SELECT id, status FROM purchase_orders WHERE id = $1 FOR UPDATE', [purchaseOrderId]);
    if (!po) fail(404, 'PURCHASE_ORDER_NOT_FOUND', 'PO introuvable');
    if (!(await hasGrant(client, actor.id, authorizationType))) {
      fail(403, 'AUTHORIZATION_GRANT_REQUIRED', 'Vous ne détenez pas cette autorisation (attribuée par l\'Admin central)');
    }
    const { rows: [existing] } = await client.query(
      'SELECT * FROM purchase_order_authorizations WHERE purchase_order_id = $1 AND authorization_type = $2', [po.id, authorizationType]);
    if (existing) return { ...existing, idempotent_replay: true };
    let money;
    if (authorizationType === 'purchase_commitment') {
      if (po.status !== 'draft') fail(409, 'PURCHASE_ORDER_NOT_DRAFT', `PO au statut "${po.status}" : l'engagement se valide avant la soumission`);
      money = await poAmount(client, po, body);
    } else {
      if (!['notified', 'confirmed'].includes(po.status)) fail(409, 'PURCHASE_ORDER_NOT_SUBMITTED', `PO au statut "${po.status}" : le paiement s'autorise après soumission`);
      const { rows: [commit] } = await client.query(
        "SELECT 1 FROM purchase_order_authorizations WHERE purchase_order_id = $1 AND authorization_type = 'purchase_commitment'", [po.id]);
      if (!commit) fail(409, 'PURCHASE_COMMITMENT_REQUIRED', 'Engagement d\'achat non validé : le paiement ne peut pas être autorisé');
      const amount = Number(body.amount);
      const currency = typeof body.currency === 'string' ? body.currency.toUpperCase() : '';
      if (!(amount > 0) || !/^[A-Z]{3}$/.test(currency)) fail(400, 'AUTHORIZATION_AMOUNT_REQUIRED', 'Montant et devise du paiement requis');
      money = { amount, currency };
    }
    const { rows: [row] } = await client.query(
      `INSERT INTO purchase_order_authorizations (purchase_order_id, authorization_type, decided_by, amount, currency, proof_ref)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [po.id, authorizationType, actor.id, money.amount, money.currency, proof]);
    return row;
  });
}

/** Garde d'écriture : la soumission d'une PO suppose l'engagement validé. */
async function assertCommitmentAuthorized(client, purchaseOrderId) {
  const { rows } = await client.query(
    "SELECT 1 FROM purchase_order_authorizations WHERE purchase_order_id = $1 AND authorization_type = 'purchase_commitment'", [purchaseOrderId]);
  if (!rows.length) fail(409, 'PURCHASE_COMMITMENT_NOT_AUTHORIZED', 'Engagement d\'achat non validé par la directrice : la PO ne peut pas être soumise');
}

/** Garde d'écriture : un paiement fournisseur suppose l'autorisation de paiement, dans la devise et le plafond autorisés. */
async function assertPaymentAuthorized(client, purchaseOrderId, expectedAmount, currency) {
  const { rows: [auth] } = await client.query(
    "SELECT amount, currency FROM purchase_order_authorizations WHERE purchase_order_id = $1 AND authorization_type = 'supplier_payment'", [purchaseOrderId]);
  if (!auth) fail(409, 'SUPPLIER_PAYMENT_NOT_AUTHORIZED', 'Paiement fournisseur non autorisé par la directrice');
  if (auth.currency !== String(currency).toUpperCase() || Number(expectedAmount) > Number(auth.amount)) {
    fail(409, 'SUPPLIER_PAYMENT_EXCEEDS_AUTHORIZATION', 'Le paiement dépasse le montant ou la devise autorisés');
  }
}

module.exports = { TYPES, HubAuthorizationError, grant, revoke, listGrants, decide, assertCommitmentAuthorized, assertPaymentAuthorized };
