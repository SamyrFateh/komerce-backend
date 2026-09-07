/**
 * @komerce-arch
 * @role          payment-mobile-money
 * @domain        payment
 * @layer         service
 * @criticality   critical
 * @inputs        order, msisdn, provider_callback
 * @outputs       mobile_money_transaction, payment_confirmation
 * @depends       db.js, utils/currency.js, services/order-payment-confirmation.js,
 *                services/mobile-money/registry.js, services/pickup-secret-service.js
 * @used-by       routes/payments-mobile-money.js
 * @db-read       markets, market_payment_providers, mobile_money_transactions, orders
 * @db-write      mobile_money_transactions, alerts
 * @db-write-via:order-payment-confirmation orders, stock, invoices
 * @db-txn        provider_http_outside_db_tx, finalization_atomic
 * @doctrine      payment_to_stock_single_entry, provider_callback_never_trusted,
 *                authoritative_server_amount, idempotence_mobile_money
 * @impact-areas  payment, orders, stock, purchasing, notifications
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const log = require('../utils/logger').child({ module: 'payment-mobile-money' });
const { projectAmount, roundToMinorUnit } = require('../utils/currency');
const { getAdapter } = require('./mobile-money/registry');
const { confirmPaymentCycle } = require('./order-payment-confirmation');
const { appendOrderNote } = require('./order-mutation-service');
const { createAlert } = require('../utils/alerts');
const { generateAndStoreSecret, cacheCodeForReveal } = require('./pickup-secret-service');

const FINAL_TX_STATUSES = new Set(['succeeded', 'failed', 'expired']);

class MobileMoneyError extends Error {
  constructor(code, message, statusCode = 400, details = null) {
    super(message);
    this.name = 'MobileMoneyError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function publicBaseUrl() {
  const base = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!base) {
    throw new MobileMoneyError(
      'mobile_money_public_base_url_missing',
      'PUBLIC_BASE_URL requis pour les callbacks Mobile Money',
      503
    );
  }
  return base;
}

function amountMajor(amountMinor, minorUnit) {
  return Number(amountMinor) / Math.pow(10, Number(minorUnit) || 0);
}

function publicTransaction(row) {
  const payload = row?.provider_payload && typeof row.provider_payload === 'object'
    ? row.provider_payload
    : {};
  return {
    id: row.id,
    order_reference: row.order_reference || null,
    provider: row.provider,
    provider_label: getAdapter(row.provider).label,
    status: row.status,
    provider_status: row.provider_status || null,
    amount: amountMajor(row.amount_minor, row.minor_unit),
    currency: row.currency,
    minor_unit: Number(row.minor_unit) || 0,
    client_action: payload.client_action || null,
    completed_at: row.completed_at || null,
    updated_at: row.updated_at || null,
  };
}

async function getProviderForMarketCode(marketCode) {
  const { rows } = await db.query(
    `SELECT m.id AS market_id, m.code AS market_code, m.name AS market_name,
            m.currency AS market_currency, m.minor_unit,
            p.provider, p.currency AS payment_currency, p.priority
       FROM markets m
       LEFT JOIN market_payment_providers p
         ON p.market_id = m.id
        AND p.is_enabled = TRUE
      WHERE m.code = $1
        AND m.is_active = TRUE
      ORDER BY p.priority ASC NULLS LAST
      LIMIT 1`,
    [String(marketCode || '').trim().toUpperCase()]
  );

  if (!rows.length) return null;
  const row = rows[0];
  if (!row.provider) {
    return { ...row, available: false, reason: 'provider_not_enabled' };
  }

  const adapter = getAdapter(row.provider);
  if (!adapter.isConfigured()) {
    return { ...row, available: false, reason: 'provider_not_configured', adapter };
  }
  if (String(row.payment_currency) !== String(row.market_currency)) {
    return { ...row, available: false, reason: 'currency_configuration_mismatch', adapter };
  }
  return { ...row, available: true, adapter };
}

async function getAvailability(marketCode) {
  const resolved = await getProviderForMarketCode(marketCode);
  if (!resolved) {
    return { market_code: String(marketCode || '').toUpperCase(), available: false, reason: 'market_not_found' };
  }
  if (!resolved.provider) {
    return { market_code: resolved.market_code, available: false, reason: resolved.reason };
  }
  const cfg = resolved.adapter.publicConfig();
  return {
    market_code: resolved.market_code,
    currency: resolved.payment_currency,
    available: resolved.available,
    reason: resolved.available ? null : resolved.reason,
    provider: resolved.provider,
    label: cfg.label,
    requires_msisdn: cfg.requires_msisdn,
    flow: cfg.flow,
  };
}

async function loadOrderForPayment(orderReference) {
  const { rows } = await db.query(
    `SELECT o.id, o.reference, o.user_id, o.payment_mode, o.payment_status,
            o.total_kmf, o.market_id, o.relais_id,
            m.code AS market_code, m.name AS market_name,
            m.currency AS market_currency, m.minor_unit AS market_minor_unit
       FROM orders o
       JOIN markets m ON m.id = o.market_id
      WHERE o.reference = $1
      LIMIT 1`,
    [orderReference]
  );
  return rows[0] || null;
}

async function resolveOrderProvider(order) {
  const { rows } = await db.query(
    `SELECT p.provider, p.currency, p.priority,
            m.code AS market_code, m.currency AS market_currency,
            m.minor_unit
       FROM market_payment_providers p
       JOIN markets m ON m.id = p.market_id
      WHERE p.market_id = $1
        AND p.is_enabled = TRUE
      ORDER BY p.priority ASC
      LIMIT 1`,
    [order.market_id]
  );
  if (!rows.length) {
    throw new MobileMoneyError(
      'mobile_money_not_available_for_market',
      `Mobile Money indisponible pour le marché ${order.market_code || ''}`.trim(),
      409
    );
  }

  const provider = rows[0];
  if (provider.currency !== provider.market_currency) {
    throw new MobileMoneyError(
      'mobile_money_currency_configuration_mismatch',
      'Configuration devise Mobile Money incohérente avec le marché',
      503
    );
  }
  const adapter = getAdapter(provider.provider);
  if (!adapter.isConfigured()) {
    throw new MobileMoneyError(
      'mobile_money_provider_not_configured',
      `${adapter.label} n'est pas encore configuré sur cet environnement`,
      503
    );
  }
  return { ...provider, adapter };
}

async function computeAuthoritativeAmount(order, provider) {
  const totalKmf = Number(order.total_kmf);
  if (!Number.isFinite(totalKmf) || totalKmf <= 0) {
    throw new MobileMoneyError('mobile_money_amount_invalid', 'Montant commande invalide', 409);
  }

  // Extension explicite de la Payment Boundary : la Currency Boundary sert
  // seulement à projeter la vérité orders.total_kmf vers la devise native du
  // rail. Le résultat est immédiatement figé dans mobile_money_transactions
  // et ne sera plus jamais recalculé pour cette tentative.
  const projected = await projectAmount(totalKmf, 'KMF', provider.currency);
  const rounded = roundToMinorUnit(projected, provider.minor_unit);
  const factor = Math.pow(10, Number(provider.minor_unit) || 0);
  const amountMinor = Math.round(rounded * factor);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new MobileMoneyError('mobile_money_amount_invalid', 'Montant Mobile Money invalide', 409);
  }
  return {
    currency: provider.currency,
    minorUnit: Number(provider.minor_unit) || 0,
    amountMinor,
    amount: amountMinor / factor,
  };
}

async function findActiveAttempt(orderId, provider) {
  const { rows } = await db.query(
    `SELECT t.*, o.reference AS order_reference
       FROM mobile_money_transactions t
       JOIN orders o ON o.id = t.order_id
      WHERE t.order_id = $1
        AND t.provider = $2
        AND t.status IN ('initiated', 'pending')
      ORDER BY t.created_at DESC
      LIMIT 1`,
    [orderId, provider]
  );
  return rows[0] || null;
}

async function initiateMobileMoney({ orderReference, msisdn = null }) {
  const order = await loadOrderForPayment(orderReference);
  if (!order) throw new MobileMoneyError('order_not_found', 'Commande introuvable', 404);
  if (order.payment_mode !== 'mobile_money') {
    throw new MobileMoneyError('wrong_payment_mode', "Cette commande n'utilise pas Mobile Money", 409);
  }
  if (order.payment_status === 'paid') {
    throw new MobileMoneyError('order_already_paid', 'Commande déjà payée', 409);
  }

  const provider = await resolveOrderProvider(order);
  if (provider.adapter.requiresMsisdn && !String(msisdn || '').trim()) {
    throw new MobileMoneyError('mobile_money_msisdn_required', 'Numéro Mobile Money requis', 400);
  }

  const existing = await findActiveAttempt(order.id, provider.provider);
  if (existing) return { reused: true, transaction: publicTransaction(existing) };

  const amount = await computeAuthoritativeAmount(order, provider);
  let tx;
  try {
    const { rows } = await db.query(
      `INSERT INTO mobile_money_transactions (
         order_id, market_id, provider, msisdn,
         currency, minor_unit, amount_minor, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'initiated')
       RETURNING *`,
      [
        order.id, order.market_id, provider.provider,
        msisdn ? String(msisdn).trim() : null,
        amount.currency, amount.minorUnit, amount.amountMinor,
      ]
    );
    tx = rows[0];
  } catch (err) {
    if (err.code === '23505') {
      const raceWinner = await findActiveAttempt(order.id, provider.provider);
      if (raceWinner) return { reused: true, transaction: publicTransaction(raceWinner) };
    }
    throw err;
  }

  const base = publicBaseUrl();
  const callbackUrl = `${base}/api/payments/mobile-money/callback/${encodeURIComponent(provider.provider)}/${tx.id}`;
  const returnUrl = `${base}/boutique/?mobile_money=return&order=${encodeURIComponent(order.reference)}`;
  const cancelUrl = `${base}/boutique/?mobile_money=cancel&order=${encodeURIComponent(order.reference)}`;

  try {
    // Appel externe HORS transaction DB : évite toute connexion idle-in-tx
    // pendant un opérateur lent ou indisponible.
    const initiated = await provider.adapter.initiate({
      orderReference: order.reference,
      amount: amount.amount,
      currency: amount.currency,
      msisdn,
      callbackUrl,
      returnUrl,
      cancelUrl,
    });

    const { rows } = await db.query(
      `UPDATE mobile_money_transactions
          SET external_transaction_id = $2,
              status = $3,
              provider_status = $4,
              provider_payload = $5::jsonb,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [
        tx.id,
        initiated.externalTransactionId,
        initiated.status || 'pending',
        initiated.providerStatus || 'PENDING',
        JSON.stringify({
          client_action: initiated.clientAction || null,
          provider: initiated.safePayload || {},
        }),
      ]
    );
    return { reused: false, transaction: publicTransaction({ ...rows[0], order_reference: order.reference }) };
  } catch (err) {
    await db.query(
      `UPDATE mobile_money_transactions
          SET status = 'failed',
              provider_status = $2,
              provider_payload = $3::jsonb,
              completed_at = NOW(),
              updated_at = NOW()
        WHERE id = $1
          AND status = 'initiated'`,
      [tx.id, err.code || 'initiation_failed', JSON.stringify({ error_code: err.code || 'provider_error' })]
    ).catch(() => {});
    throw new MobileMoneyError(
      err.code || 'mobile_money_provider_error',
      'Le provider Mobile Money n’a pas pu initier le paiement',
      err.code === 'mobile_money_provider_not_configured' ? 503 : 502
    );
  }
}

function providerContractMatches(tx, providerResult) {
  if (providerResult.currency && String(providerResult.currency).toUpperCase() !== String(tx.currency).toUpperCase()) {
    return { ok: false, reason: 'currency_mismatch' };
  }
  if (providerResult.amount != null) {
    const actualMinor = Math.round(Number(providerResult.amount) * Math.pow(10, Number(tx.minor_unit) || 0));
    if (!Number.isFinite(actualMinor) || actualMinor !== Number(tx.amount_minor)) {
      return { ok: false, reason: 'amount_mismatch' };
    }
  }
  return { ok: true };
}

async function postCommitHooks({ orderId, orderReference, stockBlocked }) {
  if (stockBlocked) return;

  try {
    require('./loyalty-service').handleOrderConfirmed({ orderId })
      .catch(err => log.warn({ err, orderId }, '[MOBILE-MONEY] loyalty hook failed'));
  } catch (err) { log.warn({ err }, '[MOBILE-MONEY] loyalty require failed'); }

  try {
    const notifications = require('./notification-service');
    notifications.notifyPaymentConfirmed(orderId, orderReference)
      .catch(err => log.error({ err, orderId }, '[MOBILE-MONEY] payment notification failed'));
    require('./invoice-service').issueInvoice(orderId)
      .catch(err => log.error({ err, orderId }, '[MOBILE-MONEY] invoice PDF failed'));
  } catch (err) { log.error({ err }, '[MOBILE-MONEY] notification/invoice hook failed'); }

  try {
    require('./purchasing-trigger-service').triggerPurchasing(orderId)
      .catch(async err => {
        log.error({ err, orderId }, '[MOBILE-MONEY] purchasing trigger failed');
        await createAlert(db, {
          type: 'purchasing_trigger_failed',
          entityType: 'order',
          entityId: orderId,
          severity: 'medium',
          title: `triggerPurchasing failed (Mobile Money) — ${orderReference}`,
          description: err.message,
        }).catch(() => {});
      });
  } catch (err) { log.error({ err }, '[MOBILE-MONEY] purchasing require failed'); }
}

async function finalizeSucceededTransaction(tx, providerResult) {
  const client = await db.getClient();
  let pickupCode = null;
  let stockBlocked = false;
  let orderReference = tx.order_reference;

  try {
    await client.query('BEGIN');
    const { rows: [locked] } = await client.query(
      `SELECT t.*, o.reference AS order_reference, o.payment_status, o.relais_id
         FROM mobile_money_transactions t
         JOIN orders o ON o.id = t.order_id
        WHERE t.id = $1
        FOR UPDATE OF t, o`,
      [tx.id]
    );
    if (!locked) throw new MobileMoneyError('mobile_money_transaction_not_found', 'Transaction introuvable', 404);
    orderReference = locked.order_reference;

    if (locked.status === 'succeeded' || locked.payment_status === 'paid') {
      if (locked.status !== 'succeeded') {
        await client.query(
          `UPDATE mobile_money_transactions
              SET status='succeeded', provider_status=$2, completed_at=COALESCE(completed_at,NOW()), updated_at=NOW()
            WHERE id=$1`,
          [locked.id, providerResult.providerStatus || 'SUCCESSFUL']
        );
      }
      await client.query('COMMIT');
      return { alreadyPaid: true, stockBlocked: false, transactionId: locked.id };
    }

    // Le provider a confirmé l'argent. On snapshotte ce fait DANS la même TX
    // que le cycle commande ; un échec du cycle rollbacke ce marquage et laisse
    // la réconciliation rejouable sans perdre le signal provider.
    await client.query(
      `UPDATE mobile_money_transactions
          SET status='succeeded', provider_status=$2,
              provider_payload = provider_payload || $3::jsonb,
              completed_at=NOW(), updated_at=NOW()
        WHERE id=$1`,
      [locked.id, providerResult.providerStatus || 'SUCCESSFUL', JSON.stringify({ provider: providerResult.safePayload || {} })]
    );

    const cycle = await confirmPaymentCycle({
      orderId: locked.order_id,
      actor: { id: null, role: 'system' },
      source: `mobile_money_${locked.provider}`,
      dbClient: client,
      note: `Paiement ${getAdapter(locked.provider).label} reçu (${locked.external_transaction_id || locked.id})`,
    });

    if (!cycle.success) {
      throw new MobileMoneyError('mobile_money_cycle_rejected', cycle.error || 'Cycle paiement rejeté', 502);
    }

    stockBlocked = Boolean(cycle.stockBlocked);
    if (stockBlocked) {
      const items = cycle.insufficientItems || [];
      const incidentNote = '\n[INCIDENT mobile_money_paid_but_stock_blocked] ' +
        items.map(i => `${i.product_name}: dispo=${i.available}, besoin=${i.needed}`).join('; ');
      await appendOrderNote(client, { orderId: locked.order_id, note: incidentNote });
      await createAlert(client, {
        type: 'paid_but_stock_blocked',
        entityType: 'order',
        entityId: locked.order_id,
        severity: 'high',
        title: `Mobile Money encaissé mais stock bloqué — ${locked.order_reference}`,
        description: `${locked.provider} ${locked.external_transaction_id || locked.id} : ` +
          items.map(i => `${i.product_name} dispo=${i.available} besoin=${i.needed}`).join('; '),
      });
    }

    try {
      const secret = await generateAndStoreSecret({
        orderId: locked.order_id,
        relaisId: locked.relais_id || null,
        channel: 'mobile_money',
        dbClient: client,
      });
      pickupCode = secret.code;
    } catch (err) {
      log.error({ err, order_id: locked.order_id }, '[MOBILE-MONEY] pickup secret failed — non-bloquant');
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === 'mobile_money_cycle_rejected') {
      await createAlert(db, {
        type: 'mobile_money_paid_but_cycle_failed',
        entityType: 'order',
        entityId: tx.order_id,
        severity: 'high',
        title: `Mobile Money encaissé mais cycle rejeté — ${orderReference}`,
        description: `${tx.provider} ${tx.external_transaction_id || tx.id} : ${err.message}`,
      }).catch(() => {});
    }
    throw err;
  } finally {
    client.release();
  }

  if (pickupCode) {
    cacheCodeForReveal(tx.order_id, pickupCode)
      .catch(err => log.warn({ err }, '[MOBILE-MONEY] pickup cache failed'));
  }
  postCommitHooks({ orderId: tx.order_id, orderReference, stockBlocked });
  return { alreadyPaid: false, stockBlocked, transactionId: tx.id };
}

async function loadTransaction(transactionId) {
  const { rows } = await db.query(
    `SELECT t.*, o.reference AS order_reference, o.user_id, o.payment_status, o.relais_id,
            m.code AS market_code
       FROM mobile_money_transactions t
       JOIN orders o ON o.id = t.order_id
       JOIN markets m ON m.id = t.market_id
      WHERE t.id = $1
      LIMIT 1`,
    [transactionId]
  );
  return rows[0] || null;
}

async function reconcileMobileMoneyTransaction(transactionId, { expectedProvider = null } = {}) {
  const tx = await loadTransaction(transactionId);
  if (!tx) throw new MobileMoneyError('mobile_money_transaction_not_found', 'Transaction introuvable', 404);
  if (expectedProvider && tx.provider !== expectedProvider) {
    throw new MobileMoneyError('mobile_money_provider_mismatch', 'Provider incohérent', 400);
  }
  if (tx.status === 'succeeded') return { transaction: publicTransaction(tx), reconciled: false };
  if (tx.status === 'failed' || tx.status === 'expired') return { transaction: publicTransaction(tx), reconciled: false };
  if (!tx.external_transaction_id) {
    return { transaction: publicTransaction(tx), reconciled: false };
  }

  const adapter = getAdapter(tx.provider);
  if (!adapter.isConfigured()) {
    throw new MobileMoneyError('mobile_money_provider_not_configured', `${adapter.label} non configuré`, 503);
  }

  // Le callback opérateur n'est JAMAIS une preuve de paiement. On relit
  // systématiquement le statut côté provider avant toute mutation Komerce.
  let providerResult;
  try {
    providerResult = await adapter.getStatus({
      externalTransactionId: tx.external_transaction_id,
      orderReference: tx.order_reference,
      amount: amountMajor(tx.amount_minor, tx.minor_unit),
    });
  } catch (err) {
    throw new MobileMoneyError(
      err.code || 'mobile_money_provider_status_error',
      'Impossible de vérifier le statut auprès du provider Mobile Money',
      502
    );
  }

  const contract = providerContractMatches(tx, providerResult);
  if (!contract.ok) {
    await createAlert(db, {
      type: 'mobile_money_payment_contract_mismatch',
      entityType: 'order',
      entityId: tx.order_id,
      severity: 'high',
      title: `Mobile Money incohérent — ${tx.order_reference}`,
      description: `${tx.provider} ${contract.reason}; attendu=${amountMajor(tx.amount_minor, tx.minor_unit)} ${tx.currency}; ` +
        `reçu=${providerResult.amount ?? '<missing>'} ${providerResult.currency ?? '<missing>'}`,
    }).catch(() => {});
    throw new MobileMoneyError(
      'mobile_money_payment_contract_mismatch',
      'Montant ou devise provider incohérent avec la transaction Komerce',
      409
    );
  }

  if (providerResult.status === 'succeeded') {
    await finalizeSucceededTransaction(tx, providerResult);
    const done = await loadTransaction(tx.id);
    return { transaction: publicTransaction(done), reconciled: true };
  }

  const normalized = providerResult.status === 'expired' ? 'expired'
    : providerResult.status === 'failed' ? 'failed'
      : 'pending';
  const { rows } = await db.query(
    `UPDATE mobile_money_transactions
        SET status=$2, provider_status=$3,
            provider_payload = provider_payload || $4::jsonb,
            completed_at = CASE WHEN $2 IN ('failed','expired') THEN COALESCE(completed_at,NOW()) ELSE completed_at END,
            updated_at=NOW()
      WHERE id=$1
        AND status IN ('initiated','pending')
      RETURNING *`,
    [tx.id, normalized, providerResult.providerStatus || 'UNKNOWN', JSON.stringify({ provider: providerResult.safePayload || {} })]
  );
  return {
    transaction: publicTransaction({ ...(rows[0] || tx), order_reference: tx.order_reference }),
    reconciled: true,
  };
}

async function getTransaction(transactionId) {
  const tx = await loadTransaction(transactionId);
  if (!tx) throw new MobileMoneyError('mobile_money_transaction_not_found', 'Transaction introuvable', 404);
  return { raw: tx, public: publicTransaction(tx) };
}

module.exports = {
  MobileMoneyError,
  getAvailability,
  loadOrderForPayment,
  initiateMobileMoney,
  reconcileMobileMoneyTransaction,
  getTransaction,
  publicTransaction,
  providerContractMatches,
};
