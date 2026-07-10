/**
 * @komerce-arch
 * @role          shared-cart-boutique-view
 * @domain        shared-cart
 * @layer         ui-component
 * @criticality   critical
 * @inputs        share_token, public_cart_data, owner_identity, estimations, contributions
 * @outputs       group_view, payment_actions, creator_actions, polling, banner_state
 * @depends       group/group-api.js, group/group-state.js, group/group-helpers.js, group/group-render-creator.js, b-identity.js, b-group-banner.js
 * @used-by       b-nav.js, b-share-cart.js, public_shared_cart_links
 * @doctrine      paiement_seul_acte_engageant, estimations_indicatives, participant_peut_verifier, createur_decide_gap
 * @impact-areas  participant-flow, creator-flow, checkout, notifications, side-cart
 * @version       2026-06
 */
'use strict';

/**
 * @module b-group-view
 * @owner sélecteurs .k-group-* — onglet dédié panier partagé
 *
 * Doctrine V4.1 — deux phases :
 *
 *   PHASE OUVERTE   → Estimation facultative (prénom + montant approx, sans OTP).
 *                      Bouton : « Indiquer ma part »
 *   PHASE FERMÉE    → Paiement à montant libre, OTP au clic « Payer ».
 *                      Compte à rebours 48 h depuis payment_window_ends_at.
 *
 * Règle absolue : tout vit dans la boutique. Pas de page annexe.
 */

import { state } from './b-store.js';
import { bus } from './b-bus.js';
import { showToast } from './b-cart-core.js';
import { sanitize, fmt } from './b-utils.js';
import { saveCart } from './b-cart-core.js';  // FIX CHARGER — repeupler state.cart depuis snapshot
import { showBanner, hideBanner } from './b-group-banner.js';
import { requireIdentity } from './b-identity.js';
import {
  getOwnerSharedCarts,
  getSharedCartOwner,
  getSharedCartPublic,
  getSharedCartItems,
  getEstimationAggregate,
  upsertEstimation,
  getEstimationByPhone,
  createContribution,
  closeCart,
  openSettlement,
  extendPaymentWindow,
  finalizeSharedCart,
  cancelSharedCart,
} from './group/group-api.js';
import {
  isVisibleOwnerCart,
  sortOwnerCarts,
  pickOwnerCart,
  applyOwnerCartToState,
} from './group/group-state.js';
import {
  r,
  pct,
  statusLabel,
  metaOf,
  isSettlementOpen,
  remainingKmf,
  settlementExpiresAt,
  timeRemaining,
  businessStatusOf,
  isPaymentWindowOpen,
  paymentWindowEndsAt,
  BUSINESS,
  buildPersonalizedShareUrl,
  readPersonalizedParams,
} from './group/group-helpers.js';
import {
  renderCreatorCartSwitcher,
  renderCreatorArticlesPanel,
  renderCreatorUnifiedCard,
  renderProgress,
  renderCreatorActions,
  renderCreatorIdentityCard,
  renderOwnerIdentityCard,
  renderCreatorFinancialSummary,
} from './group/group-render-creator.js';

