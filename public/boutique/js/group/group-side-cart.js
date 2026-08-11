/**
 * @komerce-arch
 * @role          shared-list-canonical-cart-projection
 * @domain        shared-cart
 * @layer         ui-component
 * @criticality   critical
 * @inputs        shared_cart_public_payload, local_selection
 * @outputs       dom_render(k-side-cart, k-cart-drawer), checkout_invocation
 * @depends       ../b-store.js, ../b-utils.js, ../b-bus.js, ../b-scroll-owner.js, group-api.js, group-checkout-adapter.js
 * @used-by       b-nav.js, b-share-cart.js, b-komerce.js, b-tracking.js
 * @doctrine      un_seul_composant, panier_personnel_jamais_fusionne, checkout_canonique, boutique_reste_boutique
 * @impact-areas  shared-cart, participant-flow, creator-flow, checkout, side-cart, drawer
 * @version       2026-08
 */
'use strict';

/**
 * @module group/group-side-cart.js
 * @brief PROMPT_FINAL_IMPLEMENTATION_LISTE_PARTAGEABLE_SIDE_CART — projette
 * une liste partageable dans le side cart desktop (#k-side-cart) et le
 * drawer mobile (#k-cart-drawer) canoniques, sans jamais fusionner avec
 * state.cart (mandat §3) ni construire un écran/onglet autonome (mandat §2).
 *
 * Remplace group-render-list.js (mandat §10) — supprimé une fois tous ses
 * appelants migrés et confirmé orphelin par grep exhaustif ; voir le
 * rapport de clôture pour l'historique de la migration.
 */

import { state, dom } from '../b-store.js';
import { showToast, sanitize } from '../b-utils.js';
import { bus } from '../b-bus.js';
import { isDesktop } from '../b-scroll-owner.js';
import {
  getSharedCartPublic,
  saveSharedCart,
  closeCart as apiCloseSharedCart,
} from './group-api.js';
import { checkoutSharedListSelection } from './group-checkout-adapter.js';
import {
  firstNameOf,
  sharedListDisplayLabel,
  sharedListCheckoutLabel,
} from './group-list-labels.js';

/* ── Modale de confirmation Komerce (mandat §11) ──────────────────────
 * Primitive UNIQUE réutilisée par les 3 confirmations métier importantes
 * (publication, conflit OPEN, fermeture) — remplace les window.confirm()
 * fonctionnels mais hors-UX. Un seul composant, pas trois (mandat §20).
 * Retourne une Promise<boolean> (true = bouton de confirmation cliqué).
 * Volontairement locale à ce module (déjà propriétaire de shared-cart.feature.js)
 * plutôt qu'un nouveau fichier — réutilisation > nouveau composant.
 */
export function showKomerceConfirm({ title, body, confirmLabel, cancelLabel = 'Annuler', danger = false }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'k-confirm-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'k-confirm-dialog';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');

    const titleEl = document.createElement('div');
    titleEl.className = 'k-confirm-dialog-title';
    titleEl.textContent = title;

    const bodyEl = document.createElement('div');
    bodyEl.className = 'k-confirm-dialog-body';
    bodyEl.textContent = body;

    const actions = document.createElement('div');
    actions.className = 'k-confirm-dialog-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'k-confirm-dialog-btn k-confirm-dialog-btn-secondary';
    cancelBtn.textContent = cancelLabel;

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = danger
      ? 'k-confirm-dialog-btn k-confirm-dialog-btn-danger'
      : 'k-confirm-dialog-btn k-confirm-dialog-btn-primary';
    confirmBtn.textContent = confirmLabel;

    function settle(result) {
      overlay.removeEventListener('click', onOverlayClick);
      document.removeEventListener('keydown', onKeydown);
      overlay.remove();
      resolve(result);
    }
    function onOverlayClick(e) {
      if (e.target === overlay) settle(false);
    }
    function onKeydown(e) {
      if (e.key === 'Escape') settle(false);
    }

    cancelBtn.addEventListener('click', () => settle(false));
    confirmBtn.addEventListener('click', () => settle(true));
    overlay.addEventListener('click', onOverlayClick);
    document.addEventListener('keydown', onKeydown);

    actions.append(cancelBtn, confirmBtn);
    dialog.append(titleEl, bodyEl, actions);
    overlay.append(dialog);
    document.body.append(overlay);
    confirmBtn.focus();
  });
}

/* ── Rendu snapshot (b-cart.js) ──────────────────────────────────────
 * Lot D+ (correctif cycle d'import) — b-cart.js importe déjà 4 exports
 * de ce module (isSharedListSurfaceActive, renderSharedListInCart,
 * exitSharedListRenderMode, setCartSurface). Un import retour direct de
 * renderCartSnapshot/cleanupCartSnapshotDom fermait un cycle A↔B détecté
 * par check-js-imports.js. Les deux appels sont fire-and-forget (aucune
 * valeur de retour consommée) : découplés via b-bus.js plutôt que gelés
 * dans KNOWN_CYCLES, dans le même esprit que modal:open (b-catalog.js ↔
 * b-modal.js) et nav:goto-track (FIX 2026-07-11 ci-dessus dans b-nav.js).
 * b-cart.js reste l'unique propriétaire du rendu (doctrine
 * un_renderer_panier) — il écoute simplement ces deux événements au lieu
 * d'être appelé en import direct.
 */

/* ── Détection du token participant ───────────────────────────────
 * Copie volontairement locale (héritée de l'ancien group-render-list.js,
 * aujourd'hui supprimé) : fonction pure, sans dépendance externe.
 */
