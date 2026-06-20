/**
 * @komerce-arch
 * @role          admin-transitaire-view
 * @domain        admin-dashboard
 * @layer         ui-page
 * @criticality   medium
 * @inputs        transitaire partner data, customs charges config
 * @outputs       transitaire_page_dom (config transitaire, calibrage charges)
 * @depends       api-client.js, filters-store.js, utils.js
 * @used-by       none
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      kmc_api_only
 * @impact-areas  logistics, transitaire, customs, admin-dashboard
 * @version       2026-06
 */
/**
 * KOMERCE Dashboard — Vue Transitaire /admin/transitaire
 * ════════════════════════════════════════════════════════════════════════
 * Migration de ct-views-transitaire.js → architecture moderne (Vague 1).
 *
 * Périmètre fonctionnel (parité avec legacy) :
 *   - KPI bar : À expédier · En transit · Poids total · Attente moy. · Retards >48h
 *   - Table des colis prêts (Hub → Transit) + action Expédier unitaire
 *   - Action « Expédier tous » avec confirmation
 *   - Historique des 20 derniers transits (chargé en async après rendu initial)
 *
 * Règles d'architecture :
 *   ✓ Appels API uniquement via KmcApi.* — zéro fetch() brut, zéro CT.api
 *   ✓ Aucun usage de CT.views / window.CT (namespace legacy purgé)
 *   ✓ Un seul fichier, pas de -v6 / -v7 / -legacy
 *   ✓ Rôle et guards : vue admin standard (pas de pickup-secret, pas de founder)
 *   ✓ CSS via variables CSS du design system (tokens.css)
 *
 * Dépendances :
 *   - admin/js/api-client.js   → KmcApi.getTransitaireStats()
 *                                  KmcApi.getTransitaireParcels()
 *                                  KmcApi.getTransitaireHistory()
 *                                  KmcApi.shipTransitaireParcel(id, notes?)
 *   - admin/js/components/KpiCard.js  → KpiCard.renderBar()
 *   - (pas de Charts requis sur ce domaine — aucune donnée de série temporelle)
 *
 * Chantier : KOMERCE_CHANTIER_DASHBOARDS_ADMIN.md · Vague 1
 */

