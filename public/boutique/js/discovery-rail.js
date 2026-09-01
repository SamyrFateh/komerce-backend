/**
 * @komerce-arch-lite
 * @role          catalog-discovery-rail
 * @domain        catalog
 * @layer         ui-component
 * @owner         public/boutique/js/discovery-rail.js
 * @purpose       Monter le rail « Près de vous » dans la home Boutique et déléguer l'exposition au backend.
 * @impact-areas  home, product-discovery, discovery-rail
 * @version       2026-08
 */
'use strict';

import { requestDiscovery } from './discovery-actions.js';
import { openModal } from './b-modal.js';
import { fetchDiscoveryRail, fetchServiceCard, fetchPhysicalOfferCard } from './discovery-api.js';
import { renderDiscoveryRail } from './render/render-discovery-rail.js';

let _installed = false;

function ensureMount() {
  let shell = document.getElementById('k-discovery-local');
  if (shell) return shell;

  const catalog = document.getElementById('k-desktop-catalog-wrap');
  if (!catalog) return null;

  shell = document.createElement('section');
  shell.id = 'k-discovery-local';
  shell.className = 'k-discovery-shell';
  shell.hidden = true;
  shell.setAttribute('aria-labelledby', 'k-discovery-local-title');
  catalog.insertAdjacentElement('beforebegin', shell);
  return shell;
}

function getMarketLabel() {
  try {
    return window.KomerceMarket?.get()?.gentile_short || '';
  } catch (e) {
    return '';
  }
}

async function refreshDiscoveryRail() {
  const shell = ensureMount();
  if (!shell) return 0;

  const payload = await fetchDiscoveryRail();
  const cards = Array.isArray(payload) ? payload : payload?.cards;
  return renderDiscoveryRail(shell, cards, { marketLabel: getMarketLabel() });
}

function handleDiscoveryClick(event) {
  // CTA button click — action directe
  const button = event.target.closest('[data-discovery-action][data-discovery-ref]');
  if (button && button.matches('button')) {
    const kind = button.dataset.discoveryAction;
    const ref = button.dataset.discoveryRef;
    if (!kind || !ref) return;

    if (kind === 'product') {
      openModal(ref);
      return;
    }

    requestDiscovery(kind, ref, button);
    return;
  }

  // Card click (non-button) — all kinds open the same Komerce modal shell.
  const card = event.target.closest('.k-discovery-card[data-discovery-kind][data-discovery-ref]');
  if (!card) return;

  const kind = card.dataset.discoveryKind;
  const ref = card.dataset.discoveryRef;
  if (!kind || !ref) return;

  if (kind === 'product') {
    openModal(ref);
  } else if (kind === 'service' || kind === 'physical_offer') {
    openCardDetail(kind, ref);
  }
}

async function openCardDetail(kind, ref) {
  const fetcher = kind === 'service' ? fetchServiceCard : fetchPhysicalOfferCard;
  const detail = await fetcher(ref);
  if (!detail) return;
  openModal(ref, { kind, detail });
}

export function setupDiscoveryRail() {
  if (_installed) return;
  _installed = true;

  const shell = ensureMount();
  if (!shell) return;

  shell.addEventListener('click', handleDiscoveryClick);


  refreshDiscoveryRail().catch(() => {
    shell.innerHTML = '';
    shell.hidden = true;
  });
}

export { refreshDiscoveryRail };
