'use strict';

/**
 * tests/unit/OrdersLogisticsView.test.js
 *
 * admin/js/views/OrdersLogisticsView.js (255L) — Vue Commandes & logistique
 * /admin/orders-logistics. Export réel : window.OrdersLogisticsView =
 * { render } (IIFE, render async).
 *
 * Sources API (globals mockés) :
 *   - KmcFilters.get() → filtres
 *   - KmcApi.getLogistics(filters)   appelé DEUX FOIS : une fois dans
 *     render() (données principales, jamais catché → erreur → catch
 *     global), une fois dans loadExceptions() (alertes, jamais catché non
 *     plus → une erreur ici remonte aussi au catch global même si le
 *     premier appel a réussi)
 *   - KmcApi.getOrders({ ...filters, limit: 50 }) dans loadOrdersOpsTable,
 *     catché localement (affiche un message d'erreur dans la table, ne
 *     remonte jamais au catch global)
 * Composants globaux (mockés, NON optionnels — toujours appelés) :
 *   - KpiCard.renderBar, Charts.renderFunnel (conditionnel), AlertList.renderList,
 *     DataTable.render, BadgeStatus.status
 *
 * Périmètre couvert :
 *   - render() : shell (8 ids), KmcFilters.get(), 2 appels getLogistics,
 *     guard rootEl détaché, erreur globale (catch) avec/sans 401
 *   - KPI bar : KpiCard.renderBar avec data.kpis (fallback [])
 *   - Charts : ops_pipeline et parcel_flow conditionnels
 *   - Routage : contenu fixe (placeholder V1)
 *   - Exceptions : AlertList.renderList avec data.alerts (fallback []) et
 *     les options { limit: 10, emptyText }
 *   - loadOrdersOpsTable : colonnes (reference/destinataire/destination_island
 *     badge/relais_name échappés XSS, payment_status/status via
 *     BadgeStatus, total_kmf formaté, updated_at avec fallback —),
 *     extraction rows (orders/items/array/fallback), erreur API (message
 *     échappé), erreur DataTable.render (message générique Sprint 5+)
 *   - Bouton rafraîchir : re-déclenche loadOrdersOpsTable avec { refresh: '1' }
 *   - Meta : data_quality (cache vs frais, warnings concaténés en <br>)
 */

const {
  loadView, makeKmcApi, makeKmcFilters, makeKpiCard, cleanupGlobals, flush,
} = require('./helpers/dashboardTestKit');

function baseLogistics(overrides) {
  return Object.assign({
    kpis: [{ key: 'ops', label: 'Ops', value: '1' }],
    charts: {},
    alerts: [],
  }, overrides);
}

