/**
 * @module group/group-render-creator.js
 * @owner group refactor — rendus HTML stateless du cockpit créateur
 *
 * Toutes les fonctions ici sont PURES côté effets de bord :
 *   - elles reçoivent des données en paramètre
 *   - elles retournent des chaînes HTML
 *   - elles ne lisent pas state, ne font pas de fetch, ne touchent pas le DOM
 *
 * Le binding des événements reste dans group-actions.js ou b-group-view.js.
 *
 * LOT 3.3 — Carte compacte 3 étapes (SHARE_AND_LOCK / CONFIRM / ORDER_CREATED)
 * LOT 4   — Contribution créateur supprimée en phase ouverte
 * LOT 5   — Accordéons détails (participations, articles, options)
 * LOT 7   — Wording normalisé
 * LOT 8   — Garde-fous front
 */

import { sanitize, fmt } from '../b-utils.js';
import { sortOwnerCarts, isVisibleOwnerCart } from './group-state.js';
import {
  r,
  pct,
  engagementCoverage,
  statusLabel,
  metaOf,
  isSettlementOpen,
  remainingKmf,
  settlementExpiresAt,
  timeRemaining,
  getGroupStep,
  businessStatusOf,
  BUSINESS,
} from './group-helpers.js';

/* ── GAP-B / Phase D — bloc "Lien personnalisé" ──────────────────
 * Formulaire optionnel (prénom + montant) inséré sous la rangée de
 * partage. Purement présentationnel — le binding vit dans
 * b-group-view.js (bindPersonalizeForm).
 */
function renderPersonalizeBlock() {
  return `
    <details class="k-group-accordion k-gc-personalize-acc">
      <summary><span>🔗 Lien personnalisé pour un participant</span></summary>
      <div class="k-gc-personalize-body">
        <div class="k-group-field">
          <input id="k-gc-pz-name" class="k-group-input" type="text" maxlength="40"
            placeholder="Prénom (ex : Ali)" autocomplete="off">
        </div>
        <div class="k-group-field">
          <input id="k-gc-pz-amount" class="k-group-input" type="number" min="0" step="100"
            placeholder="Montant suggéré (KMF, facultatif)" inputmode="numeric">
        </div>
        <div class="k-gc-share-row">
          <button class="k-group-btn k-group-btn--ghost" id="k-gc-pz-whatsapp">📲 Envoyer à Ali</button>
          <button class="k-group-btn k-group-btn--copy" id="k-gc-pz-copy">🔗 Copier le lien</button>
        </div>
        <p class="k-gc-note">Le participant verra son prénom et le montant suggéré — modifiable.</p>
      </div>
    </details>`;
}

/* ── Switcher multi-paniers ─────────────────────────────────────── */

/**
 * Rendu du switcher de paniers créateur (affiché seulement si ≥2 paniers visibles).
 * @param {Array}         carts       liste de tous les paniers créateur
 * @param {string|number} selectedId  id du panier actuellement affiché
 * @returns {string}  HTML vide si ≤1 panier visible
 */
export function renderCreatorCartSwitcher(carts = [], selectedId) {
  const visible = sortOwnerCarts(carts).filter(isVisibleOwnerCart);
  if (visible.length <= 1) return '';

  return `
    <div class="k-group-cart-switcher" aria-label="Mes paniers groupe">
      <div class="k-group-cart-switcher-head">
        <strong>Mes paniers groupe</strong>
        <span>${visible.length} actifs</span>
      </div>
      <div class="k-group-cart-tabs">
        ${visible.map(c => {
          const active = String(c.id) === String(selectedId);
          const total  = r(c.total_kmf_snapshot);
          const label  = c.title || 'Panier groupe';
          const sOpen  = isSettlementOpen(c);
          return `
            <button
              type="button"
              class="k-group-cart-tab ${active ? 'is-active' : ''}"
              data-k-group-cart-id="${sanitize(String(c.id))}">
              <strong>${sanitize(label)}</strong>
              <span>${fmt(total, 'KMF')} · ${sanitize(statusLabel(c.status, sOpen).trim())}</span>
            </button>`;
        }).join('')}
      </div>
    </div>`;
}

/* ── Colonne articles (aside droit desktop) ─────────────────────── */

