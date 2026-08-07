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
  removeItemFromSharedList,
  closeCart as apiCloseSharedCart,
  updateSharedListItemQuantity as apiUpdateSharedListItemQuantity,
  addItemToSharedList,
} from './group-api.js';
import { checkoutSharedListSelection } from './group-checkout-adapter.js';

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
 * Lignes disponibles (non réclamées) du snapshot — celles qui portent un
 * bouton "Acheter" individuel et alimentent "Tout acheter".
 */
function availableItems() {
  return state.sharedListContext.items.filter((it) => !it.claimed);
}

/**
 * Refonte UX — valeur totale des lignes encore disponibles. Sert
 * uniquement d'affichage informatif (sous-total footer) et de base au CTA
 * discret "Tout acheter" (handleBuyAllAvailable). Plus de notion de
 * sélection locale : soit on achète une ligne, soit on les achète toutes.
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
 * Amendement V2 §B — verrou local par ligne pendant un PATCH quantité en
 * vol. Purement transitoire (UI), jamais persisté.
 */
const pendingQuantityItemIds = new Set();

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
  // Lot B — le mode édition ne doit pas survivre au passage d'une liste à
  // une autre (lien différent ouvert pendant qu'une liste était déjà en
  // édition) ; il doit en revanche survivre à un simple refresh de la même
  // liste après mutation (handleQuantityStep/handleRemoveItem rappellent
  // cette fonction via refreshSharedListContext), sinon chaque édition
  // referme silencieusement le mode édition après un seul geste.
  const previousToken = state.sharedListContext.token;
  const nextToken = cart.token || token;
  if (previousToken !== nextToken) state.sharedListEditMode = false;

  const items = Array.isArray(data.items) ? data.items : [];
  const contributors = Array.isArray(data.contributors) ? data.contributors : [];
  const signature = computeSnapshotSignature(cart, items, contributors);
  const unchanged = silent && previousToken === nextToken && signature === lastSnapshotSignature;
  lastSnapshotSignature = signature;

  state.sharedListContext = {
    sharedCartId: cart.id ?? state.sharedListContext.sharedCartId,
    token: nextToken,
    status: cart.status || 'open',
    isCreator: !!data.is_creator,
    creatorFirstName: cart.creator_first_name || null,
    // GAP-05 (Lot 2) — [{first_name, items_count}], jamais présent côté
    // participant (gating server-side exclusif, shared-cart-reads.js).
    contributors,
    title: cart.title || null,
    message: cart.message || null,
    items,
  };
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

/**
 * Efface intégralement le contexte de liste, puis restaure le rendu du
 * panier personnel normal dans les mêmes surfaces.
 */
export function clearSharedListContext() {
  stopSnapshotPollingLoop();
  lastSnapshotSignature = null;
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
  state.sharedListEditMode = false;
  state.cartSurface = 'personal';

  bus.emit('cart-snapshot:cleanup');

  updateSharedListIndicator();
  bus.emit('side-cart:render');
}

/**
 * Refonte UX (2026-08) — plus de mode édition à bascule. L'organisateur
 * voit TOUJOURS les steppers et les boutons de retrait sur les lignes
 * disponibles. Le participant voit les lignes en lecture seule. Pas
 * besoin d'activer un "mode" pour modifier la liste — la liste est
 * l'interface directe.
 *
 * toggleEditMode() retiré : l'ancienne bascule visible/invisible des
 * contrôles de mutation n'a plus de sens quand ils sont toujours visibles.
 * state.sharedListEditMode conservé uniquement pour ne pas casser les
 * tests existants, mais forcé à true côté contexte (buildSnapshotRenderContext).
 */

/* ── Rendu ────────────────────────────────────────────────────────── */

