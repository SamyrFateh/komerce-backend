/**
 * @komerce-arch
 * @role          catalog-eligibility
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        normalized_candidate, active_exclusions
 * @outputs       eligibility_verdict
 * @depends       db.js
 * @used-by       services/suppliers/catalog-import-orchestrator.js
 * @db-read       catalog_exclusions
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md
 * @impact-areas  catalog, sourcing
 * @version       2026-08
 */

'use strict';

/**
 * KOMERCE — Étage ③ Éligibilité (DOCTRINE_CATALOGUE.md §3)
 * ═══════════════════════════════════════════════════════════════════
 *
 * "Ce que Komerce peut recevoir" — avant toute traduction, avant tout
 * pricing (doctrine : "on ne raffine pas ce qu'on n'embarquera pas").
 * Deux couches, jamais en dur dans le code (§7 interdits) : la liste
 * vit dans catalog_exclusions (migration 098, K-1).
 *
 *   - absolute   : douane/loi, non ré-évaluable → le candidat est écarté
 *                  (jamais importé, jamais traduit, jamais pricé).
 *   - restricted : embarquement contraint (ex. batteries lithium →
 *                  maritime forcé) → le candidat continue le pipeline,
 *                  mais porte sa contrainte pour l'étage ④ (rails).
 *
 * Matching sur la donnée SOURCE (EN) : product_name, description,
 * supplier_category, komerce_category — insensible à la casse.
 * Une correspondance mot-clé OU catégorie suffit à qualifier une règle.
 *
 * IMPORTANT : la priorité absolute > restricted est garantie ICI, même si
 * un appelant fournit une liste non triée. Le verdict porte aussi la preuve
 * exacte du match pour rendre tout rejet explicable et auditable.
 */

const db = require('../db');

function layerRank(layer) {
  if (layer === 'absolute') return 0;
  if (layer === 'restricted') return 1;
  return 2;
}

function orderRules(exclusions) {
  return [...(exclusions || [])].sort((a, b) => layerRank(a?.layer) - layerRank(b?.layer));
}

/**
 * Charge les exclusions actives depuis catalog_exclusions.
 * Une seule requête par import (comme pricingEngine.loadGlobalConfig()),
 * jamais une requête par produit.
 */
async function loadActiveExclusions() {
  const res = await db.query(
    `SELECT layer, label, keywords, categories, constraint_note, legal_note
       FROM catalog_exclusions
      WHERE is_active = TRUE`
  );
  return orderRules(res.rows);
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Les mots-clés métier sont des termes/phrases, pas des sous-chaînes.
 * Exemple : `gun` ne doit jamais exclure Gyeongbokgung et `replica` ne doit
 * pas exclure Replicant. Les bornes sont alphanumériques ASCII car le
 * vocabulaire d'exclusion source est actuellement anglais/technique.
 */
function keywordMatches(haystack, keyword) {
  const term = String(keyword || '').trim().toLowerCase();
  if (!term) return false;
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegex(term)}([^a-z0-9]|$)`, 'i');
  return pattern.test(String(haystack || ''));
}

function matchEvidence(haystack, categoryValues, rule) {
  const matchedKeyword = (rule.keywords || []).find((keyword) => keywordMatches(haystack, keyword));
  if (matchedKeyword != null) {
    return { type: 'keyword', value: String(matchedKeyword) };
  }

  const matchedCategory = (rule.categories || []).find((category) =>
    categoryValues.includes(String(category).toLowerCase())
  );
  if (matchedCategory != null) {
    return { type: 'category', value: String(matchedCategory) };
  }

  return null;
}

/**
 * Vérifie un candidat normalisé contre la liste d'exclusions actives.
 * Fonction PURE — aucun accès DB ici : permet de tester sans mock DB,
 * et de vérifier tout un import avec une seule liste chargée en amont.
 *
 * @returns {{layer:'absolute'|'restricted', label:string, constraint_note:?string,
 *            legal_note:?string, match:{type:'keyword'|'category',value:string}}|null}
 */
function checkEligibility(candidate, exclusions) {
  if (!candidate || !Array.isArray(exclusions) || !exclusions.length) return null;

  const haystack = [
    candidate.product_name,
    candidate.description,
    candidate.supplier_category,
    candidate.komerce_category,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const categoryValues = [candidate.supplier_category, candidate.komerce_category]
    .filter(Boolean)
    .map(c => String(c).toLowerCase());

  for (const rule of orderRules(exclusions)) {
    const match = matchEvidence(haystack, categoryValues, rule);
    if (!match) continue;

    return {
      layer: rule.layer,
      label: rule.label,
      constraint_note: rule.constraint_note || null,
      legal_note: rule.legal_note || null,
      match,
    };
  }
  return null;
}

module.exports = {
  loadActiveExclusions,
  checkEligibility,
  keywordMatches,
  orderRules,
  matchEvidence,
};
