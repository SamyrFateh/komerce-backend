'use strict';

/**
 * tests/unit/EconomicView.test.js
 *
 * admin/js/views/EconomicView.js (233L) — Santé économique /admin/economic
 * Export réel : window.EconomicView = { render } (IIFE, render async).
 *
 * Deux lectures indépendantes, jamais mélangées :
 *   - Vue CATALOGUE (par article) : KmcApi.getPricingDashboard()
 *   - Vue MOIS (agrégat) : KmcApi.getEconomicExecutive()
 *   + KmcApi.getEconomicCharges(), KmcApi.getEconomicCoherence()
 * Toutes les 4 sont appelées via Promise.all avec .catch(() => null) inline
 * dans le composant lui-même : Promise.all ne rejette donc jamais.
 *
 * Dépendances optionnelles (globals, testées présentes ET absentes) :
 *   - KpiCard.renderBar (toujours requis, catégoriel + mensuel)
 *   - global.AlertList.renderList (fallback HTML échappé si absent)
 *   - global.DataTable.render (fallback liste échappée si absent)
 *
 * Périmètre couvert :
 *   - render() : shell (ids eco-frontiers/eco-cat-kpis/eco-action/eco-sot/
 *     eco-verdict/eco-month-kpis/eco-alerts/eco-charges/eco-meta), appel des
 *     4 endpoints, guard rootEl détaché après Promise.all, timestamp eco-meta
 *   - _renderFrontiers : catalogue indisponible, calcul total + pourcentages,
 *     4 cellules (destructive/undercovered/covered/unpriced), total=0
 *   - _renderCatKpis : kpis absents (vide), 6 KPI catégoriels avec formats
 *   - _renderAction : priorité destructive > undercovered > unpriced > vert
 *   - _renderSot : source_of_truth === 'pricing-engine' vs absent
 *   - _renderVerdict : exec absent, seuil/ordered manquants (indéterminé),
 *     rentable (>=110%), proche du seuil (90-110%), non rentable (<90%),
 *     alias de champs (commandes_collectees/seuil_rentabilite)
 *   - _renderMonthKpis : exec absent (vide), 6 KPI mensuels + alias de champs
 *   - _renderAlerts : concat dash.alerts+coherence.alerts, AlertList présent
 *     vs fallback échappé, cas vide
 *   - _renderCharges : charges absent, DataTable présent vs fallback
 *     échappé, formes charges.items / charges.charges / tableau brut
 */

const {
  loadView, makeKmcApi, makeKpiCard, cleanupGlobals, flush,
} = require('./helpers/dashboardTestKit');

function baseDash(overrides) {
  return Object.assign({
    frontiers: { destructive: 0, undercovered: 0, covered: 20, unpriced: 0 },
    kpis: {
      marge_moyenne_pct: 32.5, marge_cible_pct: 30, ecart_cible_pct: 2.5,
      couverture_cost_pct: 118, n3_fixed_overhead_allocation_kmf: 4200,
      nb_total: 20, source_of_truth: 'pricing-engine',
    },
    alerts: [],
  }, overrides);
}

function baseExec(overrides) {
  return Object.assign({
    kpis: {
      orders_this_month: 120, breakeven_orders: 100,
      ca_mensuel_kmf: 6_000_000, avg_order_kmf: 50_000,
      avg_contribution_kmf: 12_000, fixed_charges_kmf: 900_000,
    },
  }, overrides);
}

