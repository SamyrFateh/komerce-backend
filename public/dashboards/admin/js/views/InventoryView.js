/**
 * @komerce-arch
 * @role          admin-inventory-view
 * @domain        admin-dashboard
 * @layer         ui-page
 * @criticality   medium
 * @inputs        hub inventory data
 * @outputs       inventory_page_dom (stock hub par produit, mouvements)
 * @depends       api-client.js, filters-store.js, utils.js
 * @used-by       none
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      kmc_api_only
 * @impact-areas  inventory, hub, admin-dashboard
 * @version       2026-06
 */
/**
 * KOMERCE Dashboard — Vue Inventaire /admin/inventory
 * ════════════════════════════════════════════════════════════════════════
 * Migration de ct-views-inventory.js (CTInventory) vers l'architecture moderne.
 *
 * Fonctionnement :
 *   Hub reçoit des articles → le moteur propose leur affectation à un colis
 *   → l'agent peut surcharger la proposition via un select (scan d'assignation).
 *
 * Sections :
 *   - KPI badges : Reçus · Proposés · Assignés · Buffer · Colis ouverts · Dépassés
 *   - Table par statut (proposed / received / buffered) avec select d'assignation
 *   - Bouton « Recalculer » (POST /api/hub/inventory/propose-all)
 *
 * Règles d'architecture :
 *   ✓ Appels API via KmcApi — zéro fetch() brut
 *   ✓ Un seul fichier, zéro doublon -v6/-v7/-legacy
 *   ✓ Rôle non utilisé (vue opérationnelle sans guard de rôle spécifique)
 *
 * Dépendances :
 *   - api-client.js → KmcApi  (endpoints hub à ajouter — voir NOTE)
 *
 * NOTE api-client.js : ajouter dans KmcApi :
 *   getHubInventoryStats()    → GET /api/hub/inventory/stats
 *   getHubInventoryProposals() → GET /api/hub/inventory/proposals
 *   getHubInventoryOpenParcels() → GET /api/hub/inventory/open-parcels
 *   hubInventoryScanAssign(body) → POST /api/hub/inventory/scan-assign
 *   hubInventoryProposeAll()  → POST /api/hub/inventory/propose-all
 *
 * Chantier : KOMERCE_CHANTIER_DASHBOARDS_ADMIN.md · Vague 1
 */

