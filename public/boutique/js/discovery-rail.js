/**
 * @komerce-arch-lite
 * @role          catalog-discovery-rail
 * @domain        catalog
 * @layer         ui-component
 * @owner         public/boutique/js/discovery-rail.js
 * @purpose       Monter « Disponible ici » dans chaque contexte catégorie et déléguer l'exposition au backend.
 * @impact-areas  home, product-discovery, discovery-rail, category-navigation, desktop
 * @version       2026-09
 */
'use strict';

import { bus } from './b-bus.js';
import { openModal } from './b-modal.js';
import { _setupInfiniteLoop } from './b-pager.js';
import { fetchDiscoveryRail, fetchServiceCard, fetchPhysicalOfferCard } from './discovery-api.js';
import { renderDiscoveryRail } from './render/render-discovery-rail.js';

let _installed = false;
let _lastCards = null;
let _gridObserver = null;
let _mountSyncScheduled = false;
let _activeDesktopCategory = 'all';

function isMobileViewport() {
  return typeof window !== 'undefined' && window.innerWidth < 900;
}

function activeCategoryFromDom() {
  const chip = document.querySelector('.k-chip.active[data-cat]');
  return chip?.dataset.cat || 'all';
}

function bindShell(shell) {
  if (!shell || shell.dataset.discoveryBound === '1') return shell;
  shell.dataset.discoveryBound = '1';
  shell.addEventListener('click', handleDiscoveryClick);
  return shell;
}

function createShell(category, titleId) {
  const shell = document.createElement('section');
  shell.className = 'k-discovery-shell';
  shell.dataset.discoveryCategory = category;
  shell.hidden = true;
  shell.setAttribute('aria-labelledby', titleId);
  return bindShell(shell);
}

function mobileShellForCategory(category) {
  return Array.from(document.querySelectorAll('.k-discovery-shell[data-discovery-category]'))
    .find(shell => shell.dataset.discoveryCategory === category) || null;
}

function removeDesktopShell() {
  const shell = document.getElementById('k-discovery-local');
  if (shell) shell.remove();
}

function removeMobileShells() {
  document.querySelectorAll('.k-discovery-shell[data-discovery-category]')
    .forEach(shell => shell.remove());
}

function ensureMobileMounts() {
  removeDesktopShell();
  const pages = Array.from(document.querySelectorAll(
    '#k-grid > .k-cat-section[data-cat]:not([data-ghost])'
  ));
  if (pages.length === 0) return [];

  return pages.map((page, index) => {
    const category = page.dataset.cat || 'all';
    const titleId = `k-discovery-local-title-${index}`;
    let shell = mobileShellForCategory(category);
    if (!shell) shell = createShell(category, titleId);
    bindShell(shell);
    shell.setAttribute('aria-labelledby', titleId);

    if (shell.parentElement !== page || shell !== page.firstElementChild) {
      page.insertBefore(shell, page.firstElementChild);
    }
    return { shell, category, titleId };
  });
}

function ensureDesktopMount() {
  removeMobileShells();
  const catalog = document.getElementById('k-desktop-catalog-wrap');
  if (!catalog) return null;

  let shell = document.getElementById('k-discovery-local');
  if (!shell) {
    shell = document.createElement('section');
    shell.id = 'k-discovery-local';
    shell.className = 'k-discovery-shell';
    shell.hidden = true;
    shell.setAttribute('aria-labelledby', 'k-discovery-local-title');
  }
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

function cardsForCategory(cards, category) {
  const list = Array.isArray(cards) ? cards : [];
  if (category === 'all') return list;
  return list.filter(card =>
    Array.isArray(card?.category_keys) && card.category_keys.includes(category)
  );
}

function refreshGhostSnapshot() {
  const grid = document.getElementById('k-grid');
  if (!isMobileViewport() || !grid?.classList.contains('k-grid-cat-pager')) return;
  _setupInfiniteLoop();
}

function syncMountAndRender() {
  if (_lastCards === null) return 0;
  const marketLabel = getMarketLabel();

  if (isMobileViewport()) {
    const mounts = ensureMobileMounts();
    let rendered = 0;
    for (const { shell, category, titleId } of mounts) {
      rendered += renderDiscoveryRail(
        shell,
        cardsForCategory(_lastCards, category),
        { marketLabel, titleId, title: 'Disponible ici' }
      );
    }
    refreshGhostSnapshot();
    return rendered;
  }

  const shell = ensureDesktopMount();
  if (!shell) return 0;
  return renderDiscoveryRail(shell, cardsForCategory(_lastCards, _activeDesktopCategory), {
    marketLabel,
    titleId: 'k-discovery-local-title',
    title: 'Disponible ici',
  });
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

  // renderGrid() remplace les pages réelles. Les mutations qui ne concernent
  // que le ghost sont ignorées afin que le refresh du snapshot ne reboucle pas
  // sur le MutationObserver.
  _gridObserver = new MutationObserver(mutations => {
    const realPageMutation = mutations.some(mutation => {
      const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
      return nodes.some(node =>
        node.nodeType === 1 && !node.matches?.('[data-ghost]')
      );
    });
    if (realPageMutation) scheduleMountSync();
  });
  _gridObserver.observe(grid, { childList: true });
}

function handleCatalogCategoryChanged(category) {
  _activeDesktopCategory = category || 'all';
  if (!isMobileViewport()) syncMountAndRender();
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

  _activeDesktopCategory = activeCategoryFromDom();
  installGridObserver();
  window.addEventListener('resize', scheduleMountSync, { passive: true });
  bus.on('catalog:cat-changed', handleCatalogCategoryChanged);

  // Un seul fetch alimente mobile et desktop. category_keys vient du backend ;
  // le frontend ne fait qu'en prendre le sous-ensemble sans modifier l'ordre.
  refreshDiscoveryRail().catch(() => {
    _lastCards = [];
    syncMountAndRender();
  });
}

export {
  refreshDiscoveryRail,
  openDiscoveryDetail,
  handleDiscoveryClick,
  cardsForCategory,
  activeCategoryFromDom,
};