(function (global) {
  'use strict';

  // ── Styles (injectés une seule fois) ─────────────────────────────────────

  const STYLE_ID = 'kmc-transitaire-styles';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
      /* ── Bouton "Expédier tous" ───────────────── */
      .tr-ship-all-bar {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 14px;
        flex-wrap: wrap;
      }

      /* ── Badge compteur inline ───────────────── */
      .tr-count-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 22px;
        height: 22px;
        padding: 0 6px;
        background: var(--color-blue-500, #3b82f6);
        color: white;
        border-radius: 99px;
        font-size: var(--fs-xs, 11px);
        font-weight: 700;
        line-height: 1;
      }

      /* ── Row flash "expédié" ─────────────────── */
      .tr-row-shipped {
        background: var(--color-green-50, #f0fdf4) !important;
        transition: background 0.4s;
      }

      /* ── Colonne Depuis (âge du colis) ──────── */
      .tr-age-warn {
        color: var(--color-red-600, #dc2626);
        font-weight: 600;
      }

      /* ── État vide ───────────────────────────── */
      .tr-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 40px 20px;
        color: var(--text-secondary, #64748b);
        font-size: var(--fs-sm, 13px);
      }
      .tr-empty-icon { font-size: 2.5rem; }

      /* ── Actions inline dans le tableau ─────── */
      .tr-action-cell {
        white-space: nowrap;
      }
    `;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = css;
    document.head.appendChild(el);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Formate une durée depuis une date ISO en "Xmin", "Xh", "Xj".
   * Ajoute la classe CSS d'alerte si > 48h.
   * @param {string} dateStr
   * @returns {{ text: string, warn: boolean }}
   */
  function timeSince(dateStr) {
    if (!dateStr) return { text: '—', warn: false };
    const diffSec = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diffSec < 3600)  return { text: Math.floor(diffSec / 60) + ' min', warn: false };
    if (diffSec < 86400) return { text: Math.floor(diffSec / 3600) + ' h',  warn: false };
    const days = Math.floor(diffSec / 86400);
    return { text: days + ' j', warn: days >= 2 };
  }

  function esc(v) {
    return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Sous-rendus ───────────────────────────────────────────────────────────

  function renderKpiBar(el, stats) {
    const kpis = [
      { label: 'À expédier',   value: stats.ready_to_ship    ?? 0, icon: '📦', variant: 'blue'   },
      { label: 'En transit',   value: stats.in_transit        ?? 0, icon: '✈️',  variant: 'amber'  },
      { label: 'Poids total',  value: (stats.total_weight_shipped ?? 0) + ' kg', icon: '⚖️', variant: 'purple' },
      { label: 'Attente moy.', value: (stats.avg_wait_hours   ?? 0) + ' h', icon: '⏱️', variant: 'cyan'   },
    ];
    if ((stats.overdue_shipments ?? 0) > 0) {
      kpis.push({ label: 'Retard > 48h', value: stats.overdue_shipments, icon: '🚨', variant: 'red' });
    }
    KpiCard.renderBar(el, kpis);
  }

  function renderParcelsTable(containerEl, parcels, onRefresh) {
    if (parcels.length === 0) {
      containerEl.innerHTML = `
        <div class="tr-empty">
          <span class="tr-empty-icon">✈️</span>
          Aucun colis en attente de transit
        </div>`;
      return;
    }

    const rows = parcels.map(p => {
      const age = timeSince(p.shipped_at);
      const ageCell = age.warn
        ? `<span class="tr-age-warn">${esc(age.text)}</span>`
        : esc(age.text);
      const dest = esc(p.destination_island ?? '—') + (p.relais_name ? ` · ${esc(p.relais_name)}` : '');
      return `
        <tr id="tr-pcl-${esc(p.id)}">
          <td><strong>${esc(p.reference ?? '—')}</strong></td>
          <td>${esc(p.order_ref ?? '—')}</td>
          <td>${esc(p.customer_name ?? '—')}</td>
          <td>${dest}</td>
          <td style="text-align:right">${esc(p.nb_items ?? 0)}</td>
          <td style="text-align:right">${esc(p.weight_kg ?? '—')} kg</td>
          <td>${ageCell}</td>
          <td class="tr-action-cell">
            <button
              class="btn btn-sm btn-success"
              data-parcel-id="${esc(p.id)}"
              data-parcel-ref="${esc(p.reference ?? '')}"
            >✈️ Expédier</button>
          </td>
        </tr>`;
    }).join('');

    containerEl.innerHTML = `
      <div class="tr-ship-all-bar">
        <button id="tr-ship-all" class="btn btn-primary btn-sm">
          ✈️ Expédier tous
          <span class="tr-count-badge">${parcels.length}</span>
        </button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Colis</th>
              <th>Commande</th>
              <th>Client</th>
              <th>Destination</th>
              <th style="text-align:right">Articles</th>
              <th style="text-align:right">Poids</th>
              <th>Depuis</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody id="tr-tbody">${rows}</tbody>
        </table>
      </div>`;

    // ── Délégation d'événements ──────────────────────────────────────────
    containerEl.addEventListener('click', async function handler(e) {
      const shipOneBtn = e.target.closest('[data-parcel-id]');
      const shipAllBtn = e.target.closest('#tr-ship-all');

      if (shipOneBtn) {
        await handleShipOne(
          shipOneBtn.dataset.parcelId,
          shipOneBtn.dataset.parcelRef,
          shipOneBtn
        );
      } else if (shipAllBtn) {
        await handleShipAll(containerEl, onRefresh);
      }
    }, { once: false });
  }

  async function handleShipOne(parcelId, parcelRef, btnEl) {
    const label = parcelRef || parcelId;
    if (!confirm(`Confirmer le transit pour le colis ${label} ?`)) return;

    btnEl.disabled = true;
    btnEl.textContent = '…';

    try {
      const result = await KmcApi.shipTransitaireParcel(parcelId);
      if (result.success) {
        const row = document.getElementById(`tr-pcl-${parcelId}`);
        if (row) {
          row.classList.add('tr-row-shipped');
          setTimeout(() => row.remove(), 1400);
        }
        // Mise à jour compteur du bouton "Expédier tous"
        const remaining = document.querySelectorAll('[data-parcel-id]').length - 1;
        const badge = document.querySelector('#tr-ship-all .tr-count-badge');
        if (badge) badge.textContent = remaining;
        if (remaining === 0) {
          const shipAllBar = document.querySelector('.tr-ship-all-bar');
          if (shipAllBar) shipAllBar.style.opacity = '0.4';
        }
      } else {
        alert('❌ ' + (result.error || 'Erreur serveur'));
        btnEl.disabled = false;
        btnEl.textContent = '✈️ Expédier';
      }
    } catch (err) {
      alert('❌ ' + (err.message || 'Erreur réseau'));
      btnEl.disabled = false;
      btnEl.textContent = '✈️ Expédier';
    }
  }

  async function handleShipAll(containerEl, onRefresh) {
    const buttons = containerEl.querySelectorAll('[data-parcel-id]');
    if (buttons.length === 0) return;
    if (!confirm(`Expédier ${buttons.length} colis en transit ?`)) return;

    // Désactiver tous les boutons le temps de l'opération
    buttons.forEach(b => { b.disabled = true; b.textContent = '…'; });
    const shipAllBtn = containerEl.querySelector('#tr-ship-all');
    if (shipAllBtn) shipAllBtn.disabled = true;

    let success = 0;
    let errors  = 0;

    for (const btn of buttons) {
      try {
        const result = await KmcApi.shipTransitaireParcel(btn.dataset.parcelId);
        if (result.success) {
          const row = document.getElementById(`tr-pcl-${btn.dataset.parcelId}`);
          if (row) row.classList.add('tr-row-shipped');
          success++;
        } else {
          errors++;
          btn.disabled = false;
          btn.textContent = '✈️ Expédier';
        }
      } catch (_) {
        errors++;
        btn.disabled = false;
        btn.textContent = '✈️ Expédier';
      }
    }

    const msg = `✈️ ${success} colis expédié${success > 1 ? 's' : ''}` +
                (errors > 0 ? ` · ${errors} erreur${errors > 1 ? 's' : ''}` : '');
    alert(msg);

    // Rafraîchissement complet de la vue
    if (typeof onRefresh === 'function') onRefresh();
  }

  function renderHistory(el, events) {
    if (!events || events.length === 0) {
      el.innerHTML = '<p class="text-secondary" style="padding:16px 0">Aucun transit récent.</p>';
      return;
    }

    const rows = events.slice(0, 20).map(ev => `
      <tr>
        <td><strong>${esc(ev.parcel_ref ?? '—')}</strong></td>
        <td>${esc(ev.order_ref ?? '—')}</td>
        <td>${esc(ev.actor_name ?? '—')}</td>
        <td>${new Date(ev.created_at).toLocaleString('fr-FR')}</td>
        <td class="text-secondary">${esc(ev.notes ?? '—')}</td>
      </tr>`).join('');

    el.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Colis</th>
              <th>Commande</th>
              <th>Par</th>
              <th>Date</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  // ── Rendu principal ───────────────────────────────────────────────────────

  async function render(rootEl) {
    injectStyles();

    rootEl.innerHTML = `
      <h1 class="page-title">Transitaire</h1>
      <p class="page-subtitle">Expédition Hub → Transit — suivi des frets</p>

      <section class="page-section">
        <div id="tr-kpis" class="kpi-bar">
          <div class="loading-state"><span class="loader"></span> Chargement...</div>
        </div>
      </section>

      <section class="page-section">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">📦 Colis prêts à expédier</h3>
            <button id="tr-refresh" class="card-action btn btn-ghost btn-sm">↻ Rafraîchir</button>
          </div>
          <div id="tr-parcels">
            <div class="loading-state"><span class="loader"></span> Chargement...</div>
          </div>
        </div>
      </section>

      <section class="page-section">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">📜 Derniers transits</h3>
          </div>
          <div id="tr-history">
            <div class="loading-state"><span class="loader"></span> Chargement...</div>
          </div>
        </div>
      </section>

      <p id="tr-meta" style="margin-top:16px;font-size:var(--fs-xs);color:var(--text-tertiary)"></p>
    `;

    // Bouton rafraîchir : re-rend la vue entière
    document.getElementById('tr-refresh').addEventListener('click', () => render(rootEl));

    // ── Chargement initial (stats + colis en parallèle) ──────────────────
    try {
      const [stats, parcelsData] = await Promise.all([
        KmcApi.getTransitaireStats(),
        KmcApi.getTransitaireParcels(),
      ]);

      // Guard : navigation entre-temps → rootEl détaché du DOM
      if (!rootEl || !document.contains(rootEl)) return;

      renderKpiBar(document.getElementById('tr-kpis'), stats);
      renderParcelsTable(
        document.getElementById('tr-parcels'),
        parcelsData.parcels || [],
        () => render(rootEl)
      );

      document.getElementById('tr-meta').textContent =
        `Mis à jour le ${new Date().toLocaleString('fr-FR')}`;

    } catch (err) {
      document.getElementById('tr-kpis').innerHTML =
        `<div class="error-state">❌ Erreur chargement : ${esc(err.message)}</div>`;
      document.getElementById('tr-parcels').innerHTML = '';
    }

    // ── Historique chargé en async (n'empêche pas l'affichage des colis) ──
    KmcApi.getTransitaireHistory()
      .then(hdata => renderHistory(
        document.getElementById('tr-history'),
        hdata.events || []
      ))
      .catch(() => {
        const hEl = document.getElementById('tr-history');
        if (hEl) hEl.innerHTML = '<p class="text-secondary" style="padding:16px 0">Impossible de charger l\'historique.</p>';
      });
  }

  // ── Export ────────────────────────────────────────────────────────────────

  global.TransitaireView = { render };

})(window);
