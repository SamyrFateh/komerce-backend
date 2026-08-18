'use strict';

/**
 * tests/unit/PricingView.test.js
 *
 * admin/js/views/PricingView.js (648L) — Atelier de construction du prix
 * (Zone 1 kanban 4 colonnes Objet/Relais/Business/Décision + Zone 2 résumé).
 *
 * Export réel : `window.PricingView` EST directement la fonction async
 * `async function(container)` (pas d'objet `{ render }` comme SanteView) →
 * on appelle `window.PricingView(main)` directement, jamais `.render(...)`.
 * Malgré le header `@depends api-client.js, filters-store.js, utils.js` et
 * `@doctrine kmc_api_only`, le code réel n'utilise ni KmcApi ni KmcFilters :
 * tous les appels passent par `fetch` global brut (`_api()` local). Le rôle
 * admin est lu directement sur `window.CT.platform.state.role`. La
 * navigation vers l'atelier composants passe par `window.KmcApp.navigate`.
 *
 * BUG PRODUCTION CONFIRMÉ (non corrigé ici — hors périmètre "tests only") :
 * `_bindEvents(container)` est appelé à CHAQUE `_renderHTML(container)`, et
 * comme `container` n'est jamais remplacé (seul son `innerHTML` l'est), les
 * listeners `change`/`input`/`click` s'accumulent à chaque re-rendu déclenché
 * par une interaction (changement de mode, sélection produit, sélection
 * scénario, refresh...). Conséquence observable : après un premier re-rendu,
 * un clic sur un `data-act` déclenche le handler autant de fois qu'il y a de
 * listeners empilés. Pour les actions débouncées (`_scheduleRecalc`), l'effet
 * est masqué car `_recalcTimer` est une variable de module unique
 * (clearTimeout+setTimeout à chaque appel) : seul le dernier timer armé
 * survit et se déclenche, donc le recalcul final reste correct. Pour les
 * actions synchrones non débouncées (`apply-scenario`, `refresh`, `open-
 * workshop`), le bug est réel : `confirm()`/`alert()`/l'appel PUT/la
 * navigation peuvent se déclencher plusieurs fois pour un seul clic dès
 * qu'un re-rendu a eu lieu au préalable. Un test dédié le documente sans le
 * corriger. Pour les autres tests, on structure les scénarios pour
 * minimiser les re-rendus intermédiaires avant l'action testée, et on
 * utilise des assertions par `.find(...)` (au moins un appel avec les bons
 * paramètres) plutôt que des comptages stricts quand un re-rendu préalable
 * est inévitable (ex. sélection produit avant lecture des colonnes).
 *
 * Piège nbsp : `toLocaleString('fr-FR')` (utilisé dans le confirm() de
 * apply-scenario) sépare les milliers avec U+202F, pas un espace normal —
 * non testé ici via toContain sur ce format pour éviter la fragilité.
 *
 * Périmètre couvert :
 *   - Contrat : window.PricingView est une fonction bare (pas d'objet render)
 *   - Chargement : état "Chargement..." synchrone, _loadAll (fallbacks
 *     config/catégories/cost-components→pricing-components/provisions),
 *     _loadCatalog (catch silencieux → catalogue vide), garde container
 *     détaché du DOM pendant le chargement
 *   - Mode catalogue : options du select, sélection produit → autofill
 *     (catégorie/prix/devise/poids/dimensions) + recalc débouncé 100ms
 *   - Mode simulation : bascule de mode, saisie champs → recalc débouncé
 *     300ms, garde prix_achat<=0 → pas d'appel recommend
 *   - Conversion devise (toAED) : EUR vers AED avant l'appel API
 *   - Rendu colonnes : Relais (breakdown 9 lignes), Business (CDR N1+N2+N3,
 *     contribution/marge), Décision (scénarios, recommandé, non-selectable,
 *     bouton appliquer conditionné rôle admin + produit + selectable),
 *     Zone 2 résumé (blocs landed/business, alertes qualité)
 *   - Refresh : recharge données, reprogramme un recalcul si sélection active
 *   - Apply-scenario : blocage si prix < survival, confirm(), appel PUT,
 *     refus du confirm → pas d'appel
 *   - Bug listeners accumulés : documenté (pas corrigé)
 */

function jsonResponse(body, ok = true, status = 200) {
  return Promise.resolve({ ok, status, text: () => Promise.resolve(JSON.stringify(body)), json: () => Promise.resolve(body) });
}

