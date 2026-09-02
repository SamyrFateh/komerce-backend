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
let _cards = null;
let _marketLabel = '';
let _mountObserver = null;
let _mountRaf = 0;

const MOBILE_BREAKPOINT = 900;

function isMobile() {
  return window.innerWidth < MOBILE_BREAKPOINT;
}

function bindShell(shell) {
  if (!shell || shell.dataset.discoveryClickBound === '1') return;
  shell.dataset.discoveryClickBound = '1';
  shell.addEventListener('click', handleDiscoveryClick);
}

function ensureMount() {
  let shell = document.getElementById('k-discovery-local');
  const catalog = document.getElementById('k-desktop-catalog-wrap');
  if (!catalog) return null;

  // Le pager Temu mobile confine #k-page-scroll en overflow:hidden. Son seul
  // propriétaire de scroll vertical est la page .k-cat-section active : tout
  // contenu placé comme frère du pager devient donc visible mais impossible à
  // faire défiler. Discovery appartient à la page "Tout" sur mobile.
  const mobile = isMobile();
  const mobilePage = mobile
    ? document.querySelector('#k-grid > .k-cat-section[data-cat="all"]:not([data-ghost])')
    : null;
  if (mobile && !mobilePage) return null;

  if (!shell) {
    shell = document.createElement('section');
    shell.id = 'k-discovery-local';
    shell.className = 'k-discovery-shell';
    shell.dataset.pagerStatic = 'true';
    shell.hidden = true;
    shell.setAttribute('aria-labelledby', 'k-discovery-local-title');
  }

  if (mobilePage) {
    if (shell.parentElement !== mobilePage || mobilePage.firstElementChild !== shell) {
      mobilePage.prepend(shell);
    }
  } else if (shell.nextElementSibling !== catalog) {
    catalog.insertAdjacentElement('beforebegin', shell);
  }

  bindShell(shell);
  return shell;
}

function renderCachedDiscoveryRail() {
  if (!_cards) return 0;
  const shell = ensureMount();
  if (!shell) return 0;
  return renderDiscoveryRail(shell, _cards, { marketLabel: _marketLabel });
}

function scheduleMount() {
  if (_mountRaf) cancelAnimationFrame(_mountRaf);
  _mountRaf = requestAnimationFrame(() => {
    _mountRaf = 0;
    renderCachedDiscoveryRail();
  });
}

function getMarketLabel() {
  try {
    return window.KomerceMarket?.get()?.gentile_short || '';
  } catch (e) {
    return '';
  }
}

async function refreshDiscoveryRail() {
  const payload = await fetchDiscoveryRail();
  const cards = Array.isArray(payload) ? payload : payload?.cards;
  _cards = Array.isArray(cards) ? cards : [];
  _marketLabel = getMarketLabel();
  return renderCachedDiscoveryRail();
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

  // renderGrid() remplace les pages du pager par innerHTML. Observer uniquement
  // les enfants directs du grid permet de remonter le shell dans la nouvelle
  // page "Tout" sans observer les mutations internes du rail lui-même.
  const grid = document.getElementById('k-grid');
  if (grid && window.MutationObserver) {
    _mountObserver = new MutationObserver(scheduleMount);
    _mountObserver.observe(grid, { childList: true });
  }
  window.addEventListener('resize', scheduleMount, { passive: true });

  refreshDiscoveryRail().catch(() => {
    _cards = [];
    const shell = ensureMount();
    if (shell) {
      shell.innerHTML = '';
      shell.hidden = true;
    }
  });
}

export {
  ensureMount,
  renderCachedDiscoveryRail,
  refreshDiscoveryRail,
  openDiscoveryDetail,
  handleDiscoveryClick,
};