export function detectParticipantToken() {
  try {
    const url = new URL(window.location.href);
    const qp = url.searchParams.get('p');
    if (qp) return qp;
    const m = url.pathname.match(/\/cart\/shared\/([^/?#]+)/);
    return m ? m[1] : null;
  } catch (_) {
    return null;
  }
}

/* ── Helpers internes ─────────────────────────────────────────────── */

function findItem(itemId) {
  return state.sharedListContext.items.find((it) => String(it.id) === String(itemId)) || null;
}

/**
 * Lignes disponibles (non réclamées) du snapshot — celles qui portent une
 * case à cocher de sélection (mandat cohérence post-LOT 13, §3.a) et
 * alimentent le raccourci "Tout sélectionner" (§3.b-bis).
 */
function availableItems() {
  return state.sharedListContext.items.filter((it) => !it.claimed);
}

/**
 * Valeur informative des lignes encore disponibles. Sert uniquement à la
 * ligne "Reste disponible" (jamais un solde à régler, jamais dans le
 * texte d'un bouton — mandat cohérence post-LOT 13, §3.b). N'a plus aucun
 * lien avec un CTA d'achat depuis la suppression de "Acheter le reste".
 */
function availableTotal() {
  return availableItems().reduce((sum, it) => sum + (Number(it.unit_price_kmf) || 0) * (Number(it.quantity) || 1), 0);
}

function isActiveContext() {
  return !!state.sharedListContext.token;
}

function isReadOnly() {
  return state.sharedListContext.status !== 'open';
}

/**
 * Cache de session de LA liste réellement affichée.
 *
 * Ce cache n'est jamais une source métier : le snapshot public backend reste
 * la vérité. Il sert uniquement à retrouver le token exact après un reload,
 * notamment pour un participant pour lequel GET /mine n'a aucune autorité.
 */
function persistActiveSharedListSession(cart, token) {
  const resolvedToken = cart?.token || token || null;
  if (!resolvedToken) return;

  const shareUrl = cart?.share_url
    || `${window.location.origin}/boutique/?p=${resolvedToken}`;

  state.shareToken = resolvedToken;
  state.shareId = cart?.id || null;
  state.shareExpiry = cart?.expires_at || null;
  state.cartName = cart?.title || '';
  state.shareStatus = cart?.status || null;
  state.shareUrl = shareUrl;

  try {
    sessionStorage.setItem('kmrc_share', JSON.stringify({
      token: state.shareToken,
      id: state.shareId,
      expiry: state.shareExpiry,
      name: state.cartName,
      status: state.shareStatus,
      share_url: state.shareUrl,
    }));
  } catch (_) {}
}

function clearActiveSharedListSession() {
  state.shareToken = null;
  state.shareId = null;
  state.shareExpiry = null;
  state.cartName = '';
  state.shareStatus = null;
  state.shareUrl = null;

  try {
    sessionStorage.removeItem('kmrc_share');
  } catch (_) {}
}

/* ── Sélection locale (mandat cohérence post-LOT 13, §3) ──────────────
 * État purement local et éphémère : jamais persisté, jamais une mutation
 * du snapshot backend, jamais un mode édition sur la liste elle-même
 * (doctrine d'immutabilité §1.B). Sert exclusivement à composer l'appel
 * unique à checkoutSharedListSelection (handleCommand ci-dessous). Reset
 * à chaque changement/effacement de contexte de liste, pour ne jamais
 * transporter une sélection périmée d'une liste à une autre. Ne se
 * réinitialise en revanche plus après un achat (correctif mandat §10,
 * handleCommand) : elle persiste jusqu'au prochain rafraîchissement, où
 * pruneSelectionAgainstItems() retire uniquement les lignes devenues
 * claimed.
 */
let selectedItemIds = new Set();

function resetSelection() {
  selectedItemIds = new Set();
}

/**
 * Retire de la sélection toute ligne devenue claimed entre-temps (autre
 * participant ayant acheté la même ligne pendant le polling temps réel) —
 * ne jamais laisser une ligne réclamée cochée en mémoire.
 */
function pruneSelectionAgainstItems() {
  const availableIds = new Set(availableItems().map((it) => String(it.id)));
  selectedItemIds.forEach((id) => {
    if (!availableIds.has(id)) selectedItemIds.delete(id);
  });
}

function handleToggleSelect(itemId) {
  const id = String(itemId);
  const item = findItem(id);
  if (!item || item.claimed || isReadOnly()) return;
  if (selectedItemIds.has(id)) selectedItemIds.delete(id);
  else selectedItemIds.add(id);
  renderSharedListInCart();
}

/**
 * "Tout sélectionner" / "Tout désélectionner" (§3.b-bis, revue mock) —
 * bascule : si toutes les lignes disponibles sont déjà cochées, les
 * décoche toutes ; sinon coche toutes les lignes encore disponibles.
 * Raccourci de sélection pure dans les deux sens : ne déclenche jamais
 * d'achat ni de checkout par lui-même, seul handleCommand le fait. Le
 * libellé affiché ("allAvailableSelected" dans buildSnapshotRenderContext)
 * suit ce même état — jamais désynchronisé, un seul point de vérité.
 * Remplace définitivement handleBuyAllAvailable comme chemin d'achat
 * séparé.
 */
function handleSelectAll() {
  if (isReadOnly()) return;
  const available = availableItems();
  const allSelected = available.length > 0 && available.every((it) => selectedItemIds.has(String(it.id)));
  if (allSelected) {
    available.forEach((it) => selectedItemIds.delete(String(it.id)));
  } else {
    available.forEach((it) => selectedItemIds.add(String(it.id)));
  }
  renderSharedListInCart();
}

/* ── Temps réel (lot 2026-08, fraîcheur du snapshot) ─────────────────────
 * Aucune réservation, aucun verrou frontend, aucun WebSocket : une simple
 * boucle de polling détenue exclusivement par ce contrôleur, qui rejoue le
 * même chemin que les rafraîchissements existants (refreshSharedListContext,
 * source de vérité = GET public/:token). Le claim reste arbitré uniquement
 * par la contrainte unique order_items.shared_cart_item_id (migration 123)
 * côté backend — cette boucle ne fait qu'observer, jamais arbitrer.
 */
let pollIntervalId = null;
let lastSnapshotSignature = null;

/**
 * Signature stable dérivée du snapshot — mandat §12 : doit couvrir TOUTES
 * les données visibles susceptibles de changer (statut, titre, message,
 * IDs et ordre des lignes, quantités, prix, variante, image, claimed,
 * prénom acheteur visible propriétaire, contributeurs), pas seulement le
 * sous-ensemble initial (statut/id/quantité/claimed) qui aurait laissé un
 * changement de prix, de média, de titre ou de contributeur invisible tant
 * qu'aucune ligne n'était ajoutée/retirée. Ne dépend d'aucune colonne
 * updated_at/version côté DB — aucune migration nécessaire pour ce lot.
 */
function computeSnapshotSignature(cart, items, contributors) {
  const itemsSig = (items || [])
    .map((it) => [
      it.id,
      it.quantity,
      it.claimed ? 1 : 0,
      it.unit_price_kmf,
      it.image || '',
      it.variant_combo ? JSON.stringify(it.variant_combo) : '',
      // Undefined côté participant (jamais mappé par le backend) : ''
      // stable plutôt que la chaîne littérale "undefined".
      it.buyer_first_name || '',
    ].join(':'))
    .join(',');
  const contributorsSig = (contributors || [])
    .map((c) => `${c.first_name}:${c.items_count}`)
    .join(',');
  return [
    cart.status || 'open',
    cart.title || '',
    cart.message || '',
    contributorsSig,
    itemsSig,
  ].join('|');
}

function isPollableNow() {
  return state.cartSurface === 'shared-list'
    && isActiveContext()
    && document.visibilityState === 'visible'
    && document.body.classList.contains('k-view-shop');
}

/**
 * Garantit une seule boucle vivante (mandat "une seule boucle existe").
 * Idempotent : un appel répété (ex. à chaque activation/refresh) est un
 * no-op si la boucle tourne déjà.
 */
function ensureSnapshotPollingLoop() {
  if (pollIntervalId) return;
  pollIntervalId = setInterval(() => {
    if (!isPollableNow()) return;
    refreshSharedListContext();
  }, 4000);
}

function stopSnapshotPollingLoop() {
  if (!pollIntervalId) return;
  clearInterval(pollIntervalId);
  pollIntervalId = null;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isPollableNow()) {
      refreshSharedListContext();
    }
  });
}

/* ── Activation / rafraîchissement / nettoyage du contexte ──────────── */

