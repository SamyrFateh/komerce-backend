/**
 * @komerce-arch
 * @role          boutique-cart-stepper-event-guard
 * @domain        boutique
 * @layer         ui-component
 * @criticality   high
 * @inputs        stepper_clicks, cart_state
 * @outputs       unblocked_stepper_controls
 * @depends       b-store.js
 * @used-by       boutique.js
 * @doctrine      panier_ouvert_ferme, interaction_sans_double_action
 * @impact-areas  cart, product-grid, mobile-interactions
 * @version       2026-07
 */
'use strict';

/**
 * Correctif ciblé du conflit entre :
 *   - le listener document en capture de b-cart.js, qui neutralise le clic
 *     normal d'un bouton `.k-card-add.stepper-open` après un long press ;
 *   - les boutons +/- placés à l'intérieur de ce même bouton.
 *
 * Le listener `window` s'exécute avant la capture `document`. Il retire donc
 * temporairement le marqueur `stepper-open` uniquement pour les contrôles +/-.
 * Les handlers historiques du stepper restent seuls responsables de la
 * quantité, du timer et de la fermeture : aucune logique métier n'est dupliquée.
 */

import { state } from './b-store.js';

const INSTALL_FLAG = '__komerceCartStepperGuardInstalled';

function findCartItem(productId) {
  return state.cart?.find(item =>
    String(item.product?.id ?? item.id) === String(productId)
  ) || null;
}

export function guardStepperControlClick(event) {
  const control = event.target?.closest?.('.k-stepper-plus, .k-stepper-minus');
  if (!control) return;

  const host = control.closest('.k-card-add.stepper-open');
  if (!host) return;

  const item = findCartItem(host.dataset.add);
  const removesLastItem = control.classList.contains('k-stepper-minus')
    && (!item || Number(item.qty) <= 1);

  host.classList.remove('stepper-open');

  queueMicrotask(() => {
    if (removesLastItem) return;
    if (!findCartItem(host.dataset.add)) return;
    if (!host.querySelector('.k-card-add-stepper')) return;
    host.classList.add('stepper-open');
  });
}

export function installCartStepperGuard() {
  if (window[INSTALL_FLAG]) return;
  window[INSTALL_FLAG] = true;
  window.addEventListener('click', guardStepperControlClick, true);
}

installCartStepperGuard();
