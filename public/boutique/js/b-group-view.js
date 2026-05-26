/**
 * @module b-group-view
 * @owner sélecteurs .k-group-* — onglet dédié panier partagé
 *
 * Doctrine v4.1 — Mai 2026 :
 *   - panier ouvert = concertation + engagements indicatifs ;
 *   - aucun paiement tant que le créateur n'a pas fait “Passer au règlement” ;
 *   - panier en règlement = engagements verrouillés + paiements réels ;
 *   - la bannière n'est qu'un rappel, le suivi réel vit ici.
 */

import { state } from './b-store.js';
import { showToast } from './b-cart-core.js';
import { sanitize, fmt, apiGet, apiPost } from './b-utils.js';
import { showBanner, hideBanner } from './b-group-banner.js';

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
      const fresh = await apiGet(`/api/shared-carts/${cartId}`);
      if (fresh) onRefresh(fresh);
    } catch (_) {}
  }, 30_000);
}
function stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

/* ── Helpers ───────────────────────────────────────────────────── */
function r(n) { return Math.round(Number(n) || 0); }

function metadataOf(cart) {
  if (!cart?.metadata) return {};
  if (typeof cart.metadata === 'object') return cart.metadata;
  try { return JSON.parse(cart.metadata); } catch (_) { return {}; }
}

function isSettlementOpen(cart) {
  const meta = metadataOf(cart);
  return meta.settlement_open === true || ['closed_for_settlement', 'settlement_in_progress', 'ready_to_finalize'].includes(cart?.status);
}

function isTerminal(cart) {
  return ['converted_to_order', 'finalized', 'cancelled', 'expired', 'refunded'].includes(cart?.status);
}

function isOpenConcertation(cart) {
  return !isTerminal(cart) && !isSettlementOpen(cart) && ['draft', 'active', 'commitment_open'].includes(cart?.status || 'active');
}

