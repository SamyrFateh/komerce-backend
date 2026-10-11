/**
 * @komerce-arch
 * @role          payment-cash-custody-service
 * @domain        payment
 * @layer         service
 * @criticality   critical
 * @inputs        authenticated_actor, market_code, destination_payload
 * @outputs       cash_custody_recipients_destinations_limits_holdings_receipts
 * @depends       db.js, utils/rules.js, services/market-delegation-service.js
 * @used-by       routes/market-delegation-cash-control.js, services/finance-accounting-workspace.js
 * @db-read       market_cash_destinations, market_cash_control_policies, assignment_memberships, membership_capabilities, market_operating_assignments, markets, users, cash_deposits, cash_custody_receipts, cash_custody_losses, cash_custody_movements
 * @db-write      market_cash_destinations, cash_custody_receipts, cash_custody_losses
 * @db-write-via:market-delegation-service market_delegation_audit
 * @db-txn        caller-owned
 * @doctrine      cash_custody_single_balance_authority, declaration_is_not_transfer, closure_only_on_controlled_final_reception, loss_is_central_decision, no_recipient_added_freely_by_relay_agent, two_distinct_actors_for_destination_activation, central_custody_limits_non_bypassable, client_market_id_never_authority
 * @impact-areas  payment, cash-custody, market-delegation, finance-accounting
 * @version       2026-10
 */
'use strict';

const { getRuleNumber } = require('../utils/rules');
const { audit, resolveAuthorization } = require('./market-delegation-service');
const { roundToMinorUnit } = require('../utils/currency');

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

// ─── PR 4b : soldes de garde, réceptions, contrôle, pertes ─────────────────
// Seule source de solde : la vue cash_custody_movements (migration 289). Aucun compteur
// stocké. Une déclaration ne bouge rien ; le solde change à l'acceptation d'un transfert,
// au contrôle indépendant d'une réception finale, ou à une décision de perte.

const AUDIT_CAPABILITY = 'finance.act';

/** Traduit une violation d'invariant de la base en erreur métier (jamais de message SQL brut inventé). */
function mapDbError(error) {
  if (error instanceof CashCustodyError) return error;
  const message = String(error && error.message || '');
  const known = /^cash_(custody_receipts|custody_losses|custody|deposits): /.exec(message);
  if (known && ['23514', '23001'].includes(error.code)) {
    const text = message.replace(/^cash_[a-z_]+: /, '');
    const code = /solde négatif/.test(text) ? 'custody_insufficient_holding' : 'custody_rule_violation';
    return new CashCustodyError(code, text, 409);
  }
  if (error && error.code === '23505') {
    return new CashCustodyError('custody_already_resolved', 'Cette remise a déjà reçu une réponse ou un contrôle.', 409);
  }
  return error;
}

