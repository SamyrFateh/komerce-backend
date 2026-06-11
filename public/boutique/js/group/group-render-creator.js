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
} from './group-helpers.js';

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
              <span>${fmt(total, 'KMF')} · ${sanitize(statusLabel(c.status, sOpen).replace(/^../, '').trim())}</span>
            </button>`;
        }).join('')}
      </div>
    </div>`;
}

/* ── Colonne articles (aside droit desktop) ─────────────────────── */

/**
 * Rendu du panneau latéral d'articles du panier (colonne droite cockpit).
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
    <aside class="k-group-side-panel">
      <div class="k-group-side-card">
        <div class="k-group-side-head">
          <strong>Articles du panier</strong>
          <span>${count} article${count > 1 ? 's' : ''}</span>
        </div>
        <div class="k-group-side-list">
          ${rows || '<p class="k-group-side-empty">Aucun article à afficher.</p>'}
        </div>
        <div class="k-group-side-total">
          <span>Total panier</span>
          <strong>${fmt(total, 'KMF')}</strong>
        </div>
      </div>
    </aside>`;
}

/* ── Carte de progression (engagements / paiements) ─────────────── */

/**
 * Rendu de la carte de progression du panier partagé.
 * Affiche barre double lecture, liste engagements/contributions, récap règlement.
 * @param {object} cart
 * @param {Array}  contributions
 * @param {Array}  commitmentsList
 * @returns {string}
 */
