/**
 * @komerce-arch
 * @role          admin-orders-logistics-view
 * @domain        admin-dashboard
 * @layer         ui-page
 * @criticality   high
 * @inputs        filters (from, to, status), orders and parcels data
 * @outputs       orders_logistics_page_dom (commandes, colis, pipeline livraison)
 * @depends       api-client.js, filters-store.js, utils.js, components/KpiCard.js
 * @used-by       none
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      kmc_api_only
 * @impact-areas  orders, logistics, parcels, admin-dashboard
 * @version       2026-06
 */
/**
 * KOMERCE Dashboard — Vue Commandes & logistique /admin/orders-logistics
 * ════════════════════════════════════════════════════════════════════════
 * Question : "Qu'est-ce qu'il faut traiter ? Où sont les commandes ?"
 *
 * Sections :
 *   - KPI bar (8 ops)
 *   - A : Tableau dense multi-statuts
 *   - C : Pipeline opérationnel (funnel)
 *   - D : Flux colis (funnel)
 *   - E : Exceptions opérationnelles
 *   - G : Productivité simple
 */

(function (global) {
  'use strict';

  async function render(rootEl) {
    rootEl.innerHTML = `
      <h1 class="page-title">Commandes & logistique</h1>
      <p class="page-subtitle">Exécuter sans friction — pilotage opérationnel</p>

      <section class="page-section">
        <div id="ops-kpis" class="kpi-bar">
          <div class="loading-state"><span class="loader"></span> Chargement...</div>
        </div>
      </section>

      <section class="page-section grid grid-2">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Pipeline commandes</h3>
          </div>
          <div id="ops-pipeline-chart"></div>
        </div>
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Flux colis</h3>
          </div>
          <div id="ops-parcel-chart"></div>
        </div>
      </section>

      <section class="page-section">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Liste des commandes</h3>
            <a href="#" class="card-action" id="ops-orders-refresh">↻ rafraîchir</a>
          </div>
          <div id="ops-orders-table"></div>
        </div>
      </section>

      <section class="page-section grid grid-2">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Exceptions opérationnelles</h3>
          </div>
          <div id="ops-exceptions"></div>
        </div>
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Routage inter-îles</h3>
          </div>
          <div id="ops-routing"></div>
        </div>
      </section>

      <p id="ops-meta" style="margin-top: 16px; font-size: var(--fs-xs); color: var(--text-tertiary);"></p>
    `;

    try {
      const filters = KmcFilters.get();
      const data = await KmcApi.getLogistics(filters);

      // KPIs
      // Guard : navigation entre-temps → rootEl détaché du DOM
      if (!rootEl || !document.contains(rootEl)) return;

      KpiCard.renderBar(document.getElementById('ops-kpis'), data.kpis || []);

      // Pipelines (funnel charts)
      if (data.charts && data.charts.ops_pipeline) {
        Charts.renderFunnel(
          document.getElementById('ops-pipeline-chart'),
          data.charts.ops_pipeline
        );
      }
      if (data.charts && data.charts.parcel_flow) {
        Charts.renderFunnel(
          document.getElementById('ops-parcel-chart'),
          data.charts.parcel_flow
        );
      }

      // Routage inter-îles : simple tableau pour V1 (pas de carte interactive)
      renderRoutingTable(document.getElementById('ops-routing'));

      // Exceptions : alerts spécifiques logistique
      const exceptions = await loadExceptions(filters);
      AlertList.renderList(
        document.getElementById('ops-exceptions'),
        exceptions,
        { limit: 10, emptyText: 'Aucune exception opérationnelle' }
      );

      // Tableau commandes ops (dense)
      await loadOrdersOpsTable(filters);

      document.getElementById('ops-orders-refresh').addEventListener('click', async (e) => {
        e.preventDefault();
        await loadOrdersOpsTable(filters, true);
      });

      // Meta
      if (data.data_quality) {
        const meta = document.getElementById('ops-meta');
        const dq = data.data_quality;
        const cached = dq.is_cached ? `(cache ${dq.cache_age_seconds}s)` : '(données fraîches)';
        meta.textContent = `Généré ${new Date(dq.generated_at).toLocaleTimeString('fr-FR')} ${cached}`;
        if (dq.warnings && dq.warnings.length) {
          meta.innerHTML += '<br>⚠️ ' + dq.warnings.join('<br>⚠️ ');
        }
      }
    } catch (err) {
      console.error('[Logistics] error:', err);
      document.getElementById('ops-kpis').innerHTML = `<div class="error-state">
        ❌ Erreur: ${err.message || 'inconnue'}
        ${err.status === 401 ? ' — connectez-vous comme admin' : ''}
      </div>`;
    }
  }

  /**
   * Charge le tableau dense des commandes ops avec multi-statuts.
   */
  async function loadOrdersOpsTable(filters, force = false) {
    const tableEl = document.getElementById('ops-orders-table');
    tableEl.innerHTML = '<div class="loading-state"><span class="loader"></span> Chargement...</div>';

    try {
      let orders = [];
      try {
        const data = await KmcApi.getOrders({
          ...filters,
          limit: 50,
          ...(force ? { refresh: '1' } : {}),
        });
        orders = data.orders || data.items || data || [];
        if (!Array.isArray(orders)) orders = [];
      } catch (e) {
        tableEl.innerHTML = `<div class="error-state">Erreur chargement commandes : ${e.message || 'API indisponible'}</div>`;
        return;
      }

      DataTable.render(tableEl, {
        emptyText: 'Aucune commande sur cette période',
        columns: [
          {
            key: 'reference',
            label: 'Réf',
            cls: 'ref',
            render: (row) => row.reference || row.id || '—',
          },
          {
            key: 'destinataire',
            label: 'Destinataire',
            render: (row) => row.recipient_name || row.destinataire || row.client_name || '—',
          },
          {
            key: 'destination_island',
            label: 'Île',
            render: (row) => {
              const i = row.destination_island || '—';
              const cls = i === 'GC' || i === 'Moroni' ? 'is-blue' : (i === 'AN' || i === 'Anjouan' ? 'is-amber' : 'is-gray');
              return `<span class="badge ${cls}">${i}</span>`;
            },
          },
          {
            key: 'relais_name',
            label: 'Relais',
            render: (row) => row.relais_name || row.relais_id || '—',
          },
          {
            key: 'payment_status',
            label: 'Paiement',
            render: (row) => BadgeStatus.status(row.payment_status || 'pending'),
          },
          {
            key: 'status',
            label: 'Statut',
            render: (row) => BadgeStatus.status(row.status || 'pending'),
          },
          {
            key: 'total_kmf',
            label: 'Total',
            align: 'right',
            render: (row) => Number(row.total_kmf || row.total || 0).toLocaleString('fr-FR'),
          },
          {
            key: 'updated_at',
            label: 'MAJ',
            render: (row) => row.updated_at || row.created_at
              ? new Date(row.updated_at || row.created_at).toLocaleDateString('fr-FR')
              : '—',
          },
        ],
        rows: orders,
        onRowClick: null, // TODO Sprint 5 : brancher page détail commande
      });
    } catch (err) {
      tableEl.innerHTML = `<div class="error-state">Endpoint /api/admin/orders non disponible — sera branché en Sprint 5+</div>`;
    }
  }

  /**
   * Liste des exceptions opérationnelles.
   * Pas d'endpoint dédié en Sprint 5 → on utilise les alerts du payload.
   */
  async function loadExceptions(filters) {
    // Priorité : utiliser les alerts du dashboard logistics si présentes
    const data = await KmcApi.getLogistics(filters);
    return data.alerts || [];
  }

  /**
   * Tableau routage inter-îles simplifié (V1).
   */
  function renderRoutingTable(container) {
    // TODO Sprint 3+ : brancher sur /api/admin/dashboard/logistics (section routing)
    container.innerHTML = '<div class="empty-state">Données de routage non disponibles — endpoint à brancher (Sprint 3+)</div>';
  }

  global.OrdersLogisticsView = { render };
})(window);
