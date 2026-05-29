/**
 * @module b-group-view
 * @owner sélecteurs .k-group-* — onglet dédié panier partagé
 *
 * Doctrine v4 — deux phases distinctes :
 *
 *   PHASE OUVERTE (metadata.settlement_open = false)
 *     → Participant : formulaire d'engagement indicatif (nom + téléphone + montant)
 *       Aucun Stripe. Bouton : "Enregistrer mon engagement"
 *     → Créateur : voir les engagements, modifier le panier, bouton "Passer au règlement"
 *
 *   PHASE RÈGLEMENT (metadata.settlement_open = true)
 *     → Participant : saisit son téléphone, retrouve son engagement verrouillé,
 *       voit le montant fixé, bouton "Payer X KMF" → Stripe Checkout
 *     → Créateur : suivi des paiements, finalisation possible
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
  getCommitments,
  createCommitment,
  lookupCommitmentByPhone,
  createContribution,
  openSettlement,
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
} from './group/group-helpers.js';
import {
  renderCreatorCartSwitcher,
  renderCreatorMiniGuide,
  renderCreatorArticlesPanel,
  renderProgress,
  renderCreatorActions,
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
      let freshCommitments = fresh.commitments || [];
      if (!freshCommitments.length) {
        try {
          const token = fresh.cart?.token;
          if (token) freshCommitments = await getCommitments(token);
        } catch (_) {}
      }
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
const PARTICIPANT_TOKEN_KEY = 'kmrc_group_participant_token';
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
  try { localStorage.setItem(PARTICIPANT_TOKEN_KEY, token); } catch (_) {}
}

function recallParticipantToken() {
  try { return localStorage.getItem(PARTICIPANT_TOKEN_KEY) || null; } catch (_) { return null; }
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
 * FORMULAIRE D'ENGAGEMENT (phase ouverte)
 * Collecte : nom + téléphone + montant indicatif
 * Aucun Stripe, aucun paiement.
 * ══════════════════════════════════════════════════════════════════ */

function identityLabel(user) {
  const name = user?.full_name || user?.name || user?.display_name || 'Client Komerce';
  const phone = user?.phone || user?.whatsapp_phone || user?.whatsapp || '';
  return {
    name: String(name || '').trim(),
    phone: String(phone || '').trim(),
  };
}

function renderEngagementForm(token, cart, isCreator = false) {
  const meta = metaOf(cart);
  const lockedTotal = r(meta.locked_commitments_total_kmf || 0);
  const suggestion = lockedTotal > 0
    ? Math.round(r(cart.total_kmf_snapshot) / Math.max(1, r(meta.locked_commitments_count || 1) + 1) / 100) * 100
    : 0;
  // TX-02 — montant moyen suggéré (hint visible dans la vue groupe)
  const totalParticipants = r(meta.locked_commitments_count || 0) + 1;
  const avgSuggestion = Math.ceil(r(cart.total_kmf_snapshot) / totalParticipants / 100) * 100;
  const splitHint = avgSuggestion >= 2500
    ? `<div class="k-group-split-hint">💡 À participation égale : environ ${fmt(avgSuggestion, 'KMF')} par personne</div>`
    : '';

  const saved = !isCreator ? readParticipantCommitment(token) : null;
  const savedState = saved ? `
      <div class="k-group-saved-commitment" id="k-ge-saved-state">
        <strong>✅ Engagement enregistré</strong>
        <span>${sanitize(saved.name || 'Participant')} · ${fmt(r(saved.amount), 'KMF')}</span>
        ${saved.phone ? `<span>Téléphone : ${sanitize(saved.phone)}</span>` : ''}
        <button type="button" id="k-ge-edit-btn">✏️ Modifier mon engagement</button>
      </div>` : '';

  return `
    <div class="k-group-card k-group-contribute-card">
      <div class="k-group-phase-badge k-group-phase-badge--open">Phase ouverte — concertation</div>
      <div class="k-group-section-title">${isCreator ? '💸 Enregistrer ma participation' : '💸 Participer'}</div>
      <p style="font-size:13px;color:var(--text-muted);margin:0 0 12px">
        Indiquez votre engagement indicatif. Aucun paiement maintenant — vous paierez quand le créateur lancera le règlement.
      </p>
      ${splitHint}
      ${savedState}
      <div class="k-group-eng-fields" id="k-ge-fields" ${saved ? 'hidden' : ''}>
        <div class="k-group-identity-note">
          <strong>Identité sécurisée par OTP</strong>
          <span>Votre numéro vérifié sera utilisé pour retrouver cet engagement. Vous pourrez utiliser un autre numéro si besoin.</span>
        </div>
        <div class="k-group-field">
          <label class="k-group-label" for="k-ge-amount">Montant d'engagement (KMF)</label>
          <input id="k-ge-amount" class="k-group-input" type="number" min="500" step="100"
            placeholder="${suggestion > 0 ? `Suggestion : ${fmt(suggestion, 'KMF')}` : 'Ex : 5000'}"
            inputmode="numeric" value="${saved?.amount ? r(saved.amount) : ''}">
        </div>
        <div class="k-group-field">
          <label class="k-group-label" for="k-ge-msg">Message (optionnel)</label>
          <input id="k-ge-msg" class="k-group-input" type="text" placeholder="Ex : Je participe avec plaisir !" maxlength="200" value="${sanitize(saved?.message || '')}">
        </div>
        <p class="k-group-input-error" id="k-ge-err"></p>
        <button class="k-group-btn k-group-btn--primary" id="k-ge-submit-btn">
          ${saved ? '✏️ Mettre à jour mon engagement' : '✋ Enregistrer mon engagement'}
        </button>
      </div>
    </div>`;
}

