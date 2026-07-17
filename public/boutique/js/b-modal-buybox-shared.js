/**
 * @komerce-arch
 * @role          product-modal-buybox-shared-logic
 * @domain        catalog
 * @layer         view-model
 * @criticality   high
 * @inputs        product_detail_v1, modal_selection_state, modal_qty, modal_payment_mode
 * @outputs       buybox_price_projection, buybox_payment_dom
 * @depends       b-utils.js, b-modal.js, b-cart.js, b-share-cart.js
 * @used-by       b-modal-mobile-product.js, b-modal-desktop-product.js, b-modal-approche-c-hybrid.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md, docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md
 * @impact-areas  product-modal, mobile, desktop, sku-selection, checkout-entry
 * @version       2026-07
 */

'use strict';

/**
 * MDP-1 / MDP-2 — Logique Buy Box partagée entre les deux compositions.
 *
 * Ce module ne rend rien de lui-même dans une zone fixe : il expose des
 * fonctions pures (prix, sous-total) et un rendu de sélecteur de paiement
 * paramétré par l'élément cible, pour que mobile et desktop appellent
 * exactement le même calcul et la même logique de bascule de mode, chacun
 * avec son propre placement DOM.
 *
 * UNE VÉRITÉ (prix SKU du Product Detail Contract, modes de paiement,
 * handler "panier partagé") + PLUSIEURS PROJECTIONS UI (mobile / desktop).
 * Aucun état de sélection ou de prix n'est dupliqué ici : tout est dérivé de
 * `detail`/`selection` reçus en paramètre, jamais lu depuis un state legacy.
 */

import { fmtPrice } from './b-utils.js';
import { closeModal } from './b-modal.js';
import { addToCart } from './b-cart.js';
import { startShareFlow } from './b-share-cart.js';

/**
 * Prix courant : celui de l'unité SKU sélectionnée si elle existe, sinon le
 * prix produit du contrat. Jamais de fallback vers un champ produit legacy
 * (ex. state.modalProduct.price_kmf).
 */
export function getCurrentPrice(detail, selection) {
  const unit = (detail?.sellable_units || [])
    .find((candidate) => candidate.sku_id === selection?.selected_sku_id) || null;
  return unit?.price_kmf ?? detail?.pricing?.price_kmf ?? null;
}

export const SELECTION_AVAILABILITY = Object.freeze({
  HIDDEN: 'HIDDEN',
  PENDING: 'PENDING',
  AVAILABLE: 'AVAILABLE',
  UNAVAILABLE: 'UNAVAILABLE',
});

/**
 * Projection unique de disponibilité pour les deux compositions de la modal.
 * Ne relit jamais un stock legacy : la résolution d'un SKU vendable appartient
 * exclusivement à modal-selection-model.js.
 */
export function getSelectionAvailability(detail, selection) {
  const isSku = detail?.inventory_model === 'SKU';

  if (!isSku || !selection?.selection_supported) {
    return {
      state: SELECTION_AVAILABILITY.HIDDEN,
      label: '',
      className: 'k-modal-stock',
      canPurchase: !isSku,
    };
  }

  if (selection.selected_sku_id) {
    return {
      state: SELECTION_AVAILABILITY.AVAILABLE,
      label: '✓ Disponible',
      className: 'k-modal-stock k-modal-stock--ok',
      canPurchase: true,
    };
  }

  if (selection.selection_message) {
    return {
      state: SELECTION_AVAILABILITY.UNAVAILABLE,
      label: /rupture de stock/i.test(selection.selection_message)
        ? 'Rupture de stock'
        : 'Indisponible',
      className: 'k-modal-stock',
      canPurchase: false,
    };
  }

  const hasSelections = Object.keys(selection.selected_options || {}).length > 0;
  return {
    state: SELECTION_AVAILABILITY.PENDING,
    label: hasSelections ? 'Choisissez la suite' : 'Choisissez vos options',
    className: 'k-modal-stock',
    canPurchase: false,
  };
}

/** Écrit la projection partagée dans le shell DOM existant. */
export function renderSelectionStockInto(el, detail, selection) {
  if (!el) return getSelectionAvailability(detail, selection);

  const availability = getSelectionAvailability(detail, selection);
  el.hidden = availability.state === SELECTION_AVAILABILITY.HIDDEN;
  el.textContent = availability.label;
  el.className = availability.className;
  el.dataset.availabilityState = availability.state;
  return availability;
}

/**
 * Sous-total = prix courant × quantité (bornée à 1 minimum). Retourne null
 * si aucun prix n'est disponible (contrat incomplet) : c'est à l'appelant de
 * décider comment refléter cette absence (ex. vider le texte).
 */
export function computeSubtotal(detail, selection, qty) {
  const price = getCurrentPrice(detail, selection);
  if (price == null) return null;
  const safeQty = Math.max(1, Number(qty) || 1);
  return price * safeQty;
}

/**
 * Rend le sous-total texte dans `el` (élément déjà positionné par la
 * composition appelante). Ne crée ni ne déplace `el` : c'est le rôle du
 * renderer viewport.
 */
