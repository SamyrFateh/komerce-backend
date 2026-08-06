/**
 * @komerce-arch
 * @role          order-tracking-view
 * @domain        tracking
 * @layer         ui-page
 * @criticality   high
 * @inputs        order_reference, phone, otp_code, client_session, library_context
 * @outputs       tracking_view, order_history, timeline, otp_state, lists_tab
 * @depends       b-store.js, b-phone.js, b-utils.js, b-cart-core.js, group/group-api.js, routes/otp.js, routes/orders.js, routes/shared-cart.js
 * @used-by       b-nav.js, boutique.js, group/group-library-remove.js
 * @doctrine      otp_une_fois, suivi_client_simple, reference_commande_lisible, sauvegarde_explicite_jamais_implicite
 * @impact-areas  tracking, auth, orders, participant-flow, customer-support, shared-cart, mon-komerce
 * @version       2026-08
 */
'use strict';

/**
 * @module b-tracking
 * @brief Suivi commandes (onglet « Commandes ») + bibliothèque « Mes listes »
 * (onglet « Listes », amendement V2 §D / Lot C — construit ici après avoir
 * été un point ouvert du rapport de clôture Lot D). La projection d'une
 * liste précise dans le side cart/drawer canonique reste entièrement gérée
 * par group/group-side-cart.js (activateFromParticipantUrl) — ce module ne
 * fait qu'afficher la liste des listes et déclencher cette activation au
 * clic. Zéro fusion avec state.cart, zéro écran de gestion parallèle
 * (mandat §2/§3 du refactor shared-cart).
 */

import { sanitize, optimizeImgUrl, fmt, apiGet, apiPost } from './b-utils.js';
import { showToast }                                       from './b-cart-core.js';
import { state }                                            from './b-store.js';
import {
  PHONE_COUNTRIES,
  phoneBlockHTML,
  buildPhoneSelect,
  buildE164,
  digitsOnly,
  normalizeLocal,
} from './b-phone.js';
import {
  getSharedCartLibrary,
  closeCart as apiCloseSharedCart,
} from './group/group-api.js';

'use strict';

const TRACK_STEPS = [
  { key: 'pending',      label: 'Commande reçue',         icon: '✓',  sub: 'Enregistrée avec succès' },
  { key: 'preparation',  label: 'En préparation',          icon: '⚙️', sub: 'Nous préparons votre colis' },
  { key: 'shipped',      label: 'Expédiée',                icon: '🚢', sub: 'Remise au transitaire' },
  { key: 'in_transit',   label: 'En route vers le relais', icon: '🚚', sub: '' },
  { key: 'available',    label: 'Disponible au relais',    icon: '🏪', sub: 'Prêt à être retiré' },
  { key: 'collected',    label: 'Retiré',                  icon: '✅', sub: 'Commande clôturée' },
];

export function buildTimeline(status) {
  const idx = TRACK_STEPS.findIndex(s => s.key === status);
  return TRACK_STEPS.map((s, i) => {
    const done    = i < idx;
    const current = i === idx;
    const cls     = done ? 'done' : current ? 'current' : '';
    return `<div class="k-track-step">
      <div class="k-track-step-dot ${cls}">${done ? '✓' : s.icon}</div>
      <div class="k-track-step-info">
        <div class="k-track-step-label">${s.label}</div>
        <div class="k-track-step-sub">${s.sub}</div>
      </div>
    </div>`;
  }).join('');
}

