'use strict';

/**
 * KOMERCE — Garde-fous métier pricing (REFACTO-R1)
 *
 * Fonctions pures de validation/décision extraites de routes/pricing.js.
 * Aucune dépendance DB. Les conditions reproduisent volontairement la
 * coercition JS d'origine pour garantir un iso-comportement octet avec
 * les handlers PUT /apply-price/:id et PUT /apply-all.
 */

/**
 * Réplique la condition historique `!price_kmf || price_kmf <= 0`.
 * @returns {boolean} true si price_kmf est INVALIDE (doit être refusé)
 */
function isPriceInvalid(price_kmf) {
  return !price_kmf || price_kmf <= 0;
}

/**
 * Réplique `!Array.isArray(items) || !items.length`.
 * @returns {boolean} true si le batch est vide/absent
 */
function isBatchEmpty(items) {
  return !Array.isArray(items) || !items.length;
}

/**
 * Réplique `items.length > max`.
 * @returns {boolean} true si le batch dépasse la taille maximale autorisée
 */
function isBatchOversize(items, max) {
  return items.length > max;
}

/**
 * Réplique `survival_price_kmf && price_kmf < Number(survival_price_kmf)`.
 * Doctrine I-08 : refus serveur si le prix tombe sous le seuil de survie
 * transmis par le client (issu de pricing-engine côté front).
 *
 * @returns {number|null} le seuil de survie (Number) si violation, sinon null
 */
function getSurvivalViolation(price_kmf, survival_price_kmf) {
  if (!survival_price_kmf) return null;
  const survival = Number(survival_price_kmf);
  return price_kmf < survival ? survival : null;
}

module.exports = {
  isPriceInvalid,
  isBatchEmpty,
  isBatchOversize,
  getSurvivalViolation,
};
