'use strict';

/**
 * tests/unit/SourcingView.test.js
 *
 * admin/js/views/SourcingView.js (497L) — Intelligence Sourcing /admin/sourcing
 * Export public unique : render(rootEl).
 *
 * Dépendance externe : `KmcApi` (global, mocké) — getSourcingSynthesis(),
 * getSourcingAnalysis(), updateSourcingProduct(id, body).
 *
 * Périmètre couvert :
 *   - render() : shell, chargement, échec réseau synthesis/analysis (fallback null / [])
 *   - Onglet Synthèse (par défaut) : KPIs by_status, complétude, distribution
 *     rails, alertes portefeuille, tops (push/watch/freeze), cas données absentes
 *   - Bascule d'onglet Synthèse ↔ Produits
 *   - Onglet Produits : filtres (recherche, rail, statut, catégorie), liste
 *     vide, rendu carte produit (rail inféré, dot, badge)
 *   - Panel de détail : ouverture/fermeture au clic, remplacement, champs
 *     calculés (marge, standalone, poids, dernière revue), gaps, suggestions,
 *     alertes produit
 *   - Formulaire d'enrichissement : ouverture (garde anti-doublon), annulation,
 *     sauvegarde (succès → re-render, échec → état erreur temporaire)
 */

function makeProduct(overrides) {
  return Object.assign({
    id: 'p1',
    name: 'Casque Bluetooth',
    category: 'Audio',
    subcategory: 'Casques',
    price_kmf: 25000,
    status: 'en_phase',
    status_color: 'green',
    action: 'push',
    confidence: 'haute',
    reason: 'Bonnes ventes récentes',
    image_url: 'https://example.com/img.jpg',
    computed: { inferred_rail: 'A', margin_pct: 30, margin_kmf: 7500, standalone_viable: true, sales_30d: 12 },
    sourcing: { rail: 'A', rail_source: 'declared', cost_price_kmf: 17500, weight_g: 200, real_weight_known: true,
      fragility: 'low', volume_class: 'hand', lifecycle_status: 'active', quality_validated: true,
      delivery_delay_days: 5, last_review_at: new Date('2026-06-01').toISOString() },
    gaps: [],
    alerts: [],
  }, overrides);
}

function emptySynthesis() {
  return {
    by_status: { en_phase: 3, sous_reserve: 1, test_requis: 1, hors_phase: 1 },
    by_rail: { A: 2, B: 2, C: 1, D: 1 },
    total_active: 6,
    data_completeness_pct: 62,
    global_alerts: [],
    top_push: [], top_watch: [], top_freeze: [],
  };
}

const { makeKmcApi, cleanupGlobals } = require('./helpers/dashboardTestKit');

