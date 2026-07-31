/**
 * @komerce-arch
 * @role          boutique-account-view
 * @domain        account
 * @layer         ui-page
 * @criticality   medium
 * @inputs        client_session, wallet_balance, profile
 * @outputs       komerce_view
 * @depends       b-utils.js, b-identity.js, b-wallet.js
 * @used-by       b-nav.js, boutique.js
 * @doctrine      wallet_visible_client, navigation_sans_friction, otp_une_fois
 * @impact-areas  account, wallet, boutique-navigation
 * @version       2026-07
 */
'use strict';

/**
 * @module b-komerce
 * @brief Mon Komerce — espace personnel du client (Lot 4).
 *
 * Décision produit : Suivi = mes achats. Mon Komerce = mon compte, mes
 * droits et mes avantages. Ce module ne possède aucune vérité métier :
 * il assemble Vue d'ensemble / Mon wallet / Retrait & sécurité / Mes
 * informations / Mes préférences à partir de GET /api/auth/me et
 * GET /api/wallet, et monte b-wallet.js tel quel dans son propre panneau
 * (aucune modification de b-wallet.js n'est nécessaire).
 *
 * Règle stricte héritée du prompt Lot 4 : jamais de rubrique vide,
 * factice ou non fonctionnelle. Retrait & sécurité reste 100% informatif
 * dans ce lot — aucune mutation (personne de secours, OTP tiers, etc.).
 */

import { sanitize, fmt, apiGet, apiPut } from './b-utils.js';
import { getCurrentIdentity, requireIdentity } from './b-identity.js';
import { renderWalletView } from './b-wallet.js';

const SUBTABS = [
  { id: 'overview',    label: 'Vue d\u2019ensemble' },
  { id: 'wallet',      label: 'Mon wallet' },
  { id: 'security',    label: 'Retrait & s\u00e9curit\u00e9' },
  { id: 'profile',     label: 'Mes informations' },
  { id: 'preferences', label: 'Mes pr\u00e9f\u00e9rences' },
];
const SUBTAB_IDS = SUBTABS.map(t => t.id);

let currentSubtab = 'overview';
let renderSeq = 0;

// ── Helpers ─────────────────────────────────────────────────────────────────

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

// ── Shell (créé une seule fois) ───────────────────────────────────────────────

function ensureShell() {
  let el = document.getElementById('k-komerce-view');
  if (el) return el;

  el = document.createElement('div');
  el.id = 'k-komerce-view';
  el.className = 'k-komerce-view';
  el.innerHTML =
    '<div class="k-kmc-header"><h2 class="k-kmc-title">Mon Komerce</h2></div>' +
    '<nav class="k-kmc-subnav" id="k-kmc-subnav"></nav>' +
    '<div class="k-kmc-panel" id="k-kmc-panel"></div>';

  const anchor = document.getElementById('k-track-view')
    || document.getElementById('k-fav-view')
    || document.getElementById('k-catalog-section');
  if (anchor) anchor.after(el);
  else document.body.appendChild(el);

  const nav = el.querySelector('#k-kmc-subnav');
  SUBTABS.forEach(t => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'k-kmc-subnav-item';
    btn.dataset.subtab = t.id;
    btn.textContent = t.label;
    btn.addEventListener('click', () => renderKomerceView(t.id));
    nav.appendChild(btn);
  });

  return el;
}

function setActiveSubtab(el, subtab) {
  el.querySelectorAll('.k-kmc-subnav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.subtab === subtab);
  });
}

// ── États partagés (chargement / erreur / gate d'auth) ────────────────────────

function renderKmcLoading(panel) {
  panel.innerHTML = '<div class="k-kmc-loading"><div class="k-kmc-spin"></div><p>Chargement\u2026</p></div>';
}

