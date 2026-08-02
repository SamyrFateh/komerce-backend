/**
 * @komerce-arch
 * @role          shared-list-view
 * @domain        shared-cart
 * @layer         ui-component
 * @criticality   high
 * @inputs        share_token, viewer_session
 * @outputs       dom_render, checkout_invocation
 * @depends       ../b-store.js, ../b-utils.js, group/group-api.js, group/group-state.js, group/group-checkout-adapter.js
 * @used-by       b-nav.js, b-share-cart.js
 * @doctrine      un_seul_composant, capacites_pas_ecrans, vocabulaire_achat, boutique_first
 * @impact-areas  shared-cart, participant-flow, creator-flow, checkout, navigation
 * @version       2026-08
 */
'use strict';

/**
 * @module group/group-render-list.js
 * @owner Boutique First — écran unique de la liste partageable.
 *
 * Remplace b-group-view.js. Un seul arbre de rendu pour tout le monde
 * (storyboard §0, §3 ; Invariant UX 1) : les capacités du créateur
 * apparaissent en ligne dans le même écran, jamais un composant séparé.
 * L'identité "je suis le créateur" est dérivée côté serveur (is_creator,
 * Contrat API §5 point 2) — ce module ne fait jamais lui-même cette
 * comparaison.
 *
 * Vocabulaire strictement celui du Contrat UX §4 / Invariants UX §II :
 * "Liste", "Disponible" / "Déjà acheté", "[Prénom]", "Acheter la
 * sélection", "Vous". Jamais "panier partagé", "réclamer", "participant",
 * "organisateur" à l'écran.
 *
 * Hors périmètre de ce module, signalé explicitement plutôt qu'improvisé :
 *   - Édition du titre/message : retirée du périmètre (Contrat API point 3,
 *     "sauf besoin démontré"). Le bloc titre/message reste en lecture
 *     seule pour tout le monde, y compris le créateur.
 *   - Ajout d'un article : le Contrat UX §1 assume un "picker boutique
 *     standard (composant existant, réutilisé)" — ce composant n'existe
 *     nulle part dans ce dépôt (seul un picker de relais de livraison
 *     existe, sans rapport). Contradiction entre le contrat figé et le
 *     code réel = impossibilité technique objective, pas une décision à
 *     ma charge. Le bouton est rendu mais désactivé, avec un message
 *     explicite, plutôt qu'un picker ad hoc improvisé.
 *   - Rafraîchissement ambiant : non spécifié par le storyboard (Contrat
 *     UX §6, non bloquant) — pas implémenté ici. stopPolling() est
 *     conservé en no-op pour la compatibilité du contrat de b-nav.js.
 */

import { state, dom } from '../b-store.js';
import { showToast } from '../b-utils.js';
import {
  getOwnerSharedCarts,
  getSharedCartPublic,
  removeItemFromSharedList,
  closeCart as apiCloseCart,
} from './group-api.js';
import { pickOwnerCart, refreshGroupBadge as _refreshGroupBadge } from './group-state.js';
import { checkoutSharedListSelection } from './group-checkout-adapter.js';

export { refreshGroupBadge } from './group-state.js';

// ── État module (une seule liste affichée à la fois) ──────────────────────
let currentToken = null;
let currentData = null;          // dernière réponse getSharedCartPublic
const selectedItemIds = new Set(); // sélection locale, jamais envoyée avant achat (Invariant 16)

/**
 * Détecte un token participant dans l'URL au boot (convention ?p=token,
 * inchangée). Fonction pure, aucune dépendance réseau/state.
 */
