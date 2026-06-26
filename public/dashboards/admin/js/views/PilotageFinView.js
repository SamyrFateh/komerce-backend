/**
 * @komerce-arch
 * @role          admin-pilotage-fin-view
 * @domain        admin-dashboard
 * @layer         ui-page
 * @criticality   medium
 * @inputs        filters (from, to), projection and product mix data
 * @outputs       pilotage_fin_page_dom (projection CA, mix produit, scénarios)
 * @depends       api-client.js, filters-store.js, utils.js, components/Charts.js
 * @used-by       none
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      kmc_api_only
 * @impact-areas  finance, projection, product-mix, admin-dashboard
 * @version       2026-06
 */
/**
 * KOMERCE Dashboard — Vue Pilotage Financier /admin/pilotage-fin
 * ════════════════════════════════════════════════════════════════════════
 * Questions : Trajectoire du CA ? Mix catégories ? Fidélité ?
 *
 * Sources API :
 *   KmcApi.getEconomicHistory(params)   → /api/admin/economic/history
 *   KmcApi.getFinance(filters)          → /api/admin/dashboard/finance
 *   KmcApi.getEconomicVariables()       → /api/admin/economic/variables
 */

(function (global) {
  'use strict';

  async function render(rootEl) {
    const filters = KmcFilters.get();

    rootEl.innerHTML = `
      <h1 class="page-title">Pilotage Financier</h1>
      <p class="page-subtitle">Projections temporelles, mix catégories, marges</p>

      <section class="page-section">
        <div id="pf-kpis" class="kpi-bar">
          <div class="loading-state"><span class="loader"></span> Chargement...</div>
        </div>
      </section>

      <section class="page-section grid grid-2">
        <div class="card">
          <div class="card-header"><h3 class="card-title">📅 Trajectoire CA</h3></div>
          <div id="pf-chart-ca" style="min-height:200px;"></div>
        </div>
        <div class="card">
          <div class="card-header"><h3 class="card-title">🗂️ Mix catégories</h3></div>
          <div id="pf-chart-mix" style="min-height:200px;"></div>
        </div>
      </section>

      <section class="page-section">
        <div class="card">
          <div class="card-header"><h3 class="card-title">📊 Historique mensuel</h3></div>
          <div id="pf-history"></div>
        </div>
      </section>

      <section class="page-section">
        <div class="card">
          <div class="card-header"><h3 class="card-title">⚙️ Variables économiques</h3></div>
          <div id="pf-variables"></div>
        </div>
      </section>

      <p id="pf-meta" style="margin-top:16px;font-size:var(--fs-xs);color:var(--text-tertiary);"></p>
    `;

    try {
      const [finance, history, variables] = await Promise.all([
        KmcApi.getFinance(filters).catch(() => null),
        KmcApi.getEconomicHistory({ months: 6 }).catch(() => null),
        KmcApi.getEconomicVariables().catch(() => null),
      ]);

      // Guard : navigation entre-temps → rootEl détaché du DOM
      if (!rootEl || !document.contains(rootEl)) return;

      _renderKpis(document.getElementById('pf-kpis'), finance);
      _renderChartCA(document.getElementById('pf-chart-ca'), history);
      _renderChartMix(document.getElementById('pf-chart-mix'), finance);
      _renderHistory(document.getElementById('pf-history'), history);
      _renderVariables(document.getElementById('pf-variables'), variables);

      document.getElementById('pf-meta').textContent =
        `Données financières — ${new Date().toLocaleTimeString('fr-FR')}`;

    } catch (err) {
      console.error('[PilotageFinView] error:', err);
      document.getElementById('pf-kpis').innerHTML =
        `<div class="error-state">❌ Erreur : ${err.message || 'inconnue'}</div>`;
    }
  }

  function _renderKpis(el, finance) {
    if (!finance) { el.innerHTML = ''; return; }
    const k = finance.kpis || finance;
    const fmt  = (n) => Number(n || 0).toLocaleString('fr-FR') + ' KMF';
    const fmtp = (n) => Number(n || 0).toFixed(1) + '%';

    KpiCard.renderBar(el, [
      { key: 'ca_total',        label: 'CA total période',   value: fmt(k.ca_total_kmf    || k.revenue_kmf) },
      { key: 'marge_estimee',   label: 'Marge estimée',      value: fmt(k.marge_estimee_kmf) },
      { key: 'marge_reelle',    label: 'Marge réelle',       value: fmt(k.marge_reelle_kmf) },
      { key: 'marge_pct',       label: 'Taux de marge',      value: fmtp(k.marge_pct     || k.margin_pct) },
      { key: 'cout_estime',     label: 'Coût estimé',        value: fmt(k.cout_estime_kmf || k.estimated_cost_kmf) },
      { key: 'cout_reel',       label: 'Coût réel',          value: fmt(k.cout_reel_kmf  || k.real_cost_kmf) },
    ]);
  }

  function _renderChartCA(el, history) {
    if (!history) {
      el.innerHTML = '<div class="empty-state" style="padding:20px;">Historique indisponible</div>';
      return;
    }
    const months = history.months || history.data || [];
    if (!months.length) {
      el.innerHTML = '<div class="empty-state" style="padding:20px;">Aucune donnée sur la période</div>';
      return;
    }
    Charts.renderLine(el, {
      labels: months.map(m => m.label || m.month || m.period),
      datasets: [{
        label: 'CA (KMF)',
        data: months.map(m => Number(m.ca_kmf || m.revenue_kmf || m.ca || 0)),
      }],
    });
  }

  function _renderChartMix(el, finance) {
    const mix = finance?.charts?.category_mix || finance?.category_mix;
    if (!mix) {
      el.innerHTML = '<div class="empty-state" style="padding:20px;">Mix catégories indisponible</div>';
      return;
    }
    const items = Array.isArray(mix) ? mix : (mix.items || []);
    if (!items.length) {
      el.innerHTML = '<div class="empty-state" style="padding:20px;">Aucune catégorie sur la période</div>';
      return;
    }
    Charts.renderBar(el, {
      labels: items.map(i => i.label || i.category || i.name),
      datasets: [{
        label: 'CA par catégorie (KMF)',
        data: items.map(i => Number(i.ca_kmf || i.revenue || i.value || 0)),
      }],
    });
  }

  function _renderHistory(el, history) {
    const months = history?.months || history?.data || [];
    DataTable.render(el, {
      emptyText: 'Aucun historique disponible',
      columns: [
        { key: 'period',   label: 'Période',    render: (r) => r.label || r.month || r.period || '—' },
        { key: 'ca',       label: 'CA',         align: 'right',
          render: (r) => Number(r.ca_kmf || r.revenue_kmf || r.ca || 0).toLocaleString('fr-FR') + ' KMF' },
        { key: 'orders',   label: 'Commandes',  align: 'right',
          render: (r) => Number(r.orders || r.orders_count || 0).toLocaleString('fr-FR') },
        { key: 'marge',    label: 'Marge réelle', align: 'right',
          render: (r) => r.marge_pct != null ? Number(r.marge_pct).toFixed(1) + '%' : '—' },
        { key: 'cout',     label: 'Coût réel',  align: 'right',
          render: (r) => r.cout_reel_kmf != null
            ? Number(r.cout_reel_kmf).toLocaleString('fr-FR') + ' KMF' : '—' },
      ],
      rows: months,
    });
  }

  function _renderVariables(el, variables) {
    if (!variables) {
      el.innerHTML = '<div class="empty-state" style="padding:14px;">Variables économiques indisponibles</div>';
      return;
    }
    const rows = variables.variables || variables.items || (Array.isArray(variables) ? variables : []);
    DataTable.render(el, {
      emptyText: 'Aucune variable configurée',
      columns: [
        { key: 'code',     label: 'Code',      render: (r) => `<code>${r.code || r.key || '—'}</code>` },
        { key: 'label',    label: 'Libellé',   render: (r) => r.label || r.name || '—' },
        { key: 'value',    label: 'Valeur',    align: 'right',
          render: (r) => {
            const v = r.value_kmf ?? r.value ?? r.amount;
            const u = r.unit || (r.value_kmf != null ? 'KMF' : '');
            return v != null ? `${Number(v).toLocaleString('fr-FR')} ${u}` : '—';
          }
        },
        { key: 'updated',  label: 'Mis à jour', render: (r) => r.updated_at
          ? new Date(r.updated_at).toLocaleDateString('fr-FR') : '—' },
      ],
      rows,
    });
  }

  global.PilotageFinView = { render };
})(window);
