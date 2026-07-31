/**
 * @komerce-arch
 * @role          boutique-account-view
 * @domain        account
 * @layer         ui-page
 * @criticality   medium
 * @inputs        client_session, wallet_balance, profile
 * @outputs       komerce_view
 * @depends       b-utils.js, b-identity.js, b-wallet.js, b-bus.js
 * @used-by       b-nav.js, boutique.js
 * @doctrine      wallet_visible_client, navigation_sans_friction, otp_une_fois
 * @impact-areas  account, wallet, boutique-navigation
 * @version       2026-07-lot4b
 */
'use strict';

/**
 * @module b-komerce
 * @brief Mon Komerce — page personnelle unique (Lot 4B).
 *
 * Doctrine : Mon Komerce est une seule page, sans sous-onglet, sans menu
 * secondaire. L'authentification intervient à l'entrée, une seule fois.
 *
 *   Mon wallet  (premier bloc, délègue à b-wallet.js)
 *   Mon profil  (nom, email lecture seule, WhatsApp du compte, devise)
 *   Retrait & sécurité (carte informative)
 *
 * Point d'entrée canonique : openMonKomerce({ focus })
 *   focus = 'wallet' → scroll jusqu'au bloc wallet après chargement.
 */

import { sanitize, apiGet, apiPut } from './b-utils.js';
import { getCurrentIdentity, requireIdentity } from './b-identity.js';
import { renderWalletView } from './b-wallet.js';
import { bus } from './b-bus.js';

// ── État interne ───────────────────────────────────────────────────────────────

let _renderSeq = 0;

// ── Helpers ────────────────────────────────────────────────────────────────────

function isAuthErr(e) {
  return e && (e.status === 401 || e.status === 403);
}

function maskPhone(phone) {
  const v = String(phone || '').trim();
  if (!v) return '';
  if (v.length <= 6) return v;
  return v.slice(0, 4) + '\u2022\u2022\u2022\u2022' + v.slice(-2);
}

function fmtDateFr(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch (_) { return null; }
}

// ── Shell (unique, créé une seule fois) ────────────────────────────────────────

function ensureShell() {
  let el = document.getElementById('k-komerce-view');
  if (el) return el;

  el = document.createElement('div');
  el.id = 'k-komerce-view';
  el.className = 'k-komerce-view';
  el.setAttribute('role', 'main');
  el.setAttribute('aria-label', 'Mon Komerce');
  el.innerHTML = /* LOT4B_STATIC_ACCOUNT_SHELL */
    '<header class="k-kmc-header">' +
      '<h2 class="k-kmc-title">Mon Komerce</h2>' +
      '<p class="k-kmc-subtitle">Compte personnel prot\u00e9g\u00e9</p>' +
    '</header>' +
    '<div class="k-kmc-page-grid">' +
      '<div class="k-kmc-col-primary">' +
        '<section id="k-kmc-wallet-block" class="k-kmc-block" aria-label="Mon wallet"></section>' +
      '</div>' +
      '<div class="k-kmc-col-secondary">' +
        '<section id="k-kmc-profile-block" class="k-kmc-block" aria-label="Mon profil"></section>' +
        '<section id="k-kmc-security-block" class="k-kmc-block" aria-label="Retrait et s\u00e9curit\u00e9"></section>' +
      '</div>' +
    '</div>';

  const anchor = document.getElementById('k-track-view')
    || document.getElementById('k-fav-view')
    || document.getElementById('k-catalog-section');
  if (anchor) anchor.after(el);
  else document.body.appendChild(el);

  return el;
}

// ── États partagés ────────────────────────────────────────────────────────────

function renderBlockLoading(block) {
  block.innerHTML = /* LOT4B_STATIC_LOADING */
    '<div class="k-kmc-loading">' +
      '<div class="k-kmc-spin"></div>' +
      '<p>Chargement\u2026</p>' +
    '</div>';
}

function renderBlockError(block, err, onRetry) {
  const isTimeout = !!(err && (err.isTimeout || err.name === 'TimeoutError'));
  block.innerHTML = /* LOT4B_STATIC_ERROR */
    '<div class="k-kmc-empty">' +
      '<div class="k-kmc-empty-icon">\u26a0\ufe0f</div>' +
      '<div class="k-kmc-empty-title">' +
        (isTimeout ? 'Cela met trop de temps \u00e0 r\u00e9pondre' : 'Impossible de charger') +
      '</div>' +
      '<div class="k-kmc-empty-sub">V\u00e9rifiez votre connexion puis r\u00e9essayez.</div>' +
      '<button class="k-kmc-action-btn" id="k-kmc-retry">\ud83d\udd04 R\u00e9essayer</button>' +
    '</div>';
  block.querySelector('#k-kmc-retry')?.addEventListener('click', onRetry);
}