/**
 * Attribut `open` des accordéons : ouverts par défaut sur desktop (≥900px),
 * repliés sur mobile pour condenser (direction mockup UX V4).
 * @returns {string} ' open' ou ''
 */
function _accOpenAttr() {
  return (typeof window !== 'undefined' &&
          window.matchMedia &&
          window.matchMedia('(min-width: 900px)').matches) ? ' open' : '';
}

/**
 * Carte identité du panier côté CRÉATEUR — eyebrow, titre, "Organisé pour",
 * ligne méta (total · statut · n articles). Direction mockup UX V4.
 * @param {object} cart
 * @param {number} [itemsCount=0]
 * @returns {string}
 */
export function renderOwnerIdentityCard(cart, itemsCount = 0) {
  const title = sanitize(cart.title || 'Panier groupe');
  const total = r(cart.total_kmf_snapshot);
  const sOpen = isSettlementOpen(cart);

  // Vue CRÉATEUR : on affiche uniquement le NOM du panier (le motif saisi
  // à la création, ex. « Mariage pour Aicha »). Le bénéficiaire reste stocké
  // côté backend (beneficiary_name_snapshot) et reste affiché côté participant.
  return `
    <div class="k-group-card k-group-owner-id">
      <div class="k-group-owner-eyebrow">👥 Panier groupe</div>
      <h2 class="k-group-owner-title">${title}</h2>
      <div class="k-group-owner-meta">
        <strong>${fmt(total, 'KMF')}</strong>
        <span class="k-group-owner-sep">·</span>
        <span class="k-group-owner-status">${statusLabel(cart.status, sOpen)}</span>
        <span class="k-group-owner-sep">·</span>
        <span>${itemsCount} article${itemsCount > 1 ? 's' : ''}</span>
      </div>
    </div>`;
}

/**
 * Rendu du panneau latéral d'articles du panier (colonne droite cockpit).
 * Condensé en accordéon style checkout : replié sur mobile, ouvert sur desktop.
 * @param {Array}  [items=[]]  articles du panier (format snapshot ou state.cart)
 * @param {object} [cart={}]   panier partagé (pour total_kmf_snapshot)
 * @returns {string}
 */
export function renderCreatorArticlesPanel(items = [], cart = {}) {
  const safeItems = Array.isArray(items) ? items : [];
  const rows = safeItems.slice(0, 8).map(it => {
    const name  = it.product_name || it.name || it.product?.name || 'Produit';
    const qty   = Number(it.quantity || it.qty || 1);
    const price = Number(it.unit_price_kmf || it.price_kmf || it.price || it.product?.price_kmf || 0);
    const img   = it.product_image || it.product_image_url || it.image_url || it.image || it.product?.image_url || '';

    return `
      <div class="k-group-side-item">
        ${img ? `<img src="${sanitize(img)}" alt="">` : '<div class="k-group-side-item-fallback">📦</div>'}
        <div class="k-group-side-item-main">
          <strong>${sanitize(name)}</strong>
          <span>×${qty} · ${fmt(r(price), 'KMF')}</span>
        </div>
      </div>`;
  }).join('');

  const count = safeItems.length;
  const total = r(cart.total_kmf_snapshot || 0);

  return `
    <div class="k-group-side-panel">
      <div class="k-group-side-card">
        <details class="k-group-accordion k-group-accordion--flush"${_accOpenAttr()}>
          <summary>
            <span>🛒 ${count} article${count > 1 ? 's' : ''}</span>
            <span class="k-group-acc-meta">${fmt(total, 'KMF')}</span>
          </summary>
          <div class="k-group-side-list">
            ${rows || '<p class="k-group-side-empty">Aucun article à afficher.</p>'}
          </div>
          <div class="k-group-side-total">
            <span>Total panier</span>
            <strong>${fmt(total, 'KMF')}</strong>
          </div>
        </details>
      </div>
    </div>`;
}

/* ── Carte identité créateur (panneau droit vue participant) ────── */

/**
 * Carte identité du créateur — avatar initiales + nom + numéro WhatsApp.
 * Affichée en haut du panneau "Votre participation" côté participant.
 * @param {object} cart  panier partagé (champs owner_name, owner_phone)
 * @returns {string}
 */
