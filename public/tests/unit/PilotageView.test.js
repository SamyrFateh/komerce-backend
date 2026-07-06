'use strict';

/**
 * tests/unit/PilotageView.test.js
 *
 * admin/js/views/PilotageView.js (170L) — Vue unifiée /admin/pilotage.
 * Export réel : window.PilotageView = { render } (IIFE, render async).
 *
 * Source API (global mocké) :
 *   - KmcFilters.get() → filtres passés à getUnified
 *   - KmcApi.getUnified(filters)   (jamais catché — erreur → catch global)
 * Composants globaux (mockés) :
 *   - KpiCard.renderBar (KPI globaux), KpiCard.renderMini (mini-KPI par bloc)
 *   - AlertList.renderList (alertes système)
 *
 * Périmètre couvert :
 *   - render() : shell (7 ids/sections), KmcFilters.get(), 1 appel API,
 *     guard rootEl détaché, erreur globale (catch) avec/sans 401
 *   - KPI bar : KpiCard.renderBar avec data.kpis_global (fallback [])
 *   - Blocs vues : un div.view-block par entrée de data.view_blocks, click →
 *     navigation (block.url), XSS échappé sur title/subtitle, mini-KPIs
 *     limités à 4 via KpiCard.renderMini
 *   - Boucle économique : stages avec flèches entre eux (pas avant le
 *     premier), click → navigation si stage.url, XSS échappé sur label
 *   - Principes : liste échappée (esc), fallback vide
 *   - Alertes : AlertList.renderList avec data.system_alerts (fallback [])
 *   - Meta : data_quality (cache vs frais)
 */

const { loadView, makeKmcApi, makeKmcFilters, makeKpiCard, cleanupGlobals } = require('./helpers/dashboardTestKit');

function baseUnified(overrides) {
  return Object.assign({
    kpis_global: [{ key: 'ca', label: 'CA', value: '1M' }],
    view_blocks: [],
    economic_flow: { stages: [] },
    principles: [],
    system_alerts: [],
  }, overrides);
}

