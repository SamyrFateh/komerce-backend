/**
 * @komerce-arch
 * @role          hub-authorization-service
 * @domain        purchasing
 * @layer         service
 * @criticality   critical
 * @inputs        user_id, authorization_type, purchase_order_id, proof_ref
 * @outputs       hub_authorization_grants, purchase_order_authorizations
 * @depends       db, services/documents/pdf-renderer.js
 * @used-by       routes/purchasing.js, services/purchasing-engagement-service.js, services/supplier-payment-orchestrator.js
 * @db-read       hub_authorization_grants, purchase_lines, purchase_orders, purchase_order_authorizations, supplier_execution_payments, manual_purchase_executions, purchase_variance_decisions, users, suppliers, order_items, products
 * @db-write      hub_authorization_grants, purchase_order_authorizations, purchase_variance_decisions
 * @db-txn        owns_transaction
 * @doctrine      two_distinct_directrice_authorizations, no_implicit_power, append_only_decisions
 * @impact-areas  purchasing, finance
 * @version       2026-11
 */
'use strict';

const db = require('../db');
const { renderPdf } = require('./documents/pdf-renderer');

const TYPES = Object.freeze(['purchase_commitment', 'supplier_payment']);

class HubAuthorizationError extends Error {
  constructor(status, code, message, extra = {}) { super(message); this.status = status; this.code = code; Object.assign(this, extra); }
}
const fail = (status, code, message, extra) => { throw new HubAuthorizationError(status, code, message, extra); };
const UUID = /^[0-9a-f-]{36}$/i;

const DECISION_FIELDS = 'id, purchase_order_id, authorization_type, decided_by, decided_at, amount, currency, proof_ref';

async function getCommitmentPdf(purchaseOrderId, database = db) {
  if (typeof purchaseOrderId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(purchaseOrderId)) {
    fail(400, 'PURCHASE_ORDER_INVALID', 'po_id invalide');
  }
  const { rows: [row] } = await database.query(
    `SELECT commitment_pdf FROM purchase_order_authorizations
     WHERE purchase_order_id = $1 AND authorization_type = 'purchase_commitment'
       AND commitment_pdf IS NOT NULL`, [purchaseOrderId]);
  if (!row) fail(404, 'PURCHASE_COMMITMENT_PDF_UNAVAILABLE', 'Bon de commande PDF indisponible');
  return row.commitment_pdf;
}

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
    `SELECT pl.quantity, pl.supplier_unit_price, pl.supplier_currency, pl.supplier_sku,
            p.name AS product_name, s.name AS supplier_name
       FROM purchase_lines pl
       JOIN suppliers s ON s.id = pl.supplier_id
       JOIN order_items oi ON oi.id = pl.order_item_id
       LEFT JOIN products p ON p.id = oi.product_id
      WHERE pl.purchase_order_id = $1 AND pl.cancelled_at IS NULL
      ORDER BY pl.id`, [po.id]);
  if (!rows.length) fail(409, 'PURCHASE_ORDER_EMPTY', 'PO sans ligne');
  const priced = rows.every((r) => r.supplier_unit_price != null && r.supplier_currency);
  if (priced && new Set(rows.map((r) => r.supplier_currency)).size === 1) {
    const amount = rows.reduce((s, r) => s + Number(r.quantity) * Number(r.supplier_unit_price), 0);
    return { amount, currency: rows[0].supplier_currency, lines: rows };
  }
  const amount = Number(body.amount);
  const currency = typeof body.currency === 'string' ? body.currency.toUpperCase() : '';
  if (!(amount > 0) || !/^[A-Z]{3}$/.test(currency)) {
    fail(400, 'AUTHORIZATION_AMOUNT_REQUIRED', 'Montant et devise requis : les lignes de la PO ne portent pas un prix fournisseur unique');
  }
  return { amount, currency, lines: rows };
}

