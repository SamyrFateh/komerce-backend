/**
 * KOMERCE — Générateurs de références uniques
 */

/**
 * Génère une référence commande : KOM-2026-XXXX
 * Le suffixe est un nombre aléatoire à 4 chiffres zero-padded.
 * En production, remplacer par un séquenceur DB pour garantir l'unicité.
 */
function generateOrderRef() {
  const year  = new Date().getFullYear();
  const seq   = String(Math.floor(1000 + Math.random() * 9000));
  return `KOM-${year}-${seq}`;
}

/**
 * Génère un code cash relais à 6 chiffres (affiché au client + encodé QR)
 */
function generateCashCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Génère un code retrait destinataire à 6 chiffres
 */
function generatePickupCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Génère un code panier partagé : K-XXXX
 */
function generateBasketCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'K-';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * Génère une référence expédition : EXP-2026-XX
 */
function generateShipmentRef() {
  const year = new Date().getFullYear();
  const seq  = String(Math.floor(10 + Math.random() * 90));
  return `EXP-${year}-${seq}`;
}

module.exports = {
  generateOrderRef,
  generateCashCode,
  generatePickupCode,
  generateBasketCode,
  generateShipmentRef,
};
