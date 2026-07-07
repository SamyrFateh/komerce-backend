'use strict';

/**
 * tests/unit/PricingStrategyView.test.js
 *
 * admin/js/views/PricingStrategyView.js (428L) — Vue Stratégie de Prix
 * /admin/pricing-strategy. Export réel : constructeur `function PricingStrategyView()`
 * avec `this.render = function(container){ render(container); }` — SANS `return`,
 * donc `view.render(main)` ne renvoie PAS la promesse interne (même piège que
 * SourcingScannerView/CustomsView) → fire-and-flush requis, jamais `await view.render()`.
 * esc()/fmt() sont locaux au fichier (pas de dépendance utils.js).
 * État module-level (state) → jest.resetModules() nécessaire entre tests (fait dans loadIt()).
 *
 * Source API :
 *   - KmcApi.getProducts({is_active:true})            (catch local → [])
 *   - KmcApi.getPricingStrategy(params)                (catch local → null)
 *   - KmcApi.createPricingCompetitor(body)
 *   - KmcApi.deletePricingCompetitor(id)
 *   - KmcApi.applyPricingStrategy(body)
 *
 * Point sensible : le bloc try/catch externe de render() est en pratique
 * inatteignable (loadProducts et loadStrategy avalent déjà leurs erreurs en
 * interne) — même situation que SourcingScannerView, non testé pour cette
 * raison (chemin mort, cf. notes de session précédente).
 */

const path = require('path');
const REL = '../../admin/js/views/PricingStrategyView.js';

function loadIt() {
  jest.resetModules();
  const abs = path.resolve(__dirname, REL);
  delete require.cache[require.resolve(abs)];
  require(abs);
  return new global.PricingStrategyView();
}

function product(overrides = {}) {
  return Object.assign({ id: 'p1', name: 'Robe rouge', category: 'mode', price_kmf: 15000 }, overrides);
}

function strategyData(overrides = {}) {
  return Object.assign({
    cdr: { cout_total_kmf: 10000, n1: 5000, n2: 3000, n3: 2000 },
    competitors: {
      count: 2, median: 16000, min: 15000, max: 17000,
      items: [
        { id: 'c1', competitor_name: 'Coliexpress', price_kmf: 15000, notes: 'livraison rapide', observed_at: '2026-07-01T00:00:00Z' },
        { id: 'c2', competitor_name: 'Noon', price_kmf: 17000, notes: null, observed_at: '2026-07-02T00:00:00Z' },
      ],
    },
    target: { product_id: 'p1', name: 'Robe rouge', current_price_kmf: 15000, category: null },
    elasticity: { value: -1.2, is_significant: true, interpretation: 'élastique', sample_size: 30 },
    options: {
      mechanical: { price: 18000, margin_pct: 30, margin_kmf: 5400, description: 'Basé sur CDR + marge cible' },
      competitor_aligned: { price: 16000, margin_pct: 20, margin_kmf: 3200, description: 'Aligné médiane concurrents' },
      premium_10: { price: 19800, margin_pct: 35, margin_kmf: 6930, description: 'Premium +10%' },
      loss_leader: { price: 13500, margin_pct: 5, margin_kmf: 675, description: 'Loss leader -10%' },
    },
    current_strategy: { strategy_type: 'mechanical', applied_at: '2026-06-01T00:00:00Z' },
  }, overrides);
}

const { makeKmcApi, cleanupGlobals } = require('./helpers/dashboardTestKit');

