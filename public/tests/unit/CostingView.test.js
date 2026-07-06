'use strict';

/**
 * tests/unit/CostingView.test.js
 *
 * admin/js/views/CostingView.js (351L) — Vue Coût rendu relais /admin/costing.
 * Export réel : window.CostingView = { render } (IIFE, render async).
 *
 * Sources API (globals mockés) :
 *   - KmcFilters.get()
 *   - KmcApi.getCosting(filters)              (jamais catché → catch global)
 *   - KmcApi.getCostingOrders(qs)/.getCostingProducts(qs)/.getCostingRelais(qs)
 *     (chacune catchée localement → error-state par tableau)
 * Composants globaux (mockés) :
 *   - KpiCard.renderBar, Charts.renderLineChart/renderDonutChart,
 *     AlertList.renderList, DataTable.render, BadgeStatus.costStatus
 */

const { loadView, makeKmcApi, makeKmcFilters, makeKpiCard, cleanupGlobals, flush } = require('./helpers/dashboardTestKit');

function baseCosting(overrides) {
  return Object.assign({
    kpis: [{ key: 'marge', label: 'Marge', value: '12%' }],
    charts: {},
    alerts: [],
  }, overrides);
}

describe('CostingView', () => {
  let main;

  beforeEach(() => {
    document.body.innerHTML = '<div id="main"></div>';
    main = document.getElementById('main');

    makeKmcFilters({ from: null, to: null, island: null });
    makeKpiCard();
    global.Charts = { renderLineChart: jest.fn(), renderDonutChart: jest.fn() };
    global.AlertList = { renderList: jest.fn() };
    global.DataTable = { render: jest.fn() };
    global.BadgeStatus = { costStatus: jest.fn(s => `<span class="badge">${s}</span>`) };
  });

  afterEach(() => {
    cleanupGlobals('KmcApi', 'KmcFilters', 'KpiCard');
    delete global.Charts;
    delete global.AlertList;
    delete global.DataTable;
    delete global.BadgeStatus;
  });

  function setupApi(overrides = {}) {
    return makeKmcApi(Object.assign({
      getCosting: jest.fn().mockResolvedValue(baseCosting()),
      getCostingOrders: jest.fn().mockResolvedValue({ orders: [] }),
      getCostingProducts: jest.fn().mockResolvedValue({ products: [] }),
      getCostingRelais: jest.fn().mockResolvedValue({ relais: [] }),
    }, overrides));
  }

  function loadIt() {
    return loadView('../../dashboards/admin/js/views/CostingView.js', 'CostingView');
  }

  function dataTableCallFor(el) {
    return global.DataTable.render.mock.calls.find(c => c[0] === el)[1];
  }

  it('expose render() (contrat app.js#invokeView)', () => {
    setupApi();
    const View = loadIt();
    expect(typeof View.render).toBe('function');
  });

  it('pose le shell (kpis + timeline + famille + alertes + tableaux) avant résolution', async () => {
    let resolveCosting;
    setupApi({ getCosting: jest.fn(() => new Promise((r) => { resolveCosting = r; })) });
    const View = loadIt();
    const p = View.render(main);

    expect(main.querySelector('#cost-kpis')).toBeTruthy();
    expect(main.querySelector('#cost-timeline-chart')).toBeTruthy();
    expect(main.querySelector('#cost-family-chart')).toBeTruthy();
    expect(main.querySelector('#cost-alerts')).toBeTruthy();
    expect(main.querySelector('#cost-orders-table')).toBeTruthy();
    expect(main.querySelector('#cost-products-table')).toBeTruthy();
    expect(main.querySelector('#cost-relais-table')).toBeTruthy();

    resolveCosting(baseCosting());
    await p;
  });

  it('appelle getCosting avec KmcFilters.get(), puis les 3 tableaux en parallèle', async () => {
    makeKmcFilters({ from: '2026-06-01', to: '2026-06-30', island: 'ngazidja' });
    const api = setupApi();
    const View = loadIt();
    await View.render(main);

    expect(api.getCosting).toHaveBeenCalledWith({ from: '2026-06-01', to: '2026-06-30', island: 'ngazidja' });
    expect(api.getCostingOrders).toHaveBeenCalled();
    expect(api.getCostingProducts).toHaveBeenCalled();
    expect(api.getCostingRelais).toHaveBeenCalled();
  });

  it('KpiCard.renderBar reçoit data.kpis (fallback [])', async () => {
    setupApi({ getCosting: jest.fn().mockResolvedValue(baseCosting({ kpis: undefined })) });
    const View = loadIt();
    await View.render(main);
    expect(global.KpiCard.renderBar).toHaveBeenCalledWith(document.getElementById('cost-kpis'), []);
  });

  it('guard : rootEl détaché du DOM entre-temps → aucun rendu de composant', async () => {
    let resolveCosting;
    setupApi({ getCosting: jest.fn(() => new Promise((r) => { resolveCosting = r; })) });
    const View = loadIt();
    const p = View.render(main);
    main.remove();
    resolveCosting(baseCosting());
    await p;
    expect(global.KpiCard.renderBar).not.toHaveBeenCalled();
  });

  it('charts conditionnels : ca_cost_margin_timeline et real_cost_by_family absents → non appelés', async () => {
    setupApi({ getCosting: jest.fn().mockResolvedValue(baseCosting({ charts: {} })) });
    const View = loadIt();
    await View.render(main);
    expect(global.Charts.renderLineChart).not.toHaveBeenCalled();
    expect(global.Charts.renderDonutChart).not.toHaveBeenCalled();
  });

  it('charts présents → renderLineChart et renderDonutChart appelés avec les bons éléments/options', async () => {
    const timeline = [{ month: '2026-06', ca: 100 }];
    const family = [{ cost_type: 'transport', amount_kmf: 5000 }];
    setupApi({
      getCosting: jest.fn().mockResolvedValue(baseCosting({
        charts: { ca_cost_margin_timeline: timeline, real_cost_by_family: family },
      })),
    });
    const View = loadIt();
    await View.render(main);

    expect(global.Charts.renderLineChart).toHaveBeenCalledWith(
      document.getElementById('cost-timeline-chart'), timeline
    );
    expect(global.Charts.renderDonutChart).toHaveBeenCalledWith(
      document.getElementById('cost-family-chart'), family,
      { keyField: 'cost_type', valueField: 'amount_kmf' }
    );
  });

  it('alertes : niveau "warning" est remappé en "elevated" avant AlertList.renderList', async () => {
    setupApi({
      getCosting: jest.fn().mockResolvedValue(baseCosting({
        alerts: [{ level: 'warning', msg: 'x' }, { level: 'critical', msg: 'y' }],
      })),
    });
    const View = loadIt();
    await View.render(main);

    expect(global.AlertList.renderList).toHaveBeenCalledWith(
      document.getElementById('cost-alerts'),
      [{ level: 'elevated', msg: 'x' }, { level: 'critical', msg: 'y' }],
      { limit: 10, emptyText: 'Aucune alerte de coût' }
    );
  });

  it('erreur globale (getCosting rejeté) → error-state dans #cost-kpis, avec mention 401 si applicable', async () => {
    const err = new Error('Session expirée');
    err.status = 401;
    setupApi({ getCosting: jest.fn().mockRejectedValue(err) });
    const View = loadIt();
    await View.render(main);

    const kpisEl = document.getElementById('cost-kpis');
    expect(kpisEl.innerHTML).toContain('Session expirée');
    expect(kpisEl.innerHTML).toContain('connectez-vous comme admin');
  });

  it('erreur globale sans status 401 → pas de mention connexion admin', async () => {
    setupApi({ getCosting: jest.fn().mockRejectedValue(new Error('boom')) });
    const View = loadIt();
    await View.render(main);
    const kpisEl = document.getElementById('cost-kpis');
    expect(kpisEl.innerHTML).toContain('boom');
    expect(kpisEl.innerHTML).not.toContain('connectez-vous comme admin');
  });

  it('tableau commandes : colonnes rendues (total, coût estimé/réel, variance, marge, statut)', async () => {
    const order = {
      reference: 'CMD-1', sale_total_kmf: 12000,
      estimated: { business_complete_cost_kmf: 8000, margin_pct: 33.333 },
      real: { total_kmf: 8500 },
      variance: { total_kmf: 500 },
      cost_status: 'complete',
    };
    setupApi({ getCostingOrders: jest.fn().mockResolvedValue({ orders: [order] }) });
    const View = loadIt();
    await View.render(main);

    const opts = dataTableCallFor(document.getElementById('cost-orders-table'));
    expect(opts.rows).toEqual([order]);
    const colByKey = Object.fromEntries(opts.columns.map(c => [c.key, c]));
    expect(colByKey['sale_total_kmf'].render(order)).toBe(Number(12000).toLocaleString('fr-FR'));
    expect(colByKey['estimated.business_complete_cost_kmf'].render(order)).toBe(Number(8000).toLocaleString('fr-FR'));
    expect(colByKey['real.total_kmf'].render(order)).toBe(Number(8500).toLocaleString('fr-FR'));
    expect(colByKey['estimated.margin_pct'].render(order)).toBe('33.3%');
  });

  it('tableau commandes : render() de la colonne variance applique la bonne classe/signe', async () => {
    setupApi();
    const View = loadIt();
    await View.render(main);
    const opts = dataTableCallFor(document.getElementById('cost-orders-table'));
    const varianceCol = opts.columns.find(c => c.key === 'variance.total_kmf');

    expect(varianceCol.render({ variance: { total_kmf: 500 } })).toContain('is-red');
    expect(varianceCol.render({ variance: { total_kmf: 500 } })).toContain('+500');
    expect(varianceCol.render({ variance: { total_kmf: -200 } })).toContain('is-green');
    expect(varianceCol.render({ variance: { total_kmf: 0 } })).toContain('is-gray');
    expect(varianceCol.render({ variance: null })).toBe('—');
    expect(varianceCol.render({})).toBe('—');
  });

  it('tableau commandes : colonnes coût estimé/réel/marge affichent "—" si absents', async () => {
    setupApi();
    const View = loadIt();
    await View.render(main);
    const opts = dataTableCallFor(document.getElementById('cost-orders-table'));
    const estCost = opts.columns.find(c => c.key === 'estimated.business_complete_cost_kmf');
    const realCost = opts.columns.find(c => c.key === 'real.total_kmf');
    const margin = opts.columns.find(c => c.key === 'estimated.margin_pct');

    expect(estCost.render({})).toBe('—');
    expect(realCost.render({})).toBe('—');
    expect(margin.render({})).toBe('—');
    expect(margin.render({ estimated: { margin_pct: 12.34 } })).toBe('12.3%');
  });

  it('tableau commandes : statut coût utilise BadgeStatus.costStatus avec fallback "incomplete"', async () => {
    setupApi();
    const View = loadIt();
    await View.render(main);
    const opts = dataTableCallFor(document.getElementById('cost-orders-table'));
    const statusCol = opts.columns.find(c => c.key === 'cost_status');
    statusCol.render({});
    expect(global.BadgeStatus.costStatus).toHaveBeenCalledWith('incomplete');
  });

  it('échec loadOrdersTable → error-state échappé dans #cost-orders-table', async () => {
    setupApi({ getCostingOrders: jest.fn().mockRejectedValue(new Error('<b>boom</b>')) });
    const View = loadIt();
    await View.render(main);
    const tableEl = document.getElementById('cost-orders-table');
    expect(tableEl.innerHTML).toContain('&lt;b&gt;boom');
    expect(tableEl.innerHTML).not.toContain('<b>boom');
  });

  it('bouton rafraîchir : recharge le tableau commandes avec refresh=1 dans la query', async () => {
    const api = setupApi();
    const View = loadIt();
    await View.render(main);

    document.getElementById('cost-orders-refresh').click();
    await flush();

    const lastCall = api.getCostingOrders.mock.calls[api.getCostingOrders.mock.calls.length - 1][0];
    expect(lastCall.refresh).toBe('1');
  });

  it('tableau produits : colonnes CA/marge/statut avec fallback "—" et BadgeStatus "estimated"', async () => {
    setupApi();
    const View = loadIt();
    await View.render(main);
    const opts = dataTableCallFor(document.getElementById('cost-products-table'));
    const marginCol = opts.columns.find(c => c.key === 'estimated.avg_margin_pct');
    const statusCol = opts.columns.find(c => c.key === 'cost_status');

    expect(marginCol.render({})).toBe('—');
    expect(marginCol.render({ estimated: { avg_margin_pct: 8.5 } })).toBe('8.5%');
    statusCol.render({});
    expect(global.BadgeStatus.costStatus).toHaveBeenCalledWith('estimated');
  });

  it('échec loadProductsTable → error-state échappé dans #cost-products-table', async () => {
    setupApi({ getCostingProducts: jest.fn().mockRejectedValue(new Error('fail products')) });
    const View = loadIt();
    await View.render(main);
    expect(document.getElementById('cost-products-table').innerHTML).toContain('fail products');
  });

  it('tableau relais : colonne "incomplets" est verte à 0, orange sinon', async () => {
    setupApi();
    const View = loadIt();
    await View.render(main);
    const opts = dataTableCallFor(document.getElementById('cost-relais-table'));
    const col = opts.columns.find(c => c.key === 'incomplete_imputations_count');

    expect(col.render({ incomplete_imputations_count: 0 })).toContain('is-green');
    expect(col.render({})).toContain('is-green');
    expect(col.render({ incomplete_imputations_count: 3 })).toContain('is-orange');
    expect(col.render({ incomplete_imputations_count: 3 })).toContain('3');
  });

  it('échec loadRelaisTable → error-state échappé dans #cost-relais-table', async () => {
    setupApi({ getCostingRelais: jest.fn().mockRejectedValue(new Error('fail relais')) });
    const View = loadIt();
    await View.render(main);
    expect(document.getElementById('cost-relais-table').innerHTML).toContain('fail relais');
  });

  it('meta : data_quality cache → texte "(cache Xs/Ys)"', async () => {
    setupApi({
      getCosting: jest.fn().mockResolvedValue(baseCosting({
        data_quality: {
          is_cached: true, cache_age_seconds: 30, cache_ttl_seconds: 300,
          generated_at: '2026-07-05T10:00:00Z',
        },
      })),
    });
    const View = loadIt();
    await View.render(main);
    expect(document.getElementById('cost-meta').textContent).toContain('(cache 30s/300s)');
  });

  it('meta : data_quality frais + warnings + champs incomplets concaténés', async () => {
    setupApi({
      getCosting: jest.fn().mockResolvedValue(baseCosting({
        data_quality: {
          is_cached: false, generated_at: '2026-07-05T10:00:00Z',
          warnings: ['imputation manquante'],
          incomplete_fields: ['real.total_kmf'],
        },
      })),
    });
    const View = loadIt();
    await View.render(main);
    const meta = document.getElementById('cost-meta');
    expect(meta.textContent).toContain('(données fraîches)');
    expect(meta.innerHTML).toContain('imputation manquante');
    expect(meta.innerHTML).toContain('real.total_kmf');
  });

  it('pas de data_quality → #cost-meta reste vide', async () => {
    setupApi({ getCosting: jest.fn().mockResolvedValue(baseCosting()) });
    const View = loadIt();
    await View.render(main);
    expect(document.getElementById('cost-meta').textContent).toBe('');
  });
});