describe('SourcingView', () => {
  let root;

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '<div id="main"></div>';
    root = document.getElementById('main');

    makeKmcApi({
      getSourcingSynthesis: jest.fn().mockResolvedValue(emptySynthesis()),
      getSourcingAnalysis: jest.fn().mockResolvedValue({ products: [makeProduct()] }),
      updateSourcingProduct: jest.fn().mockResolvedValue({}),
    });

    require('../../admin/js/views/SourcingView.js');
  });

  afterEach(() => {
    document.getElementById('sr-styles')?.remove();
    cleanupGlobals('KmcApi');
  });

  async function renderView() {
    const p = global.SourcingView.render(root);
    await Promise.resolve();
    await Promise.resolve();
    await p;
  }

  /* ── Render de base ──────────────────────────────────────────────── */
  describe('render() — shell', () => {
    it('affiche le loader avant résolution des données', () => {
      global.SourcingView.render(root);
      expect(root.innerHTML).toMatch(/Chargement moteur sourcing/);
    });

    it('appelle les deux endpoints en parallèle', async () => {
      await renderView();
      expect(global.KmcApi.getSourcingSynthesis).toHaveBeenCalledTimes(1);
      expect(global.KmcApi.getSourcingAnalysis).toHaveBeenCalledTimes(1);
    });

    it('affiche le titre, les deux onglets, avec Synthèse actif par défaut', async () => {
      await renderView();
      expect(root.querySelector('.page-title').textContent).toMatch(/Intelligence Sourcing/);
      const tabs = root.querySelectorAll('.sr-tab');
      expect(tabs.length).toBe(2);
      expect(tabs[0].classList.contains('active')).toBe(true);
      expect(tabs[1].classList.contains('active')).toBe(false);
    });

    it('injecte le style une seule fois même après plusieurs render', async () => {
      await renderView();
      await renderView();
      expect(document.querySelectorAll('#sr-styles').length).toBe(1);
    });

    it("n'explose pas si rootEl est détaché avant la fin du chargement", async () => {
      const detached = document.createElement('div');
      const p = global.SourcingView.render(detached);
      await Promise.resolve(); await Promise.resolve();
      await p;
      // rootEl jamais attaché au document → _buildUI s'arrête après le guard
      expect(detached.querySelector('#sr-content')).toBeTruthy();
    });

    it('affiche un état d\'erreur si une exception non catchée survient', async () => {
      global.KmcApi.getSourcingSynthesis = jest.fn(() => { throw new Error('boom'); });
      // Promise.all avec .catch sur chaque promesse individuelle : ici l'appel
      // synchrone qui throw casse Promise.all avant même les .catch internes.
      await renderView();
      expect(root.innerHTML).toMatch(/Erreur/);
    });
  });

  /* ── Onglet Synthèse ─────────────────────────────────────────────── */
  describe('Onglet Synthèse', () => {
    it('affiche un message si synthesis est null', async () => {
      global.KmcApi.getSourcingSynthesis = jest.fn().mockResolvedValue(null);
      await renderView();
      expect(root.querySelector('#sr-content').textContent).toMatch(/non disponibles/);
    });

    it('calcule les 6 KPIs depuis by_status/total_active/complétude', async () => {
      await renderView();
      const kpis = root.querySelectorAll('.sr-kpi');
      expect(kpis.length).toBe(6);
      const nums = [...kpis].map(k => k.querySelector('.num').textContent);
      expect(nums).toEqual(['3', '1', '1', '1', '6', '62%']);
    });

    it('colore la complétude en orange si < 50%', async () => {
      global.KmcApi.getSourcingSynthesis = jest.fn().mockResolvedValue(
        Object.assign(emptySynthesis(), { data_completeness_pct: 30 })
      );
      await renderView();
      const kpis = root.querySelectorAll('.sr-kpi');
      expect(kpis[5].classList.contains('orange')).toBe(true);
    });

    it('affiche la barre de distribution des rails avec pourcentages', async () => {
      await renderView();
      const bar = root.querySelector('.sr-rail-bar');
      expect(bar).toBeTruthy();
      expect(bar.querySelectorAll('div').length).toBe(4); // A:33% B:33% C:17% D:17%
    });

    it("n'affiche pas la barre de rails si tous les segments sont à 0", async () => {
      global.KmcApi.getSourcingSynthesis = jest.fn().mockResolvedValue(
        Object.assign(emptySynthesis(), { by_rail: {}, total_active: 0 })
      );
      await renderView();
      expect(root.querySelector('.sr-rail-bar')).toBeNull();
    });

    it('affiche les alertes portefeuille si présentes', async () => {
      global.KmcApi.getSourcingSynthesis = jest.fn().mockResolvedValue(
        Object.assign(emptySynthesis(), { global_alerts: [{ level: 'critical', message: 'Stock A critique' }] })
      );
      await renderView();
      const alert = root.querySelector('.sr-alert.critical');
      expect(alert.textContent).toMatch(/Stock A critique/);
    });

    it("n'affiche pas la section alertes si vide", async () => {
      await renderView();
      expect(root.querySelector('.sr-alert-list')).toBeNull();
    });

    it('affiche les 3 tops (push/watch/freeze) avec leur contenu', async () => {
      global.KmcApi.getSourcingSynthesis = jest.fn().mockResolvedValue(Object.assign(emptySynthesis(), {
        top_push: [{ name: 'Prod A', rail: 'A', sales_30d: 20, margin_pct: 40 }],
        top_watch: [{ name: 'Prod B', rail: 'B', reason: 'Marge faible' }],
        top_freeze: [{ name: 'Prod C', reason: 'Aucune vente' }],
      }));
      await renderView();
      const cards = root.querySelectorAll('.card-title');
      const titles = [...cards].map(c => c.textContent);
      expect(titles.some(t => t.includes('À pousser'))).toBe(true);
      expect(titles.some(t => t.includes('À surveiller'))).toBe(true);
      expect(titles.some(t => t.includes('À geler'))).toBe(true);
      expect(root.querySelector('.sr-top-item .name').textContent).toBe('Prod A');
      // rail "unknown" fallback sur top_freeze (pas de rail fourni)
      const badges = root.querySelectorAll('.sr-rail-badge');
      expect([...badges].some(b => b.classList.contains('unknown'))).toBe(true);
    });

    it("n'affiche pas de card top si la liste est vide", async () => {
      await renderView(); // tops vides par défaut dans emptySynthesis()
      expect(root.querySelectorAll('.sr-top-list').length).toBe(0);
    });
  });

  /* ── Bascule d'onglet ────────────────────────────────────────────── */
  describe('Bascule Synthèse ↔ Produits', () => {
    it('passe à l\'onglet Produits au clic et affiche les filtres', async () => {
      await renderView();
      root.querySelector('[data-sr-tab="products"]').click();
      expect(root.querySelector('.sr-filters')).toBeTruthy();
      expect(root.querySelector('[data-sr-tab="products"]').classList.contains('active')).toBe(true);
    });

    it('revient à Synthèse et réinitialise le produit déplié', async () => {
      await renderView();
      root.querySelector('[data-sr-tab="products"]').click();
      root.querySelector('.sr-product-card').click(); // déplie
      root.querySelector('[data-sr-tab="synthesis"]').click();
      root.querySelector('[data-sr-tab="products"]').click();
      expect(root.querySelector('.sr-detail-panel')).toBeNull();
    });
  });

  /* ── Onglet Produits — filtres ───────────────────────────────────── */
  describe('Onglet Produits — filtres', () => {
    async function goToProducts() {
      await renderView();
      root.querySelector('[data-sr-tab="products"]').click();
    }

    it('affiche le nombre de produits et une carte par produit', async () => {
      await goToProducts();
      expect(root.querySelector('.sr-count').textContent).toMatch(/1 produit/);
      expect(root.querySelectorAll('.sr-product-card').length).toBe(1);
    });

    it('affiche un état vide si aucun produit', async () => {
      global.KmcApi.getSourcingAnalysis = jest.fn().mockResolvedValue({ products: [] });
      await goToProducts();
      expect(root.querySelector('#sr-product-list').textContent).toMatch(/Aucun produit/);
    });

    it('filtre par recherche texte (nom)', async () => {
      global.KmcApi.getSourcingAnalysis = jest.fn().mockResolvedValue({
        products: [makeProduct({ id: 'p1', name: 'Casque Audio' }), makeProduct({ id: 'p2', name: 'Chaise' })],
      });
      await goToProducts();
      const search = root.querySelector('#sr-search');
      search.value = 'casque';
      search.dispatchEvent(new Event('input'));
      expect(root.querySelectorAll('.sr-product-card').length).toBe(1);
    });

    it('filtre par recherche texte (catégorie)', async () => {
      global.KmcApi.getSourcingAnalysis = jest.fn().mockResolvedValue({
        products: [makeProduct({ id: 'p1', category: 'Audio' }), makeProduct({ id: 'p2', category: 'Mobilier' })],
      });
      await goToProducts();
      const search = root.querySelector('#sr-search');
      search.value = 'mobilier';
      search.dispatchEvent(new Event('input'));
      expect(root.querySelectorAll('.sr-product-card').length).toBe(1);
    });

    it('filtre par rail (déclaré ou inféré)', async () => {
      global.KmcApi.getSourcingAnalysis = jest.fn().mockResolvedValue({
        products: [
          makeProduct({ id: 'p1', sourcing: { rail: 'A' }, computed: {} }),
          makeProduct({ id: 'p2', sourcing: { rail: 'B' }, computed: {} }),
        ],
      });
      await goToProducts();
      const sel = root.querySelector('#sr-rail');
      sel.value = 'B';
      sel.dispatchEvent(new Event('change'));
      expect(root.querySelectorAll('.sr-product-card').length).toBe(1);
    });

    it('filtre par statut', async () => {
      global.KmcApi.getSourcingAnalysis = jest.fn().mockResolvedValue({
        products: [makeProduct({ id: 'p1', status: 'en_phase' }), makeProduct({ id: 'p2', status: 'hors_phase' })],
      });
      await goToProducts();
      const sel = root.querySelector('#sr-status');
      sel.value = 'hors_phase';
      sel.dispatchEvent(new Event('change'));
      expect(root.querySelectorAll('.sr-product-card').length).toBe(1);
    });

    it('filtre par catégorie, options triées et dédupliquées', async () => {
      global.KmcApi.getSourcingAnalysis = jest.fn().mockResolvedValue({
        products: [
          makeProduct({ id: 'p1', category: 'Audio' }),
          makeProduct({ id: 'p2', category: 'Beauté' }),
          makeProduct({ id: 'p3', category: 'Audio' }),
        ],
      });
      await goToProducts();
      const catOptions = [...root.querySelectorAll('#sr-cat option')].map(o => o.value);
      expect(catOptions).toEqual(['', 'Audio', 'Beauté']);
      const sel = root.querySelector('#sr-cat');
      sel.value = 'Beauté';
      sel.dispatchEvent(new Event('change'));
      expect(root.querySelectorAll('.sr-product-card').length).toBe(1);
    });

    it('rend la carte produit avec rail inféré marqué "?" et dot de couleur', async () => {
      global.KmcApi.getSourcingAnalysis = jest.fn().mockResolvedValue({
        products: [makeProduct({ sourcing: { rail_source: 'inferred' }, computed: { inferred_rail: 'C' }, status_color: 'red' })],
      });
      await goToProducts();
      const card = root.querySelector('.sr-product-card');
      expect(card.querySelector('.sr-dot.red')).toBeTruthy();
      expect(card.querySelector('.sr-rail-badge').textContent).toMatch(/C\s*\?/);
    });
  });

  /* ── Panel de détail ─────────────────────────────────────────────── */
  describe('Panel de détail', () => {
    async function goToProductsWith(product) {
      global.KmcApi.getSourcingAnalysis = jest.fn().mockResolvedValue({ products: [product] });
      await renderView();
      root.querySelector('[data-sr-tab="products"]').click();
    }

    it('ouvre le panel au clic sur la carte', async () => {
      await goToProductsWith(makeProduct());
      root.querySelector('.sr-product-card').click();
      expect(root.querySelector('.sr-detail-panel')).toBeTruthy();
    });

    it('ferme le panel si on reclique sur la même carte', async () => {
      await goToProductsWith(makeProduct());
      const card = root.querySelector('.sr-product-card');
      card.click();
      card.click();
      expect(root.querySelector('.sr-detail-panel')).toBeNull();
    });

    it('remplace le panel existant en cliquant sur une autre carte', async () => {
      global.KmcApi.getSourcingAnalysis = jest.fn().mockResolvedValue({
        products: [makeProduct({ id: 'p1', name: 'A' }), makeProduct({ id: 'p2', name: 'B' })],
      });
      await renderView();
      root.querySelector('[data-sr-tab="products"]').click();
      const cards = root.querySelectorAll('.sr-product-card');
      cards[0].click();
      cards[1].click();
      expect(root.querySelectorAll('.sr-detail-panel').length).toBe(1);
      expect(root.querySelector('.sr-detail-reason').textContent).toMatch(/Bonnes ventes/);
    });

    it('affiche les champs calculés (marge, standalone, poids, dernière revue)', async () => {
      await goToProductsWith(makeProduct());
      root.querySelector('.sr-product-card').click();
      const text = root.querySelector('.sr-detail-panel').textContent;
      expect(text).toMatch(/30%/);
      expect(text).toMatch(/Oui/);
      expect(text).toMatch(/200g/);
    });

    it('affiche "Non calculable" si margin_pct absent', async () => {
      await goToProductsWith(makeProduct({ computed: { sales_30d: 0 } }));
      root.querySelector('.sr-product-card').click();
      expect(root.querySelector('.sr-detail-panel').textContent).toMatch(/Non calculable/);
    });

    it('affiche "Jamais" si last_review_at absent', async () => {
      await goToProductsWith(makeProduct({ sourcing: {} }));
      root.querySelector('.sr-product-card').click();
      expect(root.querySelector('.sr-detail-panel').textContent).toMatch(/Jamais/);
    });

    it('affiche les gaps, suggestions et alertes produit', async () => {
      await goToProductsWith(makeProduct({
        gaps: ['poids manquant'],
        exposure_suggestion: 'Mettre en avant',
        sale_suggestion: 'Bundle avec X',
        alerts: [{ level: 'warning', message: 'Stock bas' }],
      }));
      root.querySelector('.sr-product-card').click();
      const panel = root.querySelector('.sr-detail-panel');
      expect(panel.querySelector('.sr-gap-item').textContent).toMatch(/poids manquant/);
      expect(panel.textContent).toMatch(/Mettre en avant/);
      expect(panel.textContent).toMatch(/Bundle avec X/);
      expect(panel.querySelector('.sr-alert.warning').textContent).toMatch(/Stock bas/);
    });

    it('applique la classe reason orange/red selon status_color', async () => {
      await goToProductsWith(makeProduct({ status_color: 'red' }));
      root.querySelector('.sr-product-card').click();
      expect(root.querySelector('.sr-detail-reason').classList.contains('red')).toBe(true);
    });
  });

  /* ── Formulaire d'enrichissement ─────────────────────────────────── */
  describe('Formulaire d\'enrichissement', () => {
    async function openDetail(product) {
      global.KmcApi.getSourcingAnalysis = jest.fn().mockResolvedValue({ products: [product] });
      await renderView();
      root.querySelector('[data-sr-tab="products"]').click();
      root.querySelector('.sr-product-card').click();
    }

    it('ouvre le formulaire au clic sur "Enrichir"', async () => {
      await openDetail(makeProduct());
      root.querySelector('[data-sr-edit]').click();
      expect(root.querySelector('.sr-edit-grid')).toBeTruthy();
    });

    it('ne duplique pas le formulaire si déjà ouvert', async () => {
      await openDetail(makeProduct());
      const editBtn = root.querySelector('[data-sr-edit]');
      editBtn.click();
      // Le bouton est toujours dans le panel (pas retiré), reclique dessus
      root.querySelector('[data-sr-edit]').click();
      expect(root.querySelectorAll('.sr-edit-grid').length).toBe(1);
    });

    it('pré-remplit les champs depuis sourcing existant', async () => {
      await openDetail(makeProduct());
      root.querySelector('[data-sr-edit]').click();
      expect(root.querySelector('[data-ef="cost_price_kmf"]').value).toBe('17500');
      expect(root.querySelector('[data-ef="sourcing_rail"]').value).toBe('A');
    });

    it('annule et retire le formulaire sans appeler l\'API', async () => {
      await openDetail(makeProduct());
      root.querySelector('[data-sr-edit]').click();
      root.querySelector('[data-sr-cancel]').click();
      expect(root.querySelector('.sr-edit-grid')).toBeNull();
      expect(global.KmcApi.updateSourcingProduct).not.toHaveBeenCalled();
    });

    it('sauvegarde : construit le body, appelle l\'API et re-render', async () => {
      await openDetail(makeProduct());
      root.querySelector('[data-sr-edit]').click();
      root.querySelector('[data-ef="cost_price_kmf"]').value = '19000';
      root.querySelector('[data-ef="quality_validated"]').value = 'true';
      root.querySelector('[data-sr-save]').click();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

      expect(global.KmcApi.updateSourcingProduct).toHaveBeenCalledWith('p1', expect.objectContaining({
        cost_price_kmf: 19000, quality_validated: true,
      }));
      // re-render déclenché → retour à l'onglet produits, panel refermé
      expect(root.querySelector('.sr-edit-grid')).toBeNull();
    });

    it('ignore les champs numériques vides ou invalides', async () => {
      await openDetail(makeProduct());
      root.querySelector('[data-sr-edit]').click();
      root.querySelector('[data-ef="weight_g"]').value = '';
      root.querySelector('[data-sr-save]').click();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      const callBody = global.KmcApi.updateSourcingProduct.mock.calls[0][1];
      expect(callBody).not.toHaveProperty('weight_g');
    });

    it('affiche une erreur temporaire si la sauvegarde échoue puis réactive le bouton', async () => {
      jest.useFakeTimers();
      global.KmcApi.updateSourcingProduct = jest.fn().mockRejectedValue(new Error('fail'));
      await openDetail(makeProduct());
      root.querySelector('[data-sr-edit]').click();
      const saveBtn = root.querySelector('[data-sr-save]');
      saveBtn.click();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(saveBtn.textContent).toMatch(/Erreur/);
      expect(saveBtn.disabled).toBe(true);
      jest.advanceTimersByTime(2000);
      expect(saveBtn.disabled).toBe(false);
      expect(saveBtn.textContent).toMatch(/Sauvegarder/);
      jest.useRealTimers();
    });
  });
});