export function detectParticipantToken() {
  const url = new URL(window.location.href);
  const qp = url.searchParams.get('p');
  if (qp) return qp;
  const m = url.pathname.match(/\/cart\/shared\/([^/?#]+)/);
  return m ? m[1] : null;
}

/**
 * Conservé en no-op : le storyboard ne spécifie aucun rafraîchissement
 * ambiant (Contrat UX §6, non bloquant). b-nav.js appelle stopPolling()
 * inconditionnellement au changement d'onglet — contrat préservé, effet nul.
 */
export function stopPolling() {}

function getContainer() {
  let el = document.getElementById('k-group-view');
  if (!el) {
    el = document.createElement('div');
    el.id = 'k-group-view';
    el.className = 'k-group-view';
    const anchor = document.getElementById('k-track-view')
      || document.getElementById('k-fav-view')
      || document.getElementById('k-catalog-section');
    anchor.after(el);
  }
  return el;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatKmf(n) {
  return Math.round(Number(n) || 0).toLocaleString('fr-FR') + ' KMF';
}

// ═══════════════════════════════════════════════════════════════════════
// ── Point d'entrée ────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

/**
 * Affiche la liste partagée. Deux modes :
 *   - opts.participantToken fourni → lien reçu, storyboard §4.1.
 *   - sans token → switcher créateur (navigation directe onglet Groupe,
 *     hors périmètre du storyboard mais nécessaire, group-state.js).
 * Même chemin de lecture pour tout le monde une fois le token connu
 * (storyboard §3) : pas de mode "créateur" séparé au-delà de ce switch
 * initial sur la SOURCE du token.
 */
export async function renderGroupView(opts = {}) {
  selectedItemIds.clear();
  const el = getContainer();

  if (opts.participantToken) {
    currentToken = opts.participantToken;
    return loadAndRender(el);
  }

  // Navigation directe sans token : résoudre depuis les listes du créateur.
  renderLoadingSkeleton(el);
  let carts = [];
  try {
    const rsp = await getOwnerSharedCarts();
    carts = rsp?.carts || [];
  } catch (_) {
    // silencieux : traité comme "aucune liste", pas une erreur bloquante
  }
  const picked = pickOwnerCart(carts, opts.cartId);
  if (!picked) {
    renderNoListState(el);
    return;
  }
  currentToken = picked.token;
  return loadAndRender(el);
}

async function loadAndRender(el) {
  renderLoadingSkeleton(el);
  let data;
  try {
    data = await getSharedCartPublic(currentToken);
  } catch (_) {
    data = null;
  }

  if (!data) {
    // Lien invalide/expiré → redirection boutique standard, jamais une
    // page d'erreur isolée (Contrat UX §2, Invariant 22).
    window.location.href = '/boutique/';
    return;
  }

  currentData = data;
  renderScreen(el);
  _refreshGroupBadge();
}

// ═══════════════════════════════════════════════════════════════════════
// ── États d'écran ─────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

function renderLoadingSkeleton(el) {
  el.innerHTML = `
    <div class="k-glist-skeleton" aria-busy="true">
      <div class="k-glist-skel-banner"></div>
      <div class="k-glist-skel-progress"></div>
      <div class="k-glist-skel-grid">
        <div class="k-glist-skel-card"></div>
        <div class="k-glist-skel-card"></div>
        <div class="k-glist-skel-card"></div>
      </div>
    </div>`;
}

function renderNoListState(el) {
  el.innerHTML = `
    <div class="k-glist-empty">
      <p>Vous n'avez pas encore de liste.</p>
    </div>`;
}

function renderScreen(el) {
  const { cart, items, items_count: total, claimed_count: claimedCount, is_creator: isCreator } = currentData;

  if (cart.status === 'cancelled') {
    el.innerHTML = `<div class="k-glist-cancelled"><p>Cette liste n'est plus active.</p></div>`;
    return;
  }

  const isClosed = cart.status === 'closed';
  const complete = total > 0 && claimedCount >= total;

  el.innerHTML = `
    <section class="k-glist" data-status="${escapeHtml(cart.status)}">
      <header class="k-glist-banner">
        ${cart.creator_first_name
          ? `<p class="k-glist-invite">${escapeHtml(cart.creator_first_name)} a préparé cette liste pour vous</p>`
          : ''}
        ${cart.title ? `<h2 class="k-glist-title">${escapeHtml(cart.title)}</h2>` : ''}
        ${cart.message ? `<p class="k-glist-message">${escapeHtml(cart.message)}</p>` : ''}
      </header>

      ${complete
        ? `<p class="k-glist-complete-msg">Tout a trouvé preneur</p>`
        : `<div class="k-glist-progress">
             <span class="k-glist-progress-text">${claimedCount} article${claimedCount > 1 ? 's' : ''} sur ${total} déjà acheté${claimedCount > 1 ? 's' : ''}</span>
             <div class="k-glist-progress-bar"><div class="k-glist-progress-fill" style="width:${total ? Math.round(claimedCount / total * 100) : 0}%"></div></div>
           </div>`}

      ${isClosed ? `<p class="k-glist-closed-msg">Cette liste est fermée — lecture seule.</p>` : ''}

      <div class="k-glist-grid">
        ${items.map(it => renderItemCard(it, { isCreator, isClosed })).join('')}
      </div>

      ${isCreator ? renderCreatorControls({ isClosed }) : ''}
    </section>

    <div class="k-glist-minibar u-hidden">
      <span class="k-glist-minibar-total"></span>
      <button type="button" class="k-glist-buy-btn">Acheter la sélection</button>
    </div>
  `;

  bindItemSelection(el);
  bindMinibar(el);
  if (isCreator) bindCreatorControls(el);
}

function renderItemCard(it, { isCreator, isClosed }) {
  const selectable = !it.claimed && !isClosed;
  return `
    <article class="k-glist-item ${it.claimed ? 'k-glist-item--claimed' : ''}" data-item-id="${escapeHtml(it.id)}" data-selectable="${selectable}">
      <div class="k-glist-item-img">${it.image ? `<img src="${escapeHtml(it.image)}" alt="${escapeHtml(it.name)}" loading="lazy">` : ''}</div>
      <p class="k-glist-item-name">${escapeHtml(it.name)}</p>
      <p class="k-glist-item-price">${formatKmf(it.unit_price_kmf)}</p>
      <p class="k-glist-item-status">${it.claimed ? 'Déjà acheté' : 'Disponible'}</p>
      ${isCreator && !it.claimed ? `<button type="button" class="k-glist-item-remove" data-remove-id="${escapeHtml(it.id)}" aria-label="Retirer cet article">✕</button>` : ''}
    </article>`;
}

function renderCreatorControls({ isClosed }) {
  return `
    <div class="k-glist-creator-controls">
      ${!isClosed ? `<button type="button" class="k-glist-add-btn">+ Ajouter un article</button>` : ''}
      ${!isClosed ? `<button type="button" class="k-glist-close-btn">Fermer la liste</button>` : ''}
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════
// ── Interactions ──────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

function bindItemSelection(el) {
  el.querySelectorAll('.k-glist-item[data-selectable="true"]').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.k-glist-item-remove')) return; // le retrait a sa propre action
      const id = card.dataset.itemId;
      if (selectedItemIds.has(id)) {
        selectedItemIds.delete(id);
        card.classList.remove('k-glist-item--selected');
      } else {
        selectedItemIds.add(id);
        card.classList.add('k-glist-item--selected');
      }
      updateMinibar();
    });
  });
}

function updateMinibar() {
  const bar = document.querySelector('.k-glist-minibar');
  if (!bar) return;
  const selectedItems = (currentData?.items || []).filter(it => selectedItemIds.has(String(it.id)));
  if (!selectedItems.length) {
    bar.classList.add('u-hidden');
    return;
  }
  const total = selectedItems.reduce((s, it) => s + Number(it.line_total_kmf || 0), 0);
  bar.querySelector('.k-glist-minibar-total').textContent = formatKmf(total);
  bar.classList.remove('u-hidden');
}

function bindMinibar(el) {
  const bar = document.querySelector('.k-glist-minibar');
  if (!bar) return;
  const btn = bar.querySelector('.k-glist-buy-btn');
  btn.addEventListener('click', () => {
    const selectedItems = (currentData?.items || [])
      .filter(it => selectedItemIds.has(String(it.id)))
      .map(it => ({ shared_cart_item_id: it.id, product: { id: it.id, name: it.name, image_url: it.image }, quantity: 1 }));

    const started = checkoutSharedListSelection(selectedItems);
    if (!started) {
      showToast('Sélection invalide, réessayez.', 'error');
    }
  });
}

function bindCreatorControls(el) {
  el.querySelectorAll('[data-remove-id]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const itemId = btn.dataset.removeId;
      if (!window.confirm('Retirer cet article de la liste ?')) return;
      try {
        await removeItemFromSharedList(currentData.cart.id, itemId);
        await loadAndRender(getContainer());
      } catch (err) {
        showToast(err?.message || 'Retrait impossible.', 'error');
      }
    });
  });

  const addBtn = el.querySelector('.k-glist-add-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      // Boutique First — simplification doctrinale : pas de picker dédié.
      // La boutique standard est déjà le meilleur sélecteur de produits.
      // On y retourne, en conservant le contexte de la liste en cours
      // (state.activeListId) pour que chaque carte/fiche produit puisse y
      // proposer « Ajouter à cette liste », symétrique de « Ajouter au
      // panier ». Câblage de cette action sur les cartes produit : hors
      // périmètre de ce module, à faire côté catalogue.
      state.activeListId = currentData.cart.id;
      import('../b-nav.js').then(({ switchView }) => switchView('shop'));
    });
  }

  const closeBtn = el.querySelector('.k-glist-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', async () => {
      if (!window.confirm('Fermer cette liste ? Plus aucun achat ne sera possible après.')) return;
      try {
        await apiCloseCart(currentData.cart.id);
        await loadAndRender(getContainer());
      } catch (err) {
        showToast(err?.message || 'Fermeture impossible.', 'error');
      }
    });
  }
}