export function renderCreatorIdentityCard(cart) {
  const name  = sanitize(cart.owner_name || cart.creator_name || 'Créateur');
  const phone = sanitize(cart.owner_phone || cart.creator_phone || '');
  const initials = name.split(' ').map(w => w[0] || '').slice(0, 2).join('').toUpperCase() || '?';

  return `
    <div class="k-group-creator-id">
      <div class="k-group-creator-id-avatar">${initials}</div>
      <div class="k-group-creator-id-info">
        <strong>${name}</strong>
        ${phone ? `<span class="k-group-creator-id-phone">📱 ${phone}</span>` : ''}
      </div>
    </div>`;
}

/* ── Récap financier créateur (remplace le header verbeux) ───────── */

/**
 * Récap financier compact : total · engagements · payé · reste.
 * Barre de progression double lecture intégrée.
 * @param {object} cart
 * @param {Array}  commitmentsList
 * @returns {string}
 */
export function renderCreatorFinancialSummary(cart, estimationsList = []) {
  const total     = r(cart.total_kmf_snapshot);
  const confirmed = r(cart.contributed_kmf);
  const remaining = remainingKmf(cart);
  const eng       = engagementCoverage(estimationsList, total);
  const pPaid     = pct(confirmed, total);

  const stats = [
    { label: 'Total panier', value: fmt(total, 'KMF') },
    { label: 'Estimé',       value: fmt(eng.engagementsTotal, 'KMF') },
    { label: 'Payé',         value: fmt(confirmed, 'KMF') },
    ...(remaining > 0 ? [{ label: 'Reste', value: fmt(remaining, 'KMF'), highlight: true }] : []),
  ];

  return `
    <div class="k-group-financial-summary" id="k-group-financial-summary">
      <div class="k-group-financial-stats">
        ${stats.map(s => `
          <div class="k-group-financial-stat${s.highlight ? ' is-highlight' : ''}">
            <strong>${s.value}</strong>
            <span>${s.label}</span>
          </div>`).join('')}
      </div>
      <div class="k-group-progress" role="group"
           aria-label="Payé ${pPaid}% · Estimé ${eng.pctCapped}%">
        ${eng.pctCapped > 0
          ? `<span class="k-group-progress-bar k-group-progress-bar--engaged"
                   style="width:${eng.pctCapped}%"></span>`
          : ''}
        <span class="k-group-progress-bar k-group-progress-bar--paid"
              style="width:${pPaid}%"></span>
      </div>
      <div class="k-group-progress-legend" aria-hidden="true">
        <span class="k-group-progress-legend-paid">● payé : ${fmt(confirmed, 'KMF')}</span>
        ${eng.engagementsTotal > 0
          ? `<span class="k-group-progress-legend-engaged">● estimé : ${fmt(eng.engagementsTotal, 'KMF')}</span>`
          : ''}
        <span class="k-group-progress-legend-total">total : ${fmt(total, 'KMF')}</span>
      </div>
    </div>`;
}

/* ── Carte de progression (engagements / paiements) ─────────────── */

/**
 * Carte Participants (direction mockup UX V4) — avatars initiales, montants,
 * statuts, accordéon condensé style checkout. La barre de progression vit
 * désormais UNIQUEMENT dans renderCreatorFinancialSummary (zéro duplication).
 * @param {object} cart
 * @param {Array}  contributions
 * @param {Array}  commitmentsList
 * @returns {string}
 */