function renderSessionExpired() {
  const walletBlock  = document.getElementById('k-kmc-wallet-block');
  const profileBlock = document.getElementById('k-kmc-profile-block');
  const secBlock     = document.getElementById('k-kmc-security-block');
  [walletBlock, profileBlock, secBlock].forEach(b => { if (b) b.replaceChildren(); });
  if (walletBlock) {
    walletBlock.innerHTML = /* LOT4B_STATIC_REAUTH */
      '<div class="k-kmc-empty">' +
        '<div class="k-kmc-empty-icon">\ud83d\udd10</div>' +
        '<div class="k-kmc-empty-title">Session expir\u00e9e</div>' +
        '<div class="k-kmc-empty-sub">Confirmez votre num\u00e9ro WhatsApp pour continuer.</div>' +
        '<button class="k-kmc-action-btn" id="k-kmc-reauth">\ud83d\udcf2 M\u2019identifier</button>' +
      '</div>';
    walletBlock.querySelector('#k-kmc-reauth')?.addEventListener('click', async () => {
      const btn = walletBlock.querySelector('#k-kmc-reauth');
      btn.disabled = true;
      btn.textContent = '\u23f3 Identification\u2026';
      const user = await requireIdentity({ reason: 'mon-komerce', title: 'Mon Komerce' });
      if (user) _loadAndRender(++_renderSeq);
      else { btn.disabled = false; btn.textContent = '\ud83d\udcf2 M\u2019identifier'; }
    });
  }
}

// ── Bloc wallet ────────────────────────────────────────────────────────────────

function renderWalletBlock(block) {
  block.innerHTML = /* LOT4B_STATIC_WALLET_CONTAINER */ '<div id="k-wallet-view" class="k-wallet-view show"></div>';
  renderWalletView();
}

// ── Bloc profil (nom + devise + email lecture seule + WhatsApp du compte) ──────

function renderProfileBlock(block, me) {
  const phone     = maskPhone(me?.phone);
  const fullName0 = me?.full_name || '';
  const currency0 = me?.currency_pref === 'EUR' ? 'EUR' : 'KMF';

  // Note : email non modifiable — PUT /api/auth/me n'accepte que full_name et
  // currency_pref. Email affiché en lecture seule si présent, sinon omis.
  block.innerHTML = /* LOT4B_STATIC_PROFILE_SHELL */
    '<form class="k-kmc-form" id="k-kmc-profile-form" novalidate>' +
      '<h3 class="k-kmc-block-title">Mon profil</h3>' +
      '<label class="k-kmc-field">' +
        '<span>Nom complet</span>' +
        '<input type="text" id="k-kmc-fullname" maxlength="100" autocomplete="name">' +
      '</label>' +
      (me?.email
        ? '<label class="k-kmc-field k-kmc-field--readonly">' +
            '<span>Email</span>' +
            '<input type="text" id="k-kmc-email" disabled aria-readonly="true">' +
          '</label>'
        : '') +
      '<label class="k-kmc-field k-kmc-field--readonly">' +
        '<span>WhatsApp du compte</span>' +
        '<input type="text" id="k-kmc-account-phone" disabled aria-readonly="true">' +
      '</label>' +
      '<p class="k-kmc-field-hint">Le WhatsApp du compte ne se modifie pas ici \u2014 il se confirme par code lors d\u2019une prochaine commande.</p>' +
      '<label class="k-kmc-field">' +
        '<span>Devise d\u2019affichage</span>' +
        '<select id="k-kmc-currency">' +
          '<option value="KMF"' + (currency0 === 'KMF' ? ' selected' : '') + '>Franc comorien (KMF)</option>' +
          '<option value="EUR"' + (currency0 === 'EUR' ? ' selected' : '') + '>Euro (EUR)</option>' +
        '</select>' +
      '</label>' +
      '<p class="k-kmc-save-status" id="k-kmc-save-status" role="status" aria-live="polite"></p>' +
      '<button type="submit" class="k-kmc-action-btn" id="k-kmc-profile-save" disabled>' +
        'Enregistrer mes modifications' +
      '</button>' +
    '</form>';

  const form     = block.querySelector('#k-kmc-profile-form');
  const nameInput = block.querySelector('#k-kmc-fullname');
  const curSelect = block.querySelector('#k-kmc-currency');
  const saveBtn   = block.querySelector('#k-kmc-profile-save');
  const status    = block.querySelector('#k-kmc-save-status');
  const emailInput = block.querySelector('#k-kmc-email');
  const phoneInput = block.querySelector('#k-kmc-account-phone');

  // Donn?es API assign?es comme propri?t?s DOM : jamais interpol?es dans HTML.
  nameInput.value = String(fullName0);
  if (emailInput) emailInput.value = String(me?.email || '');
  if (phoneInput) phoneInput.value = phone || '\u2014';

  let pendingSubmit = false;

  function checkDirty() {
    const dirty = nameInput.value.trim() !== fullName0 || curSelect.value !== currency0;
    saveBtn.disabled = !dirty || pendingSubmit;
  }

  nameInput.addEventListener('input', checkDirty);
  curSelect.addEventListener('change', checkDirty);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (pendingSubmit || saveBtn.disabled) return;
    const newName     = nameInput.value.trim();
    const newCurrency = curSelect.value;
    if (!newName) { nameInput.focus(); return; }

    pendingSubmit = true;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Enregistrement\u2026';
    status.textContent = '';

    try {
      await apiPut('/api/auth/me', { full_name: newName, currency_pref: newCurrency });
      status.textContent = '\u2705 Enregistr\u00e9';
      // Update baselines so dirty-check reflects new state
      // (re-render not needed; keep form values as-is)
    } catch (_) {
      status.textContent = '\u26a0\ufe0f \u00c9chec \u2014 r\u00e9essayez';
      saveBtn.disabled = false;
    } finally {
      pendingSubmit = false;
      saveBtn.textContent = 'Enregistrer mes modifications';
      checkDirty();
    }
  });
}

