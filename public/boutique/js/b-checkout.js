/**
 * @komerce-arch
 * @role          boutique-checkout-orchestrator
 * @domain        checkout
 * @layer         ui-component
 * @criticality   critical
 * @inputs        cart_state, identity, phone, relais, payment_mode
 * @outputs       order_creation, stripe_payment_intent, checkout_modal_state
 * @depends       b-store.js, b-cart-core.js, b-cart.js, b-identity.js, b-checkout-render.js, b-phone.js, routes/orders.js, routes/payments.js
 * @used-by       boutique.js, b-nav.js, b-share-cart.js
 * @doctrine      paiement_seul_acte_engageant, otp_une_fois, checkout_sans_friction
 * @impact-areas  checkout, payments, otp, order-creation, cart, shared-cart
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
import { fmt, sanitize, genIdempotencyKey, apiGet, apiPost } from './b-utils.js';
import { showToast, cartTotal }   from './b-cart-core.js';
import { renderPayPalButton, isPayPalEnabled } from './b-paypal.js'; // Migration 079
import { openCart, closeCart, renderCart, clearCart }  from './b-cart.js';
import { getScrollY, scrollToPosition, scrollPageToTop } from './b-scroll-owner.js';
import { requireIdentity, getCurrentIdentity, restoreIdentity, bindChangeIdentity }  from './b-identity.js';
import {
  renderFulfillmentSelector as _renderFulfillmentSelector,
  setCheckoutConfirmButton  as _setCheckoutConfirmButton,
  buildOrderSuccessDOM,
  buildIdentityRecapDOM,
  applyIdentityToCard,
  makeInput                 as _makeInputRender,
  makePhoneInput            as _makePhoneInputRender,
} from './b-checkout-render.js';
import {
  PHONE_COUNTRIES,
  digitsOnly as _digitsOnly,
  normalizeLocal as _normalizeLocal,
  prettifyLocal as _prettifyLocal,
  buildE164 as _buildE164,
  isValidLocalLength,
  makeIntlPhoneInput as _makeIntlPhoneInput,
} from './b-phone.js';

// Stripe globals (initialized on demand)
let _stripe = (typeof window !== 'undefined' && window.Stripe) ? null : null;
let _stripeCard = null;
let _stripeElements = null;

// ── Helpers téléphone — délégués à b-phone.js (source de vérité) ─
export function digitsOnly(v)           { return _digitsOnly(v); }
export function normalizeLocal(c, d)    { return _normalizeLocal(c, d); }
export function prettifyLocal(r, co)    { return _prettifyLocal(r, co); }
export function buildE164(code, raw)    { return _buildE164(code, raw); }



async function ensureStripe() {
  if (_stripe) return _stripe;
  try {
    if (typeof window.Stripe !== 'function') {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://js.stripe.com/v3/';
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    const cfg = await apiGet('/api/public/config');
    const key = cfg && cfg.stripe_public_key;
    if (key && typeof window.Stripe === 'function') {
      _stripe = window.Stripe(key);
    }
  } catch(e) { console.warn('[Stripe] init failed:', e.message || e); }
  return _stripe;
}



  // ║  §11 · CHECKOUT — Commande, paiement, wallet, order success      ║
  // ╚══════════════════════════════════════════════════════════════════╝
  //  → Futur module: b-checkout.js

  /**
   * @brief checkoutCart — Lance le flow de commande depuis le panier
   * Prérequis : panier non vide (sinon toast error)
   * Ferme le tiroir panier, initialise state.orderData, affiche renderCheckout()
   */
export function checkoutCart() {
    if (state.cart.length === 0) { showToast('Votre panier est vide.', 'error'); return; }
    // FIX 2026-05-19 : si on commande depuis la fiche produit Temu, fermer d'abord
    // la modale produit. Sans ça, deux overlays s'empilent (k-modal-overlay +
    // k-order-modal) ce qui casse le scroll et laisse la fiche produit visible
    // en arrière-plan derrière le formulaire de commande.
    if (dom.modalOverlay && dom.modalOverlay.classList.contains('open')) {
      bus.emit('modal:close');
    }
    closeCart();
    state.orderData = { payment_mode: 'cash_relais' };
    renderCheckout();
    dom.orderModal.classList.add('open');
    scroll.savedY = getScrollY();
    document.body.classList.add('cart-open');
    // FIX : masquer bnav pour voir bouton Payer
    const bnav = document.getElementById('k-bnav');
    if (bnav) {
      bnav.classList.add('u-hidden');
    }

    // FIX — Sécurité de sortie : Escape + clic sur l'overlay ferment le checkout
    // et retirent cart-open. Sans ça, une sortie non standard bloque le scroll body.
    function _onOrderEscape(e) {
      if (e.key === 'Escape' && dom.orderModal.classList.contains('open')) {
        closeOrderModal();
      }
    }
    function _onOrderOverlayClick(e) {
      if (e.target === dom.orderModal) closeOrderModal();
    }
    document.addEventListener('keydown', _onOrderEscape, { once: true });
    dom.orderModal.addEventListener('click', _onOrderOverlayClick, { once: true });
  }

  /**
   * Ferme et détruit le modal de confirmation de commande.
   */
