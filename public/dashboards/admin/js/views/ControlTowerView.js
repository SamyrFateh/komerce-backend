/**
 * KOMERCE Dashboard — Vue Tour de contrôle /admin/control-tower
 * ════════════════════════════════════════════════════════════════════════
 * Question : "Faut-il agir aujourd'hui ?"
 *
 * Sections :
 *   - KPI bar (8)
 *   - A : Activité (line chart)
 *   - B : Statuts (donut)
 *   - D : Alertes critiques (avec actions)
 *   - E : Commandes à traiter (table)
 *   - F : Pipeline colis (funnel)
 *   - G : Performance relais (table)
 */

(function (global) {
  'use strict';

  async function render(rootEl) {
    rootEl.innerHTML = `
      <h1 class="page-title">Tour de contrôle</h1>
      <p class="page-subtitle">Voir, comprendre, décider — état opérationnel temps réel</p>

      <section class="page-section">
        <div id="ct-kpis" class="kpi-bar">
          <div class="loading-state"><span class="loader"></span> Chargement...</div>
        </div>
      </section>

      <section class="page-section grid grid-2">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Activité (commandes & CA)</h3>
          </div>
          <div id="ct-activity-chart"></div>
        </div>
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Répartition par statut</h3>
          </div>
          <div id="ct-status-chart"></div>
        </div>
      </section>

      <section class="page-section">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Alertes critiques</h3>
            <a href="/admin/alerts" class="card-action">Voir toutes →</a>
          </div>
          <div id="ct-alerts"></div>
        </div>
      </section>

      <section class="page-section grid grid-2">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Commandes à traiter</h3>
          </div>
          <div id="ct-orders-table"></div>
        </div>
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Performance relais (7j)</h3>
          </div>
          <div id="ct-relais-table"></div>
        </div>
      </section>

      <p id="ct-meta" style="margin-top: 16px; font-size: var(--fs-xs); color: var(--text-tertiary);"></p>
    `;

    try {
      const filters = KmcFilters.get();
      const data = await KmcApi.getControlTower(filters);

      // KPIs
      KpiCard.renderBar(document.getElementById('ct-kpis'), data.kpis || []);

      // Charts
      if (data.charts && data.charts.activity_timeline) {
        Charts.renderLineChart(
          document.getElementById('ct-activity-chart'),
          data.charts.activity_timeline
        );
      }
      if (data.charts && data.charts.status_breakdown) {
        Charts.renderDonutChart(
          document.getElementById('ct-status-chart'),
          data.charts.status_breakdown,
          { keyField: 'status', valueField: 'count' }
        );
      }

      // Alerts
      AlertList.renderList(
        document.getElementById('ct-alerts'),
        data.alerts || [],
        { limit: 8, emptyText: 'Aucune alerte critique en cours' }
      );

      // Tables
      const orders = (data.tables && data.tables.orders_to_handle) || [];
      DataTable.render(document.getElementById('ct-orders-table'), {
        emptyText: 'Aucune commande à traiter',
        columns: [
          { key: 'reference', label: 'Réf', cls: 'ref' },
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
            render: (row) => Number(row.total_kmf || 0).toLocaleString('fr-FR') + ' KMF',
          },
          {
            key: 'relais_name',
            label: 'Relais',
            render: (row) => row.relais_name || '—',
          },
        ],
        rows: orders,
        onRowClick: (row) => {
          window.location.href = `/admin/orders-logistics?order_id=${row.id}`;
        },
      });

      const relais = (data.tables && data.tables.relais_performance) || [];
      DataTable.render(document.getElementById('ct-relais-table'), {
        emptyText: 'Aucune donnée relais',
        columns: [
          { key: 'relais_name', label: 'Relais' },
          { key: 'orders_count', label: 'Cmds', align: 'right' },
          { key: 'available', label: 'Disp.', align: 'right' },
          { key: 'collected', label: 'Retirés', align: 'right' },
          {
            key: 'taux_retrait_pct',
            label: 'Taux retrait',
            align: 'right',
            render: (row) => {
              const pct = Number(row.taux_retrait_pct || 0);
              const color = pct >= 70 ? 'is-green' : (pct >= 40 ? 'is-orange' : 'is-red');
              return `<span class="badge ${color}">${pct.toFixed(1)}%</span>`;
            },
          },
        ],
        rows: relais,
      });

      // Meta
      if (data.data_quality) {
        const meta = document.getElementById('ct-meta');
        const dq = data.data_quality;
        const cached = dq.is_cached
          ? `(cache ${dq.cache_age_seconds}s/${dq.cache_ttl_seconds}s)`
          : '(données fraîches)';
        meta.textContent = `Généré ${new Date(dq.generated_at).toLocaleTimeString('fr-FR')} ${cached}`;
        if (dq.warnings && dq.warnings.length) {
          meta.textContent += ' · ' + dq.warnings.join(' · ');
        }
      }
    } catch (err) {
      console.error('[ControlTower] error:', err);
      const main = document.getElementById('ct-kpis');
      if (main) {
        main.innerHTML = `<div class="error-state">
          ❌ Erreur de chargement: ${err.message || 'inconnue'}
          ${err.status === 401 ? ' — connectez-vous comme admin' : ''}
        </div>`;
      }
    }
  }

  global.ControlTowerView = { render };
})(window);