/**
 * Remplit state.sharedListContext depuis une réponse GET .../public/:token
 * et rend la liste dans les surfaces canoniques. N'écrit jamais dans
 * state.cart (Invariant mandat §3).
 * @param {{cart:object, items:Array, is_creator:boolean}} data
 * @param {string} token
 * @param {{silent?: boolean}} [opts] - silent=true pour un rafraîchissement
 *   en arrière-plan (poll, mutation, visibilitychange) : ne rouvre jamais un
 *   drawer mobile que l'utilisateur a fermé, et n'émet aucun rerender si le
 *   snapshot n'a pas changé (stabilité visuelle, mandat temps réel §"Ne
 *   rerendre que si cette signature change"). false (défaut) = activation
 *   explicite (clic sur une liste, orchestration de navigation) : rend
 *   toujours et rouvre le drawer mobile comme avant.
 */
export function activateSharedListContext(data, token, { silent = false } = {}) {
  if (!data || !data.cart) return;

  const cart = data.cart;
  const previousToken = state.sharedListContext.token;
  const nextToken = cart.token || token;

  const items = Array.isArray(data.items) ? data.items : [];
  const contributors = Array.isArray(data.contributors) ? data.contributors : [];
  const signature = computeSnapshotSignature(cart, items, contributors);
  const unchanged = silent && previousToken === nextToken && signature === lastSnapshotSignature;
  lastSnapshotSignature = signature;

  state.sharedListContext = {
    sharedCartId: cart.id ?? state.sharedListContext.sharedCartId,
    token: nextToken,
    // É3 fail-closed — un payload sans statut est traité comme CLOSED,
    // jamais comme OPEN (un statut absent ne peut pas accorder des droits
    // d'achat ; l'inverse aurait exposé des boutons Acheter sur une liste
    // potentiellement fermée). Le chemin normal passe toujours la garde de
    // activateFromParticipantUrl avant d'arriver ici.
    status: cart.status || 'closed',
    isCreator: !!data.is_creator,
    creatorFirstName: cart.creator_first_name || null,
    // GAP-05 (Lot 2) — [{first_name, items_count}], jamais présent côté
    // participant (gating server-side exclusif, shared-cart-reads.js).
    contributors,
    title: cart.title || null,
    message: cart.message || null,
    items,
  };
  // Mandat cohérence post-LOT 13, §3 — la sélection locale ne doit
  // jamais survivre à un changement de liste (nouveau token). Sur un
  // simple refresh de fraîcheur (même token), on la purge seulement
  // contre les lignes devenues claimed entre-temps (autre participant).
  if (previousToken !== nextToken) resetSelection();
  else pruneSelectionAgainstItems();
  // É2 — synchronise state.shareToken depuis sharedListContext, qui est
  // désormais la seule source de vérité décisionnelle. b-group-banner.js
  // et group-state.js lisent state.shareToken directement (pas via
  // activeShareTarget) — on le maintient synchronisé ici pour ne pas avoir
  // à les modifier. b-share-cart.js::activeShareTarget() ne consulte plus
  // que sharedListContext (voir ci-dessous).
  persistActiveSharedListSession(cart, nextToken);
  state.cartSurface = 'shared-list';

  ensureSnapshotPollingLoop();

  if (unchanged) return;

  renderSharedListInCart();

  if (isDesktop() || silent) {
    // Desktop : le side cart persistant suffit, pas de drawer à ouvrir.
    // Silent (mobile) : mettre à jour le contenu déjà rendu ci-dessus sans
    // jamais rouvrir un drawer que l'utilisateur vient de fermer.
    return;
  }
  // Mobile, activation explicite : ouvrir automatiquement le drawer après
  // le rendu (mandat §4/§7).
  reopenSharedListCart();
}

/**
 * Recharge la liste depuis le backend (source de vérité) — utilisé après
 * ajout/retrait/fermeture, après un conflit d'achat (mandat §8/§9), et par
 * la boucle de polling / le retour de visibilité (temps réel, lot 2026-08).
 * Toujours silencieux : un simple refresh de fraîcheur n'est jamais une
 * activation explicite.
 */
export async function refreshSharedListContext() {
  if (!isActiveContext()) return null;
  const data = await getSharedCartPublic(state.sharedListContext.token);
  if (!data) {
    // Lien devenu invalide entre-temps : on efface le contexte plutôt que
    // de laisser un état incohérent affiché.
    clearSharedListContext();
    return null;
  }
  activateSharedListContext(data, state.sharedListContext.token, { silent: true });
  return data;
}

/**
 * Amendement V2 §A — vraie condition de rendu dans renderCartBody() :
 * un contexte actif ne suffit pas (il peut rester en arrière-plan pendant
 * que le panier personnel est affiché). Remplace l'ancienne
 * isSharedListActive() (retirée V2-F, zéro consommateur réel après ce
 * remplacement — confirmé par grep exhaustif) comme garde de rendu dans
 * b-cart.js::renderCartBody().
 * @returns {boolean}
 */
export function isSharedListSurfaceActive() {
  return state.cartSurface === 'shared-list' && isActiveContext();
}

/**
 * L1 / P0-1 (mandat §3) — distincte de isSharedListSurfaceActive() : celle-ci
 * dit si une liste OPEN occupe le slot partagé, INDÉPENDAMMENT de la surface
 * actuellement affichée. Sert à calculer l'invariant de visibilité du shell
 * (sideCartVisible = personalHasItems OR displayedSharedListIsOpen) dans
 * b-cart.js::renderSideCart() — le shell ne doit jamais disparaître juste
 * parce que la surface active est 'personal' et le panier personnel vide.
 */
export function hasOpenSharedListInSlot() {
  return isActiveContext() && state.sharedListContext?.status === 'open';
}

/**
 * Appelée par b-cart.js::renderCartBody() sur la branche panier personnel,
 * à chaque rendu, pour garantir qu'aucune trace DOM du mode liste ne
 * subsiste si le contexte vient de se terminer (fermeture, lien invalidé,
 * clearSharedListContext appelé ailleurs). No-op tant que le contexte reste
 * actif : le rendu de la liste reste alors géré exclusivement par
 * renderSharedListInCart().
 */
export function exitSharedListRenderMode() {
  if (isActiveContext()) return;
  bus.emit('cart-snapshot:cleanup');
}

/* ── Sortie d'affichage (le × de l'onglet, mandat §2) ─────────────────
 * Distinct de handleCloseClick/apiCloseSharedCart (organisateur, mutation
 * backend réelle, statut OPEN→CLOSED) : le × ne signifie QUE "quitter
 * l'affichage de cette liste", jamais clôturer/supprimer/annuler. Aucun
 * appel réseau, aucun changement de statut OPEN/CLOSED, aucun article
 * personnel touché — clearSharedListContext() ci-dessous est déjà
 * purement local, donc directement réutilisable comme mécanique de
 * démontage. La seule différence avec un simple clearSharedListContext()
 * est le marquage ci-dessous : sans lui, une liste OPEN dont l'utilisateur
 * est l'organisateur réapparaîtrait à la prochaine visite via
 * restoreSharedCartFromBackend()/GET mine (mandat : "après reload, une
 * liste explicitement quittée ne doit pas ressusciter automatiquement").
 * sessionStorage (pas localStorage) : le dismiss ne doit valoir que pour
 * la session de navigation en cours, jamais devenir permanent — rouvrir
 * la liste (Mes listes, ou un nouveau lien) doit toujours fonctionner.
 */
