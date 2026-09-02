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
let _lastCards = null;
let _gridObserver = null;
let _mountSyncScheduled = false;

function isMobileViewport() {
  return typeof window !== 'undefined' && window.innerWidth < 900;
}

function bindShell(shell) {
  if (!shell || shell.dataset.discoveryBound === '1') return shell;
  shell.dataset.discoveryBound = '1';
  shell.addEventListener('click', handleDiscoveryClick);
  return shell;
}

function createShell() {
  const shell = document.createElement('section');
  shell.id = 'k-discovery-local';
  shell.className = 'k-discovery-shell';
  shell.hidden = true;
  shell.setAttribute('aria-labelledby', 'k-discovery-local-title');
  return bindShell(shell);
}

/**
 * Mobile + pager Temu : « Près de vous » vit DANS la page verticale "Tout".
 * #k-page-scroll.k-pager-active est une cage fixed overflow:hidden ; placer
 * Discovery comme sibling du catalogue crée du contenu sans scroll owner.
 *
 * Composition mobile : Près de vous est le premier contenu marchand après le
 * chrome Temu. La recherche globale reste accessible par la loupe du header et
 * ne réserve plus aucune bande dans le flux.
 *
 * Desktop : on conserve la composition éditoriale validée, juste avant le
 * wrapper catalogue.
 */
function ensureMount() {
  let shell = document.getElementById('k-discovery-local');

  if (isMobileViewport()) {
    const allPage = document.querySelector(
      '#k-grid > .k-cat-section[data-cat="all"]:not([data-ghost])'
    );
    if (!allPage) return null;

    if (!shell) shell = createShell();
    bindShell(shell);

    if (shell.parentElement !== allPage || shell !== allPage.firstElementChild) {
      allPage.insertBefore(shell, allPage.firstElementChild);
    }
    return shell;
  }

  const catalog = document.getElementById('k-desktop-catalog-wrap');
  if (!catalog) return null;

  if (!shell) shell = createShell();
  bindShell(shell);
  if (shell.nextElementSibling !== catalog) {
    catalog.insertAdjacentElement('beforebegin', shell);
  }
  return shell;
}

function getMarketLabel() {
  try {
    return window.KomerceMarket?.get()?.gentile_short || '';
  } catch (e) {
    return '';
  }
}

function syncMountAndRender() {
  const shell = ensureMount();
  if (!shell) return 0;
  if (_lastCards === null) return 0;
  return renderDiscoveryRail(shell, _lastCards, { marketLabel: getMarketLabel() });
}

function scheduleMountSync() {
  if (_mountSyncScheduled) return;
  _mountSyncScheduled = true;
  Promise.resolve().then(() => {
    _mountSyncScheduled = false;
    syncMountAndRender();
  });
}

function installGridObserver() {
  if (_gridObserver || typeof MutationObserver === 'undefined') return;
  const grid = document.getElementById('k-grid');
  if (!grid) return;

  // renderGrid() remplace les .k-cat-section enfants directs. Le shell mobile,
  // volontairement monté dans "Tout", disparaît avec l'ancien rendu. On le
  // remonte depuis le cache Discovery au prochain microtask.
  _gridObserver = new MutationObserver(scheduleMountSync);
  _gridObserver.observe(grid, { childList: true });
}

async function refreshDiscoveryRail() {
  const payload = await fetchDiscoveryRail();
  _lastCards = Array.isArray(payload) ? payload : payload?.cards;
  return syncMountAndRender();
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

  installGridObserver();
  window.addEventListener('resize', scheduleMountSync, { passive: true });

  // Le fetch ne dépend plus de l'existence immédiate du mount mobile : au boot,
  // le catalogue peut encore être en train de rendre ses pages. Les cartes sont
  // gardées en mémoire puis projetées dès que la page "Tout" existe.
  refreshDiscoveryRail().catch(() => {
    _lastCards = [];
    const shell = ensureMount();
    if (shell) {
      shell.innerHTML = '';
      shell.hidden = true;
    }
  });
}

export { refreshDiscoveryRail, openDiscoveryDetail, handleDiscoveryClick };