function bindEngagementForm(el, token, cart, onSuccess) {
  el.querySelector('#k-ge-edit-btn')?.addEventListener('click', () => {
    const fields = el.querySelector('#k-ge-fields');
    const saved = el.querySelector('#k-ge-saved-state');
    if (fields) fields.hidden = false;
    if (saved) saved.hidden = true;
    el.querySelector('#k-ge-amount')?.focus();
  });

  el.querySelector('#k-ge-submit-btn')?.addEventListener('click', async () => {
    const amount = Number(el.querySelector('#k-ge-amount')?.value);
    const msg    = (el.querySelector('#k-ge-msg')?.value || '').trim();
    const errEl  = el.querySelector('#k-ge-err');
    const btn    = el.querySelector('#k-ge-submit-btn');

    errEl.textContent = '';
    if (!amount || amount < 500) { errEl.textContent = 'Minimum 500 KMF.'; return; }

    btn.disabled = true;
    btn.textContent = '🔐 Vérification…';

    try {
      const identity = await requireIdentity({
        reason: 'participer au panier',
        title: 'Sécuriser votre participation',
        allowOtherPhone: true,
      });

      if (!identity) {
        btn.disabled = false;
        btn.textContent = '✋ Enregistrer mon engagement';
        return;
      }

      const id = identityLabel(identity);
      const name = id.name || 'Client Komerce';
      const phone = id.phone;

      if (!phone) {
        errEl.textContent = 'Numéro vérifié introuvable. Réessayez avec un autre numéro.';
        btn.disabled = false;
        btn.textContent = '✋ Enregistrer mon engagement';
        return;
      }

      btn.textContent = '⏳ Enregistrement…';

      const res = await createCommitment(token, {
        participant_name: name,
        participant_phone: phone,
        amount_kmf: amount,
        ...(msg ? { message: msg } : {}),
      });

      rememberParticipantToken(token);
      rememberParticipantCommitment(token, { name, phone, amount, message: msg });

      showToast(res?.updated ? 'Engagement mis à jour !' : 'Engagement enregistré !', 'success');
      btn.disabled = false;
      btn.textContent = '✅ Engagement enregistré';
      onSuccess?.();
    } catch (err) {
      errEl.textContent = err?.message || 'Erreur.';
      btn.disabled = false;
      btn.textContent = '✋ Enregistrer mon engagement';
    }
  });
}