/** Décision tracée d'une des deux autorisations sur une PO. Le décideur doit détenir le grant ACTIF correspondant. */
async function decide({ purchaseOrderId, authorizationType, actor, body = {} }, database = db) {
  requireType(authorizationType);
  if (typeof purchaseOrderId !== 'string' || !UUID.test(purchaseOrderId)) fail(400, 'PURCHASE_ORDER_INVALID', 'po_id invalide');
  const proof = typeof body.proof_ref === 'string' ? body.proof_ref.trim() : '';
  if (!proof || proof.length > 240) fail(400, 'AUTHORIZATION_PROOF_REQUIRED', 'proof_ref obligatoire (pièce associée)');
  if (!actor || !actor.id) fail(403, 'AUTHORIZATION_GRANT_REQUIRED', 'Authentification requise');
  return database.withTransaction(async (client) => {
    const { rows: [po] } = await client.query('SELECT id, status, now() AS decided_at FROM purchase_orders WHERE id = $1 FOR UPDATE', [purchaseOrderId]);
    if (!po) fail(404, 'PURCHASE_ORDER_NOT_FOUND', 'PO introuvable');
    if (!(await hasGrant(client, actor.id, authorizationType))) {
      fail(403, 'AUTHORIZATION_GRANT_REQUIRED', 'Vous ne détenez pas cette autorisation (attribuée par l\'Admin central)');
    }
    const { rows: [existing] } = await client.query(
      `SELECT ${DECISION_FIELDS} FROM purchase_order_authorizations WHERE purchase_order_id = $1 AND authorization_type = $2`, [po.id, authorizationType]);
    if (existing) return { ...existing, idempotent_replay: true };
    let money;
    let commitmentPdf = null;
    if (authorizationType === 'purchase_commitment') {
      if (po.status !== 'draft') fail(409, 'PURCHASE_ORDER_NOT_DRAFT', `PO au statut "${po.status}" : l'engagement se valide avant la soumission`);
      money = await poAmount(client, po, body);
      const pdf = await renderPdf({
        documentType: 'purchase_commitment',
        document: {
          reference: `PO-${po.id}`,
          issued_at: po.decided_at,
          supplier_name: money.lines[0].supplier_name,
          lines: money.lines,
          amount: money.amount,
          currency: money.currency,
        },
      });
      commitmentPdf = pdf.buffer;
    } else {
      if (!['notified', 'confirmed'].includes(po.status)) fail(409, 'PURCHASE_ORDER_NOT_SUBMITTED', `PO au statut "${po.status}" : le paiement s'autorise après soumission`);
      const { rows: [commit] } = await client.query(
        "SELECT 1 FROM purchase_order_authorizations WHERE purchase_order_id = $1 AND authorization_type = 'purchase_commitment'", [po.id]);
      if (!commit) fail(409, 'PURCHASE_COMMITMENT_REQUIRED', 'Engagement d\'achat non validé : le paiement ne peut pas être autorisé');
      const amount = Number(body.amount);
      const currency = typeof body.currency === 'string' ? body.currency.toUpperCase() : '';
      if (!(amount > 0) || !/^[A-Z]{3}$/.test(currency)) fail(400, 'AUTHORIZATION_AMOUNT_REQUIRED', 'Montant et devise du paiement requis');
      // FA-23 : paiement autorisé ≤ engagement PO, même devise (deux validations distinctes, jamais élargies tacitement).
      const { rows: [commitment] } = await client.query(
        "SELECT amount, currency FROM purchase_order_authorizations WHERE purchase_order_id = $1 AND authorization_type = 'purchase_commitment'", [po.id]);
      if (commitment.currency !== currency || amount > Number(commitment.amount) + 0.0001) {
        fail(409, 'SUPPLIER_PAYMENT_AUTHORIZATION_EXCEEDS_COMMITMENT', 'L\'autorisation de paiement dépasse l\'engagement d\'achat (montant ou devise)');
      }
      money = { amount, currency };
    }
    const { rows: [row] } = await client.query(
      `INSERT INTO purchase_order_authorizations (purchase_order_id, authorization_type, decided_by, amount, currency, proof_ref, commitment_pdf)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${DECISION_FIELDS}`,
      [po.id, authorizationType, actor.id, money.amount, money.currency, proof, commitmentPdf]);
    return row;
  });
}

/** Garde d'écriture : la soumission d'une PO suppose l'engagement validé. */
async function assertCommitmentAuthorized(client, purchaseOrderId) {
  const { rows } = await client.query(
    "SELECT 1 FROM purchase_order_authorizations WHERE purchase_order_id = $1 AND authorization_type = 'purchase_commitment'", [purchaseOrderId]);
  if (!rows.length) fail(409, 'PURCHASE_COMMITMENT_NOT_AUTHORIZED', 'Engagement d\'achat non validé par la directrice : la PO ne peut pas être soumise');
}

