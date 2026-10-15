/**
 * @komerce-arch
 * @role          catalog-draft-editorial-identity
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        candidate.product_name, candidate.description, candidate.source_locale (déjà nettoyés HTML par le connecteur)
 * @outputs       products.name, products.description (proposition), products.needs_review (candidats)
 * @depends       services/catalog-fr-quality.js (TITLE_MAX, looksFrench, englishResidues — mêmes garde-fous, aucun nouveau moteur linguistique)
 * @used-by       services/catalog-candidate-product-service.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      DOCTRINE_CATALOGUE.md §2 (pas de troncature aveugle), §4 (langue FR éditoriale — une source connector_raw non française n'est jamais "prête" ; source/description_source jamais perdus), §5 (rejouabilité)
 * @impact-areas  catalog
 * @version       2026-10-v2
 */

'use strict';

// Même borne que la revue qualité FR du domaine (services/catalog-fr-quality.js
// TITLE_MAX) : "titre court" a déjà une définition dans ce contrat, on ne la
// réinvente pas pour les noms fournisseur bruts (EN/AR/ZH). looksFrench/
// englishResidues : mêmes détecteurs statiques que le FR Quality Pass
// (doctrine §4.1) — aucun nouveau moteur linguistique, aucune traduction.
const { TITLE_MAX: SHORT_NAME_MAX, looksFrench, englishResidues } = require('../catalog-fr-quality');

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
 * Dérive une identité client (nom court, description — PROPOSITION) depuis
 * ce que le connecteur a déjà produit — aucune invention, aucun appel IA :
 * extraction mécanique, jamais une reformulation.
 *
 * IMPORTANT — ce que cette fonction NE prouve PAS : couper au premier point
 * trouvé ne démontre jamais qu'une phrase est factuelle (elle peut être un
 * slogan, une troncature d'abréviation ou de cote numérique). La phrase
 * extraite reste donc une PROPOSITION, jamais une fiche qualifiée fiable par
 * construction. `needs_editorial_review=false` n'est renvoyé que lorsqu'une
 * qualité FR est effectivement démontrée par les détecteurs statiques déjà
 * utilisés par le FR Quality Pass (looksFrench/englishResidues,
 * services/catalog-fr-quality.js) — jamais par la seule présence d'une
 * ponctuation.
 *
 * - name : le nom fournisseur normalisé (espaces uniquement). S'il dépasse
 *   SHORT_NAME_MAX, il n'est JAMAIS tronqué (DOCTRINE_CATALOGUE.md §2) — le
 *   nom complet reste publié et une revue éditoriale est signalée.
 * - description : la proposition reste préservée dans le champ (rien n'est
 *   perdu, même sous revue — DOCTRINE_CATALOGUE.md §5) ; seul le marquage
 *   needs_review distingue une proposition démontrée d'une proposition à
 *   relire.
 * - source_locale non française (ou inconnue) : une source brute
 *   `connector_raw` non française ne peut jamais être déclarée prête
 *   éditorialement (DOCTRINE_CATALOGUE.md §4) — revue systématiquement
 *   signalée, sans jamais bloquer la création du brouillon.
 *
 * Ne touche jamais name_source/description_source : l'original fournisseur
 * reste la mémoire de référence (doctrine §4), intégralement préservé par
 * l'appelant.
 *
 * @returns {{name:string, description:string|null, needs_editorial_review:boolean, reasons:string[]}}
 */
function canonicalizeProductIdentity({ product_name, description, source_locale } = {}) {
  const reasons = [];

  const name = normalizeSpace(product_name);
  if (name.length > SHORT_NAME_MAX) {
    reasons.push('NAME_TOO_LONG_FOR_SHORT_IDENTITY');
  }

  const normalizedDescription = normalizeSpace(description);
  let proposedDescription = null;
  if (!normalizedDescription) {
    reasons.push('DESCRIPTION_ABSENT');
  } else {
    const match = SENTENCE_BOUNDARY_RE.exec(normalizedDescription);
    const candidate = match ? normalizedDescription.slice(0, match.index + 1).trim() : null;
    if (candidate
        && candidate.length >= MIN_FACTUAL_SENTENCE_LENGTH
        && candidate.length <= MAX_FACTUAL_SENTENCE_LENGTH) {
      // Préservée comme proposition quoi qu'il arrive (rien n'est perdu) ;
      // la ponctuation seule ne prouve rien, d'où le contrôle qui suit.
      proposedDescription = candidate;
      if (!looksFrench(candidate) || englishResidues(candidate).length > 0) {
        reasons.push('PROPOSED_SENTENCE_NOT_DEMONSTRATED_FR_QUALITY');
      }
    } else {
      reasons.push('NO_RELIABLE_FACTUAL_SENTENCE');
    }
  }

  const locale = typeof source_locale === 'string' ? source_locale.trim().toLowerCase() : '';
  if (locale !== 'fr') {
    reasons.push('NON_FR_SOURCE_NOT_EDITORIALLY_READY');
  }

  return {
    name,
    description: proposedDescription,
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
