'use strict';

/**
 * tests/unit/AccountingView.test.js
 *
 * admin/js/views/AccountingView.js (558L) — Comptabilité : KPI, grand livre
 * (charges par famille), réconciliation cash, commandes non encaissées,
 * top produits, exports CSV.
 * Export réel : window.AccountingView = { render } (IIFE).
 *
 * Premier test écrit avec dashboardTestKit.js pour ce snapshot — preuve que
 * le socle dashboards fonctionne (loadView, makeKmcApi, makeKmcFilters non
 * utilisé ici car la vue ne s'y abonne pas, mockConfirm/mockAlert, flush).
 */

const {
  loadView, makeKmcApi, cleanupGlobals, flush, mockAlert,
} = require('./helpers/dashboardTestKit');

function baseFinance(overrides) {
  return Object.assign({
    kpi: { ca_kmf: 5_000_000 },
    marges: { taux_marge_pct: 30, marge_reelle_kmf: 1_500_000 },
    paiements: { cash: { total_kmf: 2_000_000 }, stripe: { total_eur: 3000 } },
    taux: { eur_kmf: 500 },
    top_produits: [],
  }, overrides);
}

describe('AccountingView', () => {
  let AccountingView;
  let main;

  beforeEach(() => {
    document.body.innerHTML = '<div id="main"></div>';
    main = document.getElementById('main');
  });

  afterEach(() => {
    cleanupGlobals('KmcApi', 'KmcFilters', 'KpiCard');
  });

  it('expose render() (contrat app.js#invokeView)', () => {
    makeKmcApi({
      getFinance: jest.fn().mockResolvedValue(baseFinance()),
      getEconomicCharges: jest.fn().mockResolvedValue(null),
      getCashReconciliation: jest.fn().mockResolvedValue(null),
      getCashUncollected: jest.fn().mockResolvedValue(null),
    });
    AccountingView = loadView('../../admin/js/views/AccountingView.js', 'AccountingView');
    expect(typeof AccountingView.render).toBe('function');
  });

  describe('render() — chargement initial et KPI', () => {
    it('pose le shell, période 30j active, appelle les 4 endpoints KmcApi', async () => {
      const getFinance = jest.fn().mockResolvedValue(baseFinance());
      const getEconomicCharges = jest.fn().mockResolvedValue(null);
      const getCashReconciliation = jest.fn().mockResolvedValue(null);
      const getCashUncollected = jest.fn().mockResolvedValue(null);
      makeKmcApi({ getFinance, getEconomicCharges, getCashReconciliation, getCashUncollected });
      AccountingView = loadView('../../admin/js/views/AccountingView.js', 'AccountingView');

      await AccountingView.render(main);

      expect(getFinance).toHaveBeenCalledWith({ period: 30 });
      expect(getEconomicCharges).toHaveBeenCalled();
      expect(getCashReconciliation).toHaveBeenCalled();
      expect(getCashUncollected).toHaveBeenCalledWith({ hours: 48 });
      expect(main.querySelector('.acct-period-bar button.active').dataset.period).toBe('30');
      expect(main.innerHTML).toContain('KMF');
    });

    it('erreur générique sur Promise.all → error-state avec message échappé', async () => {
      makeKmcApi({
        getFinance: jest.fn().mockRejectedValue(new Error('<boom>')),
        getEconomicCharges: jest.fn().mockResolvedValue(null),
        getCashReconciliation: jest.fn().mockResolvedValue(null),
        getCashUncollected: jest.fn().mockResolvedValue(null),
      });
      // Simule Promise.all qui rejette malgré les .catch(() => null) internes :
      // on force load() à throw en gardant getFinance rejeté SANS catch pour ce test
      // -> on remplace getEconomicCharges pour throw hors du .catch(() => null)
      global.KmcApi.getEconomicCharges = jest.fn(() => { throw new Error('<boom>'); });
      AccountingView = loadView('../../admin/js/views/AccountingView.js', 'AccountingView', { skipBaseDeps: false });

      await AccountingView.render(main);

      expect(main.innerHTML).toContain('Erreur chargement comptabilité');
      expect(main.innerHTML).not.toContain('<boom>');
      expect(main.innerHTML).toContain('&lt;boom&gt;');
    });
  });

  describe('renderLedger — grand livre par famille', () => {
    it('pas de données charges → message "Moteur économique non disponible"', async () => {
      makeKmcApi({
        getFinance: jest.fn().mockResolvedValue(baseFinance()),
        getEconomicCharges: jest.fn().mockResolvedValue(null),
        getCashReconciliation: jest.fn().mockResolvedValue(null),
        getCashUncollected: jest.fn().mockResolvedValue(null),
      });
      AccountingView = loadView('../../admin/js/views/AccountingView.js', 'AccountingView');
      await AccountingView.render(main);

      expect(main.innerHTML).toContain('Moteur économique non disponible');
    });

    it('familles présentes → accordéon, clic sur l\'entête toggle la classe "open"', async () => {
      makeKmcApi({
        getFinance: jest.fn().mockResolvedValue(baseFinance()),
        getEconomicCharges: jest.fn().mockResolvedValue({
          families: {
            logistique: {
              label: 'Logistique', emoji: '🚚', total_kmf: 120000,
              charges: [{ name: 'Transport', amount_kmf: 120000, is_active: true, recurrence_period: 'monthly' }],
            },
          },
          totals: { monthly: 120000, per_order: 0 },
        }),
        getCashReconciliation: jest.fn().mockResolvedValue(null),
        getCashUncollected: jest.fn().mockResolvedValue(null),
      });
      AccountingView = loadView('../../admin/js/views/AccountingView.js', 'AccountingView');
      await AccountingView.render(main);

      const head = main.querySelector('.acct-ledger-family-head[data-toggle="logistique"]');
      const family = main.querySelector('.acct-ledger-family[data-fam="logistique"]');
      expect(family.classList.contains('open')).toBe(false);

      head.dispatchEvent(new Event('click', { bubbles: true }));
      expect(family.classList.contains('open')).toBe(true);

      head.dispatchEvent(new Event('click', { bubbles: true }));
      expect(family.classList.contains('open')).toBe(false);
    });
  });

  describe('renderReconciliation — cash agents', () => {
    it('aucune donnée reco → message dédié', async () => {
      makeKmcApi({
        getFinance: jest.fn().mockResolvedValue(baseFinance()),
        getEconomicCharges: jest.fn().mockResolvedValue(null),
        getCashReconciliation: jest.fn().mockResolvedValue(null),
        getCashUncollected: jest.fn().mockResolvedValue(null),
      });
      AccountingView = loadView('../../admin/js/views/AccountingView.js', 'AccountingView');
      await AccountingView.render(main);

      expect(main.innerHTML).toContain('Aucune donnée de réconciliation');
    });

    it('agents présents → cartes avec gap collecte en alerte si écart > 10%', async () => {
      makeKmcApi({
        getFinance: jest.fn().mockResolvedValue(baseFinance()),
        getEconomicCharges: jest.fn().mockResolvedValue(null),
        getCashReconciliation: jest.fn().mockResolvedValue({
          totals: { expected_kmf: 100000, declared_kmf: 80000, deposited_kmf: 75000, gap_collection: 20000, gap_deposit: 5000 },
          agents: [{ agent_name: 'Agent Moroni', expected_kmf: 100000, declared_kmf: 80000, verified_kmf: 75000, gap_collection: 20000 }],
        }),
        getCashUncollected: jest.fn().mockResolvedValue(null),
      });
      AccountingView = loadView('../../admin/js/views/AccountingView.js', 'AccountingView');
      await AccountingView.render(main);

      const card = main.querySelector('.acct-reco-card');
      expect(card.innerHTML).toContain('Agent Moroni');
      expect(card.querySelector('.acct-reco-gap-alert')).not.toBeNull();
    });
  });

  describe('renderUncollected — commandes non encaissées', () => {
    it('changement du select hours → recharge getCashUncollected avec la nouvelle valeur', async () => {
      const getCashUncollected = jest.fn().mockResolvedValue({
        count: 1, total_missing_kmf: 15000,
        orders: [{ reference: 'KMC-1', total_kmf: 15000, status: 'delivered', created_at: new Date().toISOString() }],
      });
      makeKmcApi({
        getFinance: jest.fn().mockResolvedValue(baseFinance()),
        getEconomicCharges: jest.fn().mockResolvedValue(null),
        getCashReconciliation: jest.fn().mockResolvedValue(null),
        getCashUncollected,
      });
      AccountingView = loadView('../../admin/js/views/AccountingView.js', 'AccountingView');
      await AccountingView.render(main);

      const select = main.querySelector('#acct-unc-hours');
      select.value = '168';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();

      expect(getCashUncollected).toHaveBeenLastCalledWith({ hours: 168 });
    });
  });

  describe('plage de dates invalide', () => {
    it('date de fin avant date de début → alert, pas de rechargement', async () => {
      const getFinance = jest.fn().mockResolvedValue(baseFinance());
      makeKmcApi({
        getFinance,
        getEconomicCharges: jest.fn().mockResolvedValue(null),
        getCashReconciliation: jest.fn().mockResolvedValue(null),
        getCashUncollected: jest.fn().mockResolvedValue(null),
      });
      const alertSpy = mockAlert();
      AccountingView = loadView('../../admin/js/views/AccountingView.js', 'AccountingView');
      await AccountingView.render(main);
      getFinance.mockClear();

      main.querySelector('#acct-from').value = '2026-07-10';
      main.querySelector('#acct-to').value = '2026-07-01';
      main.querySelector('#acct-daterange-apply').dispatchEvent(new Event('click', { bubbles: true }));

      expect(alertSpy).toHaveBeenCalledWith('⚠️ Plage de dates invalide');
      expect(getFinance).not.toHaveBeenCalled();
    });
  });

  describe('export CSV', () => {
    it('clic export sans données → alert "Rien à exporter", pas de téléchargement', async () => {
      makeKmcApi({
        getFinance: jest.fn().mockResolvedValue(baseFinance()),
        getEconomicCharges: jest.fn().mockResolvedValue(null),
        getCashReconciliation: jest.fn().mockResolvedValue(null),
        getCashUncollected: jest.fn().mockResolvedValue(null),
      });
      const alertSpy = mockAlert();
      URL.createObjectURL = jest.fn();
      AccountingView = loadView('../../admin/js/views/AccountingView.js', 'AccountingView');
      await AccountingView.render(main);

      main.querySelector('.acct-export-btn[data-export="ledger"]').dispatchEvent(new Event('click', { bubbles: true }));

      expect(alertSpy).toHaveBeenCalledWith('Rien à exporter');
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('clic export top produits avec données → déclenche le téléchargement CSV', async () => {
      makeKmcApi({
        getFinance: jest.fn().mockResolvedValue(baseFinance({
          top_produits: [{ nom: 'Sac tressé', categorie: 'Mode', qty: 5, ca_kmf: 75000 }],
        })),
        getEconomicCharges: jest.fn().mockResolvedValue(null),
        getCashReconciliation: jest.fn().mockResolvedValue(null),
        getCashUncollected: jest.fn().mockResolvedValue(null),
      });
      URL.createObjectURL = jest.fn(() => 'blob:mock');
      URL.revokeObjectURL = jest.fn();
      AccountingView = loadView('../../admin/js/views/AccountingView.js', 'AccountingView');
      await AccountingView.render(main);

      main.querySelector('.acct-export-btn[data-export="topprods"]').dispatchEvent(new Event('click', { bubbles: true }));

      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
    });
  });
});
