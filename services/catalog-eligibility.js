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
 */

const db = require('../db');

/**
 * Charge les exclusions actives depuis catalog_exclusions.
 * Une seule requête par import (comme pricingEngine.loadGlobalConfig()),
 * jamais une requête par produit.
 *
 * @returns {Promise<Array>} lignes { layer, label, keywords, categories, constraint_note, legal_note }
 *          triées absolute d'abord (un candidat à la fois absolu et
 *          restreint doit être écarté, pas seulement contraint).
 */
async function loadActiveExclusions() {
  const res = await db.query(
    `SELECT layer, label, keywords, categories, constraint_note, legal_note
       FROM catalog_exclusions
      WHERE is_active = TRUE`
  );
  return res.rows.sort((a, b) => {
    if (a.layer === b.layer) return 0;
    return a.layer === 'absolute' ? -1 : 1;
  });
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

/**
 * Vérifie un candidat normalisé contre la liste d'exclusions actives.
 * Fonction PURE — aucun accès DB ici : permet de tester sans mock DB,
 * et de vérifier tout un import avec une seule liste chargée en amont.
 *
 * @param {Object} candidate    — sortie de scanner.normalizeCandidate() (ou tout objet
 *                                portant product_name/description/supplier_category/komerce_category)
 * @param {Array}  exclusions   — sortie de loadActiveExclusions()
 * @returns {{layer:'absolute'|'restricted', label:string, constraint_note:?string, legal_note:?string}|null}
 *          null = aucune règle ne matche, candidat pleinement éligible.
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

  for (const rule of exclusions) {
    const keywords = rule.keywords || [];
    const categories = rule.categories || [];

    const keywordHit = haystack && keywords.some(k => keywordMatches(haystack, k));
    const categoryHit = categories.some(c => categoryValues.includes(String(c).toLowerCase()));

    if (keywordHit || categoryHit) {
      return {
        layer: rule.layer,
        label: rule.label,
        constraint_note: rule.constraint_note || null,
        legal_note: rule.legal_note || null,
      };
    }
  }
  return null;
}

module.exports = {
  loadActiveExclusions,
  checkEligibility,
  keywordMatches,
};