const DISMISSED_SHARED_LISTS_KEY = 'kmrc_dismissed_shared_lists';

function rememberDismissedSharedListToken(token) {
  if (!token) return;
  try {
    const raw = sessionStorage.getItem(DISMISSED_SHARED_LISTS_KEY);
    const tokens = new Set(raw ? JSON.parse(raw) : []);
    tokens.add(token);
    sessionStorage.setItem(DISMISSED_SHARED_LISTS_KEY, JSON.stringify([...tokens]));
  } catch (_) {}
}

/**
 * Consultée par b-share-cart.js::restoreSharedCartFromBackend() avant de
 * réactiver automatiquement une liste OPEN au boot (chemin organisateur,
 * GET /mine) — jamais par le chemin lien/participant (?p=token), qui reste
 * une activation explicite volontaire même pour un token déjà quitté.
 * @param {string|null|undefined} token
 * @returns {boolean}
 */
export function isDismissedSharedListToken(token) {
  if (!token) return false;
  try {
    const raw = sessionStorage.getItem(DISMISSED_SHARED_LISTS_KEY);
    if (!raw) return false;
    return JSON.parse(raw).includes(token);
  } catch (_) {
    return false;
  }
}

/**
 * Callback du × sur l'onglet "Liste de X"/"Ma liste" — organisateur et
 * participant indifféremment (mandat §2, mock organisateur `[ Mon panier ]
 * [ Ma liste × ]` inclus). Aucune garde de rôle ici, contrairement à
 * handleCloseClick.
 */
function handleExitSharedListDisplay() {
  rememberDismissedSharedListToken(state.sharedListContext.token);
  clearSharedListContext();
}

/**
 * Efface intégralement le contexte de liste, puis restaure le rendu du
 * panier personnel normal dans les mêmes surfaces.
 */
export function clearSharedListContext() {
  stopSnapshotPollingLoop();
  lastSnapshotSignature = null;
  resetSelection();
  state.sharedListContext = {
    sharedCartId: null,
    token: null,
    status: 'open',
    isCreator: false,
    creatorFirstName: null,
    title: null,
    message: null,
    items: [],
  };
  // É2 — miroir de la synchronisation dans activateSharedListContext.
  // Démonter une liste retire aussi son cache exact : un ×, une clôture ou
  // un lien devenu invalide ne doivent jamais ressusciter au prochain reload.
  clearActiveSharedListSession();
  state.cartSurface = 'personal';

  bus.emit('cart-snapshot:cleanup');
  // P0 §2 — même raison que setCartSurface('personal') : la fermeture/
  // annulation d'une liste ramène aussi la surface à 'personal', et le
  // drawer mobile doit être rappelé explicitement (voir commentaire
  // détaillé dans setCartSurface() ci-dessus).
  bus.emit('cart-body:render-personal');

  updateSharedListIndicator();
  // P0 (audit terrain — F22-9) : le listener 'side-cart:render' qui
  // appellerait renderCartSurfaceSwitch() est gardé par isActiveContext(),
  // qui est désormais false (token remis à null ci-dessus) — cette
  // condition empêche structurellement ce listener de jamais déclencher le
  // nettoyage de #k-cart-surface-switch une fois le contexte démonté.
  // Appel direct ici, au point de démontage, plutôt que de compter sur un
  // aller-retour par le bus qui ne peut plus fonctionner à cet instant.
  renderCartSurfaceSwitch();
  bus.emit('side-cart:render');
}

/**
 * Refonte UX (2026-08) — aucun contrôle de mutation sur les lignes de la
 * liste publiée, ni pour l'organisateur ni pour le participant (doctrine
 * §1.B — snapshot immutable dès publication : pas de stepper, pas de
 * retrait, pas de mode édition). Chaque ligne disponible peut uniquement être
 * sélectionnée pour composer une commande ; le CTA Commander ouvre toujours
 * le récapitulatif. Les anciens handleQuantityStep/handleRemoveItem
 * et le mode édition à bascule (toggleEditMode) ont été supprimés — ne pas
 * les réintroduire dans les commentaires ou le code sans décision produit
 * explicite révisant la doctrine d'immutabilité.
 */

/* ── Rendu ────────────────────────────────────────────────────────── */

function headerCopy() {
  const ctx = state.sharedListContext;
  const first = firstNameOf(ctx.creatorFirstName);
  return {
    title: sharedListDisplayLabel(ctx),
    sub: ctx.isCreator
      ? null
      : (first ? `${first} a préparé cette liste pour vous` : 'Cette liste a été partagée avec vous'),
  };
}

/**
 * Contexte structuré du checkout SHARED_LIST. Le titre est une projection
 * canonique ; sharedCartId/isCreator/creatorFirstName portent la relation
 * nécessaire au choix du destinataire du code, sans transmettre de téléphone.
 */
function checkoutContext() {
  const ctx = state.sharedListContext;
  return {
    origin: 'SHARED_LIST',
    sharedCartId: ctx.sharedCartId || null,
    isCreator: !!ctx.isCreator,
    creatorFirstName: firstNameOf(ctx.creatorFirstName),
    title: sharedListCheckoutLabel(ctx),
  };
}

/**
 * Amendement V2 §D — suivi purement local (mémoire, non persisté) des
 * tokens sauvegardés pendant la session en cours, pour ne pas réafficher
 * "Sauvegarder cette liste" juste après un clic réussi. La source de
 * vérité reste le backend (shared_cart_saved_access) ; ce Set n'est
 * qu'un confort d'affichage immédiat, jamais consulté pour une décision
 * métier.
 */
const savedListTokensThisSession = state.savedListTokensThisSession;

/**
 * Sauvegarde explicite d'une liste reçue (destinataire uniquement — le
 * créateur voit déjà sa liste dans « Créées par moi »). POST
 * /api/shared-carts/save, jamais automatique à l'ouverture du lien
 * (doctrine services/shared-cart-library.js). Le rendu du bouton
 * (visibilité, état sauvegardé/actif) est décidé par b-cart.js via
 * context.showSaveAction/context.saved — ce module ne construit plus de
 * HTML (mandat Lot A, un_renderer_panier).
 */
async function handleSaveList() {
  const token = state.sharedListContext.token;
  if (!token) return;
  try {
    const result = await saveSharedCart(token);
    savedListTokensThisSession.add(token);
    showToast(
      result.already_saved ? 'Cette liste est déjà dans vos listes.' : 'Liste ajoutée à vos listes.',
      'success'
    );
    renderSharedListInCart();
  } catch (_) {
    showToast('Impossible de sauvegarder cette liste pour le moment.', 'error');
  }
}

