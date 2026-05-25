/**
 * @module b-group-view
 * @owner sélecteurs .k-group-* — onglet dédié panier partagé
 *
 * UX compacte — Mai 2026 :
 *   - inspiration onglet Suivi boutique, sans surcharge informationnelle.
 *   - une carte principale : statut, progression, reste, prochaine action.
 *   - les actions de partage vivent ici, pas dans la sidebar.
 *   - la finalisation devient action principale uniquement si fully_funded.
 *   - le formulaire contribution annonce et respecte remaining_kmf côté client.
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

function pct(confirmed, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((confirmed / total) * 100)));
}

function statusLabel(status) {
  return {
    active: '🟢 Ouvert',
    partially_funded: '🟡 Partiellement financé',
    fully_funded: '✅ Financé',
    converted_to_order: '📦 Clôturé',
    finalized: '📦 Clôturé',
    cancelled: '❌ Annulé',
    expired: '⏱️ Expiré',
  }[status] || status;
}

function remainingKmf(cart) {
  const total = r(cart.total_kmf_snapshot);
  const confirmed = r(cart.contributed_kmf);
  return Math.max(0, r(cart.remaining_kmf) || total - confirmed);
}

function compactNextAction(cart) {
  const remaining = remainingKmf(cart);
  if (cart.status === 'fully_funded' || remaining <= 0) return 'Valider la commande';
  if (cart.status === 'converted_to_order' || cart.finalized_order_id) return 'Suivre la commande';
  if (cart.status === 'expired') return 'Créer un nouveau panier';
  if (cart.status === 'cancelled') return 'Panier annulé';
  return 'Partager le lien';
}

function shortDeadline(expiresAt) {
  if (!expiresAt) return 'actif';
  const diff = new Date(expiresAt) - Date.now();
  if (diff <= 0) return 'expiré';
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  if (days >= 1) return `expire dans ${days}j`;
  return `expire dans ${Math.max(1, hours)}h`;
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
  if (document.getElementById('k-group-view-p0-styles')) return;
  const s = document.createElement('style');
  s.id = 'k-group-view-p0-styles';
  s.textContent = `
.k-group-compact-status{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:14px}
.k-group-compact-title{min-width:0}
.k-group-compact-title strong{display:block;font-size:20px;line-height:1.15;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.k-group-compact-title span{display:block;font-size:13px;color:var(--text-muted);margin-top:4px}
.k-group-compact-pill{flex:0 0 auto;display:inline-flex;align-items:center;gap:7px;border:1px solid rgba(31,122,84,.22);background:rgba(31,122,84,.08);color:var(--green);border-radius:999px;padding:8px 12px;font-size:13px;font-weight:900}
.k-group-compact-money{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:12px 0}
.k-group-compact-money div{border:1px solid var(--border);background:var(--sand);border-radius:14px;padding:10px 12px}
.k-group-compact-money small{display:block;font-size:11px;line-height:1;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);font-weight:900;margin-bottom:7px}
.k-group-compact-money strong{display:block;font-size:15px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.k-group-next-action{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid var(--border);padding-top:12px;margin-top:12px;color:var(--text)}
.k-group-next-action span{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);font-weight:900}
.k-group-next-action strong{font-size:14px}
.k-group-funded-callout{border:1px solid rgba(31,122,84,.28);background:rgba(31,122,84,.09);border-radius:18px;padding:16px;margin-top:14px}
.k-group-funded-callout strong{display:block;font-size:16px;margin-bottom:6px;color:var(--text)}
.k-group-funded-callout p{font-size:13px;line-height:1.45;color:var(--text-muted);margin:0 0 12px}
.k-group-disabled-finalize{opacity:.72;cursor:not-allowed!important;background:var(--sand-dark)!important;color:var(--text-muted)!important}
.k-group-share-hint,.k-group-finalize-hint{font-size:12px;line-height:1.45;color:var(--text-muted);margin:10px 0 0}
.k-group-self-toggle{margin-top:12px;width:100%;border:1px dashed var(--border);background:var(--sand);color:var(--text);border-radius:14px;padding:11px;font-weight:800;cursor:pointer}
.k-group-self-panel[hidden]{display:none!important}
@media(max-width:640px){.k-group-compact-status{display:block}.k-group-compact-pill{margin-top:10px}.k-group-compact-money{grid-template-columns:1fr}.k-group-next-action{align-items:flex-start;flex-direction:column}}
`;
  document.head.appendChild(s);
}

/* ── Rendu progression ─────────────────────────────────────────── */
function renderProgress(cart, contributions) {
  const total = r(cart.total_kmf_snapshot);
  const confirmed = r(cart.contributed_kmf);
  const remaining = remainingKmf(cart);
  const p = pct(confirmed, total);
  const isOpen = ['active', 'partially_funded', 'fully_funded'].includes(cart.status);

  const rows = contributions?.length
    ? contributions.map(c => `
        <div class="k-group-contrib-row">
          <span class="k-group-contrib-name">${sanitize(c.contributor_name?.split(' ')[0] || c.first_name || 'Anonyme')}</span>
          <span class="k-group-contrib-status k-group-contrib-status--${c.status}">${c.status === 'paid' || c.paid_at ? '✅' : '⏳'}</span>
          <span class="k-group-contrib-amount">${fmt(r(c.amount_kmf), 'KMF')}</span>
        </div>`).join('')
    : '<p class="k-group-contrib-empty">Aucune contribution encore.</p>';

  return `
    <div class="k-group-progress-card" id="k-group-progress-card">
      <div class="k-group-compact-status">
        <div class="k-group-compact-title">
          <strong>${sanitize(cart.title || 'Panier groupe')}</strong>
          <span>${statusLabel(cart.status)} · ${shortDeadline(cart.expires_at)}</span>
        </div>
        <div class="k-group-compact-pill">${p}% financé</div>
      </div>
      <div class="k-group-progress" aria-label="${p}%">
        <span style="width:${p}%" class="k-group-progress-bar"></span>
      </div>
      <div class="k-group-compact-money">
        <div><small>Collecté</small><strong>${fmt(confirmed, 'KMF')}</strong></div>
        <div><small>Reste</small><strong>${fmt(remaining, 'KMF')}</strong></div>
        <div><small>Total</small><strong>${fmt(total, 'KMF')}</strong></div>
      </div>
      <div class="k-group-next-action">
        <span>Prochaine action</span>
        <strong>${compactNextAction(cart)}</strong>
      </div>
      <div class="k-group-contribs">
        <div class="k-group-contribs-label">Contributions (${contributions?.length || 0})</div>
        ${rows}
      </div>
    </div>`;
}

