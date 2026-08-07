/**
 * @komerce-arch
 * @role          shared-list-creation-from-boutique
 * @domain        shared-cart
 * @layer         ui-component
 * @criticality   critical
 * @inputs        cart_state, phone_identity
 * @outputs       shared_list_link, clear_local_cart_signal, group_view_transition
 * @depends       b-store.js, b-cart-core.js, b-cart.js, group/group-side-cart.js, b-group-banner.js, b-identity.js
 * @used-by       boutique.js, b-modal-approche-c-hybrid.js
 * @doctrine      partage_immediat, boutique_canal_decouverte, checkout_canonique
 * @impact-areas  shared-list-creation, participant-flow, creator-flow, local-cart
 * @version       2026-08
 */
'use strict';

/**
 * @module b-share-cart
 * @brief Action « Partager cette liste » depuis le panier boutique.
 *
 * Boutique First :
 *   - aucune configuration ne précède le partage ;
 *   - le clic crée immédiatement une liste à partir de la sélection courante ;
 *   - le lien voyage par le canal choisi par l'utilisateur ;
 *   - le checkout reste le checkout canonique, hors de ce module.
 */

import { state } from './b-store.js';
import { showToast } from './b-cart-core.js';
import { clearCart } from './b-cart.js';
import { refreshGroupBadge } from './group/group-state.js';
import { showBanner, hideBanner, refreshBanner } from './b-group-banner.js';
import { requireIdentity } from './b-identity.js';
import { fetchWithTimeout } from './group/group-api.js';

const API_CREATE = '/api/shared-carts/from-cart-items';
const API_MINE = '/api/shared-carts/mine';
// Doctrine finale (§9) — une liste CLOSED (ou CANCELLED) n'est plus la
// liste active opérationnelle : elle reste consultable depuis « Mes
// listes » mais ne doit ni se restaurer automatiquement comme panier au
// prochain boot, ni bloquer la création d'une nouvelle liste, ni
// afficher le badge/bandeau « actif ». Seul 'open' qualifie.
const ACTIVE_STATUSES = new Set(['open']);
const DEFAULT_LIST_TITLE = 'Liste partagée';
const SHARE_BUTTON_LABEL = '📤 Partager cette liste';

/* ── Helpers ───────────────────────────────────────────────────── */

function effectiveDeadline(cart) {
  return cart?.expires_at || null;
}

function isActiveCart(cart) {
  return cart != null && ACTIVE_STATUSES.has(cart.status);
}

function pickActiveCart(carts = []) {
  return [...carts]
    .filter(isActiveCart)
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0] || null;
}

function applyCartToState(cart) {
  if (!cart) return null;

  state.shareToken = cart.token || null;
  state.shareId = cart.id || null;
  state.shareExpiry = effectiveDeadline(cart);
  state.cartName = cart.title || DEFAULT_LIST_TITLE;
  state.shareStatus = cart.status || null;

  state.shareUrl = cart.share_url
    || (cart.token ? `${window.location.origin}/boutique/?p=${cart.token}` : null);

  saveShareState();
  return cart;
}

/* ── Persistance session : cache uniquement ───────────────────── */

function loadShareState() {
  try {
    const raw = sessionStorage.getItem('kmrc_share');
    if (!raw) return;

    const saved = JSON.parse(raw);
    state.shareToken = saved.token || null;
    state.shareId = saved.id || null;
    state.shareExpiry = saved.expiry || null;
    state.cartName = saved.name || '';
    state.shareStatus = saved.status || null;
    state.shareUrl = saved.share_url || null;
  } catch (_) {}
}

