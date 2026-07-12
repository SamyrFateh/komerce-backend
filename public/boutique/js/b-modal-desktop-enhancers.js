/**
 * @komerce-arch
 * @role          desktop-product-modal-enhancer
 * @domain        boutique
 * @layer         ui-enhancer
 * @criticality   medium
 * @inputs        modal_state, product_view_model, desktop_viewport, bus_events
 * @outputs       desktop_navigation_and_editorial_enhancements, contract_classes
 * @depends       b-bus.js, b-catalog.js, b-modal.js, b-scroll-owner.js, view-models/modal-view-model.js
 * @used-by       b-desktop-upgrade.js, main.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md, docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md
 * @impact-areas  modal-desktop, product-discovery, responsive-layout
 * @version       2026-07
 */

'use strict';

/**
 * PDC-5 — Enhancer desktop de COMPOSITION uniquement.
 *
 * Ce module ne calcule plus :
 *   - prix / ancien prix / économie ;
 *   - stock ou rareté ;
 *   - livraison ;
 *   - sous-total ;
 *   - paiement produit.
 *
 * Ces vérités appartiennent au Product Detail Contract, au reducer SKU et au
 * renderer `b-modal-desktop-product.js`. L'enhancer conserve seulement le
 * contexte de navigation et les enrichissements éditoriaux desktop.
 */

import { bus }                  from './b-bus.js';
import { state, dom, modalZone } from './b-store.js';
import { fmtPrice }             from './b-utils.js';
import { showToast }            from './b-cart-core.js';
import { openModal }            from './b-modal.js';
import { setActiveCat }         from './b-catalog.js';
import { normalizeCategoryKey } from './shop-schema.js';
import { isDesktop }            from './b-scroll-owner.js';
import {
  buildModalViewModel,
  applyModalClasses,
} from './view-models/modal-view-model.js';

let _enhancersInstalled = false;
let _vmListenerInstalled = false;

function currentDisplayProduct() {
  const detail = state.modalProductDetail;
  if (detail?.product) {
    return {
      id: detail.product.id,
      name: detail.product.name,
      category: detail.product.category,
      price_kmf: detail.pricing?.price_kmf ?? null,
    };
  }
  return state.modalProduct || null;
}

function injectBreadcrumb() {
  if (!isDesktop()) return;
  const topbar = modalZone('.k-modal-topbar');
  const product = currentDisplayProduct();
  if (!topbar || !product) return;

  topbar.querySelector('.k-modal-breadcrumb')?.remove();

  const cat = product.category || '';
  const name = product.name || '';
  const breadcrumb = document.createElement('div');
  breadcrumb.className = 'k-modal-breadcrumb';

  const shop = document.createElement('span');
  shop.className = 'k-modal-breadcrumb-cat';
  shop.dataset.cat = cat;
  shop.textContent = 'Boutique';

  const sep1 = document.createElement('span');
  sep1.className = 'k-modal-breadcrumb-sep';
  sep1.textContent = '›';

  const category = document.createElement('span');
  category.className = 'k-modal-breadcrumb-cat';
  category.dataset.cat = cat;
  category.textContent = cat;

  const sep2 = document.createElement('span');
  sep2.className = 'k-modal-breadcrumb-sep';
  sep2.textContent = '›';

  const productName = document.createElement('span');
  productName.className = 'k-modal-breadcrumb-name';
  productName.textContent = name;

  breadcrumb.append(shop, sep1, category, sep2, productName);

  const backBtn = topbar.querySelector('.k-modal-back');
  if (backBtn?.nextSibling) topbar.insertBefore(breadcrumb, backBtn.nextSibling);
  else topbar.appendChild(breadcrumb);

  breadcrumb.querySelectorAll('.k-modal-breadcrumb-cat').forEach((el) => {
    el.addEventListener('click', () => {
      const value = el.dataset.cat;
      if (!value) return;
      bus.emit('modal:close');
      setActiveCat(normalizeCategoryKey(value) || value);
    });
  });
}

