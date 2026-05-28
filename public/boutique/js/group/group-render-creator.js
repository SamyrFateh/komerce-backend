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

/* ── Mini-guide créateur ────────────────────────────────────────── */

/**
 * Rendu du mini-guide 3 étapes affiché sous le header créateur.
 * @param {boolean} [settlementOpen=false]
 * @returns {string}
 */
export function renderCreatorMiniGuide(settlementOpen = false) {
  if (settlementOpen) {
    return `
      <div class="k-group-mini-guide">
        <span><b>1</b> Paiements ouverts</span>
        <span><b>2</b> Suivez les règlements</span>
        <span><b>3</b> Finalisez la commande</span>
      </div>`;
  }

  return `
    <div class="k-group-mini-guide">
      <span><b>1</b> Partagez le lien</span>
      <span><b>2</b> Les proches s'engagent</span>
      <span><b>3</b> Lancez le règlement</span>
    </div>`;
}

/* ── Colonne articles (aside droit desktop) ─────────────────────── */

/**
 * Rendu du panneau latéral d'articles du panier (colonne droite cockpit).
 * Affiche jusqu'à 8 articles avec image, nom, quantité, prix.
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
 * Affiche barre de progression, liste des engagements/contributions,
 * et récapitulatif règlement si ouvert.
 * @param {object} cart            panier partagé
 * @param {Array}  contributions   contributions payées (Stripe)
 * @param {Array}  commitmentsList engagements (indicatifs ou verrouillés)
 * @returns {string}
 */
