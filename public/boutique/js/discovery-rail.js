/**
 * @komerce-arch-lite
 * @role          catalog-discovery-rail
 * @domain        catalog
 * @layer         ui-component
 * @owner         public/boutique/js/discovery-rail.js
 * @purpose       Monter « Disponible ici » sur Tout et, sur mobile, à l'entrée d'une catégorie par bump vertical uniquement.
 * @impact-areas  home, product-discovery, discovery-rail, category-navigation, mobile, desktop
 * @version       2026-09
 */
'use strict';

import { bus } from './b-bus.js';
import { state } from './b-store.js';
import { openModal } from './b-modal.js';
import {
  quickAdd,
  quickRemove,
  openCartWithHighlight,
  markAllCartButtons,
} from './b-cart.js';
import { _setupInfiniteLoop } from './b-pager.js';
import { PAGER_BUMP_EVENT } from './b-pager-end-bounce.js';
import { fetchDiscoveryRail, fetchServiceCard, fetchPhysicalOfferCard } from './discovery-api.js';
import { renderDiscoveryRail } from './render/render-discovery-rail.js';
import { ensureDiscoveryDesktopV2Stylesheet } from './discovery-desktop-style.js';

let _installed = false;
let _lastCards = null;
let _gridObserver = null;
let _mountSyncScheduled = false;
let _activeDesktopCategory = 'all';
let _pendingBumpCategory = null;
let _activeMobileBumpCategory = null;

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

function removeDesktopShell() {
  const shell = document.getElementById('k-discovery-local');
  if (shell) shell.remove();
}

function removeMobileShells() {
  document.querySelectorAll('.k-discovery-shell[data-discovery-category]')
    .forEach(shell => shell.remove());
}

function removeMobileBumpShells() {
  document.querySelectorAll('.k-discovery-shell[data-discovery-entry="bump"]')
    .forEach(shell => shell.remove());
}

/**
 * Mobile : Tout garde son rail natif. Les autres catégories restent pures
 * lorsqu'elles sont ouvertes par tap/swipe ; elles ne gagnent un rail local
 * qu'après un bump vertical explicite depuis la catégorie précédente.
 */
function ensureMobileHomeMount() {
  removeDesktopShell();
  removeMobileShells();

  const page = document.querySelector(
    '#k-grid > .k-cat-section[data-cat="all"]:not([data-ghost])'
  );
  if (!page) return null;

  const titleId = 'k-discovery-local-title-mobile';
  const shell = createShell('all', titleId);
  shell.dataset.discoveryEntry = 'home';
  page.insertBefore(shell, page.firstElementChild);
  return { shell, titleId };
}

function bumpTitleId(category) {
  const safe = String(category || 'local').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  return `k-discovery-local-title-bump-${safe}`;
}

function mountMobileBumpRail(category) {
  if (!isMobileViewport() || !category || category === 'all' || _lastCards === null) return 0;

  removeMobileBumpShells();
  const page = document.querySelector(
    `#k-grid > .k-cat-section[data-cat="${String(category).replace(/"/g, '\\"')}"]:not([data-ghost])`
  );
  if (!page) return 0;

  const cards = cardsForCategory(_lastCards, category);
  if (cards.length === 0) return 0;

  const titleId = bumpTitleId(category);
  const shell = createShell(category, titleId);
  shell.dataset.discoveryEntry = 'bump';
  page.insertBefore(shell, page.firstElementChild);

  const rendered = renderDiscoveryRail(shell, cards, {
    marketLabel: getMarketLabel(),
    titleId,
    title: 'Disponible ici',
  });
  if (rendered === 0) {
    shell.remove();
    return 0;
  }

  markAllCartButtons();
  return rendered;
}