describe('OrdersLogisticsView', () => {
  let View;
  let root;

  beforeEach(() => {
    document.body.innerHTML = '<div id="main"></div>';
    root = document.getElementById('main');

    makeKpiCard();
    global.Charts = { renderFunnel: jest.fn() };
    global.AlertList = { renderList: jest.fn() };
    global.DataTable = { render: jest.fn() };
    global.BadgeStatus = { status: jest.fn((s) => { const span = document.createElement('span'); span.className = `badge is-${s}`; span.textContent = s; return span; }) };

    View = loadView('../../dashboards/admin/js/views/OrdersLogisticsView.js', 'OrdersLogisticsView');
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
      getLogistics: jest.fn().mockResolvedValue(baseLogistics()),
      getOrders: jest.fn().mockResolvedValue([]),
    }, overrides));
  }

  function dataTableCallFor(el) {
    const call = global.DataTable.render.mock.calls.find(c => c[0] === el);
    return call ? call[1] : undefined;
  }

  it('expose render() (contrat app.js#invokeView)', () => {
    setupApi();
    expect(typeof View.render).toBe('function');
  });

  describe('render() — shell et chargement', () => {
    it('pose le shell complet, lit KmcFilters, appelle getLogistics deux fois', async () => {
      const api = setupApi();
      makeKmcFilters({ from: '2026-06-01', to: '2026-07-01' });

      await View.render(root);

      ['ops-kpis', 'ops-pipeline-chart', 'ops-parcel-chart', 'ops-orders-table',
       'ops-orders-refresh', 'ops-exceptions', 'ops-routing', 'ops-meta']
        .forEach(id => expect(root.querySelector('#' + id)).toBeTruthy());

      expect(global.KmcFilters.get).toHaveBeenCalled();
      expect(api.getLogistics).toHaveBeenCalledTimes(2);
      expect(api.getLogistics).toHaveBeenCalledWith({ from: '2026-06-01', to: '2026-07-01', island: null });
    });

    it("n'exécute aucun rendu post-fetch si rootEl est détaché du DOM (guard navigation)", async () => {
      setupApi();
      makeKmcFilters();
      const detached = document.createElement('div');
      Object.defineProperty(detached, 'querySelector', { value: root.querySelector.bind(root) });

      await View.render(detached);

      expect(global.KpiCard.renderBar).not.toHaveBeenCalled();
      expect(global.AlertList.renderList).not.toHaveBeenCalled();
      expect(global.DataTable.render).not.toHaveBeenCalled();
    });

    it('erreur globale (getLogistics principal rejeté) : affiche un message dans #ops-kpis', async () => {
      setupApi({ getLogistics: jest.fn().mockRejectedValue(new Error('panne logistique')) });
      makeKmcFilters();

      await View.render(root);

      expect(root.querySelector('#ops-kpis').innerHTML).toContain('panne logistique');
      expect(root.querySelector('#ops-kpis').innerHTML).not.toContain('connectez-vous comme admin');
    });

    it('erreur globale (2e appel getLogistics dans loadExceptions rejeté) : remonte aussi au catch', async () => {
      const api = makeKmcApi({
        getLogistics: jest.fn()
          .mockResolvedValueOnce(baseLogistics())
          .mockRejectedValueOnce(new Error('exceptions KO')),
        getOrders: jest.fn().mockResolvedValue([]),
      });
      makeKmcFilters();

      await View.render(root);

      expect(api.getLogistics).toHaveBeenCalledTimes(2);
      expect(root.querySelector('#ops-kpis').innerHTML).toContain('exceptions KO');
    });

    it('erreur 401 ajoute une invite de reconnexion admin', async () => {
      const err = new Error('unauthorized');
      err.status = 401;
      setupApi({ getLogistics: jest.fn().mockRejectedValue(err) });
      makeKmcFilters();

      await View.render(root);

      expect(root.querySelector('#ops-kpis').innerHTML).toContain('connectez-vous comme admin');
    });

    it('erreur sans message : fallback "inconnue"', async () => {
      setupApi({ getLogistics: jest.fn().mockRejectedValue({}) });
      makeKmcFilters();

      await View.render(root);

      expect(root.querySelector('#ops-kpis').innerHTML).toContain('inconnue');
    });
  });

  describe('KPI bar', () => {
    it('appelle KpiCard.renderBar avec data.kpis', async () => {
      setupApi({ getLogistics: jest.fn().mockResolvedValue(baseLogistics({ kpis: [{ key: 'x', value: '1' }] })) });
      makeKmcFilters();

      await View.render(root);

      expect(global.KpiCard.renderBar).toHaveBeenCalledWith(root.querySelector('#ops-kpis'), [{ key: 'x', value: '1' }]);
    });

    it('fallback tableau vide si data.kpis absent', async () => {
      setupApi({ getLogistics: jest.fn().mockResolvedValue({}) });
      makeKmcFilters();

      await View.render(root);

      expect(global.KpiCard.renderBar).toHaveBeenCalledWith(root.querySelector('#ops-kpis'), []);
    });
  });

  describe('Charts (pipeline / colis)', () => {
    it('rend le funnel pipeline si charts.ops_pipeline est présent', async () => {
      const ops_pipeline = { steps: [] };
      setupApi({ getLogistics: jest.fn().mockResolvedValue(baseLogistics({ charts: { ops_pipeline } })) });
      makeKmcFilters();

      await View.render(root);

      expect(global.Charts.renderFunnel).toHaveBeenCalledWith(root.querySelector('#ops-pipeline-chart'), ops_pipeline);
    });

    it('rend le funnel colis si charts.parcel_flow est présent', async () => {
      const parcel_flow = { steps: [] };
      setupApi({ getLogistics: jest.fn().mockResolvedValue(baseLogistics({ charts: { parcel_flow } })) });
      makeKmcFilters();

      await View.render(root);

      expect(global.Charts.renderFunnel).toHaveBeenCalledWith(root.querySelector('#ops-parcel-chart'), parcel_flow);
    });

    it("n'appelle aucun funnel si charts est vide", async () => {
      setupApi({ getLogistics: jest.fn().mockResolvedValue(baseLogistics({ charts: {} })) });
      makeKmcFilters();

      await View.render(root);

      expect(global.Charts.renderFunnel).not.toHaveBeenCalled();
    });
  });

  describe('Routage inter-îles', () => {
    it('affiche le placeholder V1 (endpoint non branché)', async () => {
      setupApi();
      makeKmcFilters();

      await View.render(root);

      expect(root.querySelector('#ops-routing').innerHTML).toContain('Données de routage non disponibles');
    });
  });

  describe('Exceptions opérationnelles', () => {
    it('délègue à AlertList.renderList avec data.alerts et les options', async () => {
      const alerts = [{ id: 1, level: 'critical' }];
      setupApi({ getLogistics: jest.fn().mockResolvedValue(baseLogistics({ alerts })) });
      makeKmcFilters();

      await View.render(root);

      expect(global.AlertList.renderList).toHaveBeenCalledWith(
        root.querySelector('#ops-exceptions'),
        alerts,
        { limit: 10, emptyText: 'Aucune exception opérationnelle' }
      );
    });

    it('fallback [] si data.alerts absent', async () => {
      setupApi({ getLogistics: jest.fn().mockResolvedValue({}) });
      makeKmcFilters();

      await View.render(root);

      expect(global.AlertList.renderList).toHaveBeenCalledWith(
        root.querySelector('#ops-exceptions'),
        [],
        expect.any(Object)
      );
    });
  });

  describe('loadOrdersOpsTable — tableau commandes', () => {
    it('appelle getOrders avec { ...filters, limit: 50 } et configure les colonnes', async () => {
      const row = {
        reference: 'CMD-1', recipient_name: 'Client A', destination_island: 'GC',
        relais_name: 'Relais Moroni', payment_status: 'paid', status: 'shipped',
        total_kmf: 1500, updated_at: '2026-06-10T00:00:00Z',
      };
      const api = setupApi({ getOrders: jest.fn().mockResolvedValue([row]) });
      makeKmcFilters({ from: 'A', to: 'B' });

      await View.render(root);

      expect(api.getOrders).toHaveBeenCalledWith({ from: 'A', to: 'B', island: null, limit: 50 });

      const config = dataTableCallFor(root.querySelector('#ops-orders-table'));
      expect(config.rows).toEqual([row]);
      expect(config.columns.find(c => c.key === 'reference').render(row)).toBe('CMD-1');
      expect(config.columns.find(c => c.key === 'destinataire').render(row)).toBe('Client A');
      expect(config.columns.find(c => c.key === 'destination_island').render(row)).toBe('<span class="badge is-blue">GC</span>');
      expect(config.columns.find(c => c.key === 'relais_name').render(row)).toBe('Relais Moroni');
      expect(config.columns.find(c => c.key === 'total_kmf').render(row)).toBe('1\u202f500');
      expect(config.columns.find(c => c.key === 'updated_at').render(row)).toBe('10/06/2026');
    });

    it('échappe le XSS dans reference/destinataire/relais_name/destination_island', async () => {
      const row = {
        reference: '<script>alert(1)</script>',
        recipient_name: '<img src=x onerror=alert(2)>',
        relais_name: '<b>Relais</b>',
        destination_island: '<i>X</i>',
      };
      setupApi({ getOrders: jest.fn().mockResolvedValue([row]) });
      makeKmcFilters();

      await View.render(root);

      const config = dataTableCallFor(root.querySelector('#ops-orders-table'));
      expect(config.columns.find(c => c.key === 'reference').render(row)).not.toContain('<script>');
      expect(config.columns.find(c => c.key === 'destinataire').render(row)).not.toContain('<img');
      expect(config.columns.find(c => c.key === 'relais_name').render(row)).not.toContain('<b>');
      expect(config.columns.find(c => c.key === 'destination_island').render(row)).not.toContain('<i>X</i>');
    });

    it('badge île : Anjouan → is-amber, autre → is-gray, absent → —/is-gray', async () => {
      setupApi();
      makeKmcFilters();
      await View.render(root);
      const config = dataTableCallFor(root.querySelector('#ops-orders-table'));
      // config existe même pour rows vides ? Non : DataTable.render est quand même appelé avec rows: []
      expect(config.columns.find(c => c.key === 'destination_island').render({ destination_island: 'Anjouan' }))
        .toBe('<span class="badge is-amber">Anjouan</span>');
      expect(config.columns.find(c => c.key === 'destination_island').render({ destination_island: 'Mayotte' }))
        .toBe('<span class="badge is-gray">Mayotte</span>');
      expect(config.columns.find(c => c.key === 'destination_island').render({}))
        .toBe('<span class="badge is-gray">—</span>');
    });

    it('délègue payment_status/status à BadgeStatus.status avec fallback "pending"', async () => {
      setupApi({ getOrders: jest.fn().mockResolvedValue([{}]) });
      makeKmcFilters();

      await View.render(root);

      const config = dataTableCallFor(root.querySelector('#ops-orders-table'));
      config.columns.find(c => c.key === 'payment_status').render({});
      config.columns.find(c => c.key === 'status').render({});
      expect(global.BadgeStatus.status).toHaveBeenCalledWith('pending');
    });

    it('colonnes : fallback "—" pour reference/destinataire/relais_name/updated_at quand absents', async () => {
      setupApi({ getOrders: jest.fn().mockResolvedValue([{}]) });
      makeKmcFilters();

      await View.render(root);

      const config = dataTableCallFor(root.querySelector('#ops-orders-table'));
      expect(config.columns.find(c => c.key === 'reference').render({})).toBe('—');
      expect(config.columns.find(c => c.key === 'destinataire').render({})).toBe('—');
      expect(config.columns.find(c => c.key === 'relais_name').render({})).toBe('—');
      expect(config.columns.find(c => c.key === 'updated_at').render({})).toBe('—');
    });

    it('extrait les rows depuis data.orders, data.items, un tableau brut, ou [] par défaut', async () => {
      setupApi({ getOrders: jest.fn().mockResolvedValue({ orders: [{ id: 1 }] }) });
      makeKmcFilters();
      await View.render(root);
      expect(dataTableCallFor(root.querySelector('#ops-orders-table')).rows).toEqual([{ id: 1 }]);
    });

    it('extrait les rows depuis data.items si data.orders est absent', async () => {
      setupApi({ getOrders: jest.fn().mockResolvedValue({ items: [{ id: 2 }] }) });
      makeKmcFilters();
      await View.render(root);
      expect(dataTableCallFor(root.querySelector('#ops-orders-table')).rows).toEqual([{ id: 2 }]);
    });

    it('fallback [] si data n\'est ni un tableau, ni {orders}, ni {items}', async () => {
      setupApi({ getOrders: jest.fn().mockResolvedValue({ unexpected: true }) });
      makeKmcFilters();
      await View.render(root);
      expect(dataTableCallFor(root.querySelector('#ops-orders-table')).rows).toEqual([]);
    });

    it('erreur getOrders : affiche un message échappant le XSS du message d\'erreur', async () => {
      setupApi({ getOrders: jest.fn().mockRejectedValue(new Error('<script>alert(1)</script>')) });
      makeKmcFilters();

      await View.render(root);

      const html = root.querySelector('#ops-orders-table').innerHTML;
      expect(html).toContain('Erreur chargement commandes');
      expect(html).not.toContain('<script>alert(1)</script>');
    });

    it('erreur getOrders sans message : fallback "API indisponible"', async () => {
      setupApi({ getOrders: jest.fn().mockRejectedValue({}) });
      makeKmcFilters();

      await View.render(root);

      expect(root.querySelector('#ops-orders-table').innerHTML).toContain('API indisponible');
    });

    it('erreur DataTable.render : affiche le message générique Sprint 5+', async () => {
      setupApi({ getOrders: jest.fn().mockResolvedValue([{}]) });
      makeKmcFilters();
      global.DataTable.render = jest.fn(() => { throw new Error('boom'); });

      await View.render(root);

      expect(root.querySelector('#ops-orders-table').innerHTML).toContain('sera branché en Sprint 5+');
    });
  });

  describe('Bouton rafraîchir', () => {
    it('re-déclenche loadOrdersOpsTable avec { refresh: "1" } au click', async () => {
      const api = setupApi({ getOrders: jest.fn().mockResolvedValue([]) });
      makeKmcFilters({ from: 'A', to: 'B' });

      await View.render(root);
      expect(api.getOrders).toHaveBeenCalledTimes(1);

      root.querySelector('#ops-orders-refresh').dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
      await flush();

      expect(api.getOrders).toHaveBeenCalledTimes(2);
      expect(api.getOrders).toHaveBeenNthCalledWith(2, { from: 'A', to: 'B', island: null, limit: 50, refresh: '1' });
    });
  });

  describe('Meta (data_quality)', () => {
    it('affiche "(données fraîches)" quand is_cached est false', async () => {
      setupApi({ getLogistics: jest.fn().mockResolvedValue(baseLogistics({
        data_quality: { is_cached: false, generated_at: '2026-07-05T10:00:00Z' },
      })) });
      makeKmcFilters();

      await View.render(root);

      expect(root.querySelector('#ops-meta').textContent).toContain('(données fraîches)');
    });

    it('affiche l\'âge du cache quand is_cached est true', async () => {
      setupApi({ getLogistics: jest.fn().mockResolvedValue(baseLogistics({
        data_quality: { is_cached: true, cache_age_seconds: 30, generated_at: '2026-07-05T10:00:00Z' },
      })) });
      makeKmcFilters();

      await View.render(root);

      expect(root.querySelector('#ops-meta').textContent).toContain('(cache 30s)');
    });

    it('concatène les warnings en <br> quand présents', async () => {
      setupApi({ getLogistics: jest.fn().mockResolvedValue(baseLogistics({
        data_quality: { is_cached: false, generated_at: '2026-07-05T10:00:00Z', warnings: ['w1', 'w2'] },
      })) });
      makeKmcFilters();

      await View.render(root);

      const html = root.querySelector('#ops-meta').innerHTML;
      expect(html).toContain('w1');
      expect(html).toContain('w2');
      expect(html).toContain('<br>');
    });

    it('ne touche pas #ops-meta si data_quality est absent', async () => {
      setupApi();
      makeKmcFilters();

      await View.render(root);

      expect(root.querySelector('#ops-meta').textContent).toBe('');
    });
  });
});
