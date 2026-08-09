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
import { showKomerceConfirm } from './group/group-side-cart.js';
import { refreshGroupBadge } from './group/group-state.js';
import { showBanner, hideBanner, refreshBanner } from './b-group-banner.js';
import { requireIdentity } from './b-identity.js';
import { fetchWithTimeout } from './group/group-api.js';
import { sharedListDisplayLabel } from './group/group-list-labels.js';

const API_CREATE = '/api/shared-carts/from-cart-items';
const API_MINE = '/api/shared-carts/mine';
// Doctrine finale (§9) — une liste CLOSED (ou CANCELLED) n'est plus la
// liste active opérationnelle : elle reste consultable depuis « Mes
// listes » mais ne doit ni se restaurer automatiquement comme panier au
// prochain boot, ni bloquer la création d'une nouvelle liste, ni
// afficher le badge/bandeau « actif ». Seul 'open' qualifie.
const ACTIVE_STATUSES = new Set(['open']);
const DEFAULT_LIST_TITLE = 'Ma liste';
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
    // P0 — cette activation DOIT être awaited : restoreSharedCartFromBackend()
    // est utilisé comme garantie synchrone (_restorePromise dans install(),
    // attendu par startShareFlow() avant toute décision de partage/création).
    // Sans ce await, la promesse se résolvait avant que le side cart/drawer
    // canonique soit réellement activé — une racecondition, pas seulement un
    // détail de timing : tout code qui attend restoreSharedCartFromBackend()
    // pour considérer l'état UI restauré pouvait agir sur un state.cartSurface
    // encore 'personal' alors que le cart existe déjà côté serveur (silent=
    // true : n'ouvre jamais de drawer, mais DOIT avoir posé
    // state.sharedListContext/state.cartSurface avant le resolve).
    await activateCartInCanonicalSurface(cart, { silent: true });

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
    // 409 open_list_exists — retourner l'objet structuré pour que
    // startShareFlow() propose « Ouvrir ma liste » (arbitrage A2).
    if (res.status === 409 && error.code === 'open_list_exists') {
      return { _statusCode: 409, ...error };
    }
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
    // Correctif archéologie (mandat §2) — une liste que l'organisateur a
    // explicitement quittée (×) pendant cette session de navigation ne
    // doit pas être automatiquement réactivée dans le side cart au
    // prochain boot silencieux (ce chemin, restoreSharedCartFromBackend).
    // Ne s'applique jamais à une activation explicite (silent=false,
    // ex. juste après publication) : à ce stade aucun × n'a encore pu être
    // cliqué sur cette liste.
    if (silent && sideCart.isDismissedSharedListToken(cart.token)) return;
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
  // L6 / P0-6 (mandat §10) — retourner la Promise : l'appelant doit pouvoir
  // await l'activation du slot AVANT la feuille de partage native, sinon
  // l'ordre "slot sélectionné → lien proposé" n'est pas garanti.
  return activateCartInCanonicalSurface(cart, { silent: false });
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
/**
 * P0 (audit — le partage repartageait A alors que B venait d'être ouverte
 * via « Mes listes ») — hasActiveList() savait déjà détecter la bonne liste
 * active via state.sharedListContext, mais startShareFlow() repartageait
 * ensuite state.shareToken/shareUrl/cartName sans jamais consulter ce
 * contexte : deux sources d'information, une seule consultée pour la
 * décision, l'autre pour l'action → mismatch. activeShareTarget() est
 * désormais l'unique source de vérité, utilisée à la fois pour détecter
 * QU'IL y a une liste active et pour fournir SES token/titre/URL.
 *
 * Priorité à state.sharedListContext : c'est la surface canonique vivante
 * (mise à jour par group-side-cart.js à chaque activation/rafraîchissement,
 * y compris après ouverture d'une liste tierce via « Mes listes »).
 * state.shareToken/shareUrl/cartName ne sert de repli que pendant la
 * fenêtre où activateCartInCanonicalSurface() n'a pas encore résolu après
 * une création/restauration par CE module.
 */
/**
 * É2 (2026-08) — source unique : sharedListContext est l'autorité.
 *
 * state.shareToken est maintenu synchronisé par group-side-cart.js
 * (activateSharedListContext / clearSharedListContext) pour les
 * consommateurs directs (b-group-banner.js, group-state.js) mais
 * n'est PLUS consulté ici pour décider quoi partager. La fenêtre de
 * désynchronisation entre applyCartToState (sync) et activateSharedListContext
 * (async, après GET) est couverte par _restorePromise : startShareFlow()
 * attend sa résolution avant toute décision.
 */
function activeShareTarget() {
  const ctx = state.sharedListContext;
  if (ctx?.token && ctx.status === 'open') {
    return {
      token: ctx.token,
      title: sharedListDisplayLabel(ctx),
      shareUrl: `${window.location.origin}/boutique/?p=${ctx.token}`,
    };
  }
  return null;
}

function hasActiveList() {
  return !!activeShareTarget();
}

/**
 * Repli utilisé UNIQUEMENT pour un reshare explicite (bouton
 * « Re-partager », visible seulement sur une liste déjà connue de
 * l'utilisateur) : fonctionne même si shareStatus n'a pas encore été
 * peuplé côté state.shareToken (comportement historique préservé). Ne
 * jamais utiliser ce repli pour la détection implicite hasActiveList() —
 * il ne vérifie pas que le token appartient à une liste encore 'open'.
 */
function legacyShareTarget() {
  if (!state.shareToken) return null;
  return {
    token: state.shareToken,
    title: state.cartName || DEFAULT_LIST_TITLE,
    shareUrl: state.shareUrl || `${window.location.origin}/boutique/?p=${state.shareToken}`,
  };
}

/* ── Flow principal ─────────────────────────────────────────────── */

