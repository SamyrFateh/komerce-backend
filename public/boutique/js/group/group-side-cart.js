/**
 * @komerce-arch
 * @role          shared-list-canonical-cart-projection
 * @domain        shared-cart
 * @layer         ui-component
 * @criticality   critical
 * @inputs        shared_cart_public_payload, local_selection
 * @outputs       dom_render(k-side-cart, k-cart-drawer), checkout_invocation
 * @depends       ../b-store.js, ../b-utils.js, ../b-bus.js, ../b-scroll-owner.js, group-api.js, group-state.js, group-checkout-adapter.js
 * @used-by       b-nav.js, b-share-cart.js, b-komerce.js
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
import { showToast, sanitize, fmt } from '../b-utils.js';
import { bus } from '../b-bus.js';
import { isDesktop } from '../b-scroll-owner.js';
import {
  getSharedCartPublic,
  getOwnerSharedCarts,
  removeItemFromSharedList,
  closeCart as apiCloseSharedCart,
  addItemToSharedList as apiAddItemToSharedList,
  updateSharedListItemQuantity as apiUpdateSharedListItemQuantity,
} from './group-api.js';
import { pickOwnerCart } from './group-state.js';
import { checkoutSharedListSelection } from './group-checkout-adapter.js';

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

function selectedItems() {
  return state.sharedListContext.items.filter((it) => state.sharedListSelection.has(String(it.id)));
}

function selectionTotal() {
  return selectedItems().reduce((sum, it) => sum + (Number(it.unit_price_kmf) || 0) * (Number(it.quantity) || 1), 0);
}

function isActiveContext() {
  return !!state.sharedListContext.token;
}

function isReadOnly() {
  return state.sharedListContext.status !== 'open';
}

/**
 * Amendement V2 §B — verrou local par ligne pendant un PATCH quantité en
 * vol. Purement transitoire (UI), jamais persisté ni mêlé à
 * sharedListSelection : un double-clic ou une réponse hors ordre sur la
 * même ligne ne doit jamais partir en double appel réseau.
 */
const pendingQuantityItemIds = new Set();

/* ── Activation / rafraîchissement / nettoyage du contexte ──────────── */

/**
 * Remplit state.sharedListContext depuis une réponse GET .../public/:token
 * et rend la liste dans les surfaces canoniques. N'écrit jamais dans
 * state.cart (Invariant mandat §3).
 * @param {{cart:object, items:Array, is_creator:boolean}} data
 * @param {string} token
 */
export function activateSharedListContext(data, token) {
  if (!data || !data.cart) return;

  const cart = data.cart;
  state.sharedListContext = {
    sharedCartId: cart.id ?? state.sharedListContext.sharedCartId,
    token: cart.token || token,
    status: cart.status || 'open',
    isCreator: !!data.is_creator,
    creatorFirstName: cart.creator_first_name || null,
    title: cart.title || null,
    message: cart.message || null,
    items: Array.isArray(data.items) ? data.items : [],
  };
  state.cartSurface = 'shared-list';

  pruneInvalidSelection();
  renderSharedListInCart();

  if (isDesktop()) {
    // Desktop : le side cart persistant suffit, pas de drawer à ouvrir.
    return;
  }
  // Mobile : ouvrir automatiquement le drawer après le rendu (mandat §4/§7).
  reopenSharedListCart();
}

/**
 * Retire de la sélection locale les lignes qui n'existent plus ou qui sont
 * devenues `claimed` (Invariant : un article claimed ne peut jamais être
 * sélectionné).
 */
function pruneInvalidSelection() {
  const validSelectableIds = new Set(
    state.sharedListContext.items.filter((it) => !it.claimed).map((it) => String(it.id))
  );
  [...state.sharedListSelection].forEach((id) => {
    if (!validSelectableIds.has(String(id))) state.sharedListSelection.delete(id);
  });
}

/**
 * Recharge la liste depuis le backend (source de vérité) — utilisé après
 * ajout/retrait/fermeture et après un conflit d'achat (mandat §8/§9).
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
  activateSharedListContext(data, state.sharedListContext.token);
  return data;
}

/**
 * Nettoyage DOM commun — retire les traces visuelles du mode liste des
 * surfaces canoniques (side cart desktop, drawer). Ne touche jamais
 * `.has-items` sur #k-side-cart : ce toggle appartient au pipeline de rendu
 * du panier personnel (b-cart.js) et se resynchronise seul juste après
 * (mandat §5 — b-cart.js reste propriétaire du shell canonique).
 */
