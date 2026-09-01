/**
 * @komerce-arch-lite
 * @role          catalog-discovery-rail
 * @domain        catalog
 * @layer         ui-component
 * @owner         public/boutique/js/discovery-rail.js
 * @purpose       Monter le rail « Près de vous » dans la home Boutique et déléguer l'exposition au backend.
 * @impact-areas  home, product-discovery, discovery-rail
 * @version       2026-09
 */
'use strict';

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

/**
 * Point d'entrée unique du détail Discovery.
 * Product utilise le chemin PDC existant ; Service/Physical Offer chargent
 * leur projection puis ouvrent le même shell #k-modal.
 * Aucune Inquiry n'est créée depuis le rail : l'action métier finale vit
 * exclusivement dans la fiche détaillée Komerce.
 */
async function openDiscoveryDetail(kind, ref) {
  if (!kind || !ref) return false;

  if (kind === 'product') {
    openModal(ref);
    return true;
  }

  if (kind !== 'service' && kind !== 'physical_offer') return false;

  const fetcher = kind === 'service' ? fetchServiceCard : fetchPhysicalOfferCard;
  const detail = await fetcher(ref);
  if (!detail) return false;

  openModal(ref, { kind, detail });
  return true;
}

function handleDiscoveryClick(event) {
  const target = event.target.closest(
    '[data-discovery-action][data-discovery-ref], .k-discovery-card[data-discovery-kind][data-discovery-ref]'
  );
  if (!target) return;

  const isAction = target.matches('[data-discovery-action][data-discovery-ref]');
  const kind = isAction ? target.dataset.discoveryAction : target.dataset.discoveryKind;
  const ref = target.dataset.discoveryRef;
  if (!kind || !ref) return;

  openDiscoveryDetail(kind, ref);
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

export { refreshDiscoveryRail, openDiscoveryDetail, handleDiscoveryClick };