export function renderProgress(cart, contributions, estimationsList) {
  const total     = r(cart.total_kmf_snapshot);
  const remaining = remainingKmf(cart);
  const meta      = metaOf(cart);
  const biz       = businessStatusOf(cart);
  const isPayment = biz === BUSINESS.CLOSED;
  const eng       = engagementCoverage(estimationsList, total);

  const paymentSummary = isPayment ? `
    <div class="k-group-settlement-summary">
      <strong>💳 Paiement ouvert</strong>
      ${cart.payment_window_ends_at
        ? `<span>Fenêtre : ${timeRemaining(new Date(cart.payment_window_ends_at)) || 'en cours'}</span>`
        : ''}
    </div>` : '';

  /* ── Lignes participants (estimations nominatives, cockpit créateur) ── */
  let body;
  if (estimationsList?.length) {
    const rows = estimationsList.map(c => {
      const paid = contributions?.some(co =>
        co.contributor_phone === c.participant_phone && co.status === 'paid'
      );
      const fullName = c.participant_name || 'Participant';
      const firstName = fullName.split(' ')[0];
      const initials = fullName.split(' ').map(w => w[0] || '').slice(0, 2).join('').toUpperCase() || '?';
      const hue = ((fullName.charCodeAt(0) || 65) % 5) + 1;
      const phone = c.participant_phone || '';
      const maskedPhone = phone.length > 4
        ? phone.slice(0, -4).replace(/\d/g, '•') + phone.slice(-4)
        : phone;
      const statusTag = paid
        ? '<span class="k-group-commitment-status k-group-commitment-status--paid">✅ Payé</span>'
        : '<span class="k-group-commitment-status">indicatif</span>';
      return `
        <div class="k-group-commitment-row">
          <span class="k-group-commitment-avatar k-group-commitment-avatar--h${hue}" aria-hidden="true">${sanitize(initials)}</span>
          <div class="k-group-commitment-left">
            <span class="k-group-commitment-name">${sanitize(firstName)}</span>
            ${maskedPhone ? `<span class="k-group-commitment-phone">${sanitize(maskedPhone)}</span>` : ''}
          </div>
          <div class="k-group-commitment-right">
            <span class="k-group-commitment-amount">${fmt(r(c.amount_kmf), 'KMF')}</span>
            ${statusTag}
          </div>
        </div>`;
    }).join('');

    body = `
      <details class="k-group-accordion k-group-accordion--flush"${_accOpenAttr()}>
        <summary>
          <span>Estimations reçues (${estimationsList.length})</span>
          <span class="k-group-acc-meta">${fmt(eng.engagementsTotal, 'KMF')} estimés</span>
        </summary>
        <div class="k-group-commitment-list">${rows}</div>
      </details>`;
  } else {
    body = `<p class="k-group-contrib-empty">Aucune estimation encore — partagez le lien !</p>`;
  }

  return `
    <div class="k-group-side-panel k-group-side-panel--participants" id="k-group-progress-card">
      <div class="k-group-side-card k-group-progress-card">
        ${paymentSummary}
        ${body}
        ${remaining > 0 && isPayment
          ? `<p class="k-group-remaining">Reste à payer : <strong>${fmt(remaining, 'KMF')}</strong></p>`
          : ''}
      </div>
    </div>`;
}

/* ── Carte d'actions créateur (LOT 3.3 / LOT 4 / LOT 7 / LOT 8) ── */

/**
 * Rendu de la carte d'actions du créateur — 3 étapes compactes.
 *
 * Étapes :
 *   SHARE_AND_LOCK  → Étape 1 (Partager) + Étape 2 (Bloquer)
 *   CONFIRM         → Étape 3 (Confirmer la commande)
 *   ORDER_CREATED   → Commande créée
 *
 * LOT 4 — le créateur ne voit JAMAIS le formulaire d'engagement en phase ouverte.
 * LOT 7 — wording normalisé (libellés autorisés uniquement, cf. brief V4).
 * LOT 8 — garde-fous : pas de bouton Confirmer en phase SHARE_AND_LOCK,
 *          mention relais si absent, état terminal sans action si annulé/expiré.
 *
 * @param {object} cart            panier partagé
 * @param {object} [opts={}]
 * @param {string} [opts.relayId]  delivery_relay_id courant (pour garde-fou LOT 8)
 * @returns {string}
 */
/**
 * V4.1 — Carte unifiée du cockpit créateur (remplace 4 cards séparées).
 * Conforme au mockup validé : une seule carte compacte avec badge, titre,
 * items, estimations, agrégat, bouton d'action, note.
 */
