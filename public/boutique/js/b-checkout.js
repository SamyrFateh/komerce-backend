/**
 * @komerce-arch
 * @role          boutique-checkout-orchestrator
 * @domain        checkout
 * @layer         ui-component
 * @criticality   critical
 * @inputs        checkout_selection, identity, phone, relais, payment_mode
 * @outputs       checkout_state, order_creation_request, payment_initialization, order_success
 * @depends       b-store.js, b-cart-core.js, b-cart.js, b-identity.js, b-checkout-render.js, b-phone.js, routes/orders.js, routes/payments.js
 * @used-by       boutique.js, b-nav.js, b-share-cart.js
 * @doctrine      paiement_seul_acte_engageant, otp_une_fois, recap_integre_checkout, surface_transactionnelle_unique, checkout_sans_friction
 * @impact-areas  checkout, orders, payments, otp, cart, shared-cart
 * @version       2026-06
 */
'use strict';

/**
 * @module b-checkout
 * @brief §11 CHECKOUT — Commande, paiement, wallet, order success
 *
 * Extrait de boutique.js — Option C Phase 8
 */

import { bus }           from './b-bus.js';
import { state, dom, $, $$, scroll }  from './b-store.js';
import { fmt, sanitize, genIdempotencyKey, apiGet, apiPost, optimizeImgUrl } from './b-utils.js';
import { showToast, saveCart } from './b-cart-core.js';
import { renderPayPalButton, isPayPalEnabled, ensurePayPalSDK } from './b-paypal.js'; // Migration 079
import { openCart, closeCart, renderCart, clearCart }  from './b-cart.js';
import { getScrollY, scrollToPosition, scrollPageToTop } from './b-scroll-owner.js';
import { requireIdentity, getCurrentIdentity, restoreIdentity, openIdentityModal }  from './b-identity.js';
import {
  renderFulfillmentSelector as _renderFulfillmentSelector,
  setCheckoutConfirmButton  as _setCheckoutConfirmButton,
  buildOrderSuccessDOM,
  renderStepHeader,
  makeInput                 as _makeInputRender,
  makePhoneInput            as _makePhoneInputRender,
} from './b-checkout-render.js';
import {
  digitsOnly as _digitsOnly,
  normalizeLocal as _normalizeLocal,
  prettifyLocal as _prettifyLocal,
  buildE164 as _buildE164,
  makeIntlPhoneInput as _makeIntlPhoneInput,
} from './b-phone.js';

// Stripe globals (initialized on demand)
let _stripe = (typeof window !== 'undefined' && window.Stripe) ? null : null;
let _stripeLoading = null;
let _stripeCard = null;
let _stripeElements = null;
const PAYMENT_PROVIDER_TIMEOUT_MS = 8000;

const CHECKOUT_FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

let _checkoutFocusOrigin = null;
let _checkoutBackgroundState = [];
let _checkoutKeydownHandler = null;

function _focusableWithin(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(CHECKOUT_FOCUSABLE)).filter(el =>
    !el.hidden && el.getAttribute('aria-hidden') !== 'true' && !el.closest('[inert]')
  );
}

function _trapTabWithin(event, root) {
  if (event.key !== 'Tab') return;
  const focusable = _focusableWithin(root);
  if (!focusable.length) {
    event.preventDefault();
    root?.focus?.();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function _activateCheckoutFocus() {
  const overlay = dom.orderModal;
  const dialog = overlay?.querySelector('.k-order-modal') || overlay;
  if (!overlay || !dialog) return;

  // Une nouvelle ouverture peut suivre un rerender/remplacement d'overlay
  // avant que l'ancienne surface ait reçu sa fermeture explicite. Purger ce
  // cycle sans restaurer son focus évite qu'un rAF tardif refocalise un ancien
  // bouton du checkout et écrase l'origine réelle de la nouvelle session.
  if (_checkoutKeydownHandler || _checkoutBackgroundState.length || _checkoutFocusOrigin) {
    _deactivateCheckoutFocus({ restoreFocus: false });
  }

  _checkoutFocusOrigin = document.activeElement;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'k-order-title');
  dialog.setAttribute('tabindex', '-1');

  _checkoutBackgroundState = Array.from(document.body.children)
    .filter(el => el !== overlay && !['SCRIPT', 'STYLE'].includes(el.tagName))
    .map(el => ({
      el,
      inert: !!el.inert,
      ariaHidden: el.getAttribute('aria-hidden'),
    }));
  _checkoutBackgroundState.forEach(({ el }) => {
    el.inert = true;
    el.setAttribute('aria-hidden', 'true');
  });

  const activeKeydownHandler = (event) => {
    if (document.querySelector('.ck-relais-overlay.is-open, .k-id-overlay')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeOrderModal();
      return;
    }
    _trapTabWithin(event, dialog);
  };
  _checkoutKeydownHandler = activeKeydownHandler;
  document.addEventListener('keydown', _checkoutKeydownHandler);
  requestAnimationFrame(() => {
    if (!overlay.classList.contains('open') || _checkoutKeydownHandler !== activeKeydownHandler) return;
    const initial = dialog.querySelector('.ck-modal-back-btn--header, #k-order-close')
      || _focusableWithin(dialog)[0]
      || dialog;
    initial.focus?.();
  });
}

function _deactivateCheckoutFocus({ restoreFocus = true } = {}) {
  if (_checkoutKeydownHandler) {
    document.removeEventListener('keydown', _checkoutKeydownHandler);
    _checkoutKeydownHandler = null;
  }
  _checkoutBackgroundState.forEach(({ el, inert, ariaHidden }) => {
    el.inert = inert;
    if (ariaHidden == null) el.removeAttribute('aria-hidden');
    else el.setAttribute('aria-hidden', ariaHidden);
  });
  _checkoutBackgroundState = [];
  const origin = _checkoutFocusOrigin;
  _checkoutFocusOrigin = null;
  if (restoreFocus && origin?.isConnected) origin.focus?.();
}

// ── Helpers téléphone — délégués à b-phone.js (source de vérité) ─
export function digitsOnly(v)           { return _digitsOnly(v); }
export function normalizeLocal(c, d)    { return _normalizeLocal(c, d); }
export function prettifyLocal(r, co)    { return _prettifyLocal(r, co); }
export function buildE164(code, raw)    { return _buildE164(code, raw); }

/**
 * Vue canonique de ce qui doit être finalisé.
 *
 * Lot 2B : CheckoutSelection est la source de vérité transactionnelle.
 * state.cart n'est lu qu'à l'entrée d'un checkout de panier personnel.
 */
export function buildCheckoutSelection(
  items = state.cart,
  context = state.checkoutDisplayContext
) {
  const normalizedItems = Array.isArray(items)
    ? items.filter(Boolean).map(item => ({
        ...item,
        qty: Number(item.qty ?? item.quantity ?? 1) || 1,
      }))
    : [];

  const total = normalizedItems.reduce((sum, item) => {
    const product = item.product || {};
    const price = Number(
      item.price ??
      product.price_kmf ??
      product.price ??
      0
    ) || 0;

    return sum + (price * item.qty);
  }, 0);

  const shared = context?.origin === 'SHARED_LIST';

  return {
    source: shared ? 'shared-list' : 'personal-cart',
    sourceId: shared ? (context.sharedCartId || null) : null,
    items: normalizedItems,
    total,
  };
}



function _currentCheckoutSelection() {
  const selection = state.orderData?.checkoutSelection;

  if (selection && Array.isArray(selection.items)) {
    return selection;
  }

  return buildCheckoutSelection();
}

function _checkoutItemIncluded(item) {
  return item?.checkout_included !== false;
}

function _checkoutSelectionTotal(items = []) {
  return items.reduce((sum, item) => {
    if (!_checkoutItemIncluded(item)) return sum;

    const product = item?.product || {};
    const price = Number(
      item?.price ??
      product.price_kmf ??
      product.price ??
      0
    ) || 0;
    const qty = Number(item?.qty ?? item?.quantity ?? 1) || 1;

    return sum + (price * qty);
  }, 0);
}

function _checkoutItems() {
  return _currentCheckoutSelection().items.filter(_checkoutItemIncluded);
}

function _checkoutTotal() {
  return _checkoutSelectionTotal(_currentCheckoutSelection().items);
}

/**
 * Après succès :
 * - liste partagée : ne touche jamais la liste publiée ;
 * - panier personnel : retire uniquement les lignes réellement cochées.
 */
function _clearCommittedCheckoutSource() {
  const selection = _currentCheckoutSelection();
  if (selection.source !== 'personal-cart') return;

  const remaining = selection.items
    .filter(item => !_checkoutItemIncluded(item))
    .map(item => {
      const clean = { ...item };
      delete clean.checkout_included;
      return clean;
    });

  if (!remaining.length) {
    clearCart();
    return;
  }

  state.cart = remaining;
  saveCart();
  renderCart();
}

async function ensureStripe() {
  if (_stripe) return _stripe;
  if (_stripeLoading) return _stripeLoading;

  const withTimeout = (promise, message) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), PAYMENT_PROVIDER_TIMEOUT_MS);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });

  _stripeLoading = (async () => {
    if (typeof window.Stripe !== 'function') {
      await withTimeout(new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-k-stripe-sdk]');
        const s = existing || document.createElement('script');
        s.dataset.kStripeSdk = '1';
        s.src = 'https://js.stripe.com/v3/';
        s.addEventListener('load', resolve, { once: true });
        s.addEventListener('error', () => reject(new Error('Chargement SDK Stripe échoué')), { once: true });
        if (!existing) document.head.appendChild(s);
      }), 'Délai de chargement du SDK Stripe dépassé');
    }
    const cfg = await withTimeout(
      apiGet('/api/public/config'),
      'Délai de chargement de la configuration Stripe dépassé'
    );
    const key = cfg && cfg.stripe_public_key;
    if (key && typeof window.Stripe === 'function') {
      _stripe = window.Stripe(key);
    }
    return _stripe;
  })().catch((e) => {
    console.warn('[Stripe] init failed:', e.message || e);
    _stripeLoading = null;
    return null;
  });

  return _stripeLoading;
}



  // ║  §11 · CHECKOUT — Commande, paiement, wallet, order success      ║
  // ╚══════════════════════════════════════════════════════════════════╝
  //  → Futur module: b-checkout.js

  /**
   * @brief checkoutCart — Lance le flow de commande depuis le panier
   * Prérequis : panier non vide (sinon toast error)
   * Ferme le tiroir panier, initialise state.orderData, affiche renderCheckout()
   */
