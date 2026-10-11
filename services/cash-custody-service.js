/**
 * @komerce-arch
 * @role          payment-cash-custody-service
 * @domain        payment
 * @layer         service
 * @criticality   critical
 * @inputs        authenticated_actor, market_code, destination_payload
 * @outputs       cash_custody_recipients_destinations_limits
 * @depends       db.js, utils/rules.js, services/market-delegation-service.js
 * @used-by       routes/market-delegation-cash-control.js, services/finance-accounting-workspace.js
 * @db-read       market_cash_destinations, market_cash_control_policies, assignment_memberships, membership_capabilities, market_operating_assignments, markets, users
 * @db-write      market_cash_destinations
 * @db-write-via:market-delegation-service market_delegation_audit
 * @db-txn        caller-owned
 * @doctrine      no_recipient_added_freely_by_relay_agent, two_distinct_actors_for_destination_activation, central_custody_limits_non_bypassable, client_market_id_never_authority
 * @impact-areas  payment, cash-custody, market-delegation, finance-accounting
 * @version       2026-10
 */
'use strict';

const { getRuleNumber } = require('../utils/rules');
const { audit, resolveAuthorization } = require('./market-delegation-service');

const RECEIVE_CAPABILITY = 'cash.custody.receive';
const MANAGE_CAPABILITY = 'cash_control.policy.manage';
const DESTINATION_KINDS = Object.freeze(['BANK', 'MOBILE_MONEY']);

// Défauts et limites CENTRALES (KMF, jours) ; surchargeables par business_rules, jamais
// dépassables par un Market : un plafond ou un délai configuré au-dessus est ramené ici.
const CENTRAL_DEFAULTS = Object.freeze({
  CASH_CUSTODY_MAX_HOLDING_KMF: 5000000,
  CASH_CUSTODY_DEFAULT_HOLDING_KMF: 1000000,
  CASH_CUSTODY_MAX_DAYS: 30,
  CASH_CUSTODY_DEFAULT_DAYS: 7,
});

class CashCustodyError extends Error {
  constructor(code, message, status = 400) {
    super(message || code);
    this.name = 'CashCustodyError';
    this.code = code;
    this.status = status;
  }
}

async function centralLimits() {
  const [maxHolding, defaultHolding, maxDays, defaultDays] = await Promise.all([
    getRuleNumber('CASH_CUSTODY_MAX_HOLDING_KMF', CENTRAL_DEFAULTS.CASH_CUSTODY_MAX_HOLDING_KMF),
    getRuleNumber('CASH_CUSTODY_DEFAULT_HOLDING_KMF', CENTRAL_DEFAULTS.CASH_CUSTODY_DEFAULT_HOLDING_KMF),
    getRuleNumber('CASH_CUSTODY_MAX_DAYS', CENTRAL_DEFAULTS.CASH_CUSTODY_MAX_DAYS),
    getRuleNumber('CASH_CUSTODY_DEFAULT_DAYS', CENTRAL_DEFAULTS.CASH_CUSTODY_DEFAULT_DAYS),
  ]);
  return {
    max_holding_kmf: Number(maxHolding),
    default_holding_kmf: Math.min(Number(defaultHolding), Number(maxHolding)),
    max_days: Number(maxDays),
    default_days: Math.min(Number(defaultDays), Number(maxDays)),
  };
}

/** Borne un délai de garde configuré (jours) par la limite centrale. */
function boundDays(requested, limits) {
  if (requested == null) return limits.default_days;
  return Math.min(Number(requested), limits.max_days);
}

/** Plafond effectif d'un détenteur : sa limite de capability, sinon le défaut, toujours ≤ limite centrale. */
function boundHolding(limitAmount, limits) {
  if (limitAmount == null) return limits.default_holding_kmf;
  return Math.min(Number(limitAmount), limits.max_holding_kmf);
}

async function marketCustodyDays(db, marketId, limits) {
  const { rows } = await db.query(
    `SELECT custody_max_days FROM market_cash_control_policies p
       JOIN market_operating_assignments a ON a.id = p.assignment_id AND a.status = 'ACTIVE'
      WHERE p.market_id = $1::uuid LIMIT 1`, [marketId]
  );
  return boundDays(rows[0]?.custody_max_days ?? null, limits);
}

