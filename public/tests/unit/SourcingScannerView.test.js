'use strict';

/**
 * tests/unit/SourcingScannerView.test.js
 *
 * admin/js/views/SourcingScannerView.js (526L) — vue Scanner Catalogue Fournisseur.
 * Export public : constructeur `SourcingScannerView` (pas un objet {render} —
 * `new SourcingScannerView()` puis `instance.render(rootEl)`, cf. app.js#invokeView).
 *
 * Dépendances externes (globals mockés) :
 *   - KmcApi.getSourcingCatalogs() / getSourcingCandidates(params) / getSourcingCandidate(id) /
 *     updateSourcingCandidate(id, body) / importSourcingCatalog(body) / scanSourcingCandidate(id) /
 *     importSourcingProduct(id) / watchlistSourcingCandidate(id) / rejectSourcingCandidate(id, body)
 *   - global.fetch('/api/admin/customs-categories') (hors KmcApi — appel direct)
 *   - window.alert / window.confirm / window.prompt
 *
 * Périmètre couvert :
 *   - Contrat d'export (constructeur, pas objet render)
 *   - render() : chargement initial (3 appels parallèles), onglet "candidates" par défaut
 *   - Onglet Candidats : vide, peuplé (KPIs, badges décision/santé/état/fiabilité), filtres
 *     (apply/clear → reload avec params)
 *   - Onglet Imports : vide, peuplé
 *   - Onglet Nouveau import : toggle source CSV/manuel, soumission CSV (validation + succès),
 *     soumission manuelle (validation + succès + parsing des champs numériques)
 *   - Drawer : ouverture (getSourcingCandidate), fermeture, save-edits (update + re-scan),
 *     import-product (confirm annulé/accepté), watchlist, reject (prompt annulé/rempli)
 */

const { makeKmcApi, cleanupGlobals, mockAlert, mockConfirm, mockPrompt } = require('./helpers/dashboardTestKit');

function makeCandidate(overrides) {
  return Object.assign({
    id: 'CAND-1',
    product_name: 'Robe rouge M',
    supplier_name: 'Dragon Mart Shop X',
    komerce_category: 'clothing',
    purchase_price_kmf: 45_000,
    state: 'scanned',
    confidence: 'high',
    currency: 'AED',
    estimated_weight_kg: 0.4,
    estimated_volume_m3: 0.002,
    target_margin_pct: 30,
    notes: '',
    product_url: 'https://example.com/p1',
    scan_result: {
      sourcing_decision: 'TEST',
      health_status: 'healthy',
      minimum_safe_price_kmf: 60_000,
      recommended_price_kmf: 75_000,
      estimated_margin_pct: 32,
    },
  }, overrides);
}

function makeImport(overrides) {
  return Object.assign({
    imported_at: '2026-07-01T10:00:00Z',
    supplier_name: 'Dragon Mart Shop X',
    source_type: 'csv',
    items_count: 20,
    imported_count: 3,
    notes: '',
  }, overrides);
}

