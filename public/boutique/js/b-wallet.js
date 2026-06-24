/**
 * @komerce-arch
 * @role          wallet-view
 * @domain        wallet
 * @layer         ui-page
 * @criticality   medium
 * @inputs        client_session, wallet_balance, wallet_transactions
 * @outputs       wallet_view
 * @depends       b-utils.js, b-identity.js
 * @used-by       b-nav.js, boutique.js
 * @doctrine      wallet_visible_client, navigation_sans_friction, otp_une_fois
 * @impact-areas  wallet, boutique-navigation
 * @version       2026-06
 */

/**
 * @module b-wallet
 * @brief Mon porte-monnaie — solde + historique mouvements.
 *
 * Même pattern que b-tracking.js :
 *   1. Tente GET /api/wallet (cookie kmrc_jwt)
 *   2. Si 401 → écran gate avec requireIdentity()
 *   3. Après OTP → charge et affiche les données wallet
 *
 * Consomme GET /api/wallet et GET /api/wallet/transactions.
 */

import { sanitize, fmt, apiGet } from './b-utils.js';
import { requireIdentity, getCurrentIdentity } from './b-identity.js';

'use strict';

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (_) { return ''; }
}

function fmtMonth(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const m = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    return m.charAt(0).toUpperCase() + m.slice(1);
  } catch (_) { return ''; }
}

function txIcon(type) {
  if (type === 'credit')     return { emoji: '💰', cls: 'credit' };
  if (type === 'debit')      return { emoji: '🛒', cls: 'debit' };
  if (type === 'reversal')   return { emoji: '↩️', cls: 'debit' };
  if (type === 'expiration') return { emoji: '⏳', cls: 'debit' };
  return { emoji: '•', cls: 'credit' };
}

function txLabel(reason) {
  const map = {
    order_cancel:  'Avoir commande annulée',
    admin_gift:    'Geste commercial',
    order_payment: 'Utilisé sur commande',
    checkout:      'Utilisé sur commande',
    reversal:      'Annulation crédit',
    expiration:    'Crédit expiré',
  };
  return map[reason] || sanitize(reason) || 'Mouvement';
}

// ── Render : point d'entrée ─────────────────────────────────────────────────

export function renderWalletView() {
  let el = document.getElementById('k-wallet-view');
  if (!el) {
    el = document.createElement('div');
    el.id = 'k-wallet-view';
    el.className = 'k-wallet-view';
    const anchor = document.getElementById('k-fav-view')
      || document.getElementById('k-track-view')
      || document.getElementById('k-catalog-section');
    if (anchor) anchor.after(el);
    else document.body.appendChild(el);
  }

  el.innerHTML = '<div class="k-wlt-loading"><div class="k-wlt-spin"></div><p>Chargement…</p></div>';

  (async () => {
    // Même pattern que b-tracking : tenter l'appel, catch silencieux
    const [balData, txData] = await Promise.all([
      apiGet('/api/wallet').catch(() => null),
      apiGet('/api/wallet/transactions?limit=50').catch(() => null),
    ]);

    // Pas de données ET pas d'identité → gate OTP (même logique que renderTrackViewSearchMode)
    if (!balData && !getCurrentIdentity()) {
      renderAuthGate(el);
      return;
    }

    const balance    = balData?.balance_kmf  ?? 0;
    const expiresAt  = balData?.expires_at   ?? null;
    const transactions = txData?.transactions ?? [];

    el.innerHTML = '';
    el.appendChild(buildBalanceCard(balance, expiresAt));
    if (balance === 0) el.appendChild(buildEmptyState());
    el.appendChild(buildTransactionList(transactions));
  })();
}

// ── Gate d'authentification ─────────────────────────────────────────────────

