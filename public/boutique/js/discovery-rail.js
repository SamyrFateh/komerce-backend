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
 * Le champ de recherche réel reste dans le header : renderGrid() remplace les
 * pages Temu et arracherait un input monté directement dans "Tout" pendant la
 * frappe. La home porte donc un launcher visuel, dans le flux, qui donne le
 * focus au moteur canonique sans dupliquer sa logique ni son état.
 */
function ensureMobileSearchLauncher(allPage) {
  if (!allPage) return null;

  let launcher = document.getElementById('k-home-search-launcher');
  if (!launcher) {
    launcher = document.createElement('button');
    launcher.id = 'k-home-search-launcher';
    launcher.className = 'k-home-search-launcher';
    launcher.type = 'button';
    launcher.textContent = 'Rechercher un produit, un service…';
    launcher.setAttribute('aria-label', 'Rechercher dans Komerce');
    launcher.addEventListener('click', () => {
      const input = document.getElementById('k-search-input');
      if (!input) return;
      try {
        input.focus({ preventScroll: true });
      } catch (e) {
        input.focus();
      }
      const end = input.value.length;
      if (typeof input.setSelectionRange === 'function') {
        input.setSelectionRange(end, end);
      }
    });
  }

  if (launcher.parentElement !== allPage || launcher !== allPage.firstElementChild) {
    allPage.insertBefore(launcher, allPage.firstElementChild);
  }
  return launcher;
}

/**
 * Mobile + pager Temu : « Près de vous » doit vivre DANS la page verticale
 * "Tout". #k-page-scroll.k-pager-active est une cage fixed overflow:hidden ;
 * placer Discovery comme sibling du catalogue dans cette cage crée du contenu
 * sans scroll owner et réduit/masque #k-catalog-section.
 *
 * Composition mobile V2.8 : recherche dans le flux → Près de vous → catalogue.
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

    const searchLauncher = ensureMobileSearchLauncher(allPage);

    if (!shell) shell = createShell();
    bindShell(shell);

    // Le local est le premier contenu marchand de la home, juste après l'outil
    // de recherche dans le flux. Le reste du catalogue vient ensuite.
    if (shell.parentElement !== allPage || shell.previousElementSibling !== searchLauncher) {
      if (searchLauncher) searchLauncher.insertAdjacentElement('afterend', shell);
      else allPage.insertBefore(shell, allPage.firstElementChild);
    }
    return shell;
  }

  const mobileLauncher = document.getElementById('k-home-search-launcher');
  if (mobileLauncher) mobileLauncher.remove();

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

  // renderGrid() remplace les .k-cat-section enfants directs. Le shell mobile
  // et le launcher search, volontairement montés dans "Tout", disparaissent
  // donc avec l'ancien rendu. On les remonte depuis le cache au microtask.
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