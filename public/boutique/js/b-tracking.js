/**
 * @komerce-arch
 * @role          order-tracking-view
 * @domain        tracking
 * @layer         ui-page
 * @criticality   high
 * @inputs        order_reference, phone, otp_code, client_session, library_context, private_documents, wallet_balance
 * @outputs       tracking_view, order_history, timeline, essential_order_documents, otp_state, lists_tab
 * @depends       b-store.js, b-phone.js, b-utils.js, b-cart-core.js, b-identity.js, group/group-api.js, routes/otp.js, routes/orders.js, routes/documents.js, routes/wallet.js, routes/shared-cart.js
 * @used-by       b-nav.js, boutique.js, group/group-library-remove.js
 * @doctrine      otp_une_fois, suivi_client_simple, reference_commande_lisible, sauvegarde_explicite_jamais_implicite
 * @impact-areas  tracking, auth, orders, documents, wallet, participant-flow, customer-support, shared-cart, mon-komerce
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

import { sanitize, optimizeImgUrl, fmt, apiGet, apiPost, apiDownload } from './b-utils.js';
import { showToast }                                       from './b-cart-core.js';
import { state }                                            from './b-store.js';
import {
  PHONE_COUNTRIES,
  DEFAULT_IDENTITY_PHONE_CODE,
  phoneBlockHTML,
  buildPhoneSelect,
  buildE164,
  digitsOnly,
  normalizeLocal,
} from './b-phone.js';
import { getSharedCartLibrary } from './group/group-api.js';
import { sharedListDisplayLabel } from './group/group-list-labels.js';
import { requireIdentity, restoreIdentity } from './b-identity.js';

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

function essentialDocumentLabel(documentRow, order) {
  if (documentRow.document_type === 'invoice') return 'Facture';
  if (documentRow.document_type !== 'refund_receipt') return null;
  const refunded = Number(documentRow.amount_kmf || 0);
  const total = Number(order.total_amount ?? order.total_kmf ?? 0);
  return refunded > 0 && total > 0 && refunded >= total
    ? 'Remboursement total'
    : 'Remboursement partiel';
}

async function downloadOrderDocument(button, documentRow) {
  if (button.disabled || !documentRow.download_url) return;
  button.disabled = true;
  const original = button.textContent;
  button.textContent = 'Préparation…';
  try {
    const file = await apiDownload(documentRow.download_url, { timeoutMs: 20000 });
    const url = URL.createObjectURL(file.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    button.textContent = err?.status === 401 ? 'Session expirée' : 'Réessayer';
    return;
  } finally {
    button.disabled = false;
    if (button.textContent === 'Préparation…') button.textContent = original;
  }
}

function appendEssentialOrderResources(container, order, resources) {
  if (!resources) return;
  const documents = (Array.isArray(resources.documents) ? resources.documents : [])
    .filter((row) => essentialDocumentLabel(row, order) && row.download_url);
  const walletBalance = Number(resources.wallet?.balance_kmf ?? 0);
  if (!documents.length && walletBalance <= 0) return;

  const section = document.createElement('section');
  section.className = 'k-order-essentials';
  const title = document.createElement('h3');
  title.textContent = 'Documents et solde';
  section.appendChild(title);

  documents.forEach((documentRow) => {
    const row = document.createElement('div');
    row.className = 'k-order-essential-row';
    const info = document.createElement('div');
    const label = document.createElement('strong');
    label.textContent = essentialDocumentLabel(documentRow, order);
    const meta = document.createElement('span');
    const parts = [documentRow.reference];
    if (documentRow.amount_kmf != null) parts.push(fmt(Number(documentRow.amount_kmf), 'KMF'));
    meta.textContent = parts.filter(Boolean).join(' · ');
    info.append(label, meta);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'k-order-document-download';
    button.textContent = 'Télécharger';
    button.setAttribute('aria-label', `Télécharger ${label.textContent}`);
    button.addEventListener('click', () => downloadOrderDocument(button, documentRow));
    row.append(info, button);
    section.appendChild(row);
  });

  if (walletBalance > 0) {
    const row = document.createElement('div');
    row.className = 'k-order-essential-row k-order-wallet-balance';
    const label = document.createElement('strong');
    label.textContent = 'Solde wallet';
    const amount = document.createElement('span');
    amount.textContent = fmt(walletBalance, 'KMF');
    row.append(label, amount);
    section.appendChild(row);
  }

  container.querySelector('.k-order-card')?.appendChild(section);
}

export function renderOrderDetail(order, container, { privateResources = null } = {}) {
  container.innerHTML = `
    <div class="k-order-card">
      <div class="k-order-card-head">
        <span class="k-order-ref">${sanitize(order.reference || order.id || "")}</span>
        <span class="k-order-date">${order.created_at ? new Date(order.created_at).toLocaleDateString('fr-FR') : ''}</span>
      </div>
      <div class="k-order-card-total">${fmt(order.total_amount || 0, 'KMF')}</div>
      <div class="k-track-steps">${buildTimeline(order.status || 'pending')}</div>
    </div>`;
  appendEssentialOrderResources(container, order, privateResources);
}

export function renderMyOrdersList(el, orders) {
  const header = '<div class="k-secondary-page-head">' +
    '<div class="k-secondary-page-copy"><span class="k-secondary-page-eyebrow">Votre historique</span>' +
    '<h2>📦 Mes commandes</h2><p>' + orders.length + ' commande' + (orders.length > 1 ? 's' : '') +
    ' trouvée' + (orders.length > 1 ? 's' : '') + '. Consultez leur avancement et leurs détails.</p></div>' +
    '<div class="k-secondary-page-visual" aria-hidden="true">✓</div></div>' +
    '<section class="k-track-orders-panel k-secondary-page-panel">';

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
        const encodedRef = encodeURIComponent(ref);
        const [data, documentPayload, wallet] = await Promise.all([
          apiGet('/api/orders/' + encodedRef),
          apiGet('/api/auth/me/documents?order_reference=' + encodedRef).catch(() => null),
          apiGet('/api/wallet').catch(() => null),
        ]);
        el.innerHTML = '';
        const backBtn = document.createElement('button');
        backBtn.className = 'k-track-btn k-track-btn--ghost';
        backBtn.textContent = '← Retour à mes commandes';
        backBtn.addEventListener('click', () => renderTrackView());
        el.appendChild(backBtn);
        const box = document.createElement('div');
        el.appendChild(box);
        renderOrderDetail(data.order || data, box, {
          privateResources: {
            documents: Array.isArray(documentPayload?.documents) ? documentPayload.documents : [],
            wallet,
          },
        });
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

  if (!el.querySelector('#k-track-orders-panel-wrap')) {
    el.innerHTML =
      '<div id="k-track-orders-panel-wrap" class="k-track-tab-panel"></div>' +
      '<div id="k-track-lists-panel-wrap" class="k-track-tab-panel u-hidden"></div>';
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
  // Mandat cohérence post-LOT 13, §8 — "Fermer" reste le verbe générique
  // de dismiss (panneaux/modales) ailleurs dans l'app ; "Clôturée" lève
  // l'ambiguïté avec l'action métier irréversible de fin de vie de la
  // liste. La valeur backend/interne 'closed' (clé de cet objet) ne
  // change pas, seul ce libellé affiché change.
  closed:    { emoji: '🔒', label: 'Clôturée', cls: 'closed' },
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
function libraryItemInnerHtml(cart, { isCreator = false } = {}) {
  const status  = libraryStatus(cart.status);
  const label   = sharedListDisplayLabel({
    isCreator,
    organizerFullName: cart.organizer_full_name || null,
  });
  const total   = fmt(cart.total_kmf || 0, 'KMF');
  const count   = parseInt(cart.items_count, 10) || 0;
  const claimed = parseInt(cart.claimed_count, 10) || 0;
  return (
    '<div class="k-library-item-body">' +
      '<div class="k-library-item-title">' + sanitize(label) + '</div>' +
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
  // É6 (2026-08) — Fermer est retiré de Mes listes. Il reste au seul
  // endroit canonique : le slot partagé du side-cart (arbitrage A2).
  // Mes listes sert à retrouver et OUVRIR une liste existante.
  return carts.map((cart) =>
    '<div class="k-library-item-row">' +
      '<button type="button" class="k-library-item" data-token="' + sanitize(cart.token || '') + '" data-status="' + sanitize(cart.status || '') + '"' + (cart.status !== 'open' ? ' disabled' : '') + '>' +
        libraryItemInnerHtml(cart, { isCreator: true }) +
      '</button>' +
    '</div>'
  ).join('');
}

function renderSavedSection(carts) {
  if (!carts.length) {
    return '<p class="k-library-empty-hint">Aucune liste sauvegardée. Ouvrez un lien reçu puis « ☆ Sauvegarder cette liste » pour la retrouver ici.</p>';
  }
  // Pas de wrapper .k-library-item-row ici — voir libraryItemInnerHtml() ci-dessus.
  return carts.map((cart) =>
    '<button type="button" class="k-library-item" data-token="' + sanitize(cart.token || '') + '" data-status="' + sanitize(cart.status || '') + '"' + (cart.status !== 'open' ? ' disabled' : '') + '>' +
      libraryItemInnerHtml(cart, { isCreator: false }) +
    '</button>'
  ).join('');
}

function wireLibraryItemOpen(el) {
  el.querySelectorAll('.k-library-item[data-token]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const token = btn.dataset.token;
      if (!token) return;

      // GAP-02 — les listes fermées ne chargent jamais le side cart.
      // Le bouton porte déjà disabled (renderCreatedSection/renderSavedSection),
      // mais ce guard couvre le cas d'un statut modifié après le rendu.
      if (btn.dataset.status && btn.dataset.status !== 'open') return;

      btn.disabled = true;
      try {
        // GAP-01 — basculer vers la Boutique AVANT d'activer le contexte
        // de liste. Import dynamique pour éviter le cycle
        // b-tracking.js → b-nav.js → b-tracking.js.
        const { switchView, activateNavTab } = await import('./b-nav.js');
        activateNavTab('shop');
        switchView('shop');
        const { activateFromParticipantUrl } = await import('./group/group-side-cart.js');
        await activateFromParticipantUrl(token);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

// wireLibraryCloseButtons retiré — É6 (2026-08).
// Fermer est canoniquement dans le slot partagé du side-cart.

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
  // wireLibraryCloseButtons retiré — É6 (2026-08).
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

function renderListsAuthRequired(el) {
  el.innerHTML =
    '<div class="k-track-error k-track-auth-required">' +
      '<div class="k-track-error-icon">📲</div>' +
      '<div class="k-track-error-title">Confirmez votre WhatsApp</div>' +
      '<div class="k-track-error-sub">Identifiez-vous pour retrouver les listes créées ou enregistrées avec ce numéro.</div>' +
      '<button class="k-track-retry-btn" id="k-track-lists-auth-btn">Continuer</button>' +
    '</div>';

  el.querySelector('#k-track-lists-auth-btn')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    const identity = await requireIdentity({
      reason: 'retrouver vos listes partagées',
      title: 'Accéder à Mes Partages',
    });
    if (identity) await renderListsTab(el);
    else button.disabled = false;
  });
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
    // Ne déclenche pas l'API métier des listes tant que la session client
    // n'est pas établie. L'anonyme obtient ainsi un état d'identification
    // explicite, sans faux message réseau ni requête partages vouée à 401.
    const identity = await restoreIdentity();
    if (!identity) {
      renderListsAuthRequired(el);
      return;
    }
    const library = await getSharedCartLibrary();
    state.libraryContext = {
      created: Array.isArray(library.created) ? library.created : [],
      saved:   Array.isArray(library.saved)   ? library.saved   : [],
    };
    renderLibrarySections(el);
  } catch (err) {
    console.warn('[tracking] renderListsTab:', err);
    if (err && (err.status === 401 || err.status === 403)) renderListsAuthRequired(el);
    else renderListsError(el, err);
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
      <div class="k-secondary-page-head">
        <div class="k-secondary-page-copy">
          <span class="k-secondary-page-eyebrow">Après votre achat</span>
          <h2>📦 Suivi de commande</h2>
          <p>Retrouvez une commande avec sa référence, ou identifiez-vous pour consulter tout votre historique.</p>
        </div>
        <div class="k-secondary-page-visual" aria-hidden="true">↗</div>
      </div>
      <section class="k-track-orders-panel k-secondary-page-panel">
        <h3>Retrouver une commande</h3>

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
              ${phoneBlockHTML('k-otp-country', 'k-otp-phone', DEFAULT_IDENTITY_PHONE_CODE)}
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

  buildPhoneSelect('k-otp-country', 'k-otp-phone', DEFAULT_IDENTITY_PHONE_CODE, null);
  const otpSel = el.querySelector('#k-otp-country');
  if (otpSel) otpSel.className = 'k-track-country';
  const otpInput = el.querySelector('#k-otp-phone');
  if (otpInput) otpInput.className = 'k-track-input k-track-input--phone';

  function getFullPhone() {
    const code = el.querySelector('#k-otp-country')?.value || DEFAULT_IDENTITY_PHONE_CODE;
    const raw  = el.querySelector('#k-otp-phone')?.value || '';
    return buildE164(code, raw);
  }

  function isPhoneValid() {
    const code = el.querySelector('#k-otp-country')?.value || DEFAULT_IDENTITY_PHONE_CODE;
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