async function holdingOf(db, userId, marketId) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(delta_kmf), 0)::numeric AS balance
       FROM cash_custody_movements WHERE holder_id = $1::uuid AND market_id = $2::uuid`, [userId, marketId]
  );
  return Number(rows[0].balance);
}

/**
 * Qui détient quoi dans ce Market : solde, depuis quand (FIFO : les sorties déchargent les plus
 * anciennes entrées), plafond, délai de garde, dépassements. Les soldes nuls ne sont pas listés.
 */
async function holdings(db, marketId, limits = null) {
  const lim = limits || await centralLimits();
  const days = await marketCustodyDays(db, marketId, lim);
  const { rows } = await db.query(
    `WITH m AS (
       SELECT holder_id, delta_kmf, occurred_at, ref_id FROM cash_custody_movements WHERE market_id = $1::uuid
     ), bal AS (
       SELECT holder_id, SUM(delta_kmf) AS balance, COALESCE(SUM(-delta_kmf) FILTER (WHERE delta_kmf < 0), 0) AS out_kmf
         FROM m GROUP BY holder_id HAVING SUM(delta_kmf) > 0
     ), inflow AS (
       SELECT holder_id, occurred_at,
              SUM(delta_kmf) OVER (PARTITION BY holder_id ORDER BY occurred_at, ref_id) AS cum
         FROM m WHERE delta_kmf > 0
     )
     SELECT b.holder_id, u.full_name, u.role, b.balance::text AS balance_kmf,
            (SELECT MIN(i.occurred_at) FROM inflow i WHERE i.holder_id = b.holder_id AND i.cum > b.out_kmf) AS since
       FROM bal b JOIN users u ON u.id = b.holder_id
      ORDER BY b.balance DESC, u.full_name`, [marketId]
  );
  const recipients = await listRecipients(db, marketId, lim);
  const now = Date.now();
  return rows.map(row => {
    const recipient = recipients.find(r => String(r.user_id) === String(row.holder_id));
    const ceiling = recipient ? recipient.holding_limit_kmf : lim.default_holding_kmf;
    const heldDays = row.since ? Math.floor((now - new Date(row.since).getTime()) / 86400000) : 0;
    const balance = Number(row.balance_kmf);
    return {
      holder_id: row.holder_id,
      full_name: row.full_name,
      role: row.role,
      balance_kmf: balance,
      since: row.since,
      held_days: heldDays,
      max_days: days,
      ceiling_kmf: ceiling,
      habilitated: Boolean(recipient),
      over_ceiling: balance > ceiling,
      overdue: heldDays > days,
    };
  });
}

/** Détenteurs hors plafond ou hors délai, tous Markets (radar). */
async function overdueHoldings(db) {
  const { rows: markets } = await db.query(
    `SELECT DISTINCT market_id AS id FROM cash_custody_movements WHERE market_id IS NOT NULL`
  );
  const limits = await centralLimits();
  const out = [];
  for (const market of markets) {
    for (const holder of await holdings(db, market.id, limits)) {
      if (holder.over_ceiling || holder.overdue) out.push({ market_id: market.id, ...holder });
    }
  }
  return out;
}

/** Remises historiques vérifiées : à régulariser (jamais clôturées automatiquement). */
async function legacyToRegularize(db, marketId) {
  const { rows } = await db.query(
    `SELECT d.id, d.deposit_ref, d.agent_id, u.full_name AS agent_name, d.amount_kmf::text AS amount_kmf,
            d.verified_at, d.amount_kmf - COALESCE((
              SELECT SUM(x.amount_kmf) FROM cash_deposits x
               WHERE x.regularizes_deposit_id = d.id AND x.status = 'verified'), 0) AS remaining_kmf
       FROM cash_deposits d JOIN users u ON u.id = d.agent_id
      WHERE d.market_id = $1::uuid AND d.movement_kind = 'LEGACY' AND d.status = 'verified'
      ORDER BY d.verified_at NULLS FIRST, d.id`, [marketId]
  );
  return rows.map(r => ({ ...r, amount_kmf: Number(r.amount_kmf), remaining_kmf: Number(r.remaining_kmf) }))
    .filter(r => r.remaining_kmf > 0);
}

/** État métier d'une remise de garde, dérivé des seuls faits. */
function custodyState(row) {
  if (row.refusal_reason) return 'REFUSED';
  if (row.movement_kind === 'FINAL') {
    if (row.control_id) return Number(row.controlled_net_kmf) > 0 ? 'CLOSED' : 'CONTROL_REJECTED';
    return row.received_id ? 'TO_CONTROL' : 'AWAITING_PROOF';
  }
  if (!row.received_id) return 'DECLARED';
  return Number(row.received_net_kmf) < Number(row.amount_kmf) ? 'ACCEPTED_PARTIAL' : 'ACCEPTED';
}

async function transferRows(db, marketId, limit = 200) {
  const { rows } = await db.query(
    `SELECT d.id, d.deposit_ref, d.movement_kind, d.status, d.amount_kmf::text AS amount_kmf,
            d.declared_amount::text AS declared_amount, d.declared_currency, d.fx_rate_to_kmf::text AS fx_rate_to_kmf,
            d.deposited_at, d.agent_id, d.agent_id AS remitter_id, ua.full_name AS remitter_name,
            d.recipient_user_id, ur.full_name AS recipient_name,
            d.destination_id, dest.label AS destination_label, dest.kind AS destination_kind,
            leg.deposit_ref AS regularizes_ref,
            rc.id AS received_id, rc.actor_id AS received_by, rcu.full_name AS received_by_name,
            rc.received_amount::text AS received_amount, rc.proof_ref,
            (rc.amount_kmf - COALESCE((SELECT SUM(x.amount_kmf) FROM cash_custody_receipts x WHERE x.reverses_id = rc.id), 0))::text AS received_net_kmf,
            rf.reason AS refusal_reason,
            ct.id AS control_id, ct.actor_id AS controlled_by, ctu.full_name AS controlled_by_name,
            (ct.amount_kmf - COALESCE((SELECT SUM(x.amount_kmf) FROM cash_custody_receipts x WHERE x.reverses_id = ct.id), 0))::text AS controlled_net_kmf
       FROM cash_deposits d
       JOIN users ua ON ua.id = d.agent_id
       LEFT JOIN users ur ON ur.id = d.recipient_user_id
       LEFT JOIN market_cash_destinations dest ON dest.id = d.destination_id
       LEFT JOIN cash_deposits leg ON leg.id = d.regularizes_deposit_id
       LEFT JOIN cash_custody_receipts rc ON rc.deposit_id = d.id AND rc.kind = 'RECEIVED'
       LEFT JOIN users rcu ON rcu.id = rc.actor_id
       LEFT JOIN cash_custody_receipts rf ON rf.deposit_id = d.id AND rf.kind = 'REFUSED'
       LEFT JOIN cash_custody_receipts ct ON ct.deposit_id = d.id AND ct.kind = 'CONTROL'
       LEFT JOIN users ctu ON ctu.id = ct.actor_id
      WHERE d.market_id = $1::uuid AND d.movement_kind <> 'LEGACY'
      ORDER BY d.deposited_at DESC, d.id
      LIMIT $2`, [marketId, limit]
  );
  return rows.map(row => {
    const amount = Number(row.amount_kmf);
    const received = row.received_id ? Number(row.received_net_kmf) : null;
    return {
      ...row,
      amount_kmf: amount,
      received_net_kmf: received,
      controlled_net_kmf: row.control_id ? Number(row.controlled_net_kmf) : null,
      discrepancy_kmf: received == null ? null : roundToMinorUnit(amount - received, 2),
      state: custodyState(row),
    };
  });
}

async function lockDeposit(db, marketId, depositRef) {
  const { rows } = await db.query(
    `SELECT id, deposit_ref, movement_kind, agent_id, recipient_user_id, amount_kmf FROM cash_deposits
      WHERE deposit_ref = $1 AND market_id = $2::uuid FOR UPDATE`, [depositRef, marketId]
  );
  if (!rows[0] || rows[0].movement_kind === 'LEGACY') {
    throw new CashCustodyError('custody_deposit_not_found', 'Remise de garde introuvable dans ce Market.', 404);
  }
  return rows[0];
}

async function insertReceipt(db, columns) {
  try {
    const { rows } = await db.query(
      `INSERT INTO cash_custody_receipts
         (deposit_id, market_id, kind, actor_id, amount_kmf, received_amount, proof_ref, proof_url, reason, reverses_id)
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6, $7, $8, $9, $10::uuid)
       RETURNING id, kind, amount_kmf::text AS amount_kmf, received_amount::text AS received_amount,
                 received_currency, fx_rate_to_kmf::text AS fx_rate_to_kmf, created_at`,
      [columns.depositId, columns.marketId, columns.kind, columns.actorId, columns.amountKmf ?? 0,
        columns.receivedAmount ?? null, columns.proofRef ?? null, columns.proofUrl ?? null,
        columns.reason ?? null, columns.reversesId ?? null]
    );
    return rows[0];
  } catch (error) {
    throw mapDbError(error);
  }
}

/**
 * Réception (acceptation totale/partielle) ou refus par le destinataire désigné (TRANSFER) ou par
 * un tiers habilité distinct du remettant (FINAL, preuve obligatoire). Le montant reçu est saisi
 * dans la devise figée de la remise ; le taux et le KMF sont recalculés par la base. Le plafond
 * de détention du receveur est vérifié AVANT que la responsabilité ne lui soit transférée.
 */
async function recordReceipt(db, { actorId, marketId, depositRef, outcome, receivedAmount = null, proofRef = null, proofUrl = null, reason = null, correlationId = null }) {
  const deposit = await lockDeposit(db, marketId, depositRef);
  if (!['received', 'refused'].includes(outcome)) throw new CashCustodyError('custody_outcome_invalid', 'outcome : received ou refused.');
  if (outcome === 'refused') {
    const row = await insertReceipt(db, { depositId: deposit.id, marketId, kind: 'REFUSED', actorId, reason });
    await audit(db, { actorUserId: actorId, marketId, capability: RECEIVE_CAPABILITY, action: 'CASH_TRANSFER_REFUSED',
      after: { deposit_ref: depositRef, reason }, correlationId });
    return { deposit_ref: depositRef, state: 'REFUSED', receipt_id: row.id };
  }
  const amount = Number(receivedAmount);
  if (!Number.isFinite(amount) || amount <= 0) throw new CashCustodyError('custody_received_amount_invalid', 'Montant reçu requis et > 0.');
  if (deposit.movement_kind === 'TRANSFER') {
    const limits = await centralLimits();
    const recipient = (await listRecipients(db, marketId, limits)).find(r => String(r.user_id) === String(actorId));
    if (!recipient) throw new CashCustodyError('custody_recipient_not_authorized', 'Destinataire non habilité à recevoir des fonds dans ce Market.', 403);
    const { rows: [{ nominal }] } = await db.query(
      `SELECT CASE WHEN $2::numeric = declared_amount THEN amount_kmf ELSE round($2::numeric * fx_rate_to_kmf, 2) END AS nominal
         FROM cash_deposits WHERE id = $1::uuid`, [deposit.id, amount]);
    const after = (await holdingOf(db, actorId, marketId)) + Number(nominal);
    if (after > recipient.holding_limit_kmf) {
      throw new CashCustodyError('custody_holding_ceiling_exceeded',
        `Plafond de détention dépassé (${after} > ${recipient.holding_limit_kmf} KMF) : remettre d'abord une partie à la destination suivante.`, 409);
    }
  }
  const row = await insertReceipt(db, { depositId: deposit.id, marketId, kind: 'RECEIVED', actorId, receivedAmount: amount, proofRef, proofUrl });
  const discrepancy = roundToMinorUnit(Number(deposit.amount_kmf) - Number(row.amount_kmf), 2);
  await audit(db, { actorUserId: actorId, marketId, capability: RECEIVE_CAPABILITY, action: 'CASH_TRANSFER_RECEIVED',
    after: { deposit_ref: depositRef, received_amount: amount, received_currency: row.received_currency, fx_rate_to_kmf: row.fx_rate_to_kmf,
      received_kmf: row.amount_kmf, announced_kmf: deposit.amount_kmf, discrepancy_kmf: discrepancy, proof_ref: proofRef }, correlationId });
  return { deposit_ref: depositRef, state: deposit.movement_kind === 'FINAL' ? 'TO_CONTROL' : (discrepancy > 0 ? 'ACCEPTED_PARTIAL' : 'ACCEPTED'),
    receipt_id: row.id, received_kmf: Number(row.amount_kmf), received_currency: row.received_currency, discrepancy_kmf: discrepancy };
}