/* ── Token participant URL ─────────────────────────────────────── */
export function detectParticipantToken() {
  const url = new URL(window.location.href);
  const qp = url.searchParams.get('p');
  if (qp) return qp;
  const m = url.pathname.match(/\/cart\/shared\/([^/?#]+)/);
  return m ? m[1] : null;
}

/* ── Conteneur ─────────────────────────────────────────────────── */
function getOrCreateEl() {
  let el = document.getElementById('k-group-view');
  if (!el) {
    el = document.createElement('div');
    el.id = 'k-group-view';
    el.className = 'k-group-view';
    const anchor = document.getElementById('k-fav-view')
                || document.getElementById('k-catalog-section');
    anchor?.after(el);
  }
  return el;
}

/* ── Polling ───────────────────────────────────────────────────── */
let _pollTimer = null;
function startPolling(cartId, onRefresh) {
  stopPolling();
  _pollTimer = setInterval(async () => {
    if (!document.getElementById('k-group-view')?.classList.contains('show')) {
      stopPolling(); return;
    }
    try {
      const fresh = await getSharedCartOwner(cartId);
      if (!fresh) return;
      // Priorité : commitments inclus dans la réponse owner (§2.4 — Option B)
      // Fallback : fetch séparé si l'endpoint ne les inclut pas encore
      // V4.1 : le payload owner inclut estimations (renommées commitments pour
      // compatibilité Lot 3 — le cockpit créateur sera refactoré en Lot 4).
      const freshCommitments = fresh.estimations || fresh.commitments || [];
      onRefresh(fresh, freshCommitments);
    } catch (_) {}
  }, 30_000);
}
export function stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

/* r, pct, statusLabel, metaOf, isSettlementOpen, remainingKmf,
 * settlementExpiresAt, timeRemaining
 * → extraits dans group/group-helpers.js (refactor lot JS-2)
 */

/* ── Persistance participant — source unique : onglet Groupe ─────────────── */
// FRESH-060 : participant_token en localStorage — risque XSS si CSP affaiblie.
// Mitigation : TTL 24h + suppression automatique à l'expiration.
// Note : sessionStorage serait plus sûr mais casse le multi-onglets (UX critique).
// Surveillance : renforcer CSP (FRESH-030 fait) pour réduire la surface.
const PARTICIPANT_TOKEN_KEY  = 'kmrc_group_participant_token';
const PARTICIPANT_TOKEN_TTL  = 24 * 60 * 60 * 1000; // 24h en ms

function participantCommitmentKey(token) { return `kmrc_group_commitment_${token}`; }

function readJsonStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function writeJsonStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
}

function rememberParticipantToken(token) {
  if (!token) return;
  try {
    localStorage.setItem(PARTICIPANT_TOKEN_KEY, JSON.stringify({
      v: token,
      exp: Date.now() + PARTICIPANT_TOKEN_TTL,
    }));
  } catch (_) {}
}

function recallParticipantToken() {
  try {
    const raw = localStorage.getItem(PARTICIPANT_TOKEN_KEY);
    if (!raw) return null;
    // Support ancien format (string brut) et nouveau format (objet avec exp)
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return raw; } // legacy string
    if (parsed && typeof parsed === 'object' && parsed.v) {
      if (parsed.exp && Date.now() > parsed.exp) {
        localStorage.removeItem(PARTICIPANT_TOKEN_KEY);
        return null;
      }
      return parsed.v;
    }
    return raw; // fallback
  } catch (_) { return null; }
}

function clearParticipantToken() {
  try { localStorage.removeItem(PARTICIPANT_TOKEN_KEY); } catch (_) {}
}

function rememberParticipantCommitment(token, commitment) {
  if (!token || !commitment) return;
  writeJsonStorage(participantCommitmentKey(token), {
    ...commitment,
    saved_at: Date.now(),
  });
}

function readParticipantCommitment(token) {
  if (!token) return null;
  return readJsonStorage(participantCommitmentKey(token));
}

function consumeSharedPaymentReturn() {
  const url = new URL(window.location.href);
  const value = url.searchParams.get('shared_payment');
  if (!value) return null;
  try {
    url.searchParams.delete('shared_payment');
    window.history.replaceState({}, '', url.toString());
  } catch (_) {}
  return value;
}

/* settlementExpiresAt, timeRemaining
 * → extraits dans group/group-helpers.js (refactor lot JS-2)
 */


/* isVisibleOwnerCart, sortOwnerCarts, pickOwnerCart, applyOwnerCartToState
 * → extraits dans group/group-state.js (refactor lot JS-1)
 */

/* renderCreatorCartSwitcher → group/group-render-creator.js (lot JS-2) */

async function ensureCreatorCartState() {
  if (state.shareToken && state.shareId) return true;
  try {
    const mod = await import('./b-share-cart.js');
    const cart = await mod.restoreSharedCartFromBackend?.({ silent: true });
    return !!cart;
  } catch (_) {
    return false;
  }
}

function injectStyles() {
  /* CSS migré vers css/group-cart-flow.css
   * refactor(group): move group cockpit styles to CSS owner
   * Appel conservé pour compatibilité — no-op intentionnel.
   */
}

/* ══════════════════════════════════════════════════════════════════
 * FORMULAIRE D'ESTIMATION (phase ouverte) — Doctrine V4.1
 * Facultatif, modifiable, non contractuel.
 * Prénom + téléphone facultatif + montant approximatif. Aucun OTP ici.
 * ══════════════════════════════════════════════════════════════════ */

function identityLabel(user) {
  const name = user?.full_name || user?.name || user?.display_name || 'Client Komerce';
  const phone = user?.phone || user?.whatsapp_phone || user?.whatsapp || '';
  return {
    name: String(name || '').trim(),
    phone: String(phone || '').trim(),
  };
}

function renderEstimationForm(token, cart, estimAgg = { count: 0, total_estimated_kmf: 0 }, personalized = {}) {
  const saved = readParticipantCommitment(token);
  const savedState = saved ? `
      <div class="k-group-saved-commitment" id="k-ge-saved-state">
        <strong>✅ Part indiquée</strong>
        <span>${sanitize(saved.name || 'Participant')} · ${fmt(r(saved.amount), 'KMF')}</span>
        <span class="k-group-saved-note">Indicatif et modifiable — vous choisirez librement votre montant au moment de payer.</span>
        <button type="button" id="k-ge-edit-btn">✏️ Modifier ma part</button>
      </div>` : '';

  // D-04 — lien personnalisé : suggestion de l'organisateur, affichée tant
  // qu'aucune part n'a déjà été indiquée.
  const { who, amt } = personalized;
  const suggestionNote = (!saved && (who || amt)) ? `
      <p class="k-group-suggestion-note" id="k-ge-suggestion">
        ${who ? sanitize(who) + ', ' : ''}${who ? "l'organisateur suggère" : 'Montant suggéré :'}
        ${amt ? `<strong>${fmt(r(amt), 'KMF')}</strong>` : ''}
        · modifiable
      </p>` : '';

  const prefillName   = !saved && who ? sanitize(who) : sanitize(saved?.name || '');
  const prefillAmount = !saved && amt ? r(amt) : (saved?.amount ? r(saved.amount) : '');

  return `
    <div class="k-group-card k-group-contribute-card">
      ${savedState}
      <div class="k-group-eng-fields" id="k-ge-fields" ${saved ? 'hidden' : ''}>
        <div class="k-group-mypart" id="k-ge-mypart">
          <div class="k-group-mypart-head">🪙 Mon estimation</div>
          ${suggestionNote}
          <div class="k-group-field">
            <input id="k-ge-name" class="k-group-input" type="text" maxlength="60"
              placeholder="Prénom" autocomplete="given-name" value="${prefillName}">
          </div>
          <div class="k-group-field">
            <input id="k-ge-phone" class="k-group-input" type="tel" maxlength="20"
              placeholder="Téléphone (facultatif)" autocomplete="tel" inputmode="tel"
              value="${sanitize(saved?.phone || '')}">
          </div>
          <div class="k-group-field">
            <input id="k-ge-amount" class="k-group-input" type="number" min="2500" step="100"
              placeholder="Montant approximatif (KMF)" inputmode="numeric"
              value="${prefillAmount}">
          </div>
          <p class="k-group-input-error" id="k-ge-err"></p>
          <button class="k-group-btn k-group-btn--primary" id="k-ge-submit-btn">
            ${saved ? '✏️ Mettre à jour ma part' : 'Indiquer ma part'}
          </button>
          <p class="k-group-footnote">Sans identification · modifiable · non contractuel</p>
        </div>
      </div>
    </div>`;
}

function bindEstimationForm(el, token, cart, onSuccess) {
  el.querySelector('#k-ge-edit-btn')?.addEventListener('click', () => {
    el.querySelector('#k-ge-fields').hidden = false;
    el.querySelector('#k-ge-saved-state').hidden = true;
    el.querySelector('#k-ge-amount')?.focus();
  });

  el.querySelector('#k-ge-submit-btn')?.addEventListener('click', async () => {
    const fieldsDiv = el.querySelector('#k-ge-fields');
    if (fieldsDiv?.hidden) return;

    const name   = (el.querySelector('#k-ge-name')?.value || '').trim();
    const phone  = (el.querySelector('#k-ge-phone')?.value || '').trim();
    const amount = Number(el.querySelector('#k-ge-amount')?.value);
    const errEl  = el.querySelector('#k-ge-err');
    const btn    = el.querySelector('#k-ge-submit-btn');
    const idleLabel = btn.textContent.trim();

    errEl.textContent = '';
    if (!name) { errEl.textContent = 'Indiquez votre prénom.'; return; }
    if (!amount || amount < 2500) { errEl.textContent = 'Minimum 2 500 KMF.'; return; }

    btn.disabled = true;
    btn.textContent = '⏳ Enregistrement…';

    try {
      const res = await upsertEstimation(token, {
        participant_name: name,
        ...(phone ? { participant_phone: phone } : {}),
        amount_kmf: amount,
      });

      rememberParticipantToken(token);
      rememberParticipantCommitment(token, { name, phone, amount, estimationId: res?.estimation?.id });

      showToast(res?.updated ? 'Part mise à jour !' : 'Part indiquée !', 'success');
      btn.classList.add('is-done');
      btn.textContent = '✅ Part indiquée';
      setTimeout(() => onSuccess?.(), 900);
    } catch (err) {
      errEl.textContent = err?.message || 'Erreur.';
      btn.disabled = false;
      btn.textContent = idleLabel;
    }
  });
}

/* ══════════════════════════════════════════════════════════════════
 * FORMULAIRE DE PAIEMENT (phase fermée) — Doctrine V4.1
 * Montant LIBRE, pré-rempli depuis l'estimation locale.
 * OTP requis au clic « Payer » — jamais avant.
 * ══════════════════════════════════════════════════════════════════ */

function renderPaymentCountdown(cart) {
  const ends = cart.payment_window_ends_at ? new Date(cart.payment_window_ends_at) : null;
  if (!ends) return '';
  const now = Date.now();
  const diff = ends.getTime() - now;
  if (diff <= 0) return '<div class="k-group-countdown k-group-countdown--expired">Fenêtre de paiement expirée</div>';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const label = h > 0 ? `${h} h ${m.toString().padStart(2,'0')} min` : `${m} min`;
  const pct = Math.max(0, Math.min(100, (diff / (48 * 3_600_000)) * 100));
  return `
    <div class="k-group-countdown" id="k-countdown-root" data-ends="${ends.toISOString()}">
      <div class="k-group-countdown-label">⏳ Fenêtre de paiement — <strong id="k-countdown-text">${label}</strong></div>
      <div class="k-group-countdown-bar"><div class="k-group-countdown-fill" style="width:${pct.toFixed(1)}%"></div></div>
    </div>`;
}

function startCountdownTick() {
  const root = document.getElementById('k-countdown-root');
  if (!root) return;
  const ends = new Date(root.dataset.ends);
  const tick = () => {
    const diff = ends.getTime() - Date.now();
    const textEl = document.getElementById('k-countdown-text');
    const fillEl = root.querySelector('.k-group-countdown-fill');
    if (!textEl) return;
    if (diff <= 0) {
      textEl.textContent = 'Expirée';
      if (fillEl) fillEl.style.width = '0%';
      return;
    }
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    const s = Math.floor((diff % 60_000) / 1_000);
    textEl.textContent = h > 0
      ? `${h} h ${m.toString().padStart(2,'0')} min`
      : `${m}:${s.toString().padStart(2,'0')}`;
    if (fillEl) fillEl.style.width = `${Math.max(0, (diff / (48 * 3_600_000)) * 100).toFixed(1)}%`;
  };
  tick();
  const id = setInterval(tick, 10_000);
  // Nettoyage si la vue est re-renderée
  const observer = new MutationObserver(() => {
    if (!document.getElementById('k-countdown-root')) { clearInterval(id); observer.disconnect(); }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function renderPaymentForm(token, cart, personalized = {}) {
  const saved = readParticipantCommitment(token);
  const prefillAmount = saved?.amount ? r(saved.amount) : (r(personalized.amt) || '');
  const maxKmf = remainingKmf(cart); // plafond visible : ce qu'il reste à couvrir
  const hint = saved?.amount
    ? 'Pré-rempli avec votre estimation — vous pouvez régler un montant différent'
    : (prefillAmount
        ? "Montant suggéré par l'organisateur — modifiable"
        : 'Choisissez le montant que vous souhaitez régler');
  const btnLabel = prefillAmount
    ? `🔒 Régler ma part · ${fmt(prefillAmount, 'KMF')}`
    : '🔒 Régler ma part';

  return `
    <div class="k-group-card k-group-contribute-card">
      <div class="k-group-mypart k-group-mypart--payment" id="k-gp-mypart">
        <div class="k-group-mypart-head">🪙 Ma part</div>
        <div class="k-group-field">
          <input id="k-gp-amount" class="k-group-input k-group-input--amount" type="number"
            min="2500" step="100"${maxKmf > 0 ? ` max="${maxKmf}"` : ''} placeholder="Montant (KMF)" inputmode="numeric"
            value="${prefillAmount}">
        </div>
        ${maxKmf > 0 ? `<p class="k-group-payment-max">Maximum : ${fmt(maxKmf, 'KMF')}</p>` : ''}
        <p class="k-group-payment-hint">${hint}</p>
        <p class="k-group-input-error" id="k-gp-err"></p>
        <button class="k-group-btn k-group-btn--pay" id="k-gp-pay-btn">${btnLabel}</button>
        <p class="k-group-footnote">Identification OTP à cette étape uniquement</p>
      </div>
    </div>`;
}

function bindPaymentForm(el, token, cart) {
  // Mise à jour dynamique du bouton quand le montant change
  const amountInput = el.querySelector('#k-gp-amount');
  const payBtn = el.querySelector('#k-gp-pay-btn');
  const maxKmf = remainingKmf(cart);

  amountInput?.addEventListener('input', () => {
    const v = Number(amountInput.value);
    const errEl = el.querySelector('#k-gp-err');
    if (errEl) errEl.textContent = '';
    if (maxKmf > 0 && v > maxKmf) {
      if (errEl) errEl.textContent = `Maximum : ${fmt(maxKmf, 'KMF')} (reste à régler).`;
    }
    payBtn.textContent = v > 0 ? `🔒 Régler ma part · ${fmt(v, 'KMF')}` : '🔒 Régler ma part';
  });

  payBtn?.addEventListener('click', async () => {
    const errEl  = el.querySelector('#k-gp-err');
    const amount = Number(amountInput?.value);

    errEl.textContent = '';
    if (!amount || amount < 2500) { errEl.textContent = 'Minimum 2 500 KMF.'; return; }
    if (maxKmf > 0 && amount > maxKmf) {
      errEl.textContent = `Maximum : ${fmt(maxKmf, 'KMF')} (reste à régler).`;
      return;
    }

    payBtn.disabled = true;
    payBtn.textContent = '🔐 Vérification OTP…';

    try {
      const identity = await requireIdentity({
        reason: 'régler ma part du panier groupe',
        title: 'Sécuriser votre paiement',
        allowOtherPhone: true,
      });

      if (!identity) {
        payBtn.disabled = false;
        payBtn.textContent = `🔒 Régler ma part · ${fmt(amount, 'KMF')}`;
        return;
      }

      const id = identityLabel(identity);
      const phone = id.phone;
      if (!phone) {
        errEl.textContent = 'Numéro introuvable après vérification. Réessayez.';
        payBtn.disabled = false;
        payBtn.textContent = `🔒 Régler ma part · ${fmt(amount, 'KMF')}`;
        return;
      }

      payBtn.textContent = '⏳ Création du paiement…';

      const res = await createContribution(token, {
        amount_kmf: amount,
        contributor_name: id.name || 'Participant',
        contributor_phone: phone,
        contributor_email: identity.email || `${phone.replace(/\D/g,'')}@komerce.local`,
      });

      if (res?.checkout_url) {
        window.location.href = res.checkout_url;
      } else {
        showToast('Contribution enregistrée !', 'success');
        payBtn.textContent = '✅ Enregistré';
      }
    } catch (err) {
      errEl.textContent = err?.message || 'Erreur.';
      payBtn.disabled = false;
      payBtn.textContent = `🔒 Régler ma part · ${fmt(amount, 'KMF')}`;
    }
  });
}

/* ── Rendu progression ─────────────────────────────────────────── */
/* ── Rendu progression ─────────────────────────────────────────── */
/* renderProgress → group/group-render-creator.js (lot JS-2) */

/* ── Rendu actions créateur ────────────────────────────────────── */
/* renderCreatorActions → group/group-render-creator.js (lot JS-2) */

/* ── helper finalize interne ─────────────────────────────────────── */
async function doFinalize(el, cartId, shareUrl, cart, acceptPartial = false) {
  const btn   = el.querySelector(acceptPartial ? '#k-group-finalize-gap' : '#k-group-finalize');
  const errEl = el.querySelector('#k-group-finalize-err');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Validation…'; }

  try {
    const res = await finalizeSharedCart(cartId,
      acceptPartial ? { accept_partial: true } : {}
    );

    state.shareToken  = null; state.shareId = null;
    state.cartName    = ''; state.shareExpiry = null; state.shareStatus = null;
    try {
      sessionStorage.removeItem('kmrc_share');
      sessionStorage.removeItem('kmrc_banner_dismissed');
    } catch (_) {}
    refreshGroupBadge();
    hideBanner();
    import('./b-share-cart.js').then(m => m.refreshSharedBadges?.(false));

    el.innerHTML = `
      <div class="k-group-success">
        <div class="k-group-success-icon">🎉</div>
        <strong>Panier clôturé !</strong>
        <p>Commande <strong>${sanitize(res.order_reference || '')}</strong> créée.</p>
        ${res.prepaid_kmf > 0 ? `<p class="k-group-success-detail">${fmt(res.prepaid_kmf, 'KMF')} prépayés.</p>` : ''}
        ${r(res.remaining_cash_kmf) > 0 ? `<p class="k-group-success-detail"><strong>Reste à payer : ${fmt(r(res.remaining_cash_kmf), 'KMF')}</strong> (à régler au relais).</p>` : ''}
        <button class="k-group-btn k-group-btn--ghost k-group-btn--mt" id="k-group-to-track">📦 Voir ma commande</button>
      </div>`;
    bindCreatorActions(el, { ...cart, finalized_order_id: res.order_id }, shareUrl, cartId);
  } catch (err) {
    if (err?.code === 'stock_issues' || err?.message?.includes('stock')) {
      if (errEl) errEl.textContent = err.message || 'Problème de stock.';
    } else {
      showToast(err?.message || 'Erreur validation.', 'error');
    }
    if (btn) { btn.disabled = false; btn.textContent = acceptPartial ? 'Je paie le reste' : 'Confirmer la commande'; }
  }
}

/* ── GAP-B / Phase D — bloc "Lien personnalisé" ──────────────────
 * D-02 : construit l'URL ?p={token}&who=...&amt=...
 * D-06 : message WhatsApp avec lien personnalisé
 */
function bindPersonalizeBlock(el, cart, shareUrl) {
  const nameInput   = el.querySelector('#k-gc-pz-name');
  const amountInput = el.querySelector('#k-gc-pz-amount');
  const waBtn       = el.querySelector('#k-gc-pz-whatsapp');
  const copyBtn     = el.querySelector('#k-gc-pz-copy');
  if (!nameInput && !amountInput) return;

  const updateWaLabel = () => {
    const who = nameInput?.value.trim();
    if (waBtn) waBtn.textContent = who ? `📲 Envoyer à ${who}` : '📲 WhatsApp';
  };
  nameInput?.addEventListener('input', updateWaLabel);
  updateWaLabel();

  const personalizedUrl = () => buildPersonalizedShareUrl(shareUrl, {
    who: nameInput?.value,
    amt: amountInput?.value,
  });

  waBtn?.addEventListener('click', () => {
    const who = nameInput?.value.trim();
    const url = personalizedUrl();
    const msg = who
      ? `Salut ${who} ! Contribue au panier "${sanitize(cart.title || 'Panier groupe')}" → ${url}`
      : `Rejoins mon panier Komerce : "${sanitize(cart.title || 'Panier groupe')}" → ${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
  });

  copyBtn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(personalizedUrl());
      showToast('Lien personnalisé copié !', 'success');
    } catch (_) { showToast('Impossible de copier.', 'error'); }
  });
}

/* ── Bind actions créateur ─────────────────────────────────────── */
function bindCreatorActions(el, cart, shareUrl, cartId, onSettlement) {
  bindPersonalizeBlock(el, cart, shareUrl);

  el.querySelector('#k-group-reshare')?.addEventListener('click', () => {
    const msg = `Rejoins mon panier Komerce : "${sanitize(cart.title || 'Panier groupe')}" → ${shareUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
  });

  el.querySelector('#k-group-copy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('Lien copié !', 'success');
    } catch (_) { showToast('Impossible de copier.', 'error'); }
  });

  el.querySelector('#k-group-to-track')?.addEventListener('click', () => {
    import('./b-nav.js').then(({ switchView }) => {
      import('./b-tracking.js').then(({ renderTrackView }) => {
        document.querySelectorAll('.k-bnav-item, .k-header-nav-btn')
          .forEach(i => i.classList.toggle('active', i.dataset.tab === 'track'));
        renderTrackView(); switchView('track');
      });
    });
  });

  // V4.1 — Fermer le panier → ouvrir la fenêtre de paiement 48h
  el.querySelector('#k-group-close-cart')?.addEventListener('click', async () => {
    const btn   = el.querySelector('#k-group-close-cart');
    const errEl = el.querySelector('#k-group-settlement-err');

    if (!confirm('Partager le panier et ouvrir le paiement ?\nLa liste devient définitive. Les participants pourront régler leur part jusqu\'à la date limite.')) return;

    btn.disabled = true; btn.textContent = '⏳ Fermeture…';
    errEl.textContent = '';

    try {
      await closeCart(cartId);
      showToast('Panier partagé — les participants peuvent maintenant régler leur part jusqu\'à la date limite.', 'success');
      onSettlement?.();
    } catch (err) {
      errEl.textContent = err?.message || 'Erreur.';
      btn.disabled = false; btn.textContent = '📤 Partager le panier';
    }
  });

  // S2-02 — Finaliser normalement
  el.querySelector('#k-group-finalize')?.addEventListener('click', () =>
    doFinalize(el, cartId, shareUrl, cart, false)
  );

  // S2-02 — Finaliser en couvrant le gap
  el.querySelector('#k-group-finalize-gap')?.addEventListener('click', () => {
    if (!confirm('Vous allez payer le reste, puis la commande sera créée. Confirmer ?')) return;
    doFinalize(el, cartId, shareUrl, cart, true);
  });

  // S2-01 — Annuler le panier
  el.querySelector('#k-group-cancel')?.addEventListener('click', async () => {
    const hasPaidContribs = r(cart.contributed_kmf) > 0;
    const msg = hasPaidContribs
      ? `⚠️ Ce panier a des contributions payées (${r(cart.contributed_kmf).toLocaleString('fr-FR')} KMF). L'annulation nécessitera des remboursements manuels. Confirmer quand même ?`
      : 'Annuler le panier ? Cette action est irréversible.';
    if (!confirm(msg)) return;

    try {
      await cancelSharedCart(cartId, { reason: 'creator_cancel' });
      // Purge l'état local AVANT le re-render, et on attend pour que badges/banner
      // soient à jour quand la vue se reconstruit.
      await import('./b-share-cart.js').then(m => m.clearShareState?.()).catch(() => {});
      showToast('Panier annulé.', 'success');
      // Refresh avec opts vierge : on ne traîne pas l'opts.cartId du panier annulé,
      // qui pointerait sur un panier désormais non affichable.
      renderGroupView({}); // → renderEmpty si plus aucun panier actif
    } catch (err) {
      showToast(err?.message || 'Impossible d\'annuler.', 'error');
    }
  });

  // SC-EDIT-02/03 — "Modifier les articles" : charge le snapshot depuis le backend,
  // reconstruit state.cart, active le contexte edit_shared_cart, bascule vers Boutique.
  // Remplace l'ancien handler S2-06 (confirm + PUT inline) par un flux UX complet
  // conforme à la doctrine v4.2 §Chemin B.
  el.querySelector('#k-group-edit-items')?.addEventListener('click', async () => {
    const btn = el.querySelector('#k-group-edit-items');
    if (btn) { btn.style.pointerEvents = 'none'; btn.textContent = '⏳ Chargement…'; }

    try {
      // SC-EDIT-03 — Toujours reconstruire depuis le snapshot backend
      // (pas depuis state.cart courant qui peut être vide après N4-CLEAR
      // ou contenir un panier personnel sans rapport avec le panier collectif).
      const snap = await getSharedCartItems(cartId);

      if (!snap?.cart_items?.length) {
        showToast('Panier collectif vide — impossible de charger les articles.', 'error');
        if (btn) { btn.style.pointerEvents = ''; btn.textContent = '✏️ Modifier'; }
        return;
      }

      // Reconstruit state.cart depuis le snapshot (doctrine §Chemin B).
      // price_kmf = prix snapshot déjà promoé ; promo_pct/is_promo = 0/false
      // pour éviter la double application de remise dans renderSideCart/newTotal.
      // variant_label absent (non stocké dans le snapshot) → chip de variante omis, acceptable.
      state.cart = snap.cart_items.map(it => ({
        product: {
          id:        it.product_id,
          name:      it.product_name || '',
          price_kmf: it.unit_price_kmf || 0,
          image_url: it.product_image || '',
          category:  it.product_category || '',
          promo_pct: 0,
          is_promo:  false,
        },
        id:    it.product_id,
        name:  it.product_name || '',
        price: it.unit_price_kmf || 0,
        image: it.product_image || '',
        qty:   it.quantity || 1,
      }));
      saveCart(); // persiste en localStorage — badge + sidebar cohérents

      // SC-EDIT-01 — Activer le contexte d'édition
      state.editSharedCart = {
        shared_cart_id: cartId,
        token:          state.shareToken,
        return_tab:     'group',
        started_at:     Date.now(),
      };

      // SC-EDIT-02 — Basculer vers l'onglet Boutique.
      // Le side cart et le panier tiroir afficheront les CTAs edit (SC-EDIT-04/05).
      import('./b-nav.js').then(({ switchView }) => {
        document.querySelectorAll('.k-bnav-item, .k-header-nav-btn')
          .forEach(i => i.classList.toggle('active', i.dataset.tab === 'shop'));
        switchView('shop');
        // ARCH-1 : remplace window.__kmrcSideCart → bus.emit
        bus.emit('side-cart:render');
      });

      showToast('Modifiez les articles, puis cliquez "Mettre à jour le panier collectif".', 'success');
    } catch (err) {
      showToast(err?.message || 'Impossible de charger le panier sauvegardé.', 'error');
      if (btn) { btn.style.pointerEvents = ''; btn.textContent = '✏️ Modifier'; }
    }
  });
}




/* renderCreatorArticlesPanel → group/group-render-creator.js (lot JS-2) */

function renderParticipantItemsAccordion(items, total, cart, settlementOpen) {
  const count = items.length;

  const itemRows = items.map((it, i) => {
    const qty      = it.quantity || 1;
    const unit     = r(it.unit_price_kmf || 0);
    const lineTotal = unit * qty;
    const img      = it.product_image || it.image_url || '';
    const thumb    = img
      ? `<img class="k-group-item-thumb" src="${sanitize(img)}" alt="" loading="lazy">`
      : `<div class="k-group-item-thumb--fallback">🛒</div>`;
    const name     = sanitize(it.product_name || it.name || 'Produit');
    return `
      <div class="k-group-item-row--rich k-group-item-row--tap" data-item-idx="${i}"
           role="button" tabindex="0" aria-label="Voir le détail de ${name}">
        ${thumb}
        <div class="k-group-item-body">
          <span class="k-group-item-name">${name}</span>
          <span class="k-group-item-detail">${fmt(unit, 'KMF')} × ${qty}</span>
        </div>
        <div class="k-group-item-right">
          <span class="k-group-item-total">${fmt(lineTotal, 'KMF')}</span>
          <span class="k-group-item-chev" aria-hidden="true">›</span>
        </div>
      </div>`;
  }).join('') || '<p class="k-group-contrib-empty">Aucun article.</p>';

  const totalRow = count > 0 ? `
    <div class="k-group-items-total-row">
      <span>${count} article${count > 1 ? 's' : ''}</span>
      <strong>${fmt(total, 'KMF')}</strong>
    </div>` : '';

  // Replié par défaut sur mobile (garde les options d'engagement visibles
  // sans scroll) ; ouvert sur desktop si la liste est courte.
  const isDesktopVp = typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(min-width: 900px)').matches;
  const openByDefault = isDesktopVp && count <= 4;
  return `
    <div class="k-group-card k-group-items-card ${openByDefault ? 'is-open' : ''}">
      <button class="k-group-items-toggle" type="button" id="k-group-items-toggle" aria-expanded="${openByDefault ? 'true' : 'false'}">
        <span>
          <strong>${sanitize(cart.title || 'Panier groupe')}</strong><br>
          <span><span>${count} article${count > 1 ? 's' : ''}</span> · <span>${fmt(total, 'KMF')}</span> · <span>${statusLabel(cart.status, settlementOpen)}</span></span>
        </span>
        <span class="k-group-items-chevron">⌄</span>
      </button>
      <div class="k-group-items-list" id="k-group-items-list" ${openByDefault ? '' : 'hidden'}>
        ${itemRows}
        ${totalRow}
      </div>
    </div>`;
}

/* ── Fiche produit LECTURE SEULE (snapshot) — doctrine §4/§7 ──────
 * Construite UNIQUEMENT à partir des données déjà reçues (nom, image, prix,
 * catégorie). Aucun appel catalogue : le snapshot EST la vérité du panier.
 * Aucun bouton ajouter / modifier / supprimer / commander seul.
 */
function ensureSnapshotStyles() {
  /* CSS migré → css/group-cart-flow.css (doctrine §1). No-op conservé pour compat des appels. */
}

function openProductSnapshotSheet(item) {
  ensureSnapshotStyles();
  const name = sanitize(item.product_name || item.name || 'Produit');
  const cat  = item.product_category || item.category || '';
  const img  = item.product_image || item.image_url || '';
  const unit = r(item.unit_price_kmf || 0);

  const ov = document.createElement('div');
  ov.className = 'k-gsnap-overlay';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-label', `Détail produit : ${name}`);
  const media = img
    ? `<img class="k-gsnap-img" src="${sanitize(img)}" alt="${name}">`
    : `<div class="k-gsnap-img k-gsnap-img--ph">🛒</div>`;
  ov.innerHTML = `
    <div class="k-gsnap-sheet">
      ${media}
      <div class="k-gsnap-body">
        ${cat ? `<div class="k-gsnap-cat">${sanitize(cat)}</div>` : ''}
        <div class="k-gsnap-name">${name}</div>
        <div class="k-gsnap-price">${fmt(unit, 'KMF')}</div>
        <p class="k-gsnap-note">Produit consultable dans le panier partagé, disponibilité à confirmer.</p>
      </div>
      <button type="button" class="k-gsnap-back">Retour au panier partagé</button>
    </div>`;

  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.querySelector('.k-gsnap-back').addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
  setTimeout(() => ov.querySelector('.k-gsnap-back')?.focus(), 60);
}

function bindParticipantItemsAccordion(el, items = []) {
  const btn = el.querySelector('#k-group-items-toggle');
  const list = el.querySelector('#k-group-items-list');
  const card = btn?.closest('.k-group-items-card');
  if (!btn || !list) return;
  btn.addEventListener('click', () => {
    const nextOpen = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    list.hidden = !nextOpen;
    card?.classList.toggle('is-open', nextOpen);
  });

  // Doctrine §4 : chaque article ouvre une fiche LECTURE SEULE (snapshot).
  // Le participant consulte, jamais ne modifie le panier partagé.
  const openFromRow = (row) => {
    const idx = Number(row?.dataset?.itemIdx);
    if (Number.isInteger(idx) && items[idx]) openProductSnapshotSheet(items[idx]);
  };
  list.querySelectorAll('.k-group-item-row--tap').forEach(row => {
    row.addEventListener('click', () => openFromRow(row));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFromRow(row); }
    });
  });
}


