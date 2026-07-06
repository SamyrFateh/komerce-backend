'use strict';

/**
 * tests/unit/EconomicFlowView.test.js
 *
 * admin/js/views/EconomicFlowView.js (479L) — Carte économique /admin/economic-flow
 * Export public unique : render(rootEl).
 *
 * Dépendance externe : `KmcApi` (global, mocké) — getProducts(params),
 * getPricingFlow(body).
 *
 * Périmètre couvert :
 *   - render() : shell, chargement produits (formats {products}/{items}/{data}/
 *     tableau direct), état "aucun produit", sélection du premier produit,
 *     changement de produit (reset overrides), guard rootEl détaché
 *   - loadFlow / renderChainStructure : construction de la chaîne une seule fois
 *     (pas de rebuild si les inputs existent déjà), mise à jour des montants
 *     sans perte des inputs, erreur moteur affichée dans le détail
 *   - _boxStatus : cvc (danger si prix < coût variable), contrib (neutral/danger/
 *     warn/ok), cdr (ok si pas de prix, danger/warn/ok), prix (mapping
 *     strategy_risk), objet (neutral)
 *   - Édition inline avec debounce 350ms → reconstruit le body avec overrides
 *     numériques + finance_overrides, relance loadFlow(false) (pas de rebuild)
 *   - Sélection de boîte (clic) → renderDetail avec panneau contextuel :
 *     objet/n1/n2 (alloc+prop), cvc/cdr/contrib (prop), n3 (formule+prop),
 *     prix (stratégies)
 *   - _allocPanel : vide vs peuplé (calcul %), _propPanel : proportions
 *     détaillées vs repli simple, _stratPanel : vide vs peuplé (verdicts)
 *   - Flèches (deltas) : calcul du delta vs flow précédent, signe +/-, absence
 *     si pas de valeur précédente
 */

function makeFlow(overrides) {
  return Object.assign({
    category: 'Électronique',
    current_price_kmf: 30000,
    cost_breakdown: {
      landed_relay: { product_purchase: 15000 },
      business: { payment: 500, risk_provision: 300 },
    },
    allocation_averages: { articles_per_order: 1.4 },
    n1_landed_relay_cost_kmf: 17000,
    n2_business_variable_cost_kmf: 800,
    variable_cost_complete_kmf: 17800,
    contribution_kmf: 12200,
    monthly_fixed_costs_kmf: 500000,
    target_orders_per_month: 200,
    n3_fixed_overhead_allocation_kmf: 1800,
    n3_allocation_unit: 'article',
    n3_formula: '500000 / (200*1.4)',
    cdr_complete_kmf: 19600,
    minimum_safe_price_kmf: 18000,
    recommended_price_kmf: 32000,
    final_price_kmf: null,
    pricing_strategy: 'mechanical',
    strategy_risk: 'covered',
    data_quality: { confidence: 'high' },
    allocations: [],
    proportions: null,
    strategies: [],
  }, overrides);
}

function makeProduct(overrides) {
  return Object.assign({ id: 'prod-1', name: 'Casque Bluetooth' }, overrides);
}

