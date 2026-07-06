'use strict';

/**
 * tests/unit/InvoicesView.test.js
 *
 * admin/js/views/InvoicesView.js (200L) — Vue Factures & Comptabilité
 * /admin/invoices. Export réel : window.InvoicesView = { render } (IIFE,
 * render async).
 *
 * Sources API (globals mockés) :
 *   - KmcFilters.get() → { from, to } passés à getInvoices/getCashReconciliation
 *   - KmcApi.getInvoices(params).catch(() => null)
 *   - KmcApi.getCashReconciliation(params).catch(() => null)
 *   - KmcApi.getCashUncollected({ hours: 72 }).catch(() => null)   → param
 *     FIXE, indépendant des filtres
 *   Les 3 appels sont catchés individuellement : Promise.all ne rejette
 *   jamais depuis ces sources — seul un throw synchrone dans le bloc try
 *   (ex: composant global manquant) atteint le catch global.
 * Composants globaux (mockés, NON optionnels — toujours appelés) :
 *   - KpiCard.renderBar, DataTable.render, BadgeStatus.status
 *
 * Périmètre couvert :
 *   - render() : shell (5 ids), KmcFilters.get(), 3 appels API en parallèle
 *     (params filtrés vs hours:72 fixe), guard rootEl détaché, erreur
 *     globale (catch) avec/sans message
 *   - _renderKpis : 5 KPI avec formes summary/top-level et fallback clés
 *     alternatives, tout à zéro si invoices/uncollected null
 *   - _renderInvoices : extraction rows (invoices/items/array), colonnes
 *     (reference/client/amount/status via BadgeStatus/date avec fallback —)
 *   - _renderUncollected : extraction rows (orders/items/array), colonnes
 *     (reference/client/relais/total/delivered_at avec fallback —)
 *   - _renderReconciliation : état vide si absent, résumé (théorique/réel/
 *     écart avec seuil couleur 1000), table entries (seuil couleur écart
 *     ligne 100)
 *   - Meta : horodatage texte fixe
 */

const {
  loadView, makeKmcApi, makeKmcFilters, makeKpiCard, cleanupGlobals,
} = require('./helpers/dashboardTestKit');

