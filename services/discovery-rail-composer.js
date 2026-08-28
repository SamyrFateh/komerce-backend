/**
 * @komerce-arch
 * @role          recommendations-discovery-rail-composer
 * @domain        recommendations
 * @layer         service
 * @criticality   medium
 * @inputs        market_id, listes explicites de product_id/physical_offer_id/service_id
 * @outputs       DiscoveryCard[] — projection de lecture, jamais persistée
 * @depends       db, services/local-stock-service.js, services/providers-service.js
 * @used-by       (aucun — Vague 2 D5, shadow : composition disponible, jamais branchée
 *                à une route ou à un composant frontend dans ce lot)
 * @db-read       products (via db.js), local_stock/services/physical_offers (via les
 *                services propriétaires — jamais de SQL direct sur leurs tables)
 * @db-write      none
 * @db-txn        single_statement_sufficient
 * @doctrine      RECHALLENGE_DOCTRINE_DISCOVERY_LOCALE_V2.md §G (contrat de lecture
 *                minimal, jamais une vérité métier), §D0-D10 (D5 : DiscoveryCard)
 * @impact-areas  recommendations
 * @version       2026-08
 */

'use strict';

/**
 * ═══════════════════════════════════════════════════════════════
 * DISCOVERY RAIL COMPOSER — Vague 2 D5
 *
 * "Discovery ne possède aucune vérité, il la compose." recommendations
 * n'écrit jamais dans local_stock/services/physical_offers, ne clone jamais
 * leurs données en base, ne lit même jamais leurs tables en SQL direct —
 * uniquement via les fonctions déjà propriétaires (isStockExposable,
 * isServiceExposable, isPhysicalOfferExposable, getService,
 * getPhysicalOffer). products reste lu directement : recommendations
 * possède déjà `products: R` en contrat (catalog reste l'owner d'écriture).
 *
 * DiscoveryCard est une PROJECTION, jamais un objet métier : `kind` route
 * l'interaction frontend (quel CTA, quelle action au clic), il ne porte
 * AUCUNE règle métier — Discovery ne décide jamais si un objet peut être
 * vendu/exécuté, il demande à l'owner (isXExposable) et n'affiche que ce
 * qui répond oui.
 *
 * Candidats fournis EXPLICITEMENT par l'appelant (product_id/physical_
 * offer_id/service_id) — aucune logique de sélection/recherche autonome
 * ici. "Discovery peut appliquer une politique éditoriale simple avant
 * tout moteur sophistiqué" — la politique éditoriale (quels candidats
 * proposer) est un problème d'activation (D7-D9), pas de ce composeur.
 *
 * Tout objet non exposable est silencieusement omis du résultat — jamais
 * une carte qui explique pourquoi, même discipline que les routes D4.
 *
 * SHADOW : composition disponible et testée, mais jamais appelée par
 * aucune route ni aucun composant Boutique dans ce lot.
 * ═══════════════════════════════════════════════════════════════
 */

const db = require('../db');
const { isStockExposable } = require('./local-stock-service');
const {
  isServiceExposable, getService,
  isPhysicalOfferExposable, getPhysicalOffer,
} = require('./providers-service');

const CARD_KIND = Object.freeze({
  PRODUCT:        'product',
  PHYSICAL_OFFER: 'physical_offer',
  SERVICE:        'service',
});

const CTA_LABEL = Object.freeze({
  [CARD_KIND.PRODUCT]:        'Acheter',
  [CARD_KIND.PHYSICAL_OFFER]: 'Commander',
  [CARD_KIND.SERVICE]:        'Demander',
});

// Sous-titres fixes par kind (RECHALLENGE_DOCTRINE_DISCOVERY_LOCALE_V2.md §F —
// le sous-titre porte la nuance, jamais optionnel). local_stock ne porte pas
// de distinction plus fine à ce stade (pas de "encore 2" — un badge binaire).
const SUBTITLE = Object.freeze({
  [CARD_KIND.PRODUCT]:        'Disponible maintenant',
  [CARD_KIND.PHYSICAL_OFFER]: 'Préparation sur commande',
  [CARD_KIND.SERVICE]:        'Sur demande',
});

