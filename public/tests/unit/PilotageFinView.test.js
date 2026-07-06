'use strict';

/**
 * tests/unit/PilotageFinView.test.js
 *
 * admin/js/views/PilotageFinView.js (202L) — Vue Pilotage Financier
 * /admin/pilotage-fin. Export réel : window.PilotageFinView = { render }
 * (IIFE, render async).
 *
 * Sources API (globals mockés) :
 *   - KmcFilters.get() → filtres passés à getFinance
 *   - KmcApi.getFinance(filters).catch(() => null)
 *   - KmcApi.getEconomicHistory({ months: 6 }).catch(() => null)   → param
 *     FIXE, indépendant des filtres
 *   - KmcApi.getEconomicVariables().catch(() => null)
 *   Les 3 appels sont catchés individuellement : Promise.all ne rejette
 *   jamais depuis ces sources — seul un throw synchrone dans le bloc try
 *   atteint le catch global.
 * Composants globaux (mockés, NON optionnels — toujours appelés) :
 *   - KpiCard.renderBar, Charts.renderLine/renderBar, DataTable.render
 * esc/escAttr : chargés réellement depuis utils.js par loadView (deps de
 *   base), la vue les appelle bare (comme AccountingView).
 *
 * Périmètre couvert :
 *   - render() : shell (6 ids), KmcFilters.get(), 3 appels API en parallèle
 *     (finance filtré vs history { months: 6 } fixe), guard rootEl
 *     détaché, erreur globale (catch) avec/sans message
 *   - _renderKpis : 6 KPI depuis finance.kpis / finance top-level, clés
 *     alternatives (revenue_kmf/margin_pct/...), vide si finance null
 *   - _renderChartCA : indisponible si history null, vide si months=[],
 *     Charts.renderLine avec labels/data sinon
 *   - _renderChartMix : indisponible si mix absent, vide si items=[],
 *     Charts.renderBar avec labels/data sinon, formes charts.category_mix
 *     vs category_mix top-level, tableau brut vs {items}
 *   - _renderHistory : colonnes (period échappé, ca, orders, marge avec
 *     fallback —, cout avec fallback —)
 *   - _renderVariables : état vide si absent, colonnes (code échappé dans
 *     <code>, label échappé, valeur avec unité échappée et fallback —,
 *     updated formaté ou —), extraction rows (variables/items/array)
 *   - Meta : horodatage texte fixe
 */

const {
  loadView, makeKmcApi, makeKmcFilters, makeKpiCard, cleanupGlobals,
} = require('./helpers/dashboardTestKit');

