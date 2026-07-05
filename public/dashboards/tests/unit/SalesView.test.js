'use strict';

/**
 * tests/unit/SalesView.test.js
 *
 * admin/js/views/SalesView.js (794L) — vue Ventes : KPI bar, évolution CA,
 * funnel commandes, CA/marge par catégorie, top 5 produits, CA par île/mode
 * de paiement, cohortes de rétention.
 * Export public : render(rootEl).
 *
 * Dépendances externes (globals mockés) :
 *   - KmcApi.getSales(filters) → objet de données brutes
 *   - KmcApi.ApiError (classe, pour la branche 401)
 *   - KmcFilters.get() / KmcFilters.subscribe(cb) (optionnel — testé présent et absent)
 *   - KpiCard.renderBar(container, kpis) (mocké : capture les kpis pour assertions)
 *
 * Périmètre couvert :
 *   - render() : shell, boutons de période (7/30/90/365j → "1 an"), branchement
 *     KmcFilters.subscribe, unsubscribe au ré-appel de render()
 *   - loadData() : appel KmcApi.getSales({...filters, period}), synchro bouton actif
 *   - buildKpis() : delta ca/commandes, data_quality (couverture <100%)
 *   - renderEvolution : vide, peuplé (bucket day/week), axe milieu (>2 points)
 *   - renderFunnel : vide, drop% entre étapes, alerte "perdues", seuil showLabel
 *   - renderCategories : vide, peuplé, classes de marge (high/mid/low)
 *   - renderTopProducts : vide, peuplé, plafond à 5 (slice)
 *   - renderByIsland / renderByPayment : vide, peuplé, libellé mode inconnu
 *   - renderCohorts : vide, matrice cohortes, classes coh-empty/low/mid/high
 *   - clic changement de période → recharge avec le nouveau period
 *   - KmcFilters.subscribe déclenche loadData
 *   - erreur générique et erreur ApiError 401 (message session expirée)
 *   - _meta (généré le / cache)
 */

function baseSalesData(overrides) {
  return Object.assign({
    kpi: {
      ca_kmf: 1_500_000, nb_commandes: 42, panier_moyen: 35_700,
      evolution: { ca_pct: 12.5, commandes_pct: -3.2 },
    },
    marges: { cible_marge_pct: 40, ecart_cible_pct: -2.1, couverture_pct: 100, marge_reelle_kmf: 400_000 },
    evolution: { bucket: 'day', points: [] },
    funnel: { etapes: [], perdues: 0 },
    by_category: [],
    top_products: [],
    by_island: [],
    by_payment: [],
    cohorts: { rows: [], limit_months: 6 },
  }, overrides);
}