/**
 * Décision d'écart indépendante de l'autorisation initiale du paiement.
 * Le détenteur du grant supplier_payment approuve un plafond exceptionnel documenté
 * dans la devise de la PO ; aucune mutation de l'autorisation ou des preuves vendeur.
 */
async function decideVariance({ purchaseOrderId, actor, body = {} }, database = db) {
  if (typeof purchaseOrderId !== 'string' || !UUID.test(purchaseOrderId)) fail(400, 'PURCHASE_ORDER_INVALID', 'po_id invalide');
  if (!actor || !actor.id) fail(403, 'AUTHORIZATION_GRANT_REQUIRED', 'Authentification requise');
  const currency = String(body.currency || '').trim().toUpperCase();
  const amount = Number(body.approved_total);
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const proofRef = typeof body.proof_ref === 'string' ? body.proof_ref.trim() : '';
  if (!/^[A-Z]{3}$/.test(currency) || !Number.isFinite(amount) || !(amount > 0))
    fail(400, 'PURCHASE_VARIANCE_AMOUNT_INVALID', 'Montant total approuvé et devise requis');
  if (reason.length < 5 || !proofRef || proofRef.length > 240)
    fail(400, 'PURCHASE_VARIANCE_PROOF_REQUIRED', 'Motif précis et justificatif obligatoires');
  return database.withTransaction(async (client) => {
    const { rows: [po] } = await client.query('SELECT id FROM purchase_orders WHERE id=$1 FOR UPDATE', [purchaseOrderId]);
    if (!po) fail(404, 'PURCHASE_ORDER_NOT_FOUND', 'PO introuvable');
    if (!(await hasGrant(client, actor.id, 'supplier_payment')))
      fail(403, 'AUTHORIZATION_GRANT_REQUIRED', 'Délégation paiement fournisseur requise');
    const { rows: [authorization] } = await client.query(
      "SELECT amount, currency FROM purchase_order_authorizations WHERE purchase_order_id=$1 AND authorization_type='supplier_payment'",
      [purchaseOrderId]);
    if (!authorization || authorization.currency !== currency || amount > Number(authorization.amount) + 0.0001)
      fail(409, 'SUPPLIER_PAYMENT_EXCEEDS_AUTHORIZATION', 'Décision d’écart supérieure à l’autorisation de paiement');
    const { rows: [justified] } = await client.query(
      'SELECT COUNT(*)::int AS entries, COALESCE(SUM(amount),0) AS total FROM manual_purchase_executions WHERE purchase_order_id=$1 AND currency=$2',
      [purchaseOrderId, currency]);
    if (!justified || Number(justified.entries) < 1 || amount <= Number(justified.total) + 0.0001)
      fail(409, 'PURCHASE_VARIANCE_NOT_REQUIRED', 'Écart vendeur inexistant ou non justifié');
    const { rows: [existing] } = await client.query(
      'SELECT * FROM purchase_variance_decisions WHERE purchase_order_id=$1 AND currency=$2', [purchaseOrderId, currency]);
    if (existing) {
      if (Number(existing.approved_total) === amount && existing.reason === reason && existing.proof_ref === proofRef)
        return { ...existing, idempotent_replay: true };
      fail(409, 'PURCHASE_VARIANCE_ALREADY_DECIDED', 'Décision existante immuable : une nouvelle révision requiert un dossier distinct');
    }
    const { rows: [decision] } = await client.query(
      `INSERT INTO purchase_variance_decisions
         (purchase_order_id,currency,approved_total,reason,proof_ref,decided_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [purchaseOrderId, currency, amount, reason, proofRef, actor.id]);
    return decision;
  });
}

/** Garde d'écriture : un paiement fournisseur suppose l'autorisation de paiement, dans la devise et le plafond autorisés. */
async function assertPaymentAuthorized(client, purchaseOrderId, expectedAmount, currency, { excludePaymentKey = null } = {}) {
  // FA-23 : sérialise tous les paiements d'une même PO jusqu'à la fin de la transaction de l'appelant ; la somme ci-dessous lit
  // ensuite les paiements déjà validés par les concurrents. Verrou consultatif (et non FOR UPDATE sur la PO) : l'INSERT du paiement
  // pose déjà un FOR KEY SHARE sur la PO via la FK, dont la promotion provoquerait un deadlock entre deux opérateurs.
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('supplier_payment_po:' || $1::text, 0))", [purchaseOrderId]);
  const { rows: decisions } = await client.query(
    "SELECT authorization_type, amount, currency FROM purchase_order_authorizations WHERE purchase_order_id = $1 AND authorization_type IN ('supplier_payment','purchase_commitment')", [purchaseOrderId]);
  const auth = decisions.find((d) => d.authorization_type === 'supplier_payment');
  const commitment = decisions.find((d) => d.authorization_type === 'purchase_commitment');
  if (!auth) fail(409, 'SUPPLIER_PAYMENT_NOT_AUTHORIZED', 'Paiement fournisseur non autorisé par la directrice');
  if (auth.currency !== String(currency).toUpperCase() || Number(expectedAmount) > Number(auth.amount)) {
    fail(409, 'SUPPLIER_PAYMENT_EXCEEDS_AUTHORIZATION', 'Le paiement dépasse le montant ou la devise autorisés');
  }
  // Chaîne de plafonds : paiements ≤ autorisation ≤ engagement PO (même devise). Une autorisation héritée hors engagement est refusée.
  if (!commitment || commitment.currency !== auth.currency || Number(auth.amount) > Number(commitment.amount) + 0.0001) {
    fail(409, 'SUPPLIER_PAYMENT_AUTHORIZATION_EXCEEDS_COMMITMENT', 'L\'autorisation de paiement dépasse l\'engagement d\'achat (montant ou devise)');
  }
  // A2-ter : plafond cumulé (tranches/acomptes autorisés), pas égalité de chaque tranche au total de la PO.
  // Montant engagé d'un paiement = max(attendu, observé) : un observé supérieur ne libère jamais de marge.
  const { rows: [prior] } = await client.query(
    `SELECT COALESCE(SUM(GREATEST(expected_amount, COALESCE(observed_amount, 0))) FILTER (WHERE currency = $2), 0) AS total,
            COUNT(*) FILTER (WHERE currency <> $2)::int AS other_currency
       FROM supplier_execution_payments
      WHERE purchase_order_id = $1 AND status IN ('prepared','requested','succeeded','ambiguous')
        AND ($3::text IS NULL OR payment_execution_key <> $3)`, [purchaseOrderId, auth.currency, excludePaymentKey]);
  if (Number(prior.other_currency || 0) > 0) {
    fail(409, 'SUPPLIER_PAYMENT_EXCEEDS_AUTHORIZATION', 'Paiement existant dans une autre devise que l\'autorisation');
  }
  const cumulative = Number(prior.total) + Number(expectedAmount);
  if (cumulative > Number(auth.amount) + 0.0001) {
    fail(409, 'SUPPLIER_PAYMENT_EXCEEDS_AUTHORIZATION', 'Le cumul des paiements dépasse le plafond autorisé');
  }
  // Ne pas confondre le plafond de la directrice avec les sommes justifiées
  // par vendeurs réels. Si achat manuel tracé, toute dépense excédentaire
  // exige une décision d'écart distincte append-only (migration 407).
  const { rows: [justified] } = await client.query(
    `SELECT COUNT(*)::int AS entries,
            COUNT(*) FILTER (WHERE currency <> $2) AS wrong_currency,
            COALESCE(SUM(amount) FILTER (WHERE currency = $2),0) AS total
       FROM manual_purchase_executions WHERE purchase_order_id=$1`,
    [purchaseOrderId, auth.currency]);
  if (Number(justified?.entries || 0) > 0) {
    if (Number(justified.wrong_currency) > 0)
      fail(409, 'SUPPLIER_PAYMENT_JUSTIFICATION_CURRENCY_MISMATCH', 'Devise des achats réels différente de l’autorisation');
    if (cumulative > Number(justified.total) + 0.0001) {
      const { rows: [decision] } = await client.query(
        'SELECT approved_total FROM purchase_variance_decisions WHERE purchase_order_id=$1 AND currency=$2',
        [purchaseOrderId, auth.currency]);
      if (!decision || cumulative > Number(decision.approved_total) + 0.0001)
        fail(409, 'SUPPLIER_PAYMENT_EXCEEDS_JUSTIFIED_TOTAL', 'Le cumul payé dépasse les achats vendeur justifiés sans décision d’écart autorisée');
    }
  }
}

module.exports = { TYPES, HubAuthorizationError, grant, revoke, listGrants, hasGrant, decide, decideVariance, getCommitmentPdf, assertCommitmentAuthorized, assertPaymentAuthorized };
