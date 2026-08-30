/**
 * @komerce-arch
 * @role          boutique-suggestions-http-facade
 * @domain        recommendations
 * @layer         route
 * @criticality   high
 * @inputs        visitor_context, navigation_context, product_context, discovery_surface, market_code
 * @outputs       ranked_products, discovery_sections, personalization_debug, local_discovery_cards
 * @depends       services/boutique-ranking-engine.js, services/discovery-rail-service.js, product-store, doctrine/BOUTIQUE_PERSONNALISATION_NAVIGATION.md
 * @used-by       bootstrap/api-routes.js, modal-suggestions, home-personalization, boutique-discovery-rail
 * @db-read       none
 * @db-read-via:discovery-rail-service markets, products, local_stock, local_stock_allocations, services, physical_offers, providers
 * @db-write      none
 * @db-txn        read_mostly, suggestions_non_blocking
 * @doctrine      suggestions_decouverte_non_intrusives, personnalisation_navigation, boutique_canal_decouverte, docs/doctrine/DOCTRINE_DISCOVERY_LOCALE_UNIFIEE.md
 * @impact-areas  product-discovery, modal, home-ranking, personalization, catalog, discovery-rail
 * @version       2026-08
 */

/**
 * Route : GET /api/boutique/suggestions
 *
 * Deux surfaces read-only sous la même façade recommendations :
 * - surface absente : ranking produit historique, inchangé ;
 * - surface=local   : projection DiscoveryCard locale, activation serveur.
 *
 * Aucun calcul métier dans la route : parsing puis délégation au service owner.
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { computeSuggestions } = require('../services/boutique-ranking-engine');
const { getDiscoveryRail } = require('../services/discovery-rail-service');

// Helper : parse une liste d'UUIDs séparés par virgule, filtre les invalides
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseUUIDs(raw) {
  if (!raw) return [];
  return String(raw).split(',').map(s => s.trim()).filter(s => UUID_RE.test(s));
}

/**
 * GET /api/boutique/suggestions
 *
 * Surface locale :
 *   surface             local
 *   market              code KM|YT|CM|CG
 *
 * Ranking historique (tous optionnels) :
 *   viewed_product_id   UUID
 *   category            string
 *   subcategory         string
 *   recently_viewed     UUID,UUID,...
 *   cart_product_ids    UUID,UUID,...
 *   search_query        string
 *   limit               int (défaut 6, max géré par le moteur)
 */
router.get('/', async (req, res, next) => {
  try {
    const { surface, market } = req.query;

    if (surface === 'local') {
      if (!market) {
        return res.status(400).json({ error: 'market est requis pour surface=local' });
      }
      const cards = await getDiscoveryRail({ marketCode: String(market).slice(0, 8) });
      return res.json({ surface: 'local', cards });
    }

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
