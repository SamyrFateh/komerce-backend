/**
 * @komerce-arch
 * @role          wallet-view
 * @domain        wallet
 * @layer         ui-page
 * @criticality   medium
 * @inputs        client_session, wallet_balance, wallet_transactions
 * @outputs       wallet_view
 * @depends       b-utils.js
 * @used-by       b-nav.js, boutique.js
 * @doctrine      wallet_visible_client, navigation_sans_friction
 * @impact-areas  wallet, boutique-navigation
 * @version       2026-06
 */

/**
 * @module b-wallet
 * @brief Mon porte-monnaie — solde + historique mouvements.
 *
 * Vue simple : carte solde en haut, liste des transactions en dessous.
 * Consomme GET /api/wallet et GET /api/wallet/transactions.
 */

import { sanitize, fmt, apiGet } from './b-utils.js';

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

// ── Render ───────────────────────────────────────────────────────────────────

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
    try {
      const [balData, txData] = await Promise.all([
        apiGet('/api/wallet').catch(() => null),
        apiGet('/api/wallet/transactions?limit=50').catch(() => null),
      ]);

      const balance = balData?.balance_kmf ?? 0;
      const transactions = txData?.transactions ?? [];

      el.innerHTML = '';
      el.appendChild(buildBalanceCard(balance));
      el.appendChild(buildTransactionList(transactions));
    } catch (_) {
      el.innerHTML = '<div class="k-wlt-empty">Impossible de charger le porte-monnaie.</div>';
    }
  })();
}

// ── Balance card ─────────────────────────────────────────────────────────────

function buildBalanceCard(balance) {
  const card = document.createElement('div');
  card.className = 'k-wlt-card';
  card.innerHTML =
    '<div class="k-wlt-card-label">Solde disponible</div>' +
    '<div class="k-wlt-card-amount">' + sanitize(fmt(balance, 'KMF')) + '</div>' +
    (balance > 0
      ? '<div class="k-wlt-card-hint">Utilisable au moment du paiement</div>'
      : '<div class="k-wlt-card-hint">Aucun crédit pour le moment</div>');
  return card;
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
