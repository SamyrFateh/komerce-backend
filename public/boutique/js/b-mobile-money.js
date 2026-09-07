/**
 * @komerce-arch
 * @role          boutique-mobile-money-client
 * @domain        payment
 * @layer         ui-boundary
 * @criticality   critical
 * @inputs        relay_id, order_reference, msisdn, transaction_id
 * @outputs       provider_availability, payment_transaction_status
 * @depends       b-utils.js, routes/payments-mobile-money.js
 * @used-by       b-checkout.js
 * @doctrine      provider_availability_server_authoritative, no_silent_fallback, bounded_polling
 * @impact-areas  checkout, payments
 * @version       2026-09
 */
'use strict';

import { apiGet, apiPost } from './b-utils.js';

const FINAL_STATUSES = new Set(['succeeded', 'failed', 'expired']);

export function isMobileMoneyFinalStatus(status) {
  return FINAL_STATUSES.has(String(status || '').toLowerCase());
}

export async function getMobileMoneyAvailabilityForRelay(relayId) {
  if (!relayId) return { available: false, reason: 'relay_required' };
  return apiGet(`/api/payments/mobile-money/availability?relais_id=${encodeURIComponent(relayId)}`, {
    retries: 0,
    timeoutMs: 6000,
  });
}

export async function initiateMobileMoneyPayment(orderReference, msisdn) {
  if (!orderReference) throw new Error('Référence commande Mobile Money requise');
  const body = { order_reference: orderReference };
  if (String(msisdn || '').trim()) body.msisdn = String(msisdn).trim();
  return apiPost('/api/payments/mobile-money/initiate', body, { retries: 0, timeoutMs: 12000 });
}

export async function refreshMobileMoneyPayment(transactionId) {
  if (!transactionId) throw new Error('Transaction Mobile Money requise');
  return apiPost(
    `/api/payments/mobile-money/transactions/${encodeURIComponent(transactionId)}/refresh`,
    {},
    { retries: 0, timeoutMs: 12000 }
  );
}

/**
 * Polling borné côté UI. Le cron backend reste le filet de sécurité si l'onglet
 * est fermé ou si le callback opérateur se perd.
 */
export async function waitForMobileMoneyPayment(transactionId, {
  maxAttempts = 45,
  intervalMs = 2000,
  onUpdate = null,
  sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  let lastTransaction = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const result = await refreshMobileMoneyPayment(transactionId);
    lastTransaction = result?.transaction || null;
    if (lastTransaction && typeof onUpdate === 'function') onUpdate(lastTransaction);
    if (isMobileMoneyFinalStatus(lastTransaction?.status)) {
      return { transaction: lastTransaction, timed_out: false };
    }
    if (attempt < maxAttempts - 1) await sleep(intervalMs);
  }
  return { transaction: lastTransaction, timed_out: true };
}