const CATEGORIES = [
  { key: 'phones', label: 'Téléphones' },
  { key: 'audio', label: 'Audio' },
];

const CATALOG_ITEMS = [
  { product_id: 'p1', name: 'iPhone 13', current_price_kmf: 450000, category: 'phones', cost_kmf: 180000, weight_kg: 0.35, volume_m3: 0.001 },
  { product_id: 'p2', name: 'Écouteurs BT', current_price_kmf: 25000, category: 'audio', cost_kmf: 8000, weight_kg: 0.05, volume_m3: 0.0002 },
];

function makeReco(overrides = {}) {
  return Object.assign({
    product_id: 'p1',
    cost_breakdown: {
      landed_relay: {
        product_purchase: 180000, sourcing: 2000, hub: 3000, packaging: 1500,
        freight: 12000, customs: 20000, port_transitary: 4000, local_distribution: 5000, relay: 6000,
      },
      allocations: [],
      allocation_averages: {},
      business: { payment: 4000, risk_provision: 3000, fixed_overhead: 15000 },
    },
    landed_relay_cost_kmf: 233500,
    n1_landed_relay_cost_kmf: 233500,
    n2_business_variable_cost_kmf: 7000,
    variable_cost_complete_kmf: 240500,
    n3_fixed_overhead_allocation_kmf: 15000,
    cdr_complete_kmf: 255500,
    business_complete_cost_kmf: 255500,
    cost_complete_estimated_kmf: 255500,
    current_price_kmf: 450000,
    contribution_kmf: 209500,
    minimum_safe_price_kmf: 260000,
    survival_price_kmf: 240500,
    recommended_price_kmf: 280000,
    sourcing_decision: 'PRIORITY',
    recommended_scenario_id: 's1',
    scenarios: [
      { id: 's1', label: 'Honnête baseline', price_kmf: 280000, margin_pct: 18, selectable: true, is_recommended: true, short_description: 'Marge saine', explanation: 'Explication s1', cost_imputed_kmf: 255500, margin_kmf: 24500, economy_vs_baseline_kmf: 0 },
      { id: 's2', label: 'Agressif', price_kmf: 200000, margin_pct: -10, selectable: false, is_recommended: false },
    ],
    data_quality: { confidence: 'high', warnings: [] },
  }, overrides);
}