function cleanupSharedListDom() {
  document.body.classList.remove('is-shared-list-context');
  document.getElementById('k-side-cart')?.removeAttribute('data-mode');
  document.getElementById('k-shared-list-panel')?.remove();
  dom.cartDrawer?.removeAttribute('data-mode');
  dom.cartFooter?.classList.remove('u-hidden');
}

/**
 * Garde utilisée par b-cart.js::renderCartBody() (mandat §5 — b-cart.js
 * reste propriétaire du shell canonique et délègue le rendu du corps à ce
 * module tant qu'un contexte de liste est actif, quel que soit l'appelant
 * d'origine : setQty, removeFromCart, clearCart, checkout, etc.).
 * @returns {boolean}
 */
export function isSharedListActive() {
  return isActiveContext();
}

/**
 * Amendement V2 §A — vraie condition de rendu dans renderCartBody() :
 * un contexte actif ne suffit plus (il peut rester en arrière-plan pendant
 * que le panier personnel est affiché). remplace isSharedListActive() comme
 * garde de rendu dans b-cart.js::renderCartBody().
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
  cleanupSharedListDom();
}

/**
 * Efface intégralement le contexte de liste et la sélection locale, puis
 * restaure le rendu du panier personnel normal dans les mêmes surfaces.
 */
export function clearSharedListContext() {
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
  state.sharedListSelection = new Set();
  state.cartSurface = 'personal';

  cleanupSharedListDom();

  updateSharedListIndicator();
  bus.emit('side-cart:render');
}

/* ── Sélection locale (aucun appel réseau — mandat §8) ──────────────── */

export function toggleSharedListItem(itemId) {
  const item = findItem(itemId);
  if (!item || item.claimed) return;

  const key = String(itemId);
  if (state.sharedListSelection.has(key)) {
    state.sharedListSelection.delete(key);
  } else {
    state.sharedListSelection.add(key);
  }

  renderSharedListInCart();
}

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

function statusLabel(status) {
  return { open: 'Ouverte', closed: 'Fermée', cancelled: 'Annulée' }[status] || status;
}

/**
 * Amendement V2 §B §11 — contrôles de quantité, réservés au propriétaire,
 * sur une liste ouverte, pour une ligne non réclamée.
 */
function quantityControlHtml(item) {
  if (!state.sharedListContext.isCreator || isReadOnly() || item.claimed) return '';
  const locked = pendingQuantityItemIds.has(String(item.id));
  const qty = Number(item.quantity) || 1;
  return (
    `<div class="k-shared-item-qty" data-item-id="${sanitize(String(item.id))}">` +
      `<button type="button" class="k-shared-item-qty-btn" data-qty-step="-1" data-item-id="${sanitize(String(item.id))}" ` +
        `aria-label="Diminuer la quantité" ${locked ? 'disabled' : ''}>−</button>` +
      `<span class="k-shared-item-qty-val">${qty}</span>` +
      `<button type="button" class="k-shared-item-qty-btn" data-qty-step="1" data-item-id="${sanitize(String(item.id))}" ` +
        `aria-label="Augmenter la quantité" ${locked ? 'disabled' : ''}>+</button>` +
    `</div>`
  );
}