/**
 * startShareFlow — point d'entrée unique pour le bouton du panier.
 *
 * Deux chemins strictement séparés (É7, contrat §9) :
 *
 *   A. REPARTAGER — une liste OPEN existe déjà (créée par moi ou reçue
 *      et affichée). On ne crée jamais une seconde liste : on repartage
 *      le lien de celle qui est active.
 *
 *   B. CRÉER — aucune liste OPEN affichée, panier non vide.
 *      Confirmation d'immutabilité AVANT le POST (É5, contrat §6).
 *      Séquence succès : snapshot créé → panier vidé → slot sélectionné
 *      → lien proposé (É8, contrat invariant 8).
 */
export async function startShareFlow({ reshare = false } = {}) {
  // Éviter la race entre restauration /mine et action utilisateur.
  if (_restorePromise) {
    await _restorePromise;
    _restorePromise = null;
  }

  // ── A. REPARTAGER ──────────────────────────────────────────────────
  // L2 / P0-2 (mandat §4) — la provenance de l'action décide du chemin,
  // jamais une déduction implicite à partir du seul sharedListContext :
  //
  //   surface 'shared-list'  → je regarde CETTE liste, "Partager" la repartage
  //   surface 'personal'     → "Créer une liste" doit TOUJOURS créer MA liste,
  //                            même si une liste reçue (ex. Fatima) est OPEN
  //                            en mémoire — jamais la repartager implicitement
  //
  // reshare=true (bouton dédié "Re-partager", visible seulement sur ma
  // propre liste déjà connue) reste un chemin A explicite indépendant de
  // la surface, via legacyShareTarget().
  const onSharedListSurface = state.cartSurface === 'shared-list';
  const target = (onSharedListSurface || reshare)
    ? (activeShareTarget() || (reshare ? legacyShareTarget() : null))
    : null;
  if (target) {
    await shareList(target.title, target.shareUrl);
    return;
  }

  // ── B. CRÉER — toujours MA liste depuis Mon panier ──────────────────
  if (!state.cart?.length) {
    showToast("Ajoutez d'abord des produits au panier.", 'error');
    return;
  }

  // L7 — modale Komerce native (primitive showKomerceConfirm depuis
  // group-side-cart.js). §5 (doctrine mise à jour) — message simplifié :
  // l'utilisateur n'a pas besoin de connaître la granularité technique
  // (articles/variantes/quantités figés) pour comprendre l'immutabilité.
  const confirmed = await showKomerceConfirm({
    title: 'Créer cette liste ?',
    body: 'Une fois partagée, cette liste ne sera plus modifiable.',
    confirmLabel: 'Créer la liste',
    cancelLabel: 'Annuler',
  });
  if (!confirmed) return;

  const identity = await requireIdentity({
    reason: 'créer cette liste',
    title: 'Sécuriser votre liste',
  });
  if (!identity) return;

  setShareButtonsBusy(true);

  try {
    const data = await createSharedCart();

    // Règle V1 — une liste OPEN existe déjà (race ou session parallèle).
    // Le backend renvoie 409 + existing_token pour que l'UX propose
    // « Ouvrir ma liste » plutôt qu'un mur (arbitrage A2).
    if (data?._statusCode === 409 && data?.code === 'open_list_exists') {
      // L7 — modale Komerce pour le conflit V1 (même primitive).
      const openIt = await showKomerceConfirm({
        title: 'Vous avez déjà une liste ouverte.',
        body: 'Fermez-la avant d\'en créer une nouvelle, ou ouvrez-la maintenant.',
        confirmLabel: 'Ouvrir ma liste',
        cancelLabel: 'Annuler',
      });
      if (openIt && data.existing_token) {
        const { activateFromParticipantUrl } = await import('./group/group-side-cart.js');
        await activateFromParticipantUrl(data.existing_token);
      }
      return;
    }

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

    // Poser le contexte AVANT de vider le panier : cart:cleared ne doit
    // pas supprimer la liste qui vient d'être créée.
    applyCartToState(cart);
    refreshSharedBadges(true);
    showBanner({ title, status: cart.status });

    if (data.clear_local_cart !== false) {
      _skipClearShareOnCartCleared = true;
      clearCart();
      _skipClearShareOnCartCleared = false;
    }

    showToast('Liste créée. Le lien est prêt à être partagé.', 'success');

    // É8 / L6 (mandat §10) — séquence correcte : slot sélectionné AVANT la
    // feuille de partage, réellement garantie par l'await (auparavant
    // fire-and-forget). La liste reste valide si l'utilisateur abandonne
    // la feuille (contrat §10).
    await openSharedListInCanonicalCart(cart);
    await shareList(title, shareUrl);

  } catch (err) {
    // Erreur réseau brute (fetch rejeté, JSON invalide...). Les erreurs
    // applicatives (409, 400) sont traitées dans createSharedCart() et
    // retournent un objet _statusCode, pas une exception.
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

  // L3 / P0-3 (mandat §5) — autorité de boot unique, ordre strict :
  //   1. ?p=token détecté par b-nav.js::handleParticipantUrl() (appelé
  //      juste avant install() dans boutique.js) → cette liste gagne,
  //      /mine ne doit JAMAIS l'écraser en résolvant après elle ;
  //   2. sinon → restoreSharedCartFromBackend (session persistée / mine).
  // Jamais les deux en parallèle : c'était la race d'origine.
  const participantToken = state._pendingParticipantToken;
  state._pendingParticipantToken = null;

  if (participantToken) {
    _restorePromise = import('./group/group-side-cart.js')
      .then(({ activateFromParticipantUrl }) => activateFromParticipantUrl(participantToken))
      .then(() => null);
  } else {
    _restorePromise = restoreSharedCartFromBackend({ silent: true });
  }

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