export function closeOrderModal() {
    dom.orderModal.classList.remove('open');
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

/** Ligne repliée « 📍 Relais · Île · Pays » + lien Changer → ouvre le picker. */
function _renderRelaisSummary(container, od, byIle, allIles) {
  container.classList.remove('is-error');
  const flag  = od.fulfillment_zone === 'france' ? '🇫🇷' : '🇰🇲';
  const zone  = od.fulfillment_zone === 'france' ? 'France' : 'Comores';
  container.innerHTML =
    '<button type="button" class="ck-relais-summary" id="ck-relais-summary">'
    + '<span class="ck-relais-summary-pin" aria-hidden="true"><span class="ck-relais-pin-dot">KM</span></span>'
    + '<span class="ck-relais-summary-body">'
    +   '<span class="ck-relais-summary-main">' + flag + ' ' + sanitize(od.selectedRelaisName || '') + '</span>'
    +   '<span class="ck-relais-summary-sub">' + sanitize(od.selectedIsland || '') + ' · ' + zone + '</span>'
    + '</span>'
    + '<span class="ck-relais-summary-change">Changer</span>'
    + '</button>';
  container.querySelector('#ck-relais-summary').addEventListener('click', () => {
    _openRelaisPicker(od, byIle, allIles, () => {
      clearRelaySelectionError();
      _renderRelaisSummary(container, od, byIle, allIles);
      setIntlPhoneDefault('of-beneficiary-phone', od.fulfillment_zone, !od.beneficiary_phone);
      refreshCheckoutComputedUI();
    });
  });
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

  function close() { ov.classList.remove('is-open'); setTimeout(() => ov.remove(), 280); }

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
              + '<span class="ck-relais-auto-body"><span class="ck-relais-auto-name">' + sanitize(r.name || r.nom || '') + '</span>'
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
    });
    ov.querySelector('.ck-relais-iles')?.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      draft.island = b.dataset.ile; paint();
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
  document.body.appendChild(ov);
  paint();
  requestAnimationFrame(() => ov.classList.add('is-open'));
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

