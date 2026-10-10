/**
 * @komerce-arch
 * @role          market-payment-account-owner
 * @domain        payment
 * @layer         service
 * @criticality   high
 * @inputs        central admin actor, canonical market code, payment account identity (holder, legal seller, refund bearer, vault reference)
 * @outputs       market_payment_accounts lifecycle (DRAFT, ACTIVE, SUSPENDED, CLOSED) and market-safe read projection
 * @depends       services/market-delegation-service.js, services/market-delegation-team-service.js
 * @used-by       routes/admin-market-payment-accounts.js, routes/market-delegation-payment-accounts.js
 * @db-read       market_payment_accounts, markets
 * @db-write      market_payment_accounts
 * @db-write-via:market-delegation-service market_delegation_audit
 * @db-txn        caller-owned
 * @doctrine      payment_account_is_provider_agnostic, no_secret_stored_only_vault_reference, holder_seller_operator_refund_bearer_are_distinct, active_requires_evidence, verification_is_separate_from_activation
 * @impact-areas  payments, market-delegation, finance
 * @version       2026-10
 */
'use strict';

const { audit, normalizeMarketCode } = require('./market-delegation-service');
const { resolveAuthorization } = require('./market-delegation-team-service');

const TRANSITIONS = Object.freeze({
  DRAFT: ['ACTIVE', 'CLOSED'],
  ACTIVE: ['SUSPENDED', 'CLOSED'],
  SUSPENDED: ['ACTIVE', 'CLOSED'],
});
const SECRET_PATTERN = /(^|[^a-z])(sk|rk|pk|whsec)_/i;
const REF_PATTERN = /^[a-z0-9][a-z0-9:_./-]{2,200}$/;
const NAME_PATTERN = /^[a-z][a-z0-9_]{1,40}$/;

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('market-payment-account-service: executor.query requis');
  }
  return executor;
}

function accountError(code, message, status = 400) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
}

function text(value, label, { min = 2, max = 200, required = true } = {}) {
  const clean = value == null ? '' : String(value).trim();
  if (!clean) {
    if (required) throw accountError('PAYMENT_ACCOUNT_FIELD_REQUIRED', `${label} requis.`);
    return null;
  }
  if (clean.length < min || clean.length > max) throw accountError('PAYMENT_ACCOUNT_FIELD_INVALID', `${label} invalide.`);
  return clean;
}

function vaultRef(value) {
  const clean = value == null ? '' : String(value).trim();
  if (!clean) return null;
  if (SECRET_PATTERN.test(clean) || !REF_PATTERN.test(clean)) {
    throw accountError('PAYMENT_ACCOUNT_SECRET_REJECTED', 'credentials_ref doit être une référence de coffre, jamais une clé ou un secret.');
  }
  return clean;
}

function publicId(value) {
  const clean = text(value, 'external_account_id', { required: false });
  if (clean && SECRET_PATTERN.test(clean)) {
    throw accountError('PAYMENT_ACCOUNT_SECRET_REJECTED', 'external_account_id ne doit pas contenir de clé secrète.');
  }
  return clean;
}

async function loadMarket(db, marketCode) {
  const code = normalizeMarketCode(marketCode);
  if (!code) throw accountError('MARKET_CODE_INVALID', 'Code marché invalide.', 400);
  const { rows } = await db.query('SELECT id, code FROM markets WHERE code = $1', [code]);
  if (!rows[0]) throw accountError('MARKET_NOT_FOUND', 'Marché introuvable.', 404);
  return rows[0];
}