/* ══════════════════════════════════════════════════════════════════
 * FORMULAIRE DE PAIEMENT (phase règlement)
 * Le participant saisit son téléphone → lookup commitment verrouillé
 * → affichage du montant fixe → bouton "Payer X KMF" → Stripe Checkout
 * ══════════════════════════════════════════════════════════════════ */
function renderPaymentForm(token, cart) {
  return `
    <div class="k-group-card k-group-contribute-card">
      <div class="k-group-phase-badge k-group-phase-badge--settlement">Phase règlement — paiement</div>
      <div class="k-group-section-title">💳 Payer ma contribution</div>
      <p style="font-size:13px;color:var(--text-muted);margin:0 0 10px">
        Le panier est passé au règlement. Komerce utilise votre numéro vérifié pour retrouver votre engagement verrouillé.
      </p>
      <div class="k-group-identity-note">
        <strong>Identité sécurisée par OTP</strong>
        <span>Vous pouvez continuer avec le numéro reconnu ou utiliser un autre numéro si l'engagement est rattaché ailleurs.</span>
      </div>
      <p class="k-group-input-error" id="k-gp-lookup-err"></p>
      <button class="k-group-btn k-group-btn--ghost" id="k-gp-lookup-btn">🔐 Retrouver mon engagement</button>

      <!-- Zone affichée après lookup -->
      <div id="k-gp-locked-zone" style="display:none;margin-top:14px">
        <div class="k-group-locked-amount">
          <div>
            <span>Votre engagement verrouillé</span><br>
            <strong id="k-gp-locked-amount-text">—</strong>
          </div>
          <span style="font-size:22px">🔐</span>
        </div>
        <div class="k-group-field" style="margin-top:10px">
          <label class="k-group-label" for="k-gp-name">Votre prénom (pour la confirmation)</label>
          <input id="k-gp-name" class="k-group-input" type="text" placeholder="Ex : Fatima" maxlength="60" autocomplete="given-name">
        </div>
        <div class="k-group-field">
          <label class="k-group-label" for="k-gp-email">Email (reçu de paiement Stripe)</label>
          <input id="k-gp-email" class="k-group-input" type="email" placeholder="Ex : fatima@email.com" maxlength="120" autocomplete="email">
        </div>
        <div class="k-group-field">
          <label class="k-group-label" for="k-gp-msg">Message (optionnel)</label>
          <input id="k-gp-msg" class="k-group-input" type="text" placeholder="Ex : Bon courage !" maxlength="200">
        </div>
        <p class="k-group-input-error" id="k-gp-pay-err"></p>
        <button class="k-group-btn k-group-btn--primary" id="k-gp-pay-btn" data-amount="0" data-phone="">
          💳 Payer —
        </button>
      </div>
    </div>`;
}