export function getStatusDisplay(status, paymentStatus) {
  const map = {
    pending:     { emoji: '⏳', label: 'En attente',      cls: 'pending' },
    confirmed:   { emoji: '✅', label: 'Confirmée',       cls: 'confirmed' },
    paid:        { emoji: '💰', label: 'Payée',           cls: 'confirmed' },
    ordered:     { emoji: '🛒', label: 'En préparation',  cls: 'processing' },
    preparation: { emoji: '📦', label: 'En préparation',  cls: 'processing' },
    shipped:     { emoji: '🚢', label: 'Expédiée',        cls: 'shipped' },
    in_transit:  { emoji: '🚚', label: 'En transit',      cls: 'shipped' },
    available:   { emoji: '🏪', label: 'Au relais',       cls: 'available' },
    collected:   { emoji: '✅', label: 'Retirée',         cls: 'delivered' },
    delivered:   { emoji: '✅', label: 'Livrée',          cls: 'delivered' },
    cancelled:   { emoji: '❌', label: 'Annulée',         cls: 'cancelled' },
  };
  return map[status] || { emoji: '📦', label: status || 'Inconnu', cls: 'pending' };
}

export function formatOrderDate(isoDate) {
  if (!isoDate) return '';
  try {
    const d       = new Date(isoDate);
    const diffMs  = Date.now() - d;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return "Aujourd'hui";
    if (diffDays === 1) return 'Hier';
    if (diffDays < 7)  return 'Il y a ' + diffDays + ' jours';
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch(e) { return ''; }
}

export function renderOrdersHistory(orders, container) {
  if (!orders.length) {
    container.innerHTML = '<div class="k-search-empty">Aucune commande trouvée.</div>';
    return;
  }
  container.innerHTML = orders.map(o => `
    <div class="k-order-card">
      <div class="k-order-card-head">
        <span class="k-order-ref">${sanitize(o.reference || o.id || "")}</span>
        <span class="k-order-date">${o.created_at ? new Date(o.created_at).toLocaleDateString('fr-FR') : ''}</span>
      </div>
      <div class="k-order-card-total">${fmt(o.total_amount || 0, 'KMF')}</div>
      <div class="k-track-steps k-track-steps--compact">${buildTimeline(o.status || 'pending')}</div>
    </div>`).join('');
}

export function renderOrderDetail(order, container) {
  container.innerHTML = `
    <div class="k-order-card">
      <div class="k-order-card-head">
        <span class="k-order-ref">${sanitize(order.reference || order.id || "")}</span>
        <span class="k-order-date">${order.created_at ? new Date(order.created_at).toLocaleDateString('fr-FR') : ''}</span>
      </div>
      <div class="k-order-card-total">${fmt(order.total_amount || 0, 'KMF')}</div>
      <div class="k-track-steps">${buildTimeline(order.status || 'pending')}</div>
    </div>`;
}

export function renderMyOrdersList(el, orders) {
  const header = '<section class="k-track-orders-panel"><h2>📦 Mes commandes</h2>' +
    '<p class="k-track-sub-hint">' + orders.length + ' commande' + (orders.length > 1 ? 's' : '') +
    ' trouvée' + (orders.length > 1 ? 's' : '') + '</p>';

  const cards = orders.map(o => {
    const statusInfo   = getStatusDisplay(o.status || 'pending', o.payment_status);
    const totalStr     = fmt(o.total_kmf || 0, 'KMF');
    const dateStr      = formatOrderDate(o.created_at);
    const productName  = o.product_name || 'Commande';
    const productImg   = o.product_image_url || null;
    const itemsCount   = parseInt(o.items_count, 10) || 1;
    const imgHtml      = productImg
      ? '<img src="' + sanitize(optimizeImgUrl(productImg, 100)) + '" alt="" loading="lazy" decoding="async">'
      : '<div class="k-myorder-emoji">📦</div>';
    const itemsSummary = itemsCount > 1
      ? productName + ' + ' + (itemsCount - 1) + ' autre' + (itemsCount > 2 ? 's' : '')
      : productName;

    return '<button class="k-myorder-card" data-ref="' + sanitize(o.reference || '') + '">' +
      '<div class="k-myorder-img">' + imgHtml + '</div>' +
      '<div class="k-myorder-body">' +
        '<div class="k-myorder-ref">' + sanitize(o.reference || '—') + '</div>' +
        '<div class="k-myorder-items">' + sanitize(itemsSummary) + '</div>' +
        '<div class="k-myorder-bottom">' +
          '<span class="k-myorder-status k-myorder-status--' + statusInfo.cls + '">' + statusInfo.emoji + ' ' + statusInfo.label + '</span>' +
          '<span class="k-myorder-total">' + totalStr + '</span>' +
        '</div>' +
        '<div class="k-myorder-date">' + dateStr + '</div>' +
      '</div>' +
      '<span class="k-myorder-arrow">›</span>' +
    '</button>';
  }).join('');

  el.innerHTML = '<div class="k-track-dashboard">' +
    header + '<div class="k-myorders-list">' + cards + '</div>' +
    '<button class="k-track-btn k-track-btn--ghost k-myorders-new-search" id="k-myorders-search-other">🔍 Chercher une autre commande</button></section>' +
    '</div>';

  el.querySelectorAll('.k-myorder-card').forEach(card => {
    card.addEventListener('click', async () => {
      const ref = card.dataset.ref;
      if (!ref) return;
      card.classList.add('k-myorder-loading');
      try {
        const data = await apiGet('/api/orders/' + encodeURIComponent(ref));
        el.innerHTML = '';
        const backBtn = document.createElement('button');
        backBtn.className = 'k-track-btn k-track-btn--ghost';
        backBtn.textContent = '← Retour à mes commandes';
        backBtn.addEventListener('click', () => renderTrackView());
        el.appendChild(backBtn);
        const box = document.createElement('div');
        el.appendChild(box);
        renderOrderDetail(data.order || data, box);
      } catch (e) {
        showToast('Impossible de charger cette commande.', 'error');
        card.classList.remove('k-myorder-loading');
      }
    });
  });

  const searchBtn = el.querySelector('#k-myorders-search-other');
  if (searchBtn) searchBtn.addEventListener('click', () => renderTrackViewSearchMode(el));
}

/**
 * Point d'ancrage DOM commun aux deux onglets (Commandes / Listes).
 * Crée #k-track-view s'il n'existe pas encore, puis y installe la coquille
 * persistante (sous-nav + 2 panneaux) une seule fois. N'écrase JAMAIS un
 * shell déjà en place, pour ne pas perdre l'onglet actif au fil des appels
 * répétés à renderTrackView()/renderListsView() (ex. clic répété sur Suivi
 * dans la bottom nav).
 * @returns {HTMLElement} #k-track-view
 */
function ensureTrackShell() {
  let el = document.getElementById('k-track-view');
  if (!el) {
    el = document.createElement('div');
    el.id = 'k-track-view';
    el.className = 'k-track-view';
    const favEl = document.getElementById('k-fav-view') || document.getElementById('k-catalog-section');
    favEl.after(el);
  }

  if (!el.querySelector('.k-track-subnav')) {
    el.innerHTML =
      '<div class="k-track-subnav" role="tablist">' +
        '<button type="button" class="k-track-subnav-tab active" data-track-tab="orders" role="tab" aria-selected="true">📦 Commandes</button>' +
        '<button type="button" class="k-track-subnav-tab" data-track-tab="lists" role="tab" aria-selected="false">📋 Listes</button>' +
      '</div>' +
      '<div id="k-track-orders-panel-wrap" class="k-track-tab-panel"></div>' +
      '<div id="k-track-lists-panel-wrap" class="k-track-tab-panel u-hidden"></div>';

    el.querySelectorAll('.k-track-subnav-tab').forEach((btn) => {
      btn.addEventListener('click', () => switchTrackTab(btn.dataset.trackTab));
    });
  }

  return el;
}

/**
 * Bascule visuelle entre les deux panneaux de la coquille (aucun rechargement
 * du panneau Commandes au retour depuis Listes — seul le panneau Listes est
 * (re)chargé à l'activation, cohérent avec le fait que la bibliothèque peut
 * avoir changé entre-temps — ex. liste sauvegardée/retirée ailleurs).
 * @param {'orders'|'lists'} tab
 */
function switchTrackTab(tab) {
  const el = document.getElementById('k-track-view');
  if (!el) return;

  el.querySelectorAll('.k-track-subnav-tab').forEach((btn) => {
    const active = btn.dataset.trackTab === tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });

  const ordersWrap = document.getElementById('k-track-orders-panel-wrap');
  const listsWrap  = document.getElementById('k-track-lists-panel-wrap');
  if (ordersWrap) ordersWrap.classList.toggle('u-hidden', tab !== 'orders');
  if (listsWrap)  listsWrap.classList.toggle('u-hidden', tab !== 'lists');

  if (tab === 'lists') renderListsTab(listsWrap);
}

export function renderTrackView() {
  ensureTrackShell();
  switchTrackTab('orders');

  const el = document.getElementById('k-track-orders-panel-wrap');
  if (!el) return;

  el.innerHTML = '<div class="k-track-loading"><div class="k-track-loading-spin"></div><p>Chargement de vos commandes…</p></div>';

  (async () => {
    // FIX 2026-07-10 : distinguer les échecs.
    //   401/403 (pas de session) → mode recherche par référence (comportement voulu)
    //   timeout / 5xx / réseau   → état erreur + Réessayer (avant : loader infini
    //                              possible si la requête pendait, ou bascule
    //                              trompeuse en mode recherche sur panne backend)
    let ordersErr = null;
    const ordersResult = await apiGet('/api/orders?limit=20').catch((e) => { ordersErr = e; return null; });

    if (ordersErr && ordersErr.status !== 401 && ordersErr.status !== 403) {
      renderTrackError(el, ordersErr);
      return;
    }

    const orders = Array.isArray(ordersResult)
      ? ordersResult
      : (ordersResult?.orders || []);

    if (!orders.length) {
      renderTrackViewSearchMode(el);
      return;
    }

    el.innerHTML = '';
    renderMyOrdersList(el, orders);
  })().catch((e) => {
    // Filet ultime : jamais de "Chargement…" résiduel.
    console.warn('[tracking] render:', e);
    renderTrackError(el, e);
  });
}

/**
 * Point d'entrée onglet « Listes » — ouvre directement sur la bibliothèque
 * sans déclencher le fetch /api/orders du panneau Commandes (mandat §D :
 * les deux onglets restent des lectures indépendantes, jamais couplées).
 * Consommateurs : b-nav.js (deep-link ?tab=group, compat liens existants).
 */
export function renderListsView() {
  ensureTrackShell();
  switchTrackTab('lists');
}

// ── Onglet « Listes » — bibliothèque « Mes listes » (amendement V2 §D) ─────

const LIBRARY_STATUS_DISPLAY = {
  open:      { emoji: '🟢', label: 'Ouverte',  cls: 'open' },
  closed:    { emoji: '🔒', label: 'Fermée',   cls: 'closed' },
  cancelled: { emoji: '❌', label: 'Annulée',  cls: 'cancelled' },
};

function libraryStatus(status) {
  return LIBRARY_STATUS_DISPLAY[status] || LIBRARY_STATUS_DISPLAY.open;
}

/**
 * Carte d'une liste. `closable` gouverne uniquement l'affichage du bouton
 * Fermer — jamais affiché côté « Partagées avec moi » (le destinataire
 * n'est pas le créateur, closeCart() le refuserait de toute façon côté
 * backend : services/shared-cart-lifecycle.js exige organizer_user_id).
 *
 * Note structurelle : les listes « Créées par moi » sont explicitement
 * enveloppées dans leur propre `.k-library-item-row` ici (avec le bouton
 * Fermer). Les listes « Partagées avec moi » sont rendues SANS wrapper —
 * group/group-library-remove.js::decorateLibraryRows() construit lui-même
 * ce wrapper et y ajoute le bouton Retirer ; lui fournir un wrapper déjà en
 * place le ferait tourner court (branche `existingRow`, aucun bouton
 * ajouté). Ne pas envelopper cette section serait donc une régression
 * silencieuse de la fonctionnalité de retrait.
 */
function libraryItemInnerHtml(cart) {
  const status  = libraryStatus(cart.status);
  const total   = fmt(cart.total_kmf || 0, 'KMF');
  const count   = parseInt(cart.items_count, 10) || 0;
  const claimed = parseInt(cart.claimed_count, 10) || 0;
  return (
    '<div class="k-library-item-body">' +
      '<div class="k-library-item-title">' + sanitize(cart.title || 'Liste sans titre') + '</div>' +
      '<div class="k-library-item-meta">' + claimed + '/' + count + ' article' + (count > 1 ? 's' : '') + ' · ' + total + '</div>' +
      '<div class="k-library-item-status k-library-item-status--' + status.cls + '">' + status.emoji + ' ' + status.label + '</div>' +
    '</div>' +
    '<span class="k-library-item-arrow">›</span>'
  );
}

function renderCreatedSection(carts) {
  if (!carts.length) {
    return '<p class="k-library-empty-hint">Aucune liste créée pour le moment.</p>';
  }
  return carts.map((cart) => {
    const closeBtn = cart.status === 'open'
      ? '<button type="button" class="k-library-item-close" data-cart-id="' + sanitize(String(cart.id)) + '">Fermer</button>'
      : '';
    return (
      '<div class="k-library-item-row">' +
        '<button type="button" class="k-library-item" data-token="' + sanitize(cart.token || '') + '">' +
          libraryItemInnerHtml(cart) +
        '</button>' +
        closeBtn +
      '</div>'
    );
  }).join('');
}

function renderSavedSection(carts) {
  if (!carts.length) {
    return '<p class="k-library-empty-hint">Aucune liste sauvegardée. Ouvrez un lien reçu puis « ☆ Sauvegarder cette liste » pour la retrouver ici.</p>';
  }
  // Pas de wrapper .k-library-item-row ici — voir libraryItemInnerHtml() ci-dessus.
  return carts.map((cart) =>
    '<button type="button" class="k-library-item" data-token="' + sanitize(cart.token || '') + '">' +
      libraryItemInnerHtml(cart) +
    '</button>'
  ).join('');
}

function wireLibraryItemOpen(el) {
  el.querySelectorAll('.k-library-item[data-token]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const token = btn.dataset.token;
      if (!token) return;
      btn.disabled = true;
      try {
        const { activateFromParticipantUrl } = await import('./group/group-side-cart.js');
        await activateFromParticipantUrl(token);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function wireLibraryCloseButtons(el) {
  el.querySelectorAll('.k-library-item-close[data-cart-id]').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const cartId = btn.dataset.cartId;
      if (!cartId) return;

      const ok = window.confirm('Fermer cette liste ? Elle deviendra en lecture seule.');
      if (!ok) return;

      btn.disabled = true;
      btn.textContent = 'Fermeture…';
      try {
        await apiCloseSharedCart(cartId);
        showToast('Liste fermée.', 'success');
        await renderListsTab(el);
      } catch (err) {
        showToast(`Impossible de fermer cette liste : ${err.message}`, 'error');
        btn.disabled = false;
        btn.textContent = 'Fermer';
      }
    });
  });
}

