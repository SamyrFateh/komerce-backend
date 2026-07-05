'use strict';

/**
 * tests/unit/ControlTowerView.test.js
 *
 * admin/js/views/ControlTowerView.js (569L) — Vue Tour de contrôle
 * /admin/control-tower. Export réel : window.ControlTowerView = { render }
 * (IIFE, render async).
 *
 * Sources API (globals mockés) :
 *   - KmcFilters.get() → filtres passés à getControlTower/getOps
 *   - KmcApi.getControlTower(filters)   (jamais catché — erreur → catch global)
 *   - KmcApi.getOps(filters).catch(() => null)        → SLA & délais (section H)
 *   - KmcApi.getUnsoldStats().catch(() => null)       → invendus (section I)
 * Composants globaux (mockés, NON optionnels — toujours appelés) :
 *   - KpiCard.renderBar, Charts.renderLineChart/renderDonutChart,
 *     AlertList.renderList, DataTable.render, BadgeStatus.status
 *
 * Périmètre couvert :
 *   - render() : shell (10 ids), KmcFilters.get(), 3 appels API en parallèle,
 *     guard rootEl détaché, erreur globale (catch) avec/sans 401
 *   - KPI bar : KpiCard.renderBar avec data.kpis (fallback [])
 *   - Charts : activity_timeline et status_breakdown conditionnels
 *   - Alertes : AlertList.renderList avec data.alerts (fallback [])
 *   - Table commandes à traiter : colonnes (payment_status/status/total_kmf/
 *     relais_name via BadgeStatus/fallback '—'), onRowClick → navigation
 *   - Table performance relais : colonne taux_retrait_pct avec seuils de
 *     couleur (>=70 vert, >=40 orange, sinon rouge)
 *   - _renderSla : données absentes, 4 buckets, délais moyens optionnels,
 *     table commandes en retard (XSS échappé) vs message OK si vide
 *   - _renderUnsold : données absentes, total=0 (OK), KPIs formatés
 *     (fmtShort), calcul remise %, répartition canaux conditionnelle
 *   - Meta : data_quality (cache vs frais, warnings concaténés)
 */

const { loadView, makeKmcApi, makeKmcFilters, makeKpiCard, cleanupGlobals } = require('./helpers/dashboardTestKit');

function baseControlTower(overrides) {
  return Object.assign({
    kpis: [{ key: 'ca', label: 'CA', value: '1M' }],
    charts: {},
    alerts: [],
    tables: { orders_to_handle: [], relais_performance: [] },
  }, overrides);
}

function baseOps(overrides) {
  return Object.assign({
    sla: { on_time: 40, warning: 5, late: 2, blocked: 1, details: { late: [] } },
    delais: { avg_preparation_jours: 1.2, avg_livraison_totale_jours: 3.4 },
  }, overrides);
}

function baseUnsold(overrides) {
  return Object.assign({
    total_actifs: 12,
    valeur_liquidation_kmf: 450000,
    valeur_initiale_kmf: 900000,
    jours_moy_en_stock: 45,
    canal_whatsapp: 5,
    canal_revendeur: 3,
    canal_both: 1,
  }, overrides);
}