function pct(done, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

function statusLabel(cart) {
  if (isSettlementOpen(cart)) return '🟣 En règlement';
  return {
    draft: '🟢 Panier ouvert',
    active: '🟢 Panier ouvert',
    commitment_open: '🟢 Concertation',
    partially_funded: '🟣 En règlement',
    fully_funded: '✅ Réglé',
    converted_to_order: '📦 Commande créée',
    finalized: '📦 Commande créée',
    cancelled: '❌ Annulé',
    expired: '⏱️ Expiré',
    refunded: '↩️ Remboursé',
  }[cart?.status] || cart?.status || 'Panier groupe';
}

function remainingKmf(cart) {
  const total = r(cart.total_kmf_snapshot);
  const confirmed = r(cart.contributed_kmf);
  return Math.max(0, r(cart.remaining_kmf) || total - confirmed);
}

function commitmentTotal(commitments = []) {
  return commitments
    .filter(c => !['withdrawn', 'cancelled'].includes(c.status))
    .reduce((sum, c) => sum + r(c.amount_kmf), 0);
}

function avgSuggestion(cart, commitments = []) {
  const total = r(cart.total_kmf_snapshot);
  const count = Math.max(1, commitments.filter(c => !['withdrawn', 'cancelled'].includes(c.status)).length || 1);
  return r(total / count);
}

async function loadCommitments(token) {
  if (!token) return [];
  const data = await fetch(`/api/shared-carts/public/${token}/commitments`, { credentials: 'include' })
    .then(rsp => rsp.ok ? rsp.json() : null)
    .catch(() => null);
  return data?.commitments || [];
}

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

function showGroupStyles() {
  if (document.getElementById('k-group-view-v4-styles')) return;
  const s = document.createElement('style');
  s.id = 'k-group-view-v4-styles';
  s.textContent = `
.k-group-phase{border:1px solid rgba(255,122,61,.24);background:rgba(255,122,61,.08);border-radius:18px;padding:14px;margin:12px 0;color:var(--text)}
.k-group-phase strong{display:block;font-size:15px;margin-bottom:5px}.k-group-phase span{font-size:12px;color:var(--text-muted);line-height:1.45}
.k-group-disabled-finalize{opacity:.72;cursor:not-allowed!important;background:var(--sand-dark)!important;color:var(--text-muted)!important}
.k-group-share-hint,.k-group-finalize-hint,.k-group-small-hint{font-size:12px;line-height:1.45;color:var(--text-muted);margin:10px 0 0}
.k-group-self-toggle{margin-top:12px;width:100%;border:1px dashed var(--border);background:var(--sand);color:var(--text);border-radius:14px;padding:11px;font-weight:800;cursor:pointer}
.k-group-self-panel[hidden]{display:none!important}
.k-group-commit-row{display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid rgba(0,0,0,.06)}
.k-group-commit-row:last-child{border-bottom:0}.k-group-commit-name{font-weight:800}.k-group-commit-status{font-size:12px;color:var(--text-muted)}
.k-group-action-split{display:grid;grid-template-columns:1fr 1fr;gap:10px}.k-group-btn--settlement{background:var(--coral);color:white}`;
  document.head.appendChild(s);
}

/* ── Rendu items ───────────────────────────────────────────────── */
function renderItems(items = []) {
  const itemRows = items.map(it => `
    <div class="k-group-item-row">
      <span class="k-group-item-name">${sanitize(it.name || it.product_name_snapshot || 'Produit')}</span>
      <span class="k-group-item-qty">×${r(it.quantity || 1)}</span>
      <span class="k-group-item-price">${fmt(r(it.unit_price_kmf || it.unit_price_kmf_snapshot), 'KMF')}</span>
    </div>`).join('') || '<p class="k-group-contrib-empty">Aucun article.</p>';

  return `<div class="k-group-items-list">${itemRows}</div>`;
}

/* ── Rendu suivi v4 ────────────────────────────────────────────── */
function renderProgress(cart, commitments = [], contributions = []) {
  const total = r(cart.total_kmf_snapshot);
  const paid = r(cart.contributed_kmf);
  const pledged = commitmentTotal(commitments);
  const phaseOpen = isOpenConcertation(cart);
  const phaseSettlement = isSettlementOpen(cart);
  const value = phaseOpen ? pledged : paid;
  const p = pct(value, total);

  const rows = commitments?.length
    ? commitments.map(c => `
        <div class="k-group-commit-row">
          <span class="k-group-commit-name">${sanitize(c.participant_name?.split(' ')[0] || 'Anonyme')}</span>
          <span class="k-group-commit-status">${c.status === 'withdrawn' ? 'retiré' : c.status === 'locked_for_settlement' ? 'verrouillé' : 'engagé'}</span>
          <span class="k-group-contrib-amount">${fmt(r(c.amount_kmf), 'KMF')}</span>
        </div>`).join('')
    : '<p class="k-group-contrib-empty">Aucun engagement encore.</p>';

  const paidRows = !phaseOpen && contributions?.length
    ? contributions.map(c => `
        <div class="k-group-contrib-row">
          <span class="k-group-contrib-name">${sanitize(c.contributor_name?.split(' ')[0] || 'Anonyme')}</span>
          <span class="k-group-contrib-status k-group-contrib-status--${c.status}">${c.status === 'paid' || c.paid_at ? '✅' : '⏳'}</span>
          <span class="k-group-contrib-amount">${fmt(r(c.amount_kmf), 'KMF')}</span>
        </div>`).join('')
    : '';

  return `
    <div class="k-group-progress-card" id="k-group-progress-card">
      <div class="k-group-card-head">
        <div>
          <div class="k-group-card-title">${sanitize(cart.title || 'Panier groupe')}</div>
          <div class="k-group-card-meta">${statusLabel(cart)}</div>
        </div>
      </div>
      <div class="k-group-phase">
        <strong>${phaseOpen ? 'Panier ouvert — phase de concertation' : phaseSettlement ? 'Panier en règlement' : statusLabel(cart)}</strong>
        <span>${phaseOpen
          ? 'Le panier et les engagements peuvent encore évoluer. Aucun paiement n’est possible.'
          : phaseSettlement
            ? 'Le panier est verrouillé. Les paiements sont maintenant possibles.'
            : 'Ce panier n’est plus en phase active.'}</span>
      </div>
      <div class="k-group-money">
        <span>${phaseOpen ? `${fmt(pledged, 'KMF')} engagés` : `${fmt(paid, 'KMF')} réglés`}</span>
        <strong>${fmt(total, 'KMF')} total</strong>
      </div>
      <div class="k-group-progress" aria-label="${p}%">
        <span style="width:${p}%" class="k-group-progress-bar"></span>
      </div>
      ${phaseOpen ? `<p class="k-group-remaining">À participation égale : <strong>${fmt(avgSuggestion(cart, commitments), 'KMF')}</strong> en moyenne.</p>` : ''}
      ${phaseSettlement && remainingKmf(cart) > 0 ? `<p class="k-group-remaining">Reste à régler : <strong>${fmt(remainingKmf(cart), 'KMF')}</strong></p>` : ''}
      <div class="k-group-contribs">
        <div class="k-group-contribs-label">Engagements (${commitments?.length || 0})</div>
        ${rows}
      </div>
      ${paidRows ? `<div class="k-group-contribs"><div class="k-group-contribs-label">Paiements confirmés</div>${paidRows}</div>` : ''}
    </div>`;
}

/* ── Actions créateur ──────────────────────────────────────────── */
function renderCreatorActions(cart) {
  const phaseOpen = isOpenConcertation(cart);
  const phaseSettlement = isSettlementOpen(cart);

  if (cart.status === 'converted_to_order' || cart.finalized_order_id) {
    return `
      <div class="k-group-card k-group-actions-card">
        <div class="k-group-section-title">Commande créée</div>
        <p class="k-group-finalized-hint">Ce panier est lié à une commande Komerce.</p>
        ${cart.finalized_order_id ? `<button class="k-group-btn k-group-btn--ghost" id="k-group-to-track">📦 Voir la commande</button>` : ''}
      </div>`;
  }

  if (isTerminal(cart)) return `<p class="k-group-finalized-hint">Ce panier n’est plus actif.</p>`;

  return `
    <div class="k-group-card k-group-actions-card">
      <div class="k-group-section-title">Actions créateur</div>
      <div class="k-group-action-split">
        <button class="k-group-btn k-group-btn--ghost" id="k-group-reshare">📲 WhatsApp</button>
        <button class="k-group-btn k-group-btn--copy" id="k-group-copy">🔗 Copier</button>
      </div>
      ${phaseOpen ? `
        <p class="k-group-share-hint">Le panier est ouvert : vous pouvez encore ajuster le panier et les engagements.</p>
        <button class="k-group-btn k-group-btn--settlement" id="k-group-open-settlement">Passer au règlement</button>` : ''}
      ${phaseSettlement ? `
        <p class="k-group-share-hint">Le panier est en règlement. Les paiements sont ouverts.</p>
        ${remainingKmf(cart) <= 0
          ? `<button class="k-group-btn k-group-btn--finalize" id="k-group-finalize">✓ Finaliser la commande</button>`
          : `<button class="k-group-btn k-group-disabled-finalize" type="button" disabled>Finalisation après règlement ou compensation</button>`}` : ''}
      <p class="k-group-input-error" id="k-group-finalize-err"></p>
    </div>`;
}

/* ── Form engagement ───────────────────────────────────────────── */
function renderCommitmentForm(token, isCreator, cart) {
  const suggestion = avgSuggestion(cart, []);
  return `
    <div class="k-group-card k-group-contribute-card">
      <div class="k-group-section-title">${isCreator ? '🤝 Mon engagement' : '🤝 Mon engagement indicatif'}</div>
      <p class="k-group-small-hint">Aucun paiement maintenant. Vous indiquez seulement une intention de participation.</p>
      <div class="k-group-field">
        <label class="k-group-label" for="k-gc-name">Prénom</label>
        <input id="k-gc-name" class="k-group-input" type="text" placeholder="Ex : Fatima" maxlength="60" autocomplete="given-name">
      </div>
      <div class="k-group-field">
        <label class="k-group-label" for="k-gc-phone">Téléphone (optionnel, conseillé)</label>
        <input id="k-gc-phone" class="k-group-input" type="tel" placeholder="Ex : +269..." maxlength="30" autocomplete="tel">
      </div>
      <div class="k-group-field">
        <label class="k-group-label" for="k-gc-amount">Montant indicatif (KMF)</label>
        <input id="k-gc-amount" class="k-group-input" type="number" min="500" step="100" placeholder="Ex : ${suggestion || 10000}" inputmode="numeric">
      </div>
      <div class="k-group-field">
        <label class="k-group-label" for="k-gc-msg">Message (optionnel)</label>
        <input id="k-gc-msg" class="k-group-input" type="text" placeholder="Ex : Je participe" maxlength="200">
      </div>
      <p class="k-group-input-error" id="k-gc-err"></p>
      <button class="k-group-btn k-group-btn--primary" id="k-gc-commit-btn">Enregistrer mon engagement</button>
    </div>`;
}

function bindCommitmentForm(el, token) {
  el.querySelector('#k-gc-commit-btn')?.addEventListener('click', async () => {
    const name = (el.querySelector('#k-gc-name')?.value || '').trim();
    const phone = (el.querySelector('#k-gc-phone')?.value || '').trim();
    const amount = Number(el.querySelector('#k-gc-amount')?.value);
    const msg = (el.querySelector('#k-gc-msg')?.value || '').trim();
    const errEl = el.querySelector('#k-gc-err');
    const btn = el.querySelector('#k-gc-commit-btn');

    if (!name) { errEl.textContent = 'Prénom requis.'; return; }
    if (!amount || amount < 500) { errEl.textContent = 'Minimum 500 KMF.'; return; }

    errEl.textContent = '';
    btn.disabled = true; btn.textContent = '⏳ Enregistrement…';

    try {
      await apiPost(`/api/shared-carts/public/${token}/commitments`, {
        participant_name: name,
        ...(phone ? { participant_phone: phone } : {}),
        amount_kmf: amount,
        ...(msg ? { message: msg } : {}),
      });
      showToast('Engagement enregistré.', 'success');
      btn.textContent = '✅ Engagement enregistré';
      setTimeout(() => renderGroupView({ participantToken: token }), 500);
    } catch (err) {
      errEl.textContent = err?.message || 'Erreur.';
      btn.disabled = false; btn.textContent = 'Enregistrer mon engagement';
    }
  });
}

/* ── Form paiement après règlement ─────────────────────────────── */
function renderPaymentForm(token, isCreator, cart) {
  const remaining = remainingKmf(cart || {});
  const disabled = remaining <= 0;
  return `
    <div class="k-group-card k-group-contribute-card">
      <div class="k-group-section-title">${isCreator ? '💸 Mon paiement' : '💸 Payer ma contribution'}</div>
      <div class="k-group-field">
        <label class="k-group-label" for="k-gc-name">Prénom</label>
        <input id="k-gc-name" class="k-group-input" type="text" placeholder="Ex : Fatima" maxlength="60" autocomplete="given-name" ${disabled ? 'disabled' : ''}>
      </div>
      <div class="k-group-field">
        <label class="k-group-label" for="k-gc-email">Email</label>
        <input id="k-gc-email" class="k-group-input" type="email" placeholder="Ex : fatima@email.com" maxlength="120" autocomplete="email" ${disabled ? 'disabled' : ''}>
      </div>
      <div class="k-group-field">
        <label class="k-group-label" for="k-gc-amount">Montant (KMF)</label>
        <input id="k-gc-amount" class="k-group-input" type="number" min="100" step="100" placeholder="Max : ${fmt(remaining, 'KMF')}" inputmode="numeric" data-max-kmf="${remaining}" ${disabled ? 'disabled' : ''}>
      </div>
      <p class="k-group-input-error" id="k-gc-err"></p>
      <button class="k-group-btn k-group-btn--primary" id="k-gc-pay-btn" ${disabled ? 'disabled' : ''}>${disabled ? '✅ Panier réglé' : '💳 Payer ma contribution'}</button>
    </div>`;
}

function bindPaymentForm(el, token, cart) {
  el.querySelector('#k-gc-pay-btn')?.addEventListener('click', async () => {
    const name = (el.querySelector('#k-gc-name')?.value || '').trim();
    const email = (el.querySelector('#k-gc-email')?.value || '').trim();
    const amount = Number(el.querySelector('#k-gc-amount')?.value);
    const maxKmf = Number(el.querySelector('#k-gc-amount')?.dataset.maxKmf || remainingKmf(cart || {}));
    const errEl = el.querySelector('#k-gc-err');
    const btn = el.querySelector('#k-gc-pay-btn');

    if (!name) { errEl.textContent = 'Prénom requis.'; return; }
    if (!email || !email.includes('@')) { errEl.textContent = 'Email valide requis.'; return; }
    if (!amount || amount < 100) { errEl.textContent = 'Minimum 100 KMF.'; return; }
    if (maxKmf > 0 && amount > maxKmf) { errEl.textContent = `Il ne reste que ${fmt(maxKmf, 'KMF')} à régler.`; return; }

    errEl.textContent = '';
    btn.disabled = true; btn.textContent = '⏳ Redirection…';

    try {
      const res = await apiPost(`/api/shared-carts/public/${token}/contributions`, {
        amount_kmf: amount,
        contributor_name: name,
        contributor_email: email,
      });
      if (res?.checkout_url) window.location.href = res.checkout_url;
      else { showToast('Paiement enregistré !', 'success'); btn.textContent = '✅ Enregistré'; }
    } catch (err) {
      errEl.textContent = err?.message || 'Erreur.';
      btn.disabled = false; btn.textContent = '💳 Payer ma contribution';
    }
  });
}

/* ── Bind actions créateur ─────────────────────────────────────── */
function bindCreatorActions(el, cart, shareUrl, cartId) {
  el.querySelector('#k-group-reshare')?.addEventListener('click', () => {
    const msg = `Rejoins mon panier Komerce : "${sanitize(cart.title || 'Panier groupe')}" → ${shareUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
  });

  el.querySelector('#k-group-copy')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(shareUrl); showToast('Lien copié !', 'success'); }
    catch (_) { showToast('Impossible de copier.', 'error'); }
  });

  el.querySelector('#k-group-open-settlement')?.addEventListener('click', async () => {
    const btn = el.querySelector('#k-group-open-settlement');
    btn.disabled = true; btn.textContent = '⏳ Passage au règlement…';
    try {
      await apiPost(`/api/shared-carts/${cartId}/open-settlement`, {});
      showToast('Le panier est passé au règlement.', 'success');
      renderGroupView();
    } catch (err) {
      showToast(err?.message || 'Erreur passage au règlement.', 'error');
      btn.disabled = false; btn.textContent = 'Passer au règlement';
    }
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

  el.querySelector('#k-group-finalize')?.addEventListener('click', async () => {
    const btn = el.querySelector('#k-group-finalize');
    const errEl = el.querySelector('#k-group-finalize-err');
    btn.disabled = true; btn.textContent = '⏳ Finalisation…';
    try {
      const res = await apiPost(`/api/shared-carts/${cartId}/finalize`, {});
      state.shareToken = null; state.shareId = null; state.cartName = ''; state.shareExpiry = null; state.shareStatus = null;
      try { sessionStorage.removeItem('kmrc_share'); sessionStorage.removeItem('kmrc_banner_dismissed'); } catch (_) {}
      refreshGroupBadge(); hideBanner();
      import('./b-share-cart.js').then(m => m.refreshSharedBadges?.(false));
      el.innerHTML = `
        <div class="k-group-success">
          <div class="k-group-success-icon">🎉</div>
          <strong>Commande créée !</strong>
          <p>Commande <strong>${sanitize(res.order_reference || '')}</strong> créée.</p>
          <button class="k-group-btn k-group-btn--ghost k-group-btn--mt" id="k-group-to-track">📦 Voir ma commande</button>
        </div>`;
      bindCreatorActions(el, { ...cart, finalized_order_id: res.order_id }, shareUrl, cartId);
    } catch (err) {
      if (errEl) errEl.textContent = err?.message || 'Erreur finalisation.';
      btn.disabled = false; btn.textContent = '✓ Finaliser la commande';
    }
  });
}

/* ── Loader ────────────────────────────────────────────────────── */
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
function renderError(el) {
  el.innerHTML = `
    <div class="k-group-empty">
      <div class="k-group-empty-icon">❌</div>
      <strong>Panier introuvable</strong>
      <span>Ce lien est peut-être expiré ou invalide.</span>
    </div>`;
}

/* ── Point d'entrée ────────────────────────────────────────────── */
export async function renderGroupView(opts = {}) {
  showGroupStyles();
  stopPolling();
  const el = getOrCreateEl();
  renderLoading(el);

  const participantToken = opts.participantToken || null;
  const isCreator = !participantToken || participantToken === state.shareToken;

  // ── MODE PARTICIPANT ────────────────────────────────────────────
  if (!isCreator) {
    const data = await fetch(`/api/shared-carts/public/${participantToken}`, { credentials: 'include' })
      .then(rsp => rsp.ok ? rsp.json() : null).catch(() => null);
    if (!data?.cart) { renderError(el); return; }

    const cart = data.cart;
    const items = data.items || [];
    const commitments = await loadCommitments(participantToken);
    const total = r(cart.total_kmf_snapshot);
    const phaseOpen = isOpenConcertation(cart);
    const phaseSettlement = isSettlementOpen(cart);

    el.innerHTML = `
      <div class="k-group-header">
        <h2>👥 Panier groupe</h2>
        <p class="k-group-subhead">${phaseOpen ? 'Le groupe se concerte encore.' : phaseSettlement ? 'Le panier est en règlement.' : 'Suivi du panier partagé.'}</p>
      </div>
      <div class="k-group-card k-group-items-card">
        <div class="k-group-card-head">
          <div class="k-group-card-title">${sanitize(cart.title || 'Panier groupe')}</div>
          <div class="k-group-card-meta">Total : ${fmt(total, 'KMF')} · ${statusLabel(cart)}</div>
        </div>
        ${renderItems(items)}
      </div>
      ${renderProgress(cart, commitments, data.contributions || [])}
      ${phaseOpen ? renderCommitmentForm(participantToken, false, cart)
        : phaseSettlement ? renderPaymentForm(participantToken, false, cart)
          : `<div class="k-group-card"><strong>Ce panier n’accepte plus d’action.</strong></div>`}`;

    if (phaseOpen) bindCommitmentForm(el, participantToken);
    if (phaseSettlement) bindPaymentForm(el, participantToken, cart);
    return;
  }

  // ── MODE CRÉATEUR ───────────────────────────────────────────────
  if (!state.shareToken || !state.shareId) {
    const restored = await ensureCreatorCartState();
    if (!restored) { renderEmpty(el); return; }
  }

  let data;
  try { data = await apiGet(`/api/shared-carts/${state.shareId}`); }
  catch (_) {
    data = await fetch(`/api/shared-carts/public/${state.shareToken}`, { credentials: 'include' })
      .then(rsp => rsp.ok ? rsp.json() : null).catch(() => null);
  }

  if (!data?.cart) { renderError(el); return; }

  const cart = data.cart;
  const contributions = data.contributions || [];
  const commitments = await loadCommitments(state.shareToken);
  const cartId = state.shareId || cart.id;
  const shareUrl = data.share_url || state.shareUrl || `${window.location.origin}/cart/shared/${state.shareToken}`;
  const phaseOpen = isOpenConcertation(cart);
  const phaseSettlement = isSettlementOpen(cart);

  el.innerHTML = `
    <div class="k-group-header">
      <h2>👥 Mon panier groupe</h2>
      <p class="k-group-subhead">${phaseOpen ? 'Concertation en cours.' : phaseSettlement ? 'Règlement en cours.' : 'Suivi du panier.'}</p>
    </div>
    <div class="k-group-card k-group-items-card">
      <div class="k-group-section-title">Articles du panier</div>
      ${renderItems(data.items || [])}
      ${phaseOpen ? '<p class="k-group-small-hint">Vous pouvez encore ajuster les articles depuis le panier avant de passer au règlement.</p>' : ''}
    </div>
    ${renderProgress(cart, commitments, contributions)}
    ${phaseOpen ? `
      <button class="k-group-self-toggle" id="k-group-self-toggle" type="button">Je m’engage aussi</button>
      <div class="k-group-self-panel" id="k-group-self-panel" hidden>${renderCommitmentForm(state.shareToken, true, cart)}</div>` : ''}
    ${phaseSettlement && remainingKmf(cart) > 0 ? `
      <button class="k-group-self-toggle" id="k-group-self-toggle" type="button">Je paie aussi</button>
      <div class="k-group-self-panel" id="k-group-self-panel" hidden>${renderPaymentForm(state.shareToken, true, cart)}</div>` : ''}
    ${renderCreatorActions(cart)}`;

  el.querySelector('#k-group-self-toggle')?.addEventListener('click', () => {
    const panel = el.querySelector('#k-group-self-panel');
    if (panel) panel.hidden = !panel.hidden;
  });
  if (phaseOpen) bindCommitmentForm(el, state.shareToken);
  if (phaseSettlement) bindPaymentForm(el, state.shareToken, cart);
  bindCreatorActions(el, cart, shareUrl, cartId);

  showBanner({ title: cart.title, status: cart.status });

  if (!isTerminal(cart)) {
    startPolling(cartId, (fresh) => {
      import('./b-share-cart.js').then(m => m.refreshSharedBadges?.(true, fresh.cart));
      showBanner({ title: fresh.cart?.title, status: fresh.cart?.status });
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