/* ── Rendu actions créateur ────────────────────────────────────── */
function renderCreatorActions(cart) {
  const isOpen = ['active', 'partially_funded', 'fully_funded'].includes(cart.status);
  if (cart.status === 'converted_to_order' || cart.finalized_order_id) {
    return `
      <div class="k-group-card k-group-actions-card">
        <div class="k-group-section-title">Commande créée</div>
        <p class="k-group-finalized-hint">Ce panier est clôturé et lié à une commande Komerce.</p>
        ${cart.finalized_order_id ? `<button class="k-group-btn k-group-btn--ghost" id="k-group-to-track">📦 Voir la commande</button>` : ''}
      </div>`;
  }
  if (!isOpen) return `<p class="k-group-finalized-hint">Ce panier est clôturé.</p>`;

  const fullyFunded = cart.status === 'fully_funded' || remainingKmf(cart) <= 0;
  return `
    <div class="k-group-card k-group-actions-card">
      <div class="k-group-section-title">Actions</div>
      <div class="k-group-creator-actions">
        <button class="k-group-btn k-group-btn--ghost" id="k-group-reshare">📲 WhatsApp</button>
        <button class="k-group-btn k-group-btn--copy" id="k-group-copy">🔗 Copier</button>
      </div>
      <p class="k-group-share-hint">La commande se crée à 100% de financement confirmé.</p>
      ${fullyFunded ? `
        <div class="k-group-funded-callout">
          <strong>✅ Tout est réglé</strong>
          <p>Validez maintenant pour que la commande parte en préparation.</p>
          <button class="k-group-btn k-group-btn--finalize" id="k-group-finalize">✓ Valider et commander</button>
        </div>` : `
        <button class="k-group-btn k-group-disabled-finalize" type="button" disabled>Valider disponible à 100%</button>`}
      <p class="k-group-input-error" id="k-group-finalize-err"></p>
    </div>`;
}

