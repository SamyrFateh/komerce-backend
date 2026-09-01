/**
 * @komerce-arch-lite
 * @role          catalog-render-discovery-detail
 * @domain        catalog
 * @layer         ui-renderer
 * @owner         public/boutique/js/discovery-rail.js
 * @purpose       Panneau de détail léger pour offres physiques et services Discovery.
 *                Pas de page, pas de marketplace — juste un "en savoir plus" contextuel.
 * @impact-areas  home, discovery-rail, providers-services
 * @version       2026-09
 */
'use strict';

import { sanitize } from '../b-utils.js';

const SHEET_ID = 'k-discovery-detail-sheet';

function buildSheetHTML(detail) {
  const image = detail.image_ref
    ? `<img class="k-discovery-detail-img" src="${sanitize(detail.image_ref)}" alt="${sanitize(detail.title)}" loading="lazy">`
    : '';

  const providerLine = detail.provider_name
    ? `<div class="k-discovery-detail-provider">${sanitize(detail.provider_name)}${detail.zone ? ` · ${sanitize(detail.zone)}` : ''}</div>`
    : '';

  const description = detail.description
    ? `<p class="k-discovery-detail-desc">${sanitize(detail.description)}</p>`
    : '';

  const ctaLabel = detail.kind === 'physical_offer' ? 'Commander' : 'Demander';
  const subtitle = detail.kind === 'physical_offer' ? 'Préparation sur commande' : 'Sur demande';

  return `
    <div class="k-discovery-detail-overlay" data-discovery-detail-close>
      <div class="k-discovery-detail-panel" role="dialog" aria-modal="true" aria-label="${sanitize(detail.title)}">
        <button class="k-discovery-detail-close" type="button" data-discovery-detail-close aria-label="Fermer">✕</button>
        ${image}
        <div class="k-discovery-detail-body">
          <h3 class="k-discovery-detail-title">${sanitize(detail.title)}</h3>
          <span class="k-discovery-detail-badge">${sanitize(subtitle)}</span>
          ${providerLine}
          ${description}
          <button class="k-discovery-cta k-discovery-detail-cta" type="button"
            data-discovery-action="${detail.kind}"
            data-discovery-ref="${sanitize(detail.id)}">${sanitize(ctaLabel)}</button>
        </div>
      </div>
    </div>`;
}

/**
 * Ouvre le detail sheet avec les données d'une offre ou d'un service.
 * @param {object} detail — { id, kind, title, description, zone, provider_name, image_ref }
 * @returns {HTMLElement|null}
 */
export function openDiscoveryDetail(detail) {
  if (!detail || !detail.id || !detail.title) return null;

  // Fermer tout sheet existant
  closeDiscoveryDetail();

  const sheet = document.createElement('div');
  sheet.id = SHEET_ID;
  sheet.innerHTML = buildSheetHTML(detail);

  // Fermer au clic overlay ou bouton close
  sheet.addEventListener('click', (e) => {
    if (e.target.hasAttribute('data-discovery-detail-close')) {
      closeDiscoveryDetail();
    }
  });

  // Fermer à Escape
  const onEscape = (e) => {
    if (e.key === 'Escape') closeDiscoveryDetail();
  };
  document.addEventListener('keydown', onEscape);
  sheet._cleanupEscape = onEscape;

  document.body.appendChild(sheet);
  return sheet;
}

export function closeDiscoveryDetail() {
  const existing = document.getElementById(SHEET_ID);
  if (!existing) return;
  if (existing._cleanupEscape) {
    document.removeEventListener('keydown', existing._cleanupEscape);
  }
  existing.remove();
}

export function isDetailOpen() {
  return !!document.getElementById(SHEET_ID);
}
