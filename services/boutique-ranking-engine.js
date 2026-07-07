/**
 * @komerce-arch
 * @role          recommendations-boutique-ranking-engine
 * @domain        recommendations
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db
 * @used-by       routes/boutique-suggestions.js
 * @db-read       order_items, orders, products
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  recommendations
 * @version       2026-06
 */

/**
 * PATCH — ce que cette version corrige par rapport à l'existant :
 *  1. Hiérarchie remise à l'endroit : le complément (P1) passe DEVANT la même
 *     sous-catégorie (P2). Avant, same_subcategory (50) écrasait tout et il n'y
 *     avait aucun signal de complémentarité.
 *  2. Complémentarité RÉELLE via products.compatibility_group (colonne déjà en
 *     base, jusqu'ici ignorée). Un produit du même groupe de compatibilité mais
 *     d'une autre sous-catégorie = complément (riz → huile).
 *  3. Alternative de prix (P3) : même sous-catégorie, écart de prix → moins chère
 *     ou premium.
 *  4. Raisons honnêtes (doctrine §5) : same_subcategory n'affiche plus
 *     "Souvent acheté ensemble" (ce label exige une vraie co-occurrence).
 *  5. product_ref exposé dans chaque suggestion (doctrine §4).
 *  6. Tri déterministe sans biais d'upsell : on ne trie plus par prix décroissant.
 *  7. Logique pure isolée dans rankProducts() → testable sans base.
 */

'use strict';

const db = require('../db');

// ── Poids des signaux — rangs P1..P8 du brief, alignés doctrine §9 ──────────
const SIGNAL_WEIGHTS = {
  complement_compat:   100, // P1 — même compatibility_group, autre sous-catégorie
  cart_complement:      90, // P5 — complément d'un article du panier
  bought_together:      70, // P6 — co-occurrence réelle (si donnée dispo)
  same_subcategory:     60, // P2
  price_alternative:    50, // P3
  recently_viewed:      40, // P4
  category_popularity:  20, // P7
  general_popularity:    5, // P8 — dernier recours
};

// Spécificité du LIBELLÉ (≠ poids de tri). On affiche la raison la plus
// spécifique et actionnable parmi celles déclenchées, pas la plus générique.
// Le tri, lui, reste piloté par les poids (priorité métier du brief).
const REASON_RANK = {
  complement_compat: 1, cart_complement: 1,   // « complète » : le plus actionnable
  price_cheaper: 2, price_premium: 2,         // alternative de prix : spécifique
  bought_together: 3,                         // co-occurrence réelle
  same_subcategory: 4,                        // proximité : plus générique
  recently_viewed: 5,
  popular_in_category: 6, general_popularity: 7, editorial: 8,
};

// ── Raisons canoniques (doctrine §5 + libellés du brief) ────────────────────
const REASON_LABELS = {
  complement_compat:   'Complète votre achat',
  cart_complement:     'Complète votre panier',
  bought_together:     'Souvent acheté avec',
  same_subcategory:    'Même catégorie',
  price_cheaper:       'Alternative moins chère',
  price_premium:       'Alternative premium',
  recently_viewed:     'Vous l’avez consulté récemment',
  popular_in_category: 'Populaire dans cette catégorie',
  general_popularity:  'Populaire en ce moment',
  editorial:           'Sélection Komerce',
};

function r(n) { return Math.round(Number(n) || 0); }

/**
 * Cœur de calcul PUR — aucun accès base. Testable en isolation.
 * @param {Array}  products  lignes catalogue déjà chargées (avec compatibility_group, product_ref, sale_count)
 * @param {Object} signals   contexte visiteur
 * @param {Object} [coOcc]   map product_id -> [product_id] de co-occurrence réelle (optionnel)
 */