function headerCopy() {
  const ctx = state.sharedListContext;
  if (ctx.isCreator) {
    return { title: ctx.title || 'Votre liste', sub: null };
  }
  const first = ctx.creatorFirstName;
  return {
    title: ctx.title || (first ? `Liste de ${first}` : 'Liste partagée'),
    sub: first ? `${first} a préparé cette liste pour vous` : 'Cette liste a été partagée avec vous',
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
 * HTML — il adapte uniquement les données. Doctrine finale (2026-08) —
 * plus de sélection locale : availableCount/availableTotal couvrent tout
 * ce qui n'est pas encore réclamé, achetable ligne par ligne ou en bloc
 * ("Tout acheter").
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
    // Refonte UX — editMode toujours true pour l'organisateur tant que la
    // liste est ouverte : les steppers/✕ sont toujours visibles, pas
    // derrière un bouton "Modifier". Le participant n'a jamais editMode.
    editMode: ctx.isCreator && !isReadOnly(),
    headerTitle: ctx.isCreator ? 'Votre liste' : title,
    availableCount: availableItems().length,
    // Refonte UX — affichage informatif + base du CTA discret "Tout
    // acheter" (plus de selectedTotal, il n'y a plus de sélection).
    availableTotal: availableTotal(),
    showSaveAction,
    saved: showSaveAction && savedListTokensThisSession.has(ctx.token),
    pendingQuantityItemIds,
  };
}

/**
 * Callbacks d'action fournis au renderer canonique — le contrôleur reste
 * seul propriétaire des appels API et des mutations d'état (mandat §8/§9).
 */