/**
 * Projette un Product Komerce en DiscoveryCard, ou null s'il n'est pas
 * exposable (stock local absent/épuisé, exposure DISABLED, produit
 * inactif). N'écrit rien, ne lit products QUE pour les 3 champs
 * d'affichage — jamais price_kmf, stock brut, ni aucun champ interne.
 *
 * @param {string} productId
 * @param {string} marketId
 * @returns {Promise<object|null>}
 */
async function productCard(productId, marketId) {
  const exposable = await isStockExposable(productId, marketId);
  if (!exposable) return null;

  const { rows } = await db.query(
    'SELECT id, name, image_url FROM products WHERE id = $1 AND is_active = true',
    [productId]
  );
  if (!rows.length) return null;
  const p = rows[0];

  return {
    kind: CARD_KIND.PRODUCT,
    title: p.name,
    subtitle: SUBTITLE[CARD_KIND.PRODUCT],
    cta_label: CTA_LABEL[CARD_KIND.PRODUCT],
    cta_action_ref: p.id,
    image_ref: p.image_url,
  };
}

/**
 * Projette une offre physique tierce (ex. samboussas) en DiscoveryCard, ou
 * null si non exposable. Ne lit jamais provider_id ni aucun champ du
 * provider — mêmes champs publics que routes/providers-services.js.
 *
 * @param {string} physicalOfferId
 * @param {string} marketId
 * @returns {Promise<object|null>}
 */
async function physicalOfferCard(physicalOfferId, marketId) {
  const exposable = await isPhysicalOfferExposable(physicalOfferId, marketId);
  if (!exposable) return null;

  const offer = await getPhysicalOffer(physicalOfferId);
  if (!offer) return null;

  return {
    kind: CARD_KIND.PHYSICAL_OFFER,
    title: offer.title,
    subtitle: SUBTITLE[CARD_KIND.PHYSICAL_OFFER],
    cta_label: CTA_LABEL[CARD_KIND.PHYSICAL_OFFER],
    cta_action_ref: offer.id,
    image_ref: null, // physical_offers ne porte pas encore de champ image
  };
}

/**
 * Projette un service tiers en DiscoveryCard, ou null si non exposable.
 * Ne lit jamais provider_id ni téléphone.
 *
 * @param {string} serviceId
 * @param {string} marketId
 * @returns {Promise<object|null>}
 */
async function serviceCard(serviceId, marketId) {
  const exposable = await isServiceExposable(serviceId, marketId);
  if (!exposable) return null;

  const service = await getService(serviceId);
  if (!service) return null;

  return {
    kind: CARD_KIND.SERVICE,
    title: service.title,
    subtitle: SUBTITLE[CARD_KIND.SERVICE],
    cta_label: CTA_LABEL[CARD_KIND.SERVICE],
    cta_action_ref: service.id,
    image_ref: null,
  };
}

/**
 * Compose un rail mixte à partir de candidats explicites — jamais une
 * recherche/sélection autonome. Chaque candidat est projeté selon son
 * kind puis vérifié en exposabilité ; tout ce qui n'est pas exposable est
 * silencieusement omis (jamais un objet d'erreur dans le tableau).
 *
 * @param {object} params
 * @param {string} params.marketId
 * @param {string[]} [params.productIds]
 * @param {string[]} [params.physicalOfferIds]
 * @param {string[]} [params.serviceIds]
 * @returns {Promise<object[]>} DiscoveryCard[], jamais plus long que la
 *   somme des candidats fournis, potentiellement plus court
 */
async function composeDiscoveryRail({
  marketId,
  productIds = [],
  physicalOfferIds = [],
  serviceIds = [],
}) {
  if (!marketId) {
    throw new Error('composeDiscoveryRail: market_id est requis');
  }

  const cards = await Promise.all([
    ...productIds.map(id => productCard(id, marketId)),
    ...physicalOfferIds.map(id => physicalOfferCard(id, marketId)),
    ...serviceIds.map(id => serviceCard(id, marketId)),
  ]);

  return cards.filter(Boolean);
}

module.exports = {
  CARD_KIND,
  productCard,
  physicalOfferCard,
  serviceCard,
  composeDiscoveryRail,
};