/** Personnes habilitées à recevoir des fonds dans ce Market (assignment actif, capability active). */
async function listRecipients(db, marketId, limits = null) {
  const lim = limits || await centralLimits();
  const { rows } = await db.query(
    `SELECT am.id AS membership_id, u.id AS user_id, u.full_name, u.role, mc.limit_amount, mc.granted_at
       FROM market_operating_assignments a
       JOIN assignment_memberships am ON am.assignment_id = a.id AND am.status = 'ACTIVE'
       JOIN membership_capabilities mc ON mc.membership_id = am.id
            AND mc.capability = $2 AND mc.revoked_at IS NULL
       JOIN users u ON u.id = am.user_id
      WHERE a.market_id = $1::uuid AND a.status = 'ACTIVE'
      ORDER BY u.full_name, u.id`, [marketId, RECEIVE_CAPABILITY]
  );
  return rows.map(row => ({
    membership_id: row.membership_id,
    user_id: row.user_id,
    full_name: row.full_name,
    role: row.role,
    holding_limit_kmf: boundHolding(row.limit_amount, lim),
    habilitated_since: row.granted_at,
  }));
}

/** Habilitation obligatoire : refuse tout receveur absent de la liste (jamais ajouté librement). */
async function assertAuthorizedRecipient(db, { marketId, userId }) {
  const recipient = (await listRecipients(db, marketId)).find(r => String(r.user_id) === String(userId));
  if (!recipient) {
    throw new CashCustodyError('custody_recipient_not_authorized', 'Destinataire non habilité à recevoir des fonds dans ce Market.', 403);
  }
  return recipient;
}

async function listDestinations(db, marketId) {
  const { rows } = await db.query(
    `SELECT id, kind, label, currency, account_ref, payment_account_id, status,
            proposed_by, activated_by, activated_at, status_reason, created_at
       FROM market_cash_destinations WHERE market_id = $1::uuid
      ORDER BY created_at, id`, [marketId]
  );
  return rows;
}

async function assertActiveDestination(db, { marketId, destinationId }) {
  const { rows } = await db.query(
    `SELECT id, kind, label, currency, account_ref, status FROM market_cash_destinations
      WHERE id = $1::uuid AND market_id = $2::uuid`, [destinationId, marketId]
  );
  if (!rows[0] || rows[0].status !== 'ACTIVE') {
    throw new CashCustodyError('custody_destination_not_active', 'Destination finale absente ou non activée dans ce Market.', 409);
  }
  return rows[0];
}

/** Vue de lecture d'un Market (finance.read) : habilités, destinations, limites effectives. */
async function readCustody(db, { userId, marketCode }) {
  const authz = await resolveAuthorization(db, { userId, marketCode, requiredCapability: 'finance.read' });
  return { authz, ...(await snapshot(db, authz.market_id)), can_manage: authz.capabilities.includes(MANAGE_CAPABILITY) };
}

async function snapshot(db, marketId) {
  const limits = await centralLimits();
  const [recipients, destinations, days] = await Promise.all([
    listRecipients(db, marketId, limits),
    listDestinations(db, marketId),
    marketCustodyDays(db, marketId, limits),
  ]);
  return { limits: { ...limits, market_max_days: days }, recipients, destinations };
}

function cleanText(value, label, min, max) {
  const text = String(value ?? '').trim();
  if (text.length < min || text.length > max) {
    throw new CashCustodyError('custody_destination_field_invalid', `${label} : ${min} à ${max} caractères.`);
  }
  return text;
}

