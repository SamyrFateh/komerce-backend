/**
 * @komerce-arch
 * @role          market-payment-provider-config-writer
 * @domain        payment
 * @layer         service
 * @criticality   high
 * @inputs        caller-owned transaction, provisioning market, provider config
 * @outputs       market_payment_providers configuration
 * @depends       services/mobile-money/registry.js, services/market-payment-collection-gate.js
 * @used-by       services/market-provisioning-service.js
 * @db-read       markets, market_central_collection_modes, market_operating_assignments, market_cash_control_policies
 * @db-write      market_payment_providers, market_central_collection_modes
 * @db-txn        caller-owned
 * @doctrine      payment_provider_config_owned_by_payments, provisioning_only_writer
 * @impact-areas  payments, market-control-plane
 * @version       2026-10-v1
 */
'use strict';

const { listAdapters } = require('./mobile-money/registry');
const { CENTRAL_MODES, CASH_COLLECTION_ALLOWED_SQL } = require('./market-payment-collection-gate');
const ALLOWED_PROVIDERS = Object.freeze(listAdapters().map(adapter => adapter.name));

function paymentOptions() {
  // Presence of runtime configuration is not proof of merchant eligibility.
  // Never project secrets: only names, supported market and boolean readiness.
  const env = process.env;
  return {
    central: [
      { mode: 'stripe_eur', label: 'Stripe (EUR)', configured: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PUBLISHABLE_KEY && env.STRIPE_WEBHOOK_SECRET) },
      { mode: 'paypal_eur', label: 'PayPal (EUR)', configured: Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET && env.PAYPAL_WEBHOOK_ID) },
    ],
    mobile: listAdapters().map(adapter => ({
      provider: adapter.name, market_code: adapter.marketCode, label: adapter.label,
      configured: Boolean(adapter.isConfigured()),
    })),
  };
}

function assertMobileMarketEligibility(marketCode, provider) {
  if (!listAdapters().some(adapter => adapter.name === provider && adapter.marketCode === marketCode)) {
    throw configError('MARKET_PAYMENT_PROVIDER_INELIGIBLE', 'Aucun contrat mobile money compatible avec ce marché et ce fournisseur.', 409);
  }
}

async function listCentralCollectionModes(executor, marketId) {
  const { rows } = await requireExecutor(executor).query(
    'SELECT payment_mode, evidence_ref, authorized_by FROM market_central_collection_modes WHERE market_id=$1::uuid AND revoked_at IS NULL ORDER BY payment_mode',
    [marketId]
  );
  return rows;
}

// Public checkout projection exposes booleans, never merchant credentials or
// decision evidence. An unavailable provider is not a selectable payment mode.
async function checkoutPaymentModes(executor,marketId,mobileAvailable) {
  const db=requireExecutor(executor);
  const {rows:[market]}=await db.query(
    `SELECT ${CASH_COLLECTION_ALLOWED_SQL} AS cash_enabled FROM markets WHERE id=$1::uuid AND lifecycle_status='ACTIVE' AND is_active`,[marketId]);
  if(!market)return {cash_relais:false,stripe_eur:false,paypal_eur:false,mobile_money:false};
  const authorizations=await listCentralCollectionModes(db,marketId);
  const options=paymentOptions();
  return {
    cash_relais:market.cash_enabled===true,
    stripe_eur:authorizations.some(x=>x.payment_mode==='stripe_eur')&&options.central.some(x=>x.mode==='stripe_eur'&&x.configured),
    paypal_eur:authorizations.some(x=>x.payment_mode==='paypal_eur')&&options.central.some(x=>x.mode==='paypal_eur'&&x.configured),
    mobile_money:mobileAvailable===true
  };
}

// The existing payments table remains the only authorization. A central
// administrator must attest the decision on the holder of funds, per mode.
// No automatic grant based on country, currency or existence of credentials.
async function configureCentralCollectionModes(executor, { marketId, actorUserId, modes }) {
  const db = requireExecutor(executor);
  if (!Array.isArray(modes) || !actorUserId || modes.length > CENTRAL_MODES.length) {
    throw configError('MARKET_CENTRAL_MODES_INVALID', 'Autorisations centrales invalides.');
  }
  const normalized = modes.map(entry => {
    const mode = entry?.payment_mode;
    const evidence = typeof entry?.evidence_ref === 'string' ? entry.evidence_ref.trim() : '';
    if (!CENTRAL_MODES.includes(mode) || evidence.length < 3 || evidence.length > 500) {
      throw configError('MARKET_CENTRAL_EVIDENCE_REQUIRED', 'Référence de décision du titulaire des fonds requise pour chaque moyen central.');
    }
    return { mode, evidence };
  });
  if (new Set(normalized.map(x => x.mode)).size !== normalized.length) {
    throw configError('MARKET_CENTRAL_MODES_INVALID', 'Moyen de paiement central dupliqué.');
  }
  const { rows: markets } = await db.query(
    'SELECT id, lifecycle_status FROM markets WHERE id=$1::uuid FOR UPDATE', [marketId]
  );
  if (!markets[0] || markets[0].lifecycle_status !== 'PROVISIONING') {
    throw configError('MARKET_CENTRAL_MODES_PROVISIONING_ONLY', 'Autorisation initiale réservée au marché en préparation.', 409);
  }
  // Existing authorizations are not silently revoked during a retry.
  for (const entry of normalized) {
    await db.query(
      `INSERT INTO market_central_collection_modes (market_id, payment_mode, evidence_ref, authorized_by)
       VALUES ($1::uuid,$2,$3,$4::uuid)
       ON CONFLICT (market_id,payment_mode) DO UPDATE SET
         evidence_ref=EXCLUDED.evidence_ref, authorized_by=EXCLUDED.authorized_by,
         authorized_at=NOW(), revoked_at=NULL
       WHERE market_central_collection_modes.revoked_at IS NOT NULL
          OR market_central_collection_modes.evidence_ref IS DISTINCT FROM EXCLUDED.evidence_ref`,
      [marketId, entry.mode, entry.evidence, actorUserId]
    );
  }
  return listCentralCollectionModes(db, marketId);
}

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
    `SELECT id,code,currency,lifecycle_status FROM markets WHERE id=$1::uuid LIMIT 1 FOR UPDATE`,
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

  assertMobileMarketEligibility(market.code,p);

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

module.exports = { checkoutPaymentModes, ALLOWED_PROVIDERS, paymentOptions, assertMobileMarketEligibility, listCentralCollectionModes, configureCentralCollectionModes, configureProvisioningProvider };