/* ── Bibliothèque « Mes listes » ──────────────────────────────────────────
 * Lot C (refactor soustractif shared-cart) — la bibliothèque « Créées par
 * moi » / « Partagées avec moi » ne se projette plus dans le side cart /
 * drawer (ancienne surface state.cartSurface === 'library', amendement V2
 * §D, retirée). Elle vit désormais dans l'onglet « Listes » de
 * js/b-tracking.js (index, projection pure de group-api.js::
 * getSharedCartLibrary()), qui délègue à activateFromParticipantUrl()
 * ci-dessous pour ouvrir une liste dans la surface canonique. Ce module ne
 * construit plus aucun HTML de bibliothèque (statusLabel(), qui ne servait
 * qu'à ce rendu, a été retiré avec elle — b-cart.js a son propre équivalent
 * pour la ligne de statut de la liste active, mandat un_renderer_panier).
 */

/**
 * Construit le contexte contextuel attendu par b-cart.js::renderCartSnapshot
 * (contrat {source, readOnly, title, status, organizerName, isOrganizer, ...})
 * à partir de state.sharedListContext. Ce contrôleur ne produit plus aucun
 * HTML — il adapte uniquement les données. Mandat cohérence post-LOT 13,
 * §3 — selectedIds transporte la sélection locale/éphémère courante ;
 * availableCount/availableTotal restent purement informatifs (ligne
 * "Reste disponible"), plus aucun lien avec un CTA d'achat direct.
 */
function buildSnapshotRenderContext() {
  const ctx = state.sharedListContext;
  const { title, sub } = headerCopy();
  const showSaveAction = !ctx.isCreator && !!ctx.token;
  return {
    source: 'shared-snapshot',
    readOnly: isReadOnly(),
    title,
    subtitle: sub,
    status: ctx.status,
    organizerName: ctx.creatorFirstName,
    isOrganizer: ctx.isCreator,
    // GAP-05 (Lot 2) — toujours [] si !isCreator (payload backend gaté),
    // ne dépend jamais d'un filtrage frontend supplémentaire.
    contributors: ctx.contributors,
    // Doctrine d'immutabilité (§1.B) — aucune notion d'editMode côté
    // contexte : la liste publiée n'a jamais de contrôle de mutation,
    // organisateur ou non. headerTitle distingue seulement le libellé.
    headerTitle: title,
    availableCount: availableItems().length,
    availableTotal: availableTotal(),
    selectedIds: selectedItemIds,
    // Revue mock (mock_side_cart_liste_recap_checkout_final.html) — le
    // libellé "Tout sélectionner"/"Tout désélectionner" suit cet état,
    // calculé ici (seule source de vérité de la sélection), jamais
    // recalculé indépendamment côté rendu (b-cart.js) pour éviter toute
    // désynchronisation entre le libellé affiché et le comportement réel
    // du clic (handleSelectAll ci-dessus applique exactement la même
    // condition).
    allAvailableSelected: availableItems().length > 0 &&
      availableItems().every((it) => selectedItemIds.has(String(it.id))),
    showSaveAction,
    saved: showSaveAction && savedListTokensThisSession.has(ctx.token),
  };
}

/**
 * Callbacks d'action fournis au renderer canonique — le contrôleur reste
 * seul propriétaire des appels API et des mutations d'état (mandat §8/§9).
 * Mandat cohérence post-LOT 13, §3 — onBuySingle/onBuyAll disparaissent :
 * onToggleSelect/onSelectAll pilotent uniquement la sélection locale,
 * onCommand est l'unique déclencheur de checkout, quel que soit N.
 */
function buildSnapshotRenderActions() {
  return {
    onOpenProduct: handleOpenItemProduct,
    onShare: handleShareClick,
    onClose: handleCloseClick,
    onToggleSelect: handleToggleSelect,
    onSelectAll: handleSelectAll,
    onCommand: handleCommand,
    onSave: handleSaveList,
  };
}

/**
 * Déclenche le rendu de la liste dans les deux surfaces canoniques via
 * l'événement bus 'cart-snapshot:render', consommé par b-cart.js::
 * renderCartSnapshot (unique propriétaire des lignes/side cart/drawer,
 * mandat doctrine un_renderer_panier). Ce module ne fournit plus qu'un
 * contexte + les items + des callbacks — zéro HTML construit ici (Lot A,
 * refactor soustractif shared-cart). Émission via bus plutôt qu'import
 * direct depuis Lot D+ (correctif cycle d'import, voir en-tête fichier).
 */
export function renderSharedListInCart() {
  if (!isActiveContext() || state.cartSurface !== 'shared-list') return;

  bus.emit('cart-snapshot:render', {
    context: buildSnapshotRenderContext(),
    items: state.sharedListContext.items,
    actions: buildSnapshotRenderActions(),
  });

  updateSharedListIndicator();
  renderCartSurfaceSwitch();
}

/* ── Ouverture / réouverture (drawer mobile) ─────────────────────────
 * Ne rejoue jamais checkout:open (contrairement à openCart() en mode
 * panier normal) : en contexte liste, cliquer le panier doit toujours
 * montrer la liste, jamais lancer directement le checkout personnel.
 */
export function reopenSharedListCart() {
  if (!isActiveContext()) return;
  state.cartSurface = 'shared-list';
  renderSharedListInCart();
  if (isDesktop()) return; // Le panneau persistant est déjà visible.

  dom.cartOverlay?.classList.add('open');
  dom.cartDrawer?.classList.add('open');
  document.body.classList.add('cart-open');
  document.body.classList.remove('cart-empty');
}

function closeSharedListDrawer() {
  dom.cartOverlay?.classList.remove('open');
  dom.cartDrawer?.classList.remove('open');
  document.body.classList.remove('cart-open');
}

/* ── Indicateur mobile "Liste · N" (mandat §7) ───────────────────────
 * Invisible hors contexte liste ; distinct du badge panier personnel ;
 * appui = réouverture du drawer.
 */
function updateSharedListIndicator() {
  let chip = document.getElementById('k-shared-list-chip');
  const shouldShow = isActiveContext() && !isDesktop();

  if (!shouldShow) {
    chip?.remove();
    return;
  }

  if (!chip) {
    chip = document.createElement('button');
    chip.id = 'k-shared-list-chip';
    chip.type = 'button';
    chip.className = 'k-shared-list-context-chip';
    chip.addEventListener('click', () => reopenSharedListCart());
    document.body.appendChild(chip);
  }
  chip.textContent = `Liste · ${availableItems().length}`;
  chip.hidden = dom.cartDrawer?.classList.contains('open') || false;
}

// Lot A — ce listener ne réagit plus aux propres émissions de ce module
// (renderSharedListInCart()/setCartSurface() appellent désormais
// updateSharedListIndicator()/renderCartSurfaceSwitch() directement à
// leur point de rendu, sans repasser par le bus — plus de boucle
// producteur/consommateur du même cycle, mandat §7). Il reste nécessaire
// pour un déclencheur réellement externe : b-cart-core.js émet
// 'side-cart:render' à chaque mutation du panier personnel (qty, ajout,
// retrait) ; si le sélecteur [Panier]/[Liste] est visible pendant qu'un
// contexte de liste est actif, son compteur "Panier (n)" doit rester à
// jour même si la liste, elle, n'a pas bougé.
bus.on('side-cart:render', () => {
  if (isActiveContext()) {
    updateSharedListIndicator();
    renderCartSurfaceSwitch();
  }
});