function renderLibrarySections(el) {
  const created = state.libraryContext?.created || [];
  const saved   = state.libraryContext?.saved   || [];

  el.innerHTML =
    '<section class="k-track-lists-panel">' +
      '<h2>📋 Créées par moi</h2>' +
      '<div class="k-library-section">' + renderCreatedSection(created) + '</div>' +
      '<h2>📋 Partagées avec moi</h2>' +
      '<div class="k-library-section">' + renderSavedSection(saved) + '</div>' +
    '</section>';

  wireLibraryItemOpen(el);
  wireLibraryCloseButtons(el);
}

function renderListsError(el, err) {
  el.innerHTML =
    '<div class="k-track-error">' +
      '<div class="k-track-error-icon">⚠️</div>' +
      '<div class="k-track-error-title">Impossible de charger vos listes</div>' +
      '<div class="k-track-error-sub">Vérifiez votre connexion puis réessayez.</div>' +
      '<button class="k-track-retry-btn" id="k-track-lists-retry-btn">🔄 Réessayer</button>' +
    '</div>';
  el.querySelector('#k-track-lists-retry-btn')?.addEventListener('click', () => renderListsTab(el));
}

/**
 * Rend le contenu de l'onglet Listes dans `el` (#k-track-lists-panel-wrap).
 * Consommé aussi par group/group-library-remove.js::rerenderLibrary()
 * après un retrait (import dynamique, cf. son en-tête).
 * @param {HTMLElement} el
 */