export function checkoutCart(checkoutSelection = null) {
    const selection = checkoutSelection && Array.isArray(checkoutSelection.items)
      ? checkoutSelection
      : checkoutSelection && Array.isArray(checkoutSelection.lines)
        ? buildCheckoutSelection(checkoutSelection.lines, checkoutSelection.context)
      : buildCheckoutSelection();

    if (!selection.items.length) {
      showToast('Votre panier est vide.', 'error');
      return;
    }
    // FIX 2026-05-19 : si on commande depuis la fiche produit Temu, fermer d'abord
    // la modale produit. Sans ça, deux overlays s'empilent (k-modal-overlay +
    // k-order-modal) ce qui casse le scroll et laisse la fiche produit visible
    // en arrière-plan derrière le formulaire de commande.
    if (dom.modalOverlay && dom.modalOverlay.classList.contains('open')) {
      bus.emit('modal:close');
    }
    closeCart();

    state.orderData = {
      payment_mode: 'cash_relais',
      checkoutSelection: selection,
    };

    // Une seule surface transactionnelle :
    // le récapitulatif fait partie du checkout.
    renderCheckout();
    dom.orderModal.classList.add('open');
    scroll.savedY = getScrollY();
    document.body.classList.add('cart-open');
    // FIX : masquer bnav pour voir bouton Payer
    const bnav = document.getElementById('k-bnav');
    if (bnav) {
      bnav.classList.add('u-hidden');
    }
    _activateCheckoutFocus();

    // Le clic sur le fond reste une sortie explicite, sans listener `once`
    // consommé par un clic interne au formulaire.
    dom.orderModal.onclick = (event) => {
      if (event.target === dom.orderModal) closeOrderModal();
    };
  }

  /**
   * Ferme et détruit le modal de confirmation de commande.
   */
export function closeOrderModal() {
    dom.orderModal.classList.remove('open');
    _deactivateCheckoutFocus();
    document.body.classList.remove('cart-open');
    // FIX : restaurer bnav
    const bnav = document.getElementById('k-bnav');
    if (bnav) {
      bnav.classList.remove('u-hidden');
    }
    if (scroll.savedY) {
      scrollToPosition(scroll.savedY);
      scroll.savedY = 0;
    }
  }

  /**
   * Rend l'interface complète de passage de commande (récap + formulaire contact + paiement).
   * Gère les étapes : validation panier → saisie infos → confirmation.
   */
let _relaisAbortController = null;

/* ── State machine relais (FIX 2026-07-10) ──────────────────────────
 * relayStatus : 'idle' | 'loading' | 'ready' | 'error' | 'empty'
 * Règles métier verrouillées par refreshCheckoutComputedUI + submitOrder :
 *   - cash_relais exige un relais → Confirmer désactivé tant que
 *     relayStatus !== 'ready' OU selectedRelaisId absent.
 *   - erreur/vide : message lisible + bouton Réessayer (ne touche PAS au panier).
 */
function setRelayStatus(od, status) {
  od.relayStatus = status;
  refreshCheckoutComputedUI();
}

async function _loadRelaisSection(container, od) {
  // Abort toute requête relais précédente encore en cours
  if (_relaisAbortController) _relaisAbortController.abort();
  _relaisAbortController = new AbortController();
  const signal = _relaisAbortController.signal;
  setRelayStatus(od, 'loading');
  container.innerHTML = '<div class="ck-relais-loading">Chargement du relais…</div>';
  try {
    const data = await apiGet('/api/relais', { signal });
    let list = Array.isArray(data) ? data : (data.relais || data.data || []);
    // Filtre nom-based test/e2e/staging retiré (2026-07-30) : il tournait pour
    // tous les environnements et masquait aussi les relais E2E légitimement
    // actifs sur staging. La source de vérité pour "ce relais doit apparaître"
    // est is_active en DB (déjà filtré par routes/relais.js : WHERE is_active
    // = TRUE) — à gérer par environnement côté DB, pas par regex sur le nom.
    if (!list.length) {
      container.innerHTML = '<div class="ck-relais-empty">Aucun relais disponible</div>';
      setRelayStatus(od, 'empty');
      return;
    }

    // 1 relais par île : on retient le premier visible de chaque groupe.
    const byIle = {};
    list.forEach(r => {
      const ile = classifyRelayGroup(r);
      const hay = [r.name, r.nom, r.address, r.adresse, r.location].filter(Boolean).join(' ').toLowerCase();
      if (hay.includes('domoni')) return;          // filtre historique
      if (!byIle[ile]) byIle[ile] = r;             // 1 seul relais / île
    });
    const allIles = getRelayGroupOrder(Object.keys(byIle));
    if (!allIles.length) {
      container.innerHTML = '<div class="ck-relais-empty">Aucun relais disponible</div>';
      setRelayStatus(od, 'empty');
      return;
    }

    _ensureRelaisSelection(od, byIle, allIles);
    _renderRelaisSummary(container, od, byIle, allIles);
    setRelayStatus(od, 'ready');
  } catch(e) {
    if (e && e.name === 'AbortError') return;
    // Erreur / timeout : état erreur lisible + Réessayer.
    // Le retry recharge UNIQUEMENT la section relais — le panier est intact.
    container.innerHTML =
      '<div class="ck-relais-error">Impossible de charger les relais'
      + '<button type="button" class="ck-relais-retry" id="ck-relais-retry">Réessayer</button></div>';
    container.querySelector('#ck-relais-retry')?.addEventListener('click', () => {
      _loadRelaisSection(container, od);
    });
    setRelayStatus(od, 'error');
    console.warn('[checkout] relais:', e);
  }
}

/** Garantit une sélection cohérente (relais déjà choisi, sinon 1ʳᵉ île de la zone). */
function _ensureRelaisSelection(od, byIle, allIles) {
  if (od.selectedRelaisId) {
    for (const ile of allIles) {
      if (byIle[ile] && byIle[ile].id === od.selectedRelaisId) {
        od.selectedIsland     = ile;
        od.fulfillment_zone   = (ile === 'France') ? 'france' : 'comoros';
        od.selectedRelaisName = byIle[ile].name || byIle[ile].nom || '';
        return;
      }
    }
  }
  const zone = od.fulfillment_zone || 'comoros';
  const inZone = allIles.filter(i => zone === 'france' ? i === 'France' : i !== 'France');
  const pick = inZone[0] || allIles[0];
  const r = byIle[pick];
  od.selectedIsland     = pick;
  od.fulfillment_zone   = (pick === 'France') ? 'france' : 'comoros';
  od.selectedRelaisId   = r.id;
  od.selectedRelaisName  = r.name || r.nom || '';
}

/** Ligne compacte « 📍 Nom du relais · Île · Pays » + lien Changer → ouvre le picker.
 * Mock (règle §2) : résumé compact, pas de pastille d'étape ni de drapeau
 * dans le libellé — le drapeau reste porté par le picker lui-même
 * (_openRelaisPicker), pas par le résumé replié. */
function _renderRelaisSummary(container, od, byIle, allIles) {
  container.classList.remove('is-error');
  const zone = od.fulfillment_zone === 'france' ? 'France' : 'Comores';
  container.innerHTML = '';
  const header = renderStepHeader({
    state:    'done',
    icon:     '📍',
    label:    getRelayDisplayName(od.selectedRelaisName),
    sublabel: (od.selectedIsland || '') + ' · ' + zone,
    onChange: () => {
      _openRelaisPicker(od, byIle, allIles, () => {
        clearRelaySelectionError();
        _renderRelaisSummary(container, od, byIle, allIles);
        refreshCheckoutComputedUI();
      });
    },
  });
  header.id = 'ck-relais-summary';
  header.classList.add('ck-relais-summary');
  container.appendChild(header);
}

/** Titre statique de la section paiement (règle §4 — jamais « régler le
 * solde » / « reste à régler »). Purement décoratif, ne se re-rend jamais :
 * contrairement à l'ancien résumé « PAIEMENT · <moyen choisi> » (dérivé de
 * renderStepHeader, pastille "current"), ce n'est pas une étape à valider —
 * le moyen sélectionné est déjà visible sur les puces ck-pay-chip
 * elles-mêmes (classe --active), pas besoin de le répéter en toute-lettres
 * au-dessus. */
function _renderPaymentHeader(container) {
  container.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'ck-section-title';
  title.textContent = 'Comment payer ?';
  container.appendChild(title);
}

