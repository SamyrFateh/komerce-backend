/**
 * @komerce-arch
 * @role          recommendations-discovery-rail-composer
 * @domain        recommendations
 * @layer         service
 * @criticality   medium
 * @inputs        market_id, listes explicites de product_id/physical_offer_id/service_id
 * @outputs       DiscoveryCard[] — projection de lecture, jamais persistée
 * @depends       db, services/local-stock-service.js, services/providers-service.js, services/catalog-public-view.js
 * @used-by       services/discovery-rail-service.js
 * @db-read       products
 * @db-read-via:local-stock-service local_stock, local_stock_allocations
 * @db-read-via:providers-service services, physical_offers, providers
 * @db-write      none
 * @db-txn        single_statement_sufficient
 * @doctrine      docs/doctrine/DOCTRINE_DISCOVERY_LOCALE_UNIFIEE.md, docs/doctrine/DOCTRINE_DISCOVERY_ACCESSIBILITE_LOCALE.md
 * @impact-areas  recommendations, boutique, discovery-rail, category-navigation
 * @version       2026-09
 */

'use strict';

/**
 * Discovery ne possède aucune vérité, il la compose.
 * recommendations n'écrit jamais dans local_stock, services ou
 * physical_offers et ne clone jamais leurs données. Les objets provider
 * passent uniquement par les fonctions de leur owner métier.
 *
 * DiscoveryCard est une projection. `kind` route l'interaction frontend ;
 * aucune règle métier d'exposabilité n'est décidée ici.
 *
 * `category_keys` est également une projection de lecture :
 * - Product Komerce : dérivé de la taxonomie catalog source ;
 * - Service / Physical Offer : vide ici, puis complété par la politique
 *   éditoriale owner `recommendations` dans discovery-rail-service.js.
 *
 * Les candidats sont fournis explicitement par l'appelant. Tout objet non
 * exposable est silencieusement omis.
 */

const db = require('../db');
const { isStockExposable } = require('./local-stock-service');
const { publicCatalogVisibilitySql } = require('./catalog-public-view');
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

const SUBTITLE = Object.freeze({
  [CARD_KIND.PRODUCT]:        'Disponible maintenant',
  [CARD_KIND.PHYSICAL_OFFER]: 'Préparation sur commande',
  [CARD_KIND.SERVICE]:        'Sur demande',
});

function compactCategoryKeys(values = []) {
  return [...new Set(values
    .map(value => String(value || '').trim())
    .filter(Boolean))];
}

async function productCard(productId, marketId) {
  const exposable = await isStockExposable(productId, marketId);
  if (!exposable) return null;

  // Un Product du rail local reste exactement un Product public Komerce.
  // Discovery ne possède pas un deuxième gate catalogue : il réutilise la
  // frontière canonique qui exclut fixtures Showcase V2, médias inline et
  // hero absent. Ainsi « Disponible maintenant » ne peut jamais réintroduire
  // un produit que GET /api/products a volontairement masqué.
  const { rows } = await db.query(
    `SELECT p.id, p.name, p.image_url, p.price_kmf, p.category, p.promo_pct
       FROM products p
      WHERE p.id = $1
        AND ${publicCatalogVisibilitySql('p')}`,
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
    price: p.price_kmf != null ? Number(p.price_kmf) : null,
    zone: null,
    provider_name: null,
    description: null,
    category_keys: compactCategoryKeys([
      p.category,
      Number(p.promo_pct || 0) > 0 ? 'Soldes' : null,
    ]),
  };
}

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
    image_ref: offer.image_ref || null,
    price: null,
    zone: offer.zone || null,
    provider_name: offer.provider_name || null,
    description: offer.description || null,
    category_keys: [],
  };
}

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
    image_ref: service.image_ref || null,
    price: null,
    zone: service.zone || null,
    provider_name: service.provider_name || null,
    description: service.description || null,
    category_keys: [],
  };
}

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
  compactCategoryKeys,
  productCard,
  physicalOfferCard,
  serviceCard,
  composeDiscoveryRail,
};