async function createPaymentAccount(executor, input) {
  const db = requireExecutor(executor);
  const provider = String(input.provider || '').trim().toLowerCase();
  const adapter = input.adapter ? String(input.adapter).trim().toLowerCase() : null;
  if (!NAME_PATTERN.test(provider) || (adapter && !NAME_PATTERN.test(adapter))) {
    throw accountError('PAYMENT_ACCOUNT_FIELD_INVALID', 'provider/adapter : minuscules, chiffres et _ uniquement.');
  }
  const currency = String(input.currency || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw accountError('PAYMENT_ACCOUNT_FIELD_INVALID', 'currency : code ISO à 3 lettres.');
  const refundBearer = String(input.refundBearer || '').trim().toUpperCase();
  if (!['MARKET', 'PLATFORM'].includes(refundBearer)) {
    throw accountError('PAYMENT_ACCOUNT_FIELD_INVALID', 'refund_bearer : MARKET ou PLATFORM.');
  }
  const values = {
    account_holder: text(input.accountHolder, 'account_holder'),
    legal_seller: text(input.legalSeller, 'legal_seller'),
    market_operator_entity: text(input.marketOperatorEntity, 'market_operator_entity', { required: false }),
    external_account_id: publicId(input.externalAccountId),
    credentials_ref: vaultRef(input.credentialsRef),
    legal_basis_ref: text(input.legalBasisRef, 'legal_basis_ref', { min: 3, max: 300, required: false }),
  };

  const market = await loadMarket(db, input.marketCode);
  const { rows } = await db.query(
    `INSERT INTO market_payment_accounts
       (market_id, provider, adapter, currency, account_holder, legal_seller, market_operator_entity,
        refund_bearer, external_account_id, credentials_ref, legal_basis_ref, created_by)
     VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::uuid)
     RETURNING id, status`,
    [market.id, provider, adapter, currency, values.account_holder, values.legal_seller, values.market_operator_entity,
      refundBearer, values.external_account_id, values.credentials_ref, values.legal_basis_ref, input.actorUserId]
  );
  await audit(db, {
    actorUserId: input.actorUserId,
    marketId: market.id,
    action: 'MARKET_PAYMENT_ACCOUNT_CREATED',
    after: { account_id: rows[0].id, provider, currency, refund_bearer: refundBearer, status: rows[0].status },
    correlationId: input.correlationId || null,
  });
  return { account_id: rows[0].id, market_code: market.code, status: rows[0].status };
}

async function setPaymentAccountStatus(executor, { actorUserId, accountId, targetStatus, correlationId = null }) {
  const db = requireExecutor(executor);
  const target = String(targetStatus || '').trim().toUpperCase();
  if (!['ACTIVE', 'SUSPENDED', 'CLOSED'].includes(target)) {
    throw accountError('PAYMENT_ACCOUNT_STATUS_INVALID', 'Statut invalide (ACTIVE, SUSPENDED ou CLOSED).');
  }
  const { rows } = await db.query(
    `SELECT id, market_id, provider, currency, status, credentials_ref, legal_basis_ref, verified_at, verified_by, verification_ref
       FROM market_payment_accounts WHERE id = $1::uuid FOR UPDATE`, [accountId]
  );
  const account = rows[0];
  if (!account) throw accountError('PAYMENT_ACCOUNT_NOT_FOUND', 'Compte de paiement introuvable.', 404);
  if (account.status === target) return { changed: false, account_id: account.id, status: target };
  if (!(TRANSITIONS[account.status] || []).includes(target)) {
    throw accountError('PAYMENT_ACCOUNT_TRANSITION_FORBIDDEN', `Transition ${account.status} → ${target} interdite.`, 409);
  }
  if (target === 'ACTIVE' && (!account.credentials_ref || !account.legal_basis_ref)) {
    throw accountError('PAYMENT_ACCOUNT_INCOMPLETE', 'Activation refusée : référence de coffre et base juridique requises.', 409);
  }
  // L'activation ne fabrique jamais sa propre preuve : la vérification est un acte distinct et préalable.
  if (target === 'ACTIVE' && (!account.verified_at || !account.verified_by || !account.verification_ref)) {
    throw accountError('PAYMENT_ACCOUNT_NOT_VERIFIED', 'Activation refusée : vérification administrative préalable (acteur et référence de preuve) requise.', 409);
  }

  try {
    await db.query(
      `UPDATE market_payment_accounts SET status = $2, updated_at = NOW() WHERE id = $1::uuid`,
      [account.id, target]
    );
  } catch (error) {
    if (error && error.code === '23505') {
      throw accountError('PAYMENT_ACCOUNT_ACTIVE_EXISTS', 'Un compte actif existe déjà pour ce marché, ce prestataire et cette devise.', 409);
    }
    throw error;
  }
  await audit(db, {
    actorUserId,
    marketId: account.market_id,
    action: 'MARKET_PAYMENT_ACCOUNT_STATUS_CHANGED',
    before: { account_id: account.id, status: account.status },
    after: { account_id: account.id, status: target, provider: account.provider, currency: account.currency },
    correlationId,
  });
  return { changed: true, account_id: account.id, status: target, previous_status: account.status };
}

// Vérification administrative : acte distinct de l'activation. Elle atteste qu'un acteur identifié a
// contrôlé le dossier (base juridique, titulaire) selon une preuve référencée. Elle ne prouve PAS que
// la référence de coffre pointe vers un secret valide : cette vérification effective relève de D4b.
async function verifyPaymentAccount(executor, { actorUserId, accountId, verificationRef, correlationId = null }) {
  const db = requireExecutor(executor);
  if (!actorUserId) throw accountError('PAYMENT_ACCOUNT_ACTOR_REQUIRED', 'Acteur de vérification requis.', 400);
  const ref = text(verificationRef, 'verification_ref', { min: 3, max: 300 });
  if (SECRET_PATTERN.test(ref)) {
    throw accountError('PAYMENT_ACCOUNT_SECRET_REJECTED', 'verification_ref ne doit contenir aucun secret.');
  }
  const { rows } = await db.query(
    `SELECT id, market_id, provider, currency, status, credentials_ref, legal_basis_ref, verified_at, verification_ref
       FROM market_payment_accounts WHERE id = $1::uuid FOR UPDATE`, [accountId]
  );
  const account = rows[0];
  if (!account) throw accountError('PAYMENT_ACCOUNT_NOT_FOUND', 'Compte de paiement introuvable.', 404);
  if (!['DRAFT', 'SUSPENDED'].includes(account.status)) {
    throw accountError('PAYMENT_ACCOUNT_TRANSITION_FORBIDDEN', `Vérification impossible depuis le statut ${account.status}.`, 409);
  }
  if (!account.credentials_ref || !account.legal_basis_ref) {
    throw accountError('PAYMENT_ACCOUNT_INCOMPLETE', 'Vérification refusée : référence de coffre et base juridique requises.', 409);
  }
  await db.query(
    `UPDATE market_payment_accounts
        SET verified_at = NOW(), verified_by = $2::uuid, verification_ref = $3, updated_at = NOW()
      WHERE id = $1::uuid`,
    [account.id, actorUserId, ref]
  );
  await audit(db, {
    actorUserId,
    marketId: account.market_id,
    action: 'MARKET_PAYMENT_ACCOUNT_VERIFIED',
    before: { account_id: account.id, verified: Boolean(account.verified_at), verification_ref: account.verification_ref || null },
    after: { account_id: account.id, verification_ref: ref, provider: account.provider, currency: account.currency },
    correlationId,
  });
  return { account_id: account.id, status: account.status, verified: true, verification_ref: ref };
}

const CENTRAL_COLUMNS = `a.id, a.provider, a.adapter, a.currency, a.account_holder, a.legal_seller, a.market_operator_entity,
  a.refund_bearer, a.external_account_id, a.credentials_ref, a.legal_basis_ref, a.status, a.verification_ref, a.verified_at, a.created_at, a.updated_at`;
// Projection Market : jamais la référence de coffre ni l'identité du vérificateur (internes plateforme).
const MARKET_COLUMNS = `a.id, a.provider, a.adapter, a.currency, a.account_holder, a.legal_seller, a.market_operator_entity,
  a.refund_bearer, a.external_account_id, a.legal_basis_ref, a.status, a.verified_at`;

async function listPaymentAccounts(executor, { marketCode }) {
  const db = requireExecutor(executor);
  const market = await loadMarket(db, marketCode);
  const { rows } = await db.query(
    `SELECT ${CENTRAL_COLUMNS} FROM market_payment_accounts a WHERE a.market_id = $1::uuid ORDER BY a.created_at DESC`, [market.id]
  );
  return { market_code: market.code, accounts: rows };
}

async function listMarketPaymentAccounts(executor, { marketCode, actorUserId }) {
  const db = requireExecutor(executor);
  const authz = await resolveAuthorization(db, { userId: actorUserId, marketCode, requiredCapability: 'finance.read' });
  const { rows } = await db.query(
    `SELECT ${MARKET_COLUMNS} FROM market_payment_accounts a WHERE a.market_id = $1::uuid ORDER BY a.created_at DESC`, [authz.market_id]
  );
  return Object.freeze({
    market_code: authz.market_code || String(marketCode).toUpperCase(),
    accounts: rows,
    read_only: true,
  });
}

module.exports = {
  TRANSITIONS, createPaymentAccount, verifyPaymentAccount, setPaymentAccountStatus, listPaymentAccounts, listMarketPaymentAccounts,
};