describe('PricingStrategyView', () => {
  let main;

  beforeEach(() => {
    document.body.innerHTML = '<div id="main"></div>';
    main = document.getElementById('main');
    makeKmcApi({
      getProducts: jest.fn().mockResolvedValue({ products: [product(), product({ id: 'p2', name: 'Sac tressé', category: 'accessoires', price_kmf: 8000 })] }),
      getPricingStrategy: jest.fn().mockResolvedValue(strategyData()),
      createPricingCompetitor: jest.fn().mockResolvedValue({}),
      deletePricingCompetitor: jest.fn().mockResolvedValue({}),
      applyPricingStrategy: jest.fn().mockResolvedValue({ products_affected: 1 }),
    });
    window.alert = jest.fn();
    window.confirm = jest.fn(() => true);
  });

  afterEach(() => {
    cleanupGlobals('KmcApi');
    delete window.alert;
    delete window.confirm;
    document.getElementById('ps-styles')?.remove();
  });

  async function flush(times = 12) {
    for (let i = 0; i < times; i++) await Promise.resolve();
  }

  async function renderAndFlush(view, container = main) {
    view.render(container);
    await flush();
  }

  it('expose une instance avec render() (contrat constructeur, app.js#invokeView)', () => {
    const view = loadIt();
    expect(typeof view.render).toBe('function');
  });

  it('pose le loading state de façon synchrone avant résolution', () => {
    const view = loadIt();
    view.render(main);
    expect(main.innerHTML).toContain('Chargement stratégie de prix');
  });

  it('injecte les styles une seule fois (#ps-styles)', async () => {
    const view = loadIt();
    await renderAndFlush(view);
    const view2 = loadIt();
    await renderAndFlush(view2);
    expect(document.querySelectorAll('#ps-styles').length).toBe(1);
  });

  it('charge getProducts avec is_active:true puis getPricingStrategy avec le premier produit auto-sélectionné', async () => {
    const view = loadIt();
    await renderAndFlush(view);
    expect(global.KmcApi.getProducts).toHaveBeenCalledWith({ is_active: true });
    expect(global.KmcApi.getPricingStrategy).toHaveBeenCalledWith({ product_id: 'p1' });
  });

  it('gère getProducts renvoyant un tableau brut (fallback r || r.products)', async () => {
    global.KmcApi.getProducts.mockResolvedValue([product({ id: 'p9', name: 'Ceinture' })]);
    const view = loadIt();
    await renderAndFlush(view);
    expect(global.KmcApi.getPricingStrategy).toHaveBeenCalledWith({ product_id: 'p9' });
  });

  it('getProducts en échec → products/categories vides, aucune donnée', async () => {
    global.KmcApi.getProducts.mockRejectedValue(new Error('boom'));
    const view = loadIt();
    await renderAndFlush(view);
    expect(main.querySelectorAll('.ps-select option').length).toBe(0);
    expect(main.innerHTML).toContain('Aucune donnée disponible');
  });

  it('dérive les catégories uniques et triées depuis les produits', async () => {
    global.KmcApi.getProducts.mockResolvedValue({
      products: [
        product({ id: 'p1', category: 'zeta' }),
        product({ id: 'p2', category: 'alpha' }),
        product({ id: 'p3', category: 'zeta' }),
        product({ id: 'p4', category: null }),
      ],
    });
    const view = loadIt();
    await renderAndFlush(view);
    main.querySelector('[data-act="set-mode"][data-mode="category"]').click();
    await flush();
    const options = Array.from(main.querySelectorAll('.ps-select option')).map(o => o.value);
    expect(options).toEqual(['alpha', 'zeta']);
  });

  it('getPricingStrategy en échec → state.data=null → message "Aucune donnée disponible"', async () => {
    global.KmcApi.getPricingStrategy.mockRejectedValue(new Error('down'));
    const view = loadIt();
    await renderAndFlush(view);
    expect(main.innerHTML).toContain('Aucune donnée disponible');
  });

  it('rend les 4 cartes input (CDR, concurrence, prix actuel, élasticité)', async () => {
    const view = loadIt();
    await renderAndFlush(view);
    expect(main.innerHTML).toContain('Coût de revient');
    expect(main.innerHTML).toContain('10 000 KMF');
    expect(main.innerHTML).toContain('N1+N2+N3 = 5 000 KMF + 3 000 KMF + 2 000 KMF');
    expect(main.innerHTML).toContain('Prix concurrence (médiane)');
    expect(main.innerHTML).toContain('16 000 KMF');
    expect(main.innerHTML).toContain('Élasticité-prix');
    expect(main.innerHTML).toContain('-1.20');
    expect(main.innerHTML).toContain('élastique (30 ventes)');
  });

  it('carte concurrence : fallback "—" si aucune observation', async () => {
    global.KmcApi.getPricingStrategy.mockResolvedValue(strategyData({ competitors: { count: 0, items: [] } }));
    const view = loadIt();
    await renderAndFlush(view);
    expect(main.innerHTML).toContain('Aucune donnée — saisissez ci-dessous');
  });

  it('carte élasticité : fallback si absente ou non significative', async () => {
    global.KmcApi.getPricingStrategy.mockResolvedValue(strategyData({ elasticity: { value: null } }));
    const view = loadIt();
    await renderAndFlush(view);
    expect(main.innerHTML).toContain('Pas assez de changements de prix passés');
  });

  it('carte élasticité : valeur présente mais non significative → "données insuffisantes"', async () => {
    global.KmcApi.getPricingStrategy.mockResolvedValue(strategyData({ elasticity: { value: -0.3, is_significant: false, sample_size: 2 } }));
    const view = loadIt();
    await renderAndFlush(view);
    expect(main.innerHTML).toContain('données insuffisantes');
  });

  it('prix actuel : mode produit affiche le nom du produit cible', async () => {
    const view = loadIt();
    await renderAndFlush(view);
    expect(main.innerHTML).toContain('Prix actuel');
    const card = Array.from(main.querySelectorAll('.ps-input-card')).find(c => c.textContent.includes('Prix actuel'));
    expect(card.textContent).toContain('Robe rouge');
  });

  it('prix actuel : mode catégorie affiche "Médiane catégorie X"', async () => {
    global.KmcApi.getPricingStrategy.mockResolvedValue(strategyData({ target: { product_id: null, current_price_kmf: 9000, category: 'accessoires' } }));
    const view = loadIt();
    await renderAndFlush(view);
    main.querySelector('[data-act="set-mode"][data-mode="category"]').click();
    await flush();
    const card = Array.from(main.querySelectorAll('.ps-input-card')).find(c => c.textContent.includes('Prix actuel'));
    expect(card.textContent).toContain('Médiane catégorie accessoires');
  });

  it('liste des concurrents : lignes rendues avec notes optionnelles et sans notes', async () => {
    const view = loadIt();
    await renderAndFlush(view);
    const rows = main.querySelectorAll('.ps-comp-row');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Coliexpress');
    expect(rows[0].textContent).toContain('livraison rapide');
    expect(rows[1].textContent).toContain('Noon');
    expect(rows[1].innerHTML).not.toContain('font-style:italic');
  });

  it('liste des concurrents vide → message "Aucun prix concurrent saisi"', async () => {
    global.KmcApi.getPricingStrategy.mockResolvedValue(strategyData({ competitors: { count: 0, items: [] } }));
    const view = loadIt();
    await renderAndFlush(view);
    expect(main.innerHTML).toContain('Aucun prix concurrent saisi pour cette cible');
  });

  it('cartes stratégie : mechanical toujours affichée, options conditionnelles présentes', async () => {
    const view = loadIt();
    await renderAndFlush(view);
    const names = Array.from(main.querySelectorAll('.ps-strategy-name')).map(n => n.textContent);
    expect(names).toEqual(expect.arrayContaining(['Mécanique', 'Aligné concurrence', 'Premium +10%', 'Loss leader -10%', 'Manuel']));
  });

  it('cartes stratégie : options absentes ne sont pas rendues (strategyCard retourne vide)', async () => {
    global.KmcApi.getPricingStrategy.mockResolvedValue(strategyData({
      options: { mechanical: { price: 18000, margin_pct: 30, margin_kmf: 5400 } },
    }));
    const view = loadIt();
    await renderAndFlush(view);
    const names = Array.from(main.querySelectorAll('.ps-strategy-name')).map(n => n.textContent);
    expect(names).toEqual(['Mécanique', 'Manuel']);
  });

  it('marge : classes low/mid/good selon margin_pct', async () => {
    global.KmcApi.getPricingStrategy.mockResolvedValue(strategyData({
      options: {
        mechanical: { price: 18000, margin_pct: 5, margin_kmf: 900 },
        competitor_aligned: { price: 16000, margin_pct: 18, margin_kmf: 2880 },
        premium_10: { price: 19800, margin_pct: 40, margin_kmf: 7920 },
      },
    }));
    const view = loadIt();
    await renderAndFlush(view);
    const margins = main.querySelectorAll('.ps-strategy-margin');
    expect(margins[0].className).toContain('low');
    expect(margins[1].className).toContain('mid');
    expect(margins[2].className).toContain('good');
  });

  it('carte manuelle : sélectionnée par défaut si state.selectedStrategy=manual, valeur = manualPrice ou prix courant', async () => {
    const view = loadIt();
    await renderAndFlush(view);
    const input = main.querySelector('[data-act="set-manual-price"]');
    expect(Number(input.value)).toBe(15000);
  });

  it('select-strategy : clic sur une carte change la sélection visuelle et le verdict', async () => {
    const view = loadIt();
    await renderAndFlush(view);
    main.querySelector('[data-act="select-strategy"][data-strategy="premium"]').click();
    await flush();
    expect(main.querySelector('.ps-strategy.selected .ps-strategy-name').textContent).toBe('Premium +10%');
    expect(main.querySelector('.ps-verdict-price').textContent).toContain('19 800 KMF');
  });

  it('set-manual-price : input change met à jour manualPrice et le verdict si stratégie manuelle sélectionnée', async () => {
    const view = loadIt();
    await renderAndFlush(view);
    main.querySelector('[data-act="select-strategy"][data-strategy="manual"]').click();
    await flush();
    const input = main.querySelector('[data-act="set-manual-price"]');
    input.value = '20000';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(main.querySelector('.ps-verdict-price').textContent).toContain('20 000 KMF');
  });

  it('verdict : calcule le delta vs prix actuel (positif avec signe +)', async () => {
    const view = loadIt();
    await renderAndFlush(view);
    expect(main.querySelector('.ps-verdict-vs').textContent).toContain('vs prix actuel 15 000 KMF (+20.0%)');
  });

  it('select-strategy competitor_aligned → verdict aligné sur le prix concurrent médian', async () => {
    const view = loadIt();
    await renderAndFlush(view);
    main.querySelector('[data-act="select-strategy"][data-strategy="competitor_aligned"]').click();
    await flush();
    expect(main.querySelector('.ps-verdict-price').textContent).toContain('16\u202f000 KMF');
  });

  it('verdict : delta négatif sans signe +', async () => {
    const view = loadIt();
    await renderAndFlush(view);
    main.querySelector('[data-act="select-strategy"][data-strategy="loss_leader"]').click();
    await flush();
    expect(main.querySelector('.ps-verdict-vs').textContent).toContain('(-10.0%)');
    expect(main.querySelector('.ps-verdict-vs').textContent).not.toContain('(+-10.0%)');
  });

  it('verdict : deltaPct=0 si prix actuel=0', async () => {
    global.KmcApi.getPricingStrategy.mockResolvedValue(strategyData({ target: { product_id: 'p1', name: 'Robe', current_price_kmf: 0 } }));
    const view = loadIt();
    await renderAndFlush(view);
    expect(main.querySelector('.ps-verdict-vs').textContent).toContain('(+0%)');
  });

  it('bloc stratégie actuelle affiché si current_strategy présent', async () => {
    const view = loadIt();
    await renderAndFlush(view);
    expect(main.innerHTML).toContain('Stratégie actuelle');
    expect(main.querySelector('.ps-current-strategy').textContent).toContain('mechanical');
  });

  it('bloc stratégie actuelle absent si current_strategy null', async () => {
    global.KmcApi.getPricingStrategy.mockResolvedValue(strategyData({ current_strategy: null }));
    const view = loadIt();
    await renderAndFlush(view);
    expect(main.querySelector('.ps-current-strategy')).toBeFalsy();
  });

  it('set-mode : bascule vers catégorie, auto-sélectionne la première catégorie, recharge la stratégie', async () => {
    const view = loadIt();
    await renderAndFlush(view);
    global.KmcApi.getPricingStrategy.mockClear();
    main.querySelector('[data-act="set-mode"][data-mode="category"]').click();
    await flush();
    expect(main.querySelector('[data-act="set-mode"][data-mode="category"]').className).toContain('active');
    expect(global.KmcApi.getPricingStrategy).toHaveBeenCalledWith({ category: 'accessoires' });
  });

  it('set-product : changer le select recharge la stratégie pour le nouveau produit', async () => {
    const view = loadIt();
    await renderAndFlush(view);
    global.KmcApi.getPricingStrategy.mockClear();
    const select = main.querySelector('[data-act="set-product"]');
    select.value = 'p2';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(global.KmcApi.getPricingStrategy).toHaveBeenCalledWith({ product_id: 'p2' });
  });

  it('set-category : changer le select recharge la stratégie pour la nouvelle catégorie', async () => {
    const view = loadIt();
    await renderAndFlush(view);
    main.querySelector('[data-act="set-mode"][data-mode="category"]').click();
    await flush();
    global.KmcApi.getPricingStrategy.mockClear();
    const select = main.querySelector('[data-act="set-category"]');
    select.value = 'mode';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(global.KmcApi.getPricingStrategy).toHaveBeenCalledWith({ category: 'mode' });
  });

  it('mode catégorie sans produit/catégorie sélectionnée → aucun appel getPricingStrategy, data=null', async () => {
    global.KmcApi.getProducts.mockResolvedValue({ products: [] });
    const view = loadIt();
    await renderAndFlush(view);
    expect(global.KmcApi.getPricingStrategy).not.toHaveBeenCalled();
    expect(main.innerHTML).toContain('Aucune donnée disponible');
  });

  it('modal concurrent : fermé par défaut, ouvert via open-competitor-modal', async () => {
    const view = loadIt();
    await renderAndFlush(view);
    expect(main.querySelector('.ps-modal').className).not.toContain('open');
    main.querySelector('[data-act="open-competitor-modal"]').click();
    await flush();
    expect(main.querySelector('.ps-modal').className).toContain('open');
    expect(main.querySelector('.ps-modal-bg').className).toContain('open');
  });

  it('modal concurrent : close-competitor-modal referme la modale', async () => {
    const view = loadIt();
    await renderAndFlush(view);
    main.querySelector('[data-act="open-competitor-modal"]').click();
    await flush();
    main.querySelector('[data-act="close-competitor-modal"]').click();
    await flush();
    expect(main.querySelector('.ps-modal').className).not.toContain('open');
  });

  it('save-competitor : nom ou prix manquant → alert et pas d\'appel API', async () => {
    const view = loadIt();
    await renderAndFlush(view);
    main.querySelector('[data-act="open-competitor-modal"]').click();
    await flush();
    main.querySelector('[data-act="save-competitor"]').click();
    await flush();
    expect(window.alert).toHaveBeenCalledWith('Nom et prix requis.');
    expect(global.KmcApi.createPricingCompetitor).not.toHaveBeenCalled();
  });

  it('save-competitor : prix <= 0 → alert et pas d\'appel API', async () => {
    const view = loadIt();
    await renderAndFlush(view);
    main.querySelector('[data-act="open-competitor-modal"]').click();
    await flush();
    main.querySelector('[data-modal-field="name"]').value = 'Coliexpress';
    main.querySelector('[data-modal-field="price"]').value = '0';
    main.querySelector('[data-act="save-competitor"]').click();
    await flush();
    expect(window.alert).toHaveBeenCalledWith('Nom et prix requis.');
  });

  it('save-competitor : succès en mode produit → createPricingCompetitor avec product_id, modal fermée, rechargement', async () => {
    const view = loadIt();
    await renderAndFlush(view);
    main.querySelector('[data-act="open-competitor-modal"]').click();
    await flush();
    main.querySelector('[data-modal-field="name"]').value = 'Jumia';
    main.querySelector('[data-modal-field="price"]').value = '16500';
    main.querySelector('[data-modal-field="notes"]').value = 'via app';
    main.querySelector('[data-act="save-competitor"]').click();
    await flush();
    expect(global.KmcApi.createPricingCompetitor).toHaveBeenCalledWith({
      competitor_name: 'Jumia', price_kmf: 16500, notes: 'via app', product_id: 'p1',
    });
    expect(main.querySelector('.ps-modal').className).not.toContain('open');
  });

  it('save-competitor : succès en mode catégorie → body.category au lieu de product_id, notes null si vide', async () => {
    const view = loadIt();
    await renderAndFlush(view);
    main.querySelector('[data-act="set-mode"][data-mode="category"]').click();
    await flush();
    main.querySelector('[data-act="open-competitor-modal"]').click();
    await flush();
    main.querySelector('[data-modal-field="name"]').value = 'Jumia';
    main.querySelector('[data-modal-field="price"]').value = '9000';
    main.querySelector('[data-act="save-competitor"]').click();
    await flush();
    expect(global.KmcApi.createPricingCompetitor).toHaveBeenCalledWith({
      competitor_name: 'Jumia', price_kmf: 9000, notes: null, category: 'accessoires',
    });
  });

  it('save-competitor : échec API → alert Erreur, modal reste ouverte', async () => {
    global.KmcApi.createPricingCompetitor.mockRejectedValue(new Error('réseau'));
    const view = loadIt();
    await renderAndFlush(view);
    main.querySelector('[data-act="open-competitor-modal"]').click();
    await flush();
    main.querySelector('[data-modal-field="name"]').value = 'Jumia';
    main.querySelector('[data-modal-field="price"]').value = '9000';
    main.querySelector('[data-act="save-competitor"]').click();
    await flush();
    expect(window.alert).toHaveBeenCalledWith('Erreur : réseau');
  });

  it('del-competitor : confirm annulé → pas d\'appel API', async () => {
    window.confirm = jest.fn(() => false);
    const view = loadIt();
    await renderAndFlush(view);
    main.querySelector('[data-act="del-competitor"]').click();
    await flush();
    expect(window.confirm).toHaveBeenCalledWith('Supprimer ce prix concurrent ?');
    expect(global.KmcApi.deletePricingCompetitor).not.toHaveBeenCalled();
  });

  it('del-competitor : confirmé → appelle deletePricingCompetitor avec l\'id et recharge', async () => {
    const view = loadIt();
    await renderAndFlush(view);
    main.querySelector('[data-act="del-competitor"][data-id="c1"]').click();
    await flush();
    expect(global.KmcApi.deletePricingCompetitor).toHaveBeenCalledWith('c1');
  });

  it('del-competitor : échec API → alert Erreur', async () => {
    global.KmcApi.deletePricingCompetitor.mockRejectedValue(new Error('502'));
    const view = loadIt();
    await renderAndFlush(view);
    main.querySelector('[data-act="del-competitor"][data-id="c1"]').click();
    await flush();
    expect(window.alert).toHaveBeenCalledWith('Erreur : 502');
  });

  it('apply-strategy : prix final invalide (<=0) → alert "Prix invalide", pas d\'appel API', async () => {
    global.KmcApi.getPricingStrategy.mockResolvedValue(strategyData({
      options: { mechanical: { price: 0, margin_pct: 0, margin_kmf: 0 } },
    }));
    const view = loadIt();
    await renderAndFlush(view);
    main.querySelector('[data-act="apply-strategy"]').click();
    await flush();
    expect(window.alert).toHaveBeenCalledWith('Prix invalide');
    expect(global.KmcApi.applyPricingStrategy).not.toHaveBeenCalled();
  });

  it('apply-strategy : confirm annulé → pas d\'appel API', async () => {
    window.confirm = jest.fn(() => false);
    const view = loadIt();
    await renderAndFlush(view);
    main.querySelector('[data-act="apply-strategy"]').click();
    await flush();
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Appliquer la stratégie "mechanical" sur Robe rouge'));
    expect(global.KmcApi.applyPricingStrategy).not.toHaveBeenCalled();
  });

  it('apply-strategy : confirm mentionne la catégorie en mode catégorie', async () => {
    const view = loadIt();
    await renderAndFlush(view);
    main.querySelector('[data-act="set-mode"][data-mode="category"]').click();
    await flush();
    main.querySelector('[data-act="apply-strategy"]').click();
    await flush();
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('sur catégorie accessoires'));
  });

  it('apply-strategy : succès mode produit → body complet, alert avec products_affected, rechargement', async () => {
    const view = loadIt();
    await renderAndFlush(view);
    main.querySelector('[data-act="apply-strategy"]').click();
    await flush();
    expect(global.KmcApi.applyPricingStrategy).toHaveBeenCalledWith({
      strategy_type: 'mechanical', final_price_kmf: 18000, reason: 'Appliqué via UI Stratégie', product_id: 'p1',
    });
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('1 produit(s) impacté(s)'));
  });

  it('apply-strategy : succès mode manuel → strategy_value ajouté au body', async () => {
    const view = loadIt();
    await renderAndFlush(view);
    main.querySelector('[data-act="select-strategy"][data-strategy="manual"]').click();
    await flush();
    const input = main.querySelector('[data-act="set-manual-price"]');
    input.value = '22000';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    main.querySelector('[data-act="apply-strategy"]').click();
    await flush();
    expect(global.KmcApi.applyPricingStrategy).toHaveBeenCalledWith(expect.objectContaining({
      strategy_type: 'manual', final_price_kmf: 22000, strategy_value: 22000,
    }));
  });

  it('apply-strategy : products_affected absent → fallback "1 produit(s)"', async () => {
    global.KmcApi.applyPricingStrategy.mockResolvedValue({});
    const view = loadIt();
    await renderAndFlush(view);
    main.querySelector('[data-act="apply-strategy"]').click();
    await flush();
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('1 produit(s) impacté(s)'));
  });

  it('apply-strategy : échec API → alert Erreur, bouton réactivé avec libellé initial', async () => {
    global.KmcApi.applyPricingStrategy.mockRejectedValue(new Error('timeout'));
    const view = loadIt();
    await renderAndFlush(view);
    const btn = main.querySelector('[data-act="apply-strategy"]');
    btn.click();
    await flush();
    expect(window.alert).toHaveBeenCalledWith('Erreur : timeout');
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toContain('Appliquer cette stratégie');
  });

  it('apply-strategy : mode catégorie → body.category au lieu de product_id', async () => {
    const view = loadIt();
    await renderAndFlush(view);
    main.querySelector('[data-act="set-mode"][data-mode="category"]').click();
    await flush();
    main.querySelector('[data-act="apply-strategy"]').click();
    await flush();
    expect(global.KmcApi.applyPricingStrategy).toHaveBeenCalledWith(expect.objectContaining({ category: 'accessoires' }));
  });
});