// ── Bloc retrait & sécurité (informatif uniquement) ────────────────────────────

function renderSecurityBlock(block, me) {
  const phone = maskPhone(me?.phone);
  block.innerHTML = /* LOT4B_STATIC_SECURITY_SHELL */
    '<div class="k-kmc-security">' +
      '<h3 class="k-kmc-block-title">Retrait &amp; s\u00e9curit\u00e9</h3>' +
      '<div class="k-kmc-sec-row">' +
        '<span class="k-kmc-sec-label">WhatsApp du compte</span>' +
        '<span class="k-kmc-sec-value" id="k-kmc-security-phone"></span>' +
      '</div>' +
      '<div class="k-kmc-sec-doctrine">' +
        '<p>Le code de retrait est envoy\u00e9 sur votre WhatsApp lorsque votre commande est pr\u00eate au relais. Vous pouvez le transmettre \u00e0 la personne de votre choix \u2014 Komerce ne collecte aucune identit\u00e9 de retrait distincte.</p>' +
        '<p>Ce code est personnel et unique \u00e0 chaque commande : ne le partagez qu\u2019avec la personne qui viendra r\u00e9cup\u00e9rer votre colis.</p>' +
      '</div>' +
    '</div>';
  const phoneValue = block.querySelector('#k-kmc-security-phone');
  if (phoneValue) phoneValue.textContent = phone || '\u2014';

}

// ── Chargement et assemblage de la page ────────────────────────────────────────

async function _loadAndRender(seq) {
  const walletBlock  = document.getElementById('k-kmc-wallet-block');
  const profileBlock = document.getElementById('k-kmc-profile-block');
  const secBlock     = document.getElementById('k-kmc-security-block');
  if (!walletBlock || !profileBlock || !secBlock) return;

  renderBlockLoading(profileBlock);
  renderBlockLoading(secBlock);
  // Wallet block mounts b-wallet.js immediately (it handles its own loading state)
  renderWalletBlock(walletBlock);

  let me = null, meErr = null;
  me = await apiGet('/api/auth/me').catch(e => { meErr = e; return null; });

  if (seq !== _renderSeq) return; // stale render

  if (!me && isAuthErr(meErr)) {
    renderSessionExpired();
    return;
  }
  if (!me && meErr) {
    renderBlockError(profileBlock, meErr, () => _loadAndRender(++_renderSeq));
    secBlock.replaceChildren();
    return;
  }

  renderProfileBlock(profileBlock, me);
  renderSecurityBlock(secBlock, me);
}

// ── Point d'entrée canonique ───────────────────────────────────────────────────

/**
 * Ouvre Mon Komerce.
 * - Authentifie l'utilisateur à l'entrée (OTP si nécessaire).
 * - Si l'OTP est annulé, n'affiche rien et conserve la vue précédente.
 * - Émet 'komerce:show' pour que b-nav.js synchronise la navigation.
 * - Si focus='wallet', positionne le viewport sur le bloc wallet.
 *
 * @param {object} [opts]
 * @param {string|null} [opts.focus] 'wallet' pour scroller sur le wallet
 */
export async function openMonKomerce({ focus = null } = {}) {
  // 1. Vérifier ou obtenir l'identité
  let identity = getCurrentIdentity();
  if (!identity) {
    identity = await requireIdentity({ reason: 'mon-komerce', title: 'Acc\u00e9der \u00e0 Mon Komerce' });
    if (!identity) return; // OTP annulé → conserver la vue précédente
  }

  // 2. Synchroniser la navigation (b-nav.js écoute 'komerce:show')
  bus.emit('komerce:show');

  // 3. Monter le shell
  const el = ensureShell();
  el.classList.add('show');

  // 4. Charger et afficher le contenu
  _loadAndRender(++_renderSeq);

  // 5. Positionner sur le bloc demandé si nécessaire
  if (focus === 'wallet') {
    requestAnimationFrame(() => {
      document.getElementById('k-kmc-wallet-block')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}