/** Contrôle indépendant d'une réception finale : seule étape qui clôture. */
async function recordControl(db, { actorId, marketId, depositRef, controlledKmf = null, reason = null, correlationId = null }) {
  const deposit = await lockDeposit(db, marketId, depositRef);
  const { rows: [rec] } = await db.query(
    `SELECT rc.amount_kmf - COALESCE((SELECT SUM(x.amount_kmf) FROM cash_custody_receipts x WHERE x.reverses_id = rc.id), 0) AS net
       FROM cash_custody_receipts rc WHERE rc.deposit_id = $1::uuid AND rc.kind = 'RECEIVED'`, [deposit.id]);
  if (!rec) throw new CashCustodyError('custody_nothing_to_control', 'Aucune réception finale prouvée à contrôler.', 409);
  const amount = controlledKmf == null ? Number(rec.net) : Number(controlledKmf);
  if (!Number.isFinite(amount) || amount < 0) throw new CashCustodyError('custody_controlled_amount_invalid', 'Montant contrôlé invalide.');
  const row = await insertReceipt(db, { depositId: deposit.id, marketId, kind: 'CONTROL', actorId, amountKmf: amount, reason });
  await audit(db, { actorUserId: actorId, marketId, capability: AUDIT_CAPABILITY, action: 'CASH_FINAL_CONTROLLED',
    after: { deposit_ref: depositRef, controlled_kmf: amount, received_net_kmf: Number(rec.net), reason }, correlationId });
  return { deposit_ref: depositRef, state: amount > 0 ? 'CLOSED' : 'CONTROL_REJECTED', control_id: row.id, controlled_kmf: amount };
}