function buildSnapshotRenderActions() {
  return {
    onRemove: handleRemoveItem,
    onQuantityStep: handleQuantityStep,
    onOpenProduct: handleOpenItemProduct,
    onShare: handleShareClick,
    onClose: handleCloseClick,
    // Refonte UX — un bouton "Acheter" par ligne, pas un bouton global.
    onBuySingle: handleBuySingleItem,
    // Optionnel discret en bas de liste — achète tout le disponible en
    // une seule commande (organisateur et participant).
    onBuyAll: handleBuyAllAvailable,
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
export function renderCartSurfaceSwitch() {
  const sc = document.getElementById('k-side-cart');
  const ctx = state.sharedListContext;
  const shouldShow = isActiveContext() && state.cartSurface === 'shared-list';

  if (!shouldShow) {
    document.getElementById('k-cart-surface-switch')?.remove();
    return;
  }

  let switcher = document.getElementById('k-cart-surface-switch');
  if (!switcher) {
    switcher = document.createElement('div');
    switcher.id = 'k-cart-surface-switch';
    switcher.className = 'k-list-indicator';
    sc?.prepend(switcher);
  } else if (sc && switcher.parentElement !== sc) {
    sc.prepend(switcher);
  }

  // Doctrine finale (2026-08) — bandeau unique en tête de side cart :
  // dot coloré + "Liste de <nom> · <Statut>". Même libellé pour
  // l'organisateur et le participant (c'est toujours "la liste de X"),
  // jamais un texte différent selon le rôle.
  const isOpen = ctx.status === 'open';
  const statusLabel = isOpen ? 'Ouverte' : 'Fermée';
  const dot = isOpen ? '🟢' : '🔴';
  const name = ctx.creatorFirstName || ctx.title || null;
  const label = name ? `Liste de ${sanitize(name)}` : 'Liste partagée';
  switcher.classList.toggle('is-closed', !isOpen);
  switcher.innerHTML =
    `<span class="k-list-indicator-dot" aria-hidden="true">${dot}</span> ` +
    `<span class="k-list-indicator-text">${label} · ${statusLabel}</span>`;
}

/* ── Actions propriétaire (mandat §9) ─────────────────────────────────
 * Lot 3 GAP-07 — CTA "Ajouter à cette liste" depuis la fiche produit.
 * Remplace le handler handleAddItemClick() retiré en V2-F (qui pointait
 * vers un CTA jamais construit) : le parcours produit existe désormais
 * (b-modal-buybox-shared.js::wireAddToListButton, câblé dans
 * renderActions() des deux compositions mobile/desktop).
 */

/**
 * Le CTA "Ajouter à cette liste" (fiche produit) ne doit être visible que
 * dans exactement les mêmes conditions où l'ajout serait accepté par
 * addProductToActiveSharedList ci-dessous — même garde, exposée séparément
 * pour que le rendu (b-modal-buybox-shared.js) n'ait pas à dupliquer la
 * condition ni à tenter un appel pour découvrir qu'il est refusé.
 * @returns {boolean}
 */
export function canAddToActiveSharedList() {
  // Refonte UX — plus de condition sharedListEditMode (le mode édition
  // n'existe plus en tant que bascule). Le CTA "Ajouter à cette liste" est
  // disponible dès qu'une liste ouverte est active et que l'utilisateur en
  // est le créateur.
  return state.cartSurface === 'shared-list'
    && isActiveContext()
    && !!state.sharedListContext.isCreator
    && state.sharedListContext.status === 'open';
}

/**
 * Ajoute un produit catalogue à la liste active, uniquement si l'appelant
 * en est le créateur et que la liste est encore ouverte — mêmes garde-fous
 * que les autres actions propriétaire ci-dessous (handleRemoveItem,
 * handleQuantityStep, toggleEditMode). N'ouvre ni ne modifie jamais
 * state.cart (panier personnel) : c'est une écriture directe sur la liste
 * active via POST /api/shared-carts/:id/items.
 *
 * Le serveur (services/shared-cart-items-service.js::addSharedCartItem,
 * GAP-07 lot préalable) reste seul autoritaire sur le prix, le SKU
 * résolu et la disponibilité — aucune valeur fournie ici n'est jamais
 * traitée comme une vérité.
 *
 * Même convention que handleRemoveItem/handleQuantityStep ci-dessous :
 * toast de retour posé ici (succès et erreur), pas délégué à l'appelant.
 *
 * @param {{id: string}} product — produit catalogue (state.products),
 *   jamais un objet reconstruit côté modale.
 * @param {number} [quantity=1]
 * @param {object|null} [variantCombo] — combinaison canonique
 *   ({axisKey: value}) pour un produit SKU entièrement sélectionné,
 *   sinon null. Jamais un objet vide fabriqué par ce module.
 * @returns {Promise<boolean>} true si l'ajout a réussi
 */
export async function addProductToActiveSharedList(product, quantity = 1, variantCombo = null) {
  if (!product || !product.id) return false;
  // Mandat §3.1 — garde défensive répétée à l'écriture, mêmes 4 conditions
  // que canAddToActiveSharedList() (jamais dupliquée en substance, jamais
  // affaiblie). Le serveur reste seul autoritaire en dernier ressort.
  if (!canAddToActiveSharedList()) return false;

  try {
    await addItemToSharedList(state.sharedListContext.sharedCartId, product.id, quantity, variantCombo);
  } catch (err) {
    // window.K.request (komerce-api.js) rejette avec une Error dont
    // .message est déjà le texte serveur (json.error) — ex. "Combinaison
    // indisponible pour Chemise", "Stock insuffisant pour Chemise —
    // disponible : 1", "Ce panier n'est plus modifiable". On l'affiche
    // tel quel, jamais un message générique qui masquerait la vraie
    // cause (ex. combinaison épuisée entre-temps par un autre acheteur).
    showToast(`Erreur : ${err.message}`, 'error');
    return false;
  }

  await refreshSharedListContext();
  showToast(`« ${sanitize(product.name || 'Article')} » ajouté à la liste.`, 'success');
  return true;
}

async function handleRemoveItem(itemId) {
  if (!state.sharedListContext.isCreator || isReadOnly()) return;
  const item = findItem(itemId);
  if (!item) return;
  const ok = window.confirm(`Retirer « ${item.name || 'cet article'} » de la liste ?`);
  if (!ok) return;

  try {
    await removeItemFromSharedList(state.sharedListContext.sharedCartId, itemId);
    await refreshSharedListContext();
    showToast('Article retiré de la liste.', 'success');
  } catch (err) {
    showToast(`Erreur : ${err.message}`, 'error');
  }
}

/**
 * Amendement V2 §B §11 — pas +1/-1 sur la quantité d'une ligne. Verrouille
 * la ligne (pendingQuantityItemIds) pendant l'aller-retour réseau pour
 * empêcher un double-clic ou une réponse hors ordre de partir en double
 * appel. Le serveur reste la source de vérité : on rafraîchit depuis lui
 * plutôt que d'appliquer la nouvelle quantité de façon optimiste.
 * @param {string} itemId
 * @param {number} step -1 | 1
 */
async function handleQuantityStep(itemId, step) {
  if (!state.sharedListContext.isCreator || isReadOnly()) return;
  const item = findItem(itemId);
  if (!item || item.claimed) return;

  const key = String(itemId);
  if (pendingQuantityItemIds.has(key)) return;

  const nextQty = (Number(item.quantity) || 1) + step;
  if (nextQty < 0) return;
  // Correctif V2-B.1 §4 — passer de 1 à 0 ne doit pas être bloqué
  // silencieusement (aucun retour utilisateur auparavant) : c'est un
  // retrait, traité par le même flux confirmé que le bouton ✕
  // (handleRemoveItem, confirm() + DELETE), jamais une décrémentation
  // silencieuse à 0 ni un appel PATCH quantity=0 (refusé par le serveur).
  if (nextQty === 0) {
    await handleRemoveItem(itemId);
    return;
  }

  pendingQuantityItemIds.add(key);
  renderSharedListInCart();
  try {
    await apiUpdateSharedListItemQuantity(state.sharedListContext.sharedCartId, itemId, nextQty);
    await refreshSharedListContext();
  } catch (err) {
    showToast(`Erreur : ${err.message}`, 'error');
  } finally {
    pendingQuantityItemIds.delete(key);
    renderSharedListInCart();
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
  const ok = window.confirm('Fermer cette liste ? Elle deviendra en lecture seule.');
  if (!ok) return;

  try {
    await apiCloseSharedCart(state.sharedListContext.sharedCartId);
    await refreshSharedListContext();
    showToast('Liste fermée.', 'success');
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
 * Refonte UX — achète un article seul. Chaque ligne disponible a son
 * propre bouton "Acheter" (pattern liste de cadeaux). L'adaptateur
 * checkout construit un panier éphémère avec cette seule ligne.
 * @param {string} itemId — shared_cart_items.id
 */
function handleBuySingleItem(itemId) {
  const item = findItem(itemId);
  if (!item || item.claimed) return;

  const product = (state.products || []).find((p) => String(p.id) === String(item.product_id));
  if (!product) {
    showToast("Ce produit n'est plus disponible dans le catalogue.", 'info');
    refreshSharedListContext();
    return;
  }

  const cartItems = [{
    shared_cart_item_id: item.id,
    product,
    quantity: item.quantity || 1,
    variant_combo: item.variant_combo || null,
    shared_list_context: {
      snapshot_unit_price_kmf: Number(item.unit_price_kmf) || 0,
      snapshot_name: item.name || null,
      snapshot_image_url: item.image || null,
    },
  }];

  const started = checkoutSharedListSelection(cartItems);
  if (!started) {
    showToast("Impossible de lancer l'achat, r\u00e9essayez.", 'error');
    return;
  }

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
 * Doctrine finale — "Tout acheter" : construit un panier éphémère avec
 * TOUTES les lignes encore disponibles et lance un unique checkout.
 * Optionnel et discret (organisateur et participant) — jamais le CTA
 * principal de la liste, qui reste le bouton "Acheter" par ligne.
 * Même garde de catalogue que handleBuySingleItem (product_id résolu
 * contre state.products, jamais construit depuis la ligne de liste) :
 * toute ligne dont le produit catalogue est introuvable est simplement
 * exclue et signalée, sans bloquer l'achat des autres.
 */
function handleBuyAllAvailable() {
  const items = availableItems();
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
    renderSharedListInCart();
    showToast(
      unavailableCount === 1
        ? 'Un article de la liste n’est plus disponible et a été retiré.'
        : `${unavailableCount} articles de la liste ne sont plus disponibles et ont été retirés.`,
      'info'
    );
  }

  if (!cartItems.length) {
    showToast('Plus rien à acheter dans cette liste.', 'info');
    return;
  }

  const started = checkoutSharedListSelection(cartItems);
  if (!started) {
    showToast("Impossible de lancer l'achat, réessayez.", 'error');
    return;
  }

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

export async function activateFromParticipantUrl(token) {
  const data = await getSharedCartPublic(token);
  if (!data) {
    showToast('Ce lien de liste partagée est invalide ou expiré.', 'error');
    return false;
  }
  activateSharedListContext(data, token);
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
