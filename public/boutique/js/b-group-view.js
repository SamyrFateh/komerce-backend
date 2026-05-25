/**
 * @module b-group-view
 * @owner sélecteurs .k-group-* — onglet dédié panier partagé
 *
 * MODE CRÉATEUR (state.shareToken défini + utilisateur auth)
 *   GET /api/shared-carts/mine          → liste + sélection active
 *   GET /api/shared-carts/:id           → détail (contributions complètes)
 *   POST /api/shared-carts/:id/finalize → clôture + création commande
 *
 * MODE PARTICIPANT (opts.participantToken passé depuis URL)
 *   GET /api/shared-carts/public/:token → lecture publique
 *   POST /api/shared-carts/public/:token/contributions → Stripe
 *
 * Polling 30s créateur uniquement (rafraîchit les contributions).
 * Aucun localStorage. Tout vient du backend.
 */

import { state }        from './b-store.js';
import { showToast }    from './b-cart-core.js';
import { sanitize, fmt, apiGet, apiPost } from './b-utils.js';
import { showBanner, hideBanner }         from './b-group-banner.js';

/* ── Token participant URL ─────────────────────────────────────── */
export function detectParticipantToken() {
  const url = new URL(window.location.href);
  const qp  = url.searchParams.get('p');
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
function pct(confirmed, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((confirmed / total) * 100)));
}

function statusLabel(status) {
  return {
    active:           '🟢 Ouvert',
    partially_funded: '🟡 Partiellement financé',
    fully_funded:     '✅ Financé',
    finalized:        '📦 Clôturé',
    cancelled:        '❌ Annulé',
    expired:          '⏱️ Expiré',
  }[status] || status;
}

/* ── Rendu progression ─────────────────────────────────────────── */
function renderProgress(cart, contributions) {
  const total      = Number(cart.total_kmf_snapshot) || 0;
  const confirmed  = Number(cart.contributed_kmf)    || 0;
  const remaining  = Number(cart.remaining_kmf)      || Math.max(0, total - confirmed);
  const p          = pct(confirmed, total);
  const isOpen     = ['active', 'partially_funded', 'fully_funded'].includes(cart.status);

  const rows = contributions?.length
    ? contributions.map(c => `
        <div class="k-group-contrib-row">
          <span class="k-group-contrib-name">${sanitize(c.contributor_name?.split(' ')[0] || 'Anonyme')}</span>
          <span class="k-group-contrib-status k-group-contrib-status--${c.status}">${c.status === 'paid' ? '✅' : '⏳'}</span>
          <span class="k-group-contrib-amount">${fmt(Number(c.amount_kmf) || 0, 'KMF')}</span>
        </div>`).join('')
    : '<p class="k-group-contrib-empty">Aucune contribution encore.</p>';

  return `
    <div class="k-group-progress-card" id="k-group-progress-card">
      <div class="k-group-card-head">
        <div>
          <div class="k-group-card-title">${sanitize(cart.title || 'Panier groupe')}</div>
          <div class="k-group-card-meta">${statusLabel(cart.status)}</div>
        </div>
      </div>
      <div class="k-group-money">
        <span>${fmt(confirmed, 'KMF')} collectés</span>
        <strong>${fmt(total, 'KMF')} total</strong>
      </div>
      <div class="k-group-progress" aria-label="${p}%">
        <span style="width:${p}%" class="k-group-progress-bar"></span>
      </div>
      ${remaining > 0 && isOpen
        ? `<p class="k-group-remaining">Reste : <strong>${fmt(remaining, 'KMF')}</strong></p>`
        : ''}
      <div class="k-group-contribs">
        <div class="k-group-contribs-label">Contributions (${contributions?.length || 0})</div>
        ${rows}
      </div>
    </div>`;
}

/* ── Rendu actions créateur ────────────────────────────────────── */
function renderCreatorActions(cart, shareUrl, cartId) {
  const isOpen = ['active', 'partially_funded', 'fully_funded'].includes(cart.status);
  if (!isOpen) return `<p class="k-group-finalized-hint">Ce panier est clôturé.</p>`;

  return `
    <div class="k-group-card k-group-actions-card">
      <div class="k-group-section-title">Actions</div>
      <div class="k-group-creator-actions">
        <button class="k-group-btn k-group-btn--ghost" id="k-group-reshare">📲 Re-partager</button>
        <button class="k-group-btn k-group-btn--copy"  id="k-group-copy">🔗 Copier le lien</button>
      </div>
      <button class="k-group-btn k-group-btn--finalize" id="k-group-finalize">
        🔒 Clôturer et commander
      </button>
      <p class="k-group-finalize-hint">
        Transforme ce panier en commande. Les contributions reçues sont déduites du total.
      </p>
      <p class="k-group-input-error" id="k-group-finalize-err"></p>
    </div>`;
}