export async function renderListsTab(el) {
  if (!el) return;
  el.innerHTML = '<div class="k-track-loading"><div class="k-track-loading-spin"></div><p>Chargement de vos listes…</p></div>';

  try {
    const library = await getSharedCartLibrary();
    state.libraryContext = {
      created: Array.isArray(library.created) ? library.created : [],
      saved:   Array.isArray(library.saved)   ? library.saved   : [],
    };
    renderLibrarySections(el);
  } catch (err) {
    console.warn('[tracking] renderListsTab:', err);
    renderListsError(el, err);
  }
}

// ── État erreur + Réessayer (FIX 2026-07-10) ────────────────────────────────

function renderTrackError(el, err) {
  const isTimeout = !!(err && (err.isTimeout || err.name === 'TimeoutError'));
  el.innerHTML =
    '<div class="k-track-error">' +
      '<div class="k-track-error-icon">⚠️</div>' +
      '<div class="k-track-error-title">' + (isTimeout ? 'Le suivi met trop de temps à répondre' : 'Impossible de charger vos commandes') + '</div>' +
      '<div class="k-track-error-sub">Vérifiez votre connexion puis réessayez, ou recherchez une commande par sa référence.</div>' +
      '<button class="k-track-retry-btn" id="k-track-retry-btn">🔄 Réessayer</button>' +
      '<button class="k-track-search-fallback-btn" id="k-track-search-fallback-btn">🔎 Rechercher par référence</button>' +
    '</div>';
  el.querySelector('#k-track-retry-btn')?.addEventListener('click', () => renderTrackView());
  el.querySelector('#k-track-search-fallback-btn')?.addEventListener('click', () => renderTrackViewSearchMode(el));
}

