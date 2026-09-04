/**
 * @komerce-arch-lite
 * @role          catalog-render-discovery-rail
 * @domain        catalog
 * @layer         ui-renderer
 * @owner         public/boutique/js/discovery-rail.js
 * @purpose       Rendre la projection Discovery locale sans posséder sa vérité métier.
 *                Mobile conserve sa géométrie 2×2 ; desktop réutilise le shell k-card canonique.
 * @impact-areas  home, product-discovery, discovery-rail, category-navigation
 * @version       2026-09
 */
'use strict';

import { sanitize } from '../b-utils.js';

const CARD_KIND = new Set(['product', 'physical_offer', 'service']);

const FALLBACK_CTA = Object.freeze({
  product: 'Acheter',
  physical_offer: 'Commander',
  service: 'Demander',
});

function fallbackIcon(kind) {
  if (kind === 'service') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5 5L3.5 17.5a2.1 2.1 0 0 0 3 3l6.2-6.2a4 4 0 0 0 5-5l-2.6 2.6-3-3 2.6-2.6Z"/></svg>';
  }
  if (kind === 'physical_offer') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8h12l1 13H5L6 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 7 8-4 8 4-8 4-8-4Z"/><path d="m4 7 8 4 8-4v10l-8 4-8-4V7Z"/></svg>';
}

function normalizeCategoryKeys(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .map(value => String(value || '').trim())
    .filter(Boolean))];
}

/**
 * Normalise un objet carte brut du backend en objet exploitable par le renderer.
 * Les champs enrichis restent optionnels. `category_keys` est uniquement une
 * projection de contexte fournie par recommendations ; le renderer ne l'invente
 * jamais et ne l'utilise pas pour reclasser les cartes.
 */
function normalizeCard(card) {
  if (!card || !CARD_KIND.has(card.kind)) return null;
  if (!card.title || !card.cta_action_ref) return null;

  return {
    kind: card.kind,
    title: String(card.title),
    subtitle: card.subtitle ? String(card.subtitle) : '',
    ctaLabel: card.cta_label ? String(card.cta_label) : FALLBACK_CTA[card.kind],
    actionRef: String(card.cta_action_ref),
    imageRef: card.image_ref ? String(card.image_ref) : '',
    price: card.price != null ? Number(card.price) : null,
    zone: card.zone ? String(card.zone) : null,
    providerName: card.provider_name ? String(card.provider_name) : null,
    description: card.description ? String(card.description) : null,
    categoryKeys: normalizeCategoryKeys(card.category_keys),
  };
}

function formatPrice(price) {
  if (price == null) return '';
  return new Intl.NumberFormat('fr-FR', { style: 'decimal', maximumFractionDigits: 0 }).format(price) + ' KMF';
}

function renderPrimarySlot(card) {
  if (card.kind === 'product' && card.price != null) {
    return `<span class="k-discovery-price">${formatPrice(card.price)}</span>`;
  }
  return '';
}

function renderContextSlot(card) {
  if (!card.providerName) return '';
  return `<span class="k-discovery-provider">${sanitize(card.providerName)}${card.zone ? ` · ${sanitize(card.zone)}` : ''}</span>`;
}

/**
 * Renderer historique mobile. Il reste volontairement inchangé : le pager
 * garde son 2×2 vertical et aucun geste horizontal interne n'est réintroduit.
 */
function renderCard(card) {
  const image = card.imageRef
    ? `<img class="k-discovery-img" src="${sanitize(card.imageRef)}" alt="${sanitize(card.title)}" loading="lazy" decoding="async">`
    : `<div class="k-discovery-fallback" aria-hidden="true">${fallbackIcon(card.kind)}</div>`;

  return `
    <article class="k-discovery-card" data-discovery-kind="${card.kind}" data-discovery-ref="${sanitize(card.actionRef)}" role="listitem">
      <div class="k-discovery-media">
        ${image}
        ${card.subtitle ? `<span class="k-discovery-status">${sanitize(card.subtitle)}</span>` : ''}
      </div>
      <div class="k-discovery-info">
        <div class="k-discovery-name">${sanitize(card.title)}</div>
        <div class="k-discovery-primary-slot">${renderPrimarySlot(card)}</div>
        <div class="k-discovery-context-slot">${renderContextSlot(card)}</div>
        <button class="k-discovery-cta" type="button" data-discovery-action="${card.kind}" data-discovery-ref="${sanitize(card.actionRef)}">${sanitize(card.ctaLabel)}</button>
      </div>
    </article>`;
}

function renderDesktopActionSlot(card, safeTitle) {
  if (card.kind === 'product') {
    const ref = sanitize(card.actionRef);
    return `
      <div class="k-card-add k-discovery-canonical-action-slot" data-add="${ref}" data-cart-lines="0" role="group" aria-label="Quantité de ${safeTitle}">
        <button type="button" class="k-card-add-trigger" data-action="add" aria-label="Ajouter ${safeTitle} au panier">
          <span class="k-card-add-plus" aria-hidden="true">+</span>
        </button>
      </div>`;
  }

  return `
    <div class="k-card-add k-discovery-canonical-action-slot" role="group" aria-label="Action pour ${safeTitle}">
      <button class="k-discovery-canonical-cta" type="button" data-discovery-action="${card.kind}" data-discovery-ref="${sanitize(card.actionRef)}">${sanitize(card.ctaLabel)}</button>
    </div>`;
}

