/**
 * @komerce-arch
 * @role          phone
 * @domain        unknown
 * @layer         util
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @used-by       @unknown
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */

'use strict';

/**
 * utils/phone.js — Normalisation téléphone E.164 (back-end)
 *
 * Aligné sur la logique front-end `b-share-phone-guard.js`.
 * Signature : normalizePhone(raw, defaultCountry?)
 *
 * Paramètres :
 *   raw           — chaîne brute (ex: "0699272526", "+33 6 99 27 25 26", "3211234")
 *   defaultCountry — indicatif par défaut ('+33' ou '+269') quand le numéro
 *                    ne commence pas par + ou 00.
 *                    Optionnel. Sans lui, les numéros locaux sans indicatif → null
 *                    (comportement conservateur pour le back-end sans contexte pays).
 *
 * Retour : string E.164 normalisé (ex: "+33699272526") ou null si invalide.
 *
 * Cas couverts :
 *   +33699272526   → "+33699272526"  (déjà E.164)
 *   0033699272526  → "+33699272526"  (00XX → +XX)
 *   0699272526     → "+33699272526"  avec defaultCountry='+33'
 *   3211234        → "+2693211234"   avec defaultCountry='+269'
 *   0699272526     → null            sans defaultCountry (pas de devinette)
 *
 * Exemples d'usage dans auth-guest.js (pas de defaultCountry → conservateur) :
 *   normalizePhone('+33699272526')  // → '+33699272526'
 *   normalizePhone('0699272526')    // → null (pas d'indicatif connu)
 *
 * Exemples d'usage dans le guard téléphone shared-cart (avec defaultCountry) :
 *   normalizePhone('0699272526', '+33')   // → '+33699272526'
 *   normalizePhone('3211234',    '+269')  // → '+2693211234'
 */

function digitsOnly(v) {
  return String(v || '').trim().replace(/[^\d+]/g, '');
}

/**
 * @param {string|null|undefined} raw
 * @param {'+33'|'+269'|string|undefined} [defaultCountry]
 * @returns {string|null}
 */
function normalizePhone(raw, defaultCountry) {
  let value = digitsOnly(raw);
  if (!value) return null;

  // 00XX → +XX
  if (value.startsWith('00')) value = '+' + value.slice(2);

  // Déjà E.164 → valider longueur (8–15 chiffres après le +)
  if (value.startsWith('+')) {
    const digits = value.slice(1);
    return digits.length >= 8 && digits.length <= 15 && /^\d+$/.test(digits)
      ? value
      : null;
  }

  // Numéro local sans indicatif : appliquer defaultCountry si fourni
  if (defaultCountry === '+33') {
    // Supprimer éventuel indicatif sans + (ex: "33699...")
    if (value.startsWith('33')) value = value.slice(2);
    // Supprimer zéro local (ex: "0699..." → "699...")
    if (value.startsWith('0')) value = value.slice(1);
    if (value.length !== 9) return null;
    if (!value.startsWith('6') && !value.startsWith('7')) return null;
    if (!/^\d+$/.test(value)) return null;
    return '+33' + value;
  }

  if (defaultCountry === '+269') {
    // Supprimer éventuel indicatif sans + (ex: "269321...")
    if (value.startsWith('269')) value = value.slice(3);
    if (value.length !== 7) return null;
    if (!/^\d+$/.test(value)) return null;
    return '+269' + value;
  }

  // Sans defaultCountry, on refuse de deviner
  return null;
}

module.exports = { normalizePhone };