export function renderCreatorUnifiedCard(cart, estimationsList = [], contributions = [], items = [], shareUrl = '') {
  const biz   = businessStatusOf(cart);
  const total = r(cart.total_kmf_snapshot);
  const contributed = r(cart.contributed_kmf);
  const remaining   = remainingKmf(cart);
  const eng   = engagementCoverage(estimationsList, total);
  const title = sanitize(cart.title || 'Panier groupe');
  const itemsCount = items.length;

  const targetDate = cart.target_date
    ? new Date(cart.target_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
    : null;
  const countdownRemaining = cart.payment_window_ends_at
    ? timeRemaining(new Date(cart.payment_window_ends_at)) : null;
  const awaitingDeadline = cart.awaiting_choice_deadline
    ? timeRemaining(new Date(cart.awaiting_choice_deadline)) : null;

  /* ── Badge + info droite ─────────────────────────────────────── */
  let badge, rightInfo = '';
  if (biz === BUSINESS.OPEN) {
    badge = '<span class="k-group-phase-badge k-group-phase-badge--open">Panier ouvert</span>';
    if (targetDate) rightInfo = `<span class="k-group-header-right">fermeture auto : ${targetDate}</span>`;
  } else if (biz === BUSINESS.CLOSED) {
    badge = '<span class="k-group-phase-badge k-group-phase-badge--settlement">💳 Paiement ouvert</span>';
    if (countdownRemaining) rightInfo = `<span class="k-group-header-right k-group-header-right--urgent">⏱ ${countdownRemaining}</span>`;
  } else if (biz === BUSINESS.AWAITING_CHOICE) {
    badge = '<span class="k-group-phase-badge k-group-phase-badge--awaiting">À vous de choisir</span>';
    rightInfo = `<span class="k-group-header-right k-group-header-right--urgent">⏱ ${awaitingDeadline || '72 h pour décider'}</span>`;
  } else if (biz === BUSINESS.ORDERED) {
    badge = '<span class="k-group-phase-badge k-group-phase-badge--done">📦 Commande créée</span>';
  } else {
    badge = `<span class="k-group-phase-badge">${statusLabel(cart.status, false)}</span>`;
  }

  /* ── Estimations liste (OPEN, visibles créateur seul) ────────── */
  let estimationsBlock = '';
  if (biz === BUSINESS.OPEN) {
    if (estimationsList.length > 0) {
      const rows = estimationsList.map(e => {
        const name = sanitize((e.participant_name || 'Anonyme').split(' ')[0]);
        const isAnon = !e.participant_phone;
        return `<div class="k-gc-est-row${isAnon ? ' k-gc-est-row--anon' : ''}">
          <span>${name}</span><span>${fmt(r(e.amount_kmf), 'KMF')}</span>
        </div>`;
      }).join('');
      const pctEst = total > 0 ? Math.round(eng.engagementsTotal / total * 100) : 0;
      estimationsBlock = `
        <p class="k-gc-sec-label">Estimations reçues — visibles par vous seul</p>
        <div class="k-gc-est-list">${rows}</div>
        <div class="k-gc-est-agg">~${fmt(eng.engagementsTotal, 'KMF')} estimés sur ${fmt(total, 'KMF')} · ${pctEst} %</div>`;
    } else {
      estimationsBlock = `<p class="k-gc-empty">Aucune estimation encore — partagez le lien !</p>`;
    }
  }

  /* ── Barre de financement (CLOSED / AWAITING_CHOICE) ─────────── */
  let fundingBlock = '';
  if (biz === BUSINESS.CLOSED || biz === BUSINESS.AWAITING_CHOICE) {
    const pctFunded = total > 0 ? Math.min(100, Math.round(contributed / total * 100)) : 0;
    const isAwaiting = biz === BUSINESS.AWAITING_CHOICE;
    const label = isAwaiting ? 'Reçu' : 'Financé';
    const restant = remaining > 0
      ? `<strong>${fmt(remaining, 'KMF')} restants</strong>`
      : `<strong style="color:var(--checkout-accent)">Entièrement financé ✓</strong>`;
    fundingBlock = `
      <div class="k-gc-fund">
        <div class="k-gc-fund-labels">
          <span>${label}</span>
          <span class="k-gc-fund-val"><span class="k-gc-fund-val-accent">${fmt(contributed, 'KMF')}</span> / ${fmt(total, 'KMF')}</span>
        </div>
        <div class="k-gc-fund-track"><div class="k-gc-fund-fill" style="width:${pctFunded}%${isAwaiting ? ';background:var(--amber-border)' : ''}"></div></div>
        <div class="k-gc-fund-foot">
          <span>${pctFunded} % collecté</span>
          ${restant}
        </div>
      </div>
      <div class="k-gc-stats">
        <div class="k-gc-stat k-gc-stat--coral">
          <strong>${fmt(remaining, 'KMF')}</strong>
          <span>Reste à collecter</span>
        </div>
        <div class="k-gc-stat">
          <strong>${fmt(total, 'KMF')}</strong>
          <span>Total panier</span>
        </div>
      </div>`;
  }

  /* ── Actions (OPEN / CLOSED / AWAITING_CHOICE) ───────────────── */
  let actionsBlock = '';
  if (biz === BUSINESS.OPEN) {
    actionsBlock = `
      <button class="k-gc-btn-main" id="k-group-close-cart">📤 Partager le panier</button>
      <p class="k-gc-note">La liste devient définitive · WhatsApp prévient le groupe</p>
      <p class="k-group-input-error" id="k-group-settlement-err"></p>`;
  } else if (biz === BUSINESS.CLOSED) {
    if (remaining <= 0) {
      actionsBlock = `
        <button class="k-gc-btn-finalize" id="k-group-finalize">Confirmer la commande</button>
        <p class="k-gc-note">La commande partira en préparation.</p>
        <p class="k-group-input-error" id="k-group-finalize-err"></p>`;
    } else {
      actionsBlock = `
        <div class="k-gc-share-row">
          <button class="k-group-btn k-group-btn--ghost" id="k-group-reshare">📲 WhatsApp</button>
          <button class="k-group-btn k-group-btn--copy" id="k-group-copy">🔗 Copier</button>
        </div>
        <p class="k-gc-note">Partagez le lien — les participants peuvent payer maintenant</p>
        ${renderPersonalizeBlock()}`;
    }
  } else if (biz === BUSINESS.AWAITING_CHOICE) {
    actionsBlock = `
      <button class="k-gc-btn-choice k-gc-btn-choice--complete" id="k-group-finalize-gap">
        <strong>Compléter les ${fmt(remaining, 'KMF')}</strong>
        <small>Je paie le reste, la commande part</small>
      </button>
      <button class="k-gc-btn-choice" id="k-group-edit-items">
        <strong>Ajuster le panier</strong>
        <small>Retirer des articles, nouvelle fenêtre 48 h</small>
      </button>
      <button class="k-gc-btn-choice k-gc-btn-choice--danger" id="k-group-cancel">
        <strong>Annuler le panier</strong>
        <small>Les participants sont remboursés</small>
      </button>
      <p class="k-group-input-error" id="k-group-finalize-err"></p>`;
  } else if (biz === BUSINESS.ORDERED) {
    actionsBlock = `<p class="k-gc-note">Le panier est terminé.</p>
      ${cart.finalized_order_id ? '<button class="k-group-btn k-group-btn--ghost" id="k-group-to-track">📦 Voir la commande</button>' : ''}`;
  } else {
    actionsBlock = `<p class="k-gc-note">${cart.status === 'cancelled' ? '❌ Panier annulé' : '⏱️ Panier expiré'}</p>`;
  }

  /* ── Items compacts (ligne cliquable) ────────────────────────── */
  const itemsRow = biz === BUSINESS.OPEN
    ? `<div class="k-gc-items-row">
        <span>${itemsCount} article${itemsCount > 1 ? 's' : ''} · <strong>${fmt(total, 'KMF')}</strong></span>
        <span class="k-gc-items-edit" id="k-group-edit-items-link">✏️ Modifier</span>
       </div>`
    : '';

  /* ── Sharing (OPEN) ──────────────────────────────────────────── */
  const shareBlock = biz === BUSINESS.OPEN ? `
    <div class="k-gc-share-row">
      <button class="k-group-btn k-group-btn--ghost" id="k-group-reshare">📲 WhatsApp</button>
      <button class="k-group-btn k-group-btn--copy" id="k-group-copy">🔗 Copier le lien</button>
    </div>
    ${renderPersonalizeBlock()}` : '';

  /* ── Options accordion (OPEN / CLOSED) ───────────────────────── */
  const optionsBlock = (biz === BUSINESS.OPEN || biz === BUSINESS.CLOSED) ? `
    <details class="k-group-accordion k-group-options-acc">
      <summary><span>Options</span></summary>
      <div class="k-group-options-body">
        ${biz === BUSINESS.OPEN ? '<button class="k-group-btn k-group-btn--ghost" id="k-group-edit-items">✏️ Modifier les articles</button>' : ''}
        <div class="k-group-options-danger">
          <button class="k-group-btn k-group-btn--ghost k-group-btn--danger" id="k-group-cancel">🗑 Annuler ce panier</button>
        </div>
      </div>
    </details>` : '';

  return `
    <div class="k-group-card k-gc-unified" id="k-group-unified-card">
      <div class="k-gc-header">
        <div class="k-gc-badge-row">${badge}${rightInfo}</div>
        <h2 class="k-group-header-title">${title}</h2>
        ${biz === BUSINESS.CLOSED || biz === BUSINESS.AWAITING_CHOICE
          ? `<p class="k-group-subhead">${biz === BUSINESS.AWAITING_CHOICE ? 'la fenêtre de paiement est terminée' : 'la liste est figée · chacun paie sa part'}</p>`
          : ''}\n      </div>
      ${itemsRow}
      ${estimationsBlock}
      ${fundingBlock}
      <div class="k-gc-body">
        ${shareBlock}
        ${actionsBlock}
        ${optionsBlock}
      </div>
    </div>`;
}

export function renderCreatorActions(cart, opts = {}) {
  const step      = getGroupStep(cart);
  const remaining = remainingKmf(cart);
  const fullyPaid = remaining <= 0;

  /* ── LOT 8 : état terminal annulé / expiré ─────────────────────── */
  if (['cancelled', 'expired'].includes(cart.status)) {
    const label = cart.status === 'cancelled' ? '❌ Panier annulé' : '⏱️ Panier expiré';
    return `
      <div class="k-group-card k-group-actions-card">
        <p class="k-group-finalized-hint">${label}</p>
      </div>`;
  }

  /* ── Phase ORDER_CREATED ────────────────────────────────────────── */
  if (step === 'ORDER_CREATED') {
    return `
      <div class="k-group-card k-group-actions-card">
        ${_phaseBadge('ORDER_CREATED')}
        <p class="k-group-finalized-hint">Le panier est terminé.</p>
        ${cart.finalized_order_id
          ? `<button class="k-group-btn k-group-btn--ghost" id="k-group-to-track">📦 Voir la commande</button>`
          : ''}
      </div>`;
  }

  /* ── Phase CONFIRM (règlement ouvert) ───────────────────────────── */
  if (step === 'CONFIRM') {
    // LOT 8 — garde-fou relais
    const relayId = opts.relayId || cart.delivery_relay_id;
    const noRelayWarning = !relayId
      ? `<p class="k-group-warn">⚠️ Choisissez un relais de livraison avant de confirmer la commande.</p>`
      : '';

    // Expiration règlement
    const expAt   = settlementExpiresAt(cart);
    const expLeft = expAt ? timeRemaining(expAt) : null;
    const expSoon = expAt && (expAt - Date.now() < 6 * 3_600_000);
    const expirationHtml = expLeft ? `
      <p class="k-group-share-hint${expSoon ? ' is-exp-soon' : ''}" style="margin-top:6px">
        ⏱️ ${expLeft}
      </p>` : '';

    // Bouton confirmer / payer le reste
    let confirmBlock;
    if (fullyPaid) {
      confirmBlock = `
        <div class="k-group-funded-callout">
          <strong>✅ Tout est payé.</strong>
          <button class="k-group-btn k-group-btn--finalize" id="k-group-finalize"
            ${!relayId ? 'disabled' : ''}>
            Confirmer la commande
          </button>
          <p class="k-group-step-hint">La commande partira en préparation.</p>
        </div>`;
    } else {
      const gapFmt = fmt(remaining, 'KMF');
      confirmBlock = `
        <div class="k-group-funded-callout k-group-funded-callout--gap">
          <strong>Il reste ${gapFmt}.</strong>
          <div class="k-group-actions-row" style="margin-top:12px">
            <button class="k-group-btn k-group-btn--ghost" id="k-group-wait">
              Attendre
            </button>
            <button class="k-group-btn k-group-btn--finalize" id="k-group-finalize-gap"
              ${!relayId ? 'disabled' : ''}>
              Je paie le reste
            </button>
          </div>
          <p class="k-group-step-hint">Je paie le reste, puis la commande sera créée.</p>
        </div>`;
    }

    return `
      <div class="k-group-card k-group-actions-card">
        ${_phaseBadge('CONFIRM', fullyPaid)}
        ${expirationHtml}
        <div class="k-group-creator-actions" style="margin-bottom:14px">
          <button class="k-group-btn k-group-btn--ghost" id="k-group-reshare">📲 WhatsApp</button>
          <button class="k-group-btn k-group-btn--copy" id="k-group-copy">🔗 Copier</button>
        </div>
        ${noRelayWarning}
        ${confirmBlock}
        <p class="k-group-input-error" id="k-group-finalize-err"></p>
        ${_optionsAccordion('CONFIRM')}
      </div>`;
  }

  /* ── Phase SHARE_AND_LOCK (panier ouvert) ───────────────────────── */

  return `
    <div class="k-group-card k-group-actions-card">
      ${_phaseBadge('SHARE_AND_LOCK')}

      <!-- Partager le lien -->
      <p class="k-group-share-hint">
        Partagez le lien — vos proches indiquent leur participation, sans payer maintenant.
      </p>
      <div class="k-group-creator-actions">
        <button class="k-group-btn k-group-btn--ghost" id="k-group-reshare">📲 WhatsApp</button>
        <button class="k-group-btn k-group-btn--copy" id="k-group-copy">🔗 Copier le lien</button>
      </div>

      <!-- Partager le panier — V4.1 : plus de select, 48h fixe -->
      <div class="k-group-lock-section">
        <button class="k-group-btn k-group-btn--primary" id="k-group-close-cart">
          📤 Partager le panier
        </button>
        <p class="k-group-step-hint">La liste devient définitive · WhatsApp prévient le groupe</p>
      </div>

      <p class="k-group-input-error" id="k-group-settlement-err"></p>

      ${_optionsAccordion('SHARE_AND_LOCK')}
    </div>`;
}

/* ── LOT 5 — Accordéon articles ─────────────────────────────────── */

/**
 * Accordéon "Voir les articles" — inséré dans le rendu principal si nécessaire.
 * @param {Array} items
 * @returns {string}
 */
export function renderArticlesAccordion(items = []) {
  if (!items?.length) return '';
  const rows = items.map(it => {
    const name = it.product_name_snapshot || it.name || 'Produit';
    const qty  = r(it.quantity || 1);
    const price = r(it.unit_price_kmf_snapshot || it.unit_price_kmf || 0);
    return `<div class="k-group-commitment-row">
      <span class="k-group-commitment-name">${sanitize(name)}</span>
      <span class="k-group-commitment-amount">×${qty} · ${fmt(price, 'KMF')}</span>
    </div>`;
  }).join('');

  return `
    <details class="k-group-accordion">
      <summary>Voir les articles (${items.length})</summary>
      <div class="k-group-commitment-list">${rows}</div>
    </details>`;
}

/* ── Helpers internes ────────────────────────────────────────────── */

/**
 * Badge de phase en tête de la carte d'actions (direction mockup UX V4).
 * @param {string}  step      SHARE_AND_LOCK | CONFIRM | ORDER_CREATED
 * @param {boolean} fullyPaid
 * @returns {string}
 */
function _phaseBadge(step, fullyPaid = false) {
  if (step === 'ORDER_CREATED') {
    return '<span class="k-group-phase-badge k-group-phase-badge--done">📦 Commande créée</span>';
  }
  if (step === 'CONFIRM') {
    return fullyPaid
      ? '<span class="k-group-phase-badge k-group-phase-badge--paid">✅ Tout est payé</span>'
      : '<span class="k-group-phase-badge k-group-phase-badge--settlement">💳 Paiement ouvert</span>';
  }
  return '<span class="k-group-phase-badge k-group-phase-badge--open">Panier ouvert</span>';
}



function _optionsAccordion(step = 'SHARE_AND_LOCK') {
  // LOT 5 — Options contient uniquement : Modifier les articles / Annuler ce panier.
  // En phase CONFIRM les articles sont figés → seul Annuler reste.
  // Annuler = danger, visuellement séparé, jamais à côté de l'action principale.
  const editBtn = step === 'SHARE_AND_LOCK' ? `
        <button class="k-group-btn k-group-btn--ghost" id="k-group-edit-items">
          ✏️ Modifier les articles
        </button>` : '';

  return `
    <details class="k-group-accordion k-group-options-acc">
      <summary><span>Options</span></summary>
      <div class="k-group-options-body">
        ${editBtn}
        <div class="k-group-options-danger">
          <button class="k-group-btn k-group-btn--ghost k-group-btn--danger" id="k-group-cancel">
            🗑 Annuler ce panier
          </button>
        </div>
      </div>
    </details>`;
}
