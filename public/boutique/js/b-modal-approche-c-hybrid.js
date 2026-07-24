/**
 * @komerce-arch
 * @role          hybrid-product-modal-flow
 * @domain        boutique
 * @layer         ui-experiment
 * @criticality   medium
 * @inputs        modal_context, cart_actions
 * @outputs       hybrid_modal_actions, share_entry, payment_composition
 * @depends       b-cart.js, b-share-cart.js, b-modal-core.js
 * @used-by       main.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md, docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md
 * @impact-areas  product-modal, cart, shared-cart-creation, checkout-entry
 * @version       2026-07
 */

'use strict';

/**
 * PDC-5 — Approche C limitée à la COMPOSITION desktop.
 *
 * La livraison et le sous-total produit ne sont plus calculés ici :
 * `b-modal-desktop-product.js` les rend depuis Product Detail + sélection SKU.
 *
 * MDP-2 : le rendu du sélecteur de mode de paiement (logique + DOM) a été
 * déplacé dans les renderers PDC eux-mêmes (`b-modal-mobile-product.js`,
 * `b-modal-desktop-product.js`), qui l'appellent tous deux via
 * `b-modal-buybox-shared.js::renderPaymentModes`. Ce module ne possède donc
 * plus aucune logique de paiement : il ne reste responsable que du
 * placement desktop des actions (déplacement après la livraison) et de la
 * quantité minimale d'intention.
 *
 * MDP-3 : ce placement est réconcilié à chaque transition de viewport via
 * `modal:composition-synced` (émis par b-modal-product-detail-bootstrap.js
 * après un resize), en plus de `modal:opened`. Toutes les opérations DOM
 * ci-dessous sont idempotentes (vérifient l'état avant d'agir) pour
 * supporter des resizes successifs sans doublon ni déplacement cumulatif.
 */

import { bus } from './b-bus.js';
import { state, modalZone } from './b-store.js';
import { isDesktop } from './b-scroll-owner.js';

let _installed = false;
let _qtyGuardInstalled = false;
let _actionsHome = null;

function ensureIntentQty() {
  if (!state.modalProduct) return;
  if (!Number.isFinite(Number(state.modalQty)) || Number(state.modalQty) < 1) {
    state.modalQty = 1;
  }

  const qtyVal = document.getElementById('k-qty-val');
  if (qtyVal && Number(qtyVal.textContent || 0) < 1) qtyVal.textContent = '1';
}

function installQtyGuard() {
  if (_qtyGuardInstalled || typeof document === 'undefined') return;
  _qtyGuardInstalled = true;

  document.addEventListener('click', function(e) {
    const minus = e.target && e.target.closest ? e.target.closest('#k-qty-minus') : null;
    if (!minus || !isDesktop() || !state.modalProduct) return;

    const current = Number(state.modalQty || 0);
    if (current <= 1) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      state.modalQty = 1;
      const qtyVal = document.getElementById('k-qty-val');
      if (qtyVal) qtyVal.textContent = '1';
      ensureIntentQty();
    }
  }, true);
}

function moveActionsAfterDelivery() {
  const info = modalZone('.k-modal-info');
  const delivery = document.getElementById('k-modal-delivery');
  const actions = modalZone('.k-modal-actions');
  if (!info || !delivery || !actions) return;

  if (!_actionsHome && actions.parentElement) {
    _actionsHome = { parent: actions.parentElement, next: actions.nextSibling };
  }

  actions.classList.add('k-buybox-actions-inline');
  if (actions.parentElement !== info || delivery.nextElementSibling !== actions) {
    info.insertBefore(actions, delivery.nextSibling);
  }
}

function restoreActionsHome() {
  const actions = modalZone('.k-modal-actions');
  if (!actions || !_actionsHome || !_actionsHome.parent) return;
  actions.classList.remove('k-buybox-actions-inline');
  _actionsHome.parent.insertBefore(actions, _actionsHome.next || null);
  _actionsHome = null;
}

// REFONTE COQUE DESKTOP (PROMPT_REFONTE_MODALE_DESKTOP_KOMERCE) : sur desktop,
// les CTA restent dans .k-modal-info à leur position HTML native (après
// #k-modal-delivery ET #k-modal-payment) — aucun déplacement JS.
// moveActionsAfterDelivery() / restoreActionsHome() sont conservées ci-dessus
// (dead code volontaire, pas supprimées) pour traçabilité de la décision,
// mais ne sont plus appelées depuis applyHybridPdp()/reconcileComposition().
function applyHybridPdp() {
  if (!isDesktop()) return;
  installQtyGuard();
  ensureIntentQty();
}

// MDP-3 : réconciliation appelée à chaque transition de viewport (resize),
// en plus de l'ouverture de modal.
function reconcileComposition() {
  if (isDesktop()) {
    applyHybridPdp();
  }
}

export function setupApprocheCHybridPdp() {
  if (_installed) return;
  _installed = true;
  installQtyGuard();

  bus.on('modal:opened', function() {
    if (!isDesktop()) return;
    requestAnimationFrame(function() {
      requestAnimationFrame(applyHybridPdp);
    });
  });

  bus.on('modal:composition-synced', reconcileComposition);
  bus.on('modal:closed', restoreActionsHome);
}