/* ── Loaders ────────────────────────────────────────────────────── */
function renderLoading(el) {
  el.innerHTML = `<div class="k-group-loading"><div class="k-group-spin"></div><p>Chargement…</p></div>`;
}
function renderEmpty(el) {
  el.innerHTML = `
    <div class="k-group-empty">
      <div class="k-group-empty-icon">👥</div>
      <strong>Aucun panier groupe actif</strong>
      <span>Créez-en un depuis votre panier avec "Partager".</span>
    </div>`;
}
function renderError(el, msg = 'Ce lien est peut-être expiré ou invalide.', opts = {}) {
  // opts.retry : callback → affiche un bouton Réessayer (pannes techniques :
  // timeout, réseau, 5xx). Sans retry : erreur "métier" (lien invalide, annulé…).
  const title = opts.title || 'Panier introuvable';
  el.innerHTML = `
    <div class="k-group-empty">
      <div class="k-group-empty-icon">${opts.retry ? '⚠️' : '❌'}</div>
      <strong>${title}</strong>
      <span>${msg}</span>
      ${opts.retry ? '<button class="k-group-retry-btn" id="k-group-retry-btn">🔄 Réessayer</button>' : ''}
    </div>`;
  if (opts.retry) el.querySelector('#k-group-retry-btn')?.addEventListener('click', opts.retry);
}