function renderKmcError(panel, err, retryTab) {
  const isTimeout = !!(err && (err.isTimeout || err.name === 'TimeoutError'));
  panel.innerHTML =
    '<div class="k-kmc-empty">' +
      '<div class="k-kmc-empty-icon">\u26a0\ufe0f</div>' +
      '<div class="k-kmc-empty-title">' + (isTimeout ? 'Cela met trop de temps \u00e0 r\u00e9pondre' : 'Impossible de charger cette rubrique') + '</div>' +
      '<div class="k-kmc-empty-sub">V\u00e9rifiez votre connexion puis r\u00e9essayez.</div>' +
      '<button class="k-kmc-action-btn" id="k-kmc-retry-btn">\ud83d\udd04 R\u00e9essayer</button>' +
    '</div>';
  panel.querySelector('#k-kmc-retry-btn')?.addEventListener('click', () => renderKomerceView(retryTab));
}

function renderKmcAuthGate(panel, opts = {}) {
  const title = opts.sessionExpired
    ? 'Session expir\u00e9e \u2014 confirmez votre num\u00e9ro'
    : 'Identifiez-vous pour acc\u00e9der \u00e0 Mon Komerce';
  const sub = opts.sessionExpired
    ? 'Votre identit\u00e9 locale est connue, mais la session doit \u00eatre renouvel\u00e9e.'
    : 'Confirmez votre num\u00e9ro WhatsApp pour acc\u00e9der \u00e0 votre espace personnel.';
  panel.innerHTML =
    '<div class="k-kmc-empty">' +
      '<div class="k-kmc-empty-icon">\ud83d\udd10</div>' +
      '<div class="k-kmc-empty-title">' + sanitize(title) + '</div>' +
      '<div class="k-kmc-empty-sub">' + sanitize(sub) + '</div>' +
      '<button class="k-kmc-action-btn" id="k-kmc-auth-btn">\ud83d\udcf2 M\u2019identifier</button>' +
    '</div>';
  panel.querySelector('#k-kmc-auth-btn')?.addEventListener('click', async () => {
    const btn = panel.querySelector('#k-kmc-auth-btn');
    btn.disabled = true;
    btn.textContent = '\u23f3 Identification\u2026';
    const user = await requireIdentity({ reason: 'mon komerce', title: 'Acc\u00e9der \u00e0 Mon Komerce' });
    if (user) {
      renderKomerceView(currentSubtab);
    } else {
      btn.disabled = false;
      btn.textContent = '\ud83d\udcf2 M\u2019identifier';
    }
  });
}

// ── Vue d'ensemble ─────────────────────────────────────────────────────────

function renderOverviewPanel(panel, seq) {
  renderKmcLoading(panel);
  (async () => {
    let meErr = null, walletErr = null;
    const [me, wallet] = await Promise.all([
      apiGet('/api/auth/me').catch((e) => { meErr = e; return null; }),
      apiGet('/api/wallet').catch((e) => { walletErr = e; return null; }),
    ]);
    if (seq !== renderSeq) return;

    if (!me && isAuthErr(meErr)) { renderKmcAuthGate(panel, { sessionExpired: !!getCurrentIdentity() }); return; }
    if (!me && meErr) { renderKmcError(panel, meErr, 'overview'); return; }
    if (walletErr && !isAuthErr(walletErr)) console.warn('[komerce] wallet overview:', walletErr);

    const name       = me?.full_name || 'Client Komerce';
    const phone      = maskPhone(me?.phone);
    const balance    = Number(wallet?.balance_kmf ?? 0);
    const expiresAt  = fmtDateFr(wallet?.expires_at);

    panel.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'k-kmc-overview';
    card.innerHTML =
      '<div class="k-kmc-ov-identity">' +
        '<div class="k-kmc-ov-name">' + sanitize(name) + '</div>' +
        (phone ? '<div class="k-kmc-ov-phone">\ud83d\udcf1 ' + sanitize(phone) + ' \u00b7 v\u00e9rifi\u00e9</div>' : '') +
      '</div>' +
      '<div class="k-kmc-ov-wallet">' +
        '<div class="k-kmc-ov-wallet-label">Solde wallet</div>' +
        '<div class="k-kmc-ov-wallet-amount">' + sanitize(fmt(balance, 'KMF')) + '</div>' +
        (expiresAt ? '<div class="k-kmc-ov-wallet-expiry">Valable jusqu\u2019au ' + sanitize(expiresAt) + '</div>' : '') +
      '</div>' +
      '<div class="k-kmc-ov-security">\ud83d\udd12 Retrait s\u00e9curis\u00e9 \u2014 code envoy\u00e9 sur WhatsApp v\u00e9rifi\u00e9</div>' +
      '<div class="k-kmc-ov-shortcuts">' +
        '<button type="button" class="k-kmc-shortcut-btn" data-goto="profile">Mes informations</button>' +
        '<button type="button" class="k-kmc-shortcut-btn" data-goto="preferences">Mes pr\u00e9f\u00e9rences</button>' +
      '</div>';
    panel.appendChild(card);
    card.querySelectorAll('[data-goto]').forEach((btn) => {
      btn.addEventListener('click', () => renderKomerceView(btn.dataset.goto));
    });
  })().catch((e) => { if (seq === renderSeq) renderKmcError(panel, e, 'overview'); });
}

