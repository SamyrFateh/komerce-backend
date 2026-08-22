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
    minor_unit:      0,
    seo_title:       'Komerce — La boutique en ligne des Comores',
    seo_description: 'La boutique en ligne des Comores. Mode, tech, maison, beauté — commandez depuis l\'Europe, retirez en cash chez votre relais local.',
    og_title:        'Komerce — La boutique comorienne',
    og_description:  'Mode, tech, maison, beauté — livré aux Comores. Paiement cash, retrait relais.',
    footer_tagline:  'La boutique en ligne qui livre aux Comores. Commandez depuis l\'Europe, retirez en cash chez votre relais local.',
    free_ship_label: 'Livraison incluse aux Comores',
    price_label:     'Prix en KMF',
  },
  // ── Marchés suivants ──────────────────────────────────────────────────
  YT: {
    code:            'YT',
    name:            'Mayotte',
    gentile:         'La boutique mahoraise',
    gentile_short:   'Mayotte',
    delivery_line:   'Mode, tech, beauté — livré à Mayotte',
    payment_label:   'Paiement carte',
    pickup_label:    'Retrait relais',
    currency:        'EUR',
    minor_unit:      2,
    seo_title:       'Komerce — La boutique en ligne de Mayotte',
    seo_description: 'La boutique en ligne de Mayotte. Mode, tech, maison, beauté — commandez et retirez chez votre relais local.',
    og_title:        'Komerce — La boutique mahoraise',
    og_description:  'Mode, tech, maison, beauté — livré à Mayotte. Paiement carte, retrait relais.',
    footer_tagline:  'La boutique en ligne qui livre à Mayotte. Commandez en ligne, retirez chez votre relais local.',
    free_ship_label: 'Livraison incluse à Mayotte',
    price_label:     'Prix en EUR',
  },
  CM: {
    code:            'CM',
    name:            'Cameroun',
    gentile:         'La boutique camerounaise',
    gentile_short:   'Cameroun',
    delivery_line:   'Mode, tech, beauté — livré au Cameroun',
    payment_label:   'Paiement mobile money',
    pickup_label:    'Retrait relais',
    currency:        'XAF',
    minor_unit:      0,
    seo_title:       'Komerce — La boutique en ligne du Cameroun',
    seo_description: 'La boutique en ligne du Cameroun. Mode, tech, maison, beauté — commandez et retirez chez votre relais local.',
    og_title:        'Komerce — La boutique camerounaise',
    og_description:  'Mode, tech, maison, beauté — livré au Cameroun. Paiement mobile money, retrait relais.',
    footer_tagline:  'La boutique en ligne qui livre au Cameroun. Commandez en ligne, retirez chez votre relais local.',
    free_ship_label: 'Livraison incluse au Cameroun',
    price_label:     'Prix en XAF',
  },
  CG: {
    code:            'CG',
    name:            'Congo',
    gentile:         'La boutique de Brazzaville',
    gentile_short:   'Congo',
    delivery_line:   'Mode, tech, beauté — livré à Brazzaville',
    payment_label:   'Paiement mobile money',
    pickup_label:    'Retrait relais',
    currency:        'XAF',
    minor_unit:      0,
    seo_title:       'Komerce — La boutique en ligne de Brazzaville',
    seo_description: 'La boutique en ligne de Brazzaville. Mode, tech, maison, beauté — commandez et retirez chez votre relais local.',
    og_title:        'Komerce — La boutique de Brazzaville',
    og_description:  'Mode, tech, maison, beauté — livré à Brazzaville. Paiement mobile money, retrait relais.',
    footer_tagline:  'La boutique en ligne qui livre à Brazzaville. Commandez en ligne, retirez chez votre relais local.',
    free_ship_label: 'Livraison incluse à Brazzaville',
    price_label:     'Prix en XAF',
  },
};

// ── Marché par défaut ───────────────────────────────────────────────────
// KM reste le marché par défaut de la boutique réelle — inchangé.
// Demain (M2 branché), résolu depuis le relais choisi > préférence stockée > défaut.
var DEFAULT_MARKET = 'KM';

// ── Override de PRÉVISUALISATION (?market=) ─────────────────────────────
// Paramètre d'URL exclusivement — jamais une résolution stockée ni serveur.
// Portée strictement PREVIEW/DÉMO : change l'affichage (gentilé, libellés,
// devise affichée), ne touche à AUCUNE logique de panier, de commande ou
// d'autorisation. Conforme à la doctrine freeze §3 : le MarketContext est
// "contextuel, client, commutable, NON autorisant" — ceci en est la forme
// la plus littérale possible. Un lien partagé avec ?market=CM ne donne
// aucun droit, ne débloque aucune action, affiche juste la vitrine du
// marché demandé. Retiré/remplacé par une vraie résolution (relais choisi)
// quand M2 sera branché en H3 — voir marché par défaut ci-dessus.
function getPreviewMarketOverride() {
  try {
    var params = new URLSearchParams(window.location.search);
    var code = params.get('market');
    return (code && MARKETS[code]) ? code : null;
  } catch (e) {
    return null; // jamais casser le rendu pour un paramètre malformé
  }
}

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
  get:                getMarketContext,
  getByCode:          getMarket,
  getPreviewOverride: getPreviewMarketOverride,
  DEFAULT:            DEFAULT_MARKET,
};