/** Feuille pays → île, relais auto. Remplace renderFulfillmentSelector + chips d'îles. */
function _openRelaisPicker(od, byIle, allIles, onDone) {
  const islandsComoros = allIles.filter(i => i !== 'France');
  const hasFrance = allIles.includes('France');
  const draft = { zone: od.fulfillment_zone || 'comoros', island: od.selectedIsland || null };
  if (draft.zone === 'france') draft.island = 'France';
  else if (!islandsComoros.includes(draft.island)) draft.island = islandsComoros[0] || null;

  const relOf = () => draft.zone === 'france' ? byIle['France'] : byIle[draft.island];

  const ov = document.createElement('div');
  ov.className = 'ck-relais-overlay';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-label', 'Choisir un point de retrait');
  ov.setAttribute('tabindex', '-1');

  const focusOrigin = document.activeElement;
  const checkoutDialog = dom.orderModal?.querySelector('.k-order-modal');
  const checkoutWasInert = !!checkoutDialog?.inert;
  if (checkoutDialog) checkoutDialog.inert = true;
  let closed = false;

  function focusPicker(selector) {
    requestAnimationFrame(() => {
      const target = (selector && ov.querySelector(selector))
        || ov.querySelector('.ck-relais-sheet-x')
        || _focusableWithin(ov)[0]
        || ov;
      target.focus?.();
    });
  }

  function close() {
    if (closed) return;
    closed = true;
    ov.classList.remove('is-open');
    if (checkoutDialog) checkoutDialog.inert = checkoutWasInert;
    setTimeout(() => ov.remove(), 280);
    if (focusOrigin?.isConnected) requestAnimationFrame(() => focusOrigin.focus?.());
  }

  function paint() {
    const isFr = draft.zone === 'france';
    const r = relOf();
    ov.innerHTML =
      '<div class="ck-relais-sheet">'
      + '<div class="ck-relais-grab" aria-hidden="true"></div>'
      + '<div class="ck-relais-sheet-top"><span class="ck-relais-sheet-title">📍 Point de retrait</span>'
      +   '<button type="button" class="ck-relais-sheet-x" aria-label="Fermer">✕</button></div>'
      + '<div class="ck-relais-sheet-body">'
      +   (hasFrance
            ? '<div class="ck-relais-step"><span class="ck-relais-step-n">1</span> Pays</div>'
              + '<div class="ck-relais-country">'
              +   '<button type="button" data-zone="comoros" class="' + (isFr ? '' : 'on') + '">🇰🇲 Comores</button>'
              +   '<button type="button" data-zone="france" class="' + (isFr ? 'on' : '') + '">🇫🇷 France</button>'
              + '</div>'
            : '')
      +   (isFr ? ''
            : '<div class="ck-relais-step"><span class="ck-relais-step-n">' + (hasFrance ? '2' : '1') + '</span> Île</div>'
              + '<div class="ck-relais-iles">'
              +   islandsComoros.map(i => '<button type="button" data-ile="' + sanitize(i) + '" class="' + (draft.island === i ? 'on' : '') + '">' + sanitize(i) + '</button>').join('')
              + '</div>')
      +   (r
            ? '<div class="ck-relais-auto"><span class="ck-relais-auto-ok" aria-hidden="true">✓</span>'
              + '<span class="ck-relais-auto-body"><span class="ck-relais-auto-name">' + sanitize(getRelayDisplayName(r.name || r.nom || '')) + '</span>'
              + (r.address || r.adresse || r.location ? '<span class="ck-relais-auto-addr">' + sanitize(r.address || r.adresse || r.location) + '</span>' : '')
              + '</span></div>'
              + '<div class="ck-relais-auto-cap">Un seul relais par ' + (isFr ? 'zone' : 'île') + ' — sélectionné automatiquement.</div>'
            : '<div class="ck-relais-empty">Aucun relais disponible</div>')
      +   '<button type="button" class="ck-relais-sheet-cta"' + (r ? '' : ' disabled') + '>Valider'
      +     (isFr ? ' France' : (draft.island ? ' ' + sanitize(draft.island) : '')) + '</button>'
      + '</div></div>';

    ov.querySelector('.ck-relais-country')?.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      draft.zone = b.dataset.zone;
      if (draft.zone === 'france') draft.island = 'France';
      else if (!islandsComoros.includes(draft.island)) draft.island = islandsComoros[0] || null;
      paint();
      focusPicker('[data-zone="' + draft.zone + '"]');
    });
    ov.querySelector('.ck-relais-iles')?.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      draft.island = b.dataset.ile; paint();
      focusPicker('[data-ile="' + draft.island + '"]');
    });
    ov.querySelector('.ck-relais-sheet-x').addEventListener('click', close);
    ov.querySelector('.ck-relais-sheet-cta').addEventListener('click', () => {
      const sel = relOf(); if (!sel) return;
      od.fulfillment_zone   = draft.zone;
      od.selectedIsland     = draft.zone === 'france' ? 'France' : draft.island;
      od.selectedRelaisId   = sel.id;
      od.selectedRelaisName = sel.name || sel.nom || '';
      close();
      onDone && onDone();
    });
  }

  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  ov.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    _trapTabWithin(event, ov);
  });
  document.body.appendChild(ov);
  paint();
  requestAnimationFrame(() => {
    ov.classList.add('is-open');
    focusPicker();
  });
}

function classifyRelayGroup(relais) {
  const haystack = [
    relais.country,
    relais.country_name,
    relais.island,
    relais.ile,
    relais.island_name,
    relais.zone,
    relais.name,
    relais.address,
    relais.adresse,
    relais.location,
  ].filter(Boolean).join(' ').toLowerCase();

  if (haystack.includes('france') || haystack.includes('paris')) return 'France';
  if (haystack.includes('anjouan')) return 'Ndzouani';
  if (haystack.includes('grande comore') || haystack.includes('ngazidja') || haystack.includes('moroni')) return 'Ngazidja';
  if (haystack.includes('moh') || haystack.includes('fomboni')) return 'Mwali';
  return relais.island || relais.ile || relais.island_name || 'Comores';
}

function getRelayDisplayName(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const clean = raw.replace(/\s+\d{10,}(?:-[a-z0-9-]+)?$/i, '').trim();
  return clean || raw;
}

function getRelayGroupOrder(groups) {
  const order = ['Ndzouani', 'Ngazidja', 'Mwali', 'France', 'Comores'];
  return groups.slice().sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b, 'fr');
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

/* S3.1 — rendu délégué à b-checkout-render.js */
function renderFulfillmentSelector(container, od, onChange) {
  _renderFulfillmentSelector(container, od, onChange);
}

export function getDefaultPhoneCodeForZone(zone) {
  return zone === 'france' ? '+33' : '+269';
}

/** Le champ "suivi expéditeur" est toujours côté diaspora → +33 par défaut. */
function getDefaultSenderPhoneCode() {
  return '+33';
}

function clearRelaySelectionError() {
  document.getElementById('ck-relais-section')?.classList.remove('is-error');
}

function markRelaySelectionError() {
  document.getElementById('ck-relais-section')?.classList.add('is-error');
}

/* S3.1 — rendu délégué à b-checkout-render.js */
function setCheckoutConfirmButton(button, mainText, subText) {
  _setCheckoutConfirmButton(button, mainText, subText);
}

function refreshCheckoutComputedUI() {
  const confirmBtn = document.getElementById('btn-confirm-order');
  if (!confirmBtn) return;
  const od = state.orderData || {};
  const mode = document.querySelector('input[name="payment_mode"]:checked')?.value || od.payment_mode || 'cash_relais';
  const relayName = getRelayDisplayName(od.selectedRelaisName);
  const island    = od.selectedIsland || '';
  const where     = relayName ? (relayName + (island ? ' • ' + island : '')) : '';
  const total = _checkoutTotal();
  const cb = document.getElementById('cb-use-wallet');
  const walletApplied = (cb && cb.checked && state.walletBalance > 0) ? Math.min(state.walletBalance, total) : 0;
  const netAmount = total - walletApplied;

  const finalTotalLabel = document.getElementById('ck-final-total-label');
  const finalTotalAmount = document.getElementById('ck-final-total-amount');
  if (finalTotalLabel) {
    finalTotalLabel.textContent = walletApplied > 0
      ? 'Reste \u00e0 r\u00e9gler'
      : '\u00c0 r\u00e9gler';
  }
  if (finalTotalAmount) {
    finalTotalAmount.textContent = fmt(netAmount, 'KMF');
  }
  // Règle §8 (simplification checkout final, cf. mock) — un seul gabarit de
  // CTA, quel que soit le moyen de paiement ou l'usage du wallet : jamais
  // « Payer » (Stripe) ni « (net wallet) » (cash), toujours le même libellé
  // portant le montant net réellement dû (après déduction wallet).
  const mainText = '\u2713 Confirmer la commande · ' + fmt(netAmount, 'KMF');
  let subText = mode === 'stripe_eur'
    ? (where ? 'Carte via Stripe • ' + where : 'Carte via Stripe')
    : (where ? 'Cash au relais • ' + where : 'Cash au relais');

  // ── Verrou métier relais (FIX 2026-07-10) ────────────────────────
  // Un ordre (cash au relais OU stripe — le relais est toujours requis,
  // cf. submitOrder) ne doit JAMAIS être confirmable si les relais ne
  // sont pas chargés (ready) et qu'aucun relais n'est sélectionné.
  const relayStatus = od.relayStatus || 'idle';
  const relayOk = relayStatus === 'ready' && !!od.selectedRelaisId;
  const hasCheckoutItems = _checkoutItems().length > 0;

  if (!hasCheckoutItems && btn_busy(confirmBtn) === false) {
    subText = 'Sélectionnez au moins un article';
  } else if (!relayOk && btn_busy(confirmBtn) === false) {
    if (relayStatus === 'loading' || relayStatus === 'idle') subText = 'Chargement du relais…';
    else if (relayStatus === 'error') subText = 'Impossible de charger les relais';
    else if (relayStatus === 'empty') subText = 'Aucun relais disponible';
    else subText = 'Choisissez un point relais';
  }
  confirmBtn.disabled = !hasCheckoutItems || !relayOk || btn_busy(confirmBtn);
  confirmBtn.classList.toggle('is-disabled', confirmBtn.disabled);
  setCheckoutConfirmButton(confirmBtn, mainText, subText);
}

function btn_busy(btn) { return btn?.dataset?.busy === '1'; }

/** Ligne repliée « ✓ Nom · identifié » + Changer → réouvre la modale d'identité. */
function _buildIdentityHeader(identity) {
  const name  = identity.full_name || identity.name || '';
  const phone = identity.phone || '';
  const header = renderStepHeader({
    state:    'done',
    icon:     '👤',
    label:    name || phone,
    sublabel: 'identifié' + (name && phone ? ' · ' + phone : ''),
    onChange: async () => {
      const newUser = await openIdentityModal({ reason: 'changer d\u2019identité', title: 'Utiliser un autre numéro', phone: '' });
      if (newUser) {
        state.user = newUser;
        header.replaceWith(_buildIdentityHeader(newUser));
      }
    },
  });
  header.id = 'ck-identity-recap';
  header.classList.add('ck-identity-summary');
  return header;
}

/**
 * Correctif V2-E §2/§3 — recap de variation de prix pour un checkout issu
 * d'une liste partagée. Purement informatif : n'ouvre aucune modale, ne
 * bloque jamais la confirmation. Absent si aucune ligne n'a de contexte
 * liste, ou si aucune ligne n'a réellement changé de prix (doctrine §3 :
 * rien à afficher si snapshot absent/nul, prix actuel absent, ou prix
 * identiques). Le total (_checkoutTotal(), en dehors de ce bloc) utilise
 * toujours le prix catalogue actuel, avec ou sans variation.
 */