function readIntlPhoneValue(id, fallbackValue) {
  const input      = document.getElementById(id);
  const countrySel = document.getElementById(id + '-country');
  if (!input || !countrySel) return (fallbackValue || '').trim();
  const country = PHONE_COUNTRIES.find(c => c.code === countrySel.value);
  const digits  = _normalizeLocal(countrySel.value, _digitsOnly(input.value));
  // Validation stricte : on refuse si le nombre de chiffres ne correspond pas au pays
  if (!country || !digits || !isValidLocalLength(countrySel.value, input.value)) return '';
  return _buildE164(countrySel.value, digits);
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

function setIntlPhoneDefault(id, zone, force) {
  const sel   = document.getElementById(id + '-country');
  const input = document.getElementById(id);
  if (!sel) return;
  const nextCode = getDefaultPhoneCodeForZone(zone);
  const hasValue = !!String(input?.value || '').trim();
  if (force || !hasValue) {
    sel.value = nextCode;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
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
  const relayName = od.selectedRelaisName || '';
  const island    = od.selectedIsland || '';
  const where     = relayName ? (relayName + (island ? ' • ' + island : '')) : '';
  const total = cartTotal();
  const cb = document.getElementById('cb-use-wallet');
  const walletApplied = (cb && cb.checked && state.walletBalance > 0) ? Math.min(state.walletBalance, total) : 0;
  const netAmount = total - walletApplied;
  const mainText = mode === 'stripe_eur'
    ? '💳 Payer ' + fmt(total, 'KMF')
    : '✅ Confirmer — ' + fmt(netAmount, 'KMF') + (walletApplied > 0 ? ' (net wallet)' : '');
  let subText = mode === 'stripe_eur'
    ? (where ? 'Carte via Stripe • ' + where : 'Carte via Stripe')
    : (where ? 'Cash au relais • ' + where : 'Cash au relais');

  // ── Verrou métier relais (FIX 2026-07-10) ────────────────────────
  // Un ordre (cash au relais OU stripe — le relais est toujours requis,
  // cf. submitOrder) ne doit JAMAIS être confirmable si les relais ne
  // sont pas chargés (ready) et qu'aucun relais n'est sélectionné.
  const relayStatus = od.relayStatus || 'idle';
  const relayOk = relayStatus === 'ready' && !!od.selectedRelaisId;
  if (!relayOk && btn_busy(confirmBtn) === false) {
    if (relayStatus === 'loading' || relayStatus === 'idle') subText = 'Chargement du relais…';
    else if (relayStatus === 'error') subText = 'Impossible de charger les relais';
    else if (relayStatus === 'empty') subText = 'Aucun relais disponible';
    else subText = 'Choisissez un point relais';
  }
  confirmBtn.disabled = !relayOk || btn_busy(confirmBtn);
  confirmBtn.classList.toggle('is-disabled', confirmBtn.disabled);
  setCheckoutConfirmButton(confirmBtn, mainText, subText);
}

function btn_busy(btn) { return btn?.dataset?.busy === '1'; }

// renderCheckoutCompact supprimée — doublon de renderCheckout(), jamais activée (07/05/2026)
export function renderCheckout() {
    const body = dom.orderBody;
    body.innerHTML = '';
    body.classList.add('k-order-body--checkout');
    body.parentElement.querySelectorAll('.ck-confirm-btn').forEach(b => b.remove());
    dom.orderTitle.innerHTML = '<button type="button" class="ck-modal-back-btn ck-modal-back-btn--header" aria-label="Retour au panier">← Panier</button><span class="ck-order-title-text">🛒 Commander</span>';

    const od = state.orderData;
    if (!od.fulfillment_zone) od.fulfillment_zone = 'comoros';

    const headerBackBtn = dom.orderTitle.querySelector('.ck-modal-back-btn--header');
    if (headerBackBtn) {
      headerBackBtn.addEventListener('click', () => {
        closeOrderModal();
        setTimeout(() => { if (typeof openCart === 'function') openCart(); }, 150);
      });
    }

    // Pays/zone (Comores/France) déplacé DANS le picker de relais (cf. _openRelaisPicker) :
    // il n'a pas sa place sur l'écran principal — il est le 1er cran du choix de retrait.

    // ── Bloc récap identité payeur (doctrine §9) ─────────────────────────────
    // S3.1 — construction DOM déléguée à buildIdentityRecapDOM (b-checkout-render.js)
    const _knownUser = getCurrentIdentity();
    if (_knownUser) {
      const idRecap = buildIdentityRecapDOM(_knownUser);
      // FIX : « Changer » câblé sur bindChangeIdentity → ouvre vraiment la modale
      // (openIdentityModal). L'ancien requireIdentity() court-circuitait via
      // restoreIdentity() et renvoyait l'identité existante sans rien afficher.
      const _onIdChanged = (newUser) => { state.user = newUser; applyIdentityToCard(idRecap, newUser); };
      bindChangeIdentity(idRecap, '.k-ck-id-change', _onIdChanged);
      bindChangeIdentity(idRecap, '.k-ck-id-notyou', _onIdChanged);
      body.insertBefore(idRecap, body.firstChild); // carte en tête du checkout
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
            body.insertBefore(hint, body.firstChild);
          }
          return;
        }
        state.user = restoredUser;

        // Anti-doublon : si la carte existe déjà (rendu concurrent), on rafraîchit juste.
        let idRecap = body.querySelector('#ck-identity-recap');
        if (idRecap) {
          applyIdentityToCard(idRecap, restoredUser);
          return;
        }

        // Construction + insertion EN TÊTE du body (fiable, indépendant de la
        // structure interne — on ne cherche plus un .k-ck-group qui peut manquer).
        idRecap = buildIdentityRecapDOM(restoredUser);
        const _onIdChanged2 = (newUser) => { state.user = newUser; applyIdentityToCard(idRecap, newUser); };
        bindChangeIdentity(idRecap, '.k-ck-id-change', _onIdChanged2);
        bindChangeIdentity(idRecap, '.k-ck-id-notyou', _onIdChanged2);
        body.insertBefore(idRecap, body.firstChild); // toujours en haut
      }).catch(err => {
        // On n'avale plus silencieusement : une erreur réseau est normale (non
        // connecté), mais une erreur de construction DOM doit être visible.
        if (err && err.name !== 'TypeError') console.warn('[checkout] restauration identité:', err);
      });
    }
    // ── Fin restauration silencieuse ─────────────────────────────────────────

    // ── Bloc « Qui récupère ? » ───────────────────────────────────────────────
    // Logique : utilisateur reconnu → ses infos sont DÉJÀ dans la carte du haut.
    // Donc « Je récupère moi-même » → AUCUN champ (pas de doublon).
    // « Quelqu'un d'autre récupère » → on révèle les champs Nom/Tél du retraitant.
    const benfSection = document.createElement('div');
    benfSection.className = 'ck-section-block';
    const benfTitle = document.createElement('div');
    benfTitle.className = 'ck-section-title';
    benfTitle.innerHTML = '<span class="ck-step-num" aria-hidden="true">1</span>QUI RÉCUPÈRE ?';
    benfSection.appendChild(benfTitle);

    // #cb-benf-is-me CONSERVÉ (caché) — lu par submitOrder + le préremplissage.
    // Le segment visible « Moi / Quelqu'un d'autre » le pilote en dispatchant un
    // 'change' natif : aucun changement de logique, juste l'habillage.
    const benfCb = document.createElement('input');
    benfCb.type = 'checkbox';
    benfCb.id = 'cb-benf-is-me';
    benfCb.className = 'ck-benf-me-cb';
    benfCb.checked = true;
    benfCb.hidden = true;
    benfSection.appendChild(benfCb);

    const benfSeg = document.createElement('div');
    benfSeg.className = 'ck-recip-seg';
    benfSeg.setAttribute('role', 'tablist');
    benfSeg.innerHTML =
      '<button type="button" class="on" data-me="1">Moi</button>'
      + '<button type="button" data-me="0">Quelqu\u2019un d\u2019autre</button>';
    benfSection.appendChild(benfSeg);

    // Champs retraitant — MASQUÉS si « Moi » (infos déjà dans la carte),
    // révélés seulement si « Quelqu'un d'autre ». Le suivi-aux-deux vit ici.
    const benfFields = document.createElement('div');
    benfFields.className = 'ck-recip-fields';
    benfFields.hidden = true;
    benfFields.appendChild(makeInput('of-beneficiary-name', 'Nom de la personne qui retire *', 'text', 'Prénom Nom', od, 'beneficiary_name'));
    benfFields.appendChild(makeIntlPhoneInput('of-beneficiary-phone', 'Téléphone de la personne qui retire *', od, 'beneficiary_phone'));
    const benfNote = document.createElement('div');
    benfNote.className = 'ck-recip-note';
    benfNote.textContent = '📲 Le suivi WhatsApp sera envoyé à vous deux';
    benfFields.appendChild(benfNote);
    benfSection.appendChild(benfFields);
    body.appendChild(benfSection);

    /* ── Bloc métier "Je retire moi-même" ──
       Visible en mode Moi, masqué en mode Quelqu'un d'autre.
       Piloté par _syncRecipFields(). Remplace ck-fill-above.
       FIX 2026-06-06 : déclaré ICI (avant _syncRecipFields) pour éviter la
       ReferenceError qui avortait renderCheckout() et empêchait le bouton
       "Commander" de fonctionner (modal fermée sans action). */
    const selfPickupInfo = document.createElement('div');
    selfPickupInfo.className = 'ck-self-pickup-info';
    selfPickupInfo.innerHTML =
      '<div class="ck-self-pickup-title">✅ Vous récupérez cette commande</div>'
      + '<div class="ck-self-pickup-line">📲 Suivi WhatsApp envoyé sur votre numéro</div>'
      + '<div class="ck-self-pickup-line">🏪 Paiement cash au relais sélectionné</div>'
      + '<div class="ck-self-pickup-actions">'
      + '<button type="button" class="ck-spi-changed">Votre num\u00e9ro a chang\u00e9\u00a0?</button>'
      + '<button type="button" class="ck-spi-notyou">Ce n\u2019est pas vous\u00a0?</button>'
      + '</div>';
    // Même flux que « Changer » / « Ce n'est pas vous ? » de la carte identité en tête.
    const _spiOnChanged = (newUser) => {
      state.user = newUser;
      const _idCard = body.querySelector('#ck-identity-recap');
      if (_idCard) applyIdentityToCard(_idCard, newUser);
    };
    bindChangeIdentity(selfPickupInfo, '.ck-spi-changed', _spiOnChanged);
    bindChangeIdentity(selfPickupInfo, '.ck-spi-notyou', _spiOnChanged);

    // Le segment pilote la case + l'affichage des champs.
    const _benfCb = benfCb;
    const _segBtns = benfSeg.querySelectorAll('button');
    const _syncRecipFields = () => {
      const isMe = _benfCb.checked;
      _segBtns.forEach(b => b.classList.toggle('on', (b.dataset.me === '1') === isMe));
      body.classList.toggle('ck-is-me', isMe);
      // Masquer/restaurer les actions de la carte identité selon le mode.
      // En mode "Quelqu'un d'autre", "Changer" et "Ce n'est pas vous ?" n'ont
      // pas de sens (le payeur ne change pas) → on les masque.
      const _idCard = body.querySelector('#ck-identity-recap');
      if (_idCard) {
        const _chBtn = _idCard.querySelector('.k-ck-id-change');
        const _nyBtn = _idCard.querySelector('.k-ck-id-notyou');
        if (_chBtn) _chBtn.hidden = !isMe;
        if (_nyBtn) _nyBtn.hidden = !isMe;
      }
      if (isMe) {
        benfFields.hidden = true;
        selfPickupInfo.hidden = true;
      } else {
        benfFields.hidden = false;
        selfPickupInfo.hidden = true;
        // SÉCURITÉ : vider systématiquement les champs bénéficiaire quand
        // on bascule sur "quelqu'un d'autre". Sans ça, les champs restent
        // pré-remplis avec les propres infos du payeur → il pourrait valider
        // sans les modifier, et l'OTP serait envoyé à son propre numéro au
        // lieu de celui du vrai destinataire.
        const nameInput    = document.getElementById('of-beneficiary-name');
        const phoneInput   = document.getElementById('of-beneficiary-phone');
        const phoneCountry = document.getElementById('of-beneficiary-phone-country');
        if (nameInput)    { nameInput.value = ''; od.beneficiary_name = ''; }
        if (phoneInput)   { phoneInput.value = ''; }
        if (phoneCountry) { phoneCountry.value = getDefaultPhoneCodeForZone(od.fulfillment_zone || 'comoros'); }
        od.beneficiary_phone = '';
        // Focus sur le premier champ pour guider l'user
        setTimeout(() => nameInput?.focus(), 50);
      }
    };
    _benfCb.addEventListener('change', _syncRecipFields);
    benfSeg.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const me = b.dataset.me === '1';
      if (_benfCb.checked === me) return;          // pas de changement → no-op
      _benfCb.checked = me;
      _benfCb.dispatchEvent(new Event('change', { bubbles: true })); // → sync + préremplissage
    });
    _syncRecipFields();

    // ── Logique préremplissage (inchangée : lit #cb-benf-is-me) ───────────────
    // DOCTRINE : ce handler ne déclenche JAMAIS requireIdentity() ni de modale.
    // Il lit passivement l'identité déjà connue (getCurrentIdentity) ou tente
    // une restauration silencieuse (restoreIdentity — cookie httpOnly, zéro OTP).
    // requireIdentity() reste réservé à submitOrder() et au clic "Ce n'est pas vous ?".
    setTimeout(() => {
      const cbBenfMe = document.getElementById('cb-benf-is-me');
      if (!cbBenfMe) return;

      /**
       * Préremplie les champs bénéficiaire avec une identité validée.
       * Ne fait rien si l'identité est admin/système/invalide.
       * Ne déclenche aucune modale.
       * @param {Object} identity
       * @returns {boolean} true si préremplissage effectué
       */
      /**
       * Extrait le meilleur téléphone disponible depuis l'objet identité.
       * Parcourt les propriétés dans l'ordre de priorité et retourne la
       * première valeur non vide.  Retourne '' si aucune n'est trouvable.
       * @param {Object} id - objet identité normalisé (ou brut)
       * @returns {string} numéro brut (idéalement E.164)
       */
      function _getIdentityPhone(id) {
        if (!id) return '';
        // Priorité : objet normalisé (phone déjà résolu par normalizeUser)
        // → puis propriétés alternatives connues en base Komerce
        return (
          id.phone          ||
          id.phone_number   ||
          id.whatsapp_phone ||
          id.whatsapp       ||
          id.mobile         ||
          id.user?.phone    ||
          id.profile?.phone ||
          ''
        ).trim();
      }

      /**
       * Préremplie les champs bénéficiaire avec une identité validée.
       * — Utilise PHONE_COUNTRIES (liste réelle des indicatifs) pour parser
       *   le numéro E.164 → (dialCode, local).  Le regex /^(\+\d{1,4})(.*)/ 
       *   est greedy et peut se tromper (ex. +2693… capturé à 4 chiffres 
       *   au lieu de 3).  On cherche à la place le code connu le plus long
       *   qui préfixe le numéro, puis on formate le local via prettifyLocal.
       * — Ne fait rien si l'identité est admin/système/invalide ou si le
       *   numéro est absent ou inexploitable.
       * — Ne déclenche aucune modale, aucun OTP.
       * @param {Object} identity
       * @returns {boolean} true si préremplissage effectué
       */
      function _prefillFromIdentity(identity) {
        const nameInput    = document.getElementById('of-beneficiary-name');
        const phoneInput   = document.getElementById('of-beneficiary-phone');
        const phoneCountry = document.getElementById('of-beneficiary-phone-country');

        // ── Nom ──────────────────────────────────────────────────────
        const _idName = ((identity && (identity.full_name || identity.name)) || '').trim();
        const _isAdminName = /admin|komerce|syst[eè]me?|test|demo/i.test(_idName);

        // ── Téléphone — source de vérité ─────────────────────────────
        // On lit _getIdentityPhone() plutôt que identity.phone directement,
        // pour couvrir les variantes de propriétés retournées par l'API.
        const _rawPhone = _getIdentityPhone(identity);

        // Validation préliminaire (avant parsing)
        const _isAdminPhone = /^(\+\d{1,4})?0{4,}/.test(_rawPhone) || _rawPhone.length < 8;
        const _usable = identity && _idName && !_isAdminName && !_isAdminPhone;

        if (!_usable) return false;

        // ── Prérempli nom ─────────────────────────────────────────────
        if (nameInput) {
          nameInput.value = _idName;
          od.beneficiary_name = _idName;
        }

        // ── Prérempli téléphone — parsing via PHONE_COUNTRIES ─────────
        // Cherche le code indicatif connu le plus long qui préfixe le numéro.
        // Ex: +2693231452 → found = { code:'+269', digits:7 }
        //                 → local = '3231452'
        // Ex: +33612345678 → found = { code:'+33', digits:9 }
        //                  → local = '612345678' → prettify → '06 12 34 56 78'
        // Si aucun code connu n'est trouvé : on tente quand même de coller
        // le numéro brut dans l'input pour ne pas bloquer l'utilisateur.
        if (phoneInput && phoneCountry) {
          // Trier par longueur décroissante pour matcher le plus long en premier
          // (+269 avant +26, +212 avant +21, etc.)
          const _sorted = PHONE_COUNTRIES.slice().sort((a, b) => b.code.length - a.code.length);
          const _found  = _sorted.find(c => _rawPhone.startsWith(c.code));

          if (_found) {
            const _localRaw = _rawPhone.slice(_found.code.length);
            const _localDisplay = _prettifyLocal(_localRaw, _found);

            phoneCountry.value = _found.code;
            // bubbles:false — changement programmatique, ne doit pas
            // remonter vers les autres listeners (payGrid, etc.)
            phoneCountry.dispatchEvent(new Event('change', { bubbles: false }));
            phoneInput.value = _localDisplay;
            od.beneficiary_phone = _rawPhone; // stocker l'E.164 complet
          } else {
            // Indicatif inconnu — coller le brut, l'utilisateur peut corriger
            phoneInput.value = _rawPhone;
            od.beneficiary_phone = _rawPhone;
          }
        }

        return true;
      }

      cbBenfMe.addEventListener('change', function() {
        if (!this.checked) {
          // Décoché : on ne vide pas une saisie manuelle existante
          return;
        }

        // 1. Lecture synchrone — identité déjà en mémoire
        const syncIdentity = getCurrentIdentity();
        if (syncIdentity) {
          _prefillFromIdentity(syncIdentity);
          return;
        }

        // 2. Pas d'identité en mémoire → tentative de restauration passive
        //    (cookie httpOnly kmrc_jwt — aucun OTP, aucune modale)
        //    Si la restauration échoue ou retourne null, on laisse les champs
        //    libres pour saisie manuelle. On ne décoche pas la case.
        restoreIdentity().then(restoredIdentity => {
          // Vérifier que la case est toujours cochée (l'user n'a pas décoché
          // pendant l'attente async)
          if (!cbBenfMe.checked) return;
          if (restoredIdentity) {
            _prefillFromIdentity(restoredIdentity);
          }
          // Si toujours pas d'identité : champs manuels disponibles, aucune action
        }).catch(() => { /* restauration silencieuse — on ignore les erreurs réseau */ });
      });

      // État initial : « je récupère moi-même » coché par défaut → préremplissage
      // une fois au chargement (équivaut à sélectionner l'option « me » du toggle).
      if (cbBenfMe.checked) cbBenfMe.dispatchEvent(new Event('change', { bubbles: true }));
    }, 0);
    // ── Fin bloc bénéficiaire ────────────────────────────────────────────────

    /* ── 2b. Point relais ── */
    const sRelais = document.createElement('div');
    sRelais.className = 'ck-section-block';
    sRelais.innerHTML = '<div class="ck-section-title"><span class="ck-step-num" aria-hidden="true">2</span>POINT DE RETRAIT</div>';
    body.appendChild(sRelais);
    const relaisSection = document.createElement('div');
    relaisSection.id = 'ck-relais-section';
    relaisSection.className = 'ck-relais-section';
    relaisSection.innerHTML = '<div class="ck-relais-loading">⏳ Chargement des relais...</div>';
    body.appendChild(relaisSection);
    _loadRelaisSection(relaisSection, od);

    // selfPickupInfo déclaré et initialisé plus haut (avant _syncRecipFields).
    body.appendChild(selfPickupInfo);

    /* ── 3. Paiement ── */
    const s2 = document.createElement('div');
    s2.className = 'ck-section-block ck-payment-section';
    s2.innerHTML = '<div class="ck-section-title"><span class="ck-step-num" aria-hidden="true">3</span>PAIEMENT</div>';
    body.appendChild(s2);

    const payGrid = document.createElement('div');
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
    body.appendChild(payGrid);

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
      + '<div id="stripe-card-element" class="k-stripe-element"></div>'
      + '<div id="stripe-card-error" class="k-stripe-error"></div>'
      + '<div id="stripe-eur-display" class="k-stripe-eur"></div>';
    body.appendChild(stripeCardWrap);

    /* PayPal container — affiché quand payment_mode=paypal_eur */
    document.querySelectorAll('#paypal-button-container').forEach(el => el.remove());
    const paypalWrap = document.createElement('div');
    paypalWrap.id = 'paypal-wrap';
    paypalWrap.className = 'k-paypal-wrap';
    paypalWrap.innerHTML = '<div class="k-paypal-title">🅿️ Paiement PayPal'
      + ' <em class="k-paypal-paylater-tag">Payez en 4× sans frais (éligibilité affichée par PayPal)</em></div>'
      + '<div id="paypal-button-container" class="k-paypal-buttons"></div>'
      + '<div id="paypal-error" class="k-paypal-error"></div>';
    body.appendChild(paypalWrap);

    /* Détection serveur PayPal activé → affiche la chip */
    isPayPalEnabled().then(enabled => {
      const chip = document.getElementById('ck-chip-paypal');
      if (chip && enabled) chip.style.display = '';
    });


    // Le pays/zone est désormais piloté par le picker de relais (_openRelaisPicker),
    // qui rafraîchit lui-même le défaut du téléphone bénéficiaire. Ici on ne fait
    // que poser le défaut initial — la section relais est chargée une seule fois ci-dessus.
    function refreshFulfillment() {
      setIntlPhoneDefault('of-beneficiary-phone', od.fulfillment_zone, !od.beneficiary_phone);
    }
    refreshFulfillment();

    /* ── 5. Wallet ── */
    checkWalletBalance();
    const walletSection = document.createElement('div');
    walletSection.id = 'wallet-section';
    walletSection.className = 'k-wallet-section';
    walletSection.innerHTML = '<label class="k-wallet-label">'
      + '<input type="checkbox" id="cb-use-wallet" class="k-wallet-cb">'
      + '<div class="k-wallet-info"><div class="k-wallet-title">💰 Utiliser mon crédit</div>'
      + '<div id="wallet-balance-text" class="k-wallet-balance">Chargement…</div></div></label>'
      + '<div id="wallet-deduction" class="k-wallet-ded"></div>';
    body.appendChild(walletSection);

    /* ── 6. Confirm (sticky) ── */
    // FIX: supprimer tout ancien bouton confirm
    document.querySelectorAll('#btn-confirm-order').forEach(el => el.remove());
    const confirmBtn = document.createElement('button');
    confirmBtn.id = 'btn-confirm-order';
    confirmBtn.className = 'ck-confirm-btn is-disabled';
    // FIX 2026-07-10 : le bouton naît DÉSACTIVÉ. Il n'est activable que
    // lorsque relayStatus === 'ready' + relais sélectionné (refreshCheckoutComputedUI).
    // Avant : rendu actif immédiatement, même si /api/relais était en erreur.
    confirmBtn.disabled = true;
    setCheckoutConfirmButton(confirmBtn, '✅ Confirmer — ' + fmt(cartTotal(), 'KMF'), 'Chargement du relais…');
    // Bouton confirm HORS du scroll area → toujours visible en bas du modal
    body.parentElement.appendChild(confirmBtn);

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
        ensureStripe().then(stripe => {
          if (!stripe) {
            const errEl = document.getElementById('stripe-card-error');
            if (errEl) { errEl.textContent = 'Paiement carte indisponible.'; errEl.classList.add('is-visible'); }
            return;
          }
          if (_stripeCard) return;
          _stripeElements = stripe.elements();
          _stripeCard = _stripeElements.create('card', {
            style: { base: { fontSize: '15px', color: '#1e293b', '::placeholder': { color: '#94a3b8' } }, invalid: { color: '#dc2626' } },
            hidePostalCode: true
          });
          _stripeCard.mount('#stripe-card-element');
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
      if (res.ok) {
        const data = await res.json();
        state.walletBalance = data.balance_kmf || 0;
        // Afficher la section + le texte dans TOUS les cas, pas seulement quand
        // balance > 0. Avant : à solde 0, le texte restait bloqué sur
        // "Chargement…" et la section restait display:none pour toujours
        // (classe is-visible jamais posée) → l'utilisateur ne savait jamais si
        // son solde avait bien été chargé (0 réel) ou si l'appel avait échoué/pendait.
        if (section) section.classList.add('is-visible');
        if (balText) {
          balText.textContent = state.walletBalance > 0
            ? 'Solde disponible : ' + fmt(state.walletBalance, 'KMF')
            : 'Aucun crédit disponible';
        }
      } else {
        // Réponse non-ok (401/403/5xx) : ne pas laisser "Chargement…" indéfiniment.
        if (balText) balText.textContent = 'Crédit indisponible';
      }
    } catch(e) {
      // Réseau/parsing : idem, sortir explicitement de l'état "Chargement…".
      const balText = document.getElementById('wallet-balance-text');
      if (balText) balText.textContent = 'Crédit indisponible';
    }
  }