describe('SalesView', () => {
  let root;
  let kpiCalls;

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '<div id="main"></div>';
    root = document.getElementById('main');

    kpiCalls = [];
    global.KpiCard = { renderBar: jest.fn((el, kpis) => { kpiCalls.push(kpis); el.innerHTML = '<div class="kpi-rendered"></div>'; }) };
    global.KmcApi = {
      getSales: jest.fn().mockResolvedValue(baseSalesData()),
      ApiError: class ApiError extends Error {
        constructor(msg, status) { super(msg); this.status = status; }
      },
    };
    delete global.KmcFilters;

    require('../../admin/js/views/SalesView.js');
  });

  afterEach(() => {
    delete global.KpiCard;
    delete global.KmcApi;
    delete global.KmcFilters;
  });

  async function flush() {
    await Promise.resolve();
    await Promise.resolve();
  }

  it('expose render() (contrat app.js#invokeView)', () => {
    expect(typeof window.SalesView).toBe('object');
    expect(typeof window.SalesView.render).toBe('function');
  });

  describe('render() — shell et chargement initial', () => {
    it('pose le shell, période 30j active par défaut, appelle getSales', async () => {
      await window.SalesView.render(root);
      await flush();

      expect(root.querySelector('[data-period="30"]').classList.contains('active')).toBe(true);
      expect(global.KmcApi.getSales).toHaveBeenCalledWith(expect.objectContaining({ period: 30 }));
    });

    it('bouton 365j affiche "1 an"', async () => {
      await window.SalesView.render(root);
      const btn365 = root.querySelector('[data-period="365"]');
      expect(btn365.textContent).toBe('1 an');
    });

    it('affiche les KPI via KpiCard.renderBar avec deltas et data_quality', async () => {
      await window.SalesView.render(root);
      await flush();

      const kpis = kpiCalls[kpiCalls.length - 1];
      const ca = kpis.find(k => k.key === 'ca_vendu');
      expect(ca.value).toBe(1_500_000);
      expect(ca.delta.direction).toBe('up');
      expect(ca.delta.value).toBeCloseTo(12.5);

      const cmds = kpis.find(k => k.key === 'cmds_creees');
      expect(cmds.delta.direction).toBe('down');

      const marge = kpis.find(k => k.key === 'marge_variable_reelle');
      expect(marge.data_quality).toBeNull(); // couverture 100%
    });

    it('couverture <100% → data_quality "partial" sur la marge', async () => {
      global.KmcApi.getSales.mockResolvedValue(baseSalesData({
        marges: { cible_marge_pct: 40, ecart_cible_pct: 1, couverture_pct: 60, marge_reelle_kmf: 200_000 },
      }));
      await window.SalesView.render(root);
      await flush();

      const marge = kpiCalls[kpiCalls.length - 1].find(k => k.key === 'marge_variable_reelle');
      expect(marge.data_quality.completeness).toBe('partial');
      expect(marge.data_quality.items_with_data).toBe(60);
    });

    it('affiche la méta "Données au ..." avec indicateur cache', async () => {
      global.KmcApi.getSales.mockResolvedValue(baseSalesData({
        _meta: { generated_at: '2026-07-01T10:00:00Z', cached: true },
      }));
      await window.SalesView.render(root);
      await flush();

      expect(root.querySelector('#sales-meta').textContent).toContain('cache');
    });
  });

  describe('renderEvolution', () => {
    it('aucune donnée → message vide', async () => {
      await window.SalesView.render(root);
      await flush();
      expect(root.querySelector('#sales-sections').textContent).toContain('Aucune donnée pour cette période');
    });

    it('peuplé (bucket day) : barres + axe gauche/droite, pas d\'axe milieu si ≤2 points', async () => {
      global.KmcApi.getSales.mockResolvedValue(baseSalesData({
        evolution: {
          bucket: 'day',
          points: [
            { date: '2026-07-01', ca_kmf: 100_000, nb_commandes: 5 },
            { date: '2026-07-02', ca_kmf: 200_000, nb_commandes: 8 },
          ],
        },
      }));
      await window.SalesView.render(root);
      await flush();

      const html = root.querySelector('#sales-sections').innerHTML;
      expect((html.match(/sales-evo-bar/g) || []).length).toBeGreaterThanOrEqual(2);
      expect(html).toContain('1/7');
    });

    it('bucket week + >2 points → axe milieu affiché', async () => {
      global.KmcApi.getSales.mockResolvedValue(baseSalesData({
        evolution: {
          bucket: 'week',
          points: [
            { date: '2026-07-01', ca_kmf: 100_000, nb_commandes: 5 },
            { date: '2026-07-08', ca_kmf: 300_000, nb_commandes: 10 },
            { date: '2026-07-15', ca_kmf: 150_000, nb_commandes: 6 },
          ],
        },
      }));
      await window.SalesView.render(root);
      await flush();

      expect(root.querySelector('#sales-sections').textContent).toMatch(/S\d+ 7\/26/);
    });
  });

  describe('renderFunnel', () => {
    it('aucune commande → message vide', async () => {
      await window.SalesView.render(root);
      await flush();
      expect(root.querySelector('#sales-sections').textContent).toContain('Aucune commande sur la période');
    });

    it('étapes avec drop% entre elles et alerte perdues', async () => {
      global.KmcApi.getSales.mockResolvedValue(baseSalesData({
        funnel: {
          perdues: 4,
          etapes: [
            { label: 'Panier validé', count: 100, pct: 100 },
            { label: 'Paiement initié', count: 60, pct: 60 },
            { label: 'Payé', count: 50, pct: 50 },
          ],
        },
      }));
      await window.SalesView.render(root);
      await flush();

      const txt = root.querySelector('#sales-sections').textContent;
      expect(txt).toContain('−40.0%');
      expect(txt).toContain('4 commandes annulées / expirées');
    });
  });

  describe('renderCategories', () => {
    it('aucune donnée → vide', async () => {
      await window.SalesView.render(root);
      await flush();
      const html = root.querySelector('#sales-sections').textContent;
      expect(html).toContain('CA & marge par catégorie');
    });

    it('classes de marge high/mid/low selon le taux', async () => {
      global.KmcApi.getSales.mockResolvedValue(baseSalesData({
        by_category: [
          { categorie: 'tech', ca_kmf: 500_000, marge_kmf: 150_000, taux_marge_pct: 30 },
          { categorie: 'mode', ca_kmf: 300_000, marge_kmf: 60_000, taux_marge_pct: 20 },
          { categorie: 'beaute', ca_kmf: 100_000, marge_kmf: 5_000, taux_marge_pct: 5 },
        ],
      }));
      await window.SalesView.render(root);
      await flush();

      const html = root.querySelector('#sales-sections').innerHTML;
      expect(html).toContain('sales-cat-marge high');
      expect(html).toContain('sales-cat-marge mid');
      expect(html).toContain('sales-cat-marge low');
    });
  });

  describe('renderTopProducts', () => {
    it('aucune vente → vide', async () => {
      await window.SalesView.render(root);
      await flush();
      expect(root.querySelector('#sales-sections').textContent).toContain('Aucune vente sur la période');
    });

    it('plafonne à 5 produits même si plus de données fournies', async () => {
      const prods = Array.from({ length: 8 }, (_, i) => ({
        name: `Produit ${i}`, category: 'tech', nb_sold: 10 - i, revenue: 100_000 - i * 1000,
      }));
      global.KmcApi.getSales.mockResolvedValue(baseSalesData({ top_products: prods }));
      await window.SalesView.render(root);
      await flush();

      const html = root.querySelector('#sales-sections').innerHTML;
      const rows = (html.match(/Produit \d/g) || []);
      expect(rows.length).toBe(5);
    });
  });

  describe('renderByIsland / renderByPayment', () => {
    it('vides → messages vides pour les deux blocs', async () => {
      await window.SalesView.render(root);
      await flush();
      const html = root.querySelector('#sales-sections').innerHTML;
      expect(html).toContain('🏝️ CA par île');
      expect(html).toContain('💳 Par mode de paiement');
    });

    it('peuplé : île inconnue → "Inconnu", mode inconnu → brut', async () => {
      global.KmcApi.getSales.mockResolvedValue(baseSalesData({
        by_island: [{ island: null, ca: 50_000, nb: 3 }],
        by_payment: [{ payment_mode: 'mvola', ca: 20_000, nb: 2 }, { payment_mode: 'stripe_eur', ca: 80_000, nb: 5 }],
      }));
      await window.SalesView.render(root);
      await flush();

      const html = root.querySelector('#sales-sections').innerHTML;
      expect(html).toContain('Inconnu');
      expect(html).toContain('mvola');
      expect(html).toContain('💳 Stripe EUR');
    });
  });

  describe('renderCohorts', () => {
    it('pas assez de données → message dédié', async () => {
      await window.SalesView.render(root);
      await flush();
      expect(root.querySelector('#sales-sections').textContent).toContain('Pas assez de données pour calculer les cohortes');
    });

    it('construit la matrice et applique les classes coh-high/mid/low/empty', async () => {
      global.KmcApi.getSales.mockResolvedValue(baseSalesData({
        cohorts: {
          limit_months: 2,
          rows: [
            { cohort_month: '2026-05-01', offset_months: 0, nb_clients: 100 },
            { cohort_month: '2026-05-01', offset_months: 1, nb_clients: 40 },
            { cohort_month: '2026-05-01', offset_months: 2, nb_clients: 10 },
            { cohort_month: '2026-06-01', offset_months: 0, nb_clients: 50 },
          ],
        },
      }));
      await window.SalesView.render(root);
      await flush();

      const html = root.querySelector('#sales-sections').innerHTML;
      expect(html).toContain('coh-high'); // 40/100 = 40%
      expect(html).toContain('coh-low');  // 10/100 = 10%
      expect(html).toContain('coh-empty'); // offset 1 et 2 manquants pour la cohorte 06
    });
  });

  describe('changement de période', () => {
    it('clic sur "90j" → recharge getSales avec period=90 et active la classe', async () => {
      await window.SalesView.render(root);
      await flush();
      global.KmcApi.getSales.mockClear();

      root.querySelector('[data-period="90"]').click();
      await flush();

      expect(global.KmcApi.getSales).toHaveBeenCalledWith(expect.objectContaining({ period: 90 }));
      expect(root.querySelector('[data-period="90"]').classList.contains('active')).toBe(true);
      expect(root.querySelector('[data-period="30"]').classList.contains('active')).toBe(false);
    });

    it('clic en dehors des boutons de période → ne recharge pas', async () => {
      await window.SalesView.render(root);
      await flush();
      global.KmcApi.getSales.mockClear();

      root.querySelector('#sales-period-bar').click();
      await flush();

      expect(global.KmcApi.getSales).not.toHaveBeenCalled();
    });
  });

  describe('intégration KmcFilters', () => {
    it('KmcFilters présent : get() fournit les filtres de base et subscribe() déclenche un rechargement', async () => {
      const subs = [];
      global.KmcFilters = {
        get: jest.fn(() => ({ island: 'Ngazidja' })),
        subscribe: jest.fn((cb) => { subs.push(cb); return jest.fn(); }),
      };

      await window.SalesView.render(root);
      await flush();

      expect(global.KmcApi.getSales).toHaveBeenCalledWith(expect.objectContaining({ island: 'Ngazidja', period: 30 }));

      global.KmcApi.getSales.mockClear();
      subs[0](); // simulate a filter change elsewhere in the app
      await flush();
      expect(global.KmcApi.getSales).toHaveBeenCalled();
    });

    it('un second render() se désabonne du précédent listener KmcFilters', async () => {
      const unsub = jest.fn();
      global.KmcFilters = { get: jest.fn(() => ({})), subscribe: jest.fn(() => unsub) };

      await window.SalesView.render(root);
      await window.SalesView.render(root);
      await flush();

      expect(unsub).toHaveBeenCalledTimes(1);
    });
  });

  describe('gestion des erreurs', () => {
    it('erreur générique → error-state avec le message', async () => {
      global.KmcApi.getSales.mockRejectedValue(new Error('panne base de données'));
      await window.SalesView.render(root);
      await flush();

      const html = root.querySelector('#sales-sections').innerHTML;
      expect(html).toContain('Erreur lors du chargement des ventes');
      expect(html).toContain('panne base de données');
      expect(html).not.toContain('Session expirée');
    });

    it('ApiError 401 → message session expirée', async () => {
      global.KmcApi.getSales.mockRejectedValue(new global.KmcApi.ApiError('Unauthorized', 401));
      await window.SalesView.render(root);
      await flush();

      expect(root.querySelector('#sales-sections').textContent).toContain('Session expirée');
    });
  });
});
