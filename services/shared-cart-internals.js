/**
 * @komerce-arch
 * @role          shared-cart-internals
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context
 * @outputs       config, helpers, audit
 * @depends       db.js
 * @used-by       services/shared-cart-creation.js, services/shared-cart-reads.js, services/shared-cart-lifecycle.js, services/shared-cart-items-service.js
 * @db-read       shared_cart_events
 * @db-write      shared_cart_events
 * @db-txn        none
 * @doctrine      domaine_minimal_boutique_first
 * @impact-areas  participant-flow, creator-flow
 * @version       2026-08
 */

'use strict';

/**
 * KOMERCE — Shared cart internals (Boutique First, domaine minimal)
 *
 * Migration 124 : la liste partagée n'a plus de colonne financière ni de
 * fenêtre de paiement propre (contributed_kmf, remaining_kmf,
 * payment_window_ends_at, target_date, expires_at, awaiting_choice_*
 * supprimés). CONFIG est réduit aux constantes encore utilisées : longueur
 * du token public et limite de paniers actifs par créateur.
 */

const crypto = require('crypto');
const db = require('../db');

// ─── Configuration ─────────────────────────────────────────────────────
const CONFIG = {
  TOKEN_LENGTH: 16,                     // 16 caractères Base58 ≈ 95 bits
  MAX_ACTIVE_CARTS_PER_USER: 5,
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

// P5-N3 : délègue à la primitive partagée db.withTransaction.
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
