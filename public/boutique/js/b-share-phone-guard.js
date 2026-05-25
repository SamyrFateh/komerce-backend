/**
 * @module b-share-phone-guard
 * @brief P0-bis — identification minimale du créateur non connecté.
 *
 * Ce module ne remplace pas b-share-cart.js.
 * Il intercepte uniquement la création de panier partagé lorsque l'utilisateur
 * n'est pas connecté, afin d'envoyer un tracking_phone propre en E.164.
 */

import { state } from './b-store.js';
import { showToast } from './b-cart-core.js';
import { refreshSharedBadges } from './b-share-cart.js';
import { showBanner } from './b-group-banner.js';

const API_CREATE = '/api/shared-carts/from-cart-items';

function isConnected() {
  return window.K?.isConnected?.() || false;
}

function digitsOnly(v) {
  return String(v || '').trim().replace(/[^\d+]/g, '');
}

function normalizePhone(raw, countryCode) {
  let value = digitsOnly(raw);
  if (!value) return null;

  if (value.startsWith('00')) value = '+' + value.slice(2);
  if (value.startsWith('+')) {
    const n = value.slice(1);
    return n.length >= 8 && n.length <= 15 && /^\d+$/.test(n) ? value : null;
  }

  if (countryCode === '+33') {
    if (value.startsWith('33')) value = value.slice(2);
    if (value.startsWith('0')) value = value.slice(1);
    if (value.length !== 9) return null;
    if (!value.startsWith('6') && !value.startsWith('7')) return null;
    if (!/^\d+$/.test(value)) return null;
    return '+33' + value;
  }

  if (countryCode === '+269') {
    if (value.startsWith('269')) value = value.slice(3);
    if (value.length !== 7) return null;
    if (!/^\d+$/.test(value)) return null;
    return '+269' + value;
  }

  return null;
}

function ensureStyles() {
  if (document.getElementById('k-share-phone-guard-styles')) return;
  const style = document.createElement('style');
  style.id = 'k-share-phone-guard-styles';
  style.textContent = `
.k-spg-overlay{position:fixed;inset:0;z-index:2100;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center}
@media(min-width:600px){.k-spg-overlay{align-items:center}}
.k-spg-sheet{width:100%;max-width:420px;background:var(--white);border-radius:20px 20px 0 0;padding:26px 20px calc(28px + env(safe-area-inset-bottom));box-shadow:0 -10px 30px rgba(0,0,0,.18)}
@media(min-width:600px){.k-spg-sheet{border-radius:18px;padding-bottom:26px}}
.k-spg-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.k-spg-title{font-size:17px;font-weight:800;color:var(--text)}
.k-spg-close{border:none;background:var(--sand);border-radius:999px;width:32px;height:32px;cursor:pointer;color:var(--text-muted)}
.k-spg-hint{font-size:12px;line-height:1.45;color:var(--text-muted);margin:0 0 14px}
.k-spg-field{margin-bottom:12px}
.k-spg-label{display:block;font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em}
.k-spg-input,.k-spg-select{width:100%;box-sizing:border-box;border:2px solid var(--border);border-radius:var(--radius-sm);background:var(--white);color:var(--text);font-family:var(--font);font-size:15px;padding:11px 13px;outline:none}
.k-spg-input:focus,.k-spg-select:focus{border-color:var(--violet)}
.k-spg-phone-row{display:grid;grid-template-columns:112px 1fr;gap:8px}
.k-spg-error{font-size:12px;color:var(--red-danger-text);min-height:18px;margin:2px 0 0}
.k-spg-submit{width:100%;border:none;border-radius:999px;background:var(--violet);color:var(--white);font-weight:800;font-size:15px;padding:14px;margin-top:12px;cursor:pointer}
.k-spg-submit:disabled{background:var(--sand-dark);color:var(--text-light);cursor:not-allowed}
.k-spg-actions{display:grid;gap:9px;margin-top:14px}
.k-spg-secondary{width:100%;border:1px solid var(--border);border-radius:999px;background:var(--white);color:var(--text);font-weight:800;font-size:14px;padding:12px;cursor:pointer}`;
  document.head.appendChild(style);
}