export function renderTrackViewSearchMode(el) {
  const otpState = { phone: '' };

  el.innerHTML = `
    <div class="k-track-dashboard k-track-dashboard--search">
      <section class="k-track-orders-panel">
        <h2>📦 Suivi de commande</h2>

        <div id="k-track-quick">
          <p class="k-otp-hint">Entrez votre référence de commande (ex : K3XR7F)</p>
          <div class="k-track-form">
            <div class="k-track-ref-wrap">
              <span class="k-track-ref-prefix">K</span>
              <input class="k-track-input k-track-input--ref" id="k-track-digits" type="text" inputmode="text" placeholder="3XR7F" maxlength="6" autocomplete="off" style="text-transform:uppercase">
            </div>
            <button class="k-track-btn" id="k-track-quick-btn">🔍 Suivre</button>
          </div>
          <div class="k-otp-divider"><span>ou</span></div>
          <button class="k-track-btn k-track-btn--ghost" id="k-track-history-toggle">📋 Voir tout mon historique</button>
        </div>

        <div id="k-track-otp" class="u-hidden">
          <p class="k-otp-hint">Entrez votre numéro pour recevoir un code WhatsApp et voir toutes vos commandes.</p>
          <div class="k-track-form">
            <div class="k-track-phone-wrap">
              ${phoneBlockHTML('k-otp-country', 'k-otp-phone', '+33')}
            </div>
            <button class="k-track-btn" id="k-otp-request-btn">📲 Envoyer le code</button>
          </div>
          <button class="k-track-btn k-track-btn--ghost k-track-btn--mt" id="k-track-back-quick">← Suivi rapide</button>
        </div>

        <div id="k-otp-step2" class="u-hidden">
          <div class="k-otp-sent-banner">
            📲 Code WhatsApp envoyé au <strong id="k-otp-phone-display"></strong><br>
            <small>Vérifiez vos messages WhatsApp. Code valable 10 min.</small>
          </div>
          <input class="k-otp-code-input" id="k-otp-code" type="text" inputmode="numeric" placeholder="_ _ _ _ _ _" maxlength="6" autocomplete="one-time-code">
          <button class="k-track-btn" id="k-otp-verify-btn">Vérifier</button>
          <button class="k-otp-resend-btn" id="k-otp-resend-btn">Renvoyer le code</button>
        </div>

        <div id="k-otp-step3" class="u-hidden">
          <div id="k-orders-list"></div>
          <button class="k-otp-resend-btn k-otp-back-btn" id="k-otp-back-btn">← Nouvelle recherche</button>
        </div>
      </section>
      </div>`;

  const digitsInput = el.querySelector('#k-track-digits');
  digitsInput.addEventListener('input', () => {
    digitsInput.value = digitsInput.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6);
    if (digitsInput.value.length === 6) el.querySelector('#k-track-quick-btn').click();
  });

  el.querySelector('#k-track-quick-btn').addEventListener('click', async () => {
    const suffix = digitsInput.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (suffix.length !== 6) { showToast('Entrez les 6 caractères de votre référence.', 'error'); return; }
    const ref = 'K' + suffix;
    const btn = el.querySelector('#k-track-quick-btn');
    btn.disabled = true; btn.textContent = '⏳ Recherche…';
    try {
      const data = await apiGet('/api/orders/' + encodeURIComponent(ref));
      el.querySelector('#k-track-quick').classList.add('u-hidden');
      el.querySelector('#k-otp-step3').classList.remove('u-hidden');
      renderOrderDetail(data.order || data, el.querySelector('#k-orders-list'));
    } catch(e) {
      showToast('Commande introuvable. Vérifiez la référence (ex : K3XR7F).', 'error');
      btn.disabled = false; btn.textContent = '🔍 Suivre';
    }
  });

  el.querySelector('#k-track-history-toggle').addEventListener('click', () => {
    el.querySelector('#k-track-quick').classList.add('u-hidden');
    el.querySelector('#k-track-otp').classList.remove('u-hidden');
  });

  el.querySelector('#k-track-back-quick').addEventListener('click', () => {
    el.querySelector('#k-track-otp').classList.add('u-hidden');
    el.querySelector('#k-track-quick').classList.remove('u-hidden');
  });

  buildPhoneSelect('k-otp-country', 'k-otp-phone', '+33', null);
  const otpSel = el.querySelector('#k-otp-country');
  if (otpSel) otpSel.className = 'k-track-country';
  const otpInput = el.querySelector('#k-otp-phone');
  if (otpInput) otpInput.className = 'k-track-input k-track-input--phone';

  function getFullPhone() {
    const code = el.querySelector('#k-otp-country')?.value || '+33';
    const raw  = el.querySelector('#k-otp-phone')?.value || '';
    return buildE164(code, raw);
  }

  function isPhoneValid() {
    const code = el.querySelector('#k-otp-country')?.value || '+33';
    const raw  = el.querySelector('#k-otp-phone')?.value || '';
    const country = PHONE_COUNTRIES.find(c => c.code === code);
    if (!country) return false;
    const digits = normalizeLocal(code, digitsOnly(raw));
    return digits.length === country.digits;
  }

  el.querySelector('#k-otp-request-btn').addEventListener('click', async () => {
    if (!isPhoneValid()) { showToast('Entrez un numéro valide pour ce pays.', 'error'); return; }
    const phone  = getFullPhone();
    const btn = el.querySelector('#k-otp-request-btn');
    btn.disabled = true; btn.textContent = '⏳ Envoi…';
    try {
      await apiPost('/api/auth/otp/request', { phone });
      otpState.phone = phone;
      el.querySelector('#k-otp-phone-display').textContent = phone;
      el.querySelector('#k-track-otp').classList.add('u-hidden');
      el.querySelector('#k-otp-step2').classList.remove('u-hidden');
      showToast('📲 Code WhatsApp envoyé !', 'success');
    } catch(e) {
      showToast(e?.message || 'Erreur lors de l\'envoi.', 'error');
      btn.disabled = false; btn.textContent = '📲 Envoyer le code';
    }
  });

  el.querySelector('#k-otp-verify-btn').addEventListener('click', async () => {
    const code = el.querySelector('#k-otp-code').value.replace(/\s/g, '');
    if (code.length < 4) { showToast('Entrez le code complet.', 'error'); return; }
    const btn = el.querySelector('#k-otp-verify-btn');
    btn.disabled = true; btn.textContent = '⏳ Vérification…';
    try {
      const verifyResult = await apiPost('/api/auth/otp/verify', { phone: otpState.phone, code });
      showToast('✅ Vérifié — chargement de vos commandes…', 'success');
      try {
        const trackingData = await apiGet('/api/client/tracking');
        el.querySelector('#k-otp-step2').classList.add('u-hidden');
        el.querySelector('#k-otp-step3').classList.remove('u-hidden');
        const orders = (trackingData.orders || []).map(o => ({
          ...o,
          total_amount: o.totalKmf || o.total_kmf || o.total_amount || 0,
          created_at:   o.createdAt || o.created_at,
        }));
        renderOrdersHistory(orders, el.querySelector('#k-orders-list'));
      } catch(trackErr) {
        el.querySelector('#k-otp-step2').classList.add('u-hidden');
        el.querySelector('#k-otp-step3').classList.remove('u-hidden');
        el.querySelector('#k-orders-list').innerHTML = `
          <div class="k-search-empty">
            <p>✅ Numéro vérifié ! Bienvenue <strong>${sanitize(verifyResult.user?.name || "")}</strong></p>
            <p class="k-confirm-notice-item">Aucune commande trouvée pour ce numéro.</p>
          </div>`;
      }
    } catch(e) {
      showToast(e?.message || 'Code incorrect ou expiré.', 'error');
      btn.disabled = false; btn.textContent = 'Vérifier';
    }
  });

  let resendTimer = null;
  el.querySelector('#k-otp-resend-btn').addEventListener('click', async () => {
    const btn = el.querySelector('#k-otp-resend-btn');
    if (resendTimer) return;
    btn.disabled = true; btn.textContent = '⏳ Renvoi…';
    try {
      await apiPost('/api/auth/otp/request', { phone: otpState.phone });
      showToast('📲 Nouveau code envoyé !', 'success');
      let countdown = 30;
      resendTimer = setInterval(() => {
        countdown--;
        btn.textContent = `Renvoyer (${countdown}s)`;
        if (countdown <= 0) {
          clearInterval(resendTimer); resendTimer = null;
          btn.disabled = false; btn.textContent = 'Renvoyer le code';
        }
      }, 1000);
    } catch(e) {
      showToast('Erreur lors du renvoi.', 'error');
      btn.disabled = false; btn.textContent = 'Renvoyer le code';
    }
  });

  el.querySelector('#k-otp-back-btn').addEventListener('click', () => renderTrackView());
}