/** Contre-écriture centrale motivée d'une réception ou d'un contrôle (jamais de suppression). */
async function reverseReceipt(db, { actorId, marketId, depositRef, receiptId, amountKmf, reason, correlationId = null }) {
  const deposit = await lockDeposit(db, marketId, depositRef);
  const amount = Number(amountKmf);
  if (!Number.isFinite(amount) || amount <= 0) throw new CashCustodyError('custody_reversal_amount_invalid', 'Montant de contre-écriture requis et > 0.');
  const row = await insertReceipt(db, { depositId: deposit.id, marketId, kind: 'REVERSAL', actorId, amountKmf: amount, reason, reversesId: receiptId });
  await audit(db, { actorUserId: actorId, marketId, capability: AUDIT_CAPABILITY, action: 'CASH_RECEIPT_REVERSED',
    after: { deposit_ref: depositRef, reverses: receiptId, amount_kmf: amount, reason }, correlationId });
  return { deposit_ref: depositRef, reversal_id: row.id, amount_kmf: amount };
}

async function insertLoss(db, { marketId, holderId, kind, amountKmf, reason, decidedBy, depositId = null, reversesId = null }) {
  try {
    const { rows } = await db.query(
      `INSERT INTO cash_custody_losses (market_id, holder_id, kind, amount_kmf, reason, decided_by, deposit_id, reverses_id)
       VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6::uuid,$7::uuid,$8::uuid)
       RETURNING id, kind, amount_kmf::text AS amount_kmf`,
      [marketId, holderId, kind, amountKmf, reason, decidedBy, depositId, reversesId]
    );
    return rows[0];
  } catch (error) {
    if (error.code === '23514' && /cash_custody_losses_(reason|decider)_chk/.test(String(error.constraint || error.message))) {
      throw new CashCustodyError('custody_loss_invalid', 'Motif de 10 caractères minimum, décideur distinct du détenteur.', 422);
    }
    throw mapDbError(error);
  }
}