// ── Mon wallet (délègue entièrement à b-wallet.js, inchangé) ─────────────────

function renderWalletPanel(panel) {
  panel.innerHTML = '<div id="k-wallet-view" class="k-wallet-view show"></div>';
  renderWalletView();
}

// ── Retrait & sécurité (informatif uniquement — hors périmètre Lot 4 : ────────
//    personne de secours, OTP tiers, changement d'autorisation, retrait sans code) ─

function renderSecurityPanel(panel) {
  renderKmcLoading(panel);
  apiGet('/api/auth/me')
    .then((me) => {
      const phone = maskPhone(me?.phone);
      panel.innerHTML =
        '<div class="k-kmc-security">' +
          '<div class="k-kmc-sec-row">' +
            '<span class="k-kmc-sec-label">Num\u00e9ro WhatsApp v\u00e9rifi\u00e9</span>' +
            '<span class="k-kmc-sec-value">' + (phone ? sanitize(phone) + ' \u2705' : '\u2014') + '</span>' +
          '</div>' +
          '<div class="k-kmc-sec-doctrine">' +
            '<p>Le code de retrait est envoy\u00e9 sur votre WhatsApp v\u00e9rifi\u00e9 apr\u00e8s confirmation de commande. Vous pouvez le transmettre \u00e0 la personne de votre choix \u2014 Komerce ne collecte aucune identit\u00e9 de retrait distincte.</p>' +
            '<p>Ce code est personnel et unique \u00e0 chaque commande : ne le partagez qu\u2019avec la personne qui viendra r\u00e9cup\u00e9rer votre colis.</p>' +
          '</div>' +
        '</div>';
    })
    .catch((err) => {
      if (isAuthErr(err)) renderKmcAuthGate(panel, { sessionExpired: !!getCurrentIdentity() });
      else renderKmcError(panel, err, 'security');
    });
}

// ── Mes informations ──────────────────────────────────────────────────────────

function renderProfilePanel(panel, seq) {
  renderKmcLoading(panel);
  apiGet('/api/auth/me')
    .then((me) => {
      if (seq !== renderSeq) return;
      const phone = maskPhone(me?.phone);
      panel.innerHTML =
        '<form class="k-kmc-form" id="k-kmc-profile-form">' +
          '<label class="k-kmc-field"><span>Nom complet</span>' +
            '<input type="text" id="k-kmc-fullname" maxlength="100" value="' + sanitize(me?.full_name || '') + '"></label>' +
          '<label class="k-kmc-field k-kmc-field--readonly"><span>WhatsApp v\u00e9rifi\u00e9</span>' +
            '<input type="text" value="' + sanitize(phone) + '" disabled></label>' +
          (me?.email ? '<label class="k-kmc-field k-kmc-field--readonly"><span>Email</span><input type="text" value="' + sanitize(me.email) + '" disabled></label>' : '') +
          '<p class="k-kmc-field-hint">Le WhatsApp v\u00e9rifi\u00e9 ne se modifie pas ici \u2014 il se confirme par code lors d\u2019une prochaine commande.</p>' +
          '<button type="submit" class="k-kmc-action-btn" id="k-kmc-profile-save">Enregistrer</button>' +
        '</form>';

      panel.querySelector('#k-kmc-profile-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = panel.querySelector('#k-kmc-profile-save');
        const fullName = panel.querySelector('#k-kmc-fullname').value.trim();
        if (!fullName) return;
        btn.disabled = true;
        btn.textContent = 'Enregistrement\u2026';
        try {
          await apiPut('/api/auth/me', { full_name: fullName });
          btn.textContent = '\u2705 Enregistr\u00e9';
        } catch (_) {
          btn.textContent = '\u26a0\ufe0f \u00c9chec \u2014 r\u00e9essayer';
        } finally {
          setTimeout(() => { btn.disabled = false; btn.textContent = 'Enregistrer'; }, 1800);
        }
      });
    })
    .catch((err) => {
      if (isAuthErr(err)) renderKmcAuthGate(panel, { sessionExpired: !!getCurrentIdentity() });
      else renderKmcError(panel, err, 'profile');
    });
}

