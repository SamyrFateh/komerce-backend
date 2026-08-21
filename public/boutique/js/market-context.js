/**
 * @komerce-arch-lite
 * @role          boutique-market-context
 * @domain        catalog
 * @layer         ui-boundary
 * @owner         public/boutique/js/market-context.js
 * @purpose       Unique module frontière frontend : porte les données pays
 *                consommées par le hero, la home et les surfaces de navigation.
 *                Aucun autre fichier boutique ne doit contenir de littéral pays.
 * @impact-areas  boutique, hero, home, footer
 * @version       2026-08
 *
 * DOCTRINE (cf. KOMERCE_MARKET_LAYER_FREEZE.md §3) :
 *   MarketContext = navigation — contextuel, client, commutable, NON autorisant.
 *   Ce module ne connaît PAS requireMarketScope ni operator_market_scopes.
 *   Il ne fait PAS de switch(market) dans les consommateurs — il résout un objet,
 *   les consommateurs le lisent tel quel.
 */
'use strict';

// ── Registre des marchés ────────────────────────────────────────────────
// Ajouter un marché = ajouter un enregistrement. Zéro fichier touché ailleurs.
var MARKETS = {
  KM: {
    code:            'KM',
    name:            'Comores',
    gentile:         'La boutique comorienne',
    gentile_short:   'Comores',
    delivery_line:   'Mode, tech, beauté — livré aux Comores',
    payment_label:   'Paiement cash',
    pickup_label:    'Retrait relais',
    currency:        'KMF',
    seo_title:       'Komerce — La boutique en ligne des Comores',
    seo_description: 'La boutique en ligne des Comores. Mode, tech, maison, beauté — commandez depuis l\'Europe, retirez en cash chez votre relais local.',
    og_title:        'Komerce — La boutique comorienne',
    og_description:  'Mode, tech, maison, beauté — livré aux Comores. Paiement cash, retrait relais.',
    footer_tagline:  'La boutique en ligne qui livre aux Comores. Commandez depuis l\'Europe, retirez en cash chez votre relais local.',
    free_ship_label: 'Livraison incluse aux Comores',
    price_label:     'Prix en KMF',
  },
  // ── Marchés suivants (H4+) ──────────────────────────────────────────
  // YT: { code: 'YT', name: 'Mayotte', gentile: 'La boutique mahoraise', ... },
  // CG: { code: 'CG', name: 'Congo',   gentile: 'La boutique de Brazzaville', ... },
};

// ── Marché par défaut ───────────────────────────────────────────────────
// Aujourd'hui : KM, le seul marché actif.
// Demain (M2) : résolu depuis le relais choisi > préférence stockée > défaut.
var DEFAULT_MARKET = 'KM';

// ── Résolution ──────────────────────────────────────────────────────────

/**
 * Retourne le contexte marché courant.
 * Pour l'instant, toujours KM. La logique de résolution (relais, préférence,
 * géo) sera branchée par H3 quand M2 existera.
 *
 * @returns {object} — un enregistrement MARKETS, jamais null
 */
function getMarketContext() {
  return MARKETS[DEFAULT_MARKET];
}

/**
 * Retourne un marché par code. Usage interne uniquement.
 * @param {string} code
 * @returns {object|undefined}
 */
function getMarket(code) {
  return MARKETS[code];
}

// ── Exports (IIFE-compatible, pas de module ES pour rester aligné avec le reste) ──
window.KomerceMarket = {
  get:        getMarketContext,
  getByCode:  getMarket,
  DEFAULT:    DEFAULT_MARKET,
};