/** Perte : décision centrale motivée et tracée, distincte des montants reçus. */
async function decideLoss(db, { actorId, marketId, holderId, amountKmf, reason, depositRef = null, correlationId = null }) {
  const amount = Number(amountKmf);
  if (!Number.isFinite(amount) || amount <= 0) throw new CashCustodyError('custody_loss_amount_invalid', 'Montant de perte requis et > 0.');
  let depositId = null;
  if (depositRef) depositId = (await lockDeposit(db, marketId, depositRef)).id;
  const row = await insertLoss(db, { marketId, holderId, kind: 'LOSS', amountKmf: amount, reason: String(reason || '').trim(), decidedBy: actorId, depositId });
  await audit(db, { actorUserId: actorId, marketId, capability: AUDIT_CAPABILITY, action: 'CASH_LOSS_DECIDED',
    after: { loss_id: row.id, holder_id: holderId, amount_kmf: amount, reason, deposit_ref: depositRef }, correlationId });
  return { loss_id: row.id, holder_id: holderId, amount_kmf: amount };
}

async function reverseLoss(db, { actorId, marketId, lossId, amountKmf, reason, correlationId = null }) {
  const { rows: [loss] } = await db.query(
    `SELECT holder_id FROM cash_custody_losses WHERE id = $1::uuid AND market_id = $2::uuid AND kind = 'LOSS'`, [lossId, marketId]);
  if (!loss) throw new CashCustodyError('custody_loss_not_found', 'Perte introuvable dans ce Market.', 404);
  const amount = Number(amountKmf);
  if (!Number.isFinite(amount) || amount <= 0) throw new CashCustodyError('custody_loss_amount_invalid', 'Montant requis et > 0.');
  const row = await insertLoss(db, { marketId, holderId: loss.holder_id, kind: 'LOSS_REVERSAL', amountKmf: amount, reason: String(reason || '').trim(), decidedBy: actorId, reversesId: lossId });
  await audit(db, { actorUserId: actorId, marketId, capability: AUDIT_CAPABILITY, action: 'CASH_LOSS_REVERSED',
    after: { loss_id: lossId, reversal_id: row.id, amount_kmf: amount, reason }, correlationId });
  return { reversal_id: row.id, amount_kmf: amount };
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
  holdingOf,
  holdings,
  transferRows,
  legacyToRegularize,
  overdueHoldings,
  mapDbError,
  recordReceipt,
  recordControl,
  reverseReceipt,
  decideLoss,
  reverseLoss,
  custodyState,
};