function itemRowHtml(item) {
  const claimed = !!item.claimed;
  const selected = state.sharedListSelection.has(String(item.id));
  const classes = ['k-shared-list-item'];
  if (claimed) classes.push('is-claimed');
  else if (selected) classes.push('is-selected');

  const img = item.image
    ? `<img class="k-cart-item-img-el" src="${sanitize(item.image)}" alt="" loading="lazy">`
    : '';

  const statusText = claimed ? 'Déjà acheté' : 'Disponible';
  const priceText = fmt(item.unit_price_kmf, 'KMF');

  const control = claimed
    ? `<button type="button" class="k-shared-item-select" disabled aria-disabled="true">Déjà acheté</button>`
    : `<button type="button" class="k-shared-item-select" data-item-id="${sanitize(String(item.id))}" aria-pressed="${selected}">${selected ? 'Sélectionné' : 'Sélectionner'}</button>`;

  const removeBtn = state.sharedListContext.isCreator && !claimed
    ? `<button type="button" class="k-shared-item-remove" data-item-id="${sanitize(String(item.id))}" aria-label="Retirer cet article" title="Retirer">✕</button>`
    : '';

  // Amendement V2 §B — image et nom deviennent un bouton unique consultant la
  // fiche produit canonique (mandat §1/§3) : un seul élément interactif, pas
  // toute la ligne, pour ne jamais entrer en conflit avec sélection/quantité/retrait.
  const openLabel = `Voir la fiche produit — ${item.name || 'cet article'}`;
  return (
    `<div class="${classes.join(' ')}" data-item-id="${sanitize(String(item.id))}">` +
      `<button type="button" class="k-shared-item-open" data-item-id="${sanitize(String(item.id))}" aria-label="${sanitize(openLabel)}">` +
        `<div class="k-cart-item-img">${img}</div>` +
        `<div class="k-cart-item-info">` +
          `<div class="k-cart-item-name">${sanitize(item.name || '')}</div>` +
          `<div class="k-shared-item-meta">${priceText} · <span class="k-shared-item-status">${statusText}</span></div>` +
        `</div>` +
      `</button>` +
      quantityControlHtml(item) +
      `<div class="k-shared-item-controls">${control}${removeBtn}</div>` +
    `</div>`
  );
}

function progressHtml() {
  const items = state.sharedListContext.items;
  const total = items.length;
  const claimed = items.filter((it) => it.claimed).length;
  const pct = total ? Math.round((claimed / total) * 100) : 0;
  return (
    `<div class="k-shared-list-progress">` +
      `<div class="k-shared-list-progress-track"><div class="k-shared-list-progress-fill" style="width:${pct}%"></div></div>` +
      `<div class="k-shared-list-progress-label">${claimed} article${claimed > 1 ? 's' : ''} sur ${total} déjà acheté${claimed > 1 ? 's' : ''}</div>` +
    `</div>`
  );
}

function creatorActionsHtml() {
  if (!state.sharedListContext.isCreator) return '';
  const closed = isReadOnly();
  return (
    `<div class="k-shared-list-creator-actions">` +
      `<button type="button" id="k-shared-list-add" class="k-cart-continue-shop" ${closed ? 'disabled' : ''}>+ Ajouter un article</button>` +
      `<button type="button" id="k-shared-list-share" class="k-cart-continue-shop">📤 Partager</button>` +
      `<button type="button" id="k-shared-list-close" class="k-cart-continue-shop" ${closed ? 'disabled' : ''}>${closed ? 'Liste fermée' : 'Fermer la liste'}</button>` +
    `</div>`
  );
}

function footerHtml() {
  const count = state.sharedListSelection.size;
  const total = selectionTotal();
  if (count === 0) {
    return (
      `<div class="k-shared-list-footer">` +
        `<p class="k-shared-list-footer-hint">Sélectionnez les articles que vous souhaitez acheter</p>` +
        `<button type="button" id="k-shared-list-buy" class="kcf-btn kcf-full" disabled>Acheter la sélection</button>` +
      `</div>`
    );
  }
  return (
    `<div class="k-shared-list-footer">` +
      `<div class="k-shared-list-footer-recap">` +
        `<span>${count} article${count > 1 ? 's' : ''} sélectionné${count > 1 ? 's' : ''}</span>` +
        `<strong>${fmt(total, 'KMF')}</strong>` +
      `</div>` +
      `<button type="button" id="k-shared-list-buy" class="kcf-btn kcf-full">Acheter la sélection</button>` +
    `</div>`
  );
}

function panelHtml() {
  const { title, sub } = headerCopy();
  const ctx = state.sharedListContext;
  return (
    `<div class="k-shared-list-header">` +
      `<span class="k-shared-list-title">${sanitize(title)}</span>` +
      `<span class="k-shared-list-status-badge k-shared-list-status-${sanitize(ctx.status)}">${statusLabel(ctx.status)}</span>` +
    `</div>` +
    (sub ? `<div class="k-shared-list-subtitle">${sanitize(sub)}</div>` : '') +
    progressHtml() +
    `<div class="k-shared-list-items">${ctx.items.map(itemRowHtml).join('')}</div>` +
    creatorActionsHtml() +
    footerHtml()
  );
}