function _renderPriceVariationRecap(body) {
  const selection = _currentCheckoutSelection();
  const variations = Array.isArray(selection.priceVariations)
    ? selection.priceVariations
    : [];

  if (!variations.length) return;

  const summary = selection.priceVariationSummary || null;
  const box = document.createElement('div');
  box.className = 'ck-section-block ck-price-variation-recap';
  box.id = 'ck-price-variation-recap';

  const lines = variations.map(v => (
    '<div class="ck-price-variation-line">'
      + '<span class="ck-price-variation-name">' + sanitize(v.name) + '</span>'
      + '<span class="ck-price-variation-caption">Prix actualisé depuis le partage</span>'
      + '<span class="ck-price-variation-prices">'
        + '<s>' + fmt(v.snapshotPrice, 'KMF') + '</s>'
        + ' → '
        + '<strong>' + fmt(v.currentPrice, 'KMF') + '</strong>'
      + '</span>'
    + '</div>'
  )).join('');

  box.innerHTML = '<div class="ck-price-variation-summary">' + sanitize(summary) + '</div>' + lines;
  body.appendChild(box);
}

/**
 * Mandat §7/§8 — bloc lecture seule des lignes de la commande + total.
 * Fonction pure : reçoit les lignes de CheckoutSelection, quelle que soit
 * leur provenance. shared_cart_item_id reste une donnée du contrat de
 * commande, jamais une décision d'affichage.
 * Aucun retrait, aucune modification de quantité, aucun `<input>`. Le
 * marqueur par ligne (`.ck-recap-check`) n'est PAS une checkbox — non
 * focusable, non cliquable, `aria-hidden`, avec un texte accessible
 * ("Inclus dans cette commande") porté séparément sur la ligne
 * (`.sr-only`), jamais un contrôle de formulaire fictif.
 *
 * Doctrine checkout unifié (2026-08) — ce bloc est la projection lecture
 * seule de CheckoutSelection. Il vit dans la même surface que l'identité,
 * le retrait et le paiement : le récapitulatif n'est plus une étape ni
 * une confirmation intermédiaire.
 * @returns {HTMLElement|null} null si le panier est vide (ne devrait pas
 *   arriver ici, mais défensif — jamais de section vide dans le DOM).
 */
function _setCheckoutLineIncluded(index, included) {
  const current = _currentCheckoutSelection();
  if (!Array.isArray(current.items) || !current.items[index]) return;

  const nextItems = current.items.map((item, i) => (
    i === index
      ? { ...item, checkout_included: !!included }
      : item
  ));

  state.orderData.checkoutSelection = {
    ...current,
    items: nextItems,
    total: _checkoutSelectionTotal(nextItems),
  };

  // Toute modification de sélection invalide une tentative de
  // paiement construite pour l'ancienne sélection.
  state.checkoutAttemptKey = null;
  state.pendingStripeOrderRef = null;
  state.pendingPaypalOrderRef = null;

  refreshCheckoutComputedUI();
  updateWalletDisplay();
}

function _recapSelectionSummary(items) {
  const totalQty = items.reduce(
    (sum, item) => sum + (Number(item.qty || 1) || 1),
    0
  );

  const selectedQty = items.reduce(
    (sum, item) => _checkoutItemIncluded(item)
      ? sum + (Number(item.qty || 1) || 1)
      : sum,
    0
  );

  if (selectedQty === totalQty) {
    return totalQty + ' article' + (totalQty > 1 ? 's' : '');
  }

  if (selectedQty === 0) return 'Aucun article sélectionné';

  return selectedQty
    + ' article' + (selectedQty > 1 ? 's' : '')
    + ' sélectionné' + (selectedQty > 1 ? 's' : '')
    + ' sur ' + totalQty;
}

function _buildRecapItemsBlock(items) {
  if (!Array.isArray(items) || !items.length) return null;

  const wrap = document.createElement('section');
  wrap.className = 'ck-recap-step';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'ck-recap-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'ck-recap-content');
  toggle.innerHTML =
    '<span class="ck-recap-toggle-text">'
      + '<span class="ck-recap-toggle-label">Votre commande</span>'
      + '<span class="ck-recap-toggle-sub">'
        + _recapSelectionSummary(items)
      + '</span>'
    + '</span>'
    + '<span class="ck-recap-toggle-chevron" aria-hidden="true">\u203A</span>';

  const toggleSub = toggle.querySelector('.ck-recap-toggle-sub');

  const content = document.createElement('div');
  content.id = 'ck-recap-content';
  content.className = 'ck-recap-content';

  const list = document.createElement('div');
  list.className = 'ck-recap-items';

  items.forEach((it, index) => {
    const product = it.product || {};
    const imgSrc = product.image_url
      ? optimizeImgUrl(product.image_url, 128)
      : '';
    const unitPrice = it.price ?? product.price_kmf ?? product.price ?? 0;
    const qty = Number(it.qty || 1);
    const included = _checkoutItemIncluded(it);

    const row = document.createElement('div');
    row.className = included
      ? 'ck-recap-item'
      : 'ck-recap-item is-excluded';

    const picker = document.createElement('label');
    picker.className = 'ck-recap-item-select-wrap';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'ck-recap-item-select';
    checkbox.checked = included;
    checkbox.setAttribute(
      'aria-label',
      'Inclure ' + (product.name || 'cet article') + ' dans cette commande'
    );

    picker.appendChild(checkbox);
    row.appendChild(picker);

    if (imgSrc) {
      const image = document.createElement('img');
      image.className = 'ck-recap-item-img';
      image.src = imgSrc;
      image.alt = '';
      image.loading = 'lazy';
      image.addEventListener('error', () => {
        image.classList.add('ck-recap-item-img--empty');
      }, { once: true });
      row.appendChild(image);
    } else {
      const emptyImage = document.createElement('span');
      emptyImage.className = 'ck-recap-item-img ck-recap-item-img--empty';
      emptyImage.setAttribute('aria-hidden', 'true');
      row.appendChild(emptyImage);
    }

    const info = document.createElement('span');
    info.className = 'ck-recap-item-info';
    info.innerHTML =
      '<span class="ck-recap-item-name">' + sanitize(product.name || '') + '</span>'
      + '<span class="ck-recap-item-qty">'
      + qty + ' \u00D7 ' + fmt(unitPrice, 'KMF')
      + '</span>';

    const price = document.createElement('span');
    price.className = 'ck-recap-item-price';
    price.textContent = fmt(unitPrice * qty, 'KMF');

    row.append(info, price);

    checkbox.addEventListener('change', () => {
      _setCheckoutLineIncluded(index, checkbox.checked);
      row.classList.toggle('is-excluded', !checkbox.checked);

      if (toggleSub) {
        toggleSub.textContent = _recapSelectionSummary(
          _currentCheckoutSelection().items
        );
      }
    });

    list.appendChild(row);
  });

  content.appendChild(list);

  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(expanded));
    wrap.classList.toggle('is-expanded', expanded);
  });

  wrap.append(toggle, content);
  return wrap;
}

function _insertCheckoutIdentity(body, node) {
  const aside = body.querySelector('.ck-checkout-aside');

  if (aside) {
    const heading = aside.querySelector('.ck-checkout-heading');

    if (heading) {
      heading.insertAdjacentElement('afterend', node);
    } else {
      aside.insertBefore(node, aside.firstChild);
    }
    return;
  }

  const summary = body.querySelector('#ck-order-summary');

  if (summary) {
    summary.insertAdjacentElement('afterend', node);
  } else {
    body.insertBefore(node, body.firstChild);
  }
}

