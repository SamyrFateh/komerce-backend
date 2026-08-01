/**
 * @komerce-arch
 * @role          name-normalize
 * @domain        shared
 * @layer         util
 * @criticality   high
 * @inputs        raw_string
 * @outputs       normalized_string, boolean
 * @depends       (none)
 * @used-by       services/pickup-authorization-service.js, services/pickup-secret-service.js
 * @doctrine      exceptional_pickup_strict_normalized_match
 * @impact-areas  auth-identity, logistics
 * @version       2026-07
 */

/**
 * KOMERCE — Helper canonique de normalisation des noms (Lot 5)
 *
 * Utilisé par la procédure de retrait exceptionnel par autorisation
 * nominative : compare le nom saisi par l'agent (après contrôle visuel
 * d'une pièce d'identité) contre l'autorisation courante du compte.
 *
 * Doctrine (§ du lot) : correspondance STRICTE après normalisation.
 * Explicitement SANS :
 *   - correspondance floue / distance de Levenshtein (Fatima ≠ Fatma)
 *   - correspondance par initiales (J ≠ Jean)
 *   - permutation libre des mots (Jean Pierre ≠ Pierre Jean)
 *
 * La normalisation gomme uniquement les variations bénignes de saisie :
 *   - casse
 *   - accents
 *   - espaces multiples / en bordure, espace insécable
 *   - traits d'union (et variantes de tiret) ≡ espace
 *   - apostrophes typographiques unifiées
 */

'use strict';

// Variantes de tiret (hyphen, non-breaking hyphen, figure dash, en dash,
// em dash, horizontal bar) + le trait d'union ASCII lui-même — tous traités
// comme un espace, au même titre qu'un espace de séparation entre mots.
const DASH_VARIANTS_RE = /[\u002D\u2010-\u2015]/g;

// Apostrophes typographiques (right single quote, low-9 quote, prime, etc.)
// unifiées vers l'apostrophe droite ASCII.
const APOSTROPHE_VARIANTS_RE = /[\u2018\u2019\u201A\u201B\u2032]/g;

// Espace insécable (et variantes) traité comme un espace normal.
const SPACE_VARIANTS_RE = /[\u00A0\u2000-\u200A\u202F\u205F]/g;

function normalizeName(input) {
  if (input === null || input === undefined) return '';

  const str = String(input);

  return str
    .replace(SPACE_VARIANTS_RE, ' ')
    .replace(DASH_VARIANTS_RE, ' ')
    .replace(APOSTROPHE_VARIANTS_RE, "'")
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // accents
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Comparaison stricte de deux paires (prénoms, nom) après normalisation.
 * Les deux paires doivent être non vides pour matcher — deux paires vides
 * ne constituent jamais une correspondance valide.
 */
function namesMatch(a, b) {
  const aGiven  = normalizeName(a && a.givenNames);
  const aFamily = normalizeName(a && a.familyName);
  const bGiven  = normalizeName(b && b.givenNames);
  const bFamily = normalizeName(b && b.familyName);

  if (!aGiven || !aFamily || !bGiven || !bFamily) return false;

  return aGiven === bGiven && aFamily === bFamily;
}

module.exports = { normalizeName, namesMatch };
