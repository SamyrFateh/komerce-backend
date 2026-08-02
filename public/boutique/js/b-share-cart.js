/**
 * @komerce-arch
 * @role          shared-cart-creation-from-boutique
 * @domain        shared-cart
 * @layer         ui-component
 * @criticality   critical
 * @inputs        cart_state, phone_identity, share_mode, delivery_date_options
 * @outputs       shared_cart_link, clear_local_cart_signal, group_view_transition
 * @depends       b-store.js, b-cart-core.js, b-cart.js, group/group-render-list.js, b-group-banner.js, b-phone.js, b-checkout.js, b-identity.js
 * @used-by       boutique.js, b-modal-approche-c-hybrid.js
 * @doctrine      partager_geste_natif, panier_ouvert_ferme, paiement_seul_acte_engageant, boutique_canal_decouverte
 * @impact-areas  shared-cart-creation, checkout, participant-flow, creator-flow, local-cart
 * @version       2026-06
 */
'use strict';

/**
 * @module b-share-cart
 * @brief Flow "📤 Partager" — côté créateur.
 *
 * Doctrine boutique-first — Mai 2026 :
 *   - un panier partagé actif n'empêche pas d'en créer un autre.
 *   - /mine restaure le dernier panier actif seulement comme raccourci de suivi.
 *   - le checkout/sidebar reste le panier courant : pas d'état ni suivi groupe.
 *   - le backend reste source de vérité pour la limite de paniers actifs.
 */

import { state } from './b-store.js';
import { showToast } from './b-cart-core.js';
import { clearCart } from './b-cart.js';  // Doctrine v4.2 — N4-CLEAR
import { refreshGroupBadge } from './group/group-state.js';
import { showBanner, hideBanner, refreshBanner } from './b-group-banner.js';
import {
  PHONE_COUNTRIES,
  buildPhoneSelect,
  isValidLocalLength,
  buildE164,
  digitsOnly,
  prettifyLocal,
  makeIntlPhoneInput,
} from './b-phone.js';
// O7.3 (provider payments) : makeIntlPhoneInput déplacé vers l'import
// b-phone.js ci-dessus — b-checkout.js ne faisait que le ré-exporter
// "pour compatibilité" (commentaire déjà présent dans b-checkout.js,
// héritage d'un fix antérieur qui avait déplacé l'implémentation vers
// b-phone.js pour casser un autre cycle, b-checkout<->b-identity). Le vrai
// propriétaire est auth-identity, pas payments — voir docs/O7_3_BOUNDARY_ANALYSIS.md.
// makeInput reste un import réel et légitime de payments (b-checkout-render.js).
// FIX UX — Réutiliser les helpers checkout pour un style uniforme (padding, indicatifs)
import { makeInput } from './b-checkout.js';
import { requireIdentity } from './b-identity.js';
import { sanitize } from './b-utils.js'; // GOV-10-B2
// FIX 2026-07-10-b — restoreSharedCartFromBackend() utilisait un fetch() nu
// (cf. E13b) : sur /mine pendu (pool DB saturé, panne), la promesse ne se
// réglait jamais → même symptôme que le bug d'origine (chargement infini),
// simplement déplacé du chemin direct getOwnerSharedCarts() vers ce fallback
// de restauration. On réutilise le même wrapper garanti (Promise.race, ≤10s).
import { fetchWithTimeout } from './group/group-api.js';

const API_CREATE = '/api/shared-carts/from-cart-items';
const API_MINE = '/api/shared-carts/mine';
const ACTIVE_STATUSES = new Set(['open', 'closed', 'awaiting_choice']);

/* ── Helpers ───────────────────────────────────────────────────── */
function r(n) { return Math.round(Number(n) || 0); }

function pct(contributed, total) {
  const t = r(total);
  if (!t) return 0;
  return Math.max(0, Math.min(100, Math.round((r(contributed) / t) * 100)));
}

// Date qui pilote l'affichage : fenêtre de paiement si ouverte, sinon date
// limite choisie, sinon le champ legacy expires_at (doctrine — harmonisation).
function effectiveDeadline(cart) {
  return cart?.payment_window_ends_at || cart?.target_date || cart?.expires_at || null;
}

function timeRemaining(expiresAt) {
  if (!expiresAt) return 'actif';
  const diffMs = new Date(expiresAt) - Date.now();
  if (diffMs <= 0) return 'expiré';
  const h = Math.floor(diffMs / 3_600_000);
  const m = Math.floor((diffMs % 3_600_000) / 60_000);
  if (h >= 48) return `${Math.floor(h / 24)}j restants`;
  if (h >= 1) return `${h}h${m > 0 ? m + 'min' : ''} restantes`;
  return `${Math.max(1, m)}min restantes`;
}