/**
 * Amendement V2 §B — restaure la surface liste à la fermeture de la
 * modale produit quand elle a été ouverte depuis une ligne de liste
 * (handleOpenItemProduct ci-dessus pose modalReturnSurface juste avant
 * bus.emit('modal:open', ...)). Consommation unique (mandat b-store.js) :
 * on remet la valeur à null immédiatement, qu'un contexte actif existe
 * encore ou non, pour ne jamais rejouer une restauration obsolète sur une
 * fermeture ultérieure sans rapport avec la liste.
 */
bus.on('modal:closed', () => {
  if (state.modalReturnSurface !== 'shared-list') return;
  state.modalReturnSurface = null;
  // Correctif V2-B.1 §2 — reopenSharedListCart() (et non le simple
  // setCartSurface utilisé auparavant) est nécessaire ici : sur mobile,
  // fermer la modale ne rouvrait jamais réellement le drawer (les classes
  // 'open' n'étaient jamais réappliquées). reopenSharedListCart() couvre
  // à la fois le rendu de surface et la réouverture DOM du drawer, et reste
  // un no-op desktop équivalent à l'ancien appel (panneau déjà visible).
  if (isActiveContext()) reopenSharedListCart();
});

/**
 * Correctif V2-B.1 §5 — un conflit "item_already_claimed" détecté pendant
 * le checkout canonique (article réclamé entre-temps par quelqu'un
 * d'autre) doit rafraîchir la liste affichée. Le checkout ne connaît
 * jamais la liste (doctrine group-checkout-adapter.js) : on écoute donc un
 * signal générique émis par b-checkout.js plutôt que d'y coupler
 * directement ce module. handleSharedListPurchaseConflict() existait déjà
 * mais n'était jusqu'ici jamais invoquée — dead code.
 */
bus.on('checkout:order-failed', ({ code } = {}) => {
  if (code === 'shared_cart_item_already_claimed' && isActiveContext()) {
    handleSharedListPurchaseConflict();
  }
});

/* ── Amendement V2 §A — bascule explicite de surface (coexistence) ───
 * Ne touche jamais au contexte de liste ni à la sélection locale : c'est
 * uniquement un aiguillage d'affichage entre panier personnel et liste,
 * les deux restant vivants en même temps (mandat §3 étendu).
 */
export function setCartSurface(surface) {
  state.cartSurface = surface;

  if (surface === 'shared-list') {
    // renderSharedListInCart() met déjà à jour l'indicateur et le
    // sélecteur à la fin de son propre rendu — pas besoin de les
    // redéclencher via le bus ici (mandat §7, évite une double émission
    // pour un seul cycle de rendu ; le second signal a été retiré en
    // Lot D, voir b-bus.js).
    renderSharedListInCart();
  } else {
    bus.emit('cart-snapshot:cleanup');
    updateSharedListIndicator();
    renderCartSurfaceSwitch();
    // P0 §2 (audit terrain — bascule mobile) : 'side-cart:render' ci-dessous
    // n'est câblé qu'à b-cart.js::renderSideCart (#k-side-cart, desktop).
    // Sans signal dédié, le drawer mobile (#k-cart-body, renderCartBody())
    // n'était jamais rappelé au clic "Mon panier" — cleanupCartSnapshotDom()
    // retire le chrome mais ne réécrit pas #k-cart-body, qui gardait donc
    // les lignes de la liste affichées à l'écran alors que state.cartSurface
    // était déjà repassé à 'personal'. Émission dédiée, consommée une seule
    // fois par b-cart.js (aiguillage explicite et symétrique desktop/mobile,
    // en miroir de 'cart-snapshot:render' côté liste — voir b-bus.js).
    bus.emit('cart-body:render-personal');
  }

  // Consommateurs externes légitimes (pas ce module) : b-cart.js::renderSideCart
  // (resynchronise #k-side-cart/.has-items depuis le panier personnel) et
  // group-library-remove.js (décoration de la bibliothèque).
  bus.emit('side-cart:render');
}

/**
 * Refonte UX — plus de bouton "← Revenir à mon panier". La liste active
 * EST le panier visible, pas une surface parallèle. Le panier personnel
 * redevient accessible uniquement quand la liste est fermée ou quittée
 * (clearSharedListContext). Le switcher est remplacé par un simple
 * indicateur visuel coloré indiquant qu'on est dans une liste partagée.
 */
/**
 * É4 (2026-08) — Deux onglets [ Mon panier ] [ Liste partagée ].
 *
 * L'onglet « Liste partagée » n'apparaît que lorsqu'une liste OPEN est
 * affichée dans le slot. Il est absent autrement (pas d'onglet vide).
 * Cliquer sur « Mon panier » change la surface locale sans aucun appel
 * de lifecycle (une liste OPEN reste OPEN — contrat §10, §3).
 *
 * Un seul élément DOM #k-cart-surface-switch contient les deux tabs.
 * Son absence (shouldShow=false) signifie affichage panier personnel seul.
 */
// L1b / N1 (mandat §15) — parité mobile/desktop. Le sélecteur d'onglets
// doit exister dans les DEUX conteneurs canoniques : #k-side-cart (desktop)
// et le drawer mobile (#k-cart-drawer). Ce sont deux arbres DOM disjoints
// (pas un seul réparenté par prepend), donc on maintient DEUX instances du
// sélecteur, synchronisées à chaque appel — même logique, pas de duplication
// métier (les deux appellent exactement setCartSurface()).
function buildSurfaceSwitchTabs(id) {
  const tabs = document.createElement('div');
  tabs.id = id;
  tabs.className = 'k-cart-tabs';

  const btnPersonal = document.createElement('button');
  btnPersonal.type = 'button';
  btnPersonal.className = 'k-cart-tab k-tab-personal';
  btnPersonal.textContent = 'Mon panier';
  btnPersonal.addEventListener('click', () => {
    // setCartSurface('personal') déclenche bus 'side-cart:render' qui
    // appelle renderSideCart() dans b-cart.js → panier personnel.
    // La liste OPEN reste OPEN côté backend — aucun appel POST.
    setCartSurface('personal');
  });

  const btnList = document.createElement('button');
  btnList.type = 'button';
  btnList.className = 'k-cart-tab k-tab-shared-list';
  btnList.addEventListener('click', () => {
    setCartSurface('shared-list');
  });

  // Mandat §2 — le × est INDISPENSABLE et distinct du contenu cliquable de
  // l'onglet : un <button> séparé (jamais imbriqué dans btnList, un
  // <button> dans un <button> serait invalide) pour ne jamais déclencher
  // setCartSurface('shared-list') en même temps que la sortie d'affichage.
  const btnExit = document.createElement('button');
  btnExit.type = 'button';
  btnExit.className = 'k-cart-tab-exit';
  btnExit.setAttribute('aria-label', 'Quitter l’affichage de cette liste');
  btnExit.textContent = '×';
  btnExit.addEventListener('click', (e) => {
    e.stopPropagation();
    handleExitSharedListDisplay();
  });

  const listTabGroup = document.createElement('span');
  listTabGroup.className = 'k-cart-tab-group';
  listTabGroup.append(btnList, btnExit);

  tabs.append(btnPersonal, listTabGroup);
  return tabs;
}