export function updateWalletDisplay() {
    const ded = document.getElementById('wallet-deduction');
    if (!ded) return;
    const cb = document.getElementById('cb-use-wallet');
    if (cb && cb.checked && state.walletBalance > 0) {
      const total = cartTotal();
      const applied = Math.min(state.walletBalance, total);
      const remaining = total - applied;
      ded.classList.add('is-visible');
      ded.innerHTML = '<div class="k-wal-row"><span>💰 Crédit appliqué</span><span class="k-wal-value">-' + fmt(applied, 'KMF') + '</span></div>' +
        (remaining > 0 ? '<div class="k-wal-row"><span>Reste à payer</span><span class="k-wal-bold">' + fmt(remaining, 'KMF') + '</span></div>' : '<div class="k-wal-success">✅ Entièrement couvert par votre crédit !</div>');
    } else {
      ded.classList.remove('is-visible');
    }
    refreshCheckoutComputedUI();
  }

export async function submitOrder(btn) {
  const od = state.orderData;
  const benfIsMe = !!(document.getElementById('cb-benf-is-me')?.checked);

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

  // ── Si quelqu'un d'autre récupère : valider ses champs avant l'OTP ────────
  if (!benfIsMe) {
    const _name  = (document.getElementById('of-beneficiary-name')?.value || '').trim();
    const _phone = readIntlPhoneValue('of-beneficiary-phone', od.beneficiary_phone);
    if (!_name)  { showToast('Indiquez le nom de la personne qui récupère.', 'error'); return; }
    if (!_phone) { showToast('Indiquez un téléphone valide pour le bénéficiaire.', 'error'); return; }
  }

  // ── OTP — identifie le payeur ─────────────────────────────────────────────
  // "Je récupère moi-même" : nom + tél viennent de l'identité OTP.
  // "Quelqu'un d'autre"    : champs bénéficiaire déjà validés ci-dessus.
  const identity = await requireIdentity({
    reason: 'valider votre commande',
    title: 'Sécuriser votre commande',
  });
  if (!identity) return; // annulé → panier intact

  const trackingPhone = identity.phone || null;

  // ── Résoudre nom + tél bénéficiaire après OTP ─────────────────────────────
  const recipName  = benfIsMe
    ? (identity.full_name || identity.name || '').trim()
    : (document.getElementById('of-beneficiary-name')?.value || '').trim();
  const recipPhone = benfIsMe
    ? identity.phone || ''
    : readIntlPhoneValue('of-beneficiary-phone', od.beneficiary_phone);

  // SÉCURITÉ : quand "quelqu'un d'autre récupère", interdire que le bénéficiaire
  // ait le même numéro que le payeur OTP. Ce cas survient si l'user a mis
  // son propre numéro dans le champ bénéficiaire (contournement du suivi double).
  // On bloque et on demande à corriger le champ — sans annuler la commande entière.
  if (!benfIsMe && recipPhone && trackingPhone && recipPhone === trackingPhone) {
    showToast('Le numéro de la personne qui récupère doit être différent du vôtre.', 'error');
    document.getElementById('of-beneficiary-phone')?.focus();
    btn.disabled = false;
    btn.dataset.busy = '0';
    refreshCheckoutComputedUI();
    return;
  }

  const clientEmail = undefined;
  const isStripe = od.payment_mode === 'stripe_eur';

  if (btn.dataset.busy === '1') return;
  btn.dataset.busy = '1';
  btn.disabled = true;
  setCheckoutConfirmButton(btn, isStripe ? '⏳ Paiement en cours…' : '⏳ Envoi en cours…', '');
  btn.style.opacity = '0.7';

  try {
    const items = state.cart.map(i => ({
      product_id: String(i.product.id),
      quantity: i.qty,
      confection_type: 'aucun',
      variant_combo: i.variant_combo || null,
      requested_transport_rail: i.requested_transport_rail ?? null,
    }));

    let orderData = null;
    let apiResult = null;

    if (isStripe) {
      if (!state.checkoutAttemptKey) state.checkoutAttemptKey = genIdempotencyKey();
      if (!state.pendingStripeOrderRef) {
        apiResult = await apiPost('/api/orders', {
          items, relais_id: od.selectedRelaisId || undefined,
          recipient_name: recipName, recipient_phone: recipPhone,
          payment_mode: od.payment_mode, use_wallet: od.use_wallet || false,
          tracking_phone: trackingPhone || undefined, share_token: state.shareToken || undefined
        }, { idempotencyKey: state.checkoutAttemptKey });
        orderData = apiResult.order || apiResult;
        state.pendingStripeOrderRef = orderData.reference;
      } else {
        orderData = { reference: state.pendingStripeOrderRef };
      }
    } else {
      apiResult = await apiPost('/api/orders', {
        items, relais_id: od.selectedRelaisId || undefined,
        recipient_name: recipName, recipient_phone: recipPhone,
        payment_mode: od.payment_mode, use_wallet: od.use_wallet || false,
        tracking_phone: trackingPhone || undefined, share_token: state.shareToken || undefined
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

    clearCart();
    renderOrderSuccess(orderData, recipName, clientEmail, apiResult || orderData);
    showToast('Commande confirmée !', 'success');
    btn.dataset.busy = '0';
  } catch (e) {
    console.error('submitOrder:', e);
    showToast(e.message || 'Erreur lors de la commande.', 'error');
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
 * Réutilise les contrôles existants : identité, relais, bénéficiaire.
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

  // 3. Bénéficiaire (nom + téléphone)
  const benefNameEl  = document.getElementById('of-beneficiary-name');
  const benefPhoneEl = document.getElementById('of-beneficiary-phone');
  const benefName  = benefNameEl?.value?.trim();
  const benefPhone = benefPhoneEl?.value?.trim();
  if (!benefName || !benefPhone) {
    showToast('Renseignez le nom et le téléphone du bénéficiaire', 'error');
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
  const recipName  = document.getElementById('of-beneficiary-name')?.value?.trim();
  const recipPhone = document.getElementById('of-beneficiary-phone')?.value?.trim();
  const trackingPhone = identity?.phone || undefined;

  const items = state.cart.map(i => ({
    product_id: String(i.product.id),
    quantity:   i.qty,
    confection_type: 'aucun',
    variant_combo: i.variant_combo || null,
    requested_transport_rail: i.requested_transport_rail ?? null,
  }));

  const apiResult = await apiPost('/api/orders', {
    items,
    relais_id:        od.selectedRelaisId,
    recipient_name:   recipName,
    recipient_phone:  recipPhone,
    payment_mode:     'paypal_eur',
    use_wallet:       od.use_wallet || false,
    tracking_phone:   trackingPhone,
    share_token:      state.shareToken || undefined,
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
  const recipName = document.getElementById('of-beneficiary-name')?.value?.trim() || '';
  const orderRef  = state.pendingPaypalOrderRef;
  // Reconstruire un orderData minimal pour renderOrderSuccess
  const orderData = state.lastApiResult?.order || { reference: orderRef };
  clearCart();
  state.pendingPaypalOrderRef = null;
  renderOrderSuccess(orderData, recipName, undefined, state.lastApiResult || orderData);
}