// renderCheckoutCompact supprimée — doublon de renderCheckout(), jamais activée (07/05/2026)
export function renderCheckout() {
    // Surface transactionnelle unique :
    // sélection + identité + retrait + paiement cohabitent.
    const body = dom.orderBody;
    body.innerHTML = '';
    body.classList.remove('k-order-body--recap');
    body.classList.add('k-order-body--checkout');
    body.parentElement.querySelectorAll('.ck-confirm-btn').forEach(b => b.remove());
    dom.orderTitle.innerHTML = '<button type="button" class="ck-modal-back-btn ck-modal-back-btn--header" aria-label="Retour">← Retour</button><span class="ck-order-title-text">Finaliser ma commande</span>';

    const od = state.orderData;

    if (!od.checkoutSelection) {
      od.checkoutSelection = buildCheckoutSelection();
    }

    if (!od.fulfillment_zone) od.fulfillment_zone = 'comoros';

    /*
     * LOT 3 — projection responsive uniquement.
     *
     * Mobile : les trois wrappers sont display:contents → ordre vertical
     * historique strictement conservé.
     *
     * Desktop : primary = matière commande ; aside = décision transactionnelle.
     * Aucun état, calcul, paiement ou lifecycle n'est dupliqué.
     */
    const checkoutLayout = document.createElement('div');
    checkoutLayout.className = 'ck-checkout-layout';

    const checkoutPrimary = document.createElement('section');
    checkoutPrimary.className = 'ck-checkout-primary';

    const checkoutPrimaryHeading = document.createElement('h2');
    checkoutPrimaryHeading.className = 'ck-checkout-desktop-heading';
    checkoutPrimaryHeading.textContent = 'Votre commande';
    checkoutPrimary.appendChild(checkoutPrimaryHeading);

    const checkoutAside = document.createElement('div');
    checkoutAside.className = 'ck-checkout-aside';

    const checkoutHeading = document.createElement('h2');
    checkoutHeading.className = 'ck-checkout-heading';
    checkoutHeading.textContent = 'Finaliser ma commande';
    checkoutAside.appendChild(checkoutHeading);

    checkoutLayout.append(checkoutPrimary, checkoutAside);
    body.appendChild(checkoutLayout);

    const headerBackBtn = dom.orderTitle.querySelector('.ck-modal-back-btn--header');

    if (headerBackBtn) {
      headerBackBtn.addEventListener('click', () => {
        closeOrderModal();

        setTimeout(() => {
          if (typeof openCart === 'function') openCart();
        }, 150);
      });
    }

    if (od.checkoutSelection.source === 'shared-list' && !od.checkoutSelection.items.length) {
      const empty = document.createElement('div');
      empty.className = 'ck-checkout-empty';
      empty.innerHTML =
        '<strong>Aucun article sélectionné pour ce paiement.</strong>'
        + '<span>Retournez à la liste pour choisir ce que vous souhaitez payer.</span>';
      checkoutPrimary.appendChild(empty);
      return;
    }

    // LOT 13 §F (doctrine checkout_logic_agnostic_of_shared_list) — bandeau
    // purement décoratif, jamais lu pour une décision (prix/lignes/OTP/
    // lifecycle restent ceux du checkout personnel standard). Alimenté
    // uniquement par group-checkout-adapter.js::checkoutSharedListSelection
    // via state.checkoutDisplayContext, effacé avec le checkout (jamais
    // persistant, jamais visible sur un checkout panier personnel).
    if (state.checkoutDisplayContext?.title) {
      const ctxBanner = document.createElement('div');
      ctxBanner.className = 'ck-shared-list-context-banner';
      ctxBanner.textContent = state.checkoutDisplayContext.title;
      checkoutPrimary.appendChild(ctxBanner);
    }

    const orderSummary = _buildRecapItemsBlock(od.checkoutSelection.items);

    if (orderSummary) {
      orderSummary.id = 'ck-order-summary';
      orderSummary.classList.add('ck-recap-step--embedded');
      checkoutPrimary.appendChild(orderSummary);
    }

    // Pays/zone (Comores/France) déplacé DANS le picker de relais (cf. _openRelaisPicker) :
    // il n'a pas sa place sur l'écran principal — il est le 1er cran du choix de retrait.

    // ── Bloc récap identité payeur (doctrine §9) ─────────────────────────────
    // Ligne repliée façon accordéon (parité visuelle avec le relais) : réutilise
    // renderStepHeader au lieu de la carte pleine buildIdentityRecapDOM, qui
    // restait toujours dépliée quel que soit l'état — écart repéré face à la
    // maquette (« Qui commande » tient sur une seule ligne, comme le relais).
    const _knownUser = getCurrentIdentity();
    if (_knownUser) {
      const idRecap = _buildIdentityHeader(_knownUser);
      _insertCheckoutIdentity(body, idRecap); // ligne en tête du checkout
    }
    // ── Fin récap identité ───────────────────────────────────────────────────

    // ── Restauration silencieuse de l'identité (cookie httpOnly kmrc_jwt) ────
    // Si getCurrentIdentity() n'a rien trouvé en mémoire, on interroge le
    // backend silencieusement (credentials: 'include' → le cookie httpOnly
    // kmrc_jwt est envoyé automatiquement par le navigateur, jamais lu par JS).
    // Si le backend confirme la session, on met à jour state.user puis on
    // affiche ou rafraîchit le bloc "Vous commandez avec…".
    // Aucun OTP n'est déclenché ici — requireIdentity() reste le garde-fou
    // au clic final de submitOrder().
    if (!_knownUser) {
      restoreIdentity().then(restoredUser => {
        if (!restoredUser) {
          // Cas SANS cookie (nouvel utilisateur) : invitation douce, informative,
          // non bloquante. L'OTP réel se déclenchera au clic « Confirmer ».
          if (!body.querySelector('#ck-identity-recap') && !body.querySelector('#ck-guest-hint')) {
            const hint = document.createElement('div');
            hint.id = 'ck-guest-hint';
            hint.className = 'k-ck-guest-hint';
            hint.innerHTML = '<span class="k-ck-guest-ic" aria-hidden="true">✍️</span>'
              + '<span><b>Première commande ?</b> Votre compte se crée en validant votre numéro WhatsApp.</span>';
            _insertCheckoutIdentity(body, hint);
          }
          return;
        }
        state.user = restoredUser;

        // Anti-doublon : si la ligne existe déjà (rendu concurrent), rien à refaire —
        // elle se reconstruit elle-même via son propre onChange (_buildIdentityHeader).
        if (body.querySelector('#ck-identity-recap')) return;

        // Construction + insertion EN TÊTE du body (fiable, indépendant de la
        // structure interne — on ne cherche plus un .k-ck-group qui peut manquer).
        const idRecap = _buildIdentityHeader(restoredUser);
        _insertCheckoutIdentity(body, idRecap); // toujours en haut
      }).catch(err => {
        // On n'avale plus silencieusement : une erreur réseau est normale (non
        // connecté), mais une erreur de construction DOM doit être visible.
        if (err && err.name !== 'TypeError') console.warn('[checkout] restauration identité:', err);
      });
    }
    // ── Fin restauration silencieuse ─────────────────────────────────────────

    // ── Variation de prix liste partagée (V2-E §2/§3) ─────────────────────────
    _renderPriceVariationRecap(checkoutAside);
    // ── Fin variation de prix ──────────────────────────────────────────────────

    // ── Retrait sécurisé (Lot 3 — remplace « Qui récupère ? ») ────────────────
    // Bloc informatif, non interactif : le code de retrait est envoyé au
    // WhatsApp vérifié de l'acheteur (identité OTP), qui le transmet ensuite
    // à qui il veut. Aucune identité de retrait distincte n'est collectée.
    // Lot accordéon : réduit à une ligne discrète en pied de formulaire
    // (l'ancien bloc titre+paragraphe en tête d'écran prenait trop de place
    // maintenant que identité/relais sont collapsés en une ligne chacun).
    const secureNotice = document.createElement('div');
    secureNotice.className = 'ck-secure-pickup-notice ck-secure-pickup-notice--footer';
    secureNotice.innerHTML =
      '<div class="ck-secure-pickup-title">🔒 Retrait sécurisé</div>'
      + '<div class="ck-secure-pickup-line">Le code de retrait sera envoyé sur votre WhatsApp vérifié '
      + 'lorsque votre commande sera prête. Vous pourrez le transmettre à la personne de votre choix.</div>'
      + '<span class="ck-secure-pickup-short">🔒 Code envoyé sur WhatsApp quand la commande est pr\u00eate</span>';
    // Insertion différée : appendChild plus bas, après le bloc paiement (cf. suite du fichier)

    // ── Destinataire du code de retrait — commande issue d'une liste reçue ─
    // Le contexte contient uniquement la relation avec l'organisateur, jamais
    // son téléphone. Le backend résout l'identité vérifiée depuis les lignes
    // shared_cart_item_id et applique réellement buyer|organizer.
    const sharedCheckoutContext = state.checkoutDisplayContext?.origin === 'SHARED_LIST'
      ? state.checkoutDisplayContext
      : null;
    const organizerLabel = sharedCheckoutContext && !sharedCheckoutContext.isCreator
      ? sharedCheckoutContext.creatorFirstName
      : null;
    let recipientBlock = null;
    if (organizerLabel) {
      od.pickupCodeRecipient = od.pickupCodeRecipient || 'buyer';
      recipientBlock = document.createElement('div');
      recipientBlock.className = 'ck-section-block ck-recipient-section';
      recipientBlock.innerHTML =
        '<div class="ck-section-title">Code de retrait</div>'
        + '<div class="ck-recipient-grid">'
        +   '<label class="ck-recipient-option' + (od.pickupCodeRecipient === 'buyer' ? ' is-active' : '') + '">'
        +     '<input type="radio" name="ck-pickup-recipient" value="buyer"' + (od.pickupCodeRecipient === 'buyer' ? ' checked' : '') + '>'
        +     '<span class="ck-recipient-copy"><strong>Me l\u2019envoyer</strong>'
        +       '<small>Sur mon WhatsApp quand la commande est prête</small></span>'
        +   '</label>'
        +   '<label class="ck-recipient-option' + (od.pickupCodeRecipient === 'organizer' ? ' is-active' : '') + '">'
        +     '<input type="radio" name="ck-pickup-recipient" value="organizer"' + (od.pickupCodeRecipient === 'organizer' ? ' checked' : '') + '>'
        +     '<span class="ck-recipient-copy"><strong>L\u2019envoyer à ' + sanitize(organizerLabel) + '</strong>'
        +       '<small>Organisateur de la liste</small></span>'
        +   '</label>'
        + '</div>';
      recipientBlock.addEventListener('change', (e) => {
        const input = e.target.closest('input[name="ck-pickup-recipient"]');
        if (!input) return;
        od.pickupCodeRecipient = input.value;
        recipientBlock.querySelectorAll('.ck-recipient-option').forEach(opt => {
          opt.classList.toggle('is-active', opt.querySelector('input').value === od.pickupCodeRecipient);
        });
      });
    }
    // ── Fin destinataire du code de retrait ──────────────────────────────────

    /* ── 2b. Point relais ── */
    const sRelais = document.createElement('div');
    sRelais.className = 'ck-section-block';
    checkoutAside.appendChild(sRelais);
    const relaisSection = document.createElement('div');
    relaisSection.id = 'ck-relais-section';
    relaisSection.className = 'ck-relais-section';
    relaisSection.innerHTML = '<div class="ck-relais-loading">⏳ Chargement des relais...</div>';
    checkoutAside.appendChild(relaisSection);
    _loadRelaisSection(relaisSection, od);

    /* ── 3. Wallet (règle §3 — précède le paiement dans le mock : son
       usage détermine le montant réellement dû, donc affiché avant le
       choix du moyen de paiement plutôt qu'après) ── */
    checkWalletBalance();
    const walletSection = document.createElement('div');
    walletSection.id = 'wallet-section';
    walletSection.className = 'k-wallet-section';
    walletSection.innerHTML = '<label class="k-wallet-label">'
      + '<input type="checkbox" id="cb-use-wallet" class="k-wallet-cb">'
      + '<div class="k-wallet-info"><div class="k-wallet-title">💰 Utiliser mon crédit</div>'
      + '<div id="wallet-balance-text" class="k-wallet-balance">Chargement…</div>'
      + '<div id="wallet-expiry-text" class="k-wallet-expiry-text"></div></div></label>'
      + '<div id="wallet-deduction" class="k-wallet-ded"></div>'
      + '<button type="button" id="wallet-goto-komerce" class="k-wallet-goto-komerce">Voir mon wallet dans Mon Komerce</button>';
    checkoutAside.appendChild(walletSection);
    // Lot 4 §5 — lien discret, jamais l'écran de gestion du wallet lui-même.
    document.getElementById('wallet-goto-komerce')?.addEventListener('click', () => {
      bus.emit('nav:goto-komerce-wallet');
      closeOrderModal();
    });

    /* ── 4. Paiement ── */
    const s2 = document.createElement('div');
    s2.className = 'ck-section-block ck-payment-section';
    const payHeaderSlot = document.createElement('div');
    payHeaderSlot.id = 'ck-payment-summary';
    _renderPaymentHeader(payHeaderSlot);
    s2.appendChild(payHeaderSlot);
    // Règle §3 — remplace intégralement le choix du moyen de paiement quand
    // le crédit wallet couvre déjà tout le montant dû (cf. mock : "✓ Votre
    // crédit couvre toute la commande."). Masqué par défaut ; basculé par
    // _togglePaymentMethodVisibility() (appelée depuis updateWalletDisplay,
    // seul endroit où le montant net peut changer). N'affecte jamais
    // od.payment_mode ni aucun invariant commande/paiement — décoration
    // pure d'une sélection qui reste en place (submitOrder() continue de
    // lire od.payment_mode normalement, cash_relais par défaut).
    const fullCoverMsg = document.createElement('div');
    fullCoverMsg.id = 'ck-wallet-full-cover-msg';
    fullCoverMsg.className = 'ck-wallet-full-cover-msg';
    fullCoverMsg.textContent = '✓ Votre crédit couvre toute la commande.';
    s2.appendChild(fullCoverMsg);
    checkoutAside.appendChild(s2);

    const payGrid = document.createElement('div');
    payGrid.id = 'ck-pay-grid';
    payGrid.className = 'ck-pay-grid';
    payGrid.innerHTML =
      '<label class="ck-pay-chip" id="ck-chip-cash">'
      + '<input type="radio" name="payment_mode" value="cash_relais" checked>'
      + '<span class="ck-chip-icon">🏪</span><span class="ck-chip-lbl">Cash</span>'
      + '</label>'
      + '<label class="ck-pay-chip ck-pay-chip--off">'
      + '<input type="radio" name="payment_mode" value="mvola" disabled>'
      + '<span class="ck-chip-icon">📱</span>'
      + '<span class="ck-chip-lbl">MVola<br><em class="ck-soon">Bientôt</em></span>'
      + '</label>'
      + '<label class="ck-pay-chip" id="ck-chip-stripe">'
      + '<input type="radio" name="payment_mode" value="stripe_eur">'
      + '<span class="ck-chip-icon">💳</span><span class="ck-chip-lbl">Carte<br><em class="ck-stripe-tag">Stripe</em></span>'
      + '</label>'
      + '<label class="ck-pay-chip" id="ck-chip-paypal" style="display:none;">' /* affiché si PayPal enabled */
      + '<input type="radio" name="payment_mode" value="paypal_eur">'
      + '<span class="ck-chip-icon">🅿️</span><span class="ck-chip-lbl">PayPal<br><em class="ck-stripe-tag">4× possible</em></span>'
      + '</label>';
    checkoutAside.appendChild(payGrid);

    // Point 8 : « Un code de paiement vous sera envoyé… » supprimé du formulaire.
    // L'info de paiement arrive au bon moment — sur l'écran de confirmation de commande.

    // Stripe card wrap : inline dans le scroll, juste sous les chips paiement
    // FIX: supprimer tout ancien wrap (sinon doublons => Stripe casse en silence)
    document.querySelectorAll('#stripe-card-wrap').forEach(el => el.remove());
    if (_stripeCard) { try { _stripeCard.unmount(); } catch(e){} _stripeCard = null; _stripeElements = null; }
    const stripeCardWrap = document.createElement('div');
    stripeCardWrap.id = 'stripe-card-wrap';
    stripeCardWrap.className = 'k-stripe-wrap';
    stripeCardWrap.innerHTML = '<div class="k-stripe-title">🔒 Informations de carte</div>'
      + '<div id="stripe-card-status" class="k-payment-provider-status" role="status" aria-live="polite">Préparation du paiement sécurisé…</div>'
      + '<div id="stripe-card-element" class="k-stripe-element"></div>'
      + '<div id="stripe-card-error" class="k-stripe-error"></div>'
      + '<div id="stripe-eur-display" class="k-stripe-eur"></div>';
    checkoutAside.appendChild(stripeCardWrap);

    /* PayPal container — affiché quand payment_mode=paypal_eur */
    document.querySelectorAll('#paypal-button-container').forEach(el => el.remove());
    const paypalWrap = document.createElement('div');
    paypalWrap.id = 'paypal-wrap';
    paypalWrap.className = 'k-paypal-wrap';
    paypalWrap.innerHTML = '<div class="k-paypal-title">🅿️ Paiement PayPal'
      + ' <em class="k-paypal-paylater-tag">Payez en 4× sans frais (éligibilité affichée par PayPal)</em></div>'
      + '<div id="paypal-button-container" class="k-paypal-buttons" role="status" aria-live="polite"></div>'
      + '<div id="paypal-error" class="k-paypal-error"></div>';
    checkoutAside.appendChild(paypalWrap);

    /* Détection serveur PayPal activé → affiche la chip */
    isPayPalEnabled().then(enabled => {
      const chip = document.getElementById('ck-chip-paypal');
      if (chip && enabled) {
        chip.style.display = '';
        ensurePayPalSDK().catch(() => {});
      }
    });


    if (recipientBlock) checkoutAside.appendChild(recipientBlock);
    else checkoutAside.appendChild(secureNotice);

    const finalTotal = document.createElement('div');
    finalTotal.className = 'ck-final-total';
    finalTotal.innerHTML =
      '<span id="ck-final-total-label">\u00c0 r\u00e9gler</span>'
      + '<strong id="ck-final-total-amount">' + fmt(_checkoutTotal(), 'KMF') + '</strong>';
    checkoutAside.appendChild(finalTotal);

    // Checkout unifié : le récapitulatif de CheckoutSelection vit dans
    // cette même surface, avant identité, retrait et paiement.
    // Aucun écran de confirmation intermédiaire.

    /* ── 5. Confirm (sticky) ── */
    // FIX: supprimer tout ancien bouton confirm
    document.querySelectorAll('#btn-confirm-order').forEach(el => el.remove());
    const confirmBtn = document.createElement('button');
    confirmBtn.id = 'btn-confirm-order';
    confirmBtn.className = 'ck-confirm-btn is-disabled';
    // FIX 2026-07-10 : le bouton naît DÉSACTIVÉ. Il n'est activable que
    // lorsque relayStatus === 'ready' + relais sélectionné (refreshCheckoutComputedUI).
    // Avant : rendu actif immédiatement, même si /api/relais était en erreur.
    confirmBtn.disabled = true;
    // Règle §8 — même gabarit de libellé qu'à l'état stabilisé (refreshCheckoutComputedUI) ;
    // seul le sous-texte change tant que le relais n'est pas chargé.
    setCheckoutConfirmButton(confirmBtn, 'Confirmer la commande · ' + fmt(_checkoutTotal(), 'KMF'), 'Chargement du relais…');
    // Le CTA appartient à la colonne de finalisation. Sur desktop il suit le
    // total au lieu d'être artificiellement plaqué au bas du viewport.
    // Desktop : le CTA appartient à la colonne récapitulative, immédiatement
    // après le total. Mobile : il reste hors de la zone défilante afin de
    // conserver le bouton bas toujours accessible.
    const isDesktopCheckout = typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 900px)').matches
      : window.innerWidth >= 900;
    (isDesktopCheckout ? checkoutAside : body.parentElement).appendChild(confirmBtn);

    /* ── Payment switching ── */
    // stripeCardWrap reste dans body (inline sous les chips)

    /**
 * Met à jour le récapitulatif paiement en checkout.
 */
  function updatePaymentUI() {
      const mode = document.querySelector('input[name="payment_mode"]:checked');
      const isStripe = mode && mode.value === 'stripe_eur';
      const isPaypal = mode && mode.value === 'paypal_eur';
      od.payment_mode = mode ? mode.value : 'cash_relais';

      // Le titre de section est statique (règle §4) — plus de re-rendu ici.
      // Le moyen sélectionné reste visible via la classe --active sur les
      // puces (juste en dessous).

      document.querySelectorAll('.ck-pay-chip').forEach(chip => {
        const r = chip.querySelector('input[type=radio]');
        if (r && !r.disabled) chip.classList.toggle('ck-pay-chip--active', r.checked);
      });

      /* Toggle PayPal wrap + lazy render du bouton officiel */
      const ppWrap = document.getElementById('paypal-wrap');
      if (ppWrap) {
        ppWrap.classList.toggle('is-visible', isPaypal);
        if (isPaypal && !ppWrap.dataset.rendered) {
          ppWrap.dataset.rendered = '1';
          renderPayPalButton('paypal-button-container', {
            validateBeforeClick: () => _validateCheckoutForm(),
            prepareKomerceOrder: () => _createKomerceOrderForPayPal(),
            onSuccess: (captureRes) => _onPayPalSuccess(captureRes),
            onError: (err) => {
              const errEl = document.getElementById('paypal-error');
              if (errEl) errEl.textContent = err?.message || 'Erreur PayPal';
            },
          }).catch(err => console.error('[PAYPAL] render failed', err));
        }
      }

      /* Le bouton "Confirmer" classique est caché quand PayPal est sélectionné
         (le bouton PayPal officiel prend le relais). */
      const confirmBtn = document.getElementById('btn-confirm-order');
      if (confirmBtn) confirmBtn.style.display = isPaypal ? 'none' : '';

      const wrap = document.getElementById('stripe-card-wrap');
      if (wrap) {
        wrap.classList.toggle('is-visible', isStripe);
        if (isStripe) {
          const ed = document.getElementById('stripe-eur-display');
          if (ed) ed.classList.add('is-visible');
          // Scroll le champ carte dans la zone visible — 150ms laisse le temps
          // à la transition CSS d'ouvrir le bloc avant le scroll.
          setTimeout(() => wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 150);
        }
      }

      if (isStripe && !_stripeCard) {
        const statusEl = document.getElementById('stripe-card-status');
        if (statusEl) {
          statusEl.textContent = 'Préparation du paiement sécurisé…';
          statusEl.classList.remove('is-hidden');
        }
        ensureStripe().then(stripe => {
          if (!stripe) {
            const errEl = document.getElementById('stripe-card-error');
            if (statusEl) statusEl.classList.add('is-hidden');
            if (errEl) { errEl.textContent = 'Paiement carte indisponible. Choisissez PayPal ou le paiement à la livraison.'; errEl.classList.add('is-visible'); }
            return;
          }
          if (_stripeCard) return;
          _stripeElements = stripe.elements();
          _stripeCard = _stripeElements.create('card', {
            style: { base: { fontSize: '15px', color: '#1e293b', '::placeholder': { color: '#94a3b8' } }, invalid: { color: '#dc2626' } },
            hidePostalCode: true
          });
          _stripeCard.mount('#stripe-card-element');
          if (statusEl) statusEl.classList.add('is-hidden');
          _stripeCard.on('change', ev => {
            const errEl = document.getElementById('stripe-card-error');
            if (errEl) { errEl.textContent = ev.error ? ev.error.message : ''; errEl.classList.toggle('is-visible', !!ev.error); }
          });
        });
      }

      refreshCheckoutComputedUI();
    }

    payGrid.addEventListener('change', updatePaymentUI);
    updatePaymentUI(); // init état chip cash
    refreshCheckoutComputedUI();

    setTimeout(() => {
      const cb = document.getElementById('cb-use-wallet');
      if (cb) cb.addEventListener('change', function() { od.use_wallet = this.checked; updateWalletDisplay(); });
    }, 0);

    confirmBtn.addEventListener('click', () => submitOrder(confirmBtn));
  }

    /* ── Checkout form helpers ── */

  /**
 * Crée un input stylé pour le checkout.
 * @param {string} type
 * @param {string} name
 * @param {string} placeholder
 * @returns {HTMLElement}
 */
