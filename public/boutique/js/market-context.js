/**
 * @komerce-arch-lite
 * @role          boutique-market-context
 * @domain        catalog
 * @layer         ui-boundary
 * @owner         public/boutique/js/market-context.js
 * @purpose       Unique module frontière frontend : porte les données pays
 *                consommées par le hero, la home et les surfaces de navigation.
 *                Aucun autre fichier boutique ne doit contenir de littéral pays.
 * @impact-areas  boutique, hero, home, footer, checkout
 * @version       2026-09
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
const MARKETS = {
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
    relay_group_label: 'Île',
    relay_default_zone: null,
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
    relay_group_label: 'Zone',
    relay_default_zone: null,
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
    relay_group_label: 'Ville',
    relay_default_zone: 'Yaoundé',
    seo_title:       'Komerce — La boutique en ligne du Cameroun',
    seo_description: 'La boutique en ligne du Cameroun. Mode, tech, maison, beauté — commandez et retirez chez votre relais local.',
    og_title:        'Komerce — La boutique camerounaise',
    og_description:  'Mode, tech, maison, beauté — livré au Cameroun. Paiement mobile money, retrait relais.',
    footer_tagline:  'La boutique en ligne qui livre au Cameroun. Commandez en ligne, retirez chez votre relais local.',
    free_ship_label: 'Livraison incluse au Cameroun',
    price_label:     'Prix en XAF',
  },
  DJ: {
    code:            'DJ',
    name:            'Djibouti',
    gentile:         'La boutique djiboutienne',
    gentile_short:   'Djibouti',
    delivery_line:   'Mode, tech, beauté — à Djibouti',
    payment_label:   'Paiement selon les moyens disponibles',
    pickup_label:    'Retrait relais',
    currency:        'DJF',
    minor_unit:      0,
    relay_group_label: 'Ville',
    relay_default_zone: 'Djibouti',
    seo_title:       'Komerce — La boutique en ligne de Djibouti',
    seo_description: 'La boutique en ligne de Djibouti. Découvrez les offres disponibles et les points de retrait.',
    og_title:        'Komerce — La boutique djiboutienne',
    og_description:  'Découvrez les produits disponibles à Djibouti et les points de retrait.',
    footer_tagline:  'Découvrez la sélection Komerce pour Djibouti.',
    free_ship_label: 'Livraison selon offre',
    price_label:     'Prix en DJF',
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
    relay_group_label: 'Ville',
    relay_default_zone: 'Brazzaville',
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
const DEFAULT_MARKET = 'KM';

// ── Entrées pays publiques : /KM, /CM, /CG, /DJ, /YT ──────────────
// L'URL est un contexte de navigation, jamais une autorisation d'achat.
// Une URL pays a priorité sur ?market= afin qu'un lien partagé soit stable.
function getPathMarketCode() {
  try {
    const match = /^\/([a-z]{2})\/?$/i.exec(window.location.pathname || '');
    const code = match ? match[1].toUpperCase() : '';
    return Object.prototype.hasOwnProperty.call(MARKETS, code) ? code : null;
  } catch (e) {
    return null;
  }
}

// ── Alias historique de prévisualisation (?market=) ────────────────
// Conservé pour /boutique?market=CM et les consommateurs existants.
// Ce retour devient aussi le contexte explicite du pathname pays.
// Aucun code client n'en déduit une autorisation métier.
function getPreviewMarketOverride() {
  const pathMarket = getPathMarketCode();
  if (pathMarket) return pathMarket;
  try {
    const params = new URLSearchParams(window.location.search);
    const code = String(params.get('market') || '').toUpperCase();
    return Object.prototype.hasOwnProperty.call(MARKETS, code) ? code : null;
  } catch (e) {
    return null;
  }
}

// ── Résolution ──────────────────────────────────────────────────────────

/**
 * Retourne le contexte marché courant.
 * /XX (pays) > ?market= (alias historique) > KM par défaut.
 * Le contexte est de présentation ; l'autorité de transaction reste côté API.
 *
 * @returns {object} — un enregistrement MARKETS, jamais null
 */
function getMarketContext() {
  return MARKETS[getPreviewMarketOverride() || DEFAULT_MARKET];
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
  getPathCode:       getPathMarketCode,
  DEFAULT:            DEFAULT_MARKET,
};