function isActiveCart(cart) {
  return cart != null && ACTIVE_STATUSES.has(cart.status);
}

function pickActiveCart(carts = []) {
  return [...carts]
    .filter(isActiveCart)
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0] || null;
}

function applyCartToState(cart) {
  if (!cart) return null;
  state.shareToken = cart.token || null;
  state.shareId = cart.id || null;
  state.shareExpiry = effectiveDeadline(cart);
  state.cartName = cart.title || 'Panier groupe';
  state.shareStatus = cart.status || null;
  state.shareTotalKmf = r(cart.total_kmf_snapshot);
  state.shareContributedKmf = r(cart.contributed_kmf);
  state.shareRemainingKmf = r(cart.remaining_kmf);
  state.shareUrl = cart.share_url || (cart.token ? `${window.location.origin}/boutique/?p=${cart.token}` : null);
  saveShareState();
  return cart;
}

/* ── Persistance session : cache uniquement ─────────────────────── */
function loadShareState() {
  try {
    const raw = sessionStorage.getItem('kmrc_share');
    if (!raw) return;
    const s = JSON.parse(raw);
    state.shareToken = s.token || null;
    state.shareId = s.id || null;
    state.shareExpiry = s.expiry || null;
    state.cartName = s.name || '';
    state.shareStatus = s.status || null;
    state.shareTotalKmf = r(s.total_kmf);
    state.shareContributedKmf = r(s.contributed_kmf);
    state.shareRemainingKmf = r(s.remaining_kmf);
    state.shareUrl = s.share_url || null;
  } catch (_) {}
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

function clearLocalShareState() {
  state.shareToken = null;
  state.shareId = null;
  state.shareExpiry = null;
  state.cartName = '';
  state.shareStatus = null;
  state.shareTotalKmf = 0;
  state.shareContributedKmf = 0;
  state.shareRemainingKmf = 0;
  state.shareUrl = null;
  try {
    sessionStorage.removeItem('kmrc_share');
    sessionStorage.removeItem('kmrc_banner_dismissed');
  } catch (_) {}
}

export function clearShareState() {
  clearLocalShareState();
  refreshGroupBadge();
  hideBanner();
  refreshSharedBadges(false);
}

/* ── Restauration backend : source de vérité P0 ─────────────────── */
export async function restoreSharedCartFromBackend({ silent = true } = {}) {
  try {
    const res = await fetchWithTimeout(API_MINE, { credentials: 'include' });
    if (!res.ok) {
      // FIX S2-05 — utilisateur non connecté : ne pas effacer l'état local chargé
      // depuis sessionStorage. Le shareToken restera valide pour startShareFlow().
      if (res.status === 401 || res.status === 403) return null;
      throw new Error(`GET /mine ${res.status}`);
    }
    const data = await res.json().catch(() => ({}));
    const cart = pickActiveCart(data.carts || []);

    if (!cart) {
      // FIX S2-05 — effacer uniquement si le backend confirme qu'il n'y a pas de
      // panier actif (réponse 200 + liste vide). Ne jamais effacer sur erreur réseau.
      clearLocalShareState();
      refreshSharedBadges(false);
      hideBanner();
      refreshGroupBadge();
      return null;
    }

    applyCartToState(cart);
    refreshSharedBadges(true, cart);
    refreshGroupBadge();
    showBanner({
      title: cart.title,
      expires_at: effectiveDeadline(cart),
      status: cart.status,
      contributed_kmf: cart.contributed_kmf,
      total_kmf_snapshot: cart.total_kmf_snapshot,
    });
    return cart;
  } catch (err) {
    if (!silent) showToast(`Panier groupe non restauré : ${err.message}`, 'error');
    return null;
  }
}

/* ── Détection session ──────────────────────────────────────────── */
function isConnected() {
  return window.K?.isConnected?.() || false;
}

/* ── Sidebar / badges ───────────────────────────────────────────── */
function ensureSidebarStyles() {
  /* CSS migré → css/share-cart.css (doctrine §1). No-op conservé pour compat des appels. */
}

function renderSidebarSummary(cart = {}) {
  const desktopBadge = document.getElementById('k-sc-shared-badge');
  if (!desktopBadge) return;
  ensureSidebarStyles();
  desktopBadge.hidden = true;
  desktopBadge.innerHTML = '';
}

export function refreshSharedBadges(isShared, cart = null) {
  const mobileBadge = document.getElementById('k-share-badge-row');
  const mobileShare = document.getElementById('k-cart-share');
  if (mobileBadge) mobileBadge.hidden = !isShared;
  if (mobileShare) mobileShare.textContent = '📤 Partager';

  const desktopBadge = document.getElementById('k-sc-shared-badge');
  const desktopShare = document.getElementById('k-sc-share');
  if (desktopBadge) {
    desktopBadge.hidden = true;
    desktopBadge.innerHTML = '';
  }
  if (desktopShare) {
    desktopShare.hidden = false;
    desktopShare.textContent = '📤 Partager';
  }

  refreshGroupBadge();
}

/* ── Modal générique ────────────────────────────────────────────── */
function ensureStyles() {
  /* CSS migré → css/share-cart.css (doctrine §1). No-op conservé pour compat des appels. */
}

function openModal(content) {
  ensureStyles();
  const ov = document.createElement('div');
  ov.className = 'k-share-modal-overlay';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.innerHTML = `<div class="k-share-modal-sheet">${content}</div>`;
  ov.addEventListener('click', e => { if (e.target === ov) closeModal(ov); });
  document.body.appendChild(ov);
  return ov;
}

function closeModal(ov) {
  ov.style.animation = 'kSMFadeIn .15s ease reverse';
  setTimeout(() => ov.remove(), 150);
}

/* ── Étape A : formulaire init ──────────────────────────────────── */
// FIX UX — Rewritten to use checkout DOM builders (makeInput / makeIntlPhoneInput)
// so padding, labels and phone selector match the checkout UX exactly.
function promptInit(needsAuth) {
  return new Promise(resolve => {
    ensureStyles();
    const ov = document.createElement('div');
    ov.className = 'k-share-modal-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');

    const sheet = document.createElement('div');
    sheet.className = 'k-share-modal-sheet';

    // ── Header ────────────────────────────────────────────────────
    const head = document.createElement('div');
    head.className = 'k-sm-head';
    head.innerHTML =
      '<span class="k-sm-title">📤 Partager</span>' +
      '<button class="k-sm-close" aria-label="Fermer">✕</button>';
    sheet.appendChild(head);

    const hint = document.createElement('p');
    hint.className = 'k-sm-hint';
    hint.textContent = 'Partagez votre panier par WhatsApp. Vos proches voient les articles et règlent leur part.';
    sheet.appendChild(hint);

    // ── Champ titre (même style que k-ck-group du checkout) ────────
    const titleData = { title: '' };
    const titleGroup = makeInput('k-sm-title-f', 'Nom du panier (optionnel)', 'text', 'Ex : Cadeau mariage Aïcha', titleData, 'title');
    titleGroup.querySelector('input')?.setAttribute('maxlength', '80');
    titleGroup.querySelector('input')?.setAttribute('autocomplete', 'off');
    sheet.appendChild(titleGroup);

    // ── Nature du panier (doctrine §5) : une question humaine, pas un workflow ──
    let shareMode = 'ready_to_pay';
    const natureWrap = document.createElement('div');
    natureWrap.className = 'k-sm-field';
    natureWrap.innerHTML =
      '<label class="k-sm-label">Ce panier est-il prêt à être payé ?</label>' +
      '<div class="k-sm-nature" role="radiogroup">' +
        '<button type="button" class="k-sm-nature-opt is-active" data-mode="ready_to_pay" role="radio" aria-checked="true">' +
          '<strong>Oui, ouvrir les paiements</strong>' +
          '<span>Vos proches consultent et règlent leur part tout de suite.</span>' +
        '</button>' +
        '<button type="button" class="k-sm-nature-opt" data-mode="needs_validation" role="radio" aria-checked="false">' +
          '<strong>Non, partager d\'abord</strong>' +
          '<span>Ils consultent maintenant. Vous ouvrez le paiement quand le panier est confirmé.</span>' +
        '</button>' +
      '</div>';
    sheet.appendChild(natureWrap);
    natureWrap.querySelectorAll('.k-sm-nature-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        shareMode = opt.dataset.mode;
        natureWrap.querySelectorAll('.k-sm-nature-opt').forEach(o => {
          const on = o === opt;
          o.classList.toggle('is-active', on);
          o.setAttribute('aria-checked', on ? 'true' : 'false');
        });
      });
    });

    // ── Date limite optionnelle (pilote la fenêtre de paiement, doctrine §5/§9) ──
    const dateData = { date: '' };
    const dateGroup = makeInput('k-sm-date-f', 'Date limite (optionnel)', 'date', '', dateData, 'date');
    sheet.appendChild(dateGroup);

    // ── Champs auth (prénom + téléphone avec indicatif) ───────────
    const nameData = { name: '' };
    let phoneData  = { phone: '' };
    let nameInput  = null;

    if (needsAuth) {
      // FIX UX — "Nom et prénom" (full_name en DB) plutôt que juste "prénom"
      const nameGroup = makeInput('k-sm-name-f', 'Votre nom et prénom *', 'text', 'Ex : Fatima Ali', nameData, 'name');
      const ni = nameGroup.querySelector('input');
      if (ni) {
        ni.setAttribute('maxlength', '60');
        ni.setAttribute('autocomplete', 'name');
      }
      nameInput = ni;
      sheet.appendChild(nameGroup);

      // makeIntlPhoneInput génère les classes k-ck-* du checkout — on les remplace
      // par les classes k-sm-* du modal pour un rendu cohérent (padding, border, focus).
      const phoneGroup = makeIntlPhoneInput('k-sm-ph', 'Votre numéro WhatsApp *', phoneData, 'phone');
      phoneGroup.classList.replace('k-ck-group', 'k-sm-field');
      phoneGroup.querySelector('label')?.classList.replace('k-ck-label', 'k-sm-label');
      const phoneWrap = phoneGroup.querySelector('.k-ck-phone-wrap');
      if (phoneWrap) phoneWrap.className = 'k-sm-phone-row';
      phoneGroup.querySelector('.k-ck-phone-select')?.classList.replace('k-ck-phone-select', 'k-sm-phone-sel');
      phoneGroup.querySelector('.k-ck-phone-input')?.classList.replace('k-ck-phone-input', 'k-sm-phone-input');
      sheet.appendChild(phoneGroup);
    }

    // ── Erreur + bouton ────────────────────────────────────────────
    const errEl = document.createElement('p');
    errEl.className = 'k-sm-err';
    errEl.id = 'k-sm-err';
    sheet.appendChild(errEl);

    const btn = document.createElement('button');
    btn.className = 'k-sm-btn';
    btn.id = 'k-sm-submit';
    btn.textContent = 'Créer le panier →';
    btn.disabled = !!needsAuth; // activé seulement quand les champs obligatoires sont valides
    sheet.appendChild(btn);

    ov.appendChild(sheet);
    ov.addEventListener('click', e => { if (e.target === ov) { closeModal(ov); resolve(null); } });
    document.body.appendChild(ov);

    // ── Validation live (needsAuth uniquement) ─────────────────────
    function updateSubmit() {
      if (!needsAuth) { btn.disabled = false; return; }
      const nameOk  = nameData.name?.trim().length >= 3;
      const phoneOk = (phoneData.phone || '').length >= 8;
      btn.disabled  = !(nameOk && phoneOk);
    }

    if (needsAuth) {
      // Écouter les mutations de nameData via l'input
      nameInput?.addEventListener('input', () => {
        nameData.name = nameInput.value;
        updateSubmit();
        if (nameInput.value.trim().length > 0) errEl.textContent = '';
      });
      // makeIntlPhoneInput écrit directement dans phoneData.phone à chaque frappe
      // On observe via MutationObserver ou simplement via input sur le champ généré
      const phoneInput = sheet.querySelector('#k-sm-ph');
      phoneInput?.addEventListener('input', () => { updateSubmit(); errEl.textContent = ''; });
    }

    // ── Soumission ─────────────────────────────────────────────────
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      const title = titleData.title.trim();
      const name  = nameData.name.trim();
      const phone = phoneData.phone || '';

      if (needsAuth) {
        if (name.length < 3) {
          errEl.textContent = 'Nom invalide (3 caractères minimum).';
          nameInput?.focus();
          return;
        }
        if (phone.length < 8) {
          errEl.textContent = 'Numéro de téléphone invalide.';
          sheet.querySelector('#k-sm-ph')?.focus();
          return;
        }
      }

      // Cohérence avec le flow participant : requireIdentity au moment du Confirmer,
      // pas à l ouverture du formulaire.
      btn.disabled = true;
      btn.textContent = '🔐 Vérification…';
      errEl.textContent = '';

      try {
        const identity = await requireIdentity({
          reason: 'créer un panier groupe',
          title: 'Sécuriser votre panier groupe',
        });

        if (!identity) {
          btn.disabled = false;
          btn.textContent = 'Créer le panier →';
          return;
        }

        closeModal(ov);
        resolve({ title, name, phone: phone || null, share_mode: shareMode, target_date: dateData.date || null });
      } catch (err) {
        errEl.textContent = err?.message || 'Erreur de vérification.';
        btn.disabled = false;
        btn.textContent = 'Créer le panier →';
      }
    });

    head.querySelector('.k-sm-close').addEventListener('click', () => { closeModal(ov); resolve(null); });
    sheet.querySelector('#k-sm-title-f')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !btn.disabled) btn.click();
    });

    // Focus initial
    setTimeout(() => (sheet.querySelector('#k-sm-title-f') || nameInput)?.focus(), 80);
  });
}