function saveShareState() {
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

function clearLocalShareState() {
  state.shareToken = null;
  state.shareId = null;
  state.shareExpiry = null;
  state.cartName = '';
  state.shareStatus = null;
  state.shareUrl = null;

  try {
    sessionStorage.removeItem('kmrc_share');
    sessionStorage.removeItem('kmrc_banner_dismissed');
  } catch (_) {}
}

export function clearShareState() {
  clearLocalShareState();
  refreshGroupBadge();
  hideBanner();
  refreshSharedBadges(false);
}

/* ── Restauration backend : source de vérité ───────────────────── */

export async function restoreSharedCartFromBackend({ silent = true } = {}) {
  try {
    const res = await fetchWithTimeout(API_MINE, { credentials: 'include' });

    if (!res.ok) {
      // Une session absente ne doit pas effacer un lien déjà restauré localement.
      if (res.status === 401 || res.status === 403) return null;
      throw new Error(`GET /mine ${res.status}`);
    }

    const data = await res.json().catch(() => ({}));
    const cart = pickActiveCart(data.carts || []);

    if (!cart) {
      clearLocalShareState();
      refreshSharedBadges(false);
      hideBanner();
      refreshGroupBadge();
      return null;
    }

    applyCartToState(cart);
    refreshSharedBadges(true);
    refreshGroupBadge();
    showBanner({
      title: cart.title || DEFAULT_LIST_TITLE,
      expires_at: effectiveDeadline(cart),
      status: cart.status,
    });

    // P0-A — une liste OPEN restaurée doit redevenir LE panier canonique
    // visible (state.cartSurface = 'shared-list'), pas seulement une
    // métadonnée de session (token/bandeau/badges ci-dessus). silent=true :
    // ne rouvre jamais un drawer mobile au simple chargement de la page.
    activateCartInCanonicalSurface(cart, { silent: true });

    return cart;
  } catch (err) {
    if (!silent) showToast(`Liste non restaurée : ${err.message}`, 'error');
    return null;
  }
}

/* ── Boutons et badges ─────────────────────────────────────────── */

function shareButtons() {
  return [
    document.getElementById('k-cart-share'),
    document.getElementById('k-sc-share'),
  ].filter(Boolean);
}

function setShareButtonsBusy(isBusy) {
  shareButtons().forEach((button) => {
    button.disabled = isBusy;
    button.textContent = isBusy ? '⏳ Création…' : SHARE_BUTTON_LABEL;
  });
}

export function refreshSharedBadges(isShared) {
  const mobileBadge = document.getElementById('k-share-badge-row');
  if (mobileBadge) mobileBadge.hidden = !isShared;

  const desktopBadge = document.getElementById('k-sc-shared-badge');
  if (desktopBadge) {
    desktopBadge.hidden = true;
    desktopBadge.innerHTML = '';
  }

  const desktopShare = document.getElementById('k-sc-share');
  if (desktopShare) desktopShare.hidden = false;

  shareButtons().forEach((button) => {
    if (!button.disabled) button.textContent = SHARE_BUTTON_LABEL;
  });

  refreshGroupBadge();
}

/* ── Création et diffusion ─────────────────────────────────────── */

async function createSharedCart() {
  const cartItems = state.cart
    .map((item) => ({
      product_id: item.product?.id || item.id,
      quantity: Number(item.qty) || 1,
      // P0-D (audit — variant_combo perdu à la création) : le panier local
      // capture déjà variant_combo au moment de l'ajout (b-cart.js §Lot 2,
      // ligne ~292) ; createSharedCartFromCartItems()/resolveSellableUnit()
      // (services/shared-cart-creation.js) savent déjà le résoudre et le
      // valident côté serveur (aucun fallback vers un SKU arbitraire) — il
      // ne manquait que sa transmission dans ce payload.
      variant_combo: item.variant_combo || null,
    }))
    .filter((item) => item.product_id);

  const res = await fetch(API_CREATE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ cart_items: cartItems }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || `Erreur API (${res.status})`);
  }

  return res.json();
}

function buildShareText(title) {
  const label = title && title !== DEFAULT_LIST_TITLE ? ` « ${title} »` : '';
  return `Je te partage une sélection Komerce${label}. `
    + `Tu peux la consulter, acheter ce qui t'intéresse ou poursuivre tes propres achats.`;
}