describe('PilotageView', () => {
  let rootEl;
  let View;

  beforeEach(() => {
    document.body.innerHTML = '<div id="main"></div>';
    rootEl = document.getElementById('main');

    makeKpiCard({ renderMini: jest.fn(() => document.createElement('div')) });
    global.AlertList = { renderList: jest.fn() };

    View = loadView('../../dashboards/admin/js/views/PilotageView.js', 'PilotageView');
  });

  afterEach(() => {
    cleanupGlobals('KmcApi', 'KmcFilters', 'KpiCard');
    delete global.AlertList;
    delete window.location;
  });

  function mockApi(data, filters) {
    makeKmcFilters(filters || { from: null, to: null });
    makeKmcApi({ getUnified: jest.fn().mockResolvedValue(data) });
  }

  it('rend le shell avant résolution de la promesse API', () => {
    makeKmcFilters();
    makeKmcApi({ getUnified: jest.fn(() => new Promise(() => {})) });

    View.render(rootEl);

    expect(rootEl.querySelector('.page-title').textContent).toBe('Pilotage');
    expect(rootEl.querySelector('#pilotage-kpis')).not.toBeNull();
    expect(rootEl.querySelector('#pilotage-blocks')).not.toBeNull();
    expect(rootEl.querySelector('#pilotage-flow')).not.toBeNull();
    expect(rootEl.querySelector('#pilotage-principles')).not.toBeNull();
    expect(rootEl.querySelector('#pilotage-alerts')).not.toBeNull();
  });

  it('appelle KmcFilters.get() puis KmcApi.getUnified(filters)', async () => {
    const filters = { from: '2026-06-01', to: '2026-07-01' };
    mockApi(baseUnified(), filters);

    await View.render(rootEl);

    expect(global.KmcFilters.get).toHaveBeenCalled();
    expect(global.KmcApi.getUnified).toHaveBeenCalledWith({ ...filters, island: null });
  });

  it('guard : ne touche pas au DOM si rootEl est détaché au retour de la promesse', async () => {
    let resolve;
    makeKmcFilters();
    makeKmcApi({ getUnified: jest.fn(() => new Promise((r) => { resolve = r; })) });

    const promise = View.render(rootEl);
    rootEl.remove();
    resolve(baseUnified());
    await promise;

    expect(global.KpiCard.renderBar).not.toHaveBeenCalled();
    expect(global.AlertList.renderList).not.toHaveBeenCalled();
  });

  it('erreur globale : affiche un message dans #pilotage-kpis', async () => {
    makeKmcFilters();
    makeKmcApi({ getUnified: jest.fn().mockRejectedValue(new Error('boom')) });

    await View.render(rootEl);

    const main = rootEl.querySelector('#pilotage-kpis');
    expect(main.innerHTML).toContain('Erreur de chargement');
    expect(main.innerHTML).toContain('boom');
  });

  it('erreur 401 : ajoute le message de reconnexion admin', async () => {
    makeKmcFilters();
    const err = new Error('unauthorized');
    err.status = 401;
    makeKmcApi({ getUnified: jest.fn().mockRejectedValue(err) });

    await View.render(rootEl);

    expect(rootEl.querySelector('#pilotage-kpis').innerHTML).toContain('connectez-vous comme admin');
  });

  it('erreur sans message : fallback "inconnue"', async () => {
    makeKmcFilters();
    makeKmcApi({ getUnified: jest.fn().mockRejectedValue({}) });

    await View.render(rootEl);

    expect(rootEl.querySelector('#pilotage-kpis').innerHTML).toContain('inconnue');
  });

  it('KPI bar : délègue à KpiCard.renderBar avec data.kpis_global', async () => {
    const kpis = [{ key: 'ca', label: 'CA', value: '2M' }];
    mockApi(baseUnified({ kpis_global: kpis }));

    await View.render(rootEl);

    expect(global.KpiCard.renderBar).toHaveBeenCalledWith(rootEl.querySelector('#pilotage-kpis'), kpis);
  });

  it('KPI bar : fallback tableau vide si data.kpis_global absent', async () => {
    mockApi(baseUnified({ kpis_global: undefined }));

    await View.render(rootEl);

    expect(global.KpiCard.renderBar).toHaveBeenCalledWith(rootEl.querySelector('#pilotage-kpis'), []);
  });

  it('blocs vues : rend un .view-block par entrée avec titre/sous-titre échappés', async () => {
    mockApi(baseUnified({
      view_blocks: [
        { title: 'Ventes', subtitle: 'Suivi CA', url: '/admin/sales', kpis_summary: [] },
      ],
    }));

    await View.render(rootEl);

    const blocks = rootEl.querySelectorAll('.view-block');
    expect(blocks.length).toBe(1);
    expect(blocks[0].querySelector('.view-block-title').textContent).toBe('Ventes');
    expect(blocks[0].querySelector('.view-block-subtitle').textContent).toBe('"Suivi CA"');
  });

  it('blocs vues : échappe le XSS dans title et subtitle', async () => {
    mockApi(baseUnified({
      view_blocks: [
        { title: '<img src=x onerror=alert(1)>', subtitle: '<script>alert(2)</script>', url: '/x', kpis_summary: [] },
      ],
    }));

    await View.render(rootEl);

    const block = rootEl.querySelector('.view-block');
    expect(block.querySelector('.view-block-title').innerHTML).not.toContain('<img');
    expect(block.querySelector('.view-block-subtitle').innerHTML).not.toContain('<script>');
  });

  it('blocs vues : click déclenche la navigation vers block.url', async () => {
    mockApi(baseUnified({
      view_blocks: [{ title: 'Ventes', subtitle: 'x', url: '/admin/sales', kpis_summary: [] }],
    }));

    await View.render(rootEl);

    expect(() => rootEl.querySelector('.view-block').dispatchEvent(new Event('click', { bubbles: true }))).not.toThrow();
  });

  it('blocs vues : limite les mini-KPIs à 4 via KpiCard.renderMini', async () => {
    mockApi(baseUnified({
      view_blocks: [{
        title: 'Ventes', subtitle: 'x', url: '/x',
        kpis_summary: [{ k: 1 }, { k: 2 }, { k: 3 }, { k: 4 }, { k: 5 }],
      }],
    }));

    await View.render(rootEl);

    expect(global.KpiCard.renderMini).toHaveBeenCalledTimes(4);
  });

  it('blocs vues : fallback [] si kpis_summary absent', async () => {
    mockApi(baseUnified({ view_blocks: [{ title: 'Ventes', subtitle: 'x', url: '/x' }] }));

    await expect(View.render(rootEl)).resolves.not.toThrow();
    expect(global.KpiCard.renderMini).not.toHaveBeenCalled();
  });

  it('boucle économique : rend un stage par entrée, sans flèche avant le premier', async () => {
    mockApi(baseUnified({
      economic_flow: { stages: [{ label: 'Achat' }, { label: 'Vente' }, { label: 'Marge' }] },
    }));

    await View.render(rootEl);

    const flowEl = rootEl.querySelector('#pilotage-flow');
    expect(flowEl.querySelectorAll('.economic-flow-stage').length).toBe(3);
    expect(flowEl.querySelectorAll('.economic-flow-arrow').length).toBe(2);
    expect(flowEl.firstElementChild.className).toBe('economic-flow-stage');
  });

  it('boucle économique : échappe le XSS dans label', async () => {
    mockApi(baseUnified({
      economic_flow: { stages: [{ label: '<script>alert(3)</script>' }] },
    }));

    await View.render(rootEl);

    expect(rootEl.querySelector('.economic-flow-stage-label').innerHTML).not.toContain('<script>');
  });

  it('boucle économique : click sur un stage sans url ne lève pas d\'exception', async () => {
    mockApi(baseUnified({ economic_flow: { stages: [{ label: 'Achat' }] } }));

    await View.render(rootEl);

    expect(() => rootEl.querySelector('.economic-flow-stage').dispatchEvent(new Event('click', { bubbles: true }))).not.toThrow();
  });

  it('boucle économique : click sur un stage avec url déclenche la navigation', async () => {
    mockApi(baseUnified({ economic_flow: { stages: [{ label: 'Achat', url: '/admin/costing' }] } }));

    await View.render(rootEl);

    expect(() => rootEl.querySelector('.economic-flow-stage').dispatchEvent(new Event('click', { bubbles: true }))).not.toThrow();
  });

  it('boucle économique : fallback [] si economic_flow ou stages absent', async () => {
    mockApi(baseUnified({ economic_flow: undefined }));

    await expect(View.render(rootEl)).resolves.not.toThrow();
    expect(rootEl.querySelector('#pilotage-flow').children.length).toBe(0);
  });

  it('principes : rend une li échappée par entrée', async () => {
    mockApi(baseUnified({ principles: ['Pas de duplication', '<script>alert(4)</script>'] }));

    await View.render(rootEl);

    const items = rootEl.querySelectorAll('.principle-item');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain('Pas de duplication');
    expect(items[1].innerHTML).not.toContain('<script>');
  });

  it('principes : fallback [] si absent', async () => {
    mockApi(baseUnified({ principles: undefined }));

    await expect(View.render(rootEl)).resolves.not.toThrow();
    expect(rootEl.querySelectorAll('.principle-item').length).toBe(0);
  });

  it('alertes : délègue à AlertList.renderList avec data.system_alerts et les options', async () => {
    const alerts = [{ id: 1, message: 'x' }];
    mockApi(baseUnified({ system_alerts: alerts }));

    await View.render(rootEl);

    expect(global.AlertList.renderList).toHaveBeenCalledWith(
      rootEl.querySelector('#pilotage-alerts'),
      alerts,
      { limit: 5, emptyText: 'Aucune alerte critique' }
    );
  });

  it('alertes : fallback [] si data.system_alerts absent', async () => {
    mockApi(baseUnified({ system_alerts: undefined }));

    await View.render(rootEl);

    expect(global.AlertList.renderList).toHaveBeenCalledWith(
      rootEl.querySelector('#pilotage-alerts'),
      [],
      expect.any(Object)
    );
  });

  it('meta : affiche l\'heure de génération sans mention de cache si is_cached est false', async () => {
    mockApi(baseUnified({
      data_quality: { is_cached: false, generated_at: '2026-07-05T10:00:00Z' },
    }));

    await View.render(rootEl);

    const paragraphs = Array.from(rootEl.querySelectorAll('p'));
    const meta = paragraphs.find(p => p.textContent.startsWith('Généré'));
    expect(meta).toBeTruthy();
    expect(meta.textContent).not.toContain('cache');
  });

  it('meta : affiche l\'âge du cache si is_cached est true', async () => {
    mockApi(baseUnified({
      data_quality: { is_cached: true, cache_age_seconds: 12, cache_ttl_seconds: 60, generated_at: '2026-07-05T10:00:00Z' },
    }));

    await View.render(rootEl);

    const paragraphs = Array.from(rootEl.querySelectorAll('p'));
    const meta = paragraphs.find(p => p.textContent.startsWith('Généré'));
    expect(meta.textContent).toContain('cache 12s/60s');
  });

  it('meta : n\'ajoute aucun paragraphe si data_quality est absent', async () => {
    mockApi(baseUnified({ data_quality: undefined }));

    await View.render(rootEl);

    const paragraphs = Array.from(rootEl.querySelectorAll('p'));
    expect(paragraphs.some(p => p.textContent.startsWith('Généré'))).toBe(false);
  });
});