/* ── Rendu formulaire contribution ─────────────────────────────── */
function renderContributeForm(token, isCreator) {
  return `
    <div class="k-group-card k-group-contribute-card">
      <div class="k-group-section-title">${isCreator ? '💸 Ma contribution' : '💸 Contribuer'}</div>
      <div class="k-group-field">
        <label class="k-group-label" for="k-gc-name">Prénom</label>
        <input id="k-gc-name" class="k-group-input" type="text" placeholder="Ex : Fatima" maxlength="60" autocomplete="given-name">
      </div>
      <div class="k-group-field">
        <label class="k-group-label" for="k-gc-email">Email</label>
        <input id="k-gc-email" class="k-group-input" type="email" placeholder="Ex : fatima@email.com" maxlength="120" autocomplete="email">
      </div>
      <div class="k-group-field">
        <label class="k-group-label" for="k-gc-amount">Montant (KMF)</label>
        <input id="k-gc-amount" class="k-group-input" type="number" min="100" step="100" placeholder="Ex : 5 000" inputmode="numeric">
      </div>
      <div class="k-group-field">
        <label class="k-group-label" for="k-gc-msg">Message (optionnel)</label>
        <input id="k-gc-msg" class="k-group-input" type="text" placeholder="Ex : Bon courage !" maxlength="200">
      </div>
      <p class="k-group-input-error" id="k-gc-err"></p>
      <button class="k-group-btn k-group-btn--primary" id="k-gc-pay-btn">💳 Payer ma contribution</button>
    </div>`;
}