function renderAuthGate(el) {
  el.innerHTML =
    '<div class="k-wlt-empty">' +
      '<div class="k-wlt-empty-icon">🔐</div>' +
      '<div class="k-wlt-empty-title">Identifiez-vous pour accéder à votre porte-monnaie</div>' +
      '<div class="k-wlt-empty-sub">Confirmez votre numéro WhatsApp pour consulter votre solde et l\'historique de vos crédits.</div>' +
      '<button class="k-wlt-auth-btn" id="k-wlt-auth-btn">📲 M\'identifier</button>' +
    '</div>';

  el.querySelector('#k-wlt-auth-btn').addEventListener('click', async () => {
    const btn = el.querySelector('#k-wlt-auth-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Identification…';

    const user = await requireIdentity({ reason: 'porte-monnaie', title: 'Accéder à mon porte-monnaie' });
    if (user) {
      // OTP réussi → recharger la vue wallet
      renderWalletView();
    } else {
      // Utilisateur a annulé
      btn.disabled = false;
      btn.textContent = '📲 M\'identifier';
    }
  });
}

// ── Balance card ─────────────────────────────────────────────────────────────

// ── Expiry helpers ────────────────────────────────────────────────────────────

function fmtExpiry(isoDate) {
  if (!isoDate) return null;
  try {
    const d = new Date(isoDate);
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch (_) { return null; }
}

function daysUntil(isoDate) {
  if (!isoDate) return Infinity;
  try {
    const now  = new Date(); now.setHours(0,0,0,0);
    const then = new Date(isoDate); then.setHours(0,0,0,0);
    return Math.round((then - now) / 86400000);
  } catch (_) { return Infinity; }
}

// ── Balance card (nouveau design) ─────────────────────────────────────────────

function buildBalanceCard(balance, expiresAt) {
  const card = document.createElement('div');
  card.className = 'k-wlt-card';

  if (balance <= 0) return card; // état vide géré séparément

  const days      = daysUntil(expiresAt);
  const isUrgent  = days <= 7;
  const expiryFmt = fmtExpiry(expiresAt);

  let expiryHtml = '';
  if (expiryFmt) {
    const label   = days === 0 ? 'Expire aujourd\'hui'
                  : days === 1 ? 'Expire demain'
                  : isUrgent   ? 'Expire dans ' + days + ' jours'
                  :              'Valable jusqu\'au ' + sanitize(expiryFmt);
    const cls     = isUrgent ? 'k-wlt-expiry k-wlt-expiry--urgent' : 'k-wlt-expiry';
    expiryHtml    =
      '<div class="' + cls + '">' +
        '<svg width="12" height="12" viewBox="0 0 13 13" fill="none" aria-hidden="true"><rect x="1" y="2" width="11" height="10" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M4 1V3M9 1V3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M1 5H12" stroke="currentColor" stroke-width="1.4"/></svg>' +
        '<span>' + sanitize(label) + '</span>' +
      '</div>';
  }

  card.innerHTML =
    '<div class="k-wlt-eyebrow">On vous rembourse</div>' +
    '<div class="k-wlt-amount">' + sanitize(fmt(balance, 'KMF')) + '</div>' +
    '<p class="k-wlt-sub">à utiliser dès maintenant sur la boutique</p>' +
    expiryHtml +
    '<button class="k-wlt-cta" id="k-wlt-cta-btn">' +
      '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 2H3.5L4.5 9.5H12L13 5H5" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="5.5" cy="12.5" r="1" fill="white"/><circle cx="11.5" cy="12.5" r="1" fill="white"/></svg>' +
      'Faire mes achats' +
    '</button>';

  // CTA → retour catalogue
  card.querySelector('#k-wlt-cta-btn').addEventListener('click', () => {
    document.querySelector('[data-tab="shop"], [data-nav="shop"]')?.click();
  });

  return card;
}

// ── État vide (balance = 0) ───────────────────────────────────────────────────

function buildEmptyState() {
  const wrap = document.createElement('div');
  wrap.className = 'k-wlt-zero';
  wrap.innerHTML =
    '<div class="k-wlt-zero-icon">' +
      '<svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="3" y="5" width="26" height="22" rx="4" stroke="currentColor" stroke-width="1.8"/><path d="M3 12H29" stroke="currentColor" stroke-width="1.8"/><path d="M10 18H22M10 22H18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' +
    '</div>' +
    '<p class="k-wlt-zero-title">Aucun crédit pour l\'instant</p>' +
    '<p class="k-wlt-zero-sub">En cas de remboursement ou d\'avoir, le montant apparaîtra ici et sera utilisable immédiatement.</p>';
  return wrap;
}

// ── Transaction list ─────────────────────────────────────────────────────────

function buildTransactionList(transactions) {
  const wrap = document.createElement('div');
  wrap.className = 'k-wlt-tx-wrap';

  if (!transactions.length) {
    wrap.innerHTML =
      '<div class="k-wlt-empty">' +
        '<div class="k-wlt-empty-icon">📋</div>' +
        '<div class="k-wlt-empty-title">Aucun mouvement</div>' +
        '<div class="k-wlt-empty-sub">Vos crédits et utilisations apparaîtront ici.</div>' +
      '</div>';
    return wrap;
  }

  const title = document.createElement('h3');
  title.className = 'k-wlt-section-title';
  title.textContent = 'Historique des mouvements';
  wrap.appendChild(title);

  let currentMonth = '';

  transactions.forEach(tx => {
    const month = fmtMonth(tx.created_at);
    if (month !== currentMonth) {
      currentMonth = month;
      const mHead = document.createElement('div');
      mHead.className = 'k-wlt-month';
      mHead.textContent = month;
      wrap.appendChild(mHead);
    }

    const icon = txIcon(tx.type);
    const isCredit = tx.type === 'credit';
    const sign = isCredit ? '+' : '-';
    const amtCls = isCredit ? 'k-wlt-tx-amt--credit' : 'k-wlt-tx-amt--debit';
    const ref = tx.order_reference ? '#' + sanitize(tx.order_reference) : '';

    const row = document.createElement('div');
    row.className = 'k-wlt-tx-row';
    row.innerHTML =
      '<div class="k-wlt-tx-icon k-wlt-tx-icon--' + icon.cls + '">' + icon.emoji + '</div>' +
      '<div class="k-wlt-tx-info">' +
        '<div class="k-wlt-tx-label">' + txLabel(tx.reason) + '</div>' +
        '<div class="k-wlt-tx-date">' + sanitize(fmtDate(tx.created_at)) + (ref ? ' · ' + ref : '') + '</div>' +
      '</div>' +
      '<div class="k-wlt-tx-amt ' + amtCls + '">' + sign + sanitize(fmt(tx.amount_kmf, 'KMF')) + '</div>';
    wrap.appendChild(row);
  });

  return wrap;
}