/* ── Étape B : appel API ────────────────────────────────────────── */
async function createSharedCart(opts) {
  const cartItems = state.cart
    .map(it => ({ product_id: it.product?.id || it.id, quantity: Number(it.qty) || 1 }))
    .filter(it => it.product_id);

  const body = { cart_items: cartItems };
  if (opts.title) body.title = opts.title;
  if (opts.phone) body.tracking_phone = opts.phone;
  if (opts.name) body.recipient_name = opts.name;
  if (opts.share_mode) body.share_mode = opts.share_mode;
  if (opts.target_date) body.target_date = opts.target_date;

  const res = await fetch(API_CREATE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `Erreur API (${res.status})`);
  }
  return res.json();
}

/* ── Étape C : WhatsApp + switch groupe ─────────────────────────── */
function fmtDeadline(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt)) return '';
  return dt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

function openWhatsApp(title, shareUrl, { shareMode, deadline } = {}) {
  const label = title ? ` « ${title} »` : '';
  const when  = fmtDeadline(deadline);
  let msg;
  if (shareMode === 'ready_to_pay') {
    msg = `Je t'ai partagé mon panier Komerce${label}. Tu peux voir les articles et régler ta part${when ? ` jusqu'au ${when}` : ''} : ${shareUrl}`;
  } else if (shareMode === 'needs_validation') {
    msg = `Je t'ai partagé mon panier Komerce${label} en préparation. Tu peux voir les articles ; le paiement sera ouvert quand le panier sera confirmé : ${shareUrl}`;
  } else {
    msg = `Je t'ai partagé mon panier Komerce${label}. Tu peux voir les articles : ${shareUrl}`;
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
  navigator.clipboard?.writeText(shareUrl).catch(() => {});
}

function switchToGroup() {
  import('./b-nav.js').then(({ switchView }) => {
    import('./group/group-render-list.js').then(({ renderGroupView }) => {
      document.querySelectorAll('.k-bnav-item, .k-header-nav-btn')
        .forEach(i => i.classList.toggle('active', i.dataset.tab === 'group'));
      renderGroupView();
      switchView('group');
    });
  });
}

/* ── S2-05 — Modale panier actif détecté ─────────────────────── */
function promptActiveCartChoice(cartName) {
  return new Promise(resolve => {
    ensureStyles();
    const ov = openModal(`
      <div class="k-sm-head">
        <span class="k-sm-title">👥 Panier groupe actif</span>
        <button class="k-sm-close" aria-label="Fermer">✕</button>
      </div>
      <p class="k-sm-hint">
        Vous avez déjà un panier groupe actif :
        <strong>${sanitize(String(cartName || 'Panier groupe'))}</strong>. <!-- GOV-10-B2 -->
      </p>
      <div class="k-sm-choice">
        <button class="k-sm-btn" id="k-sm-view-group">👥 Voir mon groupe actif</button>
        <button class="k-sm-btn k-sm-btn-secondary" id="k-sm-new-group">+ Créer un nouveau groupe</button>
        <button class="k-sm-btn k-sm-btn-ghost" id="k-sm-cancel-choice">Annuler</button>
      </div>`);

    ov.querySelector('#k-sm-view-group').addEventListener('click', () => {
      closeModal(ov); resolve('view');
    });
    ov.querySelector('#k-sm-new-group').addEventListener('click', () => {
      closeModal(ov); resolve('new');
    });
    ov.querySelector('#k-sm-cancel-choice').addEventListener('click', () => {
      closeModal(ov); resolve(null);
    });
    ov.querySelector('.k-sm-close').addEventListener('click', () => {
      closeModal(ov); resolve(null);
    });
  });
}

/* ── Flow principal ─────────────────────────────────────────────── */
export async function startShareFlow(opts = {}) {
  const { reshare = false } = opts;

  // FIX S2-05 — attendre la restauration backend avant d'utiliser state.shareToken
  // Évite la race condition : clic rapide → shareToken null car restore pas fini
  if (_restorePromise) {
    await _restorePromise;
    _restorePromise = null;
  }

  if (!state.cart?.length) {
    showToast("Ajoutez d'abord des produits au panier.", 'error');
    return;
  }

  if (reshare && state.shareToken) {
    const shareUrl = state.shareUrl || `${window.location.origin}/boutique/?p=${state.shareToken}`;
    openWhatsApp(state.cartName, shareUrl, {
      shareMode: state.shareStatus === 'closed' ? 'ready_to_pay' : 'needs_validation',
      deadline: state.shareExpiry,
    });
    return;
  }

  // S2-05 — Si un panier actif existe déjà, proposer deux options
  if (!reshare && state.shareToken) {
    const choice = await promptActiveCartChoice(state.cartName);
    if (!choice) return;
    if (choice === 'view') {
      switchToGroup();
      return;
    }
    // choice === 'new' → on continue vers promptInit
  }

  // Doctrine identité Komerce — cohérence avec le flow participant :
  // requireIdentity() se déclenche au clic "Confirmer" dans promptInit,
  // pas à l'ouverture du formulaire.
  const formData = await promptInit(false);
  if (!formData) return;

  const btn = document.getElementById('k-cart-share') || document.getElementById('k-sc-share');
  if (btn) { btn.disabled = true; btn.textContent = 'â³ Création…'; }

  try {
    const data = await createSharedCart(formData);

    const title = formData.title || 'Panier groupe';
    const cart = {
      id: data.shared_cart_id,
      token: data.token,
      share_url: data.share_url || `${window.location.origin}/boutique/?p=${data.token}`,
      title,
      status: data.status || 'open',
      total_kmf_snapshot: data.total_kmf,
      contributed_kmf: 0,
      remaining_kmf: data.total_kmf,
      target_date: data.target_date || null,
      payment_window_ends_at: data.payment_window_ends_at || null,
      expires_at: data.payment_window_ends_at || data.target_date || null,
      created_at: new Date().toISOString(),
    };

    // Doctrine v4.2 — N4-CLEAR (ordre critique)
    // 1. Poser l'état groupe EN PREMIER — showBanner() vérifie state.shareToken.
    // 2. Vider le panier EN SECOND, avec guard pour que cart:cleared ne détruise pas
    //    le shareToken qu'on vient de poser.
    applyCartToState(cart);
    refreshSharedBadges(true, cart);
    showBanner({
      title,
      expires_at: data.payment_window_ends_at || data.target_date || null,
      status: data.status || 'open',
      contributed_kmf: 0,
      total_kmf_snapshot: data.total_kmf,
    });

    showToast('Panier groupe créé. Vérifiez le suivi puis partagez le lien quand vous êtes prêt.', 'success');

    _skipClearShareOnCartCleared = true;
    clearCart();
    _skipClearShareOnCartCleared = false;

    switchToGroup();
  } catch (err) {
    showToast(`Erreur : ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📤 Partager'; }
  }
}

async function handleShareClick() {
  return startShareFlow({ reshare: false });
}

/* ── Installation ───────────────────────────────────────────────── */
let _installed = false;
let _restorePromise = null; // FIX S2-05 — permet d'attendre la restauration dans startShareFlow
let _skipClearShareOnCartCleared = false; // FIX N4-CLEAR — évite que clearCart() efface shareToken juste posé

export function install() {
  if (_installed) return;
  _installed = true;

  loadShareState();

  if (state.shareToken) {
    refreshSharedBadges(true);
    refreshBanner();
  }

  _restorePromise = restoreSharedCartFromBackend({ silent: true });

  document.getElementById('k-cart-share')?.addEventListener('click', handleShareClick);

  document.getElementById('k-sc-share')?.addEventListener('click', handleShareClick);

  document.getElementById('k-cart-reshare')?.addEventListener('click', () =>
    startShareFlow({ reshare: true }));

  document.getElementById('k-sc-reshare')?.addEventListener('click', () =>
    startShareFlow({ reshare: true }));

  document.getElementById('k-sc-group-view')?.addEventListener('click', switchToGroup);

  document.addEventListener('cart:cleared', () => {
    if (_skipClearShareOnCartCleared) return; // N4-CLEAR — vidage intentionnel post-création groupe
    clearShareState();
    refreshSharedBadges(false);
  });
}

