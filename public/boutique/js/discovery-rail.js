/**
 * @komerce-arch-lite
 * @role          catalog-discovery-rail
 * @domain        catalog
 * @layer         ui-component
 * @owner         public/boutique/js/discovery-rail.js
 * @purpose       Monter « Disponible ici » sur l'accueil Tout uniquement (mobile et desktop).
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
import { fetchDiscoveryRail, fetchServiceCard, fetchPhysicalOfferCard } from './discovery-api.js';
import { renderDiscoveryRail } from './render/render-discovery-rail.js';
import { ensureDiscoveryDesktopV2Stylesheet } from './discovery-desktop-style.js';

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

function activeMobileCategory() {
  return state.activeCat || activeCategoryFromDom();
}

function bindShell(shell) {
  if (!shell || shell.dataset.discoveryBound === '1') return shell;
  shell.dataset.discoveryBound = '1';
  shell.addEventListener('click', handleDiscoveryClick);
  shell.addEventListener('keydown', handleDiscoveryKeydown);
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

/**
 * Mobile : Tout garde son rail natif. Les autres catégories restent des
 * surfaces catalogue pures, quelle que soit la façon d'y entrer (tap de puce
 * ou swipe horizontal) — même règle que le desktop.
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

function discoveryProductCard(ref) {
  const cards = Array.isArray(_lastCards) ? _lastCards : [];
  return cards.find(card =>
    card?.kind === 'product'
    && String(card.cta_action_ref) === String(ref)
  ) || null;
}

function discoveryCategory(card) {
  const keys = Array.isArray(card?.category_keys) ? card.category_keys : [];
  return keys.find(key => String(key).toLowerCase() !== 'soldes') || '';
}

/**
 * openModal() ouvre encore le shell produit à partir de state.products avant que
 * le Product Detail Contract ne prenne le relais. Un produit Discovery est déjà
 * garanti public par le backend mais peut ne pas faire partie du snapshot
 * catalogue chargé/paginé côté navigateur. On crée donc un snapshot UI minimal,
 * explicitement éphémère, uniquement pour amorcer le shell canonique.
 *
 * La vérité transactionnelle reste GET /api/products/:id/detail : ce snapshot ne
 * porte ni variantes, ni disponibilité, ni stock et ne doit jamais autoriser un
 * quick-add par défaut.
 */
function ensureDiscoveryProductSnapshot(ref) {
  const existing = Array.isArray(state.products)
    ? state.products.find(candidate => String(candidate?.id) === String(ref))
    : null;
  if (existing) return existing;

  const card = discoveryProductCard(ref);
  if (!card || !card.title) return null;

  const snapshot = {
    id: card.cta_action_ref,
    name: String(card.title),
    image_url: card.image_ref ? String(card.image_ref) : '',
    price_kmf: card.price != null ? Number(card.price) : null,
    category: discoveryCategory(card),
    promo_pct: 0,
    __discovery_ephemeral: true,
  };

  if (!Array.isArray(state.products)) state.products = [];
  state.products.push(snapshot);
  return snapshot;
}

function cleanupDiscoveryProductSnapshots() {
  if (!Array.isArray(state.products)) return;
  for (let index = state.products.length - 1; index >= 0; index -= 1) {
    if (state.products[index]?.__discovery_ephemeral) {
      state.products.splice(index, 1);
    }
  }
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
    const category = activeMobileCategory();

    // Un onglet catégorie est une surface catalogue pure : on retire TOUS les
    // shells Discovery hors de Tout.
    if (category !== 'all') {
      removeDesktopShell();
      removeMobileShells();
      markAllCartButtons();
      return 0;
    }

    const mount = ensureMobileHomeMount();
    if (!mount) return 0;

    const rendered = renderDiscoveryRail(
      mount.shell,
      _lastCards,
      { marketLabel, titleId: mount.titleId, title: 'Disponible ici' }
    );

    markAllCartButtons();
    refreshGhostSnapshot();
    return rendered;
  }

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
  const nextCategory = category || 'all';
  _activeDesktopCategory = nextCategory;

  syncMountAndRender();
}

function handlePagerCategoryCentered(chip) {
  if (!isMobileViewport()) return;
  const category = chip?.dataset?.cat || null;
  if (!category) return;

  // Toute entrée dans une catégorie (tap d'onglet, swipe horizontal,
  // restauration pager) est une surface catégorie pure. Retirer tous les
  // shells mobile évite qu'un ancien rail de Tout reste visible dans le pager.
  if (category === 'all') {
    syncMountAndRender();
    return;
  }
  removeMobileShells();
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
    const product = ensureDiscoveryProductSnapshot(ref);
    if (!product) return false;
    openModal(product.id);
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

    const product = Array.isArray(state.products)
      ? state.products.find(candidate => String(candidate?.id) === String(id))
      : null;

    // Un produit visible dans Discovery mais absent du snapshot catalogue (ou
    // seulement présent comme snapshot éphémère d'ouverture) n'a pas de vérité
    // variantes locale suffisante pour un quick-add. Fail-safe : ouvrir la PDC.
    if (!product || product.__discovery_ephemeral) {
      openDiscoveryDetail('product', id);
      return;
    }

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

function handleDiscoveryKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  if (event.target.closest('button, a, input, select, textarea, [data-action]')) return;

  const target = event.target.closest('[data-discovery-kind][data-discovery-ref]');
  if (!target) return;

  const kind = target.dataset.discoveryKind;
  const ref = target.dataset.discoveryRef;
  if (!kind || !ref) return;

  event.preventDefault();
  openDiscoveryDetail(kind, ref);
}

export function setupDiscoveryRail() {
  if (_installed) return;
  _installed = true;

  _activeDesktopCategory = activeCategoryFromDom();
  ensureDiscoveryDesktopV2Stylesheet();
  installGridObserver();
  window.addEventListener('resize', scheduleMountSync, { passive: true });
  bus.on('chip:center', handlePagerCategoryCentered);
  bus.on('catalog:cat-changed', handleCatalogCategoryChanged);
  bus.on('modal:closed', cleanupDiscoveryProductSnapshots);

  // Un seul fetch alimente le rail de Tout.
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
  handleDiscoveryKeydown,
  handlePagerCategoryCentered,
  cardsForCategory,
  activeCategoryFromDom,
  productHasVariants,
  ensureDiscoveryProductSnapshot,
  cleanupDiscoveryProductSnapshots,
};