/* ══════════════════════════════════════════════════════════════════
 * POINT D'ENTRÉE
 * ══════════════════════════════════════════════════════════════════ */
export async function renderGroupView(opts = {}) {
  // FIX 2026-07-10 : try/catch GLOBAL. Avant, tout rejet (fetch public pendu,
  // /mine en timeout, exception de rendu) laissait la vue sur "Chargement…"
  // pour toujours (rejet de promesse non géré). Désormais : état erreur
  // lisible + bouton Réessayer, quel que soit le point de défaillance.
  // Les timeouts eux-mêmes sont garantis par fetchWithTimeout (endpoints
  // publics) et par la couche K.request (endpoints créateur).
  try {
    await _renderGroupViewImpl(opts);
  } catch (err) {
    console.warn('[group] renderGroupView:', err);
    stopPolling();
    const el = getOrCreateEl();
    const isTimeout = !!(err && (err.isTimeout || err.name === 'TimeoutError'));
    renderError(
      el,
      isTimeout
        ? 'Le serveur met trop de temps à répondre. Vérifiez votre connexion puis réessayez.'
        : 'Une erreur est survenue lors du chargement du panier groupe.',
      { title: 'Chargement impossible', retry: () => renderGroupView(opts) }
    );
  }
}

async function _renderGroupViewImpl(opts = {}) {
  injectStyles();
  stopPolling();
  const el = getOrCreateEl();
  renderLoading(el);

  const paymentReturn = consumeSharedPaymentReturn();
  if (paymentReturn === 'success') showToast('Contribution enregistrée !', 'success');
  if (paymentReturn === 'cancel') showToast('Paiement annulé. Aucun montant prélevé.', 'info');

  const participantToken = opts.participantToken || (!state.shareToken ? recallParticipantToken() : null);
  const isCreator = !participantToken || participantToken === state.shareToken;

  /* ─────────────────────────────────────────────────────────────── */
  /* MODE PARTICIPANT                                                 */
  /* ─────────────────────────────────────────────────────────────── */
  if (!isCreator) {
    rememberParticipantToken(participantToken);
    const data = await getSharedCartPublic(participantToken);

    if (!data?.cart) { clearParticipantToken(); renderError(el); return; }
    if (data.cart.status === 'cancelled') {
      clearParticipantToken();
      renderError(el, 'Ce panier a été annulé par son créateur.');
      return;
    }
    if (data.cart.status === 'expired') {
      clearParticipantToken();
      renderError(el, 'Ce panier a expiré.');
      return;
    }
    const cart  = data.cart;
    const items = data.items || [];
    const total = r(cart.total_kmf_snapshot);
    // ── Projection V4.1 ─────────────────────────────────────────────
    const biz            = businessStatusOf(cart);
    const isOpenPhase    = biz === BUSINESS.OPEN;
    const isPaymentPhase = biz === BUSINESS.CLOSED && isPaymentWindowOpen(cart);
    const isAwaitingChoice = biz === BUSINESS.AWAITING_CHOICE;
    const isOrdered      = biz === BUSINESS.ORDERED;
    const isCancelled    = biz === BUSINESS.CANCELLED;

    // Agrégat estimations (colonne principale, phase ouverte)
    let estimAgg = { count: 0, total_estimated_kmf: 0 };
    // Le payload public contient déjà estimations_summary — réutiliser si disponible
    if (data?.estimations_summary) {
      estimAgg = {
        count: r(data.estimations_summary.count),
        total_estimated_kmf: r(data.estimations_summary.total_estimated_kmf),
      };
    } else {
      try { estimAgg = await getEstimationAggregate(participantToken); } catch (_) {}
    }

    /* ── Header participant (conforme mockup) ────────────────────── */
    const benefName = sanitize(cart.beneficiary_name_snapshot || '');
    const targetDate = cart.target_date
      ? new Date(cart.target_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
      : null;
    const daysUntilClose = cart.target_date
      ? Math.max(0, Math.ceil((new Date(cart.target_date) - Date.now()) / 86400000))
      : null;
    const countdownRemaining = isPaymentPhase ? timeRemaining(paymentWindowEndsAt(cart)) : null;

    let headerRight = '';
    if (isOpenPhase && targetDate)       headerRight = `<span class="k-group-header-right">📅 cible : ${targetDate}</span>`;
    else if (isPaymentPhase && countdownRemaining) headerRight = `<span class="k-group-header-right k-group-header-right--urgent">⏱ ${countdownRemaining}</span>`;
    // awaiting_choice → le participant voit "Fermé", pas de timer exposé

    let subtext = '';
    if (isOpenPhase && daysUntilClose !== null) subtext = `par ${benefName || 'le créateur'} · ferme dans ${daysUntilClose} jour${daysUntilClose > 1 ? 's' : ''}`;
    else if (isPaymentPhase)            subtext = 'la liste est figée · chacun paie sa part';
    else if (isAwaitingChoice)          subtext = 'la fenêtre de paiement est terminée';

    const headerHtml = `
      <div class="k-group-header">
        <div class="k-group-header-row">
          <span class="k-group-phase-badge ${isOpenPhase ? 'k-group-phase-badge--open' : isPaymentPhase ? 'k-group-phase-badge--settlement' : isAwaitingChoice ? 'k-group-phase-badge--awaiting' : ''}">${statusLabel(cart.status, isPaymentPhase)}</span>
          ${headerRight}
        </div>
        <h2 class="k-group-header-title">${sanitize(cart.title || 'Panier groupe')}</h2>
        ${subtext ? `<p class="k-group-subhead">${subtext}</p>` : ''}
      </div>`;

    /* ── Agrégat estimations (badge violet inline, mockup) ──────── */
    const estimHtml = estimAgg.count > 0 ? `
      <div class="k-group-estimation-badge">
        ~${fmt(r(estimAgg.total_estimated_kmf), 'KMF')} estimés · ${estimAgg.count} participant${estimAgg.count > 1 ? 's' : ''}
      </div>` : '';

    /* ── Barre de financement (phase paiement, mockup) ───────────── */
    const contributed = r(cart.contributed_kmf);
    const pctFunded   = total > 0 ? Math.min(100, Math.round(contributed / total * 100)) : 0;
    const progressHtml = isPaymentPhase ? `
      <div class="k-group-funding-bar">
        <div class="k-group-funding-bar-labels">
          <span>Financé</span>
          <span class="k-group-funding-bar-amounts">${fmt(contributed, 'KMF')} / ${fmt(total, 'KMF')}</span>
        </div>
        <div class="k-group-funding-bar-track">
          <div class="k-group-funding-bar-fill" style="width:${pctFunded}%"></div>
        </div>
      </div>` : '';

    /* ── Formulaire / état terminal (colonne droite aside) ──────────── */
    // GAP-C — Doctrine : 3 états seulement (OPEN / paiement ouvert / terminé).
    // AWAITING_CHOICE, ORDERED, CANCELLED et tout autre statut technique sont
    // fusionnés dans un même gabarit "terminé" — seul le texte change.
    // L'identité du créateur (creatorIdHtml) reste TOUJOURS visible, y compris
    // en état terminé : transparence maximale pour le créateur.
    const creatorIdHtml = renderCreatorIdentityCard(cart);
    const personalized = opts.personalized || {};
    let asideHtml;
    if (isOpenPhase) {
      // Afficher en priorité que le paiement n'est pas encore ouvert.
      // L'estimation reste disponible mais en position secondaire.
      const noticeHtml = `
        <div class="k-group-card k-group-status-card">
          <div class="k-group-status-notice">⏳ Paiement pas encore ouvert</div>
          <p class="k-group-status-hint">Le créateur n'a pas encore ouvert la phase de paiement. Vous pouvez indiquer votre part à titre indicatif.</p>
        </div>`;
      asideHtml = noticeHtml + renderEstimationForm(participantToken, cart, estimAgg, personalized);
    } else if (isPaymentPhase) {
      asideHtml = renderPaymentForm(participantToken, cart, personalized);
    } else {
      let icon = '⛔', title = "Ce panier n'accepte plus de contribution.", body = '';
      if (isAwaitingChoice) {
        // Ne jamais exposer "En attente de décision" au participant.
        icon  = '⛔';
        title = 'Fermé';
        body  = '';
      } else if (isOrdered) {
        icon  = '✅';
        title = 'Commande créée — merci à tous !';
      } else if (isCancelled) {
        icon  = '❌';
        title = 'Panier annulé';
      }
      asideHtml = `<div class="k-group-card k-group-terminal-card">
        <div class="k-group-terminal-icon">${icon}</div>
        <strong>${title}</strong>
        ${body}
      </div>`;
    }

    el.innerHTML = `
      <div class="k-group-participant-layout">
        <div class="k-group-participant-col-main">
          ${headerHtml}
          ${renderParticipantItemsAccordion(items, total, cart, isPaymentPhase)}
          ${estimHtml}
          ${progressHtml}
        </div>
        <div class="k-group-participant-col-aside">
          ${creatorIdHtml}
          ${asideHtml}
        </div>
      </div>`;

    /* ── Bindings (sur col-aside pour isolation des IDs) ─────────── */
    const asideEl = el.querySelector('.k-group-participant-col-aside') || el;
    bindParticipantItemsAccordion(el, items);

    if (isOpenPhase) {
      bindEstimationForm(asideEl, participantToken, cart, async () => {
        const y = window.scrollY;
        await renderGroupView({ participantToken });
        window.scrollTo(0, y);
        document.getElementById('k-ge-saved-state')
          ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    } else if (isPaymentPhase) {
      bindPaymentForm(asideEl, participantToken, cart);
    }
    return;
  }

  /* ─────────────────────────────────────────────────────────────── */
  /* MODE CRÉATEUR                                                    */
  /* ─────────────────────────────────────────────────────────────── */
  let ownerCarts = [];
  let ownerFetchOk = false;
  let ownerFetchErr = null;
  try {
    const mine = await getOwnerSharedCarts();
    ownerCarts = Array.isArray(mine?.carts) ? mine.carts : [];
    ownerFetchOk = true;
  } catch (err) {
    ownerCarts = [];
    ownerFetchErr = err;
  }

  // pickOwnerCart exclut déjà cancelled / expired / finalized / converted_to_order.
  const selectedOwnerCart = pickOwnerCart(ownerCarts, opts.cartId || state.shareId);

  if (selectedOwnerCart) {
    applyOwnerCartToState(selectedOwnerCart);
  } else if (ownerFetchOk) {
    // Le backend a répondu et ne renvoie AUCUN panier affichable (liste vide,
    // ou tous annulés/expirés/finalisés). Source de vérité : il n'y a plus de
    // panier groupe actif → état "vide", surtout PAS "introuvable".
    import('./b-share-cart.js').then(m => m.clearShareState?.()).catch(() => {});
    renderEmpty(el);
    return;
  } else {
    // /mine a échoué (réseau/auth) : dernier recours, restauration sessionStorage.
    // FIX 2026-07-10-b — ensureCreatorCartState() retombe sur restoreSharedCartFromBackend(),
    // qui retape le MÊME /mine si l'état n'est pas déjà en mémoire (cf. son early-return
    // state.shareToken/state.shareId). Si /mine a déjà timeout ci-dessus, relancer le même
    // appel ne peut que reproduire le même délai — ça double le budget global (2×10s = 20s,
    // au-delà de ce que la doctrine "timeout central" est censée garantir, cf. E13b) sans
    // aucune chance de réussir. On ne retente pas dans ce cas précis.
    const ownerTimedOut = !!(ownerFetchErr && (ownerFetchErr.isTimeout || ownerFetchErr.name === 'TimeoutError'));
    const restored = ownerTimedOut ? false : await ensureCreatorCartState();
    if (!restored) {
      // FIX 2026-07-10 : distinguer la nature de l'échec.
      //   401/403 (pas de session) → "Aucun panier actif" (comportement voulu).
      //   timeout / 5xx / réseau  → PANNE : ne pas la masquer en état vide —
      //   on propage vers le try/catch global de renderGroupView qui affiche
      //   un état erreur lisible + bouton Réessayer.
      const isAuthErr = ownerFetchErr && (ownerFetchErr.status === 401 || ownerFetchErr.status === 403);
      if (ownerFetchErr && !isAuthErr) throw ownerFetchErr;
      renderEmpty(el);
      return;
    }
  }

  let data;
  try {
    data = await getSharedCartOwner(state.shareId);
  } catch (_) {
    data = state.shareToken ? await getSharedCartPublic(state.shareToken) : null;
  }

  // Filet de sécurité : panier clôturé/disparu côté backend entre-temps.
  // Pour le CRÉATEUR c'est "plus de panier actif", pas un lien cassé.
  const TERMINAL = ['cancelled', 'expired', 'archived', 'finalized', 'converted_to_order', 'ordered'];
  if (!data?.cart || TERMINAL.includes(data.cart.status)) {
    import('./b-share-cart.js').then(m => m.clearShareState?.()).catch(() => {});
    renderEmpty(el);
    return;
  }

  const cart          = data.cart;
  const contributions = data.contributions || [];
  const cartId        = state.shareId || cart.id;
  const shareUrl      = data.share_url || state.shareUrl || `${window.location.origin}/boutique/?p=${state.shareToken}`;

  let creatorItems = [];
  try {
    const snap = await getSharedCartItems(cartId);
    creatorItems = snap?.cart_items || [];
  } catch (_) {
    creatorItems = data.items || data.cart_items || [];
  }
  const bizCreator = businessStatusOf(cart);
  const isCartLive = [BUSINESS.OPEN, BUSINESS.CLOSED, BUSINESS.AWAITING_CHOICE].includes(bizCreator);

  // V4.1 : le payload owner inclut estimations.
  const estimationsList = data.estimations || [];

  const refreshView = () => renderGroupView(opts);

  el.innerHTML = `
    <div class="k-group-cockpit">
      <div class="k-group-main-col">
        ${renderCreatorCartSwitcher(ownerCarts, cartId)}
        ${renderCreatorUnifiedCard(cart, estimationsList, contributions, creatorItems, shareUrl)}
      </div>
      ${renderCreatorArticlesPanel(creatorItems, cart)}
    </div>`;

  el.querySelectorAll('[data-k-group-cart-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const nextId = btn.dataset.kGroupCartId;
      if (!nextId || String(nextId) === String(cartId)) return;
      renderGroupView({ ...opts, cartId: nextId });
    });
  });

  bindCreatorActions(el, cart, shareUrl, cartId, refreshView);
  hideBanner();

  if (isCartLive) {
    startPolling(cartId, (fresh, freshEstimations = estimationsList) => {
      const unified = el.querySelector('#k-group-unified-card');
      if (unified) {
        unified.outerHTML = renderCreatorUnifiedCard(
          fresh.cart, freshEstimations, fresh.contributions || [], creatorItems, shareUrl
        );
        bindCreatorActions(el, fresh.cart, shareUrl, cartId, refreshView);
      }
      import('./b-share-cart.js').then(m => m.refreshSharedBadges?.(true, fresh.cart));
    });
  }
}

/* ── Badge ─────────────────────────────────────────────────────── */
export function refreshGroupBadge() {
  const has = !!state.shareToken;
  document.getElementById('k-bnav-group-badge')?.classList.toggle('show', has);
  document.getElementById('k-header-group-badge')?.classList.toggle('show', has);
  document.getElementById('k-header-group-btn')?.classList.toggle('has-active', has);
}