/* S3.1 — rendu délégué à b-checkout-render.js */
export function makeInput(id, label, type, placeholder, dataObj, key) {
  return _makeInputRender(id, label, type, placeholder, dataObj, key);
}


  /**
   * Crée un champ de saisie téléphone international avec sélecteur d'indicatif.
   * @param {string} id       - ID HTML du champ
   * @param {string} label    - Label affiché
   * @param {Object} dataObj  - Objet de données où écrire la valeur normalisée
   * @param {string} key      - Clé de l'objet dataObj à mettre à jour
   */
// makeIntlPhoneInput — déplacé vers b-phone.js pour briser le cycle
// b-checkout ↔ b-identity (feat/checkout-otp). Ré-exporté ici pour
// compatibilité avec les modules qui l'importent depuis b-checkout.js.
export function makeIntlPhoneInput(id, label, dataObj, key) {
  return _makeIntlPhoneInput(id, label, dataObj, key);
}

  /**
   * Crée un champ téléphone simplifié (sans sélecteur d'indicatif) pour les Comores.
   */
/* S3.1 — rendu délégué à b-checkout-render.js */
export function makePhoneInput(id, label, dataObj, key) {
  return _makePhoneInputRender(id, label, dataObj, key);
}


  /* ── Wallet ── */
export async function checkWalletBalance() {
    try {
      const res = await fetch('/api/wallet', { credentials: 'same-origin' });
      // FIX 2026-07-11 (R3) : requêter le DOM APRÈS l'attente réseau, pas avant.
      // #wallet-section / #wallet-balance-text sont créés et attachés juste après
      // l'appel à checkWalletBalance() (encore absents du DOM au moment du call) ;
      // les capturer avant l'await figeait des références null.
      const section = document.getElementById('wallet-section');
      const balText = document.getElementById('wallet-balance-text');
      const expText = document.getElementById('wallet-expiry-text');
      if (res.ok) {
        const data = await res.json();
        state.walletBalance = data.balance_kmf || 0;
        // Règle §3 (simplification checkout final) — le wallet n'est PROPOSÉ
        // que si crédit > 0 ; à crédit nul, la section reste masquée (pas de
        // "Aucun crédit disponible" affiché). Avant (fix R3 2026-07-11) : la
        // section restait visible en permanence, y compris à 0, pour sortir
        // l'utilisateur d'un état "Chargement…" bloqué indéfiniment. On
        // conserve cet objectif (sortir explicitement de "Chargement…", ne
        // jamais laisser planer une ambiguïté chargement/échec) sans pour
        // autant proposer un crédit qui n'existe pas : la section est
        // explicitement masquée dès qu'on SAIT que le solde est 0 (chemin
        // différent d'un état encore inconnu/en cours).
        if (state.walletBalance > 0) {
          if (section) section.classList.add('is-visible');
          if (balText) balText.textContent = 'Solde disponible : ' + fmt(state.walletBalance, 'KMF');
          if (expText) {
            expText.textContent = data.expires_at
              ? 'Expire le ' + new Date(data.expires_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
              : '';
          }
        } else {
          if (section) section.classList.remove('is-visible');
          if (balText) balText.textContent = 'Aucun crédit disponible';
          if (expText) expText.textContent = '';
        }
      } else {
        // Réponse non-ok (401/403/5xx) : ne pas laisser "Chargement…" indéfiniment,
        // et ne jamais proposer un crédit dont on n'a pas confirmé l'existence.
        if (section) section.classList.remove('is-visible');
        if (balText) balText.textContent = 'Crédit indisponible';
      }
    } catch(e) {
      // Réseau/parsing : idem, sortir explicitement de l'état "Chargement…".
      const section = document.getElementById('wallet-section');
      const balText = document.getElementById('wallet-balance-text');
      if (section) section.classList.remove('is-visible');
      if (balText) balText.textContent = 'Crédit indisponible';
    }
  }

/**
 * Règle §3 (simplification checkout final) — masque intégralement le choix
 * du moyen de paiement (titre + puces + zones Stripe/PayPal) et affiche à
 * la place le message "✓ Votre crédit couvre toute la commande." quand le
 * wallet couvre déjà 100% du montant dû. Purement visuel : od.payment_mode
 * n'est jamais modifié ici, submitOrder() continue de lire la dernière
 * valeur sélectionnée (cash_relais par défaut) sans que cela ait d'impact,
 * le montant net étant nul dans ce cas.
 */
function _togglePaymentMethodVisibility(fullyCovered) {
  const payHeaderSlot = document.getElementById('ck-payment-summary');
  const fullCoverMsg  = document.getElementById('ck-wallet-full-cover-msg');
  const payGrid       = document.getElementById('ck-pay-grid');
  const stripeWrap    = document.getElementById('stripe-card-wrap');
  const paypalWrap    = document.getElementById('paypal-wrap');
  if (payHeaderSlot) payHeaderSlot.classList.toggle('ck-force-hidden', fullyCovered);
  if (fullCoverMsg)  fullCoverMsg.classList.toggle('is-visible', fullyCovered);
  if (payGrid)       payGrid.classList.toggle('ck-force-hidden', fullyCovered);
  if (stripeWrap)    stripeWrap.classList.toggle('ck-force-hidden', fullyCovered);
  if (paypalWrap)    paypalWrap.classList.toggle('ck-force-hidden', fullyCovered);
}

export function updateWalletDisplay() {
    const ded = document.getElementById('wallet-deduction');
    if (!ded) return;
    const cb = document.getElementById('cb-use-wallet');
    if (cb && cb.checked && state.walletBalance > 0) {
      const total = _checkoutTotal();
      const applied = Math.min(state.walletBalance, total);
      const remaining = total - applied;
      ded.classList.add('is-visible');
      ded.innerHTML = '<div class="k-wal-row"><span>💰 Crédit appliqué</span><span class="k-wal-value">-' + fmt(applied, 'KMF') + '</span></div>' +
        (remaining > 0 ? '<div class="k-wal-row"><span>À payer</span><span class="k-wal-bold">' + fmt(remaining, 'KMF') + '</span></div>' : '<div class="k-wal-success">✅ Entièrement couvert par votre crédit !</div>');
      _togglePaymentMethodVisibility(remaining <= 0);
    } else {
      ded.classList.remove('is-visible');
      _togglePaymentMethodVisibility(false);
    }
    refreshCheckoutComputedUI();
  }

export async function submitOrder(btn) {
  const od = state.orderData;

  // ── Verrou state machine (FIX 2026-07-10) ────────────────────────────────
  // Même si le DOM est manipulé / le bouton forcé, aucune commande ne part
  // tant que les relais ne sont pas chargés (ready). Règle absolue :
  // cash au relais sans relais chargé+sélectionné = impossible.
  if ((od.relayStatus || 'idle') !== 'ready') {
    markRelaySelectionError();
    showToast(
      od.relayStatus === 'error'
        ? 'Impossible de charger les relais — réessayez avant de confirmer.'
        : od.relayStatus === 'empty'
          ? 'Aucun relais disponible pour le moment.'
          : 'Chargement du point relais en cours…',
      'error'
    );
    return;
  }

  // ── Relais toujours requis ────────────────────────────────────────────────
  if (!od.selectedRelaisId) {
    markRelaySelectionError();
    document.getElementById('ck-relais-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast('Veuillez choisir un point relais pour la livraison.', 'error');
    return;
  }

  if (!_checkoutItems().length) {
    showToast('Sélectionnez au moins un article à commander.', 'error');
    return;
  }
  // ── OTP — identifie l'acheteur, seule identité de retrait ─────────────────
  // Lot 3 : plus de « qui récupère ? ». Le code de retrait est envoyé au
  // WhatsApp vérifié de l'acheteur ; nom/téléphone viennent uniquement de
  // l'identité OTP.
  const identity = await requireIdentity({
    reason: 'valider votre commande',
    title: 'Sécuriser votre commande',
  });
  if (!identity) return; // annulé → panier intact

  const trackingPhone = identity.phone || null;
  const recipName  = (identity.full_name || identity.name || '').trim();
  const recipPhone = identity.phone || '';

  const clientEmail = undefined;
  const isStripe = od.payment_mode === 'stripe_eur';

  if (btn.dataset.busy === '1') return;
  btn.dataset.busy = '1';
  btn.disabled = true;
  setCheckoutConfirmButton(btn, isStripe ? '⏳ Paiement en cours…' : '⏳ Envoi en cours…', '');
  btn.style.opacity = '0.7';

  try {
    const pickupCodeRecipient = state.checkoutDisplayContext?.origin === 'SHARED_LIST'
      ? (od.pickupCodeRecipient === 'organizer' ? 'organizer' : 'buyer')
      : undefined;

    const items = _checkoutItems().map(i => ({
      product_id: String(i.product.id),
      quantity: i.qty,
      confection_type: 'aucun',
      variant_combo: i.variant_combo || null,
      requested_transport_rail: i.requested_transport_rail ?? null,
      // Contrat API §3 : présent uniquement sur les lignes issues d'une
      // liste partagée (adapter group-checkout-adapter.js) — undefined
      // pour tout panier personnel, comportement inchangé.
      shared_cart_item_id: i.shared_cart_item_id ?? undefined,
    }));

    let orderData = null;
    let apiResult = null;

    if (isStripe) {
      if (!state.checkoutAttemptKey) state.checkoutAttemptKey = genIdempotencyKey();
      if (!state.pendingStripeOrderRef) {
        apiResult = await apiPost('/api/orders', {
          items, relais_id: od.selectedRelaisId || undefined,
          payment_mode: od.payment_mode, use_wallet: od.use_wallet || false,
          tracking_phone: trackingPhone || undefined,
          pickup_code_recipient: pickupCodeRecipient
          // L5 / P0-4 (mandat §8) — share_token retiré : un checkout
          // PERSONAL_CART ne doit porter aucune donnée de liste partagée.
          // state.shareToken peut être alimenté par une liste reçue affichée
          // (Fatima) et n'a rien à voir avec l'intention de ce checkout.
        }, { idempotencyKey: state.checkoutAttemptKey });
        orderData = apiResult.order || apiResult;
        state.pendingStripeOrderRef = orderData.reference;
      } else {
        orderData = { reference: state.pendingStripeOrderRef };
      }
    } else {
      apiResult = await apiPost('/api/orders', {
        items, relais_id: od.selectedRelaisId || undefined,
        payment_mode: od.payment_mode, use_wallet: od.use_wallet || false,
        tracking_phone: trackingPhone || undefined,
        pickup_code_recipient: pickupCodeRecipient
        // L5 / P0-4 (mandat §8) — share_token retiré, cf. commentaire ci-dessus.
      });
      orderData = apiResult.order || apiResult;
    }

    if (isStripe) {
      if (!_stripe) await ensureStripe();
      if (!_stripe || !_stripeCard) throw new Error('Stripe non chargé. Rechargez la page.');
      btn.textContent = '🔒 Sécurisation du paiement…';
      const intentResult = await apiPost('/api/payments/stripe/intent', { order_reference: orderData.reference });
      btn.textContent = '💳 Validation en cours…';
      const stripeResult = await _stripe.confirmCardPayment(intentResult.client_secret, {
        payment_method: { card: _stripeCard, billing_details: { name: recipName, email: clientEmail || undefined } }
      });
      if (stripeResult.error) {
        const errEl = document.getElementById('stripe-card-error');
        if (errEl) { errEl.textContent = stripeResult.error.message; errEl.classList.remove('u-hidden'); }
        throw new Error(stripeResult.error.message);
      }
      showToast('🎉 Paiement accepté !', 'success');
      state.checkoutAttemptKey = null;
      state.pendingStripeOrderRef = null;
    }

    _clearCommittedCheckoutSource();
    renderOrderSuccess(orderData, recipName, clientEmail, apiResult || orderData);
    showToast('Commande confirmée !', 'success');
    btn.dataset.busy = '0';
  } catch (e) {
    console.error('submitOrder:', e);
    showToast(e.message || 'Erreur lors de la commande.', 'error');
    // Correctif V2-B.1 §5 — signal générique d'échec de commande. Le
    // checkout ne connaît jamais la liste (doctrine group-checkout-
    // adapter.js) : on émet ici un code d'erreur neutre, à charge du
    // module intéressé (group-side-cart.js) de réagir ou non. Le modal de
    // commande reste ouvert sur erreur (pas de fermeture ici), donc
    // l'observer de fermeture de modale existant ne suffit pas à lui seul
    // à déclencher un rafraîchissement de liste sur ce cas précis.
    bus.emit('checkout:order-failed', { code: e.code || null, status: e.status || null });
    btn.disabled = false;
    btn.dataset.busy = '0';
    refreshCheckoutComputedUI();
    btn.style.opacity = '1';
  }
}

/* S3.1 — DOM délégué à buildOrderSuccessDOM (b-checkout-render.js).
   Logique métier (listeners clipboard, navigation, track) reste ici. */
export function renderOrderSuccess(order, recipientName, clientEmail, fullResult) {
  const body = dom.orderBody;
  body.classList.remove('k-order-body--checkout');
  dom.orderTitle.textContent = '✅ Commande confirmée';
  body.parentElement.querySelectorAll('.ck-confirm-btn').forEach(b => b.remove());
  body.querySelectorAll('.ck-back-btn').forEach(b => b.remove());

  // Construction DOM pure — séparée de la logique
  const { copyBtn, closeBtn, trackBtn } = buildOrderSuccessDOM(body, order);

  // Listeners métier (clipboard, navigation, tracking)
  setTimeout(() => {
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(order.reference || '').then(() => {
            showToast('📋 Référence copiée !', 'success');
            copyBtn.textContent = '✓ Copié';
            setTimeout(() => { copyBtn.textContent = '📋 Copier'; }, 2000);
          });
        }
      });
    }
    if (closeBtn) closeBtn.addEventListener('click', () => { closeOrderModal(); scrollPageToTop('smooth'); });
    if (trackBtn) {
      trackBtn.addEventListener('click', () => {
        closeOrderModal();
        // FIX 2026-07-11 : renderTrackView()/switchView() étaient référencés
        // ici en identifiants nus, jamais importés dans ce module — le garde
        // `typeof x === 'function'` avalait silencieusement l'absence (pas de
        // ReferenceError), donc rien ne s'exécutait jamais après le clic
        // (0 appel réseau constaté, #k-track-view jamais peuplé). On réutilise
        // le contrat unique déjà en place pour l'onglet bas "Suivre"
        // (b-nav.js) via le bus, pour éviter tout cycle d'import direct
        // b-checkout.js ↔ b-nav.js.
        bus.emit('nav:goto-track');
        document.querySelectorAll('.k-bnav-item').forEach(i => i.classList.remove('active'));
        const trackNav = document.querySelector('.k-bnav-item[data-tab="track"]');
        if (trackNav) trackNav.classList.add('active');
        // Suppression du bloc #k-otp-ref/#k-otp-ref-btn (2026-07-11) : ces IDs
        // n'existent plus dans le DOM réel généré par b-tracking.js (qui
        // utilise #k-track-digits/#k-track-quick-btn) — code mort qui ne
        // s'exécutait jamais. Aucune pré-saisie n'est nécessaire : la
        // commande qu'on vient de créer apparaît naturellement en tête de
        // renderMyOrdersList() (tri created_at DESC), identifiable via
        // l'attribut déjà présent `data-ref` sur `.k-myorder-card`.
      });
    }
  }, 0);
}


