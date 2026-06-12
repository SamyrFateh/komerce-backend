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
  BUSINESS,
} from './group/group-helpers.js';
import {
  renderCreatorCartSwitcher,
  renderCreatorArticlesPanel,
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

function renderEstimationForm(token, cart, estimAgg = { count: 0, total_estimated_kmf: 0 }) {
  const totalParticipants = Math.max(1, r(estimAgg.count)) + 1;
  const avgSuggestion = Math.ceil(r(cart.total_kmf_snapshot) / totalParticipants / 100) * 100;
  const splitHint = avgSuggestion >= 2500
    ? `<div class="k-group-split-hint">💡 À participation égale : environ ${fmt(avgSuggestion, 'KMF')} par personne</div>`
    : '';

  const saved = readParticipantCommitment(token);
  const savedState = saved ? `
      <div class="k-group-saved-commitment" id="k-ge-saved-state">
        <strong>✅ Part indiquée</strong>
        <span>${sanitize(saved.name || 'Participant')} · ${fmt(r(saved.amount), 'KMF')}</span>
        <span class="k-group-saved-note">Indicatif et modifiable — vous choisirez librement votre montant au moment de payer.</span>
        <button type="button" id="k-ge-edit-btn">✏️ Modifier ma part</button>
      </div>` : '';

  return `
    <div class="k-group-card k-group-contribute-card">
      <div class="k-group-phase-badge k-group-phase-badge--open">Panier ouvert</div>
      <div class="k-group-section-title">💸 Indiquer ma part</div>
      <p class="k-group-desc-text">
        Donnez une idée de votre participation — c'est facultatif, sans engagement,
        et ça aide le groupe à voir où en est le financement. Aucun paiement maintenant.
      </p>
      ${savedState}
      <div class="k-group-eng-fields" id="k-ge-fields" ${saved ? 'hidden' : ''}>
        <div class="k-group-mypart" id="k-ge-mypart">
          <div class="k-group-mypart-head">💰 Ma part</div>
          ${splitHint}
          <div class="k-group-field">
            <label class="k-group-label" for="k-ge-name">Votre prénom</label>
            <input id="k-ge-name" class="k-group-input" type="text" maxlength="60"
              placeholder="Ex : Fatima" autocomplete="given-name" value="${sanitize(saved?.name || '')}">
          </div>
          <div class="k-group-field">
            <label class="k-group-label" for="k-ge-phone">Téléphone (facultatif)</label>
            <input id="k-ge-phone" class="k-group-input" type="tel" maxlength="20"
              placeholder="Pour retrouver votre part plus tard" autocomplete="tel" inputmode="tel"
              value="${sanitize(saved?.phone || '')}">
          </div>
          <div class="k-group-field">
            <label class="k-group-label" for="k-ge-amount">Montant approximatif (KMF)</label>
            <input id="k-ge-amount" class="k-group-input" type="number" min="2500" step="100"
              placeholder="Ex : 5000" inputmode="numeric" value="${saved?.amount ? r(saved.amount) : ''}">
          </div>
        </div>
        <p class="k-group-input-error" id="k-ge-err"></p>
        <button class="k-group-btn k-group-btn--primary" id="k-ge-submit-btn">
          ${saved ? '✏️ Mettre à jour ma part' : '✋ Indiquer ma part'}
        </button>
        <p class="k-group-footnote">Sans identification · modifiable · non contractuel</p>
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

function renderPaymentForm(token, cart) {
  const saved = readParticipantCommitment(token);
  const prefillAmount = saved?.amount ? r(saved.amount) : '';
  const prefillName   = saved?.name   || '';
  const countdown = renderPaymentCountdown(cart);
  const remaining = r(cart.remaining_kmf ?? cart.total_kmf_snapshot ?? 0);
  const remainingHint = remaining > 0
    ? `<div class="k-group-split-hint">💳 Reste à financer : ${fmt(remaining, 'KMF')}</div>`
    : '';

  return `
    <div class="k-group-card k-group-contribute-card">
      <div class="k-group-phase-badge k-group-phase-badge--settlement">Paiement ouvert</div>
      <div class="k-group-section-title">💳 Payer ma part</div>
      <p class="k-group-desc-text">
        Le panier est fermé — la liste est définitive. Choisissez librement votre montant
        et payez en toute sécurité. Votre identité sera vérifiée au moment du paiement.
      </p>
      ${countdown}
      ${remainingHint}
      <div class="k-group-field">
        <label class="k-group-label" for="k-gp-name">Votre prénom</label>
        <input id="k-gp-name" class="k-group-input" type="text" maxlength="60"
          placeholder="Ex : Fatima" autocomplete="given-name" value="${sanitize(prefillName)}">
      </div>
      <div class="k-group-field">
        <label class="k-group-label" for="k-gp-amount">Montant (KMF)</label>
        <input id="k-gp-amount" class="k-group-input" type="number" min="2500" step="100"
          placeholder="Ex : 5000" inputmode="numeric" value="${prefillAmount}">
      </div>
      <div class="k-group-field">
        <label class="k-group-label" for="k-gp-email">Email (reçu Stripe, facultatif)</label>
        <input id="k-gp-email" class="k-group-input" type="email" maxlength="120"
          placeholder="Ex : fatima@email.com" autocomplete="email">
      </div>
      <div class="k-group-field">
        <label class="k-group-label" for="k-gp-msg">Message (optionnel)</label>
        <input id="k-gp-msg" class="k-group-input" type="text" maxlength="200"
          placeholder="Ex : Bon courage !">
      </div>
      <p class="k-group-input-error" id="k-gp-err"></p>
      <button class="k-group-btn k-group-btn--primary" id="k-gp-pay-btn">🔐 Vérifier et payer</button>
      <p class="k-group-footnote">Votre numéro sera vérifié par OTP avant le paiement</p>
    </div>`;
}

function bindPaymentForm(el, token, cart) {
  startCountdownTick();

  el.querySelector('#k-gp-pay-btn')?.addEventListener('click', async () => {
    const btn    = el.querySelector('#k-gp-pay-btn');
    const errEl  = el.querySelector('#k-gp-err');
    const name   = (el.querySelector('#k-gp-name')?.value || '').trim();
    const amount = Number(el.querySelector('#k-gp-amount')?.value);
    const email  = (el.querySelector('#k-gp-email')?.value || '').trim();
    const msg    = (el.querySelector('#k-gp-msg')?.value || '').trim();

    errEl.textContent = '';
    if (!name)                        { errEl.textContent = 'Indiquez votre prénom.'; return; }
    if (!amount || amount < 2500)     { errEl.textContent = 'Minimum 2 500 KMF.'; return; }
    if (email && !email.includes('@')) { errEl.textContent = 'Email invalide.'; return; }

    btn.disabled = true;
    btn.textContent = '🔐 Vérification OTP…';

    try {
      const identity = await requireIdentity({
        reason: 'payer ma part du panier groupe',
        title: 'Sécuriser votre paiement',
        allowOtherPhone: true,
      });

      if (!identity) {
        btn.disabled = false;
        btn.textContent = '🔐 Vérifier et payer';
        return;
      }

      const id = identityLabel(identity);
      const phone = id.phone;
      if (!phone) {
        errEl.textContent = 'Numéro introuvable après vérification. Réessayez.';
        btn.disabled = false;
        btn.textContent = '🔐 Vérifier et payer';
        return;
      }

      btn.textContent = '⏳ Création du paiement…';

      const res = await createContribution(token, {
        amount_kmf: amount,
        contributor_name: name,
        contributor_phone: phone,
        ...(email ? { contributor_email: email } : {}),
        ...(msg ? { message: msg } : {}),
      });

      if (res?.checkout_url) {
        window.location.href = res.checkout_url;
      } else {
        showToast('Contribution enregistrée !', 'success');
        btn.textContent = '✅ Enregistré';
      }
    } catch (err) {
      errEl.textContent = err?.message || 'Erreur.';
      btn.disabled = false;
      btn.textContent = '🔐 Vérifier et payer';
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

/* ── Bind actions créateur ─────────────────────────────────────── */
function bindCreatorActions(el, cart, shareUrl, cartId, onSettlement) {
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

  // S2-03 — open-settlement avec durée choisie
  el.querySelector('#k-group-open-settlement')?.addEventListener('click', async () => {
    const btn   = el.querySelector('#k-group-open-settlement');
    const errEl = el.querySelector('#k-group-settlement-err');
    const windowH = Number(el.querySelector('#k-group-settlement-window')?.value) || 48;

    if (!confirm('Bloquer les participations et ouvrir le paiement ? Les montants seront figés et les modifications du panier bloquées. Action irréversible.')) return;

    btn.disabled = true; btn.textContent = '⏳ Passage en cours…';
    errEl.textContent = '';

    try {
      await openSettlement(cartId, { settlement_window_hours: windowH });
      showToast('Participations bloquées. Les participants peuvent maintenant payer.', 'success');
      onSettlement?.();
    } catch (err) {
      errEl.textContent = err?.message || 'Erreur.';
      btn.disabled = false; btn.textContent = '🔐 Bloquer et ouvrir le paiement';
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
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Chargement…'; }

    try {
      // SC-EDIT-03 — Toujours reconstruire depuis le snapshot backend
      // (pas depuis state.cart courant qui peut être vide après N4-CLEAR
      // ou contenir un panier personnel sans rapport avec le panier collectif).
      const snap = await getSharedCartItems(cartId);

      if (!snap?.cart_items?.length) {
        showToast('Panier collectif vide — impossible de charger les articles.', 'error');
        if (btn) { btn.disabled = false; btn.textContent = '✏️ Modifier les articles'; }
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
      if (btn) { btn.disabled = false; btn.textContent = '✏️ Modifier les articles'; }
    }
  });
}




/* renderCreatorArticlesPanel → group/group-render-creator.js (lot JS-2) */

function renderParticipantItemsAccordion(items, total, cart, settlementOpen) {
  const count = items.length;

  const itemRows = items.map(it => {
    const qty      = it.quantity || 1;
    const unit     = r(it.unit_price_kmf || 0);
    const lineTotal = unit * qty;
    const img      = it.product_image || it.image_url || '';
    const thumb    = img
      ? `<img class="k-group-item-thumb" src="${sanitize(img)}" alt="" loading="lazy">`
      : `<div class="k-group-item-thumb--fallback">🛒</div>`;
    return `
      <div class="k-group-item-row--rich">
        ${thumb}
        <div class="k-group-item-body">
          <span class="k-group-item-name">${sanitize(it.product_name || it.name || 'Produit')}</span>
          <span class="k-group-item-detail">${fmt(unit, 'KMF')} × ${qty}</span>
        </div>
        <div class="k-group-item-right">
          <span class="k-group-item-total">${fmt(lineTotal, 'KMF')}</span>
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

function bindParticipantItemsAccordion(el) {
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
      <span>Créez-en un depuis votre panier avec "Payer en groupe".</span>
    </div>`;
}
function renderError(el, msg = 'Ce lien est peut-être expiré ou invalide.') {
  el.innerHTML = `
    <div class="k-group-empty">
      <div class="k-group-empty-icon">❌</div>
      <strong>Panier introuvable</strong>
      <span>${msg}</span>
    </div>`;
}

/* ══════════════════════════════════════════════════════════════════
 * POINT D'ENTRÉE
 * ══════════════════════════════════════════════════════════════════ */
export async function renderGroupView(opts = {}) {
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
    if (publicData?.estimations_summary) {
      estimAgg = {
        count: r(publicData.estimations_summary.count),
        total_estimated_kmf: r(publicData.estimations_summary.total_estimated_kmf),
      };
    } else {
      try { estimAgg = await getEstimationAggregate(participantToken); } catch (_) {}
    }

    /* ── Header premium participant ───────────────────────────────── */
    const benefName = sanitize(cart.beneficiary_name_snapshot || '');
    const headerHtml = `
      <div class="k-group-header">
        <div class="k-group-header-eyebrow">👥 Panier groupe</div>
        <h2 class="k-group-header-title">${sanitize(cart.title || 'Panier groupe')}</h2>
        ${benefName ? `<p class="k-group-subhead">Organisé pour ${benefName}</p>` : ''}
        <div class="k-group-header-meta">
          <span class="k-group-header-total">${fmt(total, 'KMF')}</span>
          <span class="k-group-header-sep">·</span>
          <span class="k-group-header-status">${statusLabel(cart.status, isPaymentPhase)}</span>
          <span class="k-group-header-sep">·</span>
          <span class="k-group-header-count">${items.length} article${items.length > 1 ? 's' : ''}</span>
        </div>
      </div>`;

    /* ── Agrégat estimations (colonne gauche, phase ouverte) ───────── */
    const estimHtml = isOpenPhase && estimAgg.count > 0 ? `
      <div class="k-group-card k-group-commitments-card">
        <div class="k-group-contribs-label">Parts indiquées</div>
        <div class="k-group-estimation-aggregate">
          <span class="k-group-estimation-count">👥 ${estimAgg.count} participant${estimAgg.count > 1 ? 's' : ''}</span>
          <span class="k-group-estimation-total">~${fmt(r(estimAgg.total_estimated_kmf), 'KMF')} estimés</span>
        </div>
        <p class="k-group-estimation-note">Indicatif · chacun choisit librement son montant au moment de payer</p>
      </div>` : '';

    /* ── Formulaire / état terminal (colonne droite aside) ──────────── */
    const creatorIdHtml = renderCreatorIdentityCard(cart);
    let asideHtml;
    if (isOpenPhase) {
      asideHtml = renderEstimationForm(participantToken, cart, estimAgg);
    } else if (isPaymentPhase) {
      asideHtml = renderPaymentForm(participantToken, cart);
    } else if (isAwaitingChoice) {
      asideHtml = `<div class="k-group-card k-group-terminal-card">
        <div class="k-group-terminal-icon">🤔</div>
        <strong>En attente de décision du créateur</strong>
        <p>La fenêtre de paiement est terminée. Le créateur va décider de la suite.</p>
      </div>`;
    } else if (isOrdered) {
      asideHtml = `<div class="k-group-card k-group-fully-paid-card">
        <div class="k-group-fully-paid-icon">✅</div>
        <strong>Commande créée — merci à tous !</strong>
      </div>`;
    } else if (isCancelled) {
      asideHtml = `<div class="k-group-card k-group-terminal-card">
        <div class="k-group-terminal-icon">❌</div>
        <strong>Panier annulé</strong>
      </div>`;
    } else {
      asideHtml = `<div class="k-group-card k-group-terminal-card">
        <div class="k-group-terminal-icon">⛔</div>
        <strong>Ce panier n'accepte plus de contribution.</strong>
      </div>`;
    }

    el.innerHTML = `
      <div class="k-group-participant-layout">
        <div class="k-group-participant-col-main">
          ${headerHtml}
          ${renderParticipantItemsAccordion(items, total, cart, isPaymentPhase)}
          ${estimHtml}
        </div>
        <div class="k-group-participant-col-aside">
          ${creatorIdHtml}
          ${asideHtml}
        </div>
      </div>`;

    /* ── Bindings (sur col-aside pour isolation des IDs) ─────────── */
    const asideEl = el.querySelector('.k-group-participant-col-aside') || el;
    bindParticipantItemsAccordion(el);

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
  try {
    const mine = await getOwnerSharedCarts();
    ownerCarts = Array.isArray(mine?.carts) ? mine.carts : [];
    ownerFetchOk = true;
  } catch (_) {
    ownerCarts = [];
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
    const restored = await ensureCreatorCartState();
    if (!restored) { renderEmpty(el); return; }
  }

  let data;
  try {
    data = await getSharedCartOwner(state.shareId);
  } catch (_) {
    data = state.shareToken ? await getSharedCartPublic(state.shareToken) : null;
  }

  // Filet de sécurité : panier clôturé/disparu côté backend entre-temps.
  // Pour le CRÉATEUR c'est "plus de panier actif", pas un lien cassé.
  const TERMINAL = ['cancelled', 'expired', 'finalized', 'converted_to_order'];
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
  const settlementOpen = isSettlementOpen(cart);
  const isCartOpen    = ['active', 'partially_funded', 'fully_funded',
                         'closed_for_settlement', 'settlement_in_progress', 'ready_to_finalize'].includes(cart.status);

  // V4.1 : le payload owner inclut estimations (Lot 4 refactorera le cockpit créateur).
  const commitmentsList = data.estimations || data.commitments || [];

  const refreshView = () => renderGroupView(opts);

  el.innerHTML = `
    <div class="k-group-cockpit">
      <div class="k-group-main-col">
        ${renderCreatorCartSwitcher(ownerCarts, cartId)}
        ${renderOwnerIdentityCard(cart, creatorItems.length)}
        ${renderCreatorFinancialSummary(cart, commitmentsList)}
        ${renderCreatorActions(cart)}
        ${renderProgress(cart, contributions, commitmentsList)}
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

  if (isCartOpen) {
    // FIX — le callback reçoit freshCommitments (rafraîchi à chaque tick)
    startPolling(cartId, (fresh, freshCommitments = commitmentsList) => {
      const card = el.querySelector('#k-group-progress-card');
      if (card) card.outerHTML = renderProgress(fresh.cart, fresh.contributions || [], freshCommitments);
      const fin = el.querySelector('#k-group-financial-summary');
      if (fin) fin.outerHTML = renderCreatorFinancialSummary(fresh.cart, freshCommitments);
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