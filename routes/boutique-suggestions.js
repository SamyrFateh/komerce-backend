/**
 * @komerce-arch
 * @role          boutique-suggestions-http-facade
 * @domain        recommendations
 * @layer         route
 * @criticality   high
 * @inputs        visitor_context, navigation_context, product_context
 * @outputs       ranked_products, discovery_sections, personalization_debug
 * @depends       services/boutique-suggestion-service.js, product-store, doctrine/BOUTIQUE_PERSONNALISATION_NAVIGATION.md
 * @used-by       bootstrap/api-routes.js, modal-suggestions, home-personalization
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        read_mostly, suggestions_non_blocking
 * @doctrine      suggestions_decouverte_non_intrusives, personnalisation_navigation, boutique_canal_decouverte
 * @impact-areas  product-discovery, modal, home-ranking, personalization, catalog
 * @version       2026-06
 */

/**
 * Route : GET /api/boutique/suggestions
 *
 * Surface de ranking boutique — relaie le moteur de personnalisation.
 * Doctrine : docs/doctrine/BOUTIQUE_PERSONNALISATION_NAVIGATION.md
 *
 * Aucun calcul de ranking ici. Ce fichier parse les paramètres, délègue au moteur,
 * et sérialise la réponse.
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { computeSuggestions } = require('../services/boutique-ranking-engine');

// Helper : parse une liste d'UUIDs séparés par virgule, filtre les invalides
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseUUIDs(raw) {
  if (!raw) return [];
  return String(raw).split(',').map(s => s.trim()).filter(s => UUID_RE.test(s));
}

/**
 * GET /api/boutique/suggestions
 *
 * Query params (tous optionnels) :
 *   viewed_product_id   UUID
 *   category            string
 *   subcategory         string
 *   recently_viewed     UUID,UUID,...
 *   cart_product_ids    UUID,UUID,...
 *   search_query        string
 *   limit               int (défaut 6, max 12)
 */
router.get('/', async (req, res, next) => {
  try {
    const {
      viewed_product_id,
      category,
      subcategory,
      recently_viewed: rvRaw,
      cart_product_ids: cartRaw,
      search_query,
      limit,
    } = req.query;

    const signals = {
      viewed_product_id: UUID_RE.test(viewed_product_id || '') ? viewed_product_id : null,
      category:          category  ? String(category).slice(0, 80)  : null,
      subcategory:       subcategory ? String(subcategory).slice(0, 80) : null,
      recently_viewed:   parseUUIDs(rvRaw),
      cart_product_ids:  parseUUIDs(cartRaw),
      search_query:      search_query ? String(search_query).slice(0, 200) : null,
      limit:             limit ? parseInt(limit) : 6,
    };

    const result = await computeSuggestions(signals);
    return res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
