'use strict';

/**
 * tests/unit/EventWorkspacesView.test.js
 *
 * admin/js/views/EventWorkspacesView.js (229L) — Vue Panier événement /admin/event-workspaces.
 * Export réel : window.EventWorkspacesView = { render } (IIFE, render async).
 *
 * Source API (globals mockés) :
 *   - KmcFilters.get()
 *   - KmcApi.getEventWorkspaces(filters)   (catch global unique)
 * Composants globaux (mockés) :
 *   - KpiCard.renderBar, Charts.renderFunnel, DataTable.render,
 *     AlertList.renderList, BadgeStatus.status
 *
 * Point sensible (doctrine UX zero-blame) : les alertes dont la clé
 * correspond à ALERT_FORMULATIONS doivent être reformulées (label/message
 * neutres) avant d'être passées à AlertList.renderList — jamais de
 * nominatif sur qui n'a pas payé.
 */

const { loadView, makeKmcApi, makeKmcFilters, makeKpiCard, cleanupGlobals } = require('./helpers/dashboardTestKit');

function baseData(overrides) {
  return Object.assign({
    kpis: [{ key: 'active', label: 'Actifs', value: 3 }],
    charts: {},
    tables: { workspaces: [] },
    alerts: [],
  }, overrides);
}

describe('EventWorkspacesView', () => {
  let main;

  beforeEach(() => {
    document.body.innerHTML = '<div id="main"></div>';
    main = document.getElementById('main');

    makeKmcFilters({ from: null, to: null, island: null });
    makeKpiCard();
    global.Charts = { renderFunnel: jest.fn() };
    global.DataTable = { render: jest.fn() };
    global.AlertList = { renderList: jest.fn() };
    global.BadgeStatus = { status: jest.fn(s => `<span class="badge">${s}</span>`) };
  });

  afterEach(() => {
    cleanupGlobals('KmcApi', 'KmcFilters', 'KpiCard');
    delete global.Charts;
    delete global.DataTable;
    delete global.AlertList;
    delete global.BadgeStatus;
  });

  function setupApi(overrides = {}) {
    return makeKmcApi(Object.assign({
      getEventWorkspaces: jest.fn().mockResolvedValue(baseData()),
    }, overrides));
  }

  function loadIt() {
    return loadView('../../admin/js/views/EventWorkspacesView.js', 'EventWorkspacesView');
  }

  function dataTableOpts() {
    return global.DataTable.render.mock.calls[0][1];
  }

  it('expose render() (contrat app.js#invokeView)', () => {
    setupApi();
    const View = loadIt();
    expect(typeof View.render).toBe('function');
  });

  it('pose le shell (kpis, pipeline, tableau, alertes) avant résolution', async () => {
    let resolveIt;
    setupApi({ getEventWorkspaces: jest.fn(() => new Promise((r) => { resolveIt = r; })) });
    const View = loadIt();
    const p = View.render(main);

    expect(main.querySelector('#ws-kpis')).toBeTruthy();
    expect(main.querySelector('#ws-funnel-chart')).toBeTruthy();
    expect(main.querySelector('#ws-table')).toBeTruthy();
    expect(main.querySelector('#ws-alerts')).toBeTruthy();

    resolveIt(baseData());
    await p;
  });

  it('appelle getEventWorkspaces avec KmcFilters.get()', async () => {
    makeKmcFilters({ from: '2026-06-01', to: '2026-06-30', island: 'ngazidja' });
    const api = setupApi();
    const View = loadIt();
    await View.render(main);
    expect(api.getEventWorkspaces).toHaveBeenCalledWith({ from: '2026-06-01', to: '2026-06-30', island: 'ngazidja' });
  });

  it('KpiCard.renderBar reçoit data.kpis (fallback [])', async () => {
    setupApi({ getEventWorkspaces: jest.fn().mockResolvedValue(baseData({ kpis: undefined })) });
    const View = loadIt();
    await View.render(main);
    expect(global.KpiCard.renderBar).toHaveBeenCalledWith(document.getElementById('ws-kpis'), []);
  });

  it('guard : rootEl détaché du DOM entre-temps → aucun rendu de composant', async () => {
    let resolveIt;
    setupApi({ getEventWorkspaces: jest.fn(() => new Promise((r) => { resolveIt = r; })) });
    const View = loadIt();
    const p = View.render(main);
    main.remove();
    resolveIt(baseData());
    await p;
    expect(global.KpiCard.renderBar).not.toHaveBeenCalled();
  });

  it('funnel absent → Charts.renderFunnel non appelé', async () => {
    setupApi({ getEventWorkspaces: jest.fn().mockResolvedValue(baseData({ charts: {} })) });
    const View = loadIt();
    await View.render(main);
    expect(global.Charts.renderFunnel).not.toHaveBeenCalled();
  });

  it('funnel présent → Charts.renderFunnel appelé avec les bonnes données', async () => {
    const funnel = [{ stage: 'created', count: 10 }];
    setupApi({ getEventWorkspaces: jest.fn().mockResolvedValue(baseData({ charts: { workspace_funnel: funnel } })) });
    const View = loadIt();
    await View.render(main);
    expect(global.Charts.renderFunnel).toHaveBeenCalledWith(document.getElementById('ws-funnel-chart'), funnel);
  });

  it('tableau workspaces : colonnes rendues avec fallbacks (créateur/destinataire/statut/commande)', async () => {
    const ws = {
      event_name: 'Mariage Fatima', creator_name: 'Ali', recipient_name: null,
      status: 'active', cart_total_kmf: 25000, progress_pct: 40, order_id: null,
    };
    setupApi({ getEventWorkspaces: jest.fn().mockResolvedValue(baseData({ tables: { workspaces: [ws] } })) });
    const View = loadIt();
    await View.render(main);

    const opts = dataTableOpts();
    expect(opts.rows).toEqual([ws]);
    const colByKey = Object.fromEntries(opts.columns.map(c => [c.key, c]));

    expect(colByKey.creator_name.render(ws)).toBe('Ali');
    expect(colByKey.recipient_name.render(ws)).toBe('—');
    colByKey.status.render(ws);
    expect(global.BadgeStatus.status).toHaveBeenCalledWith('active');
    expect(colByKey.cart_total_kmf.render(ws)).toBe(Number(25000).toLocaleString('fr-FR'));
    expect(colByKey.order_id.render(ws)).toContain('en cours');
  });

  it('colonne créateur : fallback sur creator_label puis "—"', async () => {
    setupApi();
    const View = loadIt();
    await View.render(main);
    const colByKey = Object.fromEntries(dataTableOpts().columns.map(c => [c.key, c]));
    expect(colByKey.creator_name.render({ creator_label: 'Groupe Famille' })).toBe('Groupe Famille');
    expect(colByKey.creator_name.render({})).toBe('—');
  });

  it('colonne progression : classe verte/bleue/orange selon le pourcentage', async () => {
    setupApi();
    const View = loadIt();
    await View.render(main);
    const col = dataTableOpts().columns.find(c => c.key === 'progress_pct');
    expect(col.render({ progress_pct: 100 })).toContain('is-green');
    expect(col.render({ progress_pct: 60 })).toContain('is-blue');
    expect(col.render({ progress_pct: 20 })).toContain('is-orange');
    expect(col.render({})).toContain('is-orange');
    expect(col.render({ progress_pct: 42 })).toContain('42%');
  });

  it('colonne commande : lien vers orders-logistics si order_id présent', async () => {
    setupApi();
    const View = loadIt();
    await View.render(main);
    const col = dataTableOpts().columns.find(c => c.key === 'order_id');
    const html = col.render({ order_id: 'ord-42' });
    expect(html).toContain('/admin/orders-logistics?order_id=ord-42');
    expect(html).toContain('créée');
  });

  it('DataTable.render : emptyText "Aucun workspace en cours"', async () => {
    setupApi();
    const View = loadIt();
    await View.render(main);
    expect(dataTableOpts().emptyText).toBe('Aucun workspace en cours');
  });

  it('doctrine zero-blame : une alerte connue est reformulée (label/message neutres) avant AlertList.renderList', async () => {
    setupApi({
      getEventWorkspaces: jest.fn().mockResolvedValue(baseData({
        alerts: [{ key: 'payment_authorization_failed', level: 'warning', workspace_id: 'w1' }],
      })),
    });
    const View = loadIt();
    await View.render(main);

    expect(global.AlertList.renderList).toHaveBeenCalledWith(
      document.getElementById('ws-alerts'),
      [{
        key: 'payment_authorization_failed', level: 'warning', workspace_id: 'w1',
        label: 'Une contribution est à réessayer',
        message: 'Un paiement n\'a pas pu être finalisé. Le panier peut être repris.',
      }],
      { limit: 10, emptyText: 'Tous les workspaces fonctionnent normalement' }
    );
  });

  it('doctrine zero-blame : alerte connue sans level → fallback "info"', async () => {
    setupApi({
      getEventWorkspaces: jest.fn().mockResolvedValue(baseData({
        alerts: [{ key: 'workspace_abandoned' }],
      })),
    });
    const View = loadIt();
    await View.render(main);
    const [, alertsArg] = global.AlertList.renderList.mock.calls[0];
    expect(alertsArg[0].level).toBe('info');
    expect(alertsArg[0].label).toBe('Workspace inactif');
  });

  it('alerte à clé inconnue → transmise telle quelle, sans reformulation', async () => {
    const raw = { key: 'unknown_alert_type', level: 'critical', label: 'Brut' };
    setupApi({ getEventWorkspaces: jest.fn().mockResolvedValue(baseData({ alerts: [raw] })) });
    const View = loadIt();
    await View.render(main);
    expect(global.AlertList.renderList).toHaveBeenCalledWith(
      document.getElementById('ws-alerts'), [raw],
      { limit: 10, emptyText: 'Tous les workspaces fonctionnent normalement' }
    );
  });

  it('meta : data_quality cache → texte "(cache Xs)"', async () => {
    setupApi({
      getEventWorkspaces: jest.fn().mockResolvedValue(baseData({
        data_quality: { is_cached: true, cache_age_seconds: 15, generated_at: '2026-07-05T10:00:00Z' },
      })),
    });
    const View = loadIt();
    await View.render(main);
    expect(document.getElementById('ws-meta').textContent).toContain('(cache 15s)');
  });

  it('meta : data_quality frais → "(données fraîches)"', async () => {
    setupApi({
      getEventWorkspaces: jest.fn().mockResolvedValue(baseData({
        data_quality: { is_cached: false, generated_at: '2026-07-05T10:00:00Z' },
      })),
    });
    const View = loadIt();
    await View.render(main);
    expect(document.getElementById('ws-meta').textContent).toContain('(données fraîches)');
  });

  it('pas de data_quality → #ws-meta reste vide', async () => {
    setupApi();
    const View = loadIt();
    await View.render(main);
    expect(document.getElementById('ws-meta').textContent).toBe('');
  });

  it('erreur (getEventWorkspaces rejeté) → error-state dans #ws-kpis, avec mention 401 si applicable', async () => {
    const err = new Error('Session expirée');
    err.status = 401;
    setupApi({ getEventWorkspaces: jest.fn().mockRejectedValue(err) });
    const View = loadIt();
    await View.render(main);
    const kpisEl = document.getElementById('ws-kpis');
    expect(kpisEl.innerHTML).toContain('Session expirée');
    expect(kpisEl.innerHTML).toContain('connectez-vous comme admin');
  });

  it('erreur sans status 401 → pas de mention connexion admin', async () => {
    setupApi({ getEventWorkspaces: jest.fn().mockRejectedValue(new Error('boom')) });
    const View = loadIt();
    await View.render(main);
    const kpisEl = document.getElementById('ws-kpis');
    expect(kpisEl.innerHTML).toContain('boom');
    expect(kpisEl.innerHTML).not.toContain('connectez-vous comme admin');
  });

  it('erreur sans message → fallback "inconnue"', async () => {
    setupApi({ getEventWorkspaces: jest.fn().mockRejectedValue(new Error()) });
    const View = loadIt();
    await View.render(main);
    expect(document.getElementById('ws-kpis').innerHTML).toContain('inconnue');
  });
});
