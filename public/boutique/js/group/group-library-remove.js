/**
 * @komerce-arch
 * @role          shared-cart-library-removal-ui
 * @domain        shared-cart
 * @layer         ui-component
 * @criticality   high
 * @inputs        library_context, saved_list_remove_click
 * @outputs       saved_access_delete, library_dom_refresh, toast
 * @depends       ../b-store.js, ../b-utils.js, ../b-bus.js, group-api.js, group-side-cart.js(dynamic)
 * @used-by       group-state.js
 * @doctrine      retirer_le_signet_jamais_la_liste, contexte_actif_preserve
 * @impact-areas  shared-cart, mon-komerce, participant-flow
 * @version       2026-08
 */

'use strict';

import { state } from '../b-store.js';
import { showToast } from '../b-utils.js';
import { bus } from '../b-bus.js';
import { removeSavedSharedCart } from './group-api.js';

let installed = false;
let scheduled = false;
let observer = null;

function savedLists() {
  return Array.isArray(state.libraryContext?.saved)
    ? state.libraryContext.saved
    : [];
}

function findSavedByToken(token) {
  return savedLists().find(
    (cart) => String(cart.token) === String(token)
  ) || null;
}

function scheduleDecoration() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    decorateLibraryRows();
    syncActiveListSaveButton();
  });
}

function syncActiveListSaveButton() {
  const saved = state.libraryContext?.saved;
  const token = state.sharedListContext?.token;
  const button = document.getElementById('k-shared-list-save');

  if (!button || !token || !Array.isArray(saved)) return;

  const stillSaved = saved.some(
    (cart) => String(cart.token) === String(token)
  );

  if (!stillSaved) {
    button.disabled = false;
    button.textContent = '☆ Sauvegarder cette liste';
  }
}

async function rerenderLibrary() {
  if (state.cartSurface !== 'library') return;
  const { renderLibraryInCart } = await import('./group-side-cart.js');
  renderLibraryInCart();
  scheduleDecoration();
}

async function handleRemove(button, cart) {
  const title = cart.title || 'cette liste';
  const confirmed = window.confirm(
    `Retirer « ${title} » de Mes listes ? ` +
    'La liste et son lien resteront accessibles.'
  );
  if (!confirmed) return;

  button.disabled = true;
  button.dataset.busy = '1';
  button.textContent = 'Retrait…';

  try {
    await removeSavedSharedCart(cart.id);

    state.libraryContext = {
      ...(state.libraryContext || {}),
      saved: savedLists().filter(
        (saved) => String(saved.id) !== String(cart.id)
      ),
    };

    showToast('Liste retirée de Mes listes.', 'success');
    await rerenderLibrary();
    syncActiveListSaveButton();
  } catch (err) {
    button.disabled = false;
    button.dataset.busy = '0';
    button.textContent = 'Retirer';
    showToast(
      `Impossible de retirer cette liste : ${err.message}`,
      'error'
    );
  }
}

function decorateLibraryRows() {
  const roots = document.querySelectorAll(
    '#k-side-cart[data-mode="library"], ' +
    '#k-cart-drawer[data-mode="library"]'
  );

  roots.forEach((root) => {
    root.querySelectorAll('.k-library-item[data-token]').forEach((itemButton) => {
      const cart = findSavedByToken(itemButton.dataset.token);
      if (!cart) return;

      const existingRow = itemButton.closest('.k-library-item-row');
      if (existingRow) {
        existingRow.dataset.sharedCartId = String(cart.id);
        return;
      }

      const row = document.createElement('div');
      row.className = 'k-library-item-row';
      row.dataset.sharedCartId = String(cart.id);

      itemButton.parentNode.insertBefore(row, itemButton);
      row.appendChild(itemButton);

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'k-library-item-remove';
      removeButton.dataset.sharedCartId = String(cart.id);
      removeButton.textContent = 'Retirer';
      removeButton.setAttribute(
        'aria-label',
        `Retirer ${cart.title || 'cette liste'} de Mes listes`
      );

      removeButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        handleRemove(removeButton, cart);
      });

      row.appendChild(removeButton);
    });
  });
}

function startObserver() {
  if (observer || !document.body) return;

  observer = new MutationObserver(scheduleDecoration);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  scheduleDecoration();
}

export function installSharedLibraryRemove() {
  if (installed) return;
  installed = true;

  bus.on('side-cart:render', scheduleDecoration);
  bus.on('cart-body:render', scheduleDecoration);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver, {
      once: true,
    });
  } else {
    startObserver();
  }
}
