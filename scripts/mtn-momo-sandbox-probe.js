'use strict';

/**
 * Safe MTN MoMo Sandbox probe for Komerce staging.
 *
 * Verifies, through the real MTN provider adapter and without logging secrets:
 *   1. runtime is non-production and MTN target is sandbox;
 *   2. Collections OAuth credentials are accepted;
 *   3. a Congo/XAF business payment is translated only at the provider boundary;
 *   4. RequestToPay is accepted and its status can be reconciled;
 *   5. the sandbox transport never leaks EUR as Komerce business truth.
 *
 * It does not mutate Komerce orders or the database.
 */

const mtn = require('../services/mobile-money/mtn-momo-cg');

const SANDBOX_BASE_URL = 'https://sandbox.momodeveloper.mtn.com';
const REQUIRED = [
  'MTN_MOMO_CG_SUBSCRIPTION_KEY',
  'MTN_MOMO_CG_API_USER',
  'MTN_MOMO_CG_API_KEY',
];

function fail(message) {
  console.error(`[MTN-PROBE] FAIL ${message}`);
  process.exitCode = 1;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const runtime = String(process.env.KOMERCE_ENV || process.env.NODE_ENV || '')
    .trim()
    .toLowerCase();
  const target = String(process.env.MTN_MOMO_CG_TARGET_ENVIRONMENT || '')
    .trim()
    .toLowerCase();
  const baseUrl = String(process.env.MTN_MOMO_CG_BASE_URL || '')
    .trim()
    .replace(/\/+$/, '');

  if (runtime === 'production') {
    throw new Error('refus d’exécuter le probe sur le runtime métier production');
  }
  if (target !== 'sandbox') {
    throw new Error(`MTN_MOMO_CG_TARGET_ENVIRONMENT doit être sandbox (reçu: ${target || 'vide'})`);
  }
  if (baseUrl !== SANDBOX_BASE_URL) {
    throw new Error('MTN_MOMO_CG_BASE_URL ne pointe pas vers le Sandbox MTN attendu');
  }
  for (const key of REQUIRED) {
    if (!String(process.env[key] || '').trim()) {
      throw new Error(`${key} absent`);
    }
  }
  if (!mtn.isConfigured()) {
    throw new Error('adapter MTN considéré non configuré');
  }

  const orderReference = `KOMERCE-STAGING-PROBE-${Date.now()}`;
  const initiated = await mtn.initiate({
    orderReference,
    // Vérité métier volontairement XAF : l'adapter doit isoler la contrainte
    // EUR du Sandbox sans modifier le marché Congo.
    amount: 26560,
    currency: 'XAF',
    // MTN documente que tout numéro hors scénarios prédéfinis aboutit au cas
    // nominal de succès dans le Sandbox.
    msisdn: '242061234567',
    callbackUrl: 'https://komerce.co/api/payments/mobile-money/callback/mtn_momo/00000000-0000-4000-8000-000000000000',
  });

  if (initiated.status !== 'pending' || !initiated.externalTransactionId) {
    throw new Error('RequestToPay Sandbox non accepté par l’adapter');
  }
  if (initiated.safePayload?.sandbox_transport !== true
      || Number(initiated.safePayload?.amount) !== 1000
      || initiated.safePayload?.currency !== 'EUR') {
    throw new Error('isolation XAF → transport Sandbox EUR non appliquée');
  }
  console.log('[MTN-PROBE] OAuth + RequestToPay via adapter OK');
  console.log('[MTN-PROBE] Congo XAF preserved; provider transport isolated to Sandbox EUR');

  let status = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await sleep(attempt === 0 ? 1500 : 1000);
    status = await mtn.getStatus({ externalTransactionId: initiated.externalTransactionId });
    if (status.status !== 'pending') break;
  }

  if (!status) throw new Error('aucun statut MTN reçu');
  if (status.amount !== null || status.currency !== null) {
    throw new Error('la devise/montant Sandbox a fui dans le contrat économique Komerce');
  }
  if (status.status !== 'succeeded') {
    throw new Error(`statut Sandbox nominal attendu succeeded, reçu ${status.status}`);
  }

  console.log(`[MTN-PROBE] Status read OK: ${status.providerStatus}`);
  console.log('[MTN-PROBE] PASS adapter XAF → Sandbox → succeeded');
}

main().catch(err => fail(err.message));