async function shareList(title, shareUrl) {
  const text = buildShareText(title);

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: 'Sélection Komerce',
        text,
        url: shareUrl,
      });
      return 'native';
    } catch (err) {
      // L'utilisateur a simplement fermé la feuille de partage.
      if (err?.name === 'AbortError') return 'cancelled';
      // En cas d'indisponibilité transitoire, continuer avec le fallback.
    }
  }

  try {
    await navigator.clipboard?.writeText(shareUrl);
    showToast('Lien copié. Collez-le sur WhatsApp ou ailleurs pour le partager.', 'success');
  } catch (_) {
    showToast(shareUrl);
  }

  return 'fallback';
}

/**
 * PROMPT_FINAL_IMPLEMENTATION_LISTE_PARTAGEABLE_SIDE_CART — remplace
 * l'ancien switchToGroup() (switchView('group'), onglet principal
 * autonome, interdit par le mandat §2/§4 : "Aucun switchView('group')").
 * La liste vient d'être créée par le propriétaire : on active le contexte
 * dans le side cart / drawer canonique, exactement comme pour un
 * destinataire, avec isCreator = true.
 */
/**
 * P0-A (audit — reload ne réactivait pas la liste) — active réellement une
 * liste comme panier canonique visible (state.cartSurface = 'shared-list'
 * dans group-side-cart.js), pas seulement comme métadonnée de session
 * (token/bandeau/badges). Partagée par le flux de création explicite
 * (silent=false, ouvre le drawer mobile) et par la restauration au boot
 * (silent=true, ne rouvre jamais un drawer que l'utilisateur n'a pas
 * demandé — seul le rendu, déjà visible dans le side cart persistant sur
 * desktop, est mis à jour).
 */
function activateCartInCanonicalSurface(cart, { silent = false } = {}) {
  return Promise.all([
    import('./group/group-side-cart.js'),
    import('./group/group-api.js'),
  ]).then(async ([sideCart, api]) => {
    const data = await api.getSharedCartPublic(cart.token);
    if (!data) return;
    sideCart.activateSharedListContext(data, cart.token, { silent });
    // Ne PAS simuler de clic sur #k-cart-btn ici : ça déclenche openCart()
    // (b-cart.js), qui écraserait le contexte de liste qu'on vient
    // d'activer si openCart() n'était pas déjà gardé par
    // isSharedListSurfaceActive() (voir P0-C, b-cart.js). Le drawer
    // s'ouvre déjà tout seul sur mobile via reopenSharedListCart() (sauf
    // en mode silencieux) ; sur desktop le side cart en mode snapshot est
    // visible sans action supplémentaire.
  });
}

function openSharedListInCanonicalCart(cart) {
  activateCartInCanonicalSurface(cart, { silent: false });
}

/**
 * Bouton "👥 Suivre les participations →" du badge partagé (#k-sc-group-view).
 * Remplace l'ancien handler switchToGroup() — supprimé lors de la migration
 * précédente mais dont ce listener n'avait pas été mis à jour (bug trouvé à
 * la reprise de session : référence à un identifiant jamais défini dans ce
 * module, ReferenceError dès l'exécution de install()). On ne connaît ici
 * que le token courant (state.shareToken) : on réutilise
 * activateFromParticipantUrl(), qui fait déjà GET public/:token →
 * activateSharedListContext (le backend dérive is_creator via soft-auth,
 * cf. group-api.js) — même chemin que le destinataire, isCreator=true.
 */
function reopenOwnSharedListInCanonicalCart() {
  if (!state.shareToken) return;
  import('./group/group-side-cart.js').then(({ activateFromParticipantUrl }) => {
    activateFromParticipantUrl(state.shareToken);
  });
}

/**
 * P0-B (audit — le partage recréait une liste alors qu'une liste existait)
 * — « une liste active = LE panier » : tant qu'une liste ouverte existe,
 * TOUT clic sur « Partager » (bouton normal ou « Re-partager ») repartage
 * son lien existant, jamais une création silencieuse. state.sharedListContext
 * (group-side-cart.js) est la source vivante la plus à jour — mise à jour
 * par refreshSharedListContext() y compris après une fermeture — donc
 * prioritaire ; state.shareToken/shareStatus (restauration synchrone,
 * cf. P0-A) sert de repli pendant la fenêtre où activateCartInCanonicalSurface()
 * n'a pas encore résolu.
 */
