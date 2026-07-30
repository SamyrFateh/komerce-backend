/**
 * @komerce-arch
 * @role          order-domain-helpers
 * @domain        orders
 * @layer         service
 * @criticality   high
 * @inputs        order_payload, wallet_context, reference_seed
 * @outputs       order_reference, wallet_applied_state
 * @depends       db.js, services/wallet-service.js
 * @used-by       routes/orders.js, shared-cart-engine.js, checkout-flows
 * @db-read       orders
 * @db-write      none
 * @db-txn        order_reference_unique, wallet_application_idempotent
 * @doctrine      reference_commande_lisible, wallet_applique_une_fois, helpers_sans_route_http
 * @impact-areas  checkout, orders, wallet, tracking, shared-cart
 * @version       2026-06
 */

/**
 * KOMERCE — Order Service v2.0
 *
 * Helpers commandes : références, codes, wallet.
 * v2.0 : wallet remplace store_credits.
 */

'use strict';

const { randomBytes }   = require('crypto');
const walletService     = require('./wallet-service');

// ─── Génération de références ──────────────────────────────────────────────────

function generateRef() {
  const chars  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const result = [];
  while (result.length < 6) {
    const byte = randomBytes(1)[0];
    if (byte < 252) result.push(chars[byte % 36]);
  }
  return 'K' + result.join('');
}

async function getUniqueRef(db) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const ref      = generateRef();
    const { rows } = await db.query('SELECT id FROM orders WHERE reference = $1', [ref]);
    if (!rows.length) return ref;
  }
  throw new Error('Impossible de générer une référence unique après 5 tentatives');
}

function generateCashCode() {
  const digits = [];
  while (digits.length < 6) {
    const b = randomBytes(1)[0];
    if (b < 250) digits.push(b % 10);
  }
  return digits.join('');
}

// ─── Wallet balance (remplace store_credits) ─────────────────────────────────

async function getAvailableCredits(dbOrClient, userId) {
  const balance = await walletService.getBalance(userId);
  return { total_kmf: balance };
}

module.exports = {
  generateRef,
  getUniqueRef,
  generateCashCode,
  getAvailableCredits,
};
