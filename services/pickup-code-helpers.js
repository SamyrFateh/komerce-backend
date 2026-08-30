/**
 * @komerce-arch
 * @role          pickup-code-helpers
 * @domain        logistics
 * @layer         utility
 * @criticality   high
 * @inputs        code_or_string
 * @outputs       code_or_hash_string
 * @depends       none
 * @used-by       services/pickup-secret-service.js, services/pickup-collection-service.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      none
 * @impact-areas  logistics
 * @version       2026-08
 */

/**
 * KOMERCE — Pickup Code Helpers (Lot B7, 2026-08, extrait de
 * services/pickup-secret-service.js domaine 5/5)
 *
 * Fonctions pures de génération/hash/normalisation du code de retrait.
 * Module feuille, sans dépendance, pour permettre à
 * services/pickup-secret-service.js (émission) et
 * services/pickup-collection-service.js (remise) de partager ces primitives
 * sans dépendance circulaire entre eux.
 */

'use strict';

const crypto = require('crypto');

// Alphabet sans confusion visuelle : pas de 0/O/I/1/l
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH   = 8;

/**
 * Génère un code secret de 8 caractères groupés : "A7K-3M9-P2"
 * Espace : 32^8 = 1.1e12 combinaisons
 */
function generatePickupCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let raw = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    raw += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return raw.slice(0, 3) + '-' + raw.slice(3, 6) + '-' + raw.slice(6, 8);
}

/**
 * Hash un code avec salt (sha256).
 * Normalise avant hash : retire tirets/espaces, upper-case.
 */
function hashCode(code, salt) {
  const normalized = String(code || '').replace(/[-\s]/g, '').toUpperCase();
  return crypto.createHash('sha256').update(normalized + salt).digest('hex');
}

/**
 * Normalise un code saisi (retire tirets et espaces, upper-case).
 * Gère null/undefined sans crasher.
 */
function normalizeCode(input) {
  return String(input || '').replace(/[-\s]/g, '').toUpperCase();
}

/**
 * Formate un pickup_secret_last4 en affichage masqué "•••-•XX-XX".
 * Usage : tous les lecteurs (dashboards, tracking) qui affichaient
 * auparavant orders.pickup_code en clair (Lot 2).
 */
function maskLast4(last4) {
  if (!last4) return null;
  return '•••-•' + last4.slice(0, 2) + '-' + last4.slice(2);
}

module.exports = {
  CODE_ALPHABET,
  CODE_LENGTH,
  generatePickupCode,
  hashCode,
  normalizeCode,
  maskLast4,
};