/* ── Rendu formulaire contribution ─────────────────────────────── */
function renderContributeForm(token, isCreator, cart) {
  const remaining = remainingKmf(cart || {});
  const placeholder = remaining > 0
    ? `Max : ${fmt(remaining, 'KMF')} (reste à collecter)`
    : 'Panier déjà financé';
  const disabled = remaining <= 0;

  return `
    <div class="k-group-card k-group-contribute-card">
      <div class="k-group-section-title">${isCreator ? '💸 Ma contribution' : '💸 Contribuer'}</div>
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
        <input id="k-gc-amount" class="k-group-input" type="number" min="100" step="100" placeholder="${placeholder}" inputmode="numeric" data-max-kmf="${remaining}" ${disabled ? 'disabled' : ''}>
      </div>
      <div class="k-group-field">
        <label class="k-group-label" for="k-gc-msg">Message (optionnel)</label>
        <input id="k-gc-msg" class="k-group-input" type="text" placeholder="Ex : Bon courage !" maxlength="200" ${disabled ? 'disabled' : ''}>
      </div>
      <p class="k-group-input-error" id="k-gc-err"></p>
      <button class="k-group-btn k-group-btn--primary" id="k-gc-pay-btn" ${disabled ? 'disabled' : ''}>${disabled ? '✅ Panier financé' : '💳 Payer ma contribution'}</button>
    </div>`;
}