describe('PilotageFinView', () => {
  let View;
  let root;

  beforeEach(() => {
    document.body.innerHTML = '<div id="main"></div>';
    root = document.getElementById('main');

    makeKpiCard();
    global.Charts = { renderLine: jest.fn(), renderBar: jest.fn() };
    global.DataTable = { render: jest.fn() };

    View = loadView('../../admin/js/views/PilotageFinView.js', 'PilotageFinView');
  });

  afterEach(() => {
    cleanupGlobals('KmcApi', 'KmcFilters', 'KpiCard');
    delete global.Charts;
    delete global.DataTable;
  });

  function setupApi(overrides = {}) {
    return makeKmcApi(Object.assign({
      getFinance: jest.fn().mockResolvedValue(null),
      getEconomicHistory: jest.fn().mockResolvedValue(null),
      getEconomicVariables: jest.fn().mockResolvedValue(null),
    }, overrides));
  }

  function dataTableCallFor(el) {
    return global.DataTable.render.mock.calls.find(c => c[0] === el)[1];
  }

  it('expose render() (contrat app.js#invokeView)', () => {
    setupApi();
    expect(typeof View.render).toBe('function');
  });

  describe('render() — shell et chargement', () => {
    it('pose le shell complet, lit KmcFilters, appelle les 3 endpoints', async () => {
      const api = setupApi();
      makeKmcFilters({ from: '2026-06-01', to: '2026-07-01' });

      await View.render(root);

      ['pf-kpis', 'pf-chart-ca', 'pf-chart-mix', 'pf-history', 'pf-variables', 'pf-meta']
        .forEach(id => expect(root.querySelector('#' + id)).toBeTruthy());

      expect(global.KmcFilters.get).toHaveBeenCalled();
      expect(api.getFinance).toHaveBeenCalledWith({ from: '2026-06-01', to: '2026-07-01', island: null });
      expect(api.getEconomicHistory).toHaveBeenCalledWith({ months: 6 });
      expect(api.getEconomicVariables).toHaveBeenCalledTimes(1);
    });

    it('getEconomicHistory utilise toujours { months: 6 }, indépendamment des filtres', async () => {
      const api = setupApi();
      makeKmcFilters({ from: 'X', to: 'Y' });

      await View.render(root);

      expect(api.getEconomicHistory).toHaveBeenCalledWith({ months: 6 });
    });

    it("n'exécute aucun rendu post-fetch si rootEl est détaché du DOM (guard navigation)", async () => {
      setupApi();
      makeKmcFilters();
      const detached = document.createElement('div');

      await View.render(detached);

      expect(global.KpiCard.renderBar).not.toHaveBeenCalled();
      expect(global.DataTable.render).not.toHaveBeenCalled();
    });

    it('les 3 sources en échec sont tolérées individuellement (catch interne → null)', async () => {
      setupApi({
        getFinance: jest.fn().mockRejectedValue(new Error('boom')),
        getEconomicHistory: jest.fn().mockRejectedValue(new Error('boom')),
        getEconomicVariables: jest.fn().mockRejectedValue(new Error('boom')),
      });
      makeKmcFilters();

      await expect(View.render(root)).resolves.not.toThrow();

      expect(root.querySelector('#pf-kpis').innerHTML).toBe('');
      expect(root.querySelector('#pf-chart-ca').innerHTML).toContain('Historique indisponible');
      expect(root.querySelector('#pf-chart-mix').innerHTML).toContain('Mix catégories indisponible');
      expect(root.querySelector('#pf-variables').innerHTML).toContain('Variables économiques indisponibles');
    });

    it('erreur globale (composant manquant) : affiche un message dans #pf-kpis', async () => {
      setupApi();
      makeKmcFilters();
      global.DataTable.render = jest.fn(() => { throw new Error('composant KO'); });

      await View.render(root);

      expect(root.querySelector('#pf-kpis').innerHTML).toContain('composant KO');
    });

    it('erreur globale sans message : fallback "inconnue"', async () => {
      setupApi();
      makeKmcFilters();
      global.DataTable.render = jest.fn(() => { throw {}; });

      await View.render(root);

      expect(root.querySelector('#pf-kpis').innerHTML).toContain('inconnue');
    });

    it('meta : affiche un horodatage après un rendu réussi', async () => {
      setupApi();
      makeKmcFilters();

      await View.render(root);

      expect(root.querySelector('#pf-meta').textContent).toContain('Données financières —');
    });
  });

  describe('_renderKpis', () => {
    it('lit les champs sous finance.kpis', async () => {
      setupApi({
        getFinance: jest.fn().mockResolvedValue({
          kpis: {
            ca_total_kmf: 500000, marge_estimee_kmf: 100000, marge_reelle_kmf: 90000,
            marge_pct: 18.5, cout_estime_kmf: 400000, cout_reel_kmf: 410000,
          },
        }),
      });
      makeKmcFilters();

      await View.render(root);

      const kpis = global.KpiCard.renderBar.mock.calls[0][1];
      expect(kpis.find(k => k.key === 'ca_total').value).toBe('500\u202f000 KMF');
      expect(kpis.find(k => k.key === 'marge_estimee').value).toBe('100\u202f000 KMF');
      expect(kpis.find(k => k.key === 'marge_reelle').value).toBe('90\u202f000 KMF');
      expect(kpis.find(k => k.key === 'marge_pct').value).toBe('18.5%');
      expect(kpis.find(k => k.key === 'cout_estime').value).toBe('400\u202f000 KMF');
      expect(kpis.find(k => k.key === 'cout_reel').value).toBe('410\u202f000 KMF');
    });

    it('fallback sur les clés alternatives (revenue_kmf/margin_pct) si finance est top-level', async () => {
      setupApi({ getFinance: jest.fn().mockResolvedValue({ revenue_kmf: 12000, margin_pct: 5.2 }) });
      makeKmcFilters();

      await View.render(root);

      const kpis = global.KpiCard.renderBar.mock.calls[0][1];
      expect(kpis.find(k => k.key === 'ca_total').value).toBe('12\u202f000 KMF');
      expect(kpis.find(k => k.key === 'marge_pct').value).toBe('5.2%');
    });

    it('ne rend rien (vide #pf-kpis) si finance est null', async () => {
      setupApi({ getFinance: jest.fn().mockResolvedValue(null) });
      makeKmcFilters();

      await View.render(root);

      expect(global.KpiCard.renderBar).not.toHaveBeenCalled();
      expect(root.querySelector('#pf-kpis').innerHTML).toBe('');
    });
  });

  describe('_renderChartCA', () => {
    it('affiche un état indisponible si history est null', async () => {
      setupApi({ getEconomicHistory: jest.fn().mockResolvedValue(null) });
      makeKmcFilters();
      await View.render(root);
      expect(root.querySelector('#pf-chart-ca').innerHTML).toContain('Historique indisponible');
    });

    it('affiche un état vide si months est vide', async () => {
      setupApi({ getEconomicHistory: jest.fn().mockResolvedValue({ months: [] }) });
      makeKmcFilters();
      await View.render(root);
      expect(root.querySelector('#pf-chart-ca').innerHTML).toContain('Aucune donnée sur la période');
    });

    it('appelle Charts.renderLine avec labels/data extraits de months', async () => {
      setupApi({
        getEconomicHistory: jest.fn().mockResolvedValue({
          months: [{ label: 'Juin', ca_kmf: 100 }, { month: 'Juillet', revenue_kmf: 200 }],
        }),
      });
      makeKmcFilters();

      await View.render(root);

      expect(global.Charts.renderLine).toHaveBeenCalledWith(root.querySelector('#pf-chart-ca'), {
        labels: ['Juin', 'Juillet'],
        datasets: [{ label: 'CA (KMF)', data: [100, 200] }],
      });
    });

    it('lit history.data si history.months est absent', async () => {
      setupApi({ getEconomicHistory: jest.fn().mockResolvedValue({ data: [{ period: 'S1', ca: 50 }] }) });
      makeKmcFilters();

      await View.render(root);

      expect(global.Charts.renderLine).toHaveBeenCalledWith(root.querySelector('#pf-chart-ca'), {
        labels: ['S1'],
        datasets: [{ label: 'CA (KMF)', data: [50] }],
      });
    });
  });

  describe('_renderChartMix', () => {
    it('affiche un état indisponible si aucun mix (ni charts.category_mix ni category_mix)', async () => {
      setupApi({ getFinance: jest.fn().mockResolvedValue({}) });
      makeKmcFilters();
      await View.render(root);
      expect(root.querySelector('#pf-chart-mix').innerHTML).toContain('Mix catégories indisponible');
    });

    it('affiche un état vide si le mix est vide', async () => {
      setupApi({ getFinance: jest.fn().mockResolvedValue({ category_mix: [] }) });
      makeKmcFilters();
      await View.render(root);
      expect(root.querySelector('#pf-chart-mix').innerHTML).toContain('Aucune catégorie sur la période');
    });

    it('appelle Charts.renderBar depuis finance.charts.category_mix (tableau brut)', async () => {
      setupApi({
        getFinance: jest.fn().mockResolvedValue({
          charts: { category_mix: [{ label: 'Alimentaire', ca_kmf: 300 }] },
        }),
      });
      makeKmcFilters();

      await View.render(root);

      expect(global.Charts.renderBar).toHaveBeenCalledWith(root.querySelector('#pf-chart-mix'), {
        labels: ['Alimentaire'],
        datasets: [{ label: 'CA par catégorie (KMF)', data: [300] }],
      });
    });

    it('appelle Charts.renderBar depuis finance.category_mix.items', async () => {
      setupApi({
        getFinance: jest.fn().mockResolvedValue({
          category_mix: { items: [{ category: 'Textile', revenue: 150 }] },
        }),
      });
      makeKmcFilters();

      await View.render(root);

      expect(global.Charts.renderBar).toHaveBeenCalledWith(root.querySelector('#pf-chart-mix'), {
        labels: ['Textile'],
        datasets: [{ label: 'CA par catégorie (KMF)', data: [150] }],
      });
    });
  });

  describe('_renderHistory', () => {
    it('configure les colonnes et échappe le XSS dans period', async () => {
      const months = [{ period: '<script>alert(1)</script>', ca_kmf: 1000, orders: 5, marge_pct: 12.3, cout_reel_kmf: 800 }];
      setupApi({ getEconomicHistory: jest.fn().mockResolvedValue({ months }) });
      makeKmcFilters();

      await View.render(root);

      const config = dataTableCallFor(root.querySelector('#pf-history'));
      expect(config.rows).toBe(months);
      expect(config.columns.find(c => c.key === 'period').render(months[0])).not.toContain('<script>');
      expect(config.columns.find(c => c.key === 'ca').render(months[0])).toBe('1\u202f000 KMF');
      expect(config.columns.find(c => c.key === 'orders').render(months[0])).toBe('5');
      expect(config.columns.find(c => c.key === 'marge').render(months[0])).toBe('12.3%');
      expect(config.columns.find(c => c.key === 'cout').render(months[0])).toBe('800 KMF');
    });

    it('colonnes : fallback "—" pour marge et cout quand absents', async () => {
      const months = [{ period: 'Juin' }];
      setupApi({ getEconomicHistory: jest.fn().mockResolvedValue({ months }) });
      makeKmcFilters();

      await View.render(root);

      const config = dataTableCallFor(root.querySelector('#pf-history'));
      expect(config.columns.find(c => c.key === 'marge').render(months[0])).toBe('—');
      expect(config.columns.find(c => c.key === 'cout').render(months[0])).toBe('—');
    });

    it('fallback [] si history est null', async () => {
      setupApi({ getEconomicHistory: jest.fn().mockResolvedValue(null) });
      makeKmcFilters();
      await View.render(root);
      expect(dataTableCallFor(root.querySelector('#pf-history')).rows).toEqual([]);
    });
  });

  describe('_renderVariables', () => {
    it('affiche un état vide si variables est null', async () => {
      setupApi({ getEconomicVariables: jest.fn().mockResolvedValue(null) });
      makeKmcFilters();
      await View.render(root);
      expect(root.querySelector('#pf-variables').innerHTML).toContain('Variables économiques indisponibles');
    });

    it('extrait les rows depuis variables.variables et configure les colonnes', async () => {
      const rows = [{ code: 'TAUX_TVA', label: 'Taux TVA', value_kmf: 0, value: 15, updated_at: '2026-06-01T00:00:00Z' }];
      setupApi({ getEconomicVariables: jest.fn().mockResolvedValue({ variables: rows }) });
      makeKmcFilters();

      await View.render(root);

      const config = dataTableCallFor(root.querySelector('#pf-variables'));
      expect(config.rows).toBe(rows);
      expect(config.columns.find(c => c.key === 'code').render(rows[0])).toBe('<code>TAUX_TVA</code>');
      expect(config.columns.find(c => c.key === 'label').render(rows[0])).toBe('Taux TVA');
      expect(config.columns.find(c => c.key === 'updated').render(rows[0])).toBe('01/06/2026');
    });

    it('échappe le XSS dans code, label et unit', async () => {
      const rows = [{
        code: '<img src=x onerror=alert(1)>',
        label: '<script>alert(2)</script>',
        value: 10,
        unit: '<b>KMF</b>',
      }];
      setupApi({ getEconomicVariables: jest.fn().mockResolvedValue({ variables: rows }) });
      makeKmcFilters();

      await View.render(root);

      const config = dataTableCallFor(root.querySelector('#pf-variables'));
      expect(config.columns.find(c => c.key === 'code').render(rows[0])).not.toContain('<img');
      expect(config.columns.find(c => c.key === 'label').render(rows[0])).not.toContain('<script>');
      expect(config.columns.find(c => c.key === 'value').render(rows[0])).not.toContain('<b>');
    });

    it('valeur : unité par défaut "KMF" si value_kmf est présent et unit absent', async () => {
      const rows = [{ code: 'X', value_kmf: 250 }];
      setupApi({ getEconomicVariables: jest.fn().mockResolvedValue({ variables: rows }) });
      makeKmcFilters();

      await View.render(root);

      const config = dataTableCallFor(root.querySelector('#pf-variables'));
      expect(config.columns.find(c => c.key === 'value').render(rows[0])).toBe('250 KMF');
    });

    it('valeur : fallback "—" si aucune valeur (value_kmf/value/amount absents)', async () => {
      const rows = [{ code: 'X' }];
      setupApi({ getEconomicVariables: jest.fn().mockResolvedValue({ variables: rows }) });
      makeKmcFilters();

      await View.render(root);

      const config = dataTableCallFor(root.querySelector('#pf-variables'));
      expect(config.columns.find(c => c.key === 'value').render(rows[0])).toBe('—');
    });

    it('colonnes : fallback "—" pour code/label/updated quand absents', async () => {
      const rows = [{}];
      setupApi({ getEconomicVariables: jest.fn().mockResolvedValue({ variables: rows }) });
      makeKmcFilters();

      await View.render(root);

      const config = dataTableCallFor(root.querySelector('#pf-variables'));
      expect(config.columns.find(c => c.key === 'code').render(rows[0])).toBe('<code>—</code>');
      expect(config.columns.find(c => c.key === 'label').render(rows[0])).toBe('—');
      expect(config.columns.find(c => c.key === 'updated').render(rows[0])).toBe('—');
    });

    it('extrait les rows depuis variables.items, puis un tableau brut', async () => {
      const items = [{ code: 'Y' }];
      setupApi({ getEconomicVariables: jest.fn().mockResolvedValue({ items }) });
      makeKmcFilters();
      await View.render(root);
      expect(dataTableCallFor(root.querySelector('#pf-variables')).rows).toBe(items);
    });
  });
});