export function renderProgress(cart, contributions, commitmentsList) {
  const sOpen     = isSettlementOpen(cart);
  const total     = r(cart.total_kmf_snapshot);
  const confirmed = r(cart.contributed_kmf);
  const remaining = remainingKmf(cart);
  const isOpen    = ['active', 'partially_funded', 'fully_funded'].includes(cart.status);
  const meta      = metaOf(cart);

  let commitmentRows = '';
  if (sOpen && commitmentsList?.length) {
    commitmentRows = `
      <div class="k-group-contribs-label">Engagements verrouillés (${commitmentsList.length})</div>
      <div class="k-group-commitment-list">
        ${commitmentsList.map(c => {
          const paid = contributions?.some(co =>
            co.commitment_id === c.id && co.status === 'paid'
          );
          return `
            <div class="k-group-commitment-row">
              <span class="k-group-commitment-name">${sanitize(c.participant_name?.split(' ')[0] || 'Participant')}</span>
              <span class="k-group-commitment-amount">${fmt(r(c.amount_kmf), 'KMF')}</span>
              <span class="k-group-commitment-status">${paid ? '✅ Payé' : '⏳ En attente'}</span>
            </div>`;
        }).join('')}
      </div>`;
  } else if (!sOpen && commitmentsList?.length) {
    commitmentRows = `
      <div class="k-group-contribs-label">Engagements indicatifs (${commitmentsList.length})</div>
      <div class="k-group-commitment-list">
        ${commitmentsList.map(c => `
          <div class="k-group-commitment-row">
            <span class="k-group-commitment-name">${sanitize(c.participant_name?.split(' ')[0] || 'Participant')}</span>
            <span class="k-group-commitment-amount">${fmt(r(c.amount_kmf), 'KMF')}</span>
            <span class="k-group-commitment-status" style="color:var(--text-muted)">indicatif</span>
          </div>`).join('')}
      </div>`;
  } else {
    commitmentRows = `<p class="k-group-contrib-empty">${
      sOpen
        ? 'Aucun engagement verrouillé.'
        : 'Aucun engagement encore — partagez le lien !'
    }</p>`;
  }

  const settlementSummary = sOpen ? `
    <div class="k-group-settlement-summary">
      <strong>Panier en règlement 🔐</strong>
      ${meta.locked_commitments_count > 0
        ? `<span>${meta.locked_commitments_count} engagement(s) verrouillé(s) · total indicatif : ${fmt(r(meta.locked_commitments_total_kmf), 'KMF')}</span>`
        : ''}
    </div>` : '';

  // ── Barre double lecture ───────────────────────────────────────────
  // pPaid    : % réellement payé (0–100, barre verte de premier plan)
  // eng      : couverture d'intention calculée depuis les engagements
  // pctBadge : valeur brute pour le badge sur-couvert (peut dépasser 100)
  const pPaid = pct(confirmed, total);
  const eng   = engagementCoverage(commitmentsList, total);
  const isOverCovered = eng.pctRaw > 100;

  // Badge sur-couvert : affiché si engagements > total
  const overBadge = isOverCovered
    ? `<span class="k-group-progress-badge k-group-progress-badge--over"
          aria-label="${eng.pctRaw}% engagé — sur-couvert">${eng.pctRaw}\u00a0% engagé</span>`
    : '';

  // Ligne de légende sous la barre
  const legendPaid    = `<span class="k-group-progress-legend-paid">● payé&nbsp;: ${fmt(confirmed, 'KMF')}</span>`;
  const legendEngaged = eng.engagementsTotal > 0
    ? `<span class="k-group-progress-legend-engaged">● engagé&nbsp;: ${fmt(eng.engagementsTotal, 'KMF')}</span>`
    : '';
  const legendTotal   = `<span class="k-group-progress-legend-total">total&nbsp;: ${fmt(total, 'KMF')}</span>`;

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
          <!-- Couche intention (fond, toujours sous le payé) -->
          ${eng.pctCapped > 0
            ? `<span class="k-group-progress-bar k-group-progress-bar--engaged"
                     style="width:${eng.pctCapped}%"
                     aria-label="Engagé ${eng.pctCapped}%"></span>`
            : ''}
          <!-- Couche réelle (premier plan) -->
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
      ${remaining > 0 && isOpen && sOpen
        ? `<p class="k-group-remaining">Reste à payer : <strong>${fmt(remaining, 'KMF')}</strong></p>`
        : ''}
      <div class="k-group-contribs">
        ${commitmentRows}
      </div>
    </div>`;
}

/* ── Carte d'actions créateur ───────────────────────────────────── */

/**
 * Rendu de la carte d'actions du créateur.
 * Gère trois états : commande créée / panier clôturé / phase ouverte / phase règlement.
 * Le binding des boutons est délégué à group-actions.js → bindCreatorActions().
 * @param {object} cart  panier partagé
 * @returns {string}
 */
export function renderCreatorActions(cart) {
  const sOpen    = isSettlementOpen(cart);
  const isOpen   = ['active', 'partially_funded', 'fully_funded'].includes(cart.status);

  if (cart.status === 'converted_to_order' || cart.finalized_order_id) {
    return `
      <div class="k-group-card k-group-actions-card">
        <div class="k-group-section-title">Commande créée</div>
        <p class="k-group-finalized-hint">Ce panier est clôturé et lié à une commande Komerce.</p>
        ${cart.finalized_order_id ? `<button class="k-group-btn k-group-btn--ghost" id="k-group-to-track">📦 Voir la commande</button>` : ''}
      </div>`;
  }
  if (!isOpen) return `<p class="k-group-finalized-hint">Ce panier est clôturé.</p>`;

  const fullyFunded = cart.status === 'fully_funded' || remainingKmf(cart) <= 0;
  const gap = remainingKmf(cart);

  // S2-04 — Expiration règlement
  const expAt   = settlementExpiresAt(cart);
  const expLeft = expAt ? timeRemaining(expAt) : null;
  const expSoon = expAt && (expAt - Date.now() < 6 * 3_600_000);
  const expirationHtml = sOpen && expLeft ? `
    <p class="k-group-share-hint${expSoon ? ' is-exp-soon' : ''}" style="margin-top:6px">
      ⏱️ Règlement ouvert jusqu'au
      ${expAt.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
      — ${expLeft}
    </p>` : '';

  // S2-01 — Bouton annuler (présent dans les deux phases)
  const cancelBtn = `
    <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
      <button class="k-group-btn k-group-btn--ghost k-group-btn--danger" id="k-group-cancel">
        🗑 Annuler le panier
      </button>
    </div>`;

  if (!sOpen) {
    // S2-03 — Sélecteur durée règlement intégré
    return `
      <div class="k-group-card k-group-actions-card">
        <div class="k-group-section-title">Gérer le panier</div>
        <div class="k-group-creator-actions">
          <button class="k-group-btn k-group-btn--ghost" id="k-group-reshare">📲 WhatsApp</button>
          <button class="k-group-btn k-group-btn--copy" id="k-group-copy">🔗 Copier</button>
        </div>
        <p class="k-group-share-hint">Une fois que tout le monde a confirmé son engagement, passez au règlement.</p>
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
          <label style="font-size:12px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:6px">
            Délai de paiement
          </label>
          <select id="k-group-settlement-window"
            style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:10px;font-size:14px;font-family:var(--font);margin-bottom:10px">
            <option value="24">24 heures</option>
            <option value="48" selected>48 heures (défaut)</option>
            <option value="168">7 jours</option>
          </select>
          <button class="k-group-btn k-group-btn--primary" id="k-group-open-settlement" style="background:var(--accent,#1f7a54)">
            🔐 Passer au règlement
          </button>
          <p class="k-group-share-hint" style="margin-top:6px">
            Fige les engagements et ouvre les paiements. Action irréversible.
          </p>
        </div>
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
          <button class="k-group-btn k-group-btn--ghost" id="k-group-edit-items"
            style="width:100%">
            ✏️ Modifier les articles
          </button>
          <p class="k-group-share-hint" style="margin-top:4px">
            Les participants seront notifiés du nouveau total.
          </p>
        </div>
        <p class="k-group-input-error" id="k-group-settlement-err"></p>
        ${cancelBtn}
      </div>`;
  }

  // S2-02 — Finalisation avec gap
  const finalizeBlock = fullyFunded
    ? `<div class="k-group-funded-callout">
        <strong>✅ Tout est réglé</strong>
        <p>Validez maintenant pour que la commande parte en préparation.</p>
        <button class="k-group-btn k-group-btn--finalize" id="k-group-finalize">✓ Valider et commander</button>
      </div>`
    : gap > 0
      ? `<div class="k-group-funded-callout k-group-funded-callout--gap">
          <strong>Il manque ${r(gap).toLocaleString('fr-FR')} KMF</strong>
          <p>Vous pouvez couvrir le reste et valider maintenant.</p>
          <button class="k-group-btn k-group-btn--finalize" id="k-group-finalize-gap">
            Je couvre le reste et je valide
          </button>
        </div>
        <button class="k-group-btn k-group-disabled-finalize" type="button" disabled style="margin-top:8px;width:100%">
          Valider disponible à 100%
        </button>`
      : `<button class="k-group-btn k-group-disabled-finalize" type="button" disabled>Valider disponible à 100%</button>`;

  return `
    <div class="k-group-card k-group-actions-card">
      <div class="k-group-section-title">Panier en règlement</div>
      ${expirationHtml}
      <div class="k-group-creator-actions" style="margin-top:10px">
        <button class="k-group-btn k-group-btn--ghost" id="k-group-reshare">📲 Relancer WhatsApp</button>
        <button class="k-group-btn k-group-btn--copy" id="k-group-copy">🔗 Copier</button>
      </div>
      <p class="k-group-share-hint">Partagez le lien pour que les participants puissent payer leur engagement verrouillé.</p>
      ${finalizeBlock}
      <p class="k-group-input-error" id="k-group-finalize-err"></p>
      ${cancelBtn}
    </div>`;
}