/* ── Bind contribution ─────────────────────────────────────────── */
function bindContributeForm(el, token, cart) {
  el.querySelector('#k-gc-pay-btn')?.addEventListener('click', async () => {
    const name = (el.querySelector('#k-gc-name')?.value || '').trim();
    const email = (el.querySelector('#k-gc-email')?.value || '').trim();
    const amount = Number(el.querySelector('#k-gc-amount')?.value);
    const maxKmf = Number(el.querySelector('#k-gc-amount')?.dataset.maxKmf || remainingKmf(cart || {}));
    const msg = (el.querySelector('#k-gc-msg')?.value || '').trim();
    const errEl = el.querySelector('#k-gc-err');
    const btn = el.querySelector('#k-gc-pay-btn');

    if (!name) { errEl.textContent = 'Prénom requis.'; return; }
    if (!email || !email.includes('@')) { errEl.textContent = 'Email valide requis.'; return; }
    if (!amount || amount < 100) { errEl.textContent = 'Minimum 100 KMF.'; return; }
    if (maxKmf > 0 && amount > maxKmf) {
      errEl.textContent = `Il ne reste que ${fmt(maxKmf, 'KMF')} à collecter.`;
      return;
    }

    errEl.textContent = '';
    btn.disabled = true; btn.textContent = '⏳ Redirection…';

    try {
      const res = await apiPost(`/api/shared-carts/public/${token}/contributions`, {
        amount_kmf: amount,
        contributor_name: name,
        contributor_email: email,
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

  el.querySelector('#k-group-finalize')?.addEventListener('click', async () => {
    const btn = el.querySelector('#k-group-finalize');
    const errEl = el.querySelector('#k-group-finalize-err');
    btn.disabled = true; btn.textContent = '⏳ Validation…';

    try {
      const res = await apiPost(`/api/shared-carts/${cartId}/finalize`, {});

      state.shareToken = null;
      state.shareId = null;
      state.cartName = '';
      state.shareExpiry = null;
      state.shareStatus = null;
      try { sessionStorage.removeItem('kmrc_share'); sessionStorage.removeItem('kmrc_banner_dismissed'); } catch (_) {}
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
      btn.disabled = false; btn.textContent = '✓ Valider et commander';
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
    const total = r(cart.total_kmf_snapshot);
    const isOpen = ['active', 'partially_funded'].includes(cart.status);

    const itemRows = items.map(it => `
      <div class="k-group-item-row">
        <span class="k-group-item-name">${sanitize(it.name || 'Produit')}</span>
        <span class="k-group-item-qty">×${it.quantity || 1}</span>
        <span class="k-group-item-price">${fmt(r(it.unit_price_kmf), 'KMF')}</span>
      </div>`).join('') || '<p class="k-group-contrib-empty">Aucun article.</p>';

    el.innerHTML = `
      <div class="k-group-header">
        <h2>👥 Panier groupe</h2>
        <p class="k-group-subhead">Contribution au panier de ${sanitize(cart.beneficiary_name_snapshot || '')}.</p>
      </div>
      <div class="k-group-card k-group-items-card">
        <div class="k-group-card-head">
          <div class="k-group-card-title">${sanitize(cart.title || 'Panier groupe')}</div>
          <div class="k-group-card-meta">Total : ${fmt(total, 'KMF')} · ${statusLabel(cart.status)}</div>
        </div>
        <div class="k-group-items-list">${itemRows}</div>
      </div>
      ${isOpen ? renderContributeForm(participantToken, false, cart) : `<div class="k-group-card"><strong>${cart.status === 'fully_funded' ? '✅ Panier financé, merci !' : 'Ce panier n’accepte plus de contribution.'}</strong></div>`}`;

    if (isOpen) bindContributeForm(el, participantToken, cart);
    return;
  }

  // ── MODE CRÉATEUR ───────────────────────────────────────────────
  if (!state.shareToken || !state.shareId) {
    const restored = await ensureCreatorCartState();
    if (!restored) { renderEmpty(el); return; }
  }

  let data;
  try {
    data = await apiGet(`/api/shared-carts/${state.shareId}`);
  } catch (_) {
    data = await fetch(`/api/shared-carts/public/${state.shareToken}`, { credentials: 'include' })
      .then(rsp => rsp.ok ? rsp.json() : null).catch(() => null);
  }

  if (!data?.cart) { renderError(el); return; }

  const cart = data.cart;
  const contributions = data.contributions || [];
  const cartId = state.shareId || cart.id;
  const shareUrl = data.share_url || state.shareUrl || `${window.location.origin}/cart/shared/${state.shareToken}`;
  const isOpen = ['active', 'partially_funded', 'fully_funded'].includes(cart.status);
  const showSelfContribution = isOpen && cart.status !== 'fully_funded' && remainingKmf(cart) > 0;

  el.innerHTML = `
    <div class="k-group-header">
      <h2>👥 Mon panier groupe</h2>
      <p class="k-group-subhead">Suivi de collecte</p>
    </div>
    ${renderProgress(cart, contributions)}
    ${showSelfContribution ? `
      <button class="k-group-self-toggle" id="k-group-self-toggle" type="button">Je contribue aussi</button>
      <div class="k-group-self-panel" id="k-group-self-panel" hidden>
        ${renderContributeForm(state.shareToken, true, cart)}
      </div>` : ''}
    ${renderCreatorActions(cart)}`;

  if (showSelfContribution) {
    el.querySelector('#k-group-self-toggle')?.addEventListener('click', () => {
      const panel = el.querySelector('#k-group-self-panel');
      if (panel) panel.hidden = !panel.hidden;
    });
    bindContributeForm(el, state.shareToken, cart);
  }
  bindCreatorActions(el, cart, shareUrl, cartId);

  showBanner({
    title: cart.title,
    expires_at: cart.expires_at,
    status: cart.status,
    contributed_kmf: cart.contributed_kmf,
    total_kmf_snapshot: cart.total_kmf_snapshot,
  });

  if (isOpen) {
    startPolling(cartId, (fresh) => {
      const card = el.querySelector('#k-group-progress-card');
      if (card) card.outerHTML = renderProgress(fresh.cart, fresh.contributions);
      import('./b-share-cart.js').then(m => m.refreshSharedBadges?.(true, fresh.cart));
      showBanner({
        title: fresh.cart?.title,
        expires_at: fresh.cart?.expires_at,
        status: fresh.cart?.status,
        contributed_kmf: fresh.cart?.contributed_kmf,
        total_kmf_snapshot: fresh.cart?.total_kmf_snapshot,
      });
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
