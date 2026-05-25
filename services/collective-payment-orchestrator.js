/**
 * KOMERCE — Legacy Collective Payment Orchestrator tombstone
 *
 * Le modèle Panier Événement Collectif / Workspace est désactivé.
 * Doctrine active : boutique-first via le panier partagé.
 *
 * Ce module reste exporté pour compatibilité avec server.js, mais ne lance
 * plus aucun cron, ne crée plus de PaymentIntent et ne traite plus de webhook.
 */

'use strict';

const log = require('../utils/logger').child({ module: 'collective-payment-orchestrator-disabled' });

function disabledError() {
  const err = new Error('collective_workspace_disabled');
  err.statusCode = 410;
  return err;
}

function startExpirationCron() {
  log.info('[CollectivePay disabled] expiration cron not started');
  return null;
}

async function createOrGetPaymentIntent() {
  throw disabledError();
}

async function handlePaymentIntentCapturable() {
  log.warn('[CollectivePay disabled] capturable webhook ignored');
  return null;
}

async function handlePaymentIntentCanceled() {
  log.warn('[CollectivePay disabled] canceled webhook ignored');
  return null;
}

async function expireOldSessions() {
  log.info('[CollectivePay disabled] expireOldSessions skipped');
  return { expired: 0, disabled: true };
}

module.exports = {
  startExpirationCron,
  createOrGetPaymentIntent,
  handlePaymentIntentCapturable,
  handlePaymentIntentCanceled,
  expireOldSessions,
};