function wirePanel(root) {
  if (!root) return;

  root.querySelectorAll('.k-shared-item-select').forEach((btn) => {
    btn.addEventListener('click', () => toggleSharedListItem(btn.dataset.itemId));
  });

  root.querySelectorAll('.k-shared-item-remove').forEach((btn) => {
    btn.addEventListener('click', () => handleRemoveItem(btn.dataset.itemId));
  });

  root.querySelectorAll('.k-shared-item-qty-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleQuantityStep(btn.dataset.itemId, Number(btn.dataset.qtyStep)));
  });

  root.querySelectorAll('.k-shared-item-open').forEach((btn) => {
    btn.addEventListener('click', () => handleOpenItemProduct(btn.dataset.itemId));
  });

  root.querySelector('#k-shared-list-add')?.addEventListener('click', handleAddItemClick);
  root.querySelector('#k-shared-list-share')?.addEventListener('click', handleShareClick);
  root.querySelector('#k-shared-list-close')?.addEventListener('click', handleCloseClick);
  root.querySelector('#k-shared-list-buy')?.addEventListener('click', handleBuySelection);
}

/**
 * Rend la liste dans les deux surfaces canoniques : le side cart desktop
 * persistant (#k-side-cart) et le drawer mobile / vue étendue desktop
 * (#k-cart-drawer via dom.cartBody/dom.cartFooter). Ne touche jamais au
 * rendu du panier personnel (renderSideCart / renderCartBody) qui reste
 * la branche par défaut hors contexte (mandat §1 "Hors contexte liste").
 */
export function renderSharedListInCart() {
  if (!isActiveContext() || state.cartSurface !== 'shared-list') return;

  document.body.classList.add('is-shared-list-context');

  // ── Desktop : panneau persistant ──────────────────────────────
  const sc = document.getElementById('k-side-cart');
  if (sc) {
    sc.setAttribute('data-mode', 'shared-list');
    sc.classList.add('has-items');
    let panel = sc.querySelector('#k-shared-list-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'k-shared-list-panel';
      panel.className = 'k-shared-list-panel';
      sc.prepend(panel);
    }
    panel.innerHTML = panelHtml();
    wirePanel(panel);
  }

  // ── Mobile / vue étendue : drawer canonique ───────────────────
  if (dom.cartDrawer) dom.cartDrawer.setAttribute('data-mode', 'shared-list');
  if (dom.cartBody) {
    dom.cartBody.innerHTML = panelHtml();
    // Le footer sticky du drawer est déjà contenu dans panelHtml() ;
    // le footer canonique (#k-cart-footer, recap panier personnel) reste caché.
    dom.cartFooter?.classList.add('u-hidden');
    wirePanel(dom.cartBody);
  }
  if (dom.cartHeaderTitle) {
    dom.cartHeaderTitle.textContent = state.sharedListContext.isCreator
      ? 'Votre liste'
      : headerCopy().title;
  }

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
  chip.textContent = `Liste · ${state.sharedListSelection.size}`;
  chip.hidden = dom.cartDrawer?.classList.contains('open') || false;
}

// Le chip doit se mettre à jour aussi quand le drawer se ferme depuis
// b-cart.js (bouton #k-cart-close) sans repasser par cette module —
// on écoute un signal déjà émis pour tout rendu de side cart.
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
  if (isActiveContext()) setCartSurface('shared-list');
});

/* ── Amendement V2 §A — bascule explicite de surface (coexistence) ───
 * Ne touche jamais au contexte de liste ni à la sélection locale : c'est
 * uniquement un aiguillage d'affichage entre panier personnel et liste,
 * les deux restant vivants en même temps (mandat §3 étendu).
 */
export function setCartSurface(surface) {
  state.cartSurface = surface;

  if (surface === 'shared-list') {
    renderSharedListInCart();
  } else {
    cleanupSharedListDom();
  }

  bus.emit('cart-body:render');
  bus.emit('side-cart:render');
}

/**
 * Sélecteur desktop [Panier (n)] [Liste (n)] — permet de revenir au panier
 * personnel sans jamais fermer le contexte de liste actif. Visible
 * seulement sur desktop, quand le panier personnel n'est pas vide ET qu'un
 * contexte de liste est actif (hors de ce cas, une seule surface existe :
 * rien à basculer, mandat §3 — ne pas ajouter de chrome inutile).
 */