function hasActiveList() {
  if (state.sharedListContext?.token) {
    return state.sharedListContext.status === 'open';
  }
  return !!state.shareToken && state.shareStatus === 'open';
}

/* ── Flow principal ─────────────────────────────────────────────── */

export async function startShareFlow({ reshare = false } = {}) {
  // Éviter la race entre restauration /mine et action utilisateur.
  if (_restorePromise) {
    await _restorePromise;
    _restorePromise = null;
  }

  // Le repartage porte sur la liste existante et ne dépend pas du panier
  // local — déclenché explicitement (bouton « Re-partager ») ou implicitement
  // dès qu'une liste ouverte est déjà active (doctrine §4/§9 : Partager =
  // repartager, jamais recréer).
  if ((reshare || hasActiveList()) && state.shareToken) {
    const shareUrl = state.shareUrl
      || `${window.location.origin}/boutique/?p=${state.shareToken}`;
    await shareList(state.cartName || DEFAULT_LIST_TITLE, shareUrl);
    return;
  }

  if (!state.cart?.length) {
    showToast("Ajoutez d'abord des produits au panier.", 'error');
    return;
  }

  // Aucune modale de configuration : l'identité est le seul prérequis.
  const identity = await requireIdentity({
    reason: 'partager cette liste',
    title: 'Sécuriser votre liste',
  });
  if (!identity) return;

  setShareButtonsBusy(true);

  try {
    const data = await createSharedCart();
    const shareUrl = data.share_url
      || `${window.location.origin}/boutique/?p=${data.token}`;
    const title = data.title || DEFAULT_LIST_TITLE;

    const cart = {
      id: data.shared_cart_id,
      token: data.token,
      share_url: shareUrl,
      title,
      status: data.status || 'open',
      created_at: new Date().toISOString(),
    };

    // Poser le contexte avant de vider le panier : cart:cleared ne doit pas
    // supprimer la liste qui vient d'être créée.
    applyCartToState(cart);
    refreshSharedBadges(true);
    showBanner({
      title,
      status: cart.status,
    });

    if (data.clear_local_cart !== false) {
      _skipClearShareOnCartCleared = true;
      clearCart();
      _skipClearShareOnCartCleared = false;
    }

    showToast('Liste créée. Le lien est prêt à être partagé.', 'success');

    // Le canal appartient à l'utilisateur : feuille native si disponible,
    // WhatsApp + copie du lien comme fallback universel.
    await shareList(title, shareUrl);
    openSharedListInCanonicalCart(cart);
  } catch (err) {
    showToast(`Erreur : ${err.message}`, 'error');
  } finally {
    _skipClearShareOnCartCleared = false;
    setShareButtonsBusy(false);
  }
}

async function handleShareClick() {
  return startShareFlow({ reshare: false });
}

/* ── Installation ───────────────────────────────────────────────── */

let _installed = false;
let _restorePromise = null;
let _skipClearShareOnCartCleared = false;

export function install() {
  if (_installed) return;
  _installed = true;

  loadShareState();

  if (state.shareToken) {
    refreshSharedBadges(true);
    refreshBanner();
  } else {
    refreshSharedBadges(false);
  }

  _restorePromise = restoreSharedCartFromBackend({ silent: true });

  document.getElementById('k-cart-share')?.addEventListener('click', handleShareClick);
  document.getElementById('k-sc-share')?.addEventListener('click', handleShareClick);

  document.getElementById('k-cart-reshare')?.addEventListener('click', () =>
    startShareFlow({ reshare: true }));
  document.getElementById('k-sc-reshare')?.addEventListener('click', () =>
    startShareFlow({ reshare: true }));

  document.getElementById('k-sc-group-view')?.addEventListener('click', reopenOwnSharedListInCanonicalCart);

  document.addEventListener('cart:cleared', () => {
    if (_skipClearShareOnCartCleared) return;
    clearShareState();
    refreshSharedBadges(false);
  });
}