/**
 * Desktop One Card Contract.
 *
 * Le cadre est celui du Product Display Contract (`k-card`, `k-card-img-wrap`,
 * `k-card-info`, `k-card-name`, `k-card-bottom`, `k-card-add`). Discovery ne
 * possède que des hooks de capacité. Le CSS Discovery n'a donc jamais besoin
 * de redéfinir le shell canonique `.k-card`.
 *
 * Un Product `Disponible maintenant` conserve le contrôle panier canonique `+`.
 * Les kinds provider gardent leur CTA d'ouverture de détail.
 */
function renderDesktopCard(card) {
  const safeTitle = sanitize(card.title);
  const image = card.imageRef
    ? `<img class="k-discovery-canonical-img" src="${sanitize(card.imageRef)}" alt="${safeTitle}" loading="lazy" decoding="async">`
    : `<div class="k-discovery-fallback k-discovery-canonical-fallback" aria-hidden="true">${fallbackIcon(card.kind)}</div>`;
  const context = card.providerName
    ? `${sanitize(card.providerName)}${card.zone ? ` · ${sanitize(card.zone)}` : ''}`
    : (card.description ? sanitize(card.description) : '');
  const price = card.kind === 'product' && card.price != null
    ? `<span class="k-card-price k-discovery-canonical-price">${formatPrice(card.price)}</span>`
    : '<span class="k-discovery-canonical-price-placeholder" aria-hidden="true"></span>';

  return `
    <article class="k-card k-discovery-canonical-card" data-discovery-kind="${card.kind}" data-discovery-ref="${sanitize(card.actionRef)}" role="listitem">
      <div class="k-card-img-wrap k-discovery-canonical-media">
        ${image}
        ${card.subtitle ? `<span class="k-discovery-status">${sanitize(card.subtitle)}</span>` : ''}
      </div>
      <div class="k-card-info">
        <div class="k-card-name">${safeTitle}</div>
        <div class="k-card-desc k-discovery-canonical-context">${context}</div>
        <div class="k-card-bottom k-card-prices-row">
          <div class="k-card-price-col k-discovery-canonical-price-col">${price}</div>
          ${renderDesktopActionSlot(card, safeTitle)}
        </div>
      </div>
    </article>`;
}

const COMMERCE_KINDS = new Set(['product', 'physical_offer']);
const SERVICE_KINDS = new Set(['service']);

function selectMobile(cards) {
  const commerce = cards.filter(c => COMMERCE_KINDS.has(c.kind));
  const services = cards.filter(c => SERVICE_KINDS.has(c.kind));
  const result = [];
  const maxPairs = 2;
  for (let i = 0; i < maxPairs; i++) {
    if (commerce[i]) result.push(commerce[i]);
    if (services[i]) result.push(services[i]);
  }
  if (result.length < 4) {
    const used = new Set(result);
    for (const c of [...commerce, ...services]) {
      if (result.length >= 4) break;
      if (!used.has(c)) { result.push(c); used.add(c); }
    }
  }
  return result;
}

function selectDesktop(cards) {
  return cards;
}

function isMobileViewport() {
  return typeof window !== 'undefined' && window.innerWidth < 900;
}

function renderRail(selected, marketLabel, options = {}) {
  const titleId = options.titleId || 'k-discovery-local-title';
  const title = options.title || 'Disponible ici';
  const renderSelectedCard = isMobileViewport() ? renderCard : renderDesktopCard;
  return `
    <div class="k-discovery-header">
      <div class="k-discovery-heading">
        <h2 id="${sanitize(titleId)}" class="k-discovery-title">${sanitize(title)}</h2>
        ${marketLabel ? `<span class="k-discovery-market">${sanitize(marketLabel)}</span>` : ''}
      </div>
    </div>
    <div class="k-discovery-rail" role="list" aria-label="Offres disponibles ici">
      ${selected.map(renderSelectedCard).join('')}
    </div>`;
}

export function renderDiscoveryRail(container, cards, options = {}) {
  if (!container) return 0;

  const normalized = (Array.isArray(cards) ? cards : [])
    .map(normalizeCard)
    .filter(Boolean);

  if (normalized.length === 0) {
    container.innerHTML = '';
    container.hidden = true;
    return 0;
  }

  const selected = isMobileViewport() ? selectMobile(normalized) : selectDesktop(normalized);
  const marketLabel = options.marketLabel ? String(options.marketLabel) : '';
  container.innerHTML = renderRail(selected, marketLabel, options);
  container.hidden = false;
  return normalized.length;
}

export {
  normalizeCard,
  normalizeCategoryKeys,
  renderCard,
  renderDesktopCard,
  formatPrice,
  selectMobile,
  selectDesktop,
};