function mountSurfaceSwitchTabs(id, host, insertFn) {
  let tabs = document.getElementById(id);
  if (!tabs) {
    tabs = buildSurfaceSwitchTabs(id);
    if (host) insertFn(host, tabs);
  } else if (host && tabs.parentElement !== host) {
    insertFn(host, tabs);
  }
  return tabs;
}

export function renderCartSurfaceSwitch() {
  const sc = document.getElementById('k-side-cart');
  const drawerHeader = document.getElementById('k-cart-header');
  const drawerClose = document.getElementById('k-cart-close');
  const ctx = state.sharedListContext;
  const hasOpenList = isActiveContext() && ctx?.status === 'open';

  if (!hasOpenList) {
    document.getElementById('k-cart-surface-switch')?.remove();
    document.getElementById('k-cart-surface-switch-drawer')?.remove();
    if (drawerClose) {
      drawerClose.textContent = '✕';
      drawerClose.setAttribute('aria-label', 'Fermer le panier');
    }
    return;
  }

  const activeTab = state.cartSurface === 'shared-list' ? 'list' : 'personal';
  const listLabel = sharedListDisplayLabel(ctx);

  const desktopTabs = mountSurfaceSwitchTabs(
    'k-cart-surface-switch', sc, (host, tabs) => host.prepend(tabs));
  // Drawer mobile : les tabs vivent DANS le header canonique.
  // Une seule barre visuelle : ← + [Mon panier | Ma liste ×].
  const mobileTabs = mountSurfaceSwitchTabs(
    'k-cart-surface-switch-drawer', drawerHeader,
    (host, tabs) => host.appendChild(tabs));

  // Même bouton, même handler de fermeture : seule sa sémantique visuelle
  // devient un retour afin de ne jamais le confondre avec le × de sortie liste.
  if (drawerClose) {
    drawerClose.textContent = '←';
    drawerClose.setAttribute(
      'aria-label',
      'Fermer le panier et revenir à la boutique'
    );
  }

  for (const tabs of [desktopTabs, mobileTabs]) {
    if (!tabs) continue;
    const btnPersonal = tabs.querySelector('.k-tab-personal');
    const btnList = tabs.querySelector('.k-tab-shared-list');
    const listTabGroup = tabs.querySelector('.k-cart-tab-group');
    const btnExit = tabs.querySelector('.k-cart-tab-exit');
    if (btnPersonal) {
      btnPersonal.classList.toggle('k-cart-tab--active', activeTab === 'personal');
      btnPersonal.setAttribute('aria-selected', String(activeTab === 'personal'));
    }
    if (btnList) {
      btnList.textContent = listLabel;
      btnList.classList.toggle('k-cart-tab--active', activeTab === 'list');
      btnList.setAttribute('aria-selected', String(activeTab === 'list'));
    }
    if (listTabGroup) {
      // L'indicateur appartient au groupe complet [Ma liste + ×].
      // Un seul état visuel = un seul trait continu, desktop comme mobile.
      listTabGroup.classList.toggle(
        'k-cart-tab-group--active',
        activeTab === 'list',
      );
    }
    if (btnExit) {
      // Le × reste une action distincte, jamais un deuxième onglet actif.
      // Retirer explicitement l'ancienne classe évite tout segment résiduel.
      btnExit.classList.remove('k-cart-tab--active');
      btnExit.setAttribute('aria-label', `Quitter l’affichage de ${listLabel}`);
    }
    tabs.setAttribute('data-active', activeTab);
  }
}

/**
 * Amendement V2 §B — ouvre la fiche produit canonique depuis une ligne de
 * liste. `sharedCartItemId` accompagne l'événement pour un usage futur
 * éventuel (CTA contextualisés dans la modale) sans en dépendre ici.
 * Pose modalReturnSurface pour que la fermeture de la modale restaure la
 * surface liste (mandat §4 — b-store.js::modalReturnSurface, consommation
 * unique gérée par le listener bus.on('modal:closed') ci-dessous).
 * @param {string} itemId
 */
function handleOpenItemProduct(itemId) {
  const item = findItem(itemId);
  if (!item || !item.product_id) return;

  // Correctif V2-B.1 §3 — state.products (catalogue chargé côté boutique)
  // ne contient que les produits actifs disponibles à la vente ; un
  // product_id de ligne de liste peut pointer vers un produit supprimé ou
  // désactivé depuis le partage. b-modal-core.js::openModal() fait alors
  // un retour silencieux (aucun produit trouvé) sans aucun signal pour
  // l'utilisateur. On détecte le cas en amont pour informer clairement,
  // sans jamais fermer le drawer ni émettre modal:open dans ce cas.
  const product = (state.products || []).find((p) => String(p.id) === String(item.product_id));
  if (!product) {
    showToast('Ce produit n’est plus disponible.', 'info');
    return;
  }

  // Correctif V2-B.1 §1 — sur mobile, la modale s'ouvrait par-dessus le
  // drawer resté ouvert (aucune fermeture réelle avant bus.emit
  // ('modal:open', ...)). closeSharedListDrawer() est un no-op sûr sur
  // desktop (le panneau persistant n'a pas de classe 'open' à retirer).
  closeSharedListDrawer();

  state.modalReturnSurface = 'shared-list';
  bus.emit('modal:open', { id: item.product_id, source: 'shared-list', sharedCartItemId: item.id });
}

async function handleCloseClick() {
  if (!state.sharedListContext.isCreator || isReadOnly()) return;
  // L7 (mandat §11/§12, renommé §8 mandat cohérence post-LOT 13) — É9 : la
  // liste est figée depuis sa PUBLICATION, pas depuis sa clôture. Le
  // message porte sur ce qui change réellement : la fin des achats.
  // "Fermer" reste le verbe générique de dismiss (panneaux/modales)
  // ailleurs dans l'app ; "Clôturer" désigne spécifiquement cette action
  // métier irréversible, pour lever l'ambiguïté.
  const ok = await showKomerceConfirm({
    title: 'Clôturer cette liste ?',
    body: 'Les nouveaux achats ne seront plus possibles.',
    confirmLabel: 'Clôturer la liste',
    danger: true,
  });
  if (!ok) return;

  try {
    await apiCloseSharedCart(state.sharedListContext.sharedCartId);
    // P0 (audit — la liste fermée restait "active") — une liste CLOSED
    // n'est plus la liste active (doctrine §9) : elle doit être totalement
    // démontée du side cart / drawer canonique, pas simplement rafraîchie
    // en place avec un nouveau statut. refreshSharedListContext() rappelait
    // ici activateSharedListContext() avec le MÊME token -> cartSurface
    // restait 'shared-list', isActiveContext() restait true (token non
    // nul), et openCart() (b-cart.js, gardé par isSharedListSurfaceActive())
    // continuait donc de projeter cette liste fermée au lieu de revenir au
    // panier personnel. clearSharedListContext() est le seul chemin qui
    // remet cartSurface='personal', token=null et arrête le polling
    // (voir aussi son propre commentaire, plus haut dans ce fichier).
    clearSharedListContext();
    showToast('Liste clôturée.', 'success');
  } catch (err) {
    showToast(`Erreur : ${err.message}`, 'error');
  }
}