async function proposeDestination(db, { userId, marketCode, payload = {}, correlationId = null }) {
  const authz = await resolveAuthorization(db, { userId, marketCode, requiredCapability: MANAGE_CAPABILITY });
  const kind = String(payload.kind || '').trim().toUpperCase();
  if (!DESTINATION_KINDS.includes(kind)) {
    throw new CashCustodyError('custody_destination_kind_invalid', 'kind doit être BANK ou MOBILE_MONEY.');
  }
  const currency = String(payload.currency || authz.currency || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new CashCustodyError('custody_destination_field_invalid', 'currency : code ISO à 3 lettres.');
  const label = cleanText(payload.label, 'label', 2, 120);
  const accountRef = cleanText(payload.account_ref, 'account_ref', 3, 120);
  const paymentAccountId = payload.payment_account_id || null;
  let created;
  try {
    ({ rows: [created] } = await db.query(
      `INSERT INTO market_cash_destinations (market_id, kind, label, currency, account_ref, payment_account_id, proposed_by)
       VALUES ($1::uuid,$2,$3,$4,$5,$6::uuid,$7::uuid)
       RETURNING id, kind, label, currency, account_ref, status`,
      [authz.market_id, kind, label, currency, accountRef, paymentAccountId, userId]
    ));
  } catch (error) {
    if (error.code === '23505') throw new CashCustodyError('custody_destination_exists', 'Cette destination existe déjà dans ce Market.', 409);
    if (error.code === '23514') throw new CashCustodyError('custody_destination_field_invalid', error.message, 422);
    throw error;
  }
  await audit(db, {
    actorUserId: userId, marketId: authz.market_id, assignmentId: authz.assignment_id, membershipId: authz.membership_id,
    capability: MANAGE_CAPABILITY, action: 'CASH_DESTINATION_PROPOSED', after: created, correlationId,
  });
  return created;
}

const TARGETS = Object.freeze({
  activate: { to: 'ACTIVE', action: 'CASH_DESTINATION_ACTIVATED', from: ['PROPOSED', 'SUSPENDED'] },
  suspend: { to: 'SUSPENDED', action: 'CASH_DESTINATION_SUSPENDED', from: ['ACTIVE'] },
  close: { to: 'CLOSED', action: 'CASH_DESTINATION_CLOSED', from: ['PROPOSED', 'ACTIVE', 'SUSPENDED'] },
});

async function transitionDestination(db, { userId, marketCode, destinationId, verb, reason = null, correlationId = null }) {
  const target = TARGETS[verb];
  if (!target) throw new CashCustodyError('custody_destination_action_invalid', 'Action inconnue.');
  const authz = await resolveAuthorization(db, { userId, marketCode, requiredCapability: MANAGE_CAPABILITY });
  const { rows: [before] } = await db.query(
    `SELECT * FROM market_cash_destinations WHERE id = $1::uuid AND market_id = $2::uuid FOR UPDATE`,
    [destinationId, authz.market_id]
  );
  if (!before) throw new CashCustodyError('custody_destination_not_found', 'Destination introuvable dans ce Market.', 404);
  if (!target.from.includes(before.status)) {
    throw new CashCustodyError('custody_destination_transition_forbidden', `Transition ${before.status} → ${target.to} interdite.`, 409);
  }
  if (target.to === 'ACTIVE' && String(before.proposed_by) === String(userId)) {
    throw new CashCustodyError('custody_destination_two_actors_required', 'Le proposant ne peut pas activer sa propre destination (deux acteurs distincts).', 403);
  }
  const why = reason == null ? null : String(reason).trim();
  if (['SUSPENDED', 'CLOSED'].includes(target.to) && (!why || why.length < 3)) {
    throw new CashCustodyError('custody_destination_reason_required', 'Motif requis (3 caractères minimum).');
  }
  const { rows: [after] } = await db.query(
    `UPDATE market_cash_destinations
        SET status = $2,
            activated_by = CASE WHEN $2 = 'ACTIVE' THEN $3::uuid ELSE activated_by END,
            activated_at = CASE WHEN $2 = 'ACTIVE' THEN NOW() ELSE activated_at END,
            status_reason = CASE WHEN $2 = 'ACTIVE' THEN NULL ELSE $4 END
      WHERE id = $1::uuid
      RETURNING id, kind, label, currency, account_ref, status, activated_by, activated_at, status_reason`,
    [destinationId, target.to, userId, why]
  );
  await audit(db, {
    actorUserId: userId, marketId: authz.market_id, assignmentId: authz.assignment_id, membershipId: authz.membership_id,
    capability: MANAGE_CAPABILITY, action: target.action, before: { status: before.status }, after, correlationId,
  });
  return after;
}

module.exports = {
  RECEIVE_CAPABILITY,
  MANAGE_CAPABILITY,
  DESTINATION_KINDS,
  CENTRAL_DEFAULTS,
  CashCustodyError,
  centralLimits,
  boundDays,
  boundHolding,
  marketCustodyDays,
  listRecipients,
  assertAuthorizedRecipient,
  listDestinations,
  assertActiveDestination,
  readCustody,
  snapshot,
  proposeDestination,
  transitionDestination,
};
