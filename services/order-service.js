/**
 * KOMERCE — Order Service
 *
 * Fonctions helper liées aux commandes : génération de références,
 * codes de paiement, codes de retrait, crédits boutique disponibles.
 */

'use strict';

const { randomBytes }         = require('crypto');
const { getAvailableCredits } = require('../utils/store-credits');

// ─── Génération de références ──────────────────────────────────────────────────

/**
 * Génère une référence commande 7 chars (K + 6 alphanum).
 * Utilise randomBytes pour éviter tout biais de modulo.
 */
function generateRef() {
  const chars  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const result = [];
  // Rejeter les valeurs > 251 pour éviter le biais de modulo (252 = 7 × 36)
  while (result.length < 6) {
    const byte = randomBytes(1)[0];
    if (byte < 252) result.push(chars[byte % 36]);
  }
  return 'K' + result.join('');
}

/**
 * Génère une référence commande unique (vérifie l'unicité en DB).
 * La colonne `reference` a une contrainte UNIQUE.
 * En cas de collision (extrêmement rare), retente jusqu'à 5 fois.
 *
 * @param {Object} db - DB pool ou transaction client
 */
async function getUniqueRef(db) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const ref      = generateRef();
    const { rows } = await db.query('SELECT id FROM orders WHERE reference = $1', [ref]);
    if (!rows.length) return ref;
  }
  throw new Error('Impossible de générer une référence unique après 5 tentatives');
}

/**
 * generateCashCode — Code cash 6 chiffres crypto-safe (v7.7)
 *
 * Génère un code numérique à 6 chiffres (000000–999999) sans biais de modulo.
 * Valeurs 250–255 rejetées car 250 = 25×10 → division uniforme parfaite.
 *
 * Exemple : "482917"
 *
 * Remplacement du hash hex 16 chars (ex: 0c92c35b321fb02b) — illisible oralement.
 * Un code 6 chiffres se dicte en 3 secondes, sans risque d'erreur.
 */
function generateCashCode() {
  const digits = [];
  while (digits.length < 6) {
    const b = randomBytes(1)[0];
    // Rejeter 250–255 pour éviter le biais de modulo (250 = 25 × 10)
    if (b < 250) digits.push(b % 10);
  }
  return digits.join('');
}

/**
 * Génère un code de retrait 6 caractères alphanumériques (crypto-safe).
 * Exemple : "K7X2R9"
 */
function generatePickupCode() {
  const PICKUP_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: 6 }, () => {
    let b;
    do { b = randomBytes(1)[0]; } while (b >= 216); // 216 = 6 × 36
    return PICKUP_CHARS[b % 36];
  }).join('');
}

// ─── Crédits boutique ──────────────────────────────────────────────────────────

/**
 * Retourne le total des crédits boutique disponibles pour un utilisateur.
 *
 * @param {Object} dbClient - DB pool ou transaction client
 * @param {string} userId   - UUID utilisateur
 * @returns {{ total_kmf: number }}
 */
async function getAvailableOrderCredits(dbClient, userId) {
  const { total_kmf } = await getAvailableCredits(dbClient, userId);
  return { total_kmf };
}

module.exports = {
  generateRef,
  getUniqueRef,
  generateCashCode,
  generatePickupCode,
  getAvailableCredits: getAvailableOrderCredits,
};