function bindPaymentForm(el, token, cart) {
  const lookupBtn = el.querySelector('#k-gp-lookup-btn');
  lookupBtn?.addEventListener('click', async () => {
    const errEl = el.querySelector('#k-gp-lookup-err');
    errEl.textContent = '';

    lookupBtn.disabled = true;
    lookupBtn.textContent = '🔐 Vérification…';

    try {
      const identity = await requireIdentity({
        reason: 'payer ma contribution',
        title: 'Sécuriser votre paiement',
        allowOtherPhone: true,
      });

      if (!identity) {
        lookupBtn.disabled = false;
        lookupBtn.textContent = '🔐 Retrouver mon engagement';
        return;
      }

      const id = identityLabel(identity);
      const phone = id.phone;

      if (!phone) {
        throw new Error('Numéro vérifié introuvable. Réessayez avec un autre numéro.');
      }

      lookupBtn.textContent = '⏳ Recherche…';

      const res = await lookupCommitmentByPhone(token, phone);
      const c = res?.commitment;
      if (!c) throw new Error('Aucun engagement verrouillé trouvé pour ce numéro.');

      const zone        = el.querySelector('#k-gp-locked-zone');
      const amountEl    = el.querySelector('#k-gp-locked-amount-text');
      const payBtn      = el.querySelector('#k-gp-pay-btn');
      const nameInput   = el.querySelector('#k-gp-name');

      amountEl.textContent = fmt(r(c.amount_kmf), 'KMF');
      payBtn.textContent   = `💳 Payer ${fmt(r(c.amount_kmf), 'KMF')}`;
      payBtn.dataset.amount = String(c.amount_kmf);
      payBtn.dataset.phone  = phone;

      if (nameInput) {
        nameInput.value = c.participant_name || id.name || 'Client Komerce';
      }

      zone.style.display = '';
      lookupBtn.textContent = '✅ Engagement trouvé';
    } catch (err) {
      errEl.textContent = err?.message || 'Aucun engagement verrouillé pour ce numéro.';
      lookupBtn.disabled = false;
      lookupBtn.textContent = '🔐 Retrouver mon engagement';
    }
  });

  el.querySelector('#k-gp-pay-btn')?.addEventListener('click', async () => {
    const payBtn = el.querySelector('#k-gp-pay-btn');
    const errEl  = el.querySelector('#k-gp-pay-err');
    const name   = (el.querySelector('#k-gp-name')?.value || '').trim();
    const email  = (el.querySelector('#k-gp-email')?.value || '').trim();
    const msg    = (el.querySelector('#k-gp-msg')?.value || '').trim();
    const amount = Number(payBtn.dataset.amount);
    const phone  = payBtn.dataset.phone;

    errEl.textContent = '';
    if (!name)                       { errEl.textContent = 'Prénom requis.'; return; }
    if (!email || !email.includes('@')) { errEl.textContent = 'Email valide requis.'; return; }
    if (!amount)                     { errEl.textContent = 'Montant invalide.'; return; }

    payBtn.disabled = true; payBtn.textContent = '⏳ Redirection…';

    try {
      const res = await createContribution(token, {
        amount_kmf: amount,
        contributor_name: name,
        contributor_email: email,
        contributor_phone: phone,
        ...(msg ? { message: msg } : {}),
      });
      if (res?.checkout_url) {
        window.location.href = res.checkout_url;
      } else {
        showToast('Contribution enregistrée !', 'success');
        payBtn.textContent = '✅ Enregistré';
      }
    } catch (err) {
      errEl.textContent = err?.message || 'Erreur.';
      payBtn.disabled = false; payBtn.textContent = `💳 Payer ${fmt(amount, 'KMF')}`;
    }
  });
}

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
        <button class="k-group-btn k-group-btn--ghost k-group-btn--mt" id="k-group-to-track">📦 Voir ma commande</button>
      </div>`;
    bindCreatorActions(el, { ...cart, finalized_order_id: res.order_id }, shareUrl, cartId);
  } catch (err) {
    if (err?.code === 'stock_issues' || err?.message?.includes('stock')) {
      if (errEl) errEl.textContent = err.message || 'Problème de stock.';
    } else {
      showToast(err?.message || 'Erreur validation.', 'error');
    }
    if (btn) { btn.disabled = false; btn.textContent = acceptPartial ? 'Je couvre le reste et je valide' : '✓ Valider et commander'; }
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

    if (!confirm('Passer au règlement ? Les engagements seront verrouillés et les modifications du panier seront bloquées. Action irréversible.')) return;

    btn.disabled = true; btn.textContent = '⏳ Passage en cours…';
    errEl.textContent = '';

    try {
      await openSettlement(cartId, { settlement_window_hours: windowH });
      showToast('Panier passé au règlement. Les participants peuvent maintenant payer.', 'success');
      onSettlement?.();
    } catch (err) {
      errEl.textContent = err?.message || 'Erreur.';
      btn.disabled = false; btn.textContent = '🔐 Passer au règlement';
    }
  });

  // S2-02 — Finaliser normalement
  el.querySelector('#k-group-finalize')?.addEventListener('click', () =>
    doFinalize(el, cartId, shareUrl, cart, false)
  );

  // S2-02 — Finaliser en couvrant le gap
  el.querySelector('#k-group-finalize-gap')?.addEventListener('click', () => {
    if (!confirm('Vous allez couvrir le montant manquant et valider la commande. Confirmer ?')) return;
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
      import('./b-share-cart.js').then(m => m.clearShareState?.());
      showToast('Panier annulé.', 'success');
      onSettlement?.(); // refresh la vue
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




/* renderCreatorMiniGuide → group/group-render-creator.js (lot JS-2) */

/* renderCreatorArticlesPanel → group/group-render-creator.js (lot JS-2) */

function renderParticipantItemsAccordion(items, total, cart, settlementOpen) {
  const itemRows = items.map(it => `
    <div class="k-group-item-row">
      <span class="k-group-item-name">${sanitize(it.name || 'Produit')}</span>
      <span class="k-group-item-qty">×${it.quantity || 1}</span>
      <span class="k-group-item-price">${fmt(r(it.unit_price_kmf), 'KMF')}</span>
    </div>`).join('') || '<p class="k-group-contrib-empty">Aucun article.</p>';

  const count = items.length;
  const openByDefault = count <= 3;
  return `
    <div class="k-group-card k-group-items-card ${openByDefault ? 'is-open' : ''}">
      <button class="k-group-items-toggle" type="button" id="k-group-items-toggle" aria-expanded="${openByDefault ? 'true' : 'false'}">
        <span>
          <strong>${sanitize(cart.title || 'Panier groupe')}</strong><br>
          <span>Total : ${fmt(total, 'KMF')} · ${statusLabel(cart.status, settlementOpen)} · ${count} article${count > 1 ? 's' : ''}</span>
        </span>
        <span class="k-group-items-chevron">⌄</span>
      </button>
      <div class="k-group-items-list" id="k-group-items-list" ${openByDefault ? '' : 'hidden'}>
        ${itemRows}
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
function renderError(el) {
  el.innerHTML = `
    <div class="k-group-empty">
      <div class="k-group-empty-icon">❌</div>
      <strong>Panier introuvable</strong>
      <span>Ce lien est peut-être expiré ou invalide.</span>
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
    const cart  = data.cart;
    const items = data.items || [];
    const total = r(cart.total_kmf_snapshot);
    const settlementOpen = isSettlementOpen(cart);
    const isCartOpen = ['active', 'partially_funded'].includes(cart.status);

    let commitmentsList = [];
    try {
      commitmentsList = await getCommitments(participantToken);
    } catch (_) {}

    el.innerHTML = `
      <div class="k-group-header">
        <h2>👥 Panier groupe</h2>
        <p class="k-group-subhead">Panier de ${sanitize(cart.beneficiary_name_snapshot || '')}.</p>
      </div>
      ${renderParticipantItemsAccordion(items, total, cart, settlementOpen)}
      ${commitmentsList.length > 0 ? `
        <div class="k-group-card" style="padding:14px 16px">
          <div class="k-group-contribs-label">Engagements ${settlementOpen ? 'verrouillés' : 'indicatifs'} (${commitmentsList.length})</div>
          <div class="k-group-commitment-list">
            ${commitmentsList.map(c => `
              <div class="k-group-commitment-row">
                <span class="k-group-commitment-name">${sanitize(c.participant_name?.split(' ')[0] || 'Participant')}</span>
                <span class="k-group-commitment-amount">${fmt(r(c.amount_kmf), 'KMF')}</span>
              </div>`).join('')}
          </div>
        </div>` : ''}
      ${isCartOpen && !settlementOpen
        ? renderEngagementForm(participantToken, cart, false)
        : isCartOpen && settlementOpen
          ? renderPaymentForm(participantToken, cart)
          : `<div class="k-group-card"><strong>${
              cart.status === 'fully_funded' ? '✅ Panier financé, merci !' : "Ce panier n'accepte plus de contribution."
            }</strong></div>`}`;

    bindParticipantItemsAccordion(el);

    if (isCartOpen && !settlementOpen) {
      bindEngagementForm(el, participantToken, cart, () => renderGroupView({ participantToken }));
    } else if (isCartOpen && settlementOpen) {
      bindPaymentForm(el, participantToken, cart);
    }
    return;
  }

  /* ─────────────────────────────────────────────────────────────── */
  /* MODE CRÉATEUR                                                    */
  /* ─────────────────────────────────────────────────────────────── */
  let ownerCarts = [];
  try {
    const mine = await getOwnerSharedCarts();
    ownerCarts = Array.isArray(mine?.carts) ? mine.carts : [];
  } catch (_) {
    ownerCarts = [];
  }

  if (ownerCarts.length) {
    const selectedOwnerCart = pickOwnerCart(ownerCarts, opts.cartId || state.shareId);
    if (selectedOwnerCart) {
      applyOwnerCartToState(selectedOwnerCart);
    }
  } else if (!state.shareToken || !state.shareId) {
    const restored = await ensureCreatorCartState();
    if (!restored) { renderEmpty(el); return; }
  }

  let data;
  try {
    data = await getSharedCartOwner(state.shareId);
  } catch (_) {
    data = await getSharedCartPublic(state.shareToken);
  }

  if (!data?.cart) { renderError(el); return; }

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
  const isCartOpen    = ['active', 'partially_funded', 'fully_funded'].includes(cart.status);

  let commitmentsList = data.commitments || [];
  // Fallback : si l'endpoint owner ne les inclut pas encore (compatibilité transitoire),
  // on tente le fetch séparé
  if (!commitmentsList.length && state.shareToken) {
    try {
      commitmentsList = await getCommitments(state.shareToken);
    } catch (_) {}
  }

  const showSelfForm = isCartOpen && cart.status !== 'fully_funded' && remainingKmf(cart) > 0;

  const refreshView = () => renderGroupView(opts);

  el.innerHTML = `
    <div class="k-group-cockpit">
      <div class="k-group-main-col">
        <div class="k-group-header">
          <h2>👥 Mon panier groupe</h2>
          <p class="k-group-subhead">${settlementOpen
            ? '🔐 Panier en règlement — les participants peuvent maintenant payer.'
            : 'Phase de concertation — partagez le lien et collectez les engagements.'}</p>
        </div>
        ${renderCreatorCartSwitcher(ownerCarts, cartId)}
        ${renderCreatorMiniGuide(settlementOpen)}
        ${renderProgress(cart, contributions, commitmentsList)}
        ${showSelfForm && !settlementOpen ? `
          <button class="k-group-self-toggle" id="k-group-self-toggle" type="button">Je veux aussi m'engager</button>
          <div class="k-group-self-panel" id="k-group-self-panel" hidden>
            ${renderEngagementForm(state.shareToken, cart, true)}
          </div>` : ''}
        ${showSelfForm && settlementOpen ? `
          <button class="k-group-self-toggle" id="k-group-self-toggle" type="button">Je veux aussi payer</button>
          <div class="k-group-self-panel" id="k-group-self-panel" hidden>
            ${renderPaymentForm(state.shareToken, cart)}
          </div>` : ''}
        ${renderCreatorActions(cart)}
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

  if (showSelfForm) {
    el.querySelector('#k-group-self-toggle')?.addEventListener('click', () => {
      const panel = el.querySelector('#k-group-self-panel');
      if (panel) panel.hidden = !panel.hidden;
    });
    if (!settlementOpen) {
      bindEngagementForm(el, state.shareToken, cart, refreshView);
    } else {
      bindPaymentForm(el, state.shareToken, cart);
    }
  }

  bindCreatorActions(el, cart, shareUrl, cartId, refreshView);
  hideBanner();

  if (isCartOpen) {
    // FIX — le callback reçoit freshCommitments (rafraîchi à chaque tick)
    startPolling(cartId, (fresh, freshCommitments = commitmentsList) => {
      const card = el.querySelector('#k-group-progress-card');
      if (card) card.outerHTML = renderProgress(fresh.cart, fresh.contributions || [], freshCommitments);
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