/**
 * KOMERCE Dashboard — Vue Coût rendu relais /admin/costing
 * ════════════════════════════════════════════════════════════════════════
 * Question : "Combien Komerce gagne ou perd réellement par cmd, produit, relais ?"
 *
 * Sections :
 *   - KPI bar (8) avec marges à 3 niveaux (estimée, variable_reelle, consolidée)
 *   - A : CA / Coût / Marge timeline
 *   - B : Répartition cout réel par famille (donut)
 *   - C : Tableau commandes (ref, total, est, réel, variance, cost_status)
 *   - E : Rentabilité produits (top 10)
 *   - G : Rentabilité relais
 *   - H : Alertes coût avec actions (allouer)
 */

(function (global) {
  'use strict';

  async function render(rootEl) {
    rootEl.innerHTML = `
      <h1 class="page-title">Coût rendu relais</h1>
      <p class="page-subtitle">Dire la vérité économique — combien Komerce gagne réellement</p>

      <section class="page-section">
        <div id="cost-kpis" class="kpi-bar">
          <div class="loading-state"><span class="loader"></span> Chargement...</div>
        </div>
      </section>

      <section class="page-section grid grid-2">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">CA / Coût / Marge dans le temps</h3>
          </div>
          <div id="cost-timeline-chart"></div>
        </div>
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Coût réel par famille</h3>
          </div>
          <div id="cost-family-chart"></div>
        </div>
      </section>

      <section class="page-section">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Alertes de coût</h3>
          </div>
          <div id="cost-alerts"></div>
        </div>
      </section>

      <section class="page-section">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Commandes — détail costing</h3>
            <a href="#" class="card-action" id="cost-orders-refresh">↻ rafraîchir</a>
          </div>
          <div id="cost-orders-table"></div>
        </div>
      </section>

      <section class="page-section grid grid-2">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Rentabilité produits (top 10)</h3>
          </div>
          <div id="cost-products-table"></div>
        </div>
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Rentabilité relais</h3>
          </div>
          <div id="cost-relais-table"></div>
        </div>
      </section>

      <p id="cost-meta" style="margin-top: 16px; font-size: var(--fs-xs); color: var(--text-tertiary);"></p>
    `;

    try {
      const filters = KmcFilters.get();
      const data = await KmcApi.getCosting(filters);

      // KPIs (8) — incluant 3 niveaux de marge
      KpiCard.renderBar(document.getElementById('cost-kpis'), data.kpis || []);

      // Charts
      if (data.charts && data.charts.ca_cost_margin_timeline) {
        Charts.renderLineChart(
          document.getElementById('cost-timeline-chart'),
          data.charts.ca_cost_margin_timeline
        );
      }
      if (data.charts && data.charts.real_cost_by_family) {
        Charts.renderDonutChart(
          document.getElementById('cost-family-chart'),
          data.charts.real_cost_by_family,
          { keyField: 'cost_type', valueField: 'amount_kmf' }
        );
      }

      // Alertes coût (avec boutons d'action)
      const costAlerts = (data.alerts || []).map(a => ({
        ...a,
        level: a.level === 'warning' ? 'elevated' : a.level,
      }));
      AlertList.renderList(
        document.getElementById('cost-alerts'),
        costAlerts,
        { limit: 10, emptyText: 'Aucune alerte de coût' }
      );

      // Bind action buttons (allouer fixes mensuels, etc.)
      bindAlertActions();

      // Charger les détails commandes en parallele depuis /api/admin/costing/orders
      await loadOrdersTable(filters);
      await loadProductsTable(filters);
      await loadRelaisTable(filters);

      // Bouton refresh
      document.getElementById('cost-orders-refresh').addEventListener('click', async (e) => {
        e.preventDefault();
        await loadOrdersTable(filters, true);
      });

      // Meta
      if (data.data_quality) {
        const meta = document.getElementById('cost-meta');
        const dq = data.data_quality;
        const cached = dq.is_cached
          ? `(cache ${dq.cache_age_seconds}s/${dq.cache_ttl_seconds}s)`
          : '(données fraîches)';
        meta.textContent = `Généré ${new Date(dq.generated_at).toLocaleTimeString('fr-FR')} ${cached}`;
        if (dq.warnings && dq.warnings.length) {
          meta.innerHTML += '<br>⚠️ ' + dq.warnings.join('<br>⚠️ ');
        }
        if (dq.incomplete_fields && dq.incomplete_fields.length) {
          meta.innerHTML += '<br>📋 Champs incomplets : ' + dq.incomplete_fields.join(', ');
        }
      }
    } catch (err) {
      console.error('[Costing] error:', err);
      document.getElementById('cost-kpis').innerHTML = `<div class="error-state">
        ❌ Erreur de chargement: ${err.message || 'inconnue'}
        ${err.status === 401 ? ' — connectez-vous comme admin' : ''}
      </div>`;
    }
  }

  /**
   * Charge le tableau détaillé des commandes via /api/admin/costing/orders.
   */
  async function loadOrdersTable(filters, force = false) {
    const tableEl = document.getElementById('cost-orders-table');
    tableEl.innerHTML = '<div class="loading-state"><span class="loader"></span> Chargement détails...</div>';

    try {
      const qs = new URLSearchParams();
      if (filters.from)   qs.set('from', filters.from);
      if (filters.to)     qs.set('to', filters.to);
      if (filters.island) qs.set('island', filters.island);
      qs.set('limit', '50');
      if (force) qs.set('refresh', '1');

      const res = await fetch(`/api/admin/costing/orders?${qs.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      const orders = data.orders || [];

      DataTable.render(tableEl, {
        emptyText: 'Aucune commande sur cette période',
        columns: [
          { key: 'reference', label: 'Réf', cls: 'ref' },
          {
            key: 'sale_total_kmf',
            label: 'Total',
            align: 'right',
            render: (row) => Number(row.sale_total_kmf || 0).toLocaleString('fr-FR'),
          },
          {
            key: 'estimated.business_complete_cost_kmf',
            label: 'Coût estimé',
            align: 'right',
            render: (row) => row.estimated && row.estimated.business_complete_cost_kmf != null
              ? Number(row.estimated.business_complete_cost_kmf).toLocaleString('fr-FR')
              : '—',
          },
          {
            key: 'real.total_kmf',
            label: 'Coût réel',
            align: 'right',
            render: (row) => row.real && row.real.total_kmf != null
              ? Number(row.real.total_kmf).toLocaleString('fr-FR')
              : '—',
          },
          {
            key: 'variance.total_kmf',
            label: 'Variance',
            align: 'right',
            render: (row) => {
              if (!row.variance || row.variance.total_kmf == null) return '—';
              const v = row.variance.total_kmf;
              const cls = v > 0 ? 'is-red' : (v < 0 ? 'is-green' : 'is-gray');
              const sign = v > 0 ? '+' : '';
              return `<span class="badge ${cls}">${sign}${Number(v).toLocaleString('fr-FR')}</span>`;
            },
          },
          {
            key: 'estimated.margin_pct',
            label: 'Marge est.',
            align: 'right',
            render: (row) => row.estimated && row.estimated.margin_pct != null
              ? row.estimated.margin_pct.toFixed(1) + '%'
              : '—',
          },
          {
            key: 'cost_status',
            label: 'Statut coût',
            render: (row) => BadgeStatus.costStatus(row.cost_status || 'incomplete'),
          },
        ],
        rows: orders,
      });
    } catch (err) {
      tableEl.innerHTML = `<div class="error-state">Erreur: ${esc(err.message)}</div>`; // FRESH-104
    }
  }

  async function loadProductsTable(filters) {
    const tableEl = document.getElementById('cost-products-table');
    tableEl.innerHTML = '<div class="loading-state"><span class="loader"></span></div>';
    try {
      const qs = new URLSearchParams();
      if (filters.from) qs.set('from', filters.from);
      if (filters.to)   qs.set('to', filters.to);
      qs.set('limit', '10');
      const res = await fetch(`/api/admin/costing/products?${qs.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      DataTable.render(tableEl, {
        emptyText: 'Aucune donnée produit',
        columns: [
          { key: 'product_name', label: 'Produit' },
          { key: 'quantity_sold', label: 'Qty', align: 'right' },
          {
            key: 'revenue_kmf',
            label: 'CA',
            align: 'right',
            render: (row) => Number(row.revenue_kmf || 0).toLocaleString('fr-FR'),
          },
          {
            key: 'estimated.avg_margin_pct',
            label: 'Marge %',
            align: 'right',
            render: (row) => row.estimated && row.estimated.avg_margin_pct != null
              ? row.estimated.avg_margin_pct.toFixed(1) + '%'
              : '—',
          },
          {
            key: 'cost_status',
            label: 'Statut',
            render: (row) => BadgeStatus.costStatus(row.cost_status || 'estimated'),
          },
        ],
        rows: data.products || [],
      });
    } catch (err) {
      tableEl.innerHTML = `<div class="error-state">Erreur: ${esc(err.message)}</div>`; // FRESH-104
    }
  }

  async function loadRelaisTable(filters) {
    const tableEl = document.getElementById('cost-relais-table');
    tableEl.innerHTML = '<div class="loading-state"><span class="loader"></span></div>';
    try {
      const qs = new URLSearchParams();
      if (filters.from) qs.set('from', filters.from);
      if (filters.to)   qs.set('to', filters.to);
      const res = await fetch(`/api/admin/costing/relais?${qs.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      DataTable.render(tableEl, {
        emptyText: 'Aucune donnée relais',
        columns: [
          { key: 'relais_name', label: 'Relais' },
          { key: 'orders_count', label: 'Cmds', align: 'right' },
          {
            key: 'revenue_kmf',
            label: 'CA',
            align: 'right',
            render: (row) => Number(row.revenue_kmf || 0).toLocaleString('fr-FR'),
          },
          {
            key: 'estimated.margin_pct',
            label: 'Marge est.',
            align: 'right',
            render: (row) => row.estimated && row.estimated.margin_pct != null
              ? row.estimated.margin_pct.toFixed(1) + '%'
              : '—',
          },
          {
            key: 'incomplete_imputations_count',
            label: 'Incomplets',
            align: 'right',
            render: (row) => {
              const n = Number(row.incomplete_imputations_count || 0);
              if (n === 0) return '<span class="badge is-green">0</span>';
              return `<span class="badge is-orange">${n}</span>`;
            },
          },
        ],
        rows: data.relais || [],
      });
    } catch (err) {
      tableEl.innerHTML = `<div class="error-state">Erreur: ${esc(err.message)}</div>`; // FRESH-104
    }
  }

  function bindAlertActions() {
    const alertsEl = document.getElementById('cost-alerts');
    alertsEl.querySelectorAll('.alert-action').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const url = btn.getAttribute('href');
        // Si c'est une URL absolue, laisser naviguer
        if (url && (url.startsWith('http') || url.startsWith('/'))) return;
        e.preventDefault();
      });
    });
  }

  global.CostingView = { render };
})(window);
