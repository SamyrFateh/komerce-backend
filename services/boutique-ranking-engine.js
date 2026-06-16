/**
 * KOMERCE — Boutique Ranking Engine
 * ══════════════════════════════════
 *
 * Moteur de personnalisation de l'ordre de découverte boutique.
 *
 * Doctrine : docs/doctrine/BOUTIQUE_PERSONNALISATION_NAVIGATION.md
 *
 * Ce service NE MODIFIE PAS le catalogue. Il calcule un score de pertinence
 * et une raison explicable pour chaque suggestion, à partir de signaux contextuels.
 *
 * Consommé par :
 *   routes/boutique-suggestions.js → GET /api/boutique/suggestions
 *
 * NON consommé par :
 *   b-modal.js / b-modal-suggestions.js (surfaces d'affichage passives côté frontend)
 */

'use strict';

const db = require('../db');

// ── Poids des signaux (doctrine §4) ────────────────────────────────
const SIGNAL_WEIGHTS = {
  same_subcategory:  50,
  same_category:     30,
  recently_viewed:   20,
  cart_complement:   15,
  search_match:       8,
  popular_baseline:   5,
};

// ── Raisons canoniques (doctrine §5) ───────────────────────────────
const REASON_LABELS = {
  same_subcategory: 'Souvent acheté ensemble',
  same_category:    'Dans la même catégorie',
  recently_viewed:  'Vous avez consulté',
  cart_complement:  'Complète votre panier',
  popular_in_category: 'Populaire dans cette catégorie',
  editorial:        'Sélection Komerce',
};

function r(n) { return Math.round(Number(n) || 0); }

/**
 * Calcule les suggestions de produits pour une session boutique.
 *
 * @param {Object} signals
 *   viewed_product_id   : string|null  — UUID du produit consulté
 *   category            : string|null
 *   subcategory         : string|null
 *   recently_viewed     : string[]     — UUIDs vus en session
 *   cart_product_ids    : string[]     — UUIDs dans le panier
 *   search_query        : string|null
 *   limit               : number       — défaut 6, max 12
 *
 * @returns {Promise<{count, suggestions, signals_used, computed_at}>}
 */
async function computeSuggestions(signals = {}) {
  const {
    viewed_product_id = null,
    category          = null,
    subcategory       = null,
    recently_viewed   = [],
    cart_product_ids  = [],
    search_query      = null,
    limit             = 6,
  } = signals;

  const safeLimit = Math.min(Math.max(1, parseInt(limit) || 6), 12);

  // Identifiants à exclure des résultats (le produit lui-même)
  const excludeIds = new Set();
  if (viewed_product_id) excludeIds.add(viewed_product_id);

  // ── 1. Charger le catalogue actif ────────────────────────────────
  // Filtre minimal : actif + prix renseigné. Le moteur ne filtre pas autrement.
  const { rows: products } = await db.query(
    `SELECT
       p.id, p.name, p.category, p.subcategory,
       p.price_kmf, p.image_url,
       COALESCE(p.sku, '') AS sku,
       COALESCE(order_stats.sale_count, 0) AS sale_count
     FROM products p
     LEFT JOIN (
       SELECT oi.product_id, COUNT(*) AS sale_count
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
        WHERE o.status NOT IN ('cancelled', 'refunded')
        GROUP BY oi.product_id
     ) order_stats ON order_stats.product_id = p.id
     WHERE p.is_active = TRUE
       AND p.price_kmf > 0`
  );

  if (!products.length) {
    return { count: 0, suggestions: [], signals_used: [], computed_at: new Date().toISOString() };
  }

  // ── 2. Indexer les signaux ────────────────────────────────────────
  const recentlyViewedSet  = new Set(recently_viewed);
  const cartSet            = new Set(cart_product_ids);
  const signalsUsed        = [];

  if (category)           signalsUsed.push('category');
  if (subcategory)        signalsUsed.push('subcategory');
  if (recently_viewed.length) signalsUsed.push('recently_viewed');
  if (cart_product_ids.length) signalsUsed.push('cart_complement');
  if (search_query)       signalsUsed.push('search_query');

  // ── 3. Scorer chaque produit ─────────────────────────────────────
  const scored = [];

  for (const p of products) {
    if (excludeIds.has(p.id)) continue;

    let score = 0;
    let reasonCode = 'editorial';

    // Signal : même sous-catégorie (le plus fort)
    if (subcategory && p.subcategory === subcategory) {
      score += SIGNAL_WEIGHTS.same_subcategory;
      reasonCode = 'same_subcategory';
    }

    // Signal : même catégorie
    if (category && p.category === category) {
      score += SIGNAL_WEIGHTS.same_category;
      if (reasonCode === 'editorial') reasonCode = 'same_category';
    }

    // Signal : vu récemment
    if (recentlyViewedSet.has(p.id)) {
      score += SIGNAL_WEIGHTS.recently_viewed;
      if (reasonCode === 'editorial') reasonCode = 'recently_viewed';
    }

    // Signal : complémentaire au panier
    if (cartSet.size > 0 && !cartSet.has(p.id) && category && p.category === category) {
      score += SIGNAL_WEIGHTS.cart_complement;
      if (reasonCode === 'editorial' || reasonCode === 'same_category') {
        reasonCode = 'cart_complement';
      }
    }

    // Signal : recherche texte partielle sur le nom
    if (search_query) {
      const q = search_query.toLowerCase();
      if (p.name.toLowerCase().includes(q)) {
        score += SIGNAL_WEIGHTS.search_match;
        if (reasonCode === 'editorial') reasonCode = 'same_category';
      }
    }

    // Baseline popularité (ventes historiques, plafonnée à poids dédié)
    if (p.sale_count > 0) {
      score += Math.min(SIGNAL_WEIGHTS.popular_baseline, Math.floor(Math.log2(p.sale_count + 1)));
      if (reasonCode === 'editorial' && category && p.category === category) {
        reasonCode = 'popular_in_category';
      }
    }

    scored.push({
      product_id:    p.id,
      name:          p.name,
      price_kmf:     r(p.price_kmf),
      image_url:     p.image_url || null,
      category:      p.category,
      subcategory:   p.subcategory || null,
      score,
      reason_code:   reasonCode,
      reason_label:  REASON_LABELS[reasonCode] || REASON_LABELS.editorial,
    });
  }

  // ── 4. Trier par score décroissant, puis popularité, puis nom ────
  scored.sort((a, b) => b.score - a.score || b.price_kmf - a.price_kmf || a.name.localeCompare(b.name));

  const suggestions = scored.slice(0, safeLimit);

  return {
    count:        suggestions.length,
    suggestions,
    signals_used: signalsUsed,
    computed_at:  new Date().toISOString(),
  };
}

module.exports = { computeSuggestions, REASON_LABELS, SIGNAL_WEIGHTS };