function openGuestModal() {
  ensureStyles();
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'k-spg-overlay';
    overlay.innerHTML = `
      <div class="k-spg-sheet" role="dialog" aria-modal="true">
        <form id="k-spg-form" novalidate>
          <div class="k-spg-head">
            <span class="k-spg-title">Payer en groupe</span>
            <button class="k-spg-close" type="button" aria-label="Fermer">x</button>
          </div>
          <p class="k-spg-hint">Indiquez un contact fiable pour retrouver le panier et recevoir le suivi.</p>
          <div class="k-spg-field">
            <label class="k-spg-label" for="k-spg-title">Nom du panier</label>
            <input id="k-spg-title" class="k-spg-input" type="text" maxlength="80" placeholder="Ex : Cadeau mariage Aicha">
          </div>
          <div class="k-spg-field">
            <label class="k-spg-label" for="k-spg-name">Votre prénom</label>
            <input id="k-spg-name" class="k-spg-input" type="text" maxlength="60" placeholder="Ex : Fatima" autocomplete="given-name">
          </div>
          <div class="k-spg-field">
            <label class="k-spg-label" for="k-spg-phone">Votre numéro WhatsApp</label>
            <div class="k-spg-phone-row">
              <select id="k-spg-country" class="k-spg-select" aria-label="Indicatif pays">
                <option value="+269">KM +269</option>
                <option value="+33">FR +33</option>
              </select>
              <input id="k-spg-phone" class="k-spg-input" type="tel" maxlength="20" placeholder="3211234 ou 06..." autocomplete="tel">
            </div>
          </div>
          <p class="k-spg-error" id="k-spg-error"></p>
          <button class="k-spg-submit" id="k-spg-submit" type="submit">Créer le panier</button>
        </form>
      </div>`;

    const close = value => {
      document.removeEventListener('keydown', onKeydown, true);
      overlay.remove();
      resolve(value);
    };
    const submit = event => {
      event?.preventDefault?.();
      const title = overlay.querySelector('#k-spg-title')?.value.trim() || '';
      const name = overlay.querySelector('#k-spg-name')?.value.trim() || '';
      const rawPhone = overlay.querySelector('#k-spg-phone')?.value.trim() || '';
      const country = overlay.querySelector('#k-spg-country')?.value || '+269';
      const phone = normalizePhone(rawPhone, country);
      const err = overlay.querySelector('#k-spg-error');

      if (!name) { err.textContent = 'Prénom requis.'; return; }
      if (!phone) { err.textContent = 'Numéro invalide pour l’indicatif choisi.'; return; }
      close({ title, name, phone });
    };
    const onKeydown = event => {
      if (event.key === 'Escape') close(null);
    };

    overlay.querySelector('.k-spg-close')?.addEventListener('click', () => close(null));
    overlay.querySelector('#k-spg-form')?.addEventListener('submit', submit);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    document.addEventListener('keydown', onKeydown, true);
    document.body.appendChild(overlay);
    overlay.querySelector('#k-spg-name')?.focus();
  });
}

function openSuccessModal(title, shareUrl) {
  ensureStyles();
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'k-spg-overlay';
    overlay.innerHTML = `
      <div class="k-spg-sheet" role="dialog" aria-modal="true">
        <div class="k-spg-head">
          <span class="k-spg-title">Panier créé</span>
          <button class="k-spg-close" type="button" aria-label="Fermer">x</button>
        </div>
        <p class="k-spg-hint">Votre panier groupe est prêt. Partagez le lien maintenant ou ouvrez le suivi.</p>
        <div class="k-spg-actions">
          <button class="k-spg-submit" id="k-spg-share" type="button">Partager sur WhatsApp</button>
          <button class="k-spg-secondary" id="k-spg-follow" type="button">Voir le suivi</button>
        </div>
      </div>`;

    const close = action => {
      document.removeEventListener('keydown', onKeydown, true);
      overlay.remove();
      resolve(action);
    };
    const onKeydown = event => {
      if (event.key === 'Escape') close('follow');
    };

    overlay.querySelector('.k-spg-close')?.addEventListener('click', () => close('follow'));
    overlay.querySelector('#k-spg-share')?.addEventListener('click', () => {
      const msg = `Salut ! J'ai créé un panier commun sur Komerce : "${title || 'Panier groupe'}". Contribue ici : ${shareUrl}`;
      window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
      navigator.clipboard?.writeText(shareUrl).catch(() => {});
      close('follow');
    });
    overlay.querySelector('#k-spg-follow')?.addEventListener('click', () => close('follow'));
    overlay.addEventListener('click', e => { if (e.target === overlay) close('follow'); });
    document.addEventListener('keydown', onKeydown, true);
    document.body.appendChild(overlay);
    overlay.querySelector('#k-spg-share')?.focus();
  });
}

