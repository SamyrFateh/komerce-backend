/**
 * utils/pickup.js — Code de retrait colis
 *
 * Génère et valide les codes de retrait envoyés aux clients pour
 * récupérer leur colis au point relais.
 *
 * Format : 6 caractères alphanumériques uppercase, sans ambiguïté visuelle
 *          (pas de O/0, pas de I/1, pas de S/5, pas de B/8)
 *
 * Cycle de vie :
 *   1. Colis → available → generatePickupCode() → sauvé dans parcels.pickup_code
 *   2. notifyParcelScan() envoie le code au client par WhatsApp
 *   3. Client présente le code au relais
 *   4. Relais entre le code → POST /api/relais/handover → validatePickupCode()
 *   5. Validation OK → parcel.status = 'collected', pickup_confirmed_at = NOW()
 */

'use strict';

// Alphabet sans ambiguïté visuelle (pas de O, 0, I, 1, S, 5, B, 8)
const ALPHABET = 'ACDEFGHJKLMNPQRTUVWXYZ234679';
const DEFAULT_LENGTH = 6;
const DEFAULT_EXPIRY_HOURS = 48;

/**
 * Génère un code de retrait aléatoire.
 * @param {number} [length=6] — nombre de caractères
 * @returns {string} — ex: "R7K4MP"
 */
function generatePickupCode(length = DEFAULT_LENGTH) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

/**
 * Vérifie si un code de retrait est expiré.
 * @param {Date|string} sentAt — parcels.pickup_code_sent_at (ou available_at fallback)
 * @param {number} [expiryHours=48] — durée de validité
 * @returns {boolean}
 */
function isPickupCodeExpired(sentAt, expiryHours = DEFAULT_EXPIRY_HOURS) {
  if (!sentAt) return true;
  const elapsed = (Date.now() - new Date(sentAt).getTime()) / 3_600_000;
  return elapsed > expiryHours;
}

/**
 * Valide un code entré par le relais contre les données du colis.
 *
 * Retourne un objet { valid, reason } :
 *   valid  : true si le code est correct et non expiré
 *   reason : message d'erreur si valid = false
 *
 * @param {string} inputCode   — code saisi par l'agent relais
 * @param {object} parcel      — ligne DB parcels (pickup_code, pickup_code_sent_at, available_at, status, pickup_confirmed_at)
 * @param {number} [expiryHours=48]
 * @returns {{ valid: boolean, reason?: string }}
 */
function validatePickupCode(inputCode, parcel, expiryHours = DEFAULT_EXPIRY_HOURS) {
  if (!inputCode || typeof inputCode !== 'string') {
    return { valid: false, reason: 'Code manquant' };
  }

  const normalized = inputCode.trim().toUpperCase();

  if (!parcel.pickup_code) {
    return { valid: false, reason: 'Aucun code de retrait généré pour ce colis' };
  }

  if (normalized !== parcel.pickup_code.toUpperCase()) {
    return { valid: false, reason: 'Code incorrect' };
  }

  if (parcel.pickup_confirmed_at) {
    return { valid: false, reason: 'Colis déjà remis — code déjà utilisé' };
  }

  if (parcel.status === 'collected') {
    return { valid: false, reason: 'Colis déjà marqué comme collecté' };
  }

  if (parcel.status !== 'available') {
    return { valid: false, reason: `Colis non disponible (statut: ${parcel.status})` };
  }

  // Expiration — on utilise pickup_code_sent_at ou available_at comme fallback
  const refDate = parcel.pickup_code_sent_at || parcel.available_at;
  if (isPickupCodeExpired(refDate, expiryHours)) {
    return { valid: false, reason: `Code expiré (validité ${expiryHours}h). L'admin peut régénérer un nouveau code.` };
  }

  return { valid: true };
}

module.exports = { generatePickupCode, validatePickupCode, isPickupCodeExpired };