function ensureDesktopMount() {
  removeMobileShells();
  const catalog = document.getElementById('k-desktop-catalog-wrap');
  if (!catalog) return null;

  ensureDiscoveryDesktopV2Stylesheet();

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
    const mount = ensureMobileHomeMount();
    if (!mount) return 0;

    let rendered = renderDiscoveryRail(
      mount.shell,
      _lastCards,
      { marketLabel, titleId: mount.titleId, title: 'Disponible ici' }
    );

    // Si un rerender survient pendant une entrée par bump, reconstruire aussi
    // la surface transitoire de la catégorie depuis le cache déjà chargé.
    if (_activeMobileBumpCategory && _activeMobileBumpCategory !== 'all') {
      rendered += mountMobileBumpRail(_activeMobileBumpCategory);
    }

    markAllCartButtons();
    refreshGhostSnapshot();
    return rendered;
  }

  _pendingBumpCategory = null;
  _activeMobileBumpCategory = null;

  // Desktop : « Disponible ici » reste une surface d'accueil uniquement.
  if (_activeDesktopCategory !== 'all') {
    removeDesktopShell();
    return 0;
  }

  const shell = ensureDesktopMount();
  if (!shell) return 0;
  const rendered = renderDiscoveryRail(shell, _lastCards, {
    marketLabel,
    titleId: 'k-discovery-local-title',
    title: 'Disponible ici',
  });

  markAllCartButtons();
  return rendered;
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
  if (isMobileViewport()) {
    _pendingBumpCategory = null;
    _activeMobileBumpCategory = null;
    removeMobileBumpShells();
    return;
  }
  syncMountAndRender();
}

function handlePagerBump(event) {
  if (!isMobileViewport()) return;
  const category = event?.detail?.to || 'all';
  _pendingBumpCategory = category;
  _activeMobileBumpCategory = category === 'all' ? null : category;

  if (category === 'all') {
    removeMobileBumpShells();
    return;
  }
  mountMobileBumpRail(category);
}

function handlePagerCategoryCentered(chip) {
  if (!isMobileViewport()) return;
  const category = chip?.dataset?.cat || null;
  if (!category) return;

  // Le bump émet son intention avant que b-pager centre la chip. Cette première
  // synchronisation est donc la suite du même geste et conserve le rail local.
  if (_pendingBumpCategory === category) {
    _pendingBumpCategory = null;
    return;
  }

  // Toute autre entrée (tap d'onglet, swipe horizontal, restauration pager)
  // redevient une surface catégorie pure.
  _pendingBumpCategory = null;
  _activeMobileBumpCategory = null;
  removeMobileBumpShells();
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

function productHasVariants(product) {
  return Boolean(
    product?.has_variants
    || product?.hasVariants
    || product?.inventory_model === 'SKU'
  );
}

function handleDiscoveryClick(event) {
  const actionButton = event.target.closest(
    '[data-discovery-kind="product"] .k-card-add [data-action]'
  );
  if (actionButton) {
    const addControl = actionButton.closest('.k-card-add[data-add]');
    const id = addControl?.dataset.add;
    if (!id) return;

    event.preventDefault();
    event.stopPropagation();

    const action = actionButton.dataset.action;
    if (action === 'decrement') {
      quickRemove(id, actionButton);
      return;
    }
    if (action === 'review') {
      openCartWithHighlight(id);
      return;
    }

    const product = state.products.find(candidate => String(candidate?.id) === String(id));
    quickAdd(id, actionButton, { hasVariants: productHasVariants(product) });
    return;
  }

  const target = event.target.closest(
    '[data-discovery-action][data-discovery-ref], [data-discovery-kind][data-discovery-ref]'
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
  ensureDiscoveryDesktopV2Stylesheet();
  installGridObserver();
  window.addEventListener('resize', scheduleMountSync, { passive: true });
  window.addEventListener(PAGER_BUMP_EVENT, handlePagerBump);
  bus.on('chip:center', handlePagerCategoryCentered);
  bus.on('catalog:cat-changed', handleCatalogCategoryChanged);

  // Un seul fetch alimente Tout et les éventuelles projections de bump.
  // category_keys reste la vérité qui borne le sous-pool local de la catégorie.
  refreshDiscoveryRail().catch(() => {
    _lastCards = [];
    syncMountAndRender();
  });
}

export {
  refreshDiscoveryRail,
  openDiscoveryDetail,
  handleDiscoveryClick,
  handlePagerBump,
  handlePagerCategoryCentered,
  cardsForCategory,
  activeCategoryFromDom,
  productHasVariants,
};
