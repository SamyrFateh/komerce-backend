/**
 * @komerce-arch
 * @role          shared-cart-internals
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context
 * @outputs       config, helpers, audit
 * @depends       db.js
 * @used-by       services/shared-cart-creation.js, services/shared-cart-reads.js, services/shared-cart-contributions.js, services/shared-cart-lifecycle.js
 * @db-read       shared_cart_events
 * @db-write      shared_cart_events
 * @db-txn        none
 * @doctrine      none
 * @impact-areas  participant-flow, creator-flow
 * @version       2026-06
 */

'use strict';

const crypto = require('crypto');
const db = require('../db');

// ─── Configuration ─────────────────────────────────────────────────────
const CONFIG = {
  TOKEN_LENGTH: 16,                     // 16 caractères Base58 ≈ 95 bits
  DEFAULT_EXPIRATION_DAYS: 30,
  MIN_CONTRIBUTION_KMF: 2500,           // ~5 EUR
  MAX_CONTRIBUTION_KMF: 500000,         // ~1000 EUR — au-delà, KYC requis
  MAX_ACTIVE_CARTS_PER_USER: 5,
  PAYMENT_WINDOW_HOURS: 48,             // Fenêtre paiement CLOSED → AWAITING_CHOICE
  PAYMENT_WINDOW_MAX_DAYS: 14,          // Plafond fenêtre « prêt à payer » (doctrine §5/§9)
  AWAITING_CHOICE_HOURS: 72,            // Délai créateur AWAITING_CHOICE → expired
  ARCHIVE_AFTER_DAYS: 7,               // expired → archived
};

// Base58 (sans 0/O/I/l) pour token URL-safe lisible
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function generateToken() {
  const bytes = crypto.randomBytes(CONFIG.TOKEN_LENGTH);
  let token = '';
  for (let i = 0; i < CONFIG.TOKEN_LENGTH; i++) {
    token += BASE58_ALPHABET[bytes[i] % BASE58_ALPHABET.length];
  }
  return token;
}

// ─── Helpers ──────────────────────────────────────────────────────────
function r(n) { return Math.round(Number(n) || 0); }

// P5-N3 : délègue à la primitive partagée db.withTransaction — interface
// conservée ici (shared-cart-contributions.js, shared-cart-creation.js et
// shared-cart-lifecycle.js importent withTransaction depuis ce module).
const { withTransaction } = db;

// ─── Audit ────────────────────────────────────────────────────────────
async function addEvent(client, sharedCartId, eventType, actor, payload) {
  await client.query(
    `INSERT INTO shared_cart_events (shared_cart_id, event_type, actor_type, actor_id, payload)
       VALUES ($1, $2, $3, $4, $5)`,
    [sharedCartId, eventType, actor?.type || null, actor?.id || null, payload || {}]
  );
}

module.exports = { CONFIG, generateToken, r, withTransaction, addEvent };