/* ── Bind contribution ─────────────────────────────────────────── */
function bindContributeForm(el, token) {
  el.querySelector('#k-gc-pay-btn')?.addEventListener('click', async () => {
    const name   = (el.querySelector('#k-gc-name')?.value  || '').trim();
    const email  = (el.querySelector('#k-gc-email')?.value || '').trim();
    const amount = Number(el.querySelector('#k-gc-amount')?.value);
    const msg    = (el.querySelector('#k-gc-msg')?.value   || '').trim();
    const errEl  = el.querySelector('#k-gc-err');
    const btn    = el.querySelector('#k-gc-pay-btn');

    if (!name)                        { errEl.textContent = 'Prénom requis.'; return; }
    if (!email || !email.includes('@')) { errEl.textContent = 'Email valide requis.'; return; }
    if (!amount || amount < 100)      { errEl.textContent = 'Minimum 100 KMF.'; return; }
    errEl.textContent = '';
    btn.disabled = true; btn.textContent = '⏳ Redirection…';

    try {
      const res = await apiPost(`/api/shared-carts/public/${token}/contributions`, {
        amount_kmf:        amount,
        contributor_name:  name,
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

  el.querySelector('#k-group-finalize')?.addEventListener('click', async () => {
    const btn    = el.querySelector('#k-group-finalize');
    const errEl  = el.querySelector('#k-group-finalize-err');
    btn.disabled = true; btn.textContent = '⏳ Clôture…';

    try {
      const res = await apiPost(`/api/shared-carts/${cartId}/finalize`, {});

      // Nettoyer le state
      state.shareToken  = null;
      state.shareId     = null;
      state.cartName    = '';
      state.shareExpiry = null;
      try { sessionStorage.removeItem('kmrc_share'); sessionStorage.removeItem('kmrc_banner_dismissed'); } catch (_) {}
      refreshGroupBadge();
      hideBanner();

      // Importer et rafraîchir le badge share
      import('./b-share-cart.js').then(m => m.install?.());

      el.innerHTML = `
        <div class="k-group-success">
          <div class="k-group-success-icon">🎉</div>
          <strong>Panier clôturé !</strong>
          <p>Commande <strong>${sanitize(res.order_reference || '')}</strong> créée.</p>
          ${res.prepaid_kmf > 0 ? `<p class="k-group-success-detail">${fmt(res.prepaid_kmf, 'KMF')} prépayés.</p>` : ''}
          ${res.remaining_cash_kmf > 0 ? `<p class="k-group-success-detail k-group-success-remain">Reste : ${fmt(res.remaining_cash_kmf, 'KMF')}</p>` : ''}
          <button class="k-group-btn k-group-btn--ghost k-group-btn--mt" id="k-group-to-track">📦 Voir ma commande</button>
        </div>`;

      el.querySelector('#k-group-to-track')?.addEventListener('click', () => {
        import('./b-nav.js').then(({ switchView }) => {
          import('./b-tracking.js').then(({ renderTrackView }) => {
            document.querySelectorAll('.k-bnav-item, .k-header-nav-btn')
              .forEach(i => i.classList.toggle('active', i.dataset.tab === 'track'));
            renderTrackView(); switchView('track');
          });
        });
      });

    } catch (err) {
      if (err?.code === 'stock_issues' || err?.message?.includes('stock')) {
        if (errEl) errEl.textContent = err.message || 'Problème de stock.';
      } else {
        showToast(err?.message || 'Erreur clôture.', 'error');
      }
      btn.disabled = false; btn.textContent = '🔒 Clôturer et commander';
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
  stopPolling();
  const el = getOrCreateEl();
  renderLoading(el);

  const participantToken = opts.participantToken || null;
  const isCreator = !participantToken || participantToken === state.shareToken;

  // ── MODE PARTICIPANT ────────────────────────────────────────────
  if (!isCreator) {
    const data = await fetch(`/api/shared-carts/public/${participantToken}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null).catch(() => null);

    if (!data?.cart) { renderError(el); return; }
    const cart  = data.cart;
    const items = data.items || [];
    const total = Number(cart.total_kmf_snapshot) || 0;

    const itemRows = items.map(it => `
      <div class="k-group-item-row">
        <span class="k-group-item-name">${sanitize(it.name || 'Produit')}</span>
        <span class="k-group-item-qty">×${it.quantity || 1}</span>
        <span class="k-group-item-price">${fmt(Number(it.unit_price_kmf || 0), 'KMF')}</span>
      </div>`).join('') || '<p class="k-group-contrib-empty">Aucun article.</p>';

    el.innerHTML = `
      <div class="k-group-header">
        <h2>👥 Panier groupe</h2>
        <p class="k-group-subhead">Contribution au panier de ${sanitize(cart.beneficiary_name_snapshot || '')}.</p>
      </div>
      <div class="k-group-card k-group-items-card">
        <div class="k-group-card-head">
          <div class="k-group-card-title">${sanitize(cart.title || 'Panier groupe')}</div>
          <div class="k-group-card-meta">Total : ${fmt(total, 'KMF')}</div>
        </div>
        <div class="k-group-items-list">${itemRows}</div>
      </div>
      ${renderContributeForm(participantToken, false)}`;

    bindContributeForm(el, participantToken);
    return;
  }

  // ── MODE CRÉATEUR ───────────────────────────────────────────────
  // Si pas de token → pas de panier actif
  if (!state.shareToken) { renderEmpty(el); return; }

  // Charger le détail via route authentifiée /:id
  let data;
  try {
    data = await apiGet(`/api/shared-carts/${state.shareId}`);
  } catch (_) {
    // Fallback : lecture publique si l'auth échoue (session expirée)
    data = await fetch(`/api/shared-carts/public/${state.shareToken}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null).catch(() => null);
  }

  if (!data?.cart) { renderError(el); return; }

  const cart         = data.cart;
  const contributions = data.contributions || [];
  const cartId       = state.shareId || cart.id;
  const shareUrl     = data.share_url || `${window.location.origin}/cart/shared/${state.shareToken}`;
  const isOpen       = ['active', 'partially_funded', 'fully_funded'].includes(cart.status);

  el.innerHTML = `
    <div class="k-group-header">
      <h2>👥 Mon panier groupe</h2>
      <p class="k-group-subhead">Suivi en temps réel des contributions.</p>
    </div>
    ${renderProgress(cart, contributions)}
    ${isOpen ? renderContributeForm(state.shareToken, true) : ''}
    ${renderCreatorActions(cart, shareUrl, cartId)}`;

  if (isOpen) bindContributeForm(el, state.shareToken);
  bindCreatorActions(el, cart, shareUrl, cartId);

  // Bannière
  showBanner({ title: cart.title, expires_at: cart.expires_at });

  // Polling — rafraîchit uniquement la carte de progression
  if (isOpen) {
    startPolling(cartId, (fresh) => {
      const card = el.querySelector('#k-group-progress-card');
      if (card) card.outerHTML = renderProgress(fresh.cart, fresh.contributions);
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