(function (global) {
  'use strict';

  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); // AUD-06

  // ── Styles (injectés une seule fois) ─────────────────────────────────────
  const STYLE_ID = 'kmc-inventory-styles';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
      .inv-kpi-bar {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 16px;
      }
      .inv-kpi-badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 12px;
        border-radius: 12px;
        font-size: var(--fs-sm, 13px);
        font-weight: 600;
        border: 1px solid;
      }

      .inv-section-title {
        font-size: var(--fs-sm, 13px);
        font-weight: 700;
        margin: 12px 0 6px;
      }

      .inv-table {
        width: 100%;
        border-collapse: collapse;
        font-size: var(--fs-sm, 13px);
      }
      .inv-table thead tr {
        background: var(--surface-secondary, #f8fafc);
        border-bottom: 1px solid var(--border-default, #e2e8f0);
      }
      .inv-table th {
        padding: 6px 8px;
        text-align: left;
        font-size: 11px;
        color: var(--text-tertiary, #94a3b8);
        font-weight: 600;
        text-transform: uppercase;
      }
      .inv-table td {
        padding: 6px 8px;
        border-bottom: 1px solid var(--border-subtle, #f1f5f9);
        max-width: 160px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .inv-table tr.inv-assigned td { opacity: 0.35; transition: opacity 0.4s; }

      .inv-assign-select {
        font-size: 11px;
        padding: 3px 6px;
        border-radius: 4px;
        border: 1px solid var(--border-default, #cbd5e1);
        max-width: 150px;
        background: var(--surface-primary, white);
        color: var(--text-primary, #0f172a);
        cursor: pointer;
      }

      .inv-proposed-ref {
        font-weight: 700;
        color: var(--color-green-700, #15803d);
      }
      .inv-buffer-reason { color: var(--color-amber-600, #d97706); }
      .inv-wait          { color: var(--text-tertiary, #94a3b8); }

      .inv-empty {
        text-align: center;
        padding: 24px;
        color: var(--text-tertiary, #94a3b8);
        font-size: var(--fs-sm, 13px);
      }
    `;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = css;
    document.head.appendChild(el);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function fmtWait(minutes) {
    const m = Math.round(minutes || 0);
    if (m > 60) return `${Math.floor(m / 60)}h${m % 60}m`;
    return `${m}m`;
  }

  function kpiBadge(icon, label, val, color, warnIfPositive = false) {
    const isWarn = warnIfPositive && val > 0;
    const c = isWarn ? 'var(--color-red-600, #dc2626)' : color;
    return `<span class="inv-kpi-badge" style="background:${c}11;color:${c};border-color:${c}33">
      ${icon} ${val} ${label}
    </span>`;
  }

  // ── Section renderer ─────────────────────────────────────────────────────

  function renderSection(title, items, type, openParcels, color) {
    if (!items.length) return '';

    const parcelsOpts = openParcels.map(p =>
      `<option value="${p.id}">${p.reference} (${p.destination_island || '?'}) — ${p.item_count} art.</option>`
    ).join('');

    const colHeader = type === 'proposed'
      ? '→ Colis suggéré'
      : type === 'buffered' ? 'Raison' : 'Attente';

    let rows = items.map(item => {
      const waitStr = fmtWait(item.wait_minutes);

      let infoCell;
      if (type === 'proposed') {
        infoCell = `<span class="inv-proposed-ref">📦 ${esc(item.proposed_parcel_ref || '?')}</span>`;
      } else if (type === 'buffered') {
        infoCell = `<span class="inv-buffer-reason">${esc(item.buffer_reason || 'En attente')}</span>`;
      } else {
        infoCell = `<span class="inv-wait">⏱ ${waitStr}</span>`;
      }

      // Suggested option first if proposed
      const suggestedOpt = (type === 'proposed' && item.proposed_parcel_id)
        ? `<option value="${esc(item.proposed_parcel_id)}" style="font-weight:bold">✅ ${esc(item.proposed_parcel_ref)} (suggéré)</option>`
        : '';

      return `<tr data-inv-id="${item.id}">
        <td title="${esc(item.product_name)}">${esc(item.product_name)}</td>
        <td style="font-family:monospace;font-size:11px">${esc(item.order_ref)}</td>
        <td>${esc(item.destination_island || '—')}</td>
        <td>${infoCell}</td>
        <td style="text-align:right">
          <select class="inv-assign-select" data-item-id="${item.id}" title="Scanner dans un colis">
            <option value="">📦 Assigner →</option>
            ${suggestedOpt}
            ${parcelsOpts}
          </select>
        </td>
      </tr>`;
    }).join('');

    return `
      <div class="inv-section-title" style="color:${color}">${title} (${items.length})</div>
      <div style="overflow-x:auto;margin-bottom:16px">
        <table class="inv-table">
          <thead><tr>
            <th>Produit</th>
            <th>Commande</th>
            <th>Dest.</th>
            <th>${colHeader}</th>
            <th style="text-align:right">Scan</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  // ── Scan-assign action ────────────────────────────────────────────────────

  async function scanAssign(rootEl, itemId, parcelId) {
    if (!parcelId) return;
    const row = rootEl.querySelector(`tr[data-inv-id="${itemId}"]`);
    try {
      const result = await KmcApi.hubInventoryScanAssign({ inventory_item_id: itemId, parcel_id: parcelId });
      if (row) {
        row.style.background = result.matched_proposal
          ? 'var(--color-green-50, #f0fdf4)'
          : 'var(--color-amber-50, #fffbeb)';
        const lastTd = row.querySelector('td:last-child');
        if (lastTd) lastTd.innerHTML = `<span style="font-size:11px;color:var(--color-green-700,#15803d)">✅ ${esc(result.parcel_ref)}</span>`; // AUD-06
        setTimeout(() => row.classList.add('inv-assigned'), 1500);
        setTimeout(() => loadData(rootEl), 2500);
      }
    } catch (err) {
      console.error('[InventoryView] scanAssign error', err);
      alert('❌ ' + (err.message || err));
    }
  }

  // ── Data loading ─────────────────────────────────────────────────────────

  async function loadData(rootEl) {
    const kpiEl      = rootEl.querySelector('#inv-kpis');
    const itemsEl    = rootEl.querySelector('#inv-items');
    const recalcBtn  = rootEl.querySelector('#inv-recalc-btn');

    if (!kpiEl || !itemsEl) return;

    itemsEl.innerHTML = `<div class="loading-state" style="padding:24px 0;text-align:center">
      <span class="loader"></span> Chargement inventaire…
    </div>`;

    try {
      const [stats, itemsData, parcelsData] = await Promise.all([
        KmcApi.getHubInventoryStats(),
        KmcApi.getHubInventoryProposals(),
        KmcApi.getHubInventoryOpenParcels(),
      ]);

      const openParcels = parcelsData.parcels || [];

      // ── KPI bar ──
      const s = stats || {};
      kpiEl.innerHTML =
        kpiBadge('📥', 'Reçus',         s.received    || 0, 'var(--color-green-700, #15803d)') +
        kpiBadge('🤖', 'Proposés',      s.proposed    || 0, 'var(--color-green-600, #16a34a)') +
        kpiBadge('✅', 'Assignés',      s.assigned    || 0, 'var(--color-green-800, #166534)') +
        kpiBadge('⏳', 'Buffer',        s.buffered    || 0, 'var(--color-amber-600, #d97706)') +
        kpiBadge('📦', 'Colis ouverts', s.open_parcels|| 0, 'var(--color-blue-600, #2563eb)') +
        kpiBadge('🚨', 'Dépassés',      s.overdue     || 0, 'var(--color-red-600, #dc2626)', true);

      // ── Items ──
      const items    = itemsData.items || [];
      const proposed = items.filter(i => i.status === 'proposed');
      const received = items.filter(i => i.status === 'received');
      const buffered = items.filter(i => i.status === 'buffered');

      if (items.length === 0) {
        itemsEl.innerHTML = `<div class="inv-empty">
          Aucun article en attente d'assignation.<br>
          Les articles reçus au Hub apparaîtront ici avec la proposition du moteur.
        </div>`;
        return;
      }

      itemsEl.innerHTML =
        renderSection('🤖 Propositions moteur', proposed, 'proposed', openParcels, 'var(--color-green-700, #15803d)') +
        renderSection('📥 Reçus (en attente)',   received, 'received', openParcels, 'var(--color-green-600, #16a34a)') +
        renderSection('⏳ Buffer',               buffered, 'buffered', openParcels, 'var(--color-amber-600, #d97706)');

      // Wire selects
      itemsEl.querySelectorAll('.inv-assign-select').forEach(sel => {
        sel.addEventListener('change', e => {
          const itemId  = sel.dataset.itemId;
          const parcelId = e.target.value;
          if (parcelId) scanAssign(rootEl, itemId, parcelId);
        });
      });

    } catch (err) {
      console.error('[InventoryView] load error', err);
      itemsEl.innerHTML = `<div class="error-state">❌ ${esc(err.message || err)}</div>`; // FRESH-104
    }
  }

  // ── Recalculate ───────────────────────────────────────────────────────────

  async function recalculate(rootEl) {
    const btn = rootEl.querySelector('#inv-recalc-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳…'; }
    try {
      await KmcApi.hubInventoryProposeAll();
      await loadData(rootEl);
    } catch (err) {
      alert('❌ ' + (err.message || err));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🤖 Recalculer'; }
    }
  }

  // ── Main render ───────────────────────────────────────────────────────────

  async function render(rootEl) {
    injectStyles();

    rootEl.innerHTML = `
      <h1 class="page-title">Inventaire Hub</h1>
      <p class="page-subtitle">Réception & Assignation — le moteur propose, l'agent décide</p>

      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">
        <div id="inv-kpis" class="inv-kpi-bar">
          <span class="loading-state"><span class="loader"></span></span>
        </div>
        <div style="display:flex;gap:8px">
          <button id="inv-recalc-btn" class="btn btn-secondary btn-sm">🤖 Recalculer</button>
          <button id="inv-refresh-btn" class="btn btn-ghost btn-sm">🔄</button>
        </div>
      </div>

      <div id="inv-items"></div>
    `;

    rootEl.querySelector('#inv-recalc-btn').addEventListener('click', () => recalculate(rootEl));
    rootEl.querySelector('#inv-refresh-btn').addEventListener('click', () => loadData(rootEl));

    await loadData(rootEl);
  }

  // ── Export ────────────────────────────────────────────────────────────────
  global.InventoryView = { render };

})(window);