/* ═══════════════════════════════════════════════════════════════════════════
   PayPal — helpers déclenchés par renderPayPalButton (Migration 079)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Validation pré-clic PayPal — vérifie que le formulaire de checkout est
 * complet AVANT d'ouvrir la popup PayPal. Renvoie true/false.
 *
 * Réutilise les contrôles existants : identité, relais. Lot 3 : plus de
 * validation bénéficiaire, l'acheteur OTP est l'unique identité de retrait.
 */
async function _validateCheckoutForm() {
  const od = state.orderData || {};

  // 1. Identité du payeur
  const identity = getCurrentIdentity();
  if (!identity?.phone) {
    showToast('Renseignez votre numéro de téléphone', 'error');
    return false;
  }

  // 2. Relais sélectionné
  if (!od.selectedRelaisId) {
    showToast('Sélectionnez un relais', 'error');
    return false;
  }

  if (!_checkoutItems().length) {
    showToast('Sélectionnez au moins un article à commander.', 'error');
    return false;
  }

  return true;
}

/**
 * Crée l'ordre Komerce côté serveur (status=pending, payment_mode=paypal_eur)
 * avant de demander à PayPal de créer son own order.
 *
 * Idempotent : si une référence existe déjà dans state, on la réutilise.
 */
async function _createKomerceOrderForPayPal() {
  const od = state.orderData || {};

  // Idempotence : si on a déjà une ref PayPal pending, on la réutilise
  if (state.pendingPaypalOrderRef) {
    return { order_reference: state.pendingPaypalOrderRef };
  }

  const identity   = getCurrentIdentity();
  const recipName  = (identity?.full_name || identity?.name || '').trim();
  const trackingPhone = identity?.phone || undefined;

  const items = _checkoutItems().map(i => ({
    product_id: String(i.product.id),
    quantity:   i.qty,
    confection_type: 'aucun',
    variant_combo: i.variant_combo || null,
    requested_transport_rail: i.requested_transport_rail ?? null,
    // Contrat API §3 : présent uniquement sur les lignes issues d'une
    // liste partagée (adapter group-checkout-adapter.js) — undefined
    // pour tout panier personnel, comportement inchangé.
    shared_cart_item_id: i.shared_cart_item_id ?? undefined,
  }));

  const apiResult = await apiPost('/api/orders', {
    items,
    relais_id:        od.selectedRelaisId,
    payment_mode:     'paypal_eur',
    use_wallet:       od.use_wallet || false,
    tracking_phone:   trackingPhone,
    pickup_code_recipient: state.checkoutDisplayContext?.origin === 'SHARED_LIST'
      ? (od.pickupCodeRecipient === 'organizer' ? 'organizer' : 'buyer')
      : undefined,
    // L5 / P0-4 (mandat §8) — share_token retiré, cf. commentaire plus haut.
  }, { idempotencyKey: genIdempotencyKey() });

  const order = apiResult.order || apiResult;
  state.pendingPaypalOrderRef = order.reference;
  state.lastApiResult         = apiResult;

  return { order_reference: order.reference, order_id: order.id };
}

/**
 * Callback de succès après capture PayPal — affiche l'écran de confirmation.
 */
function _onPayPalSuccess(captureRes) {
  const identity  = getCurrentIdentity();
  const recipName = (identity?.full_name || identity?.name || '').trim();
  const orderRef  = state.pendingPaypalOrderRef;
  // Reconstruire un orderData minimal pour renderOrderSuccess
  const orderData = state.lastApiResult?.order || { reference: orderRef };
  _clearCommittedCheckoutSource();
  state.pendingPaypalOrderRef = null;
  renderOrderSuccess(orderData, recipName, undefined, state.lastApiResult || orderData);
}