export function renderCartSurfaceSwitch() {
  const sc = document.getElementById('k-side-cart');
  const shouldShow = isDesktop() && isActiveContext() && state.cart.length > 0;

  if (!shouldShow) {
    document.getElementById('k-cart-surface-switch')?.remove();
    return;
  }

  const personalQty = state.cart.reduce((n, it) => n + (Number(it.qty) || 0), 0);
  const listTitle = headerCopy().title || 'Liste';
  const surface = state.cartSurface;

  let switcher = document.getElementById('k-cart-surface-switch');
  if (!switcher) {
    switcher = document.createElement('div');
    switcher.id = 'k-cart-surface-switch';
    switcher.className = 'k-cart-surface-switch';
    sc?.prepend(switcher);
  } else if (sc && switcher.parentElement !== sc) {
    sc.prepend(switcher);
  }

  switcher.innerHTML =
    `<button type="button" class="k-cart-surface-btn" data-surface="personal" ` +
      `aria-pressed="${surface === 'personal'}">Panier (${personalQty})</button>` +
    `<button type="button" class="k-cart-surface-btn" data-surface="shared-list" ` +
      `aria-pressed="${surface === 'shared-list'}">${sanitize(listTitle)} (${state.sharedListContext.items.length})</button>`;

  switcher.querySelectorAll('.k-cart-surface-btn').forEach((btn) => {
    btn.onclick = () => setCartSurface(btn.dataset.surface);
  });
}

/* ── Actions propriétaire (mandat §9) ────────────────────────────────── */

async function handleAddItemClick() {
  if (isReadOnly()) return;
  // L'ajout se fait depuis une fiche produit (CTA "Ajouter à cette liste"),
  // pas depuis le side cart lui-même. On ferme le drawer pour laisser le
  // créateur naviguer le catalogue ; le contexte liste reste actif
  // (Invariant §3 : fermer le drawer conserve contexte et sélection).
  closeSharedListDrawer();
  showToast('Ouvrez une fiche produit puis choisissez « Ajouter à cette liste ».', 'info');
}

/**
 * Ajoute un article à la liste depuis une fiche produit. Écrit
 * immédiatement côté serveur (un seul appel, mandat §9), jamais via le
 * panier personnel.
 * @param {string|number} productId
 * @param {number} [quantity=1]
 */
export async function addItemToSharedList(productId, quantity = 1) {
  if (!isActiveContext() || !state.sharedListContext.isCreator || isReadOnly()) return false;
  const cartId = state.sharedListContext.sharedCartId;
  if (!cartId) return false;
  try {
    await apiAddItemToSharedList(cartId, productId, quantity);
    await refreshSharedListContext();
    showToast('Article ajouté à la liste.', 'success');
    return true;
  } catch (err) {
    showToast(`Erreur : ${err.message}`, 'error');
    return false;
  }
}

async function handleRemoveItem(itemId) {
  if (!state.sharedListContext.isCreator || isReadOnly()) return;
  const item = findItem(itemId);
  if (!item) return;
  const ok = window.confirm(`Retirer « ${item.name || 'cet article'} » de la liste ?`);
  if (!ok) return;

  try {
    await removeItemFromSharedList(state.sharedListContext.sharedCartId, itemId);
    state.sharedListSelection.delete(String(itemId));
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
  if (nextQty <= 0) return;

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

function handleBuySelection() {
  const items = selectedItems();
  if (!items.length) return;

  const cartItems = items.map((it) => ({
    shared_cart_item_id: it.id,
    product: { id: it.id, name: it.name, image_url: it.image, price_kmf: it.unit_price_kmf },
    quantity: it.quantity || 1,
  }));

  const started = checkoutSharedListSelection(cartItems);
  if (!started) {
    showToast("Sélection invalide, réessayez.", 'error');
    return;
  }

  // Écoute un seul cycle de fermeture du modal de commande pour détecter un
  // conflit d'achat (article réclamé entre-temps) et rafraîchir la liste
  // (mandat §8 "Conflit").
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
 */
export async function handleSharedListPurchaseConflict() {
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
 * V1 : ouvre la liste la plus récente directement dans le side cart /
 * drawer canonique (isCreator = true), sans onglet ni page dédiée
 * (mandat §4/§9). Un sélecteur multi-listes reste un travail ultérieur si
 * plusieurs listes actives coexistent — voir rapport de clôture.
 */
export async function activateOwnerMostRecentList() {
  const data = await getOwnerSharedCarts();
  const carts = data?.carts || [];
  const cart = pickOwnerCart(carts);
  if (!cart) {
    showToast("Vous n'avez pas encore de liste partagée.", 'info');
    return false;
  }
  return activateFromParticipantUrl(cart.token);
}
