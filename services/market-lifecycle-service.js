/**
 * @komerce-arch
 * @role          market-lifecycle-writer
 * @domain        market
 * @layer         service
 * @criticality   high
 * @inputs        central provisioning payload, caller-owned transaction
 * @outputs       canonical market row in PROVISIONING, audited lifecycle transitions
 * @depends       none
 * @used-by       services/market-provisioning-service.js
 * @db-read       markets, market_operating_assignments
 * @db-write      markets
 * @db-txn        caller-owned
 * @doctrine      market_owns_market_lifecycle, lifecycle_never_grants_user_authority
 * @impact-areas  market, market-control-plane, authorization
 * @version       2026-10-v1
 */
'use strict';

function lifecycleError(code, message, status = 400) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
}

function normalizeMarketCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('market-lifecycle-service: executor.query requis');
  }
  return executor;
}

function normalizeCurrency(value) {
  const currency = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

async function createProvisioningMarket(executor, {
  code, name, currency, minorUnit = 0, storefrontTexts = {}, actorUserId = null, correlationId = null,
}) {
  const db = requireExecutor(executor);
  const marketCode = normalizeMarketCode(code);
  const marketCurrency = normalizeCurrency(currency);
  const marketName = String(name || '').trim();
  const unit = Number(minorUnit);

  if (!marketCode) throw lifecycleError('MARKET_CODE_INVALID', 'Code marché invalide.', 400);
  if (!marketName) throw lifecycleError('MARKET_NAME_REQUIRED', 'Nom marché requis.', 400);
  if (!marketCurrency) throw lifecycleError('MARKET_CURRENCY_INVALID', 'Devise marché invalide.', 400);
  if (!Number.isInteger(unit) || unit < 0 || unit > 4) {
    throw lifecycleError('MARKET_MINOR_UNIT_INVALID', 'minor_unit invalide.', 400);
  }
  if (!storefrontTexts || typeof storefrontTexts !== 'object' || Array.isArray(storefrontTexts)) {
    throw lifecycleError('MARKET_STOREFRONT_TEXTS_INVALID', 'storefront_texts doit être un objet JSON.', 400);
  }

  const { rows: existing } = await db.query('SELECT id FROM markets WHERE code=$1 LIMIT 1', [marketCode]);
  if (existing[0]) throw lifecycleError('MARKET_ALREADY_EXISTS', `Marché ${marketCode} déjà existant.`, 409);

  const { rows } = await db.query(
    `INSERT INTO markets (code,name,currency,minor_unit,is_active,lifecycle_status,storefront_texts)
     VALUES ($1,$2,$3,$4,FALSE,'PROVISIONING',$5::jsonb)
     RETURNING id,code,name,currency,minor_unit,is_active,lifecycle_status,storefront_texts,created_at`,
    [marketCode, marketName, marketCurrency, unit, JSON.stringify(storefrontTexts)]
  );
  return rows[0];
}


const ALLOWED_TRANSITIONS = Object.freeze({
  PROVISIONING: Object.freeze(['ACTIVE','CLOSED']),
  ACTIVE: Object.freeze(['SUSPENDED','CLOSED']),
  SUSPENDED: Object.freeze(['ACTIVE','CLOSED']),
  CLOSED: Object.freeze([]),
});

async function transitionMarketLifecycle(executor, { marketCode, targetStatus }) {
  const db = requireExecutor(executor);
  const code = normalizeMarketCode(marketCode);
  const target = String(targetStatus || '').trim().toUpperCase();
  if (!code) throw lifecycleError('MARKET_CODE_INVALID', 'Code marché invalide.', 400);
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_TRANSITIONS, target)) {
    throw lifecycleError('MARKET_LIFECYCLE_STATUS_INVALID', 'Statut lifecycle invalide.', 400);
  }

  const { rows } = await db.query(
    `SELECT id,code,lifecycle_status,is_active
       FROM markets
      WHERE code=$1
      LIMIT 1
      FOR UPDATE`,
    [code]
  );
  const current = rows[0];
  if (!current) throw lifecycleError('MARKET_NOT_FOUND', 'Marché introuvable.', 404);
  if (current.lifecycle_status === target) return { before: current, after: current, changed: false };

  const allowed = ALLOWED_TRANSITIONS[current.lifecycle_status] || [];
  if (!allowed.includes(target)) {
    throw lifecycleError(
      'MARKET_LIFECYCLE_TRANSITION_FORBIDDEN',
      `Transition ${current.lifecycle_status} -> ${target} interdite.`,
      409
    );
  }

  const isActive = target === 'ACTIVE' || target === 'SUSPENDED';
  const { rows: updated } = await db.query(
    `UPDATE markets
        SET lifecycle_status=$2,
            is_active=$3
      WHERE id=$1::uuid
      RETURNING id,code,lifecycle_status,is_active`,
    [current.id, target, isActive]
  );
  return { before: current, after: updated[0], changed: true };
}


async function loadProvisioningMarket(executor, { marketCode }) {
  const db = requireExecutor(executor);
  const code = normalizeMarketCode(marketCode);
  if (!code) throw lifecycleError('MARKET_CODE_INVALID', 'Code marché invalide.', 400);
  const { rows } = await db.query(
    `SELECT id,code,name,currency,minor_unit,is_active,lifecycle_status,storefront_texts,created_at
       FROM markets
      WHERE code=$1
      LIMIT 1
      FOR UPDATE`,
    [code]
  );
  const market = rows[0];
  if (!market) throw lifecycleError('MARKET_NOT_FOUND', 'Marché introuvable.', 404);
  if (market.lifecycle_status !== 'PROVISIONING' || market.is_active) {
    throw lifecycleError(
      'MARKET_REPROVISION_REQUIRES_PROVISIONING',
      'Le reprovisioning exige un marché PROVISIONING et inactif.',
      409
    );
  }
  const { rows: activeAssignments } = await db.query(
    `SELECT id FROM market_operating_assignments
      WHERE market_id=$1::uuid AND status='ACTIVE'
      LIMIT 1`,
    [market.id]
  );
  if (activeAssignments[0]) {
    throw lifecycleError(
      'MARKET_REPROVISION_ACTIVE_ASSIGNMENT',
      'Un assignment ACTIVE existe encore pour ce marché.',
      409
    );
  }
  return market;
}

module.exports = { ALLOWED_TRANSITIONS, createProvisioningMarket, loadProvisioningMarket, normalizeCurrency, transitionMarketLifecycle };