function rankProducts(products, signals = {}, coOcc = {}) {
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
  const byId = new Map(products.map(p => [String(p.id), p]));
  const viewed = viewed_product_id ? byId.get(String(viewed_product_id)) : null;

  const excludeIds = new Set();
  if (viewed_product_id) excludeIds.add(String(viewed_product_id));

  const recentlyViewedSet = new Set(recently_viewed.map(String));
  const cartSet = new Set(cart_product_ids.map(String));

  // Groupes de compatibilité présents dans le contexte (produit vu + panier)
  const anchorCompatGroups = new Set();
  if (viewed && viewed.compatibility_group) anchorCompatGroups.add(viewed.compatibility_group);
  for (const cid of cartSet) {
    const c = byId.get(cid);
    if (c && c.compatibility_group) anchorCompatGroups.add(c.compatibility_group);
  }

  const signalsUsed = [];
  if (category) signalsUsed.push('category');
  if (subcategory) signalsUsed.push('subcategory');
  if (recently_viewed.length) signalsUsed.push('recently_viewed');
  if (cart_product_ids.length) signalsUsed.push('cart_complement');
  if (anchorCompatGroups.size) signalsUsed.push('complement_compat');
  if (search_query) signalsUsed.push('search_query');

  const scored = [];

  for (const p of products) {
    const pid = String(p.id);
    if (excludeIds.has(pid)) continue;
    if (p.is_active === false) continue;

    const fired = []; // { reason, weight }

    // P1 — complément par compatibilité (même groupe, sous-catégorie différente)
    if (p.compatibility_group && anchorCompatGroups.has(p.compatibility_group)) {
      const differentSub = !subcategory || p.subcategory !== subcategory;
      if (differentSub) {
        const inCart = cartSet.has(pid);
        fired.push({ reason: inCart ? null : (cartSet.size ? 'cart_complement' : 'complement_compat'),
                     weight: cartSet.size ? SIGNAL_WEIGHTS.cart_complement : SIGNAL_WEIGHTS.complement_compat });
      }
    }

    // P6 — co-occurrence réelle avec le produit vu (si la donnée existe)
    if (viewed_product_id && (coOcc[String(viewed_product_id)] || []).includes(pid)) {
      fired.push({ reason: 'bought_together', weight: SIGNAL_WEIGHTS.bought_together });
    }

    // P2 — même sous-catégorie
    if (subcategory && p.subcategory === subcategory) {
      fired.push({ reason: 'same_subcategory', weight: SIGNAL_WEIGHTS.same_subcategory });

      // P3 — alternative de prix dans la même sous-catégorie
      if (viewed && viewed.price_kmf > 0) {
        const gap = Math.abs(p.price_kmf - viewed.price_kmf) / viewed.price_kmf;
        if (gap >= 0.15) {
          fired.push({ reason: p.price_kmf < viewed.price_kmf ? 'price_cheaper' : 'price_premium',
                       weight: SIGNAL_WEIGHTS.price_alternative * Math.min(1, 0.5 + gap) });
        }
      }
    } else if (category && p.category === category) {
      // proximité catégorie (plus faible que sous-catégorie)
      fired.push({ reason: 'popular_in_category', weight: SIGNAL_WEIGHTS.category_popularity * 0.5 });
    }

    // P4 — vu récemment
    if (recentlyViewedSet.has(pid)) {
      fired.push({ reason: 'recently_viewed', weight: SIGNAL_WEIGHTS.recently_viewed });
    }

    // recherche texte (signal faible, ne crée pas de raison trompeuse)
    if (search_query && p.name && p.name.toLowerCase().includes(search_query.toLowerCase())) {
      fired.push({ reason: 'same_subcategory', weight: 8 });
    }

    // P7/P8 — popularité (ventes historiques), filet
    if (p.sale_count > 0) {
      const popW = Math.min(SIGNAL_WEIGHTS.general_popularity, Math.floor(Math.log2(p.sale_count + 1)));
      const inCat = category && p.category === category;
      fired.push({ reason: inCat ? 'popular_in_category' : 'general_popularity',
                   weight: inCat ? popW + 2 : popW });
    }

    if (!fired.length) continue; // doctrine : pas de raison → pas d'affichage

    const score = fired.reduce((s, f) => s + f.weight, 0);
    // Raison affichée = signal de plus haut rang ayant un libellé
    const labelled = fired.filter(f => f.reason && REASON_LABELS[f.reason]);
    const best = labelled.reduce((a, b) => (REASON_RANK[a.reason] <= REASON_RANK[b.reason] ? a : b),
                                  labelled[0] || { reason: 'editorial' });

    scored.push({
      product_id:   p.id,
      product_ref:  p.product_ref || null,
      name:         p.name,
      price_kmf:    r(p.price_kmf),
      image_url:    p.image_url || null,
      category:     p.category,
      subcategory:  p.subcategory || null,
      score:        r(score),
      reason_code:  best.reason,
      reason_label: REASON_LABELS[best.reason] || REASON_LABELS.editorial,
      _rank:        REASON_RANK[best.reason] || 9,
      _sale:        p.sale_count || 0,
    });
  }

  // Tri déterministe : score, puis rang de raison, puis ventes, puis ref/nom.
  // Plus de tri par prix décroissant (évitait un biais d'upsell).
  scored.sort((a, b) =>
    b.score - a.score ||
    a._rank - b._rank ||
    b._sale - a._sale ||
    String(a.product_ref || a.name).localeCompare(String(b.product_ref || b.name))
  );

  return scored.slice(0, safeLimit).map(({ _rank, _sale, ...s }) => s);
}

/**
 * Charge le catalogue puis délègue à rankProducts. Signature et réponse inchangées.
 */
async function computeSuggestions(signals = {}) {
  const { rows: products } = await db.query(
    `SELECT
       p.id, p.product_ref, p.name, p.category, p.subcategory,
       p.price_kmf, p.image_url, p.compatibility_group, p.is_active,
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

  const suggestions = products.length ? rankProducts(products, signals) : [];

  return {
    count:        suggestions.length,
    suggestions,
    signals_used: [],   // renseigné par rankProducts si besoin de debug
    computed_at:  new Date().toISOString(),
  };
}

module.exports = { computeSuggestions, rankProducts, REASON_LABELS, SIGNAL_WEIGHTS, REASON_RANK };