describe('InvoicesView', () => {
  let View;
  let root;

  beforeEach(() => {
    document.body.innerHTML = '<div id="main"></div>';
    root = document.getElementById('main');

    makeKpiCard();
    global.DataTable = { render: jest.fn() };
    global.BadgeStatus = { status: jest.fn((s) => `<span class="badge">${s}</span>`) };

    View = loadView('../../dashboards/admin/js/views/InvoicesView.js', 'InvoicesView');
  });

  afterEach(() => {
    cleanupGlobals('KmcApi', 'KmcFilters', 'KpiCard');
    delete global.DataTable;
    delete global.BadgeStatus;
  });

  function setupApi(overrides = {}) {
    return makeKmcApi(Object.assign({
      getInvoices: jest.fn().mockResolvedValue(null),
      getCashReconciliation: jest.fn().mockResolvedValue(null),
      getCashUncollected: jest.fn().mockResolvedValue(null),
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

      ['inv-kpis', 'inv-table', 'inv-uncollected', 'inv-reconciliation', 'inv-meta']
        .forEach(id => expect(root.querySelector('#' + id)).toBeTruthy());

      expect(global.KmcFilters.get).toHaveBeenCalled();
      expect(api.getInvoices).toHaveBeenCalledWith({ from: '2026-06-01', to: '2026-07-01' });
      expect(api.getCashReconciliation).toHaveBeenCalledWith({ from: '2026-06-01', to: '2026-07-01' });
      expect(api.getCashUncollected).toHaveBeenCalledWith({ hours: 72 });
    });

    it('getCashUncollected utilise toujours { hours: 72 }, indépendamment des filtres', async () => {
      const api = setupApi();
      makeKmcFilters({ from: 'X', to: 'Y' });

      await View.render(root);

      expect(api.getCashUncollected).toHaveBeenCalledWith({ hours: 72 });
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
        getInvoices: jest.fn().mockRejectedValue(new Error('boom')),
        getCashReconciliation: jest.fn().mockRejectedValue(new Error('boom')),
        getCashUncollected: jest.fn().mockRejectedValue(new Error('boom')),
      });
      makeKmcFilters();

      await expect(View.render(root)).resolves.not.toThrow();

      expect(root.querySelector('#inv-reconciliation').innerHTML).toContain('Données de rapprochement indisponibles');
      expect(dataTableCallFor(root.querySelector('#inv-table')).rows).toEqual([]);
      expect(dataTableCallFor(root.querySelector('#inv-uncollected')).rows).toEqual([]);
    });

    it('erreur globale (composant manquant) : affiche un message dans #inv-kpis', async () => {
      setupApi();
      makeKmcFilters();
      global.KpiCard.renderBar = jest.fn(() => { throw new Error('composant KO'); });

      await View.render(root);

      expect(root.querySelector('#inv-kpis').innerHTML).toContain('composant KO');
    });

    it('erreur globale sans message : fallback "inconnue"', async () => {
      setupApi();
      makeKmcFilters();
      global.KpiCard.renderBar = jest.fn(() => { throw {}; });

      await View.render(root);

      expect(root.querySelector('#inv-kpis').innerHTML).toContain('inconnue');
    });

    it('meta : affiche un horodatage après un rendu réussi', async () => {
      setupApi();
      makeKmcFilters();

      await View.render(root);

      expect(root.querySelector('#inv-meta').textContent).toContain('Données comptabilité —');
    });
  });

  describe('_renderKpis', () => {
    it('lit les champs sous invoices.summary / uncollected.summary', async () => {
      setupApi({
        getInvoices: jest.fn().mockResolvedValue({
          summary: { total_count: 12, pending_count: 3, total_kmf: 500000 },
        }),
        getCashUncollected: jest.fn().mockResolvedValue({
          summary: { count: 4, total_kmf: 80000 },
        }),
      });
      makeKmcFilters();

      await View.render(root);

      const kpis = global.KpiCard.renderBar.mock.calls[0][1];
      expect(kpis.find(k => k.key === 'inv_total').value).toBe('12');
      expect(kpis.find(k => k.key === 'inv_pending').value).toBe('3');
      expect(kpis.find(k => k.key === 'inv_amount').value).toBe('500 000 KMF');
      expect(kpis.find(k => k.key === 'unc_count').value).toBe('4');
      expect(kpis.find(k => k.key === 'unc_amount').value).toBe('80 000 KMF');
    });

    it('fallback sur les clés alternatives (count/amount_kmf) si invoices est top-level', async () => {
      setupApi({
        getInvoices: jest.fn().mockResolvedValue({ count: 7, amount_kmf: 10000 }),
        getCashUncollected: jest.fn().mockResolvedValue({ total_count: 2, amount_kmf: 5000 }),
      });
      makeKmcFilters();

      await View.render(root);

      const kpis = global.KpiCard.renderBar.mock.calls[0][1];
      expect(kpis.find(k => k.key === 'inv_total').value).toBe('7');
      expect(kpis.find(k => k.key === 'inv_amount').value).toBe('10 000 KMF');
      expect(kpis.find(k => k.key === 'unc_count').value).toBe('2');
      expect(kpis.find(k => k.key === 'unc_amount').value).toBe('5 000 KMF');
    });

    it('tout à zéro si invoices et uncollected sont null', async () => {
      setupApi();
      makeKmcFilters();

      await View.render(root);

      const kpis = global.KpiCard.renderBar.mock.calls[0][1];
      kpis.forEach(k => expect(k.value).toMatch(/^0( KMF)?$/));
    });
  });

  describe('_renderInvoices', () => {
    it('extrait les rows depuis invoices.invoices et configure les colonnes', async () => {
      const rows = [{ reference: 'FAC-1', client_name: 'Client A', amount_kmf: 1000, status: 'paid', issued_at: '2026-06-01T00:00:00Z', due_at: '2026-06-15T00:00:00Z' }];
      setupApi({ getInvoices: jest.fn().mockResolvedValue({ invoices: rows }) });
      makeKmcFilters();

      await View.render(root);

      const config = dataTableCallFor(root.querySelector('#inv-table'));
      expect(config.rows).toBe(rows);
      expect(config.columns.find(c => c.key === 'reference').render(rows[0])).toBe('FAC-1');
      expect(config.columns.find(c => c.key === 'client').render(rows[0])).toBe('Client A');
      expect(config.columns.find(c => c.key === 'amount').render(rows[0])).toBe('1 000 KMF');
      expect(config.columns.find(c => c.key === 'status').render(rows[0])).toContain('paid');
      expect(config.columns.find(c => c.key === 'issued_at').render(rows[0])).toBe('01/06/2026');
      expect(config.columns.find(c => c.key === 'due_at').render(rows[0])).toBe('15/06/2026');
    });

    it('extrait les rows depuis invoices.items, puis un tableau brut', async () => {
      const items = [{ id: 'X1' }];
      setupApi({ getInvoices: jest.fn().mockResolvedValue({ items }) });
      makeKmcFilters();
      await View.render(root);
      expect(dataTableCallFor(root.querySelector('#inv-table')).rows).toBe(items);
    });

    it('colonnes : fallback "—" quand les champs sont absents', async () => {
      const rows = [{}];
      setupApi({ getInvoices: jest.fn().mockResolvedValue(rows) });
      makeKmcFilters();

      await View.render(root);

      const config = dataTableCallFor(root.querySelector('#inv-table'));
      expect(config.columns.find(c => c.key === 'reference').render(rows[0])).toBe('—');
      expect(config.columns.find(c => c.key === 'client').render(rows[0])).toBe('—');
      expect(config.columns.find(c => c.key === 'issued_at').render(rows[0])).toBe('—');
      expect(config.columns.find(c => c.key === 'due_at').render(rows[0])).toBe('—');
    });

    it('délègue le statut à BadgeStatus.status avec fallback "pending"', async () => {
      const rows = [{}];
      setupApi({ getInvoices: jest.fn().mockResolvedValue(rows) });
      makeKmcFilters();

      await View.render(root);

      const config = dataTableCallFor(root.querySelector('#inv-table'));
      config.columns.find(c => c.key === 'status').render(rows[0]);
      expect(global.BadgeStatus.status).toHaveBeenCalledWith('pending');
    });

    it('fallback [] si invoices est null', async () => {
      setupApi({ getInvoices: jest.fn().mockResolvedValue(null) });
      makeKmcFilters();
      await View.render(root);
      expect(dataTableCallFor(root.querySelector('#inv-table')).rows).toEqual([]);
    });
  });

  describe('_renderUncollected', () => {
    it('extrait les rows depuis uncollected.orders et configure les colonnes', async () => {
      const rows = [{ reference: 'CMD-1', client_name: 'Client B', relais_name: 'Relais Moroni', total_kmf: 2000, delivered_at: '2026-06-20T00:00:00Z' }];
      setupApi({ getCashUncollected: jest.fn().mockResolvedValue({ orders: rows }) });
      makeKmcFilters();

      await View.render(root);

      const config = dataTableCallFor(root.querySelector('#inv-uncollected'));
      expect(config.rows).toBe(rows);
      expect(config.columns.find(c => c.key === 'reference').render(rows[0])).toBe('CMD-1');
      expect(config.columns.find(c => c.key === 'client').render(rows[0])).toBe('Client B');
      expect(config.columns.find(c => c.key === 'relais').render(rows[0])).toBe('Relais Moroni');
      expect(config.columns.find(c => c.key === 'total').render(rows[0])).toBe('2 000 KMF');
      expect(config.columns.find(c => c.key === 'delivered_at').render(rows[0])).toBe('20/06/2026');
    });

    it('colonnes : fallback "—" quand les champs sont absents', async () => {
      const rows = [{}];
      setupApi({ getCashUncollected: jest.fn().mockResolvedValue(rows) });
      makeKmcFilters();

      await View.render(root);

      const config = dataTableCallFor(root.querySelector('#inv-uncollected'));
      expect(config.columns.find(c => c.key === 'reference').render(rows[0])).toBe('—');
      expect(config.columns.find(c => c.key === 'relais').render(rows[0])).toBe('—');
      expect(config.columns.find(c => c.key === 'delivered_at').render(rows[0])).toBe('—');
    });

    it('fallback [] si uncollected est null', async () => {
      setupApi({ getCashUncollected: jest.fn().mockResolvedValue(null) });
      makeKmcFilters();
      await View.render(root);
      expect(dataTableCallFor(root.querySelector('#inv-uncollected')).rows).toEqual([]);
    });
  });

  describe('_renderReconciliation', () => {
    it('affiche un état vide si reconciliation est absent/null', async () => {
      setupApi({ getCashReconciliation: jest.fn().mockResolvedValue(null) });
      makeKmcFilters();

      await View.render(root);

      expect(root.querySelector('#inv-reconciliation').innerHTML).toContain('Données de rapprochement indisponibles');
    });

    it('affiche le résumé théorique/réel et un badge vert si l\'écart est < 1000', async () => {
      setupApi({
        getCashReconciliation: jest.fn().mockResolvedValue({
          summary: { theoretical_kmf: 100000, actual_kmf: 99500, gap_kmf: -500 },
          entries: [],
        }),
      });
      makeKmcFilters();

      await View.render(root);

      const html = root.querySelector('#inv-reconciliation').innerHTML;
      expect(html).toContain('100 000 KMF');
      expect(html).toContain('99 500 KMF');
      expect(html).toContain('is-green');
    });

    it('badge rouge si l\'écart est >= 1000 en valeur absolue', async () => {
      setupApi({
        getCashReconciliation: jest.fn().mockResolvedValue({
          summary: { theoretical_kmf: 100000, actual_kmf: 90000, gap_kmf: 10000 },
          entries: [],
        }),
      });
      makeKmcFilters();

      await View.render(root);

      expect(root.querySelector('#inv-reconciliation').innerHTML).toContain('is-red');
    });

    it('affiche "Équilibré" quand l\'écart est exactement 0', async () => {
      setupApi({
        getCashReconciliation: jest.fn().mockResolvedValue({ summary: { gap_kmf: 0 }, entries: [] }),
      });
      makeKmcFilters();

      await View.render(root);

      expect(root.querySelector('#inv-reconciliation').innerHTML).toContain('Équilibré');
    });

    it('utilise les clés alternatives (expected_kmf/collected_kmf/ecart_kmf) si summary est top-level', async () => {
      setupApi({
        getCashReconciliation: jest.fn().mockResolvedValue({
          expected_kmf: 5000, collected_kmf: 5000, ecart_kmf: 0, entries: [],
        }),
      });
      makeKmcFilters();

      await View.render(root);

      const html = root.querySelector('#inv-reconciliation').innerHTML;
      expect(html).toContain('5 000 KMF');
      expect(html).toContain('Équilibré');
    });

    it('configure la table des lignes de rapprochement avec le seuil de couleur à 100', async () => {
      const rows = [
        { date: '2026-06-10T00:00:00Z', relais_name: 'Relais A', theoretical_kmf: 1000, actual_kmf: 950, gap_kmf: -50 },
        { date: '2026-06-11T00:00:00Z', relais_name: 'Relais B', theoretical_kmf: 1000, actual_kmf: 700, gap_kmf: -300 },
      ];
      setupApi({
        getCashReconciliation: jest.fn().mockResolvedValue({ summary: { gap_kmf: 0 }, entries: rows }),
      });
      makeKmcFilters();

      await View.render(root);

      const reconciliationEl = root.querySelector('#inv-reconciliation');
      const tableEl = reconciliationEl.querySelector('div:last-child');
      const config = dataTableCallFor(tableEl);
      expect(config.rows).toBe(rows);
      expect(config.columns.find(c => c.key === 'date').render(rows[0])).toBe('10/06/2026');
      expect(config.columns.find(c => c.key === 'relais').render(rows[0])).toBe('Relais A');
      expect(config.columns.find(c => c.key === 'theoretical').render(rows[0])).toBe('1 000 KMF');
      expect(config.columns.find(c => c.key === 'actual').render(rows[0])).toBe('950 KMF');
      expect(config.columns.find(c => c.key === 'gap').render(rows[0])).toContain('is-green');
      expect(config.columns.find(c => c.key === 'gap').render(rows[1])).toContain('is-red');
    });

    it('extrait les rows depuis reconciliation.items, puis un tableau brut', async () => {
      const items = [{ date: '2026-06-10T00:00:00Z' }];
      setupApi({
        getCashReconciliation: jest.fn().mockResolvedValue({ summary: {}, items }),
      });
      makeKmcFilters();

      await View.render(root);

      const tableEl = root.querySelector('#inv-reconciliation').querySelector('div:last-child');
      expect(dataTableCallFor(tableEl).rows).toBe(items);
    });

    it('colonnes table : fallback "—" pour date/relais si absents', async () => {
      const rows = [{}];
      setupApi({
        getCashReconciliation: jest.fn().mockResolvedValue({ summary: {}, entries: rows }),
      });
      makeKmcFilters();

      await View.render(root);

      const tableEl = root.querySelector('#inv-reconciliation').querySelector('div:last-child');
      const config = dataTableCallFor(tableEl);
      expect(config.columns.find(c => c.key === 'date').render(rows[0])).toBe('—');
      expect(config.columns.find(c => c.key === 'relais').render(rows[0])).toBe('—');
    });
  });
});