describe('EconomicView', () => {
  let EconomicView;
  let main;

  beforeEach(() => {
    document.body.innerHTML = '<div id="main"></div>';
    main = document.getElementById('main');
    makeKpiCard();
  });

  afterEach(() => {
    cleanupGlobals('KmcApi', 'KpiCard');
    delete global.AlertList;
    delete global.DataTable;
  });

  function setupApi(overrides = {}) {
    return makeKmcApi(Object.assign({
      getPricingDashboard: jest.fn().mockResolvedValue(baseDash()),
      getEconomicExecutive: jest.fn().mockResolvedValue(baseExec()),
      getEconomicCharges: jest.fn().mockResolvedValue({ items: [] }),
      getEconomicCoherence: jest.fn().mockResolvedValue({ alerts: [] }),
    }, overrides));
  }

  it('expose render() (contrat app.js#invokeView)', () => {
    setupApi();
    EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
    expect(typeof EconomicView.render).toBe('function');
  });

  describe('render() — shell et chargement', () => {
    it('pose le shell complet et appelle les 4 endpoints', async () => {
      const api = setupApi();
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);

      ['eco-frontiers', 'eco-cat-kpis', 'eco-action', 'eco-sot', 'eco-verdict',
       'eco-month-kpis', 'eco-alerts', 'eco-charges', 'eco-meta'].forEach(id => {
        expect(main.querySelector('#' + id)).toBeTruthy();
      });
      expect(api.getPricingDashboard).toHaveBeenCalledTimes(1);
      expect(api.getEconomicExecutive).toHaveBeenCalledTimes(1);
      expect(api.getEconomicCharges).toHaveBeenCalledTimes(1);
      expect(api.getEconomicCoherence).toHaveBeenCalledTimes(1);
    });

    it("n'écrit rien si rootEl est détaché du DOM après Promise.all (guard navigation)", async () => {
      setupApi();
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      const detached = document.createElement('div');
      detached.innerHTML = '<div id="eco-frontiers"></div>';
      await EconomicView.render(detached);
      // Le rendu shell initial (synchrone) a bien eu lieu, mais aucun sous-rendu
      // post Promise.all n'a modifié le eco-frontiers d'origine (retiré par le guard)
      expect(detached.querySelector('#eco-meta').textContent).toBe('');
    });

    it("tolère l'échec d'un ou plusieurs endpoints (chacun catché en interne, Promise.all ne rejette jamais)", async () => {
      setupApi({
        getPricingDashboard: jest.fn().mockRejectedValue(new Error('boom')),
        getEconomicExecutive: jest.fn().mockRejectedValue(new Error('boom')),
        getEconomicCharges: jest.fn().mockRejectedValue(new Error('boom')),
        getEconomicCoherence: jest.fn().mockRejectedValue(new Error('boom')),
      });
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await expect(EconomicView.render(main)).resolves.toBeUndefined();
      expect(main.querySelector('#eco-frontiers').innerHTML).toContain('Catalogue moteur indisponible');
      expect(main.querySelector('#eco-verdict').innerHTML).toContain('Données mensuelles indisponibles');
      expect(main.querySelector('#eco-charges').innerHTML).toContain('Données charges indisponibles');
      expect(main.querySelector('#eco-alerts').innerHTML).toContain('Aucune anomalie');
    });

    it('affiche un timestamp dans eco-meta', async () => {
      setupApi();
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      expect(main.querySelector('#eco-meta').textContent).toContain('Catalogue : vérité moteur');
    });
  });

  describe('_renderFrontiers (vue catalogue)', () => {
    it('affiche un état vide quand dash.frontiers est absent', async () => {
      setupApi({ getPricingDashboard: jest.fn().mockResolvedValue({}) });
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      expect(main.querySelector('#eco-frontiers').innerHTML).toContain('Catalogue moteur indisponible');
    });

    it('calcule le total et les pourcentages des 4 cellules', async () => {
      setupApi({
        getPricingDashboard: jest.fn().mockResolvedValue(
          baseDash({ frontiers: { destructive: 5, undercovered: 15, covered: 75, unpriced: 5 } })
        ),
      });
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      const html = main.querySelector('#eco-frontiers').innerHTML;
      expect(html).toContain('100 produits');
      expect(html).toContain('5%'); // destructive: 5/100
      expect(html).toContain('15%'); // undercovered
      expect(html).toContain('75%'); // covered
      expect(html).toContain('À perte');
      expect(html).toContain('Sous-couvert');
      expect(html).toContain('Couvert');
      expect(html).toContain('Sans prix');
    });

    it('gère un total à 0 sans diviser par zéro (0% partout)', async () => {
      setupApi({
        getPricingDashboard: jest.fn().mockResolvedValue(
          baseDash({ frontiers: { destructive: 0, undercovered: 0, covered: 0, unpriced: 0 } })
        ),
      });
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      expect(main.querySelector('#eco-frontiers').innerHTML).toContain('0 produits');
    });
  });

  describe('_renderCatKpis (vue catalogue)', () => {
    it('ne rend rien quand dash.kpis est absent', async () => {
      setupApi({ getPricingDashboard: jest.fn().mockResolvedValue({ frontiers: baseDash().frontiers }) });
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      expect(main.querySelector('#eco-cat-kpis').innerHTML).toBe('');
      expect(global.KpiCard.renderBar.mock.calls.some(c => c[0] === main.querySelector('#eco-cat-kpis'))).toBe(false);
    });

    it('appelle KpiCard.renderBar avec les 6 KPI catégoriels formatés', async () => {
      setupApi();
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      const [, kpis] = global.KpiCard.renderBar.mock.calls.find(
        c => c[0] === main.querySelector('#eco-cat-kpis')
      );
      const byKey = Object.fromEntries(kpis.map(k => [k.key, k.value]));
      expect(byKey.marge_eff).toBe('32.5%');
      expect(byKey.marge_cible).toBe('30.0%');
      expect(byKey.ecart).toBe('+2.5%');
      expect(byKey.couverture).toBe('118.0%');
      expect(byKey.total).toBe('20');
    });

    it("préfixe l'écart négatif sans double signe", async () => {
      setupApi({
        getPricingDashboard: jest.fn().mockResolvedValue(baseDash({ kpis: Object.assign({}, baseDash().kpis, { ecart_cible_pct: -4.2 }) })),
      });
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      const [, kpis] = global.KpiCard.renderBar.mock.calls.find(
        c => c[0] === main.querySelector('#eco-cat-kpis')
      );
      expect(kpis.find(k => k.key === 'ecart').value).toBe('-4.2%');
    });
  });

  describe('_renderAction (bandeau priorité catalogue)', () => {
    it('priorité 1 : produits à perte (destructive > 0) → rouge', async () => {
      setupApi({ getPricingDashboard: jest.fn().mockResolvedValue(baseDash({ frontiers: { destructive: 3, undercovered: 2, covered: 10, unpriced: 1 } })) });
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      const html = main.querySelector('#eco-action').innerHTML;
      expect(html).toContain('is-red');
      expect(html).toContain('3 produit(s) vendus à perte');
    });

    it('priorité 2 : sous-couvert (pas de destructive) → ambre', async () => {
      setupApi({ getPricingDashboard: jest.fn().mockResolvedValue(baseDash({ frontiers: { destructive: 0, undercovered: 4, covered: 10, unpriced: 1 } })) });
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      const html = main.querySelector('#eco-action').innerHTML;
      expect(html).toContain('is-amber');
      expect(html).toContain('4 produit(s) sous le CDR');
    });

    it('priorité 3 : sans prix (ni destructive ni undercovered) → neutre', async () => {
      setupApi({ getPricingDashboard: jest.fn().mockResolvedValue(baseDash({ frontiers: { destructive: 0, undercovered: 0, covered: 10, unpriced: 2 } })) });
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      expect(main.querySelector('#eco-action').innerHTML).toContain('2 produit(s) sans prix');
    });

    it('tout couvert → vert', async () => {
      setupApi({ getPricingDashboard: jest.fn().mockResolvedValue(baseDash({ frontiers: { destructive: 0, undercovered: 0, covered: 20, unpriced: 0 } })) });
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      const html = main.querySelector('#eco-action').innerHTML;
      expect(html).toContain('is-green');
      expect(html).toContain('couvre au moins son CDR');
    });

    it('ne rend rien si frontiers absent', async () => {
      setupApi({ getPricingDashboard: jest.fn().mockResolvedValue({ kpis: baseDash().kpis }) });
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      expect(main.querySelector('#eco-action').innerHTML).toBe('');
    });
  });

  describe('_renderSot', () => {
    it('affiche le badge vérité unique quand source_of_truth === pricing-engine', async () => {
      setupApi();
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      expect(main.querySelector('#eco-sot').textContent).toContain('vérité unique');
    });

    it('ne rend rien si source_of_truth diffère', async () => {
      setupApi({
        getPricingDashboard: jest.fn().mockResolvedValue(baseDash({ kpis: Object.assign({}, baseDash().kpis, { source_of_truth: 'legacy' }) })),
      });
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      expect(main.querySelector('#eco-sot').textContent).toBe('');
    });
  });

  describe('_renderVerdict (vue mois)', () => {
    it('exec absent → message indisponible', async () => {
      setupApi({ getEconomicExecutive: jest.fn().mockResolvedValue(null) });
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      expect(main.querySelector('#eco-verdict').innerHTML).toContain('Données mensuelles indisponibles');
    });

    it('seuil ou commandes manquants → rentabilité indéterminée', async () => {
      setupApi({ getEconomicExecutive: jest.fn().mockResolvedValue({ kpis: { orders_this_month: 0, breakeven_orders: 0 } }) });
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      expect(main.querySelector('#eco-verdict').innerHTML).toContain('indéterminée');
    });

    it('commandes >= seuil*1.1 → mois rentable (vert)', async () => {
      setupApi({ getEconomicExecutive: jest.fn().mockResolvedValue(baseExec({ kpis: Object.assign({}, baseExec().kpis, { orders_this_month: 111, breakeven_orders: 100 }) })) });
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      const el = main.querySelector('#eco-verdict');
      expect(el.className).toContain('is-green');
      expect(el.innerHTML).toContain('Mois rentable');
    });

    it('commandes entre 90% et 110% du seuil → proche du seuil (ambre)', async () => {
      setupApi({ getEconomicExecutive: jest.fn().mockResolvedValue(baseExec({ kpis: Object.assign({}, baseExec().kpis, { orders_this_month: 95, breakeven_orders: 100 }) })) });
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      const el = main.querySelector('#eco-verdict');
      expect(el.className).toContain('is-amber');
      expect(el.innerHTML).toContain('Proche du seuil');
    });

    it('commandes < 90% du seuil → mois non rentable (rouge), manque calculé', async () => {
      setupApi({ getEconomicExecutive: jest.fn().mockResolvedValue(baseExec({ kpis: Object.assign({}, baseExec().kpis, { orders_this_month: 60, breakeven_orders: 100 }) })) });
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      const el = main.querySelector('#eco-verdict');
      expect(el.className).toContain('is-red');
      expect(el.innerHTML).toContain('Mois non rentable');
      expect(el.innerHTML).toContain('40 commande(s)');
    });

    it('supporte les alias de champs (commandes_collectees / seuil_rentabilite)', async () => {
      setupApi({ getEconomicExecutive: jest.fn().mockResolvedValue({ kpis: { commandes_collectees: 120, seuil_rentabilite: 100 } }) });
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      expect(main.querySelector('#eco-verdict').innerHTML).toContain('Mois rentable');
    });

    it("accepte exec sans clé kpis (objet plat directement)", async () => {
      setupApi({ getEconomicExecutive: jest.fn().mockResolvedValue({ orders_this_month: 120, breakeven_orders: 100 }) });
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      expect(main.querySelector('#eco-verdict').innerHTML).toContain('Mois rentable');
    });
  });

  describe('_renderMonthKpis (vue mois)', () => {
    it('ne rend rien quand exec est absent', async () => {
      setupApi({ getEconomicExecutive: jest.fn().mockResolvedValue(null) });
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      expect(main.querySelector('#eco-month-kpis').innerHTML).toBe('');
    });

    it('appelle KpiCard.renderBar avec les 6 KPI mensuels', async () => {
      setupApi();
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      const [, kpis] = global.KpiCard.renderBar.mock.calls.find(
        c => c[0] === main.querySelector('#eco-month-kpis')
      );
      const byKey = Object.fromEntries(kpis.map(k => [k.key, k.value]));
      expect(byKey.commandes).toBe('120');
      expect(byKey.seuil).toBe('100 cmds');
      expect(byKey.ca).toContain('KMF');
    });

    it('supporte les alias de champs (revenue_kmf, panier_moyen_kmf, etc.)', async () => {
      setupApi({
        getEconomicExecutive: jest.fn().mockResolvedValue({
          kpis: {
            revenue_kmf: 1_000_000, panier_moyen_kmf: 25_000,
            contribution_moyenne_kmf: 5_000, charges_fixes_mensuelles_kmf: 300_000,
            commandes_collectees: 40, seuil_rentabilite: 50,
          },
        }),
      });
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      const [, kpis] = global.KpiCard.renderBar.mock.calls.find(
        c => c[0] === main.querySelector('#eco-month-kpis')
      );
      const byKey = Object.fromEntries(kpis.map(k => [k.key, k.value]));
      expect(byKey.commandes).toBe('40');
      expect(byKey.seuil).toBe('50 cmds');
    });
  });

  describe('_renderAlerts', () => {
    it('concatène dash.alerts et coherence.alerts, fallback échappé sans AlertList', async () => {
      setupApi({
        getPricingDashboard: jest.fn().mockResolvedValue(baseDash({ alerts: [{ title: '<b>Alerte prix</b>' }] })),
        getEconomicCoherence: jest.fn().mockResolvedValue({ alerts: [{ message: 'Écart détecté' }] }),
      });
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      const html = main.querySelector('#eco-alerts').innerHTML;
      expect(html).not.toContain('<b>Alerte prix</b>');
      expect(html).toContain('&lt;b&gt;Alerte prix&lt;/b&gt;');
      expect(html).toContain('Écart détecté');
    });

    it('affiche un état vide sans alerte', async () => {
      setupApi();
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      expect(main.querySelector('#eco-alerts').innerHTML).toContain('Aucune anomalie');
    });

    it('délègue à AlertList.renderList si présent', async () => {
      global.AlertList = { renderList: jest.fn() };
      setupApi({
        getPricingDashboard: jest.fn().mockResolvedValue(baseDash({ alerts: [{ title: 'x' }] })),
      });
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      expect(global.AlertList.renderList).toHaveBeenCalledWith(
        main.querySelector('#eco-alerts'),
        expect.arrayContaining([expect.objectContaining({ title: 'x' })]),
        { limit: 12, emptyText: '✓ Aucune anomalie détectée' }
      );
    });
  });

  describe('_renderCharges', () => {
    it('affiche un état vide quand charges est absent', async () => {
      setupApi({ getEconomicCharges: jest.fn().mockResolvedValue(null) });
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      expect(main.querySelector('#eco-charges').innerHTML).toContain('Données charges indisponibles');
    });

    it('délègue à DataTable.render si présent (forme charges.items)', async () => {
      global.DataTable = { render: jest.fn() };
      setupApi({
        getEconomicCharges: jest.fn().mockResolvedValue({ items: [{ label: 'Loyer', amount_kmf: 200000 }] }),
      });
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      expect(global.DataTable.render).toHaveBeenCalledWith(
        main.querySelector('#eco-charges'),
        expect.objectContaining({ rows: [{ label: 'Loyer', amount_kmf: 200000 }] })
      );
    });

    it('les colonnes DataTable exposent des render() avec repli sur les alias de champs', async () => {
      global.DataTable = { render: jest.fn() };
      setupApi({
        getEconomicCharges: jest.fn().mockResolvedValue({ items: [{ category: 'Loyer', name: 'Bureau', amount: 10000, month: '2026-07' }] }),
      });
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      const config = global.DataTable.render.mock.calls[0][1];
      const row = config.rows[0];
      expect(config.columns.find(c => c.key === 'family').render(row)).toBe('Loyer');
      expect(config.columns.find(c => c.key === 'label').render(row)).toBe('Bureau');
      expect(config.columns.find(c => c.key === 'amount_kmf').render(row)).toMatch(/10.000 KMF/);
      expect(config.columns.find(c => c.key === 'period').render(row)).toBe('2026-07');
      expect(config.columns.find(c => c.key === 'family').render({})).toBe('—');
    });

    it('fallback échappé sans DataTable (forme charges.charges)', async () => {
      setupApi({
        getEconomicCharges: jest.fn().mockResolvedValue({ charges: [{ label: '<i>Salaires</i>', amount_kmf: 500000 }] }),
      });
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      const html = main.querySelector('#eco-charges').innerHTML;
      expect(html).not.toContain('<i>Salaires</i>');
      expect(html).toContain('&lt;i&gt;Salaires&lt;/i&gt;');
    });

    it('accepte un tableau brut directement (charges = [...])', async () => {
      setupApi({
        getEconomicCharges: jest.fn().mockResolvedValue([{ name: 'Internet', amount: 30000 }]),
      });
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      expect(main.querySelector('#eco-charges').innerHTML).toContain('Internet');
    });

    it('liste vide → état vide', async () => {
      setupApi({ getEconomicCharges: jest.fn().mockResolvedValue({ items: [] }) });
      EconomicView = loadView('../../admin/js/views/EconomicView.js', 'EconomicView');
      await EconomicView.render(main);
      expect(main.querySelector('#eco-charges').innerHTML).toContain('Aucune charge');
    });
  });
});
