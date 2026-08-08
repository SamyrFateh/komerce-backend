/**
 * @komerce-arch
 * @role          shared-cart-library-removal-ui
 * @domain        shared-cart
 * @layer         ui-component
 * @criticality   high
 * @inputs        library_context, saved_list_remove_click
 * @outputs       saved_access_delete, library_dom_refresh, toast
 * @depends       ../b-store.js, ../b-utils.js, ../b-bus.js, group-api.js, ../b-tracking.js(dynamic)
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

/**
 * Lot C (refactor soustractif shared-cart) — la bibliothèque « Mes listes »
 * n'est plus projetée par group-side-cart.js::activateOwnerLibrary() (state.
 * cartSurface === 'library', retirée) : elle est désormais alimentée et
 * rendue par l'onglet « Listes » de js/b-tracking.js
 * (state.libraryContext reste la source lue ici, inchangé). Ce module ne
 * fait que décorer les lignes déjà rendues avec un bouton « Retirer » — il
 * ne construit toujours aucun HTML de bibliothèque lui-même.
 */
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
    // Garde-fou teardown (V2-F) : ce microtask peut se déclencher APRÈS que
    // l'environnement de test (jsdom) a détruit la fenêtre — le document
    // devient alors null et tout accès DOM crashe ("Cannot read properties
    // of null (reading '_location')"). En production document est toujours
    // présent ici, donc ce garde est un no-op strict côté prod.
    if (typeof document === 'undefined' || !document || !document.defaultView) return;
    decorateLibraryRows();
    syncActiveListSaveButton();
  });
}

function syncActiveListSaveButton() {
  const saved = state.libraryContext?.saved;
  const token = state.sharedListContext?.token;
  // P2 (LOT 13, même cause que P1 ci-dessus, réapparue avec la refonte du
  // footer) — b-cart.js::snapCreateEl() a remplacé le pattern par id
  // réutilisable (getOrCreateSnapshotButton, 'k-sc-snap-save' /
  // 'k-cart-snap-save') par des boutons jetables marqués uniquement
  // data-snapshot-button="1" (reconstruits à chaque rendu, aucun id
  // stable). Ce lookup par id retournait donc de nouveau toujours null.
  // On cible désormais le bouton par son marqueur + son texte (aligné sur
  // b-cart.js::applySnapshotDrawerFooter/applySnapshotSideCartChrome —
  // 'Sauvegarder' / '✓ Sauvegardée', jamais '☆ Sauvegarder').
  const button = Array.from(
    document.querySelectorAll('[data-snapshot-button="1"]')
  ).find((el) => /^(Sauvegarder|✓ Sauvegardée)$/.test((el.textContent || '').trim()));

  if (!button || !token) return;

  // V2-F fix : une liste est "sauvegardée" si elle est soit dans la
  // bibliothèque rechargée (libraryContext.saved), soit sauvegardée pendant
  // la session courante (savedListTokensThisSession, alimenté par
  // handleSaveList AVANT tout rechargement de la bibliothèque). Sans ce
  // second critère, cette synchro asynchrone défaisait l'état "✓ Liste
  // sauvegardée" juste après un clic réussi (le bouton clignotait :
  // sauvegardée → à sauvegarder), car libraryContext.saved n'est pas encore
  // rafraîchi à ce moment-là.
  const savedInSession = state.savedListTokensThisSession?.has(token);
  const savedInLibrary = Array.isArray(saved) && saved.some(
    (cart) => String(cart.token) === String(token)
  );
  const stillSaved = savedInSession || savedInLibrary;

  if (!stillSaved) {
    if (button.disabled) button.disabled = false;
    // Aligné sur le texte réellement posé par b-cart.js (§D/§E, LOT 13) —
    // ne jamais réintroduire un libellé divergent qui ne correspondrait
    // plus à ce que le rendu complet afficherait au prochain cycle.
    if (button.textContent !== 'Sauvegarder') {
      button.textContent = 'Sauvegarder';
    }
  }
}

async function rerenderLibrary() {
  const panel = document.getElementById('k-track-lists-panel-wrap');
  if (!panel || panel.classList.contains('u-hidden')) return;
  const { renderListsTab } = await import('../b-tracking.js');
  await renderListsTab(panel);
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
  const roots = document.querySelectorAll('#k-track-lists-panel-wrap');

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

  // V2-F fix : pas de scheduleDecoration() immédiat ici. À l'install (au
  // chargement de page), aucune bibliothèque n'est affichée, donc
  // decorateLibraryRows() serait un no-op — mais le queueMicrotask qu'il
  // planifie survit au teardown de la fenêtre jsdom entre deux suites de
  // tests et crashe ("Cannot read properties of null (reading '_location')").
  // La décoration se déclenche de toute façon via l'événement bus
  // 'side-cart:render' dès qu'une bibliothèque est réellement rendue, et via
  // le MutationObserver ci-dessus. Comportement production strictement
  // identique.
  //
  // Lot D (correction — audit de clôture) : l'écoute jumelle sur le
  // signal panier "corps rendu depuis bascule de surface" a été retirée.
  // Ce canal n'avait plus d'émetteur depuis que Lot A a retiré son unique
  // point d'émission de group-side-cart.js::setCartSurface() (couvert
  // désormais par le seul signal "side-cart:render") — boutique:360 le
  // signalait comme écouteur orphelin. Voir b-bus.js pour le retrait
  // symétrique côté b-cart.js.
}

export function installSharedLibraryRemove() {
  if (installed) return;
  installed = true;

  bus.on('side-cart:render', scheduleDecoration);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver, {
      once: true,
    });
  } else {
    startObserver();
  }
}