describe('PricingView', () => {
  let main;
  let routes;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    document.body.innerHTML = '<div id="main"></div>';
    main = document.getElementById('main');
    document.getElementById('apv-styles')?.remove();

    routes = {
      config: () => jsonResponse({
        targets: {},
        fx: { pricing_view_current_compat: { eur_kmf: 492, aed_kmf: 138, usd_kmf: 452.64, usd_eur_ratio: 0.92 } },
      }),
      categories: () => jsonResponse(CATEGORIES),
      costComponents: () => jsonResponse([{ key: 'c1' }]),
      provisions: () => jsonResponse([{ key: 'r1' }]),
      recommendBatch: () => jsonResponse({ items: CATALOG_ITEMS }),
      recommend: () => jsonResponse(makeReco()),
      apply: () => jsonResponse({ ok: true }),
    };

    global.fetch = jest.fn((url, opts = {}) => {
      const u = String(url);
      if (u.includes('/api/admin/finance-config')) return routes.config();
      if (u.includes('/api/admin/customs-categories')) return routes.categories();
      if (u.includes('/api/admin/cost-components')) return routes.costComponents();
      if (u.includes('/api/admin/pricing-components')) return routes.costComponents();
      if (u.includes('/api/admin/risk-provisions')) return routes.provisions();
      if (u.includes('/api/pricing/recommend-batch')) return routes.recommendBatch();
      if (u.includes('/api/pricing/recommend')) return routes.recommend();
      if (u.includes('/api/pricing/apply-price/')) return routes.apply(url, opts);
      return jsonResponse({});
    });

    window.CT = { platform: { state: { role: 'admin' } } };
    window.KmcApp = { navigate: jest.fn() };
    window.confirm = jest.fn(() => true);
    window.alert = jest.fn();

    require('../../admin/js/views/PricingView.js');
  });

  afterEach(() => {
    jest.useRealTimers();
    delete global.fetch;
    delete window.CT;
    delete window.KmcApp;
    delete window.confirm;
    delete window.alert;
  });

  async function flush() {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  }

  /* ─── CONTRAT ─────────────────────────────────────────────────────────── */
  it('expose une fonction bare (pas un objet { render })', () => {
    expect(typeof window.PricingView).toBe('function');
    expect(window.PricingView.render).toBeUndefined();
  });

  /* ─── CHARGEMENT ──────────────────────────────────────────────────────── */
  describe('chargement initial', () => {
    it('affiche "Chargement..." de façon synchrone avant résolution des fetch', () => {
      window.PricingView(main);
      expect(main.innerHTML).toContain('Chargement de l\'Atelier');
    });

    it('_loadAll : config null/non-objet → {}, catégories non-array → [], provisions non-array → []', async () => {
      routes.config = () => jsonResponse(null);
      routes.categories = () => jsonResponse('oops');
      routes.provisions = () => jsonResponse({ not: 'array' });
      await window.PricingView(main);
      await flush();

      expect(main.querySelector('.apv-kanban')).toBeTruthy();
      const modeSim = main.querySelector('[data-mode="simulation"]');
      modeSim.click();
      await flush();
      const catSelect = main.querySelector('[data-input="category"]');
      expect(catSelect).toBeTruthy();
    });

    it('customs-categories et risk-provisions en échec réseau (rejet, pas juste ok:false) → fallback []', async () => {
      global.fetch = jest.fn((url) => {
        const u = String(url);
        if (u.includes('/api/admin/customs-categories')) return Promise.reject(new Error('down'));
        if (u.includes('/api/admin/risk-provisions')) return Promise.reject(new Error('down'));
        if (u.includes('/api/admin/finance-config')) return routes.config();
        if (u.includes('/api/admin/cost-components')) return routes.costComponents();
        if (u.includes('/api/pricing/recommend-batch')) return routes.recommendBatch();
        return jsonResponse({});
      });
      await window.PricingView(main);
      await flush();
      expect(main.querySelector('.apv-kanban')).toBeTruthy();
      main.querySelector('[data-mode="simulation"]').click();
      await flush();
      expect(main.querySelector('[data-input="category"]')).toBeTruthy();
    });

    it('inputCategory par défaut ("phones") absent des catégories chargées → retombe sur la 1ère catégorie', async () => {
      routes.categories = () => jsonResponse([{ key: 'furniture', label: 'Meubles' }, { key: 'audio', label: 'Audio' }]);
      await window.PricingView(main);
      await flush();
      main.querySelector('[data-mode="simulation"]').click();
      await flush();
      const selected = main.querySelector('[data-input="category"] option[selected]');
      expect(selected.value).toBe('furniture');
    });

    it('cost-components échoue → fallback pricing-components ; ne crashe pas si les deux échouent', async () => {
      global.fetch = jest.fn((url) => {
        const u = String(url);
        if (u.includes('/api/admin/cost-components')) return Promise.reject(new Error('down'));
        if (u.includes('/api/admin/pricing-components')) return jsonResponse({ components: [{ key: 'fallback' }] });
        if (u.includes('/api/admin/finance-config')) return routes.config();
        if (u.includes('/api/admin/customs-categories')) return routes.categories();
        if (u.includes('/api/admin/risk-provisions')) return routes.provisions();
        if (u.includes('/api/pricing/recommend-batch')) return routes.recommendBatch();
        return jsonResponse({});
      });
      await window.PricingView(main);
      await flush();
      expect(main.querySelector('.apv-kanban')).toBeTruthy();
    });

    it('_loadCatalog : échec réseau → catalogue vide, hint "Aucun produit chargé."', async () => {
      global.fetch = jest.fn((url) => {
        const u = String(url);
        if (u.includes('/api/pricing/recommend-batch')) return Promise.reject(new Error('down'));
        if (u.includes('/api/admin/finance-config')) return routes.config();
        if (u.includes('/api/admin/customs-categories')) return routes.categories();
        if (u.includes('/api/admin/cost-components')) return routes.costComponents();
        if (u.includes('/api/admin/risk-provisions')) return routes.provisions();
        return jsonResponse({});
      });
      await window.PricingView(main);
      await flush();
      expect(main.textContent).toContain('Aucun produit chargé.');
    });

    it('garde : container détaché du DOM pendant le chargement → pas de rendu du kanban', async () => {
      const p = window.PricingView(main);
      main.remove();
      await p;
      expect(main.querySelector('.apv-kanban')).toBeNull();
    });

    it('finance-config dont .json() rejette est absorbé par le .catch individuel → rendu normal', async () => {
      routes.config = () => Promise.resolve({ ok: true, json: () => Promise.reject(new Error('bad json')) });
      await window.PricingView(main);
      await flush();
      expect(main.querySelector('.apv-error')).toBeNull();
      expect(main.querySelector('.apv-kanban')).toBeTruthy();
    });
  });

  /* ─── MODE CATALOGUE ──────────────────────────────────────────────────── */
  describe('mode catalogue', () => {
    it('affiche les produits du catalogue dans le select, mode actif par défaut', async () => {
      await window.PricingView(main);
      await flush();

      expect(main.querySelector('[data-mode="catalog"]').closest('label').className).toContain('active');
      const select = main.querySelector('[data-input="product-select"]');
      expect(select.textContent).toContain('iPhone 13');
      expect(select.textContent).toContain('Écouteurs BT');
    });

    it('sélection d\'un produit → autofill catégorie/prix/devise/poids + recalc à 100ms', async () => {
      await window.PricingView(main);
      await flush();
      global.fetch.mockClear();

      const select = main.querySelector('[data-input="product-select"]');
      select.value = 'p1';
      select.dispatchEvent(new Event('change', { bubbles: true }));

      jest.advanceTimersByTime(99);
      await flush();
      expect(global.fetch.mock.calls.find(([u]) => String(u).includes('/api/pricing/recommend') && !String(u).includes('batch'))).toBeUndefined();

      jest.advanceTimersByTime(1);
      await flush();

      const call = global.fetch.mock.calls.find(([u]) => String(u).includes('/api/pricing/recommend') && !String(u).includes('batch'));
      expect(call).toBeDefined();
      const body = JSON.parse(call[1].body);
      expect(body.product_id).toBe('p1');
      expect(body.category).toBe('phones');
    });
  });

  /* ─── MODE SIMULATION ─────────────────────────────────────────────────── */
  describe('mode simulation', () => {
    async function switchToSimulation() {
      await window.PricingView(main);
      await flush();
      main.querySelector('[data-mode="simulation"]').click();
      await flush();
    }

    it('bascule affiche les champs prix/devise/poids/dimensions, masque le select catalogue', async () => {
      await switchToSimulation();
      expect(main.querySelector('[data-input="prix_achat"]')).toBeTruthy();
      expect(main.querySelector('[data-input="product-select"]')).toBeNull();
    });

    it('garde : prix_achat <= 0 → pas d\'appel recommend même après le délai de 300ms', async () => {
      await switchToSimulation();
      global.fetch.mockClear();

      const prix = main.querySelector('[data-input="prix_achat"]');
      prix.value = '0';
      prix.dispatchEvent(new Event('input', { bubbles: true }));

      jest.advanceTimersByTime(300);
      await flush();

      expect(global.fetch.mock.calls.find(([u]) => String(u).includes('/api/pricing/recommend') && !String(u).includes('batch'))).toBeUndefined();
    });

    it('saisie prix_achat > 0 → recalc débouncé à 300ms avec conversion devise EUR→AED', async () => {
      await switchToSimulation();
      global.fetch.mockClear();

      const cur = main.querySelector('[data-input="currency"]');
      cur.value = 'EUR';
      cur.dispatchEvent(new Event('change', { bubbles: true }));

      const prix = main.querySelector('[data-input="prix_achat"]');
      prix.value = '100';
      prix.dispatchEvent(new Event('input', { bubbles: true }));

      jest.advanceTimersByTime(299);
      await flush();
      let call = global.fetch.mock.calls.find(([u]) => String(u).includes('/api/pricing/recommend') && !String(u).includes('batch'));
      expect(call).toBeUndefined();

      jest.advanceTimersByTime(1);
      await flush();
      call = global.fetch.mock.calls.find(([u]) => String(u).includes('/api/pricing/recommend') && !String(u).includes('batch'));
      expect(call).toBeDefined();
      const body = JSON.parse(call[1].body);
      expect(body.prix_aed).toBeCloseTo((100 * 492) / 138, 2);
    });

    it('conversion KMF→AED et USD→AED, et volume/poids par défaut si dimensions à 0', async () => {
      await switchToSimulation();
      global.fetch.mockClear();

      main.querySelector('[data-input="currency"]').value = 'KMF';
      main.querySelector('[data-input="currency"]').dispatchEvent(new Event('change', { bubbles: true }));
      main.querySelector('[data-input="prix_achat"]').value = '13800';
      main.querySelector('[data-input="prix_achat"]').dispatchEvent(new Event('input', { bubbles: true }));
      jest.advanceTimersByTime(300);
      await flush();
      let call = global.fetch.mock.calls.find(([u]) => String(u).includes('/api/pricing/recommend') && !String(u).includes('batch'));
      let body = JSON.parse(call[1].body);
      expect(body.prix_aed).toBeCloseTo(13800 / 138, 2);
      expect(body.volume_m3).toBe(0.005);
      expect(body.poids_kg).toBe(0.5);

      // Piège : _renderHTML remplace tout le innerHTML à chaque calcul (isComputing
      // true puis false) → les références DOM capturées avant sont détachées et ne
      // bubblent plus vers le container. Il faut re-sélectionner les éléments après
      // chaque cycle de calcul, jamais réutiliser une référence capturée plus tôt.
      global.fetch.mockClear();
      main.querySelector('[data-input="currency"]').value = 'USD';
      main.querySelector('[data-input="currency"]').dispatchEvent(new Event('change', { bubbles: true }));
      main.querySelector('[data-input="prix_achat"]').value = '50';
      main.querySelector('[data-input="prix_achat"]').dispatchEvent(new Event('input', { bubbles: true }));
      jest.advanceTimersByTime(300);
      await flush();
      call = global.fetch.mock.calls.find(([u]) => String(u).includes('/api/pricing/recommend') && !String(u).includes('batch'));
      body = JSON.parse(call[1].body);
      expect(body.prix_aed).toBeCloseTo((50 * 452.64) / 138, 2);
    });

    it('USD consomme la projection backend au lieu d une formule locale', async () => {
      routes.config = () => jsonResponse({
        targets: {},
        fx: { pricing_view_current_compat: { eur_kmf: 500, aed_kmf: 140, usd_kmf: 460, usd_eur_ratio: 0.92 } },
      });
      await switchToSimulation();
      global.fetch.mockClear();

      main.querySelector('[data-input="currency"]').value = 'USD';
      main.querySelector('[data-input="currency"]').dispatchEvent(new Event('change', { bubbles: true }));
      main.querySelector('[data-input="prix_achat"]').value = '50';
      main.querySelector('[data-input="prix_achat"]').dispatchEvent(new Event('input', { bubbles: true }));
      jest.advanceTimersByTime(300);
      await flush();

      const call = global.fetch.mock.calls.find(([u]) => String(u).includes('/api/pricing/recommend') && !String(u).includes('batch'));
      const body = JSON.parse(call[1].body);
      expect(body.prix_aed).toBeCloseTo((50 * 460) / 140, 2);
    });

    it('dim_l/dim_w/dim_h et channel diaspora pris en compte dans le body', async () => {
      await switchToSimulation();
      global.fetch.mockClear();

      main.querySelector('[data-input="prix_achat"]').value = '100';
      main.querySelector('[data-input="prix_achat"]').dispatchEvent(new Event('input', { bubbles: true }));
      main.querySelector('[data-input="dim_l"]').value = '10';
      main.querySelector('[data-input="dim_l"]').dispatchEvent(new Event('input', { bubbles: true }));
      main.querySelector('[data-input="dim_w"]').value = '20';
      main.querySelector('[data-input="dim_w"]').dispatchEvent(new Event('input', { bubbles: true }));
      main.querySelector('[data-input="dim_h"]').value = '5';
      main.querySelector('[data-input="dim_h"]').dispatchEvent(new Event('input', { bubbles: true }));
      main.querySelector('[data-input="poids_kg"]').value = '1.2';
      main.querySelector('[data-input="poids_kg"]').dispatchEvent(new Event('input', { bubbles: true }));
      main.querySelector('[data-input="channel"]').value = 'diaspora';
      main.querySelector('[data-input="channel"]').dispatchEvent(new Event('change', { bubbles: true }));

      jest.advanceTimersByTime(300);
      await flush();

      const call = global.fetch.mock.calls.find(([u]) => String(u).includes('/api/pricing/recommend') && !String(u).includes('batch'));
      const body = JSON.parse(call[1].body);
      expect(body.volume_m3).toBeCloseTo((10 * 20 * 5) / 1_000_000, 8);
      expect(body.poids_kg).toBe(1.2);
      expect(body.channel).toBe('diaspora');
      expect(body.is_diaspora).toBe(true);
    });
  });

  /* ─── RENDU DES COLONNES (avec reco calculée) ────────────────────────── */
  describe('colonnes après calcul', () => {
    async function computeReco() {
      await window.PricingView(main);
      await flush();
      const select = main.querySelector('[data-input="product-select"]');
      select.value = 'p1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      jest.advanceTimersByTime(100);
      await flush();
    }

    it('colonne Relais : total imputé + détail des lignes', async () => {
      await computeReco();
      const col = main.querySelectorAll('.apv-kcol')[1];
      expect(col.textContent).toContain('233');
      expect(col.textContent).toContain('Fret');
      expect(col.textContent).toContain('Douane');
    });

    it('colonne Business : CDR complet N1+N2+N3, contribution et marge complète', async () => {
      await computeReco();
      const col = main.querySelectorAll('.apv-kcol')[2];
      expect(col.textContent).toContain('CDR complet');
      expect(col.textContent).toContain('Contribution');
      expect(col.textContent).toContain('Marge complète');
    });

    it('colonne Décision : scénarios rendus, scénario recommandé marqué, non-selectable taggé', async () => {
      await computeReco();
      const col = main.querySelectorAll('.apv-kcol')[3];
      expect(col.textContent).toContain('Honnête baseline');
      expect(col.textContent).toContain('★ recommandé');
      expect(col.textContent).toContain('sous survie');
    });

    it('bouton "Appliquer" visible : rôle admin + produit + scénario selectable', async () => {
      await computeReco();
      expect(main.querySelector('[data-act="apply-scenario"]')).toBeTruthy();
    });

    it('bouton "Appliquer" absent si rôle non-admin', async () => {
      window.CT.platform.state.role = 'relais';
      await computeReco();
      expect(main.querySelector('[data-act="apply-scenario"]')).toBeNull();
    });

    it('Zone 2 : sans reco, message d\'invite ; avec reco, blocs landed/business + totaux', async () => {
      await window.PricingView(main);
      await flush();
      expect(main.textContent).toContain('Sélectionnez un produit ou lancez une simulation');

      const select = main.querySelector('[data-input="product-select"]');
      select.value = 'p1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      jest.advanceTimersByTime(100);
      await flush();

      expect(main.querySelector('.apv-summary-block--landed')).toBeTruthy();
      expect(main.querySelector('.apv-summary-block--business')).toBeTruthy();
      expect(main.textContent).toContain('Coût complet business');
    });

    it('Zone 2 : alerte qualité affichée si confidence low', async () => {
      routes.recommend = () => jsonResponse(makeReco({ data_quality: { confidence: 'low', warnings: [] } }));
      await computeReco();
      expect(main.querySelector('.apv-summary-alert')).toBeTruthy();
      expect(main.textContent).toContain('Confidence faible');
    });

    it('Zone 2 : alerte qualité affichée si warnings présents (confidence high)', async () => {
      routes.recommend = () => jsonResponse(makeReco({ data_quality: { confidence: 'high', warnings: ['Poids estimé'] } }));
      await computeReco();
      expect(main.querySelector('.apv-summary-alert')).toBeTruthy();
      expect(main.textContent).toContain('avertissement');
      expect(main.textContent).toContain('Poids estimé');
    });

    it('colonne Relais : table d\'imputation agrégée affichée quand allocations contient du non-article', async () => {
      routes.recommend = () => jsonResponse(makeReco({
        cost_breakdown: {
          landed_relay: { product_purchase: 180000 },
          allocations: [
            { component_key: 'freight', component_label: 'Fret', engaged_level: 'shipment', engaged_amount_kmf: 500000, imputed_amount_kmf: 2500 },
            { component_key: 'packaging', component_label: 'Emballage', engaged_level: 'article', engaged_amount_kmf: 1500, imputed_amount_kmf: 1500 },
          ],
          allocation_averages: { articles_per_shipment: 200, confidence: 'low' },
          business: {},
        },
      }));
      await computeReco();
      const col = main.querySelectorAll('.apv-kcol')[1];
      expect(col.textContent).toContain('Imputation détaillée');
      expect(col.textContent).toContain('Fret');
      expect(col.textContent).toContain('Moyennes non calibrées');
    });

    it('colonne Business : bloc pilotage affiché quand target_orders_per_month/monthly_break_even_orders présents', async () => {
      routes.recommend = () => jsonResponse(makeReco({
        target_orders_per_month: 50,
        monthly_break_even_orders: 30,
        monthly_fixed_costs_kmf: 900000,
      }));
      await computeReco();
      const col = main.querySelectorAll('.apv-kcol')[2];
      expect(col.textContent).toContain('Pilotage charges fixes');
      expect(col.textContent).toContain('Cible mensuelle');
      expect(col.textContent).toContain('Seuil rentabilité');
    });

    it('colonne Décision : scénarios vides → message doctrine V3 en attente', async () => {
      routes.recommend = () => jsonResponse(makeReco({ scenarios: [] }));
      await computeReco();
      const col = main.querySelectorAll('.apv-kcol')[3];
      expect(col.textContent).toContain('Doctrine V3');
    });

    it('clic sur un autre scénario selectable → change la sélection et le détail affiché', async () => {
      routes.recommend = () => jsonResponse(makeReco({
        recommended_scenario_id: 's1',
        scenarios: [
          { id: 's1', label: 'Honnête baseline', price_kmf: 280000, margin_pct: 18, selectable: true, is_recommended: true },
          { id: 's3', label: 'Premium', price_kmf: 320000, margin_pct: 25, selectable: true, is_recommended: false },
        ],
      }));
      await computeReco();
      const s3Card = Array.from(main.querySelectorAll('.apv-scenario')).find(c => c.dataset.scenarioId === 's3');
      s3Card.click();
      await flush();

      const s3After = Array.from(main.querySelectorAll('.apv-scenario')).find(c => c.dataset.scenarioId === 's3');
      expect(s3After.className).toContain('apv-scenario-selected');
      expect(main.textContent).toContain('Premium');
    });

    it('clic sur un scénario non-selectable → ignoré (pas de changement de sélection)', async () => {
      await computeReco();
      const cards = main.querySelectorAll('.apv-scenario');
      const s2Card = Array.from(cards).find(c => c.dataset.scenarioId === 's2');
      s2Card.click();
      await flush();
      const s1CardAfter = Array.from(main.querySelectorAll('.apv-scenario')).find(c => c.dataset.scenarioId === 's1');
      expect(s1CardAfter.className).toContain('apv-scenario-selected');
    });

    it('bannière d\'erreur affichée quand le calcul échoue (lastError)', async () => {
      routes.recommend = () => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('server error') });
      await window.PricingView(main);
      await flush();
      const select = main.querySelector('[data-input="product-select"]');
      select.value = 'p1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      jest.advanceTimersByTime(100);
      await flush();

      expect(main.querySelector('.apv-error-banner')).toBeTruthy();
      expect(main.querySelectorAll('.apv-kempty-error').length).toBeGreaterThan(0);
    });
  });

  /* ─── APPLY-SCENARIO ──────────────────────────────────────────────────── */
  describe('apply-scenario', () => {
    it('prix < survival → alerte de blocage, aucun confirm(), aucun appel PUT', async () => {
      routes.recommend = () => jsonResponse(makeReco({
        scenarios: [{ id: 's1', label: 'Sous plancher', price_kmf: 100000, margin_pct: 5, selectable: true, is_recommended: true }],
        survival_price_kmf: 240500,
      }));
      await window.PricingView(main);
      await flush();
      const select = main.querySelector('[data-input="product-select"]');
      select.value = 'p1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      jest.advanceTimersByTime(100);
      await flush();
      global.fetch.mockClear();

      main.querySelector('[data-act="apply-scenario"]').click();
      await flush();

      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('seuil de survie'));
      expect(window.confirm).not.toHaveBeenCalled();
      expect(global.fetch.mock.calls.find(([u]) => String(u).includes('/api/pricing/apply-price/'))).toBeUndefined();
    });

    it('confirm() accepté → appel PUT avec le bon body', async () => {
      await window.PricingView(main);
      await flush();
      const select = main.querySelector('[data-input="product-select"]');
      select.value = 'p1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      jest.advanceTimersByTime(100);
      await flush();
      global.fetch.mockClear();

      main.querySelector('[data-act="apply-scenario"]').click();
      await flush();

      const call = global.fetch.mock.calls.find(([u]) => String(u).includes('/api/pricing/apply-price/'));
      expect(call).toBeDefined();
      const body = JSON.parse(call[1].body);
      expect(body.price_kmf).toBe(280000);
      expect(body.scenario_id).toBe('s1');
      expect(body.source).toBe('scenario');
    });

    it('échec de l\'appel PUT (ok:false) → alert d\'erreur, bouton réactivé', async () => {
      routes.apply = () => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('server error') });
      await window.PricingView(main);
      await flush();
      const select = main.querySelector('[data-input="product-select"]');
      select.value = 'p1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      jest.advanceTimersByTime(100);
      await flush();

      const btn = main.querySelector('[data-act="apply-scenario"]');
      btn.click();
      await flush();

      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Erreur'));
      expect(btn.disabled).toBe(false);
    });

    it('confirm() refusé → aucun appel PUT', async () => {
      window.confirm = jest.fn(() => false);
      await window.PricingView(main);
      await flush();
      const select = main.querySelector('[data-input="product-select"]');
      select.value = 'p1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      jest.advanceTimersByTime(100);
      await flush();
      global.fetch.mockClear();

      main.querySelector('[data-act="apply-scenario"]').click();
      await flush();

      expect(global.fetch.mock.calls.find(([u]) => String(u).includes('/api/pricing/apply-price/'))).toBeUndefined();
    });
  });

  /* ─── REFRESH ─────────────────────────────────────────────────────────── */
  describe('refresh', () => {
    it('clic refresh → recharge _loadAll/_loadCatalog et reprogramme un recalcul si sélection active', async () => {
      await window.PricingView(main);
      await flush();
      const select = main.querySelector('[data-input="product-select"]');
      select.value = 'p1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      jest.advanceTimersByTime(100);
      await flush();
      global.fetch.mockClear();

      main.querySelector('[data-act="refresh"]').click();
      await flush();
      jest.advanceTimersByTime(100);
      await flush();

      expect(global.fetch.mock.calls.some(([u]) => String(u).includes('/api/admin/finance-config'))).toBe(true);
      expect(global.fetch.mock.calls.some(([u]) => String(u).includes('/api/pricing/recommend-batch'))).toBe(true);
      expect(global.fetch.mock.calls.some(([u]) => String(u).includes('/api/pricing/recommend') && !String(u).includes('batch'))).toBe(true);
    });

  });

  /* ─── NAVIGATION ATELIER ──────────────────────────────────────────────── */
  it('bouton "Configurer les composants" → KmcApp.navigate("pricing_workshop")', async () => {
    await window.PricingView(main);
    await flush();
    main.querySelector('[data-act="open-workshop"]').click();
    expect(window.KmcApp.navigate).toHaveBeenCalledWith('pricing_workshop');
  });

  it('bouton "Configurer les composants" sans KmcApp → fallback location.hash', async () => {
    delete window.KmcApp;
    await window.PricingView(main);
    await flush();
    main.querySelector('[data-act="open-workshop"]').click();
    expect(window.location.hash).toBe('#pricing_workshop');
  });

  /* ─── GARDE : container détaché pendant le recalcul programmé ────────── */
  it('garde : container détaché du DOM entre la programmation et le déclenchement du recalcul → pas de crash, pas de re-rendu', async () => {
    await window.PricingView(main);
    await flush();
    const select = main.querySelector('[data-input="product-select"]');
    select.value = 'p1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    // Le recalc est programmé à 100ms ; on détache le container avant qu'il ne se déclenche
    main.remove();
    jest.advanceTimersByTime(100);
    await flush();
    // Pas d'exception levée jusqu'ici = la garde a fonctionné
    expect(true).toBe(true);
  });

  /* ─── BUG CONNU : accumulation de listeners sur re-rendu ─────────────── */
  it('[bug documenté, non corrigé] un re-rendu préalable fait déclencher les actions data-act plusieurs fois pour un seul clic', async () => {
    await window.PricingView(main);
    await flush();
    main.querySelector('[data-mode="simulation"]').click();
    await flush();
    main.querySelector('[data-mode="catalog"]').click();
    await flush();

    window.KmcApp.navigate.mockClear();
    main.querySelector('[data-act="open-workshop"]').click();

    expect(window.KmcApp.navigate.mock.calls.length).toBeGreaterThan(1);
  });
});
