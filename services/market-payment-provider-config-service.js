/**
 * @komerce-arch
 * @role          market-payment-provider-config-writer
 * @domain        payment
 * @layer         service
 * @criticality   high
 * @inputs        caller-owned transaction, provisioning market, provider config
 * @outputs       market_payment_providers configuration
 * @depends       none
 * @used-by       services/market-provisioning-service.js
 * @db-read       markets
 * @db-write      market_payment_providers
 * @db-txn        caller-owned
 * @doctrine      payment_provider_config_owned_by_payments, provisioning_only_writer
 * @impact-areas  payments, market-control-plane
 * @version       2026-10-v1
 */
'use strict';

const ALLOWED_PROVIDERS = Object.freeze(['orange_money','mtn_momo']);

function configError(code, message, status = 400) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
}

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('market-payment-provider-config-service: executor.query requis');
  }
  return executor;
}

async function configureProvisioningProvider(executor, {
  marketId, provider, currency, priority = 10,
}) {
  const db = requireExecutor(executor);
  const p = String(provider || '').trim().toLowerCase();
  const c = String(currency || '').trim().toUpperCase();
  const prio = Number(priority);
  if (!ALLOWED_PROVIDERS.includes(p)) {
    throw configError('MARKET_PAYMENT_PROVIDER_INVALID', 'Provider paiement marché invalide.');
  }
  if (!/^[A-Z]{3}$/.test(c)) {
    throw configError('MARKET_PAYMENT_CURRENCY_INVALID', 'Devise provider invalide.');
  }
  if (!Number.isInteger(prio) || prio <= 0) {
    throw configError('MARKET_PAYMENT_PRIORITY_INVALID', 'Priorité provider invalide.');
  }

  const { rows: markets } = await db.query(
    `SELECT id,currency,lifecycle_status FROM markets WHERE id=$1::uuid LIMIT 1 FOR UPDATE`,
    [marketId]
  );
  const market = markets[0];
  if (!market) throw configError('MARKET_NOT_FOUND', 'Marché introuvable.', 404);
  if (market.lifecycle_status !== 'PROVISIONING') {
    throw configError('MARKET_PAYMENT_PROVIDER_PROVISIONING_ONLY', 'Configuration initiale réservée au statut PROVISIONING.', 409);
  }
  if (market.currency !== c) {
    throw configError('MARKET_PAYMENT_CURRENCY_MISMATCH', 'La devise provider doit être celle du marché.', 409);
  }

  const { rows } = await db.query(
    `INSERT INTO market_payment_providers
       (market_id,provider,currency,is_enabled,priority)
     VALUES ($1::uuid,$2,$3,TRUE,$4)
     ON CONFLICT (market_id,provider) DO UPDATE SET
       currency=EXCLUDED.currency,
       is_enabled=TRUE,
       priority=EXCLUDED.priority,
       updated_at=NOW()
     RETURNING market_id,provider,currency,is_enabled,priority,created_at,updated_at`,
    [marketId,p,c,prio]
  );
  return rows[0];
}

module.exports = { ALLOWED_PROVIDERS, configureProvisioningProvider };
