'use strict';

/**
 * tests/unit/SanteView.test.js
 *
 * admin/js/views/SanteView.js (880L) — Vue Santé Business /admin/sante.
 * Export réel : window.SanteView = { render } où render(rootEl) EST
 * directement la fonction async (pas de wrapper) → render(rootEl) renvoie
 * bien sa promesse, `await View.render(main)` fonctionne normalement.
 *
 * Vue 100% lecture/agrégation, aucune interaction utilisateur (pas de
 * data-act, pas de formulaire) — c'est un moteur de calcul (4 piliers
 * pondérés + 6 règles de corrélation) suivi d'un rendu HTML pur.
 * esc()/fmt()/fmtShort()/fmtPct()/pulseIcon() sont locaux au fichier
 * (pas de dépendance utils.js malgré le header @depends qui le mentionne —
 * @depends KpiCard.js/Charts.js est également obsolète : ni l'un ni
 * l'autre n'est référencé dans le code réel de cette vue).
 *
 * Source API (8 appels KmcApi, chacun catché individuellement en .catch(()
 * => null) dans le Promise.all — un échec isolé ne casse jamais le rendu,
 * le pilier concerné retombe juste en health='grey') :
 *   - KmcApi.getOps(filters)
 *   - KmcApi.getFinance(filters)               (récupéré mais jamais
 *     utilisé dans le calcul — dette silencieuse constatée, non testée
 *     au-delà de l'appel lui-même)
 *   - KmcApi.getClients(filters)
 *   - KmcApi.getSales(filters, {period:30})
 *   - KmcApi.getCashReconciliation({from, to})  (30 derniers jours calculés
 *     dynamiquement à partir de `new Date()` — dates non assertées en dur)
 *   - KmcApi.getCashUncollected({})
 *   - KmcApi.getCustomsRatesEffective()
 *   - KmcApi.getFinanceConfig()
 *
 * Point sensible : seul un throw de KmcFilters.get() (ou une erreur hors
 * Promise.all) peut atteindre le catch externe de render() — chaque appel
 * KmcApi individuel avale déjà ses propres erreurs.
 */

const { loadView, makeKmcApi, makeKmcFilters, cleanupGlobals } = require('./helpers/dashboardTestKit');

function opsData(o = {}) {
  return Object.assign({ activite: { commandes_bloquees: 0, commandes_en_cours: 50 }, sla: { late: 0 } }, o);
}
function clientsData(o = {}) {
  return Object.assign({ segments: { nb_total: 100, new: 10, recurrent: 60, vip: 5, at_risk: 0, dormant: 25 }, at_risk_clients: [] }, o);
}
function salesData(o = {}) {
  return Object.assign({ kpi: { marge_real_pct: 42, panier_moyen_kmf: 15000, panier_moyen_previous_kmf: 15000 }, by_category: [] }, o);
}
function reconciliationData(o = {}) {
  return Object.assign({ par_relais: [] }, o);
}
function uncollectedData(o = {}) {
  return Object.assign({
    buckets: {
      '0_24h': { count: 5, kmf: 100000 }, '24h_48h': { count: 2, kmf: 50000 },
      '48h_72h': { count: 0, kmf: 0 }, '72h_7d': { count: 0, kmf: 0 }, '7d_plus': { count: 0, kmf: 0 },
    },
    total_pending_kmf: 150000,
  }, o);
}
function customsData(o = {}) {
  return Object.assign({ rates: { last_90d: { rate_pct: 5 }, last_30d: { rate_pct: 5 } } }, o);
}
function financeConfigData(o = {}) {
  return Object.assign({ targets: { marge_brute_pct: 40 } }, o);
}