// ── Mes préférences (uniquement les préférences réellement persistées) ────────

function renderPreferencesPanel(panel, seq) {
  renderKmcLoading(panel);
  apiGet('/api/auth/me')
    .then((me) => {
      if (seq !== renderSeq) return;
      const cur = me?.currency_pref === 'EUR' ? 'EUR' : 'KMF';
      panel.innerHTML =
        '<div class="k-kmc-form">' +
          '<label class="k-kmc-field"><span>Devise d\u2019affichage</span>' +
            '<select id="k-kmc-currency">' +
              '<option value="KMF"' + (cur === 'KMF' ? ' selected' : '') + '>Franc comorien (KMF)</option>' +
              '<option value="EUR"' + (cur === 'EUR' ? ' selected' : '') + '>Euro (EUR)</option>' +
            '</select></label>' +
          '<p class="k-kmc-field-hint" id="k-kmc-pref-status"></p>' +
        '</div>';

      panel.querySelector('#k-kmc-currency').addEventListener('change', async (e) => {
        const val = e.target.value;
        const status = panel.querySelector('#k-kmc-pref-status');
        e.target.disabled = true;
        try {
          await apiPut('/api/auth/me', { currency_pref: val });
          if (status) status.textContent = '\u2705 Pr\u00e9f\u00e9rence enregistr\u00e9e';
        } catch (_) {
          e.target.value = cur;
          if (status) status.textContent = '\u26a0\ufe0f \u00c9chec \u2014 r\u00e9essayez';
        } finally {
          e.target.disabled = false;
        }
      });
    })
    .catch((err) => {
      if (isAuthErr(err)) renderKmcAuthGate(panel, { sessionExpired: !!getCurrentIdentity() });
      else renderKmcError(panel, err, 'preferences');
    });
}

// ── Point d'entrée ─────────────────────────────────────────────────────────

/**
 * Rend Mon Komerce sur la sous-rubrique demandée (défaut : celle déjà active,
 * ou 'overview' au premier rendu).
 * @param {string} [subtab] 'overview' | 'wallet' | 'security' | 'profile' | 'preferences'
 */
export function renderKomerceView(subtab) {
  const seq = ++renderSeq;
  // Un vrai premier montage (le shell n'existe pas encore dans le DOM) doit
  // toujours retomber sur 'overview' par défaut, jamais sur une valeur de
  // currentSubtab laissée par un montage précédent (ex: DOM réinitialisé
  // entre deux tests, ou shell recréé après une navigation SPA complète).
  // Tant que le shell reste monté, currentSubtab persiste normalement d'un
  // appel à l'autre (comportement voulu : rester sur le dernier sous-onglet).
  const shellExisted = !!document.getElementById('k-komerce-view');
  if (!shellExisted) currentSubtab = 'overview';
  const tab = SUBTAB_IDS.includes(subtab) ? subtab : (currentSubtab || 'overview');
  currentSubtab = tab;

  const el = ensureShell();
  setActiveSubtab(el, tab);
  const panel = el.querySelector('#k-kmc-panel');

  if (tab === 'wallet')            renderWalletPanel(panel);
  else if (tab === 'security')     renderSecurityPanel(panel);
  else if (tab === 'profile')      renderProfilePanel(panel, seq);
  else if (tab === 'preferences')  renderPreferencesPanel(panel, seq);
  else                              renderOverviewPanel(panel, seq);
}
