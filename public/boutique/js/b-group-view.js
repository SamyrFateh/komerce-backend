/**
 * @module b-group-view
 * @owner sélecteurs .k-group-* — onglet dédié paniers partagés
 * @brief Vue "Groupe" — deux modes :
 *
 *   MODE CRÉATEUR  : l'utilisateur a un state.cart.shareToken
 *                    → GET /api/shared-carts/public/:token  (progression + participants)
 *                    → formulaire contribution (créateur = participant principal)
 *                    → bouton clôturer → POST /api/shared-carts/:id/finalize (auth)
 *                    → polling 30s pendant que la vue est ouverte
 *
 *   MODE PARTICIPANT : URL contient ?p=TOKEN ou /cart/shared/TOKEN
 *                    → même endpoint public
 *                    → formulaire contribution → POST …/contributions → Stripe
 *
 * Aucun localStorage. Tout vient du backend.
 * Le créateur est aussi participant : il contribue via le même endpoint public,
 * puis clôture via l'endpoint authentifié /:id/finalize.
 */

import { state }     from './b-store.js';
import { showToast } from './b-cart-core.js';
import { sanitize, fmt, apiGet, apiPost } from './b-utils.js';

/* ── Détection token participant dans l'URL ────────────────────── */

export function detectParticipantToken() {
  const url = new URL(window.location.href);
  const qp  = url.searchParams.get('p');
  if (qp) return qp;
  const m = url.pathname.match(/\/cart\/shared\/([^/?#]+)/);
  if (m) return m[1];
  return null;
}

/* ── Conteneur (créé une seule fois) ───────────────────────────── */

function getOrCreateEl() {
  let el = document.getElementById('k-group-view');
  if (!el) {
    el = document.createElement('div');
    el.id        = 'k-group-view';
    el.className = 'k-group-view';
    const anchor = document.getElementById('k-fav-view')
                || document.getElementById('k-catalog-section');
    anchor?.after(el);
  }
  return el;
}

/* ── Polling ───────────────────────────────────────────────────── */

let _pollTimer = null;

function startPolling(token, onRefresh) {
  stopPolling();
  _pollTimer = setInterval(async () => {
    if (!document.getElementById('k-group-view')?.classList.contains('show')) {
      stopPolling();
      return;
    }
    const data = await fetchSharedCart(token);
    if (data) onRefresh(data);
  }, 30_000);
}

function stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

/* ── API ───────────────────────────────────────────────────────── */

async function fetchSharedCart(token) {
  try { return await apiGet(`/api/shared-carts/public/${token}`); }
  catch (_) { return null; }
}

/* ── Rendu : carte progression ─────────────────────────────────── */

function renderProgressCard(data) {
  const cart          = data.cart || {};
  const contributions = data.contributions || [];
  const total         = Number(cart.total_kmf_snapshot) || 0;
  const collected     = contributions.reduce((s, c) => s + (Number(c.amount_kmf) || 0), 0);
  const remaining     = Math.max(0, total - collected);
  const pct           = total > 0 ? Math.max(0, Math.min(100, Math.round((collected / total) * 100))) : 0;
  const isFinalized   = cart.status === 'finalized';
  const title         = sanitize(cart.title || 'Panier partagé');

  const participantRows = contributions.length
    ? contributions.map(c => `
        <div class="k-group-contrib-row">
          <span class="k-group-contrib-name">${sanitize(c.contributor_name || c.first_name || 'Anonyme')}</span>
          <span class="k-group-contrib-amount">${fmt(Number(c.amount_kmf) || 0, 'KMF')}</span>
        </div>`).join('')
    : '<p class="k-group-contrib-empty">Aucune contribution encore.</p>';

  return `
    <div class="k-group-progress-card" id="k-group-progress-card">
      <div class="k-group-card-head">
        <div>
          <div class="k-group-card-title">${title}</div>
          <div class="k-group-card-meta">${contributions.length} contribution${contributions.length > 1 ? 's' : ''}</div>
        </div>
        <span class="k-group-pill ${isFinalized ? 'is-paid' : 'is-open'}">${isFinalized ? 'Clôturé' : 'Ouvert'}</span>
      </div>

      <div class="k-group-money">
        <span>${fmt(collected, 'KMF')} collectés</span>
        <strong>${fmt(total, 'KMF')} total</strong>
      </div>
      <div class="k-group-progress" aria-label="Progression ${pct}%">
        <span style="width:${pct}%" class="k-group-progress-bar"></span>
      </div>
      ${remaining > 0 && !isFinalized
        ? `<p class="k-group-remaining">Reste à collecter : <strong>${fmt(remaining, 'KMF')}</strong></p>`
        : ''}

      <div class="k-group-contribs">
        <div class="k-group-contribs-label">Participants</div>
        ${participantRows}
      </div>

      ${isFinalized
        ? `<p class="k-group-finalized-hint">✅ Ce panier a été clôturé et converti en commande.</p>`
        : ''}
    </div>`;
}

/* ── Rendu : formulaire de contribution (commun créateur/participant) ── */
// Le créateur passe isCreator=true pour voir les actions supplémentaires.

function renderContributeForm(token, shareUrl, isCreator = false) {
  return `
    <div class="k-group-card k-group-contribute-card" id="k-group-contribute-card">
      <div class="k-group-section-title">${isCreator ? '💸 Ma contribution' : '💸 Contribuer'}</div>

      <div class="k-group-field">
        <label class="k-group-label" for="k-gc-name">Votre prénom</label>
        <input id="k-gc-name" class="k-group-input" type="text"
          placeholder="Ex : Fatima" maxlength="60" autocomplete="given-name">
      </div>
      <div class="k-group-field">
        <label class="k-group-label" for="k-gc-email">Votre email</label>
        <input id="k-gc-email" class="k-group-input" type="email"
          placeholder="Ex : fatima@gmail.com" maxlength="120" autocomplete="email">
      </div>
      <div class="k-group-field">
        <label class="k-group-label" for="k-gc-amount">Montant (KMF)</label>
        <input id="k-gc-amount" class="k-group-input" type="number"
          min="100" step="100" placeholder="Ex : 5 000" inputmode="numeric">
      </div>
      <div class="k-group-field">
        <label class="k-group-label" for="k-gc-msg">Message (optionnel)</label>
        <input id="k-gc-msg" class="k-group-input" type="text"
          placeholder="Ex : Avec tout mon amour ❤️" maxlength="200">
      </div>
      <p class="k-group-input-error" id="k-gc-err"></p>
      <button class="k-group-btn k-group-btn--primary" id="k-gc-pay-btn">
        💳 Payer ma contribution
      </button>

      ${isCreator ? `
        <div class="k-group-divider"></div>
        <div class="k-group-creator-actions">
          <button class="k-group-btn k-group-btn--ghost" id="k-group-reshare">
            📲 Re-partager
          </button>
          <button class="k-group-btn k-group-btn--copy" id="k-group-copy">
            🔗 Copier le lien
          </button>
        </div>
        <button class="k-group-btn k-group-btn--finalize" id="k-group-finalize">
          🔒 Clôturer et commander
        </button>
        <p class="k-group-finalize-hint">
          Clôture le panier et crée la commande avec les contributions reçues.
          Les montants manquants seront à régler à la livraison.
        </p>
      ` : ''}
    </div>`;
}

/* ── Bind : formulaire de contribution ─────────────────────────── */

function bindContributeForm(el, token) {
  const btn    = el.querySelector('#k-gc-pay-btn');
  const errEl  = el.querySelector('#k-gc-err');

  btn?.addEventListener('click', async () => {
    const name   = (el.querySelector('#k-gc-name')?.value  || '').trim();
    const email  = (el.querySelector('#k-gc-email')?.value || '').trim();
    const amount = Number(el.querySelector('#k-gc-amount')?.value);
    const msg    = (el.querySelector('#k-gc-msg')?.value   || '').trim();

    if (!name)              { errEl.textContent = 'Votre prénom est requis.'; return; }
    if (!email || !email.includes('@')) { errEl.textContent = 'Un email valide est requis.'; return; }
    if (!amount || amount < 100) { errEl.textContent = 'Montant minimum : 100 KMF.'; return; }
    errEl.textContent = '';

    btn.disabled    = true;
    btn.textContent = '⏳ Redirection…';

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
      errEl.textContent = err?.message || 'Erreur lors de la contribution.';
      btn.disabled      = false;
      btn.textContent   = '💳 Payer ma contribution';
    }
  });
}

/* ── Bind : actions créateur (reshare, copy, finalize) ─────────── */

function bindCreatorActions(el, cart, shareUrl) {
  el.querySelector('#k-group-reshare')?.addEventListener('click', () => {
    const msg = `Rejoins mon panier Komerce : "${sanitize(cart.title || 'Panier partagé')}" → ${shareUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
  });

  el.querySelector('#k-group-copy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('Lien copié !', 'success');
    } catch (_) {
      showToast('Impossible de copier.', 'error');
    }
  });

  el.querySelector('#k-group-finalize')?.addEventListener('click', async () => {
    const cartId = state.cart?.shareId;
    if (!cartId) {
      showToast('ID du panier introuvable. Rechargez la page.', 'error');
      return;
    }

    const btn = el.querySelector('#k-group-finalize');
    btn.disabled    = true;
    btn.textContent = '⏳ Clôture en cours…';

    try {
      const res = await apiPost(`/api/shared-carts/${cartId}/finalize`, {});

      // Clôture réussie → nettoyer le state, afficher confirmation
      state.cart.shareToken = null;
      state.cart.shareId    = null;
      try { sessionStorage.removeItem('kmrc_share'); } catch (_) {}

      // Importer refreshGroupBadge en évitant référence circulaire
      refreshGroupBadge();

      el.innerHTML = `
        <div class="k-group-success">
          <div class="k-group-success-icon">🎉</div>
          <strong>Panier clôturé !</strong>
          <p>Commande <strong>${sanitize(res.order_reference || '')}</strong> créée.</p>
          ${res.prepaid_kmf > 0
            ? `<p class="k-group-success-detail">${fmt(res.prepaid_kmf, 'KMF')} prépayés via les contributions.</p>`
            : ''}
          ${res.remaining_cash_kmf > 0
            ? `<p class="k-group-success-detail k-group-success-remain">Reste à régler : ${fmt(res.remaining_cash_kmf, 'KMF')}</p>`
            : ''}
          <button class="k-group-btn k-group-btn--ghost k-group-btn--mt" id="k-group-to-track">
            📦 Voir ma commande
          </button>
        </div>`;

      el.querySelector('#k-group-to-track')?.addEventListener('click', () => {
        import('./b-nav.js').then(({ switchView }) => {
          import('./b-tracking.js').then(({ renderTrackView }) => {
            document.querySelectorAll('.k-bnav-item, .k-header-nav-btn').forEach(i => {
              i.classList.toggle('active', i.dataset.tab === 'track');
            });
            renderTrackView();
            switchView('track');
          });
        });
      });

    } catch (err) {
      // Cas stock insuffisant (409)
      if (err?.code === 'stock_issues' || err?.message?.includes('stock')) {
        errEl(el, err.message || 'Problème de stock. Acceptez-vous de continuer quand même ?');
        btn.disabled    = false;
        btn.textContent = '🔒 Clôturer et commander';
        return;
      }
      showToast(err?.message || 'Erreur lors de la clôture.', 'error');
      btn.disabled    = false;
      btn.textContent = '🔒 Clôturer et commander';
    }
  });
}

function errEl(el, msg) {
  const e = el.querySelector('#k-gc-err') || el.querySelector('.k-group-input-error');
  if (e) e.textContent = msg;
}

/* ── Rendu état vide / erreur ──────────────────────────────────── */

function renderEmpty(el) {
  el.innerHTML = `
    <div class="k-group-empty">
      <div class="k-group-empty-icon">👥</div>
      <strong>Aucun panier partagé actif</strong>
      <span>Créez-en un depuis votre panier avec "Payer à plusieurs".</span>
    </div>`;
}

function renderLoadError(el) {
  el.innerHTML = `
    <div class="k-group-empty">
      <div class="k-group-empty-icon">❌</div>
      <strong>Panier introuvable</strong>
      <span>Ce lien est peut-être expiré ou invalide.</span>
    </div>`;
}

/* ── Point d'entrée principal ──────────────────────────────────── */

export async function renderGroupView(opts = {}) {
  stopPolling();
  const el = getOrCreateEl();

  el.innerHTML = `
    <div class="k-group-loading">
      <div class="k-group-spin"></div>
      <p>Chargement…</p>
    </div>`;

  const participantToken = opts.participantToken || null;
  const creatorToken     = state.cart?.shareToken || null;
  const token            = participantToken || creatorToken;

  if (!token) { renderEmpty(el); return; }

  const data = await fetchSharedCart(token);
  if (!data?.cart) { renderLoadError(el); return; }

  const host       = window.location.origin;
  const shareUrl   = data.cart.share_url || `${host}/cart/shared/${token}`;
  const isCreator  = !participantToken || (participantToken === creatorToken);
  const isFinalized = data.cart.status === 'finalized';

  if (isCreator) {
    // ── MODE CRÉATEUR ──────────────────────────────────────────
    // Progression + contribution créateur + clôture
    el.innerHTML = `
      <div class="k-group-header">
        <h2>👥 Mon panier partagé</h2>
        <p class="k-group-subhead">Suivi en temps réel — tu peux aussi contribuer toi-même.</p>
      </div>
      ${renderProgressCard(data)}
      ${isFinalized ? '' : renderContributeForm(token, shareUrl, true)}`;

    if (!isFinalized) {
      bindContributeForm(el, token);
      bindCreatorActions(el, data.cart, shareUrl);
    }

    // Polling : mettre à jour uniquement la carte de progression
    startPolling(token, (freshData) => {
      const card = el.querySelector('#k-group-progress-card');
      if (card) {
        card.outerHTML = renderProgressCard(freshData);
        // Les actions de contribution ne changent pas — pas besoin de rebind
      }
    });

  } else {
    // ── MODE PARTICIPANT ───────────────────────────────────────
    const items = data.items || [];
    const total = Number(data.cart.total_kmf_snapshot) || 0;
    const title = sanitize(data.cart.title || 'Panier partagé');

    const itemRows = items.map(it => `
      <div class="k-group-item-row">
        <span class="k-group-item-name">${sanitize(it.product_name || it.name || 'Produit')}</span>
        <span class="k-group-item-qty">×${it.quantity || 1}</span>
        <span class="k-group-item-price">${fmt(Number(it.unit_price_kmf || it.price || 0), 'KMF')}</span>
      </div>`).join('') || '<p class="k-group-contrib-empty">Aucun article.</p>';

    el.innerHTML = `
      <div class="k-group-header">
        <h2>👥 Panier partagé</h2>
        <p class="k-group-subhead">Contribue à ce panier collectif.</p>
      </div>
      <div class="k-group-card k-group-items-card">
        <div class="k-group-card-head">
          <div>
            <div class="k-group-card-title">${title}</div>
            <div class="k-group-card-meta">Total : ${fmt(total, 'KMF')}</div>
          </div>
          <span class="k-group-pill is-open">Ouvert</span>
        </div>
        <div class="k-group-items-list">${itemRows}</div>
      </div>
      ${renderContributeForm(token, shareUrl, false)}`;

    bindContributeForm(el, token);
  }
}

/* ── Badge bnav ────────────────────────────────────────────────── */

export function refreshGroupBadge() {
  const badge = document.getElementById('k-bnav-group-badge');
  if (!badge) return;
  badge.classList.toggle('show', !!state.cart?.shareToken);
}