async function createSharedCart(formData) {
  const cartItems = (state.cart || [])
    .map(it => ({ product_id: it.product?.id || it.id, quantity: Number(it.qty) || 1 }))
    .filter(it => it.product_id);

  const res = await fetch(API_CREATE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      cart_items: cartItems,
      ...(formData.title ? { title: formData.title } : {}),
      tracking_phone: formData.phone,
      recipient_name: formData.name,
    }),
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `Erreur API (${res.status})`);
  }
  return res.json();
}

function saveShareState() {
  try {
    sessionStorage.setItem('kmrc_share', JSON.stringify({
      token: state.shareToken,
      id: state.shareId,
      expiry: state.shareExpiry,
      name: state.cartName,
      status: state.shareStatus,
      total_kmf: state.shareTotalKmf,
      contributed_kmf: state.shareContributedKmf,
      remaining_kmf: state.shareRemainingKmf,
      share_url: state.shareUrl,
    }));
  } catch (_) {}
}

function switchToGroup() {
  import('./b-nav.js')
    .then(({ switchView }) => import('./b-group-view.js')
      .then(({ renderGroupView }) => {
        document.querySelectorAll('.k-bnav-item, .k-header-nav-btn')
          .forEach(i => i.classList.toggle('active', i.dataset.tab === 'group'));
        renderGroupView();
        switchView('group');
      }))
    .catch(() => showToast('Impossible d’ouvrir le suivi groupe.', 'error'));
}

async function runGuestFlow() {
  if (!state.cart?.length) {
    showToast("Ajoutez d'abord des produits au panier.", 'error');
    return;
  }
  const formData = await openGuestModal();
  if (!formData) return;

  const btn = document.getElementById('k-cart-share') || document.getElementById('k-sc-share');
  if (btn) { btn.disabled = true; btn.textContent = 'Création...'; }

  try {
    const data = await createSharedCart(formData);
    const title = formData.title || 'Panier groupe';
    const shareUrl = data.share_url || `${window.location.origin}/cart/shared/${data.token}`;

    state.shareToken = data.token;
    state.shareId = data.shared_cart_id;
    state.shareExpiry = data.expires_at;
    state.cartName = title;
    state.shareStatus = 'active';
    state.shareTotalKmf = Number(data.total_kmf) || 0;
    state.shareContributedKmf = 0;
    state.shareRemainingKmf = Number(data.total_kmf) || 0;
    state.shareUrl = shareUrl;
    saveShareState();

    refreshSharedBadges(true, {
      id: state.shareId,
      token: state.shareToken,
      title,
      status: 'active',
      total_kmf_snapshot: state.shareTotalKmf,
      contributed_kmf: 0,
      remaining_kmf: state.shareRemainingKmf,
      expires_at: state.shareExpiry,
      share_url: shareUrl,
    });
    showBanner({ title, expires_at: state.shareExpiry, status: 'active', contributed_kmf: 0, total_kmf_snapshot: state.shareTotalKmf });
    await openSuccessModal(title, shareUrl);
    switchToGroup();
  } catch (err) {
    showToast(`Erreur : ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = state.shareToken ? 'Voir le groupe' : 'Payer en groupe'; }
  }
}

function captureShareClick(event) {
  const target = event.target?.closest?.('#k-cart-share, #k-sc-share');
  if (!target) return;
  if (isConnected() || state.shareToken) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  runGuestFlow();
}

export function setupSharePhoneGuard() {
  document.addEventListener('click', captureShareClick, true);
}