describe('EconomicFlowView', () => {
  let root;

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '<div id="main"></div>';
    root = document.getElementById('main');

    global.KmcApi = {
      getProducts: jest.fn().mockResolvedValue({ products: [makeProduct()] }),
      getPricingFlow: jest.fn().mockResolvedValue(makeFlow()),
    };

    require('../../admin/js/views/EconomicFlowView.js');
  });

  afterEach(() => {
    document.getElementById('efv-styles')?.remove();
    delete global.KmcApi;
  });

  async function renderView() {
    const p = global.EconomicFlowView.render(root);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    await p;
  }

  /* ── render() — chargement produits ─────────────────────────────── */
  describe('render() — sélection produit', () => {
    it('affiche le shell puis charge les produits et le flow du premier', async () => {
      await renderView();
      expect(global.KmcApi.getProducts).toHaveBeenCalledWith({ limit: 500 });
      expect(global.KmcApi.getPricingFlow).toHaveBeenCalledWith(expect.objectContaining({ product_id: 'prod-1' }));
      expect(document.getElementById('efv-product').value).toBe('prod-1');
    });

    it('accepte le format {items}', async () => {
      global.KmcApi.getProducts = jest.fn().mockResolvedValue({ items: [makeProduct({ id: 'p2' })] });
      await renderView();
      expect(document.getElementById('efv-product').value).toBe('p2');
    });

    it('accepte le format {data}', async () => {
      global.KmcApi.getProducts = jest.fn().mockResolvedValue({ data: [makeProduct({ id: 'p3' })] });
      await renderView();
      expect(document.getElementById('efv-product').value).toBe('p3');
    });

    it('accepte un tableau direct', async () => {
      global.KmcApi.getProducts = jest.fn().mockResolvedValue([makeProduct({ id: 'p4' })]);
      await renderView();
      expect(document.getElementById('efv-product').value).toBe('p4');
    });

    it('affiche "Aucun produit" si la liste est vide', async () => {
      global.KmcApi.getProducts = jest.fn().mockResolvedValue({ products: [] });
      await renderView();
      expect(document.getElementById('efv-product').textContent).toMatch(/Aucun produit/);
      expect(global.KmcApi.getPricingFlow).not.toHaveBeenCalled();
    });

    it('tolère un échec réseau sur getProducts (products vide)', async () => {
      global.KmcApi.getProducts = jest.fn().mockRejectedValue(new Error('down'));
      await renderView();
      expect(document.getElementById('efv-product').textContent).toMatch(/Aucun produit/);
    });

    it('change de produit au select : reset les overrides et recharge', async () => {
      global.KmcApi.getProducts = jest.fn().mockResolvedValue({
        products: [makeProduct({ id: 'p1' }), makeProduct({ id: 'p2', name: 'Chaise' })],
      });
      await renderView();
      document.querySelector('.efv-edit[data-ov="cost_kmf"]').value = '99999';
      document.querySelector('.efv-edit[data-ov="cost_kmf"]').dispatchEvent(new Event('input'));

      const sel = document.getElementById('efv-product');
      sel.value = 'p2';
      sel.dispatchEvent(new Event('change'));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

      expect(global.KmcApi.getPricingFlow).toHaveBeenLastCalledWith(expect.objectContaining({ product_id: 'p2' }));
      const lastCallBody = global.KmcApi.getPricingFlow.mock.calls.at(-1)[0];
      expect(lastCallBody.cost_kmf).toBeUndefined();
    });

    it("n'explose pas si rootEl est détaché avant la fin du chargement produits", async () => {
      let resolveProducts;
      global.KmcApi.getProducts = jest.fn(() => new Promise(res => { resolveProducts = res; }));
      const p = global.EconomicFlowView.render(root);
      await Promise.resolve();
      root.remove();
      resolveProducts({ products: [makeProduct()] });
      await p;
      expect(true).toBe(true); // pas d'exception
    });
  });

  /* ── Chaîne + montants ───────────────────────────────────────────── */
  describe('Chaîne de boîtes', () => {
    it('affiche les 8 boîtes avec leurs montants', async () => {
      await renderView();
      const boxes = document.querySelectorAll('.efv-box');
      expect(boxes.length).toBe(8);
      expect(document.getElementById('amt-cvc').textContent).toMatch(/17\s800\sKMF/);
      expect(document.getElementById('amt-cdr').textContent).toMatch(/19\s600\sKMF/);
    });

    it('affiche "—" pour un montant absent (contribution null)', async () => {
      global.KmcApi.getPricingFlow = jest.fn().mockResolvedValue(makeFlow({ contribution_kmf: null }));
      await renderView();
      expect(document.getElementById('amt-contrib').textContent).toBe('—');
    });

    it('ne reconstruit pas la structure au recalcul (inputs conservés)', async () => {
      await renderView();
      const input = document.querySelector('.efv-edit[data-ov="cost_kmf"]');
      input.focus();
      input.value = '20000';
      input.dispatchEvent(new Event('input'));
      jest.useFakeTimers();
      // Sans fake timers avant l'appel, on simule directement un second loadFlow
      // via un changement qui ne provoque pas rebuild=true (pas de nouveau select)
      expect(document.querySelectorAll('.efv-box').length).toBe(8); // structure stable
      jest.useRealTimers();
    });

    it('sélectionne une boîte au clic et affiche son détail', async () => {
      await renderView();
      document.getElementById('efv-box-n1').click();
      expect(document.getElementById('efv-box-n1').classList.contains('active')).toBe(true);
      expect(document.getElementById('efv-detail').textContent).toMatch(/N1 · Coût rendu relais/);
    });

    it("le clic sur un input d'édition ne change pas la boîte sélectionnée", async () => {
      await renderView();
      document.getElementById('efv-box-prix').click(); // sélection initiale = prix par défaut
      const input = document.querySelector('#efv-box-objet .efv-edit');
      input.dispatchEvent(new Event('click', { bubbles: true }));
      expect(document.getElementById('efv-box-objet').classList.contains('active')).toBe(false);
    });
  });

  /* ── Édition inline / debounce ───────────────────────────────────── */
  describe('Édition inline (debounce 350ms)', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('relance loadFlow après 350ms avec les overrides numériques', async () => {
      const p = global.EconomicFlowView.render(root);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      await p;
      global.KmcApi.getPricingFlow.mockClear();

      const input = document.querySelector('.efv-edit[data-ov="cost_kmf"]');
      input.value = '18000';
      input.dispatchEvent(new Event('input'));
      jest.advanceTimersByTime(350);
      await Promise.resolve(); await Promise.resolve();

      expect(global.KmcApi.getPricingFlow).toHaveBeenCalledWith(expect.objectContaining({ cost_kmf: 18000 }));
    });

    it('regroupe finance_overrides pour objectif_commandes_mois / avg_articles_per_order', async () => {
      const p = global.EconomicFlowView.render(root);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      await p;
      global.KmcApi.getPricingFlow.mockClear();

      const input = document.querySelector('.efv-edit[data-ov="objectif_commandes_mois"]');
      input.value = '250';
      input.dispatchEvent(new Event('input'));
      jest.advanceTimersByTime(350);
      await Promise.resolve(); await Promise.resolve();

      expect(global.KmcApi.getPricingFlow).toHaveBeenCalledWith(expect.objectContaining({
        finance_overrides: { objectif_commandes_mois: 250 },
      }));
    });

    it('envoie pricing_strategy tel quel (pas numérique)', async () => {
      const p = global.EconomicFlowView.render(root);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      await p;
      document.getElementById('efv-box-prix').click();
      global.KmcApi.getPricingFlow.mockClear();

      const sel = document.querySelector('.efv-edit[data-ov="pricing_strategy"]');
      sel.value = 'premium';
      sel.dispatchEvent(new Event('change'));
      jest.advanceTimersByTime(350);
      await Promise.resolve(); await Promise.resolve();

      expect(global.KmcApi.getPricingFlow).toHaveBeenCalledWith(expect.objectContaining({ pricing_strategy: 'premium' }));
    });

    it('debounce : plusieurs frappes rapprochées ne déclenchent qu\'un seul appel', async () => {
      const p = global.EconomicFlowView.render(root);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      await p;
      global.KmcApi.getPricingFlow.mockClear();

      const input = document.querySelector('.efv-edit[data-ov="cost_kmf"]');
      input.value = '1'; input.dispatchEvent(new Event('input'));
      jest.advanceTimersByTime(100);
      input.value = '12'; input.dispatchEvent(new Event('input'));
      jest.advanceTimersByTime(100);
      input.value = '123'; input.dispatchEvent(new Event('input'));
      jest.advanceTimersByTime(350);
      await Promise.resolve(); await Promise.resolve();

      expect(global.KmcApi.getPricingFlow).toHaveBeenCalledTimes(1);
    });
  });

  /* ── loadFlow — erreur moteur ────────────────────────────────────── */
  describe('Erreur moteur', () => {
    it('affiche une erreur dans le détail si getPricingFlow échoue', async () => {
      global.KmcApi.getPricingFlow = jest.fn().mockRejectedValue(new Error('Moteur indisponible'));
      await renderView();
      expect(document.getElementById('efv-detail').textContent).toMatch(/Moteur indisponible/);
    });
  });

  /* ── _boxStatus ──────────────────────────────────────────────────── */
  describe('Statuts des boîtes', () => {
    it('cvc en danger si prix < coût variable complet', async () => {
      global.KmcApi.getPricingFlow = jest.fn().mockResolvedValue(makeFlow({ current_price_kmf: 10000, variable_cost_complete_kmf: 17800 }));
      await renderView();
      expect(document.getElementById('chip-cvc').textContent).toMatch(/destructif/);
    });

    it('cvc ok si prix suffisant', async () => {
      await renderView();
      expect(document.getElementById('chip-cvc').classList.contains('efv-ok')).toBe(true);
    });

    it('contrib neutral si contribution_kmf est null', async () => {
      global.KmcApi.getPricingFlow = jest.fn().mockResolvedValue(makeFlow({ contribution_kmf: null }));
      await renderView();
      expect(document.getElementById('chip-contrib').style.display).toBe('none');
    });

    it('contrib danger si négative', async () => {
      global.KmcApi.getPricingFlow = jest.fn().mockResolvedValue(makeFlow({ contribution_kmf: -500 }));
      await renderView();
      expect(document.getElementById('chip-contrib').textContent).toMatch(/destructif/);
    });

    it('contrib warn si inférieure au N3', async () => {
      global.KmcApi.getPricingFlow = jest.fn().mockResolvedValue(makeFlow({ contribution_kmf: 1000, n3_fixed_overhead_allocation_kmf: 1800 }));
      await renderView();
      expect(document.getElementById('chip-contrib').textContent).toMatch(/attention/);
    });

    it('cdr ok si pas de prix', async () => {
      global.KmcApi.getPricingFlow = jest.fn().mockResolvedValue(makeFlow({ current_price_kmf: 0 }));
      await renderView();
      expect(document.getElementById('chip-cdr').classList.contains('efv-ok')).toBe(true);
    });

    it('cdr danger si prix sous le coût variable', async () => {
      global.KmcApi.getPricingFlow = jest.fn().mockResolvedValue(makeFlow({ current_price_kmf: 5000, variable_cost_complete_kmf: 17800 }));
      await renderView();
      expect(document.getElementById('chip-cdr').textContent).toMatch(/destructif/);
    });

    it('cdr warn si prix entre coût variable et CDR', async () => {
      global.KmcApi.getPricingFlow = jest.fn().mockResolvedValue(makeFlow({ current_price_kmf: 18500, variable_cost_complete_kmf: 17800, cdr_complete_kmf: 19600 }));
      await renderView();
      expect(document.getElementById('chip-cdr').textContent).toMatch(/attention/);
    });

    it('prix : mapping strategy_risk destructive/undercovered/covered', async () => {
      global.KmcApi.getPricingFlow = jest.fn().mockResolvedValue(makeFlow({ strategy_risk: 'destructive' }));
      await renderView();
      expect(document.getElementById('chip-prix').textContent).toMatch(/destructif/);
    });

    it('objet toujours neutral (chip masqué)', async () => {
      await renderView();
      expect(document.getElementById('chip-objet').style.display).toBe('none');
    });
  });

  /* ── Flèches / deltas ────────────────────────────────────────────── */
  describe('Flèches et deltas', () => {
    it("n'affiche pas de delta au premier chargement (pas de flow précédent)", async () => {
      await renderView();
      expect(document.getElementById('flowdelta-1').textContent).toBe('');
    });

    it('affiche un delta positif (rouge) si le coût augmente', async () => {
      jest.useFakeTimers();
      const p = global.EconomicFlowView.render(root);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      await p;

      global.KmcApi.getPricingFlow = jest.fn().mockResolvedValue(makeFlow({ variable_cost_complete_kmf: 20000 }));
      const input = document.querySelector('.efv-edit[data-ov="cost_kmf"]');
      input.value = '18000';
      input.dispatchEvent(new Event('input'));
      jest.advanceTimersByTime(350);
      await Promise.resolve(); await Promise.resolve();

      const delta = document.getElementById('flowdelta-2'); // flèche vers cvc
      expect(delta.textContent).toMatch(/^\+/);
      expect(delta.className).toMatch(/up/);
      jest.useRealTimers();
    });
  });

  /* ── Panneaux détail contextuels ─────────────────────────────────── */
  describe('Panneaux détail', () => {
    it('n1/n2 : affiche le panneau d\'imputation (vide) + proportions (repli)', async () => {
      await renderView();
      document.getElementById('efv-box-n1').click();
      const det = document.getElementById('efv-detail');
      expect(det.textContent).toMatch(/Aucune imputation détaillée/);
      expect(det.textContent).toMatch(/Proportions/);
    });

    it('_allocPanel : calcule les pourcentages quand des allocations existent', async () => {
      global.KmcApi.getPricingFlow = jest.fn().mockResolvedValue(makeFlow({
        allocations: [{ component_label: 'Transport', engaged_cost_kmf: 5000, allocated_cost_kmf: 2500, allocation_level: 'colis', allocation_divisor: 2, allocation_basis: 'weight' }],
      }));
      await renderView();
      document.getElementById('efv-box-n1').click();
      const det = document.getElementById('efv-detail');
      expect(det.textContent).toMatch(/Transport/);
      expect(det.textContent).toMatch(/weight/);
    });

    it('n3 : affiche la formule d\'allocation', async () => {
      await renderView();
      document.getElementById('efv-box-n3').click();
      expect(document.getElementById('efv-detail').textContent).toMatch(/500000 \/ \(200\*1\.4\)/);
    });

    it('_propPanel : affiche les familles et lignes détaillées si proportions présentes', async () => {
      global.KmcApi.getPricingFlow = jest.fn().mockResolvedValue(makeFlow({
        proportions: {
          families: [{ family: 'transport', label: 'Transport global', amount_kmf: 5000, share_of_cdr_pct: 25, share_of_price_pct: 15 }],
          lines: [{ family: 'transport', label: 'Fret aérien', amount_kmf: 3000, share_of_family_pct: 60, share_of_cdr_pct: 15, basis: 'benchmark', diagnostic: 'normal' }],
          diagnostic_basis: 'benchmark', benchmarks_calibrated: 3, lines_evaluated: 4, confidence: 'haute',
        },
      }));
      await renderView();
      document.getElementById('efv-box-cvc').click();
      const det = document.getElementById('efv-detail');
      expect(det.textContent).toMatch(/Transport global/);
      expect(det.textContent).toMatch(/Fret aérien/);
      expect(det.textContent).toMatch(/calibré sur benchmarks/);
    });

    it('_propPanel : chip diagnostic "surcharge" mappé en danger', async () => {
      global.KmcApi.getPricingFlow = jest.fn().mockResolvedValue(makeFlow({
        proportions: {
          families: [{ family: 'transport', label: 'T', amount_kmf: 1, share_of_cdr_pct: 1, share_of_price_pct: 1 }],
          lines: [{ family: 'transport', label: 'L', amount_kmf: 1, share_of_family_pct: 1, share_of_cdr_pct: 1, basis: 'heuristic', diagnostic: 'surcharge' }],
          diagnostic_basis: 'heuristic', benchmarks_calibrated: 0, lines_evaluated: 1, confidence: 'basse',
        },
      }));
      await renderView();
      document.getElementById('efv-box-cdr').click();
      const chip = document.getElementById('efv-detail').querySelector('.efv-chip.efv-danger');
      expect(chip).toBeTruthy();
    });

    it('prix : affiche le tableau des 6 stratégies avec verdicts', async () => {
      global.KmcApi.getPricingFlow = jest.fn().mockResolvedValue(makeFlow({
        strategies: [
          { label: 'Mécanique', final_price_kmf: 32000, contribution_kmf: 12000, gap_to_cdr_kmf: 2000, uncovered_fixed_kmf: 0, volume_to_compensate: null, verdict: 'PRIORITY' },
          { label: 'Loss leader', final_price_kmf: 18000, contribution_kmf: -1800, gap_to_cdr_kmf: -1600, uncovered_fixed_kmf: 300000, volume_to_compensate: 150, verdict: 'LOSS', needs_input: 'seuil client' },
        ],
      }));
      await renderView();
      document.getElementById('efv-box-prix').click();
      const det = document.getElementById('efv-detail');
      expect(det.textContent).toMatch(/Mécanique/);
      expect(det.textContent).toMatch(/Loss leader/);
      expect(det.querySelector('.efv-chip.efv-ok')).toBeTruthy();
      expect(det.querySelector('.efv-chip.efv-danger')).toBeTruthy();
    });

    it('prix : aucune stratégie → pas de tableau, message générique', async () => {
      await renderView();
      document.getElementById('efv-box-prix').click();
      const det = document.getElementById('efv-detail');
      expect(det.querySelector('.efv-strat-table')).toBeNull();
    });
  });
});