export function renderProgress(cart, contributions, commitmentsList) {
  const sOpen     = isSettlementOpen(cart);
  const total     = r(cart.total_kmf_snapshot);
  const confirmed = r(cart.contributed_kmf);
  const remaining = remainingKmf(cart);
  const meta      = metaOf(cart);

  // Barre double lecture
  const pPaid = pct(confirmed, total);
  const eng   = engagementCoverage(commitmentsList, total);
  const isOverCovered = eng.pctRaw > 100;

  const overBadge = isOverCovered
    ? `<span class="k-group-progress-badge k-group-progress-badge--over"
          aria-label="${eng.pctRaw}% engagé — sur-couvert">${eng.pctRaw}\u00a0% engagé</span>`
    : '';

  const legendPaid    = `<span class="k-group-progress-legend-paid">● payé&nbsp;: ${fmt(confirmed, 'KMF')}</span>`;
  const legendEngaged = eng.engagementsTotal > 0
    ? `<span class="k-group-progress-legend-engaged">● engagé&nbsp;: ${fmt(eng.engagementsTotal, 'KMF')}</span>`
    : '';
  const legendTotal   = `<span class="k-group-progress-legend-total">total&nbsp;: ${fmt(total, 'KMF')}</span>`;

  const settlementSummary = sOpen ? `
    <div class="k-group-settlement-summary">
      <strong>Panier en règlement 🔐</strong>
      ${meta.locked_commitments_count > 0
        ? `<span>${meta.locked_commitments_count} engagement(s) verrouillé(s) · total indicatif : ${fmt(r(meta.locked_commitments_total_kmf), 'KMF')}</span>`
        : ''}
    </div>` : '';

  // Participations compactes (LOT 5)
  let commitmentRows = '';
  if (commitmentsList?.length) {
    const label = sOpen ? 'Participations verrouillées' : 'Participations indicatives';
    commitmentRows = `
      <details class="k-group-accordion">
        <summary>Voir les participations (${commitmentsList.length})</summary>
        <div class="k-group-commitment-list">
          ${commitmentsList.map(c => {
            const paid = contributions?.some(co =>
              co.commitment_id === c.id && co.status === 'paid'
            );
            const statusTag = paid
              ? '<span class="k-group-commitment-status">✅ Payé</span>'
              : sOpen
                ? '<span class="k-group-commitment-status">⏳ En attente</span>'
                : '<span class="k-group-commitment-status" style="color:var(--text-muted)">indicatif</span>';
            return `
              <div class="k-group-commitment-row">
                <span class="k-group-commitment-name">${sanitize(c.participant_name?.split(' ')[0] || 'Participant')}</span>
                <span class="k-group-commitment-amount">${fmt(r(c.amount_kmf), 'KMF')}</span>
                ${c.message ? `<span class="k-group-commitment-msg" title="${sanitize(c.message)}">💬 ${sanitize(c.message)}</span>` : ''}
                ${statusTag}
              </div>`;
          }).join('')}
        </div>
      </details>`;
  } else {
    commitmentRows = `<p class="k-group-contrib-empty">${
      sOpen ? 'Aucun engagement verrouillé.' : 'Aucun engagement encore — partagez le lien !'
    }</p>`;
  }

  return `
    <div class="k-group-progress-card" id="k-group-progress-card">
      <div class="k-group-card-head">
        <div>
          <div class="k-group-card-title">${sanitize(cart.title || 'Panier groupe')}</div>
          <div class="k-group-card-meta">${statusLabel(cart.status, sOpen)}</div>
        </div>
      </div>
      ${settlementSummary}
      <div class="k-group-progress-wrap">
        ${overBadge}
        <div class="k-group-progress"
             aria-label="Payé ${pPaid}% · Engagé ${eng.pctCapped}%"
             role="group">
          ${eng.pctCapped > 0
            ? `<span class="k-group-progress-bar k-group-progress-bar--engaged"
                     style="width:${eng.pctCapped}%"
                     aria-label="Engagé ${eng.pctCapped}%"></span>`
            : ''}
          <span class="k-group-progress-bar k-group-progress-bar--paid"
                style="width:${pPaid}%"
                aria-label="Payé ${pPaid}%"></span>
        </div>
        <div class="k-group-progress-legend" aria-hidden="true">
          ${legendPaid}
          ${legendEngaged}
          ${legendTotal}
        </div>
      </div>
      ${remaining > 0 && sOpen
        ? `<p class="k-group-remaining">Reste à payer : <strong>${fmt(remaining, 'KMF')}</strong></p>`
        : ''}
      <div class="k-group-contribs">
        ${commitmentRows}
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
        <div class="k-group-step-label">Commande créée</div>
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
        <div class="k-group-step-label">Étape 3/3 — Confirmer</div>
        ${expirationHtml}
        <div class="k-group-creator-actions" style="margin-top:10px">
          <button class="k-group-btn k-group-btn--ghost" id="k-group-reshare">📲 WhatsApp</button>
          <button class="k-group-btn k-group-btn--copy" id="k-group-copy">🔗 Copier</button>
        </div>
        ${noRelayWarning}
        ${confirmBlock}
        <p class="k-group-input-error" id="k-group-finalize-err"></p>
        ${_cancelBtn()}
      </div>`;
  }

  /* ── Phase SHARE_AND_LOCK (panier ouvert) ───────────────────────── */
  // LOT 4 — PAS de formulaire d'engagement ni d'action de contribution créateur ici
  // LOT 8 — PAS de bouton Confirmer la commande dans cette phase

  return `
    <div class="k-group-card k-group-actions-card">

      <!-- Étape 1 : Partager -->
      <div class="k-group-step-label">Étape 1/3 — Partager</div>
      <p class="k-group-share-hint">
        Envoyez le lien aux proches. Ils indiquent combien ils veulent participer.
      </p>
      <div class="k-group-creator-actions">
        <button class="k-group-btn k-group-btn--ghost" id="k-group-reshare">📲 WhatsApp</button>
        <button class="k-group-btn k-group-btn--copy" id="k-group-copy">🔗 Copier</button>
      </div>

      <!-- Étape 2 : Bloquer -->
      <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border)">
        <div class="k-group-step-label">Étape 2/3 — Bloquer</div>
        <p class="k-group-share-hint">
          Les montants seront figés. Les participants pourront ensuite payer.
        </p>
        <label style="font-size:12px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:6px">
          Délai de paiement
        </label>
        <select id="k-group-settlement-window"
          style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:10px;font-size:14px;font-family:var(--font);margin-bottom:10px">
          <option value="24">24 heures</option>
          <option value="48" selected>48 heures (défaut)</option>
          <option value="168">7 jours</option>
        </select>
        <button class="k-group-btn k-group-btn--primary" id="k-group-open-settlement">
          🔐 Bloquer et ouvrir le paiement
        </button>
        <p class="k-group-share-hint" style="margin-top:6px">
          Fige les engagements et ouvre les paiements. Action irréversible.
        </p>
      </div>

      <p class="k-group-input-error" id="k-group-settlement-err"></p>

      <!-- LOT 5 — Accordéon options -->
      ${_optionsAccordion()}

      ${_cancelBtn()}
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

function _cancelBtn() {
  return `
    <div class="k-group-options-danger" style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
      <button class="k-group-btn k-group-btn--ghost k-group-btn--danger" id="k-group-cancel">
        🗑 Annuler ce panier
      </button>
    </div>`;
}

function _optionsAccordion() {
  return `
    <details class="k-group-accordion" style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
      <summary>Options</summary>
      <div style="padding:10px 0 4px">
        <button class="k-group-btn k-group-btn--ghost" id="k-group-edit-items" style="width:100%;margin-bottom:8px">
          ✏️ Modifier les articles
        </button>
      </div>
    </details>`;
}