export function renderSubtotalInto(el, detail, selection, qty) {
  if (!el) return;
  const total = computeSubtotal(detail, selection, qty);
  if (total == null) {
    el.textContent = '';
    return;
  }
  el.textContent = 'Sous-total : ';
  const strong = document.createElement('strong');
  strong.textContent = fmtPrice(total);
  el.appendChild(strong);
}

export const PAYMENT_MODES = Object.freeze({
  stripe: { icon: '💳', tab: 'Carte', title: 'Carte bancaire', sub: 'Visa, Mastercard — Stripe sécurisé', badge: 'Stripe' },
  cash:   { icon: '💵', tab: 'Livraison', title: 'Paiement à la livraison', sub: 'En espèces à la réception', badge: 'Cash' },
  group:  { icon: '👥', tab: 'Partagé', title: 'Panier partagé', sub: 'Invitez des proches à contribuer', badge: 'Partage' },
  pot:    { icon: '🎁', tab: 'Cagnotte', title: 'Cagnotte collective', sub: 'Offrir ensemble, payer ensemble', badge: 'Collectif' },
});

function buildPaymentDetail(key) {
  const mode = PAYMENT_MODES[key] || PAYMENT_MODES.stripe;
  const detail = document.createElement('div');
  detail.className = 'k-buybox-payment-detail';
  detail.dataset.payDetail = key;

  const check = document.createElement('span');
  check.className = 'k-buybox-payment-check';
  check.setAttribute('aria-hidden', 'true');

  const icon = document.createElement('span');
  icon.className = 'k-buybox-payment-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = mode.icon;

  const copy = document.createElement('span');
  copy.className = 'k-buybox-payment-copy';
  const title = document.createElement('strong');
  title.textContent = mode.title;
  const sub = document.createElement('small');
  sub.textContent = mode.sub;
  copy.append(title, sub);

  const badge = document.createElement('span');
  badge.className = 'k-buybox-payment-badge';
  badge.textContent = mode.badge;

  detail.append(check, icon, copy, badge);
  return detail;
}

/**
 * Démarre le parcours "panier partagé" : ajoute le produit courant au
 * panier, ferme la modal, puis ouvre le flux de partage. Logique unique,
 * appelable depuis n'importe quelle composition (mobile ou desktop) sans la
 * réécrire.
 */
export function startGroupCartFlow(product, qty, sourceEl) {
  if (!product) return;
  addToCart(product, qty || 1, sourceEl);
  closeModal();
  setTimeout(() => startShareFlow(), 250);
}

/**
 * Rend le sélecteur de mode de paiement (tabs + détail du mode actif) dans
 * `el`. `el` est fourni par la composition appelante (mobile ou desktop) ;
 * ce module ne décide jamais de son emplacement dans le DOM ni de son style
 * — seulement de sa structure et de son comportement.
 *
 * @param {HTMLElement} el
 * @param {Object}   opts
 * @param {string}   [opts.activeMode]   mode actif ('stripe' par défaut)
 * @param {Function} [opts.onModeChange] (key) => void, appelé quand l'utilisateur change de mode (hors "group")
 * @param {Function} [opts.onGroupSelect] (tabEl) => void, appelé quand "Panier partagé" est choisi ; si absent, startGroupCartFlow n'est PAS déclenché automatiquement
 */
export function renderPaymentModes(el, { activeMode, onModeChange, onGroupSelect } = {}) {
  if (!el) return;
  const active = (activeMode && PAYMENT_MODES[activeMode]) ? activeMode : 'stripe';

  while (el.firstChild) el.removeChild(el.firstChild);

  const title = document.createElement('div');
  title.className = 'k-modal-section-title';
  title.textContent = 'Mode de paiement';

  const tabs = document.createElement('div');
  tabs.className = 'k-buybox-payment-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Mode de paiement');

  const wrap = document.createElement('div');
  wrap.className = 'k-buybox-payment-detail-wrap';

  Object.keys(PAYMENT_MODES).forEach((key) => {
    const mode = PAYMENT_MODES[key];
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'k-buybox-payment-tab' + (key === active ? ' is-active' : '');
    tab.dataset.pay = key;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', key === active ? 'true' : 'false');

    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = mode.icon;
    const label = document.createElement('span');
    label.textContent = mode.tab;
    tab.append(icon, label);

    tab.addEventListener('click', () => {
      if (key === 'group') {
        onGroupSelect && onGroupSelect(tab);
        return;
      }

      tabs.querySelectorAll('.k-buybox-payment-tab').forEach((button) => {
        const isActive = button === tab;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
      wrap.appendChild(buildPaymentDetail(key));
      onModeChange && onModeChange(key);
    });

    tabs.appendChild(tab);
  });

  wrap.appendChild(buildPaymentDetail(active));
  el.append(title, tabs, wrap);
}

export const _buyboxSharedTestApi = Object.freeze({
  buildPaymentDetail,
  getSelectionAvailability,
  renderSelectionStockInto,
});