async function handleShareClick() {
  // Même fonction de partage natif que la création (mandat §9/§12) —
  // délégué à b-share-cart.js pour ne pas dupliquer navigator.share().
  const { startShareFlow } = await import('../b-share-cart.js');
  await startShareFlow({ reshare: true });
}

/* ── Checkout (mandat §8) ────────────────────────────────────────────── */

/**
 * Mandat cohérence post-LOT 13, §3.b/§3.c — unique déclencheur d'achat de
 * la liste partagée, quel que soit N (1..N lignes cochées). Remplace
 * définitivement handleBuySingleItem et handleBuyAllAvailable : plus
 * aucune branche par taille de sélection, plus de chemin d'achat séparé.
 * Construit une CheckoutSelection depuis selectedItemIds et lance un unique
 * checkout — le récapitulatif intégré (générique, §3.c) est porté par
 * b-checkout.js lui-même, pas par ce contrôleur.
 * Même garde de catalogue que l'ancien code : toute ligne dont le
 * product_id ne résout plus dans state.products est exclue et signalée,
 * sans bloquer l'achat des autres lignes cochées.
 */
function handleCommand() {
  if (isReadOnly()) return;
  const items = availableItems().filter((it) => selectedItemIds.has(String(it.id)));
  if (!items.length) return;

  const cartItems = [];
  let unavailableCount = 0;
  items.forEach((it) => {
    const product = (state.products || []).find((p) => String(p.id) === String(it.product_id));
    if (!product) {
      unavailableCount += 1;
      return;
    }
    cartItems.push({
      shared_cart_item_id: it.id,
      product,
      quantity: it.quantity || 1,
      variant_combo: it.variant_combo || null,
      shared_list_context: {
        snapshot_unit_price_kmf: Number(it.unit_price_kmf) || 0,
        snapshot_name: it.name || null,
        snapshot_image_url: it.image || null,
      },
    });
  });

  if (unavailableCount > 0) {
    // P1 (audit — message trompeur, hérité de l'ancien handleBuyAllAvailable) :
    // ces lignes ne sont PAS retirées de la liste — elles sont seulement
    // exclues de CET achat parce que leur product_id ne résout plus dans
    // le catalogue (state.products). Elles restent visibles et
    // sélectionnables individuellement dès que le produit redevient actif
    // — jamais "retiré", aucun retrait réel n'existe sur une liste
    // publiée (doctrine §1.B).
    showToast(
      unavailableCount === 1
        ? "Un article sélectionné n'est plus disponible et n'a pas été inclus dans cet achat."
        : `${unavailableCount} articles sélectionnés ne sont plus disponibles et n'ont pas été inclus dans cet achat.`,
      'info'
    );
  }

  if (!cartItems.length) {
    showToast('Plus rien à commander dans cette sélection.', 'info');
    return;
  }

  const started = checkoutSharedListSelection(cartItems, checkoutContext());
  if (!started) {
    showToast("Impossible de lancer l'achat, réessayez.", 'error');
    return;
  }

  // Correctif mandat §10 : la sélection n'est plus réinitialisée ici. Un
  // resetSelection() prématuré à ce point perdait la sélection dès le
  // premier onCommand(), alors que Retour/Annulation depuis le
  // checkout unifié doivent pouvoir
  // relancer le même achat sans tout recocher. La sélection reste donc
  // intacte tant qu'aucun rafraîchissement de contexte ne survient ;
  // c'est pruneSelectionAgainstItems() (déclenché par
  // activateSharedListContext au prochain refresh/poll) qui retire
  // naturellement les lignes devenues claimed après un achat réussi.
  const observer = new MutationObserver(() => {
    if (dom.orderModal && !dom.orderModal.classList.contains('open')) {
      observer.disconnect();
      refreshSharedListContext();
    }
  });
  if (dom.orderModal) {
    observer.observe(dom.orderModal, { attributes: true, attributeFilter: ['class'] });
  }
}

/**
 * À appeler par le gestionnaire d'erreur checkout si le backend répond
 * "item_already_claimed" (rareté arbitrée en base, mandat §8). Affiche un
 * message non blâmant puis rafraîchit la liste.
 *
 * Correctif V2-E — retrait de `export` : plus jamais appelée que par le
 * listener bus.on('checkout:order-failed', ...) juste en dessous, dans ce
 * même module (le seul appelant, avant ce correctif, était bel et bien ce
 * listener déjà présent ici — l'export n'a jamais eu d'autre consommateur,
 * ni ailleurs dans le front ni dans les tests).
 */
async function handleSharedListPurchaseConflict() {
  showToast('Cet article vient d’être acheté, en voici d’autres encore disponibles.', 'info');
  await refreshSharedListContext();
}

/* ── Entrée destinataire (lien reçu) ─────────────────────────────────── */

export async function activateFromParticipantUrl(token, { silent = false } = {}) {
  const data = await getSharedCartPublic(token);
  if (!data) {
    if (!silent) {
      showToast('Ce lien de liste partagée est invalide ou expiré.', 'error');
    }
    return false;
  }
  // É3 — une liste CLOSED/CANCELLED n'occupe jamais le side-cart (contrat §5,
  // invariant 5 du contrat API). En restauration silencieuse au boot, aucun
  // toast parasite : le caller peut poursuivre vers son fallback propriétaire.
  const status = (data.cart?.status || '').toLowerCase();
  if (status === 'closed' || status === 'cancelled') {
    if (!silent) {
      showToast(
        status === 'cancelled'
          ? 'Cette liste a été annulée.'
          : 'Cette liste est fermée — les achats ne sont plus possibles.',
        'info',
      );
    }
    return false;
  }
  activateSharedListContext(data, token, { silent });
  return true;
}

/* ── Entrée propriétaire (Mon Komerce → Mes listes) ──────────────────────
 * V1 (retiré, amendement V2 §D) : activateOwnerMostRecentList() ouvrait
 * automatiquement la liste créée la plus récente, sans notion de liste
 * *reçue* et conservée. V2 §D : remplacée par activateOwnerLibrary()
 * (bibliothèque à deux sections projetée dans le side cart). Lot C
 * (refactor soustractif shared-cart) : activateOwnerLibrary() retirée à son
 * tour — le point d'entrée propriétaire est désormais l'onglet « Listes »
 * de js/b-tracking.js, qui appelle activateFromParticipantUrl() ci-dessus
 * pour ouvrir une liste précise dans la surface canonique. Voir rapport de
 * clôture V2-D et SHARED-CART-REFACTOR-lots.md (Lot C).
 */