describe('ControlTowerView', () => {
  let ControlTowerView;
  let main;

  beforeEach(() => {
    document.body.innerHTML = '<div id="main"></div>';
    main = document.getElementById('main');

    makeKmcFilters({ from: null, to: null });
    makeKpiCard();
    global.Charts = { renderLineChart: jest.fn(), renderDonutChart: jest.fn() };
    global.AlertList = { renderList: jest.fn() };
    global.DataTable = { render: jest.fn() };
    global.BadgeStatus = { status: jest.fn(s => `<span class="badge">${s}</span>`) };
  });

  afterEach(() => {
    document.getElementById('ctv-styles')?.remove();
    cleanupGlobals('KmcApi', 'KmcFilters', 'KpiCard');
    delete global.Charts;
    delete global.AlertList;
    delete global.DataTable;
    delete global.BadgeStatus;
  });

  function setupApi(overrides = {}) {
    return makeKmcApi(Object.assign({
      getControlTower: jest.fn().mockResolvedValue(baseControlTower()),
      getOps: jest.fn().mockResolvedValue(baseOps()),
      getUnsoldStats: jest.fn().mockResolvedValue(baseUnsold()),
    }, overrides));
  }

  function loadIt() {
    return loadView('../../admin/js/views/ControlTowerView.js', 'ControlTowerView');
  }

  function dataTableCallFor(el) {
    return global.DataTable.render.mock.calls.find(c => c[0] === el)[1];
  }

  it('expose render() (contrat app.js#invokeView)', () => {
    setupApi();
    ControlTowerView = loadIt();
    expect(typeof ControlTowerView.render).toBe('function');
  });

  describe('render() — shell et chargement', () => {
    it('pose le shell complet, lit KmcFilters, appelle les 3 endpoints', async () => {
      const api = setupApi();
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);

      ['ct-kpis', 'ct-activity-chart', 'ct-status-chart', 'ct-alerts',
       'ct-orders-table', 'ct-relais-table', 'ct-sla', 'ct-unsold', 'ct-meta']
        .forEach(id => expect(main.querySelector('#' + id)).toBeTruthy());

      expect(global.KmcFilters.get).toHaveBeenCalled();
      expect(api.getControlTower).toHaveBeenCalledWith({ from: null, to: null, island: null });
      expect(api.getOps).toHaveBeenCalledWith({ from: null, to: null, island: null });
      expect(api.getUnsoldStats).toHaveBeenCalledTimes(1);
    });

    it("n'exécute aucun rendu post-fetch si rootEl est détaché du DOM (guard navigation)", async () => {
      setupApi();
      ControlTowerView = loadIt();
      const detached = document.createElement('div');
      await ControlTowerView.render(detached);
      expect(global.KpiCard.renderBar).not.toHaveBeenCalled();
      expect(global.AlertList.renderList).not.toHaveBeenCalled();
    });

    it('erreur de chargement (getControlTower rejeté) affiche un message dans ct-kpis', async () => {
      setupApi({ getControlTower: jest.fn().mockRejectedValue(new Error('panne moteur')) });
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      expect(main.querySelector('#ct-kpis').innerHTML).toContain('panne moteur');
      expect(main.querySelector('#ct-kpis').innerHTML).not.toContain('connectez-vous comme admin');
    });

    it('erreur 401 ajoute une invite de reconnexion admin', async () => {
      const err = new Error('unauthorized');
      err.status = 401;
      setupApi({ getControlTower: jest.fn().mockRejectedValue(err) });
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      expect(main.querySelector('#ct-kpis').innerHTML).toContain('connectez-vous comme admin');
    });

    it('getOps et getUnsoldStats en échec sont tolérés (catch interne → null)', async () => {
      setupApi({
        getOps: jest.fn().mockRejectedValue(new Error('boom')),
        getUnsoldStats: jest.fn().mockRejectedValue(new Error('boom')),
      });
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      expect(main.querySelector('#ct-sla').innerHTML).toContain('Données SLA indisponibles');
      expect(main.querySelector('#ct-unsold').innerHTML).toContain('Données invendus indisponibles');
    });
  });

  describe('KPI bar', () => {
    it('appelle KpiCard.renderBar avec data.kpis', async () => {
      setupApi({ getControlTower: jest.fn().mockResolvedValue(baseControlTower({ kpis: [{ key: 'x', label: 'X', value: '1' }] })) });
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      expect(global.KpiCard.renderBar).toHaveBeenCalledWith(main.querySelector('#ct-kpis'), [{ key: 'x', label: 'X', value: '1' }]);
    });

    it('fallback tableau vide si data.kpis absent', async () => {
      setupApi({ getControlTower: jest.fn().mockResolvedValue({ tables: {} }) });
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      expect(global.KpiCard.renderBar).toHaveBeenCalledWith(main.querySelector('#ct-kpis'), []);
    });
  });

  describe('Charts', () => {
    it('rend le line chart uniquement si charts.activity_timeline est présent', async () => {
      setupApi({ getControlTower: jest.fn().mockResolvedValue(baseControlTower({ charts: { activity_timeline: [{ d: 1 }] } })) });
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      expect(global.Charts.renderLineChart).toHaveBeenCalledWith(main.querySelector('#ct-activity-chart'), [{ d: 1 }]);
      expect(global.Charts.renderDonutChart).not.toHaveBeenCalled();
    });

    it('rend le donut chart avec keyField/valueField si status_breakdown est présent', async () => {
      setupApi({ getControlTower: jest.fn().mockResolvedValue(baseControlTower({ charts: { status_breakdown: [{ status: 'ok', count: 3 }] } })) });
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      expect(global.Charts.renderDonutChart).toHaveBeenCalledWith(
        main.querySelector('#ct-status-chart'),
        [{ status: 'ok', count: 3 }],
        { keyField: 'status', valueField: 'count' }
      );
    });

    it("ne rend aucun chart si charts est vide", async () => {
      setupApi();
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      expect(global.Charts.renderLineChart).not.toHaveBeenCalled();
      expect(global.Charts.renderDonutChart).not.toHaveBeenCalled();
    });
  });

  describe('Alertes', () => {
    it('délègue à AlertList.renderList avec data.alerts et les options', async () => {
      setupApi({ getControlTower: jest.fn().mockResolvedValue(baseControlTower({ alerts: [{ title: 'x' }] })) });
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      expect(global.AlertList.renderList).toHaveBeenCalledWith(
        main.querySelector('#ct-alerts'),
        [{ title: 'x' }],
        { limit: 8, emptyText: 'Aucune alerte critique en cours' }
      );
    });

    it('fallback tableau vide si data.alerts absent', async () => {
      setupApi({ getControlTower: jest.fn().mockResolvedValue({ tables: {} }) });
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      expect(global.AlertList.renderList).toHaveBeenCalledWith(main.querySelector('#ct-alerts'), [], expect.any(Object));
    });
  });

  describe('Table commandes à traiter', () => {
    it("appelle DataTable.render avec les rows, et onRowClick construit l'URL de navigation sans lever d'exception", async () => {
      const orders = [{ id: 'o1', reference: 'CMD-1', payment_status: 'paid', status: 'confirmed', total_kmf: 15000, relais_name: 'Relais A' }];
      setupApi({ getControlTower: jest.fn().mockResolvedValue(baseControlTower({ tables: { orders_to_handle: orders, relais_performance: [] } })) });
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      const config = dataTableCallFor(main.querySelector('#ct-orders-table'));
      expect(config.rows).toBe(orders);
      expect(config.emptyText).toBe('Aucune commande à traiter');
      // jsdom refuse de réécrire location.href (propriété non configurable) — on vérifie
      // seulement que le callback est bien branché et ne lève pas, la navigation réelle
      // (window.location.href = `/admin/orders-logistics?order_id=${row.id}`) n'étant pas
      // simulable proprement dans cet environnement.
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      expect(typeof config.onRowClick).toBe('function');
      expect(() => config.onRowClick(orders[0])).not.toThrow();
      consoleSpy.mockRestore();
    });

    it('les colonnes utilisent BadgeStatus et un fallback pending/— ', async () => {
      const orders = [{ id: 'o2', reference: 'CMD-2', total_kmf: 5000 }]; // pas de payment_status/status/relais_name
      setupApi({ getControlTower: jest.fn().mockResolvedValue(baseControlTower({ tables: { orders_to_handle: orders, relais_performance: [] } })) });
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      const config = dataTableCallFor(main.querySelector('#ct-orders-table'));
      const row = orders[0];
      expect(config.columns.find(c => c.key === 'payment_status').render(row)).toBe('<span class="badge">pending</span>');
      expect(config.columns.find(c => c.key === 'status').render(row)).toBe('<span class="badge">pending</span>');
      expect(config.columns.find(c => c.key === 'relais_name').render(row)).toBe('—');
      expect(config.columns.find(c => c.key === 'total_kmf').render(row)).toContain('KMF');
    });
  });

  describe('Table performance relais', () => {
    it('appelle DataTable.render avec les rows relais', async () => {
      const relais = [{ relais_name: 'Mutsamudu', orders_count: 10, available: 3, collected: 6, taux_retrait_pct: 80 }];
      setupApi({ getControlTower: jest.fn().mockResolvedValue(baseControlTower({ tables: { orders_to_handle: [], relais_performance: relais } })) });
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      const config = dataTableCallFor(main.querySelector('#ct-relais-table'));
      expect(config.rows).toBe(relais);
    });

    it('taux de retrait >= 70% → badge vert', async () => {
      const relais = [{ relais_name: 'A', taux_retrait_pct: 75 }];
      setupApi({ getControlTower: jest.fn().mockResolvedValue(baseControlTower({ tables: { orders_to_handle: [], relais_performance: relais } })) });
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      const config = dataTableCallFor(main.querySelector('#ct-relais-table'));
      expect(config.columns.find(c => c.key === 'taux_retrait_pct').render(relais[0])).toContain('is-green');
    });

    it('taux de retrait entre 40% et 70% → badge orange', async () => {
      const relais = [{ relais_name: 'A', taux_retrait_pct: 50 }];
      setupApi({ getControlTower: jest.fn().mockResolvedValue(baseControlTower({ tables: { orders_to_handle: [], relais_performance: relais } })) });
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      const config = dataTableCallFor(main.querySelector('#ct-relais-table'));
      expect(config.columns.find(c => c.key === 'taux_retrait_pct').render(relais[0])).toContain('is-orange');
    });

    it('taux de retrait < 40% → badge rouge', async () => {
      const relais = [{ relais_name: 'A', taux_retrait_pct: 20 }];
      setupApi({ getControlTower: jest.fn().mockResolvedValue(baseControlTower({ tables: { orders_to_handle: [], relais_performance: relais } })) });
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      const config = dataTableCallFor(main.querySelector('#ct-relais-table'));
      expect(config.columns.find(c => c.key === 'taux_retrait_pct').render(relais[0])).toContain('is-red');
    });
  });

  describe('_renderSla (section H)', () => {
    it('affiche un état vide quand ops.sla est absent', async () => {
      setupApi({ getOps: jest.fn().mockResolvedValue({}) });
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      expect(main.querySelector('#ct-sla').innerHTML).toContain('Données SLA indisponibles');
    });

    it('affiche les 4 buckets avec leurs comptes', async () => {
      setupApi({ getOps: jest.fn().mockResolvedValue(baseOps({ sla: { on_time: 10, warning: 2, late: 1, blocked: 0, details: { late: [] } } })) });
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      const html = main.querySelector('#ct-sla').innerHTML;
      expect(html).toContain('Dans les délais');
      expect(html).toContain('En approche');
      expect(html).toContain('En retard');
      expect(html).toContain('Bloquées');
    });

    it('affiche les délais moyens quand présents', async () => {
      setupApi();
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      const html = main.querySelector('#ct-sla').innerHTML;
      expect(html).toContain('1.2j');
      expect(html).toContain('3.4j');
    });

    it("n'affiche pas la ligne délais si absente", async () => {
      setupApi({ getOps: jest.fn().mockResolvedValue({ sla: { on_time: 1, warning: 0, late: 0, blocked: 0, details: { late: [] } } }) });
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      expect(main.querySelector('#ct-sla').innerHTML).not.toContain('ctv-delays-row');
    });

    it('liste les commandes en retard avec échappement XSS', async () => {
      setupApi({
        getOps: jest.fn().mockResolvedValue(baseOps({
          sla: { on_time: 1, warning: 0, late: 1, blocked: 0, details: { late: [{ id: '<x>', reference: '<script>alert(1)</script>', status: 'late', jours: 5 }] } },
        })),
      });
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      const html = main.querySelector('#ct-sla').innerHTML;
      expect(html).toContain('Commandes en retard (1)');
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it("affiche un message OK quand aucune commande en retard", async () => {
      setupApi({ getOps: jest.fn().mockResolvedValue(baseOps({ sla: { on_time: 5, warning: 0, late: 0, blocked: 0, details: { late: [] } } })) });
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      expect(main.querySelector('#ct-sla').innerHTML).toContain('Aucune commande en retard détecté');
    });
  });

  describe('_renderUnsold (section I)', () => {
    it('affiche un état vide quand les stats sont absentes', async () => {
      setupApi({ getUnsoldStats: jest.fn().mockResolvedValue(null) });
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      expect(main.querySelector('#ct-unsold').innerHTML).toContain('Données invendus indisponibles');
    });

    it('affiche un message positif quand total_actifs = 0', async () => {
      setupApi({ getUnsoldStats: jest.fn().mockResolvedValue({ total_actifs: 0 }) });
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      expect(main.querySelector('#ct-unsold').innerHTML).toContain('Aucun invendu actif');
    });

    it('affiche les 4 KPI formatés et le calcul de remise', async () => {
      setupApi();
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      const html = main.querySelector('#ct-unsold').innerHTML;
      expect(html).toContain('12'); // total_actifs
      expect(html).toContain('450k KMF'); // fmtShort(450000)
      expect(html).toContain('900k KMF'); // fmtShort(900000)
      expect(html).toContain('45j');
      expect(html).toContain('−50%'); // 1 - 450000/900000 = 50%
    });

    it('affiche la répartition par canal quand au moins un canal > 0', async () => {
      setupApi();
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      const html = main.querySelector('#ct-unsold').innerHTML;
      expect(html).toContain('5 WhatsApp');
      expect(html).toContain('3 Revendeur');
      expect(html).toContain('1 Les deux');
    });

    it('masque la répartition canaux si tous à 0', async () => {
      setupApi({ getUnsoldStats: jest.fn().mockResolvedValue(baseUnsold({ canal_whatsapp: 0, canal_revendeur: 0, canal_both: 0 })) });
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      expect(main.querySelector('#ct-unsold').innerHTML).not.toContain('ctv-channel-bar');
    });

    it("valeur initiale à 0 → remise 0% (pas de division par zéro)", async () => {
      setupApi({ getUnsoldStats: jest.fn().mockResolvedValue(baseUnsold({ valeur_initiale_kmf: 0 })) });
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      expect(main.querySelector('#ct-unsold').innerHTML).toContain('−0%');
    });
  });

  describe('Meta (data_quality)', () => {
    it('affiche "(données fraîches)" quand is_cached est false', async () => {
      setupApi({ getControlTower: jest.fn().mockResolvedValue(baseControlTower({ data_quality: { is_cached: false, generated_at: new Date().toISOString() } })) });
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      expect(main.querySelector('#ct-meta').textContent).toContain('(données fraîches)');
    });

    it('affiche l\'âge du cache quand is_cached est true', async () => {
      setupApi({ getControlTower: jest.fn().mockResolvedValue(baseControlTower({
        data_quality: { is_cached: true, cache_age_seconds: 12, cache_ttl_seconds: 60, generated_at: new Date().toISOString() },
      })) });
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      expect(main.querySelector('#ct-meta').textContent).toContain('(cache 12s/60s)');
    });

    it('concatène les warnings quand présents', async () => {
      setupApi({ getControlTower: jest.fn().mockResolvedValue(baseControlTower({
        data_quality: { is_cached: false, generated_at: new Date().toISOString(), warnings: ['latence élevée', 'source partielle'] },
      })) });
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      expect(main.querySelector('#ct-meta').textContent).toContain('latence élevée · source partielle');
    });

    it('ne touche pas #ct-meta si data_quality est absent', async () => {
      setupApi();
      ControlTowerView = loadIt();
      await ControlTowerView.render(main);
      expect(main.querySelector('#ct-meta').textContent).toBe('');
    });
  });
});
