/**
 * @komerce-arch
 * @role          catalog-draft-editorial-identity
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        candidate.product_name, candidate.description (déjà nettoyés HTML par le connecteur)
 * @outputs       products.name, products.description, products.needs_review (candidats)
 * @depends       @none
 * @used-by       services/catalog-candidate-product-service.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      DOCTRINE_CATALOGUE.md §2 (pas de troncature aveugle), §4 (source jamais perdue — name_source/description_source inchangés), §5 (rejouabilité)
 * @impact-areas  catalog
 * @version       2026-10-v1
 */

'use strict';

// Même borne que la revue qualité FR du domaine (services/catalog-fr-quality.js
// TITLE_MAX) : "titre court" a déjà une définition dans ce contrat, on ne la
// réinvente pas pour les noms fournisseur bruts (EN/AR/ZH).
const { TITLE_MAX: SHORT_NAME_MAX } = require('../catalog-fr-quality');

// Bornes locales à l'extraction "une phrase factuelle" — distinctes de
// DESCRIPTION_MIN/MAX (services/catalog-fr-quality.js), qui qualifient une
// copie marketing FR déjà rédigée, pas une phrase brute extraite du
// fournisseur. Seuils de bon sens, pas une classification métier.
const MIN_FACTUAL_SENTENCE_LENGTH = 8;
const MAX_FACTUAL_SENTENCE_LENGTH = 600;
const SENTENCE_BOUNDARY_RE = /[.!?](?:\s|$)/;

function normalizeSpace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/**
 * Dérive une identité client (nom court, description factuelle) depuis ce
 * que le connecteur a déjà produit — aucune invention, aucun appel IA :
 * extraction mécanique, jamais une reformulation.
 *
 * - name : le nom fournisseur normalisé (espaces uniquement). S'il dépasse
 *   SHORT_NAME_MAX, il n'est JAMAIS tronqué (DOCTRINE_CATALOGUE.md §2) — le
 *   nom complet reste publié et une revue éditoriale est signalée.
 * - description : la première phrase trouvée dans la description
 *   fournisseur. Absente du fournisseur ou aucune phrase fiable trouvée :
 *   aucune description n'est fabriquée, une revue éditoriale est signalée.
 *
 * Ne touche jamais name_source/description_source : l'original fournisseur
 * reste la mémoire de référence (doctrine §4), intégralement préservé par
 * l'appelant.
 *
 * @returns {{name:string, description:string|null, needs_editorial_review:boolean, reasons:string[]}}
 */
function canonicalizeProductIdentity({ product_name, description } = {}) {
  const reasons = [];

  const name = normalizeSpace(product_name);
  if (name.length > SHORT_NAME_MAX) {
    reasons.push('NAME_TOO_LONG_FOR_SHORT_IDENTITY');
  }

  const normalizedDescription = normalizeSpace(description);
  let factualDescription = null;
  if (!normalizedDescription) {
    reasons.push('DESCRIPTION_ABSENT');
  } else {
    const match = SENTENCE_BOUNDARY_RE.exec(normalizedDescription);
    const candidate = match ? normalizedDescription.slice(0, match.index + 1).trim() : null;
    if (candidate
        && candidate.length >= MIN_FACTUAL_SENTENCE_LENGTH
        && candidate.length <= MAX_FACTUAL_SENTENCE_LENGTH) {
      factualDescription = candidate;
    } else {
      reasons.push('NO_RELIABLE_FACTUAL_SENTENCE');
    }
  }

  return {
    name,
    description: factualDescription,
    needs_editorial_review: reasons.length > 0,
    reasons,
  };
}

module.exports = {
  canonicalizeProductIdentity,
  SHORT_NAME_MAX,
  MIN_FACTUAL_SENTENCE_LENGTH,
  MAX_FACTUAL_SENTENCE_LENGTH,
};
