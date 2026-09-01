/**
 * @komerce-arch-lite
 * @role          catalog-render-discovery-rail
 * @domain        catalog
 * @layer         ui-renderer
 * @owner         public/boutique/js/discovery-rail.js
 * @purpose       Rendre la projection Discovery locale sans posséder sa vérité métier.
 *                Shell commun par carte, contenu spécialisé par kind.
 * @impact-areas  home, product-discovery, discovery-rail
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

/**
 * Normalise un objet carte brut du backend en objet exploitable par le renderer.
 * Les champs enrichis (price, zone, provider_name, description) sont optionnels
 * pour rester backward-compatible avec un backend pré-L0.
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
  };
}

function formatPrice(price) {
  if (price == null) return '';
  return new Intl.NumberFormat('fr-FR', { style: 'decimal', maximumFractionDigits: 0 }).format(price) + ' KMF';
}

// ── Contenu spécialisé par kind ─────────────────────────────────────────

function renderProductInfo(card) {
  const priceHtml = card.price != null
    ? `<div class="k-discovery-price">${formatPrice(card.price)}</div>`
    : '';
  return `
    <div class="k-discovery-name">${sanitize(card.title)}</div>
    ${priceHtml}
    ${card.subtitle ? `<div class="k-discovery-subtitle">${sanitize(card.subtitle)}</div>` : ''}`;
}

function renderOfferInfo(card) {
  const providerHtml = card.providerName
    ? `<div class="k-discovery-provider">${sanitize(card.providerName)}${card.zone ? ` · ${sanitize(card.zone)}` : ''}</div>`
    : '';
  return `
    <div class="k-discovery-name">${sanitize(card.title)}</div>
    ${card.subtitle ? `<div class="k-discovery-subtitle">${sanitize(card.subtitle)}</div>` : ''}
    ${providerHtml}`;
}

function renderServiceInfo(card) {
  const providerHtml = card.providerName
    ? `<div class="k-discovery-provider">${sanitize(card.providerName)}${card.zone ? ` · ${sanitize(card.zone)}` : ''}</div>`
    : '';
  return `
    <div class="k-discovery-name">${sanitize(card.title)}</div>
    ${card.subtitle ? `<div class="k-discovery-subtitle">${sanitize(card.subtitle)}</div>` : ''}
    ${providerHtml}`;
}

const INFO_RENDERER = Object.freeze({
  product: renderProductInfo,
  physical_offer: renderOfferInfo,
  service: renderServiceInfo,
});

// ── Shell commun ────────────────────────────────────────────────────────

function renderCard(card) {
  const image = card.imageRef
    ? `<img class="k-discovery-img" src="${sanitize(card.imageRef)}" alt="${sanitize(card.title)}" loading="lazy" decoding="async">`
    : `<div class="k-discovery-fallback" aria-hidden="true">${fallbackIcon(card.kind)}</div>`;

  const infoRenderer = INFO_RENDERER[card.kind] || renderProductInfo;

  return `
    <article class="k-discovery-card" data-discovery-kind="${card.kind}" data-discovery-ref="${sanitize(card.actionRef)}" role="listitem">
      <div class="k-discovery-media">
        ${image}
        ${card.subtitle ? `<span class="k-discovery-status">${sanitize(card.subtitle)}</span>` : ''}
      </div>
      <div class="k-discovery-info">
        ${infoRenderer(card)}
        <button class="k-discovery-cta" type="button" data-discovery-action="${card.kind}" data-discovery-ref="${sanitize(card.actionRef)}">${sanitize(card.ctaLabel)}</button>
      </div>
    </article>`;
}

// ── Render public ───────────────────────────────────────────────────────

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

  const marketLabel = options.marketLabel ? String(options.marketLabel) : '';
  container.innerHTML = `
    <div class="k-discovery-header">
      <div class="k-discovery-heading">
        <h2 id="k-discovery-local-title" class="k-discovery-title">Près de vous</h2>
        ${marketLabel ? `<span class="k-discovery-market">${sanitize(marketLabel)}</span>` : ''}
      </div>
    </div>
    <div class="k-discovery-rail" role="list" aria-label="Offres disponibles près de vous">
      ${normalized.map(renderCard).join('')}
    </div>`;
  container.hidden = false;
  return normalized.length;
}

export { normalizeCard, renderCard, formatPrice };
