/**
 * @komerce-arch
 * @role          product-modal-buybox-shared-logic
 * @domain        catalog
 * @layer         view-model
 * @criticality   high
 * @inputs        product_detail_v1, modal_selection_state, modal_qty, modal_payment_mode
 * @outputs       buybox_price_projection, buybox_payment_dom
 * @depends       b-utils.js, b-modal.js, b-cart.js, b-share-cart.js, view-models/modal-cart-product-model.js
 * @used-by       b-modal-mobile-product.js, b-modal-desktop-product.js
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
import { addToCart, openCart } from './b-cart.js';
import { state, getRequestedTransportRail } from './b-store.js';
import { buildModalCartProduct } from './view-models/modal-cart-product-model.js';

function currentCartProduct(product = state.modalProduct) {
  return buildModalCartProduct(
    product,
    state.modalProductDetail,
    state.modalSelection
  );
}

/**
 * MDP-PROP1 — câblage du bouton "⚡ Acheter maintenant". Owner unique de
 * #k-buy-now-btn (déplacé depuis b-modal-core.js, qui ne gère plus que le
 * cycle de vie de la modale — ouverture/fermeture/historique/scroll/carrousel).
 *
 * Idempotent par construction (`.onclick =`, pas `addEventListener`) : cette
 * fonction est appelée depuis `renderActions()` à chaque rendu (y compris les
 * re-rendus déclenchés par un changement de sélection variante) — un
 * `addEventListener` empilerait les handlers et déclencherait plusieurs ajouts
 * au panier pour un seul clic.
 */
export function wireBuyNowButton(buyNowBtn) {
  if (!buyNowBtn) return;
  buyNowBtn.onclick = () => {
    if (!state.modalProduct) return;

    // 1. Feedback visuel immédiat : bouton se transforme en "✓ Ajouté !"
    const originalContent = buyNowBtn.innerHTML;
    buyNowBtn.innerHTML = '<span style="display:flex;align-items:center;gap:8px;justify-content:center"><span>✓</span><span>Ajouté au panier !</span></span>';
    buyNowBtn.disabled = true;
    buyNowBtn.classList.add('buy-confirmed');

    // 2. Ajout au panier avec snapshot du SKU sélectionné. Même helper
    //    partagé que "Ajouter au panier" et "Panier partagé" — le rail
    //    demandé ne doit jamais différer selon le CTA cliqué.
    addToCart(currentCartProduct(), state.modalQty, buyNowBtn, {
      requested_transport_rail: getRequestedTransportRail(),
    });

    // 3. Transition ÉTENDUE : 1200ms pour voir le feedback + coucou dame
    //    puis fermeture douce et ouverture panier avec 400ms entre les 2
    setTimeout(() => {
      buyNowBtn.innerHTML = originalContent;
      buyNowBtn.disabled = false;
      buyNowBtn.classList.remove('buy-confirmed');
      closeModal();
      setTimeout(openCart, 400);
    }, 1200);
  };
}

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

/**
 * P1-B (audit — anciens modes « group / pot » encore accessibles) —
 * doctrine finale (2026-08) : la liste partagée n'est PAS un mode de
 * paiement, elle n'a plus sa place dans ce sélecteur. Modes retirés :
 * `group` (« Panier partagé — Invitez des proches à contribuer ») et
 * `pot` (« Cagnotte collective — Offrir ensemble, payer ensemble »).
 * Le CTA contextualisé correct pour ajouter à une liste active est
 * « Ajouter à cette liste » (wireAddToListButton ci-dessus), pas un
 * mode de paiement.
 */
export const PAYMENT_MODES = Object.freeze({
  stripe: { icon: '💳', tab: 'Carte', title: 'Carte bancaire', sub: 'Visa, Mastercard — Stripe sécurisé', badge: 'Stripe' },
  cash:   { icon: '💵', tab: 'Livraison', title: 'Paiement à la livraison', sub: 'En espèces à la réception', badge: 'Cash' },
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
 * Rend le sélecteur de mode de paiement (tabs + détail du mode actif) dans
 * `el`. `el` est fourni par la composition appelante (mobile ou desktop) ;
 * ce module ne décide jamais de son emplacement dans le DOM ni de son style
 * — seulement de sa structure et de son comportement.
 *
 * P1-B — plus de mode « group » : chaque tab bascule désormais simplement
 * le détail affiché, jamais de branchement spécial.
 *
 * @param {HTMLElement} el
 * @param {Object}   opts
 * @param {string}   [opts.activeMode]   mode actif ('stripe' par défaut)
 * @param {Function} [opts.onModeChange] (key) => void, appelé quand l'utilisateur change de mode
 */
export function renderPaymentModes(el, { activeMode, onModeChange } = {}) {
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
  currentCartProduct,
});