describe('SanteView', () => {
  let main;

  beforeEach(() => {
    document.body.innerHTML = '<div id="main"></div>';
    main = document.getElementById('main');
    makeKmcFilters({ from: null, to: null, island: null });
  });

  afterEach(() => {
    cleanupGlobals('KmcApi', 'KmcFilters');
    document.getElementById('sante-styles')?.remove();
  });

  function setupApi(overrides = {}) {
    return makeKmcApi(Object.assign({
      getOps: jest.fn().mockResolvedValue(opsData()),
      getFinance: jest.fn().mockResolvedValue({}),
      getClients: jest.fn().mockResolvedValue(clientsData()),
      getSales: jest.fn().mockResolvedValue(salesData()),
      getCashReconciliation: jest.fn().mockResolvedValue(reconciliationData()),
      getCashUncollected: jest.fn().mockResolvedValue(uncollectedData()),
      getCustomsRatesEffective: jest.fn().mockResolvedValue(customsData()),
      getFinanceConfig: jest.fn().mockResolvedValue(financeConfigData()),
    }, overrides));
  }

  function loadIt() {
    return loadView('../../admin/js/views/SanteView.js', 'SanteView');
  }

  it('expose render() (contrat app.js#invokeView)', () => {
    setupApi();
    const View = loadIt();
    expect(typeof View.render).toBe('function');
  });

  it('pose le loading state de façon synchrone avant résolution', async () => {
    let resolveIt;
    setupApi({ getOps: jest.fn(() => new Promise((r) => { resolveIt = r; })) });
    const View = loadIt();
    const p = View.render(main);
    expect(main.innerHTML).toContain('Diagnostic en cours');
    resolveIt(opsData());
    await p;
  });

  it('injecte les styles une seule fois (#sante-styles)', async () => {
    const View = loadIt();
    await View.render(main);
    const View2 = loadIt();
    await View2.render(main);
    expect(document.querySelectorAll('#sante-styles').length).toBe(1);
  });

  describe('appels API', () => {
    it('appelle getOps/getFinance/getClients avec KmcFilters.get()', async () => {
      makeKmcFilters({ from: '2026-06-01', to: '2026-06-30', island: 'ngazidja' });
      const api = setupApi();
      const View = loadIt();
      await View.render(main);
      const filters = { from: '2026-06-01', to: '2026-06-30', island: 'ngazidja' };
      expect(api.getOps).toHaveBeenCalledWith(filters);
      expect(api.getFinance).toHaveBeenCalledWith(filters);
      expect(api.getClients).toHaveBeenCalledWith(filters);
    });

    it('appelle getSales avec filters + {period:30}', async () => {
      const api = setupApi();
      const View = loadIt();
      await View.render(main);
      expect(api.getSales).toHaveBeenCalledWith({ from: null, to: null, island: null }, { period: 30 });
    });

    it('appelle getCashReconciliation avec une fenêtre glissante de 30 jours (from < to, format YYYY-MM-DD)', async () => {
      const api = setupApi();
      const View = loadIt();
      await View.render(main);
      const [{ from, to }] = api.getCashReconciliation.mock.calls[0];
      expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(from).getTime()).toBeLessThan(new Date(to).getTime());
    });

    it('appelle getCashUncollected avec {} et getCustomsRatesEffective/getFinanceConfig sans argument', async () => {
      const api = setupApi();
      const View = loadIt();
      await View.render(main);
      expect(api.getCashUncollected).toHaveBeenCalledWith({});
      expect(api.getCustomsRatesEffective).toHaveBeenCalledWith();
      expect(api.getFinanceConfig).toHaveBeenCalledWith();
    });

    it('un seul appel en échec (ex: getClients) n\'empêche pas le rendu global — pilier clients passe grey', async () => {
      setupApi({ getClients: jest.fn().mockRejectedValue(new Error('down')) });
      const View = loadIt();
      await View.render(main);
      expect(main.innerHTML).toContain('Santé Business');
      expect(main.innerHTML).not.toContain('sv-error');
      const clientsPillar = Array.from(main.querySelectorAll('.sv-pillar')).find(p => p.textContent.includes('Clients'));
      expect(clientsPillar.className).toContain('is-grey');
      expect(clientsPillar.textContent).toContain('Données indisponibles');
    });

    it('KmcFilters.get() qui lève → catch externe, error-state avec mention 401 si applicable', async () => {
      setupApi();
      const err = new Error('Session expirée');
      err.status = 401;
      makeKmcFilters({}, { get: jest.fn(() => { throw err; }) });
      const View = loadIt();
      await View.render(main);
      expect(main.innerHTML).toContain('Session expirée');
      expect(main.innerHTML).toContain('connectez-vous comme admin');
    });

    it('erreur externe sans status 401 → pas de mention connexion admin', async () => {
      setupApi();
      makeKmcFilters({}, { get: jest.fn(() => { throw new Error('boom'); }) });
      const View = loadIt();
      await View.render(main);
      expect(main.innerHTML).toContain('boom');
      expect(main.innerHTML).not.toContain('connectez-vous comme admin');
    });

    it('erreur externe sans message → fallback "inconnue"', async () => {
      setupApi();
      makeKmcFilters({}, { get: jest.fn(() => { throw new Error(); }) });
      const View = loadIt();
      await View.render(main);
      expect(main.innerHTML).toContain('inconnue');
    });
  });

  describe('pilier Cash', () => {
    function cashPillar() {
      return Array.from(main.querySelectorAll('.sv-pillar')).find(p => p.textContent.includes('Cash'));
    }

    it('grey si getCashUncollected renvoie null (échec)', async () => {
      setupApi({ getCashUncollected: jest.fn().mockRejectedValue(new Error('x')) });
      const View = loadIt();
      await View.render(main);
      expect(cashPillar().className).toContain('is-grey');
    });

    it('green si aucun retard (totalRetard=0)', async () => {
      setupApi({ getCashUncollected: jest.fn().mockResolvedValue(uncollectedData()) });
      const View = loadIt();
      await View.render(main);
      expect(cashPillar().className).toContain('is-green');
      expect(cashPillar().textContent).toContain('Aucun cash en retard');
    });

    it('red si bOld>0 et pct_retard>30%', async () => {
      setupApi({
        getCashUncollected: jest.fn().mockResolvedValue(uncollectedData({
          buckets: { '48h_72h': { count: 0, kmf: 0 }, '72h_7d': { count: 0, kmf: 0 }, '7d_plus': { count: 1, kmf: 80000 } },
          total_pending_kmf: 100000,
        })),
      });
      const View = loadIt();
      await View.render(main);
      expect(cashPillar().className).toContain('is-red');
      expect(cashPillar().textContent).toContain('en retard > 7 jours');
    });

    it('yellow si pct_retard>15% (sans bOld dominant)', async () => {
      setupApi({
        getCashUncollected: jest.fn().mockResolvedValue(uncollectedData({
          buckets: { '48h_72h': { count: 1, kmf: 20000 }, '72h_7d': { count: 0, kmf: 0 }, '7d_plus': { count: 0, kmf: 0 } },
          total_pending_kmf: 100000,
        })),
      });
      const View = loadIt();
      await View.render(main);
      expect(cashPillar().className).toContain('is-yellow');
      expect(cashPillar().textContent).toContain('dépasse 48h');
    });

    it('green "retard mineur" si retard existe mais pct_retard<=15%', async () => {
      setupApi({
        getCashUncollected: jest.fn().mockResolvedValue(uncollectedData({
          buckets: { '48h_72h': { count: 1, kmf: 5000 }, '72h_7d': { count: 0, kmf: 0 }, '7d_plus': { count: 0, kmf: 0 } },
          total_pending_kmf: 100000,
        })),
      });
      const View = loadIt();
      await View.render(main);
      expect(cashPillar().className).toContain('is-green');
      expect(cashPillar().textContent).toContain('Retard mineur, sous contrôle');
    });
  });

  describe('pilier Marge', () => {
    function margePillar() {
      return Array.from(main.querySelectorAll('.sv-pillar')).find(p => p.textContent.includes('Marge'));
    }

    it('grey si sales.kpi absent', async () => {
      setupApi({ getSales: jest.fn().mockResolvedValue({}) });
      const View = loadIt();
      await View.render(main);
      expect(margePillar().className).toContain('is-grey');
    });

    it('green si margePct >= cible', async () => {
      setupApi({ getSales: jest.fn().mockResolvedValue(salesData({ kpi: { marge_real_pct: 45 } })) });
      const View = loadIt();
      await View.render(main);
      expect(margePillar().className).toContain('is-green');
      expect(margePillar().textContent).toContain('Au-dessus de la cible (40%)');
    });

    it('yellow si margePct entre cible-10 et cible', async () => {
      setupApi({ getSales: jest.fn().mockResolvedValue(salesData({ kpi: { marge_real_pct: 35 } })) });
      const View = loadIt();
      await View.render(main);
      expect(margePillar().className).toContain('is-yellow');
      expect(margePillar().textContent).toContain('sous la cible de 40%');
    });

    it('red si margePct < cible-10', async () => {
      setupApi({ getSales: jest.fn().mockResolvedValue(salesData({ kpi: { marge_real_pct: 20 } })) });
      const View = loadIt();
      await View.render(main);
      expect(margePillar().className).toContain('is-red');
      expect(margePillar().textContent).toContain('impact direct sur la trésorerie');
    });

    it('fallback cible 40% si financeConfig.targets absent', async () => {
      setupApi({
        getSales: jest.fn().mockResolvedValue(salesData({ kpi: { marge_real_pct: 45 } })),
        getFinanceConfig: jest.fn().mockResolvedValue({}),
      });
      const View = loadIt();
      await View.render(main);
      expect(margePillar().textContent).toContain('cible (40%)');
    });

    it('utilise marge_pct en fallback si marge_real_pct absent', async () => {
      setupApi({ getSales: jest.fn().mockResolvedValue(salesData({ kpi: { marge_pct: 50 } })) });
      const View = loadIt();
      await View.render(main);
      expect(margePillar().className).toContain('is-green');
    });
  });

  describe('pilier Pipeline', () => {
    function pipelinePillar() {
      return Array.from(main.querySelectorAll('.sv-pillar')).find(p => p.textContent.includes('Pipeline'));
    }

    it('grey si ops.activite absent', async () => {
      setupApi({ getOps: jest.fn().mockResolvedValue({}) });
      const View = loadIt();
      await View.render(main);
      expect(pipelinePillar().className).toContain('is-grey');
    });

    it('green "fluide" si aucun blocage ni retard', async () => {
      setupApi({ getOps: jest.fn().mockResolvedValue(opsData()) });
      const View = loadIt();
      await View.render(main);
      expect(pipelinePillar().className).toContain('is-green');
      expect(pipelinePillar().textContent).toContain('Pipeline fluide, aucun blocage');
    });

    it('red si pct_blocked > 15%', async () => {
      setupApi({ getOps: jest.fn().mockResolvedValue(opsData({ activite: { commandes_bloquees: 5, commandes_en_cours: 20 }, sla: { late: 0 } })) });
      const View = loadIt();
      await View.render(main);
      expect(pipelinePillar().className).toContain('is-red');
      expect(pipelinePillar().textContent).toContain('colis bloqués');
    });

    it('yellow si pct_blocked entre 5% et 15%', async () => {
      setupApi({ getOps: jest.fn().mockResolvedValue(opsData({ activite: { commandes_bloquees: 2, commandes_en_cours: 20 }, sla: { late: 0 } })) });
      const View = loadIt();
      await View.render(main);
      expect(pipelinePillar().className).toContain('is-yellow');
      expect(pipelinePillar().textContent).toContain('à débloquer');
    });

    it('green "sous surveillance" si blocages existent mais pct_blocked<=5%', async () => {
      setupApi({ getOps: jest.fn().mockResolvedValue(opsData({ activite: { commandes_bloquees: 1, commandes_en_cours: 100 }, sla: { late: 0 } })) });
      const View = loadIt();
      await View.render(main);
      expect(pipelinePillar().className).toContain('is-green');
      expect(pipelinePillar().textContent).toContain('sous surveillance');
    });

    it('inclut sla.late dans le calcul de blockedCount', async () => {
      setupApi({ getOps: jest.fn().mockResolvedValue(opsData({ activite: { commandes_bloquees: 0, commandes_en_cours: 20 }, sla: { late: 5 } })) });
      const View = loadIt();
      await View.render(main);
      expect(pipelinePillar().textContent).toContain('5 colis bloqués');
    });
  });

  describe('pilier Clients', () => {
    function clientsPillar() {
      return Array.from(main.querySelectorAll('.sv-pillar')).find(p => p.textContent.includes('Clients'));
    }

    it('grey si segments absent', async () => {
      setupApi({ getClients: jest.fn().mockResolvedValue({}) });
      const View = loadIt();
      await View.render(main);
      expect(clientsPillar().className).toContain('is-grey');
    });

    it('green si aucun client à risque', async () => {
      setupApi({ getClients: jest.fn().mockResolvedValue(clientsData()) });
      const View = loadIt();
      await View.render(main);
      expect(clientsPillar().className).toContain('is-green');
      expect(clientsPillar().textContent).toContain('Aucun client VIP à risque');
    });

    it('red si LTV à risque > 500 000 KMF', async () => {
      setupApi({
        getClients: jest.fn().mockResolvedValue(clientsData({
          segments: { nb_total: 100, at_risk: 3 },
          at_risk_clients: [{ ltv_kmf: 600000 }],
        })),
      });
      const View = loadIt();
      await View.render(main);
      expect(clientsPillar().className).toContain('is-red');
      expect(clientsPillar().textContent).toContain('LTV silencieuse à reconquérir');
    });

    it('red si plus de 10 clients à risque (même LTV faible)', async () => {
      setupApi({
        getClients: jest.fn().mockResolvedValue(clientsData({
          segments: { nb_total: 100, at_risk: 15 },
          at_risk_clients: [{ ltv_kmf: 1000 }],
        })),
      });
      const View = loadIt();
      await View.render(main);
      expect(clientsPillar().className).toContain('is-red');
    });

    it('yellow si clients à risque modérés (<=10, LTV<=500k)', async () => {
      setupApi({
        getClients: jest.fn().mockResolvedValue(clientsData({
          segments: { nb_total: 100, at_risk: 3 },
          at_risk_clients: [{ ltv_kmf: 50000 }],
        })),
      });
      const View = loadIt();
      await View.render(main);
      expect(clientsPillar().className).toContain('is-yellow');
      expect(clientsPillar().textContent).toContain('à relancer');
    });
  });

  describe('score global (computeScore)', () => {
    it('score >=80 → vert "La machine tourne bien"', async () => {
      setupApi();
      const View = loadIt();
      await View.render(main);
      const score = main.querySelector('.sv-score-num');
      expect(score.className).toContain('is-green');
      expect(main.querySelector('.sv-hero-verdict').textContent).toContain('La machine tourne bien');
    });

    it('score entre 60 et 79 → jaune "Attention requise"', async () => {
      setupApi({
        getCashUncollected: jest.fn().mockResolvedValue(uncollectedData({
          buckets: { '48h_72h': { count: 1, kmf: 20000 }, '72h_7d': { count: 0, kmf: 0 }, '7d_plus': { count: 0, kmf: 0 } },
          total_pending_kmf: 100000,
        })),
        getSales: jest.fn().mockResolvedValue(salesData({ kpi: { marge_real_pct: 35 } })),
      });
      const View = loadIt();
      await View.render(main);
      expect(main.querySelector('.sv-score-num').className).toContain('is-yellow');
      expect(main.querySelector('.sv-hero-verdict').textContent).toContain('Attention requise');
    });

    it('score < 60 → rouge "Action urgente"', async () => {
      setupApi({
        getCashUncollected: jest.fn().mockResolvedValue(uncollectedData({
          buckets: { '48h_72h': { count: 0, kmf: 0 }, '72h_7d': { count: 0, kmf: 0 }, '7d_plus': { count: 1, kmf: 80000 } },
          total_pending_kmf: 100000,
        })),
        getSales: jest.fn().mockResolvedValue(salesData({ kpi: { marge_real_pct: 10 } })),
        getOps: jest.fn().mockResolvedValue(opsData({ activite: { commandes_bloquees: 5, commandes_en_cours: 20 }, sla: { late: 0 } })),
      });
      const View = loadIt();
      await View.render(main);
      expect(main.querySelector('.sv-score-num').className).toContain('is-red');
      expect(main.querySelector('.sv-hero-verdict').textContent).toContain('Action urgente');
    });

    it('tous les piliers grey (aucune donnée) → score=0, rouge', async () => {
      setupApi({
        getCashUncollected: jest.fn().mockResolvedValue(null),
        getSales: jest.fn().mockResolvedValue(null),
        getOps: jest.fn().mockResolvedValue(null),
        getClients: jest.fn().mockResolvedValue(null),
      });
      const View = loadIt();
      await View.render(main);
      expect(main.querySelector('.sv-score-num').textContent).toBe('0');
      expect(main.querySelector('.sv-score-num').className).toContain('is-red');
    });
  });

  describe('détection des corrélations', () => {
    it('aucune corrélation → message état OK', async () => {
      setupApi();
      const View = loadIt();
      await View.render(main);
      expect(main.innerHTML).toContain('Aucune corrélation négative détectée');
    });

    it('CORR1 : marge non-verte + hausse douane 30j vs 90j (>+1.5pt) → alerte douane', async () => {
      setupApi({
        getSales: jest.fn().mockResolvedValue(salesData({ kpi: { marge_real_pct: 20 } })),
        getCustomsRatesEffective: jest.fn().mockResolvedValue(customsData({ rates: { last_90d: { rate_pct: 5 }, last_30d: { rate_pct: 8 } } })),
      });
      const View = loadIt();
      await View.render(main);
      expect(main.innerHTML).toContain('Marge en baisse + Douane en hausse');
      expect(main.innerHTML).toContain('/admin/customs');
    });

    it('CORR2 : marge non-verte + panier moyen en baisse >8% → alerte panier', async () => {
      setupApi({
        getSales: jest.fn().mockResolvedValue(salesData({ kpi: { marge_real_pct: 20, panier_moyen_kmf: 10000, panier_moyen_previous_kmf: 15000 } })),
      });
      const View = loadIt();
      await View.render(main);
      expect(main.innerHTML).toContain('Marge ↘ + Panier moyen ↘');
      expect(main.innerHTML).toContain('/admin/sales');
    });

    it('CORR3 : cash non-vert + relais avec écart>50k → alerte relais concentrés', async () => {
      setupApi({
        getCashUncollected: jest.fn().mockResolvedValue(uncollectedData({
          buckets: { '48h_72h': { count: 1, kmf: 20000 }, '72h_7d': { count: 0, kmf: 0 }, '7d_plus': { count: 0, kmf: 0 } },
          total_pending_kmf: 100000,
        })),
        getCashReconciliation: jest.fn().mockResolvedValue(reconciliationData({
          par_relais: [{ relais: 'Relais Moroni', ecart_kmf: 80000 }, { relais: 'Relais Mutsamudu', ecart_kmf: 60000 }],
        })),
      });
      const View = loadIt();
      await View.render(main);
      expect(main.innerHTML).toContain('Cash retard concentré sur 2 relais');
      expect(main.innerHTML).toContain('Relais Moroni');
      expect(main.innerHTML).toContain('puis <strong>Relais Mutsamudu');
    });

    it('CORR4 : clients à risque > 0 → toujours signalé (sévérité selon LTV)', async () => {
      setupApi({
        getClients: jest.fn().mockResolvedValue(clientsData({
          segments: { nb_total: 100, at_risk: 4 },
          at_risk_clients: [{ ltv_kmf: 100000 }, { ltv_kmf: 50000 }],
        })),
      });
      const View = loadIt();
      await View.render(main);
      expect(main.innerHTML).toContain('4 clients à risque');
      expect(main.innerHTML).toContain('is-attention');
    });

    it('CORR4 : sévérité is-alert si LTV à risque > 500k', async () => {
      setupApi({
        getClients: jest.fn().mockResolvedValue(clientsData({
          segments: { nb_total: 100, at_risk: 2 },
          at_risk_clients: [{ ltv_kmf: 600000 }],
        })),
      });
      const View = loadIt();
      await View.render(main);
      const correl = Array.from(main.querySelectorAll('.sv-correl')).find(c => c.textContent.includes('clients à risque'));
      expect(correl.className).toContain('is-alert');
    });

    it('CORR5 : blocages pipeline > 0 → signalé', async () => {
      setupApi({
        getOps: jest.fn().mockResolvedValue(opsData({ activite: { commandes_bloquees: 3, commandes_en_cours: 100 }, sla: { late: 0 } })),
      });
      const View = loadIt();
      await View.render(main);
      expect(main.innerHTML).toContain('3 commandes bloquées');
      expect(main.innerHTML).toContain('/admin/orders-logistics?anomalie=stock_blocked');
    });

    it('CORR6 : marge non-verte + catégorie faible marge à fort CA → alerte mix catégorie', async () => {
      setupApi({
        getSales: jest.fn().mockResolvedValue(salesData({
          kpi: { marge_real_pct: 20 },
          by_category: [
            { category: 'électronique', marge_real_pct: 8, ca_kmf: 500000 },
            { category: 'mode', marge_real_pct: 30, ca_kmf: 900000 },
          ],
        })),
      });
      const View = loadIt();
      await View.render(main);
      expect(main.innerHTML).toContain('Catégorie à faible marge en croissance');
      expect(main.innerHTML).toContain('électronique');
      expect(main.innerHTML).toContain('/admin/pricing');
    });

    it('CORR6 : catégorie faible marge mais CA insuffisant (<=100k) → pas d\'alerte', async () => {
      setupApi({
        getSales: jest.fn().mockResolvedValue(salesData({
          kpi: { marge_real_pct: 20 },
          by_category: [{ category: 'niche', marge_real_pct: 5, ca_kmf: 50000 }],
        })),
      });
      const View = loadIt();
      await View.render(main);
      expect(main.innerHTML).not.toContain('Catégorie à faible marge');
    });

    it('plusieurs corrélations simultanées sont toutes rendues avec le bon compteur', async () => {
      setupApi({
        getSales: jest.fn().mockResolvedValue(salesData({ kpi: { marge_real_pct: 20, panier_moyen_kmf: 10000, panier_moyen_previous_kmf: 15000 } })),
        getOps: jest.fn().mockResolvedValue(opsData({ activite: { commandes_bloquees: 3, commandes_en_cours: 100 }, sla: { late: 0 } })),
      });
      const View = loadIt();
      await View.render(main);
      expect(main.innerHTML).toContain('Corrélations détectées (2)');
    });
  });

  describe('renderClientDetail (top clients à risque)', () => {
    it('absent si aucun at_risk_clients', async () => {
      setupApi();
      const View = loadIt();
      await View.render(main);
      expect(main.innerHTML).not.toContain('Top clients à risque');
    });

    it('affiche jusqu\'à 5 clients avec fallbacks nom/téléphone/silence', async () => {
      setupApi({
        getClients: jest.fn().mockResolvedValue(clientsData({
          segments: { nb_total: 100, at_risk: 6 },
          at_risk_clients: Array.from({ length: 6 }, (_, i) => ({ name: `Client ${i}`, phone: `+269000000${i}`, nb_commandes: 3, ltv_kmf: 20000, jours_silence: 90 })),
        })),
      });
      const View = loadIt();
      await View.render(main);
      // Deux tables partagent la classe .sv-rank (clients à risque + détail
      // cash, ce dernier rendu par défaut via uncollectedData() qui a 2
      // buckets non-nuls) : on cible celle dont le thead contient "Client".
      const clientTable = [...main.querySelectorAll('table.sv-rank')]
        .find(t => t.querySelector('thead').textContent.includes('Client'));
      const rows = clientTable.querySelectorAll('tbody tr');
      expect(rows.length).toBe(5);
      expect(rows[0].textContent).toContain('Client 0');
    });

    it('fallback "—" pour nom/téléphone absents, "?" pour jours_silence, 0 pour nb_commandes', async () => {
      setupApi({
        getClients: jest.fn().mockResolvedValue(clientsData({
          segments: { nb_total: 10, at_risk: 1 },
          at_risk_clients: [{ ltv_kmf: 5000 }],
        })),
      });
      const View = loadIt();
      await View.render(main);
      const row = main.querySelector('.sv-rank tbody tr');
      expect(row.textContent).toContain('—');
      expect(row.textContent).toContain('?j');
    });

    it('échappe le HTML dans le nom du client (XSS)', async () => {
      setupApi({
        getClients: jest.fn().mockResolvedValue(clientsData({
          segments: { nb_total: 10, at_risk: 1 },
          at_risk_clients: [{ name: '<img src=x onerror=alert(1)>', ltv_kmf: 1000 }],
        })),
      });
      const View = loadIt();
      await View.render(main);
      expect(main.innerHTML).not.toContain('<img src=x');
      expect(main.innerHTML).toContain('&lt;img');
    });
  });

  describe('renderCashDetail (détail buckets)', () => {
    it('absent si pas de buckets', async () => {
      setupApi({ getCashUncollected: jest.fn().mockResolvedValue({}) });
      const View = loadIt();
      await View.render(main);
      expect(main.innerHTML).not.toContain('Détail cash en attente');
    });

    it('n\'affiche que les buckets avec count>0, badge is-crit pour 7j+', async () => {
      setupApi({
        getCashUncollected: jest.fn().mockResolvedValue(uncollectedData({
          buckets: {
            '0_24h': { count: 0, kmf: 0 }, '24h_48h': { count: 0, kmf: 0 },
            '48h_72h': { count: 0, kmf: 0 }, '72h_7d': { count: 0, kmf: 0 },
            '7d_plus': { count: 2, kmf: 90000 },
          },
        })),
      });
      const View = loadIt();
      await View.render(main);
      const rows = main.querySelectorAll('.sv-rank tbody tr');
      expect(rows.length).toBe(1);
      expect(rows[0].className).toContain('sv-row-bad');
      expect(rows[0].textContent).toContain('🔴 Critique');
      expect(rows[0].textContent).toContain('> 7 jours');
    });

    it('vide (toutes les buckets à 0) → section absente malgré buckets défini', async () => {
      setupApi({
        getCashUncollected: jest.fn().mockResolvedValue(uncollectedData({
          buckets: { '0_24h': { count: 0, kmf: 0 }, '24h_48h': { count: 0, kmf: 0 }, '48h_72h': { count: 0, kmf: 0 }, '72h_7d': { count: 0, kmf: 0 }, '7d_plus': { count: 0, kmf: 0 } },
        })),
      });
      const View = loadIt();
      await View.render(main);
      expect(main.innerHTML).not.toContain('Détail cash en attente');
    });
  });

  it('rendu final : footer avec horodatage et mention "8 sources agrégées"', async () => {
    setupApi();
    const View = loadIt();
    await View.render(main);
    expect(main.innerHTML).toContain('8 sources agrégées');
    expect(main.innerHTML).toMatch(/Diagnostic généré le \d{2}:\d{2}:\d{2}/);
  });
});