function injectShareRow() {
  if (!isDesktop()) return;
  const info = modalZone('.k-modal-info');
  const product = currentDisplayProduct();
  if (!info || !product) return;

  info.querySelector('.k-modal-share-row')?.remove();

  const url = `${window.location.origin}/?p=${product.id}`;
  const price = product.price_kmf != null ? ` — ${fmtPrice(product.price_kmf)}` : '';
  const text = encodeURIComponent(
    `👀 Regarde ce que j'ai trouvé sur Komerce !\n${product.name || ''}${price}\n${url}`
  );

  const row = document.createElement('div');
  row.className = 'k-modal-share-row';

  const whatsapp = document.createElement('button');
  whatsapp.type = 'button';
  whatsapp.className = 'k-modal-share-btn k-modal-share-btn--wa';
  whatsapp.dataset.href = `https://wa.me/?text=${text}`;
  whatsapp.textContent = 'Partager via WhatsApp';

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'k-modal-share-btn';
  copy.dataset.action = 'copy';
  copy.textContent = 'Copier le lien';

  row.append(whatsapp, copy);
  info.appendChild(row);

  whatsapp.addEventListener('click', () => {
    window.open(whatsapp.dataset.href, '_blank');
  });
  copy.addEventListener('click', () => {
    navigator.clipboard.writeText(url).then(() => {
      showToast('🔗 Lien copié !');
    });
  });
}

function injectTrustBadges() {
  if (!isDesktop()) return;
  const info = modalZone('.k-modal-info');
  if (!info) return;

  info.querySelector('.k-modal-trust')?.remove();

  const trust = document.createElement('div');
  trust.className = 'k-modal-trust';
  [
    ['🔒', 'Paiement sécurisé'],
    ['💬', 'Support Komerce'],
  ].forEach(([icon, label]) => {
    const item = document.createElement('span');
    item.className = 'k-modal-trust-item';
    item.textContent = `${icon} ${label}`;
    trust.appendChild(item);
  });
  info.appendChild(trust);
}

function injectRecentlyViewed() {
  if (!isDesktop()) return;
  const scrollEl = modalZone('.k-modal-scroll');
  const product = currentDisplayProduct();
  if (!scrollEl || !product) return;

  scrollEl.querySelector('.k-modal-recent')?.remove();

  const recentIds = (state.viewedHistory || [])
    .filter((id) => String(id) !== String(product.id))
    .reverse();
  const recents = recentIds
    .map((id) => state.products.find((item) => String(item.id) === String(id)))
    .filter(Boolean)
    .slice(0, 8);
  if (!recents.length) return;

  const section = document.createElement('section');
  section.className = 'k-modal-recent';
  const title = document.createElement('h3');
  title.className = 'k-modal-recent-title';
  title.textContent = 'Vu récemment';
  const grid = document.createElement('div');
  grid.className = 'k-modal-recent-grid';

  recents.forEach((item) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'k-modal-recent-card';
    card.dataset.pid = item.id;

    const imageWrap = document.createElement('div');
    imageWrap.className = 'k-modal-recent-img';
    const image = document.createElement('img');
    image.src = item.image_url || '';
    image.alt = '';
    image.loading = 'lazy';
    imageWrap.appendChild(image);

    const name = document.createElement('div');
    name.className = 'k-modal-recent-name';
    name.textContent = item.name || '';
    const price = document.createElement('div');
    price.className = 'k-modal-recent-price';
    price.textContent = fmtPrice(item.price_kmf);

    card.append(imageWrap, name, price);
    card.addEventListener('click', () => {
      if (card.dataset.pid) openModal(card.dataset.pid, true);
    });
    grid.appendChild(card);
  });

  section.append(title, grid);
  scrollEl.appendChild(section);
}

/**
 * Compatibilité PR-M1 jusqu'à PDC-6 : les classes structurelles historiques
 * restent appliquées par le ViewModel legacy. Elles ne portent plus aucune
 * vérité de stock/prix/livraison dans l'enhancer desktop.
 */
function applyLegacyContractClasses(product) {
  if (!product || !dom.modal) return;
  try {
    const vm = buildModalViewModel(product);
    applyModalClasses(dom.modal, vm);
    state._currentModalViewModel = vm;
  } catch (error) {
    console.warn('[modal-view-model] build failed, falling back to legacy classes:', error);
  }
}

function onModalOpened() {
  if (!isDesktop()) return;
  requestAnimationFrame(() => {
    injectBreadcrumb();
    injectTrustBadges();
    injectShareRow();
    injectRecentlyViewed();
  });
}

export function setupModalContractClasses() {
  if (_vmListenerInstalled) return;
  _vmListenerInstalled = true;
  bus.on('modal:opened', applyLegacyContractClasses);
}

export function setupModalDesktopEnhancers() {
  if (!isDesktop() || _enhancersInstalled) return;
  _enhancersInstalled = true;
  bus.on('modal:opened', onModalOpened);
}
