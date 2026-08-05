/**
 * @komerce-arch-lite
 * @role          shared-cart-group-state
 * @domain        shared-cart
 * @layer         ui-component
 * @owner         public/boutique/js/b-share-cart.js
 * @purpose       synchronise les badges DOM depuis state.shareToken et installe les actions de bibliothèque
 * @impact-areas  shared-cart
 * @version       2026-08
 */
'use strict';

/**
 * @module group/group-state.js
 * @owner Boutique First — synchronisation du badge global.
 *
 * V2-F nettoyage final : isVisibleOwnerCart, sortOwnerCarts, pickOwnerCart
 * ont été retirés — c'était le switcher "Mes listes" de l'ancien onglet
 * Groupe autonome (data-tab="group"), supprimé (mandat §2/§4). Zéro
 * consommateur réel retrouvé par grep exhaustif au moment du retrait ;
 * la bibliothèque "Mes listes" actuelle (amendement V2 §D) vit dans
 * group-side-cart.js::activateOwnerLibrary(), un chemin entièrement
 * différent. applyOwnerCartToState (V4.1) avait déjà été retiré avant ce
 * lot pour la même raison (champs disparus avec la migration 124).
 *
 * @owner déclaré ici référençait auparavant b-group-view.js — ce fichier
 * n'existe plus (confirmé par grep au moment du retrait ci-dessus) ;
 * refreshGroupBadge est importé directement par b-share-cart.js.
 *
 * Règle : aucun appel réseau dans refreshGroupBadge — uniquement
 * synchronisation avec state + DOM badge. Le module installe aussi l'action
 * explicite « Retirer de Mes listes » portée par group-library-remove.js.
 */

import { state } from '../b-store.js';
import {
  installSharedLibraryRemove,
} from './group-library-remove.js';

installSharedLibraryRemove();

export function refreshGroupBadge() {
  const has = !!state.shareToken;
  document.getElementById('k-bnav-group-badge')?.classList.toggle('show', has);
  document.getElementById('k-header-group-badge')?.classList.toggle('show', has);
  document.getElementById('k-header-komerce-btn')?.classList.toggle('has-active', has);
}