describe('SourcingScannerView', () => {
  let root;
  let instance;

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '<div id="main"></div>';
    root = document.getElementById('main');

    makeKmcApi({
      getSourcingCatalogs: jest.fn().mockResolvedValue({ imports: [] }),
      getSourcingCandidates: jest.fn().mockResolvedValue({ candidates: [] }),
      getSourcingCandidate: jest.fn(),
      updateSourcingCandidate: jest.fn().mockResolvedValue({}),
      scanSourcingCandidate: jest.fn(),
      importSourcingCatalog: jest.fn(),
      importSourcingProduct: jest.fn().mockResolvedValue({}),
      watchlistSourcingCandidate: jest.fn().mockResolvedValue({}),
      rejectSourcingCandidate: jest.fn().mockResolvedValue({}),
    });
    global.fetch = jest.fn().mockResolvedValue({ json: () => Promise.resolve([]) });
    mockAlert();
    mockConfirm(true);
    mockPrompt('raison test');

    require('../../admin/js/views/SourcingScannerView.js');
    instance = new global.SourcingScannerView();
  });

  afterEach(() => {
    cleanupGlobals('KmcApi');
    delete global.fetch;
    delete window.alert;
    delete window.confirm;
    delete window.prompt;
  });

  async function flush() {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('expose un constructeur (contrat app.js#invokeView : new View() + instance.render)', () => {
    expect(typeof global.SourcingScannerView).toBe('function');
    expect(typeof instance.render).toBe('function');
  });

  describe('render() — chargement initial', () => {
    it('appelle getSourcingCatalogs, getSourcingCandidates et fetch(categories), affiche l\'onglet candidats par défaut', async () => {
      await instance.render(root);
      await flush();

      expect(global.KmcApi.getSourcingCatalogs).toHaveBeenCalled();
      expect(global.KmcApi.getSourcingCandidates).toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalledWith('/api/admin/customs-categories', expect.objectContaining({ credentials: 'include' }));
      expect(root.querySelector('.scs-tab.active').textContent).toContain('Candidats');
    });
  });

  describe('Onglet Candidats', () => {
    it('vide → message dédié', async () => {
      await instance.render(root);
      await flush();
      expect(root.textContent).toContain('Aucun candidat');
    });

    it('peuplé : KPIs (total, à traiter, décisions) et badges dans la table', async () => {
      global.KmcApi.getSourcingCandidates.mockResolvedValue({
        candidates: [
          makeCandidate({ id: 'C1', state: 'scanned', scan_result: { sourcing_decision: 'TEST', health_status: 'healthy' } }),
          makeCandidate({ id: 'C2', state: 'test_ready', scan_result: { sourcing_decision: 'WATCH', health_status: 'fragile' } }),
        ],
      });
      await instance.render(root);
      await flush();

      const html = root.innerHTML;
      expect(root.querySelector('.scs-kpi-value').textContent).toBe('2');
      expect(html).toContain('Robe rouge M');
      expect(html).toContain('Dragon Mart Shop X');
      expect(html).toContain('TEST');
      expect(html).toContain('WATCH');
    });

    it('filtres : "Filtrer" recharge getSourcingCandidates avec les params choisis', async () => {
      await instance.render(root);
      await flush();
      global.KmcApi.getSourcingCandidates.mockClear();

      root.querySelector('[data-filter="state"]').value = 'watchlist';
      root.querySelector('[data-filter="state"]').dispatchEvent(new Event('change', { bubbles: true }));
      root.querySelector('[data-filter="supplier"]').value = 'Noon';
      root.querySelector('[data-filter="supplier"]').dispatchEvent(new Event('input', { bubbles: true }));
      root.querySelector('[data-act="apply-filters"]').click();
      await flush();

      expect(global.KmcApi.getSourcingCandidates).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'watchlist', supplier: 'Noon' })
      );
    });

    it('"×" (clear-filters) réinitialise les filtres et recharge sans params', async () => {
      await instance.render(root);
      await flush();
      root.querySelector('[data-filter="supplier"]').value = 'Noon';
      root.querySelector('[data-filter="supplier"]').dispatchEvent(new Event('input', { bubbles: true }));
      global.KmcApi.getSourcingCandidates.mockClear();

      root.querySelector('[data-act="clear-filters"]').click();
      await flush();

      expect(global.KmcApi.getSourcingCandidates).toHaveBeenCalledWith({});
    });
  });

  describe('Onglet Imports', () => {
    it('vide → message dédié', async () => {
      await instance.render(root);
      await flush();
      root.querySelector('[data-act="set-tab"][data-tab="imports"]').click();
      expect(root.textContent).toContain('Aucun import');
    });

    it('peuplé : liste les imports avec fournisseur, source, items', async () => {
      global.KmcApi.getSourcingCatalogs.mockResolvedValue({ imports: [makeImport()] });
      await instance.render(root);
      await flush();
      root.querySelector('[data-act="set-tab"][data-tab="imports"]').click();

      const html = root.innerHTML;
      expect(html).toContain('Dragon Mart Shop X');
      expect(html).toContain('csv');
    });
  });

  describe('Onglet Nouveau import', () => {
    it('CSV actif par défaut, toggle vers "manuel" bascule le formulaire', async () => {
      await instance.render(root);
      await flush();
      root.querySelector('[data-act="set-tab"][data-tab="new"]').click();

      expect(root.querySelector('[data-newimp="csv_text"]')).not.toBeNull();

      root.querySelector('[data-act="set-source"][data-source="manual"]').click();
      expect(root.querySelector('[data-manual="product_name"]')).not.toBeNull();
    });

    it('soumission CSV sans fournisseur/CSV → alert de validation, pas d\'appel API', async () => {
      await instance.render(root);
      await flush();
      root.querySelector('[data-act="set-tab"][data-tab="new"]').click();

      root.querySelector('[data-act="submit-csv-import"]').click();
      await flush();

      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('requis'));
      expect(global.KmcApi.importSourcingCatalog).not.toHaveBeenCalled();
    });

    it('soumission CSV valide → importSourcingCatalog(csv), retour à l\'onglet candidats', async () => {
      global.KmcApi.importSourcingCatalog.mockResolvedValue({ created: 5, errors: [] });
      await instance.render(root);
      await flush();
      root.querySelector('[data-act="set-tab"][data-tab="new"]').click();

      root.querySelector('[data-newimp="supplier_name"]').value = 'Noon';
      root.querySelector('[data-newimp="supplier_name"]').dispatchEvent(new Event('input', { bubbles: true }));
      root.querySelector('[data-newimp="csv_text"]').value = 'name,price\nRobe,45';
      root.querySelector('[data-newimp="csv_text"]').dispatchEvent(new Event('input', { bubbles: true }));

      root.querySelector('[data-act="submit-csv-import"]').click();
      await flush();

      expect(global.KmcApi.importSourcingCatalog).toHaveBeenCalledWith(
        expect.objectContaining({ supplier_name: 'Noon', source_type: 'csv', csv_text: 'name,price\nRobe,45' })
      );
      expect(root.querySelector('.scs-tab.active').textContent).toContain('Candidats');
    });

    it('soumission manuelle sans champs requis → alert, pas d\'appel API', async () => {
      await instance.render(root);
      await flush();
      root.querySelector('[data-act="set-tab"][data-tab="new"]').click();
      root.querySelector('[data-act="set-source"][data-source="manual"]').click();

      root.querySelector('[data-act="submit-manual-import"]').click();
      await flush();

      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('requis'));
      expect(global.KmcApi.importSourcingCatalog).not.toHaveBeenCalled();
    });

    it('soumission manuelle valide → importSourcingCatalog(manual) avec parsing des champs numériques', async () => {
      global.KmcApi.importSourcingCatalog.mockResolvedValue({ created: 1, errors: [] });
      await instance.render(root);
      await flush();
      root.querySelector('[data-act="set-tab"][data-tab="new"]').click();
      root.querySelector('[data-act="set-source"][data-source="manual"]').click();

      root.querySelector('[data-newimp="supplier_name"]').value = 'Noon';
      root.querySelector('[data-newimp="supplier_name"]').dispatchEvent(new Event('input', { bubbles: true }));
      root.querySelector('[data-manual="product_name"]').value = 'Robe rouge M';
      root.querySelector('[data-manual="product_name"]').dispatchEvent(new Event('input', { bubbles: true }));
      root.querySelector('[data-manual="purchase_price"]').value = '45';
      root.querySelector('[data-manual="purchase_price"]').dispatchEvent(new Event('input', { bubbles: true }));

      root.querySelector('[data-act="submit-manual-import"]').click();
      await flush();

      expect(global.KmcApi.importSourcingCatalog).toHaveBeenCalledWith(
        expect.objectContaining({
          supplier_name: 'Noon',
          source_type: 'manual',
          items: [expect.objectContaining({ product_name: 'Robe rouge M', purchase_price: 45 })],
        })
      );
    });
  });

  describe('Drawer candidat', () => {
    async function openDrawerWithCandidate(cand) {
      global.KmcApi.getSourcingCandidates.mockResolvedValue({ candidates: [cand] });
      global.KmcApi.getSourcingCandidate.mockResolvedValue({ candidate: cand });
      await instance.render(root);
      await flush();
      root.querySelector('[data-act="open-candidate"]').click();
      await flush();
    }

    it('clic sur une ligne → getSourcingCandidate puis ouverture du drawer', async () => {
      const cand = makeCandidate();
      await openDrawerWithCandidate(cand);

      expect(global.KmcApi.getSourcingCandidate).toHaveBeenCalledWith('CAND-1');
      expect(root.querySelector('.scs-drawer').classList.contains('open')).toBe(true);
      expect(root.querySelector('.scs-drawer-title').textContent).toBe('Robe rouge M');
    });

    it('"←" (close-drawer) referme le drawer', async () => {
      await openDrawerWithCandidate(makeCandidate());
      root.querySelector('[data-act="close-drawer"]').click();
      expect(root.querySelector('.scs-drawer').classList.contains('open')).toBe(false);
    });

    it('save-edits → updateSourcingCandidate puis scanSourcingCandidate, recharge la liste', async () => {
      const cand = makeCandidate();
      global.KmcApi.scanSourcingCandidate.mockResolvedValue({ candidate: makeCandidate({ notes: 'ok' }) });
      await openDrawerWithCandidate(cand);

      root.querySelector('[data-act="save-edits"]').click();
      await flush();

      expect(global.KmcApi.updateSourcingCandidate).toHaveBeenCalledWith('CAND-1', expect.any(Object));
      expect(global.KmcApi.scanSourcingCandidate).toHaveBeenCalledWith('CAND-1');
    });

    it('import-product : confirm annulé → pas d\'appel API', async () => {
      mockConfirm(false);
      await openDrawerWithCandidate(makeCandidate());

      root.querySelector('[data-act="import-product"]').click();
      await flush();

      expect(global.KmcApi.importSourcingProduct).not.toHaveBeenCalled();
    });

    it('import-product : confirm accepté → importSourcingProduct puis fermeture du drawer', async () => {
      await openDrawerWithCandidate(makeCandidate());

      root.querySelector('[data-act="import-product"]').click();
      await flush();

      expect(global.KmcApi.importSourcingProduct).toHaveBeenCalledWith('CAND-1');
      expect(root.querySelector('.scs-drawer').classList.contains('open')).toBe(false);
    });

    it('watchlist → watchlistSourcingCandidate puis fermeture du drawer', async () => {
      await openDrawerWithCandidate(makeCandidate());

      root.querySelector('[data-act="watchlist"]').click();
      await flush();

      expect(global.KmcApi.watchlistSourcingCandidate).toHaveBeenCalledWith('CAND-1');
      expect(root.querySelector('.scs-drawer').classList.contains('open')).toBe(false);
    });

    it('reject : prompt annulé (null) → pas d\'appel API', async () => {
      mockPrompt(null);
      await openDrawerWithCandidate(makeCandidate());

      root.querySelector('[data-act="reject"]').click();
      await flush();

      expect(global.KmcApi.rejectSourcingCandidate).not.toHaveBeenCalled();
    });

    it('reject : prompt rempli → rejectSourcingCandidate(reason) puis fermeture du drawer', async () => {
      mockPrompt('Prix trop bas');
      await openDrawerWithCandidate(makeCandidate());

      root.querySelector('[data-act="reject"]').click();
      await flush();

      expect(global.KmcApi.rejectSourcingCandidate).toHaveBeenCalledWith('CAND-1', { reason: 'Prix trop bas' });
      expect(root.querySelector('.scs-drawer').classList.contains('open')).toBe(false);
    });
  });
});
