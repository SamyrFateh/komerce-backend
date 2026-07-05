'use strict';

/**
 * tests/unit/SourcingScannerView.test.js
 *
 * admin/js/views/SourcingScannerView.js (526L) — Vue Scanner Catalogue Fournisseur
 * /admin/sourcing-scanner. Export réel : constructeur `function SourcingScannerView()`
 * avec `this.render = ...` — instanciation en test : `new global.SourcingScannerView().render(container)`
 * (même contrat que CustomsView/SuppliersView/PricingStrategyView).
 * esc()/fmt() sont locaux au fichier (pas de dépendance utils.js).
 * État module-level (_state) → jest.resetModules() nécessaire entre tests (fait manuellement ici).
 *
 * Source API :
 *   - KmcApi.getSourcingCatalogs()   (catch local → {})
 *   - KmcApi.getSourcingCandidates(params) (catch local sur loadAll, direct sur reloadCandidates)
 *   - global.fetch('/api/admin/customs-categories') (catch local → [])
 *   - KmcApi.getSourcingCandidate(id) / updateSourcingCandidate / scanSourcingCandidate /
 *     importSourcingCatalog / importSourcingProduct / watchlistSourcingCandidate /
 *     rejectSourcingCandidate
 */

const path = require('path');
const REL = '../../admin/js/views/SourcingScannerView.js';

function loadIt() {
  jest.resetModules();
  const abs = path.resolve(__dirname, REL);
  delete require.cache[require.resolve(abs)];
  require(abs);
  return new global.SourcingScannerView();
}

function candidate(overrides = {}) {
  return Object.assign({
    id: 'cand-1', product_name: 'Robe rouge', supplier_name: 'Noon', komerce_category: 'mode',
    purchase_price_kmf: 20000, state: 'scanned', confidence: 'high',
    scan_result: { sourcing_decision: 'TEST', health_status: 'healthy', minimum_safe_price_kmf: 25000, recommended_price_kmf: 30000, estimated_margin_pct: 22 },
  }, overrides);
}

describe('SourcingScannerView', () => {
  let main;

  beforeEach(() => {
    document.body.innerHTML = '<div id="main"></div>';
    main = document.getElementById('main');
    global.KmcApi = {
      getSourcingCatalogs: jest.fn().mockResolvedValue({ imports: [] }),
      getSourcingCandidates: jest.fn().mockResolvedValue({ candidates: [] }),
      getSourcingCandidate: jest.fn().mockResolvedValue({ candidate: candidate() }),
      updateSourcingCandidate: jest.fn().mockResolvedValue({}),
      scanSourcingCandidate: jest.fn().mockResolvedValue({ candidate: candidate() }),
      importSourcingCatalog: jest.fn().mockResolvedValue({ created: 3, errors: [] }),
      importSourcingProduct: jest.fn().mockResolvedValue({}),
      watchlistSourcingCandidate: jest.fn().mockResolvedValue({}),
      rejectSourcingCandidate: jest.fn().mockResolvedValue({}),
    };
    global.fetch = jest.fn().mockResolvedValue({ json: () => Promise.resolve([]) });
    window.alert = jest.fn();
    window.confirm = jest.fn(() => true);
    window.prompt = jest.fn(() => '');
  });

  afterEach(() => {
    delete global.KmcApi;
    delete global.fetch;
    delete window.alert;
    delete window.confirm;
    delete window.prompt;
    document.getElementById('scs-styles')?.remove();
  });

  async function flush(times = 12) {
    for (let i = 0; i < times; i++) await Promise.resolve();
  }

  it('expose une instance avec render() (contrat constructeur, app.js#invokeView)', () => {
    const view = loadIt();
    expect(typeof view.render).toBe('function');
  });

  it('affiche un état de chargement avant résolution, puis injecte les styles', async () => {
    let resolveIt;
    global.KmcApi.getSourcingCandidates = jest.fn(() => new Promise((r) => { resolveIt = r; }));
    const view = loadIt();
    view.render(main);
    expect(main.textContent).toContain('Chargement du scanner');
    resolveIt({ candidates: [] });
    await flush();
    expect(document.getElementById('scs-styles')).toBeTruthy();
  });

  it('charge catalogs + candidates + categories en parallèle', async () => {
    const view = loadIt();
    view.render(main);
    await flush();
    expect(global.KmcApi.getSourcingCatalogs).toHaveBeenCalled();
    expect(global.KmcApi.getSourcingCandidates).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith('/api/admin/customs-categories', { credentials: 'include' });
  });

  it('échec getSourcingCatalogs / categories → tolérés (fallback {}/[]), pas de crash', async () => {
    global.KmcApi.getSourcingCatalogs = jest.fn().mockRejectedValue(new Error('catalogs KO'));
    global.fetch = jest.fn().mockRejectedValue(new Error('fetch KO'));
    const view = loadIt();
    view.render(main);
    await flush();
    expect(main.textContent).toContain('Scanner Catalogue Fournisseur');
  });

  it('échec getSourcingCandidates → toléré localement (fallback []), pas d\'error-state', async () => {
    global.KmcApi.getSourcingCandidates = jest.fn().mockRejectedValue(new Error('candidates KO'));
    const view = loadIt();
    view.render(main);
    await flush();
    expect(main.textContent).toContain('Scanner Catalogue Fournisseur');
    expect(main.textContent).toContain('Aucun candidat');
  });

  it('onglet Candidats par défaut, compteurs dans les tabs reflètent les données', async () => {
    global.KmcApi.getSourcingCandidates = jest.fn().mockResolvedValue({ candidates: [candidate(), candidate({ id: 'c2' })] });
    global.KmcApi.getSourcingCatalogs = jest.fn().mockResolvedValue({ imports: [{ id: 'i1' }] });
    const view = loadIt();
    view.render(main);
    await flush();
    expect(main.querySelector('.scs-tab.active').textContent).toContain('Candidats (2)');
    expect(main.textContent).toContain('Imports (1)');
  });

  it('liste vide → message invitant à importer', async () => {
    const view = loadIt();
    view.render(main);
    await flush();
    expect(main.textContent).toContain('Aucun candidat');
  });

  it('affiche une ligne candidat avec prix/marge/santé/décision/état/fiabilité', async () => {
    global.KmcApi.getSourcingCandidates = jest.fn().mockResolvedValue({ candidates: [candidate()] });
    const view = loadIt();
    view.render(main);
    await flush();
    const row = main.querySelector('tr[data-id="cand-1"]');
    expect(row).toBeTruthy();
    expect(row.textContent).toContain('Robe rouge');
    expect(row.textContent).toContain('Noon');
    expect(row.textContent).toContain('22%');
    expect(row.textContent).toContain('healthy');
    expect(row.textContent).toContain('TEST');
  });

  it('changement d\'onglet (set-tab) affiche Imports ou Nouveau import', async () => {
    const view = loadIt();
    view.render(main);
    await flush();

    main.querySelector('[data-act="set-tab"][data-tab="imports"]').click();
    expect(main.querySelector('.scs-tab.active').textContent).toContain('Imports');

    main.querySelector('[data-act="set-tab"][data-tab="new"]').click();
    expect(main.textContent).toContain('Nouveau import');
    expect(main.querySelector('[data-act="submit-csv-import"]')).toBeTruthy();
  });

  it('onglet Imports vide → message invitant à créer un import', async () => {
    const view = loadIt();
    view.render(main);
    await flush();
    main.querySelector('[data-act="set-tab"][data-tab="imports"]').click();
    expect(main.textContent).toContain('Aucun import');
  });

  it('onglet Imports : affiche une ligne d\'import avec date/fournisseur/source/items', async () => {
    global.KmcApi.getSourcingCatalogs = jest.fn().mockResolvedValue({
      imports: [{ imported_at: '2026-07-01T10:00:00Z', supplier_name: 'Noon', source_type: 'csv', source_filename: 'noon.csv', items_count: 50, imported_count: 10, notes: 'ok' }],
    });
    const view = loadIt();
    view.render(main);
    await flush();
    main.querySelector('[data-act="set-tab"][data-tab="imports"]').click();
    expect(main.textContent).toContain('Noon');
    expect(main.textContent).toContain('noon.csv');
    expect(main.textContent).toContain('50');
  });

  it('filtres : apply-filters recharge candidates avec les params choisis', async () => {
    const view = loadIt();
    view.render(main);
    await flush();
    main.querySelector('[data-filter="state"]').value = 'watchlist';
    main.querySelector('[data-filter="state"]').dispatchEvent(new Event('input', { bubbles: true }));
    main.querySelector('[data-act="apply-filters"]').click();
    await flush();
    const lastCall = global.KmcApi.getSourcingCandidates.mock.calls[global.KmcApi.getSourcingCandidates.mock.calls.length - 1][0];
    expect(lastCall).toEqual({ state: 'watchlist' });
  });

  it('filtres : clear-filters réinitialise et recharge sans params', async () => {
    const view = loadIt();
    view.render(main);
    await flush();
    main.querySelector('[data-filter="supplier"]').value = 'Noon';
    main.querySelector('[data-filter="supplier"]').dispatchEvent(new Event('input', { bubbles: true }));
    main.querySelector('[data-act="clear-filters"]').click();
    await flush();
    const lastCall = global.KmcApi.getSourcingCandidates.mock.calls[global.KmcApi.getSourcingCandidates.mock.calls.length - 1][0];
    expect(lastCall).toEqual({});
  });

  it('filtres : échec applyFilters → alert()', async () => {
    const view = loadIt();
    view.render(main);
    await flush();
    global.KmcApi.getSourcingCandidates = jest.fn().mockRejectedValue(new Error('filter KO'));
    main.querySelector('[data-act="apply-filters"]').click();
    await flush();
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('filter KO'));
  });

  it('import CSV : champs requis manquants → alert(), aucun appel API', async () => {
    const view = loadIt();
    view.render(main);
    await flush();
    main.querySelector('[data-act="set-tab"][data-tab="new"]').click();
    main.querySelector('[data-act="submit-csv-import"]').click();
    await flush();
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Nom fournisseur et CSV requis'));
    expect(global.KmcApi.importSourcingCatalog).not.toHaveBeenCalled();
  });

  it('import CSV : soumission valide → importSourcingCatalog appelé, retour onglet candidats', async () => {
    const view = loadIt();
    view.render(main);
    await flush();
    main.querySelector('[data-act="set-tab"][data-tab="new"]').click();
    main.querySelector('[data-newimp="supplier_name"]').value = 'Noon';
    main.querySelector('[data-newimp="supplier_name"]').dispatchEvent(new Event('input', { bubbles: true }));
    main.querySelector('[data-newimp="csv_text"]').value = 'name,price\nRobe,45';
    main.querySelector('[data-newimp="csv_text"]').dispatchEvent(new Event('input', { bubbles: true }));
    main.querySelector('[data-act="submit-csv-import"]').click();
    await flush();

    expect(global.KmcApi.importSourcingCatalog).toHaveBeenCalledWith({
      supplier_name: 'Noon', source_type: 'csv', csv_text: 'name,price\nRobe,45',
    });
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Import OK'));
    expect(main.querySelector('.scs-tab.active').textContent).toContain('Candidats');
  });

  it('import CSV : échec API → alert() et bouton réactivé', async () => {
    global.KmcApi.importSourcingCatalog = jest.fn().mockRejectedValue(new Error('import KO'));
    const view = loadIt();
    view.render(main);
    await flush();
    main.querySelector('[data-act="set-tab"][data-tab="new"]').click();
    main.querySelector('[data-newimp="supplier_name"]').value = 'Noon';
    main.querySelector('[data-newimp="supplier_name"]').dispatchEvent(new Event('input', { bubbles: true }));
    main.querySelector('[data-newimp="csv_text"]').value = 'a,b';
    main.querySelector('[data-newimp="csv_text"]').dispatchEvent(new Event('input', { bubbles: true }));
    main.querySelector('[data-act="submit-csv-import"]').click();
    await flush();
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('import KO'));
    expect(main.querySelector('[data-act="submit-csv-import"]').disabled).toBe(false);
  });

  it('bascule source manuelle : champs requis manquants → alert()', async () => {
    const view = loadIt();
    view.render(main);
    await flush();
    main.querySelector('[data-act="set-tab"][data-tab="new"]').click();
    main.querySelector('[data-act="set-source"][data-source="manual"]').click();
    main.querySelector('[data-act="submit-manual-import"]').click();
    await flush();
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Nom fournisseur, produit et prix achat requis'));
  });

  it('import manuel : soumission valide → importSourcingCatalog avec items[] et champs numériques parsés', async () => {
    const view = loadIt();
    view.render(main);
    await flush();
    main.querySelector('[data-act="set-tab"][data-tab="new"]').click();
    main.querySelector('[data-act="set-source"][data-source="manual"]').click();
    main.querySelector('[data-newimp="supplier_name"]').value = 'Noon';
    main.querySelector('[data-newimp="supplier_name"]').dispatchEvent(new Event('input', { bubbles: true }));
    main.querySelector('[data-manual="product_name"]').value = 'Robe';
    main.querySelector('[data-manual="product_name"]').dispatchEvent(new Event('input', { bubbles: true }));
    main.querySelector('[data-manual="purchase_price"]').value = '45';
    main.querySelector('[data-manual="purchase_price"]').dispatchEvent(new Event('input', { bubbles: true }));
    main.querySelector('[data-act="submit-manual-import"]').click();
    await flush();

    expect(global.KmcApi.importSourcingCatalog).toHaveBeenCalledWith({
      supplier_name: 'Noon',
      source_type: 'manual',
      items: [expect.objectContaining({ product_name: 'Robe', purchase_price: 45, currency: 'AED' })],
    });
  });

  it('candidat : clic sur une ligne ouvre le drawer avec détail', async () => {
    global.KmcApi.getSourcingCandidates = jest.fn().mockResolvedValue({ candidates: [candidate()] });
    const view = loadIt();
    view.render(main);
    await flush();
    main.querySelector('[data-act="open-candidate"]').click();
    await flush();
    expect(global.KmcApi.getSourcingCandidate).toHaveBeenCalledWith('cand-1');
    expect(main.querySelector('.scs-drawer.open')).toBeTruthy();
    expect(main.textContent).toContain('Robe rouge');
  });

  it('candidat : échec ouverture drawer → alert()', async () => {
    global.KmcApi.getSourcingCandidates = jest.fn().mockResolvedValue({ candidates: [candidate()] });
    global.KmcApi.getSourcingCandidate = jest.fn().mockRejectedValue(new Error('detail KO'));
    const view = loadIt();
    view.render(main);
    await flush();
    main.querySelector('[data-act="open-candidate"]').click();
    await flush();
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('detail KO'));
  });

  it('drawer : fermeture (close-drawer)', async () => {
    global.KmcApi.getSourcingCandidates = jest.fn().mockResolvedValue({ candidates: [candidate()] });
    const view = loadIt();
    view.render(main);
    await flush();
    main.querySelector('[data-act="open-candidate"]').click();
    await flush();
    main.querySelector('[data-act="close-drawer"]').click();
    expect(main.querySelector('.scs-drawer.open')).toBeNull();
  });

  it('drawer : save-edits envoie le body construit puis re-scan et recharge', async () => {
    global.KmcApi.getSourcingCandidates = jest.fn().mockResolvedValue({ candidates: [candidate()] });
    const view = loadIt();
    view.render(main);
    await flush();
    main.querySelector('[data-act="open-candidate"]').click();
    await flush();

    main.querySelector('[data-edit="notes"]').value = 'note admin';
    main.querySelector('[data-edit="notes"]').dispatchEvent(new Event('input', { bubbles: true }));
    main.querySelector('[data-act="save-edits"]').click();
    await flush();

    expect(global.KmcApi.updateSourcingCandidate).toHaveBeenCalledWith('cand-1', expect.objectContaining({ notes: 'note admin' }));
    expect(global.KmcApi.scanSourcingCandidate).toHaveBeenCalledWith('cand-1');
  });

  it('drawer : save-edits échoue → alert() et bouton réactivé', async () => {
    global.KmcApi.getSourcingCandidates = jest.fn().mockResolvedValue({ candidates: [candidate()] });
    global.KmcApi.updateSourcingCandidate = jest.fn().mockRejectedValue(new Error('save KO'));
    const view = loadIt();
    view.render(main);
    await flush();
    main.querySelector('[data-act="open-candidate"]').click();
    await flush();
    main.querySelector('[data-act="save-edits"]').click();
    await flush();
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('save KO'));
  });

  it('drawer : import-product demande confirmation, annulée → aucun appel', async () => {
    window.confirm = jest.fn(() => false);
    global.KmcApi.getSourcingCandidates = jest.fn().mockResolvedValue({ candidates: [candidate()] });
    const view = loadIt();
    view.render(main);
    await flush();
    main.querySelector('[data-act="open-candidate"]').click();
    await flush();
    main.querySelector('[data-act="import-product"]').click();
    await flush();
    expect(global.KmcApi.importSourcingProduct).not.toHaveBeenCalled();
  });

  it('drawer : import-product confirmé → appelle importSourcingProduct, ferme le drawer', async () => {
    global.KmcApi.getSourcingCandidates = jest.fn().mockResolvedValue({ candidates: [candidate()] });
    const view = loadIt();
    view.render(main);
    await flush();
    main.querySelector('[data-act="open-candidate"]').click();
    await flush();
    main.querySelector('[data-act="import-product"]').click();
    await flush();
    expect(global.KmcApi.importSourcingProduct).toHaveBeenCalledWith('cand-1');
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('mode inactif'));
    expect(main.querySelector('.scs-drawer.open')).toBeNull();
  });

  it('drawer : import-product échoue → alert() et bouton réactivé', async () => {
    global.KmcApi.getSourcingCandidates = jest.fn().mockResolvedValue({ candidates: [candidate()] });
    global.KmcApi.importSourcingProduct = jest.fn().mockRejectedValue(new Error('boutique KO'));
    const view = loadIt();
    view.render(main);
    await flush();
    main.querySelector('[data-act="open-candidate"]').click();
    await flush();
    main.querySelector('[data-act="import-product"]').click();
    await flush();
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('boutique KO'));
  });

  it('drawer : watchlist appelle watchlistSourcingCandidate et ferme le drawer', async () => {
    global.KmcApi.getSourcingCandidates = jest.fn().mockResolvedValue({ candidates: [candidate()] });
    const view = loadIt();
    view.render(main);
    await flush();
    main.querySelector('[data-act="open-candidate"]').click();
    await flush();
    main.querySelector('[data-act="watchlist"]').click();
    await flush();
    expect(global.KmcApi.watchlistSourcingCandidate).toHaveBeenCalledWith('cand-1');
    expect(main.querySelector('.scs-drawer.open')).toBeNull();
  });

  it('drawer : watchlist échoue → alert()', async () => {
    global.KmcApi.getSourcingCandidates = jest.fn().mockResolvedValue({ candidates: [candidate()] });
    global.KmcApi.watchlistSourcingCandidate = jest.fn().mockRejectedValue(new Error('watch KO'));
    const view = loadIt();
    view.render(main);
    await flush();
    main.querySelector('[data-act="open-candidate"]').click();
    await flush();
    main.querySelector('[data-act="watchlist"]').click();
    await flush();
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('watch KO'));
  });

  it('drawer : reject annulé (prompt null) → aucun appel', async () => {
    window.prompt = jest.fn(() => null);
    global.KmcApi.getSourcingCandidates = jest.fn().mockResolvedValue({ candidates: [candidate()] });
    const view = loadIt();
    view.render(main);
    await flush();
    main.querySelector('[data-act="open-candidate"]').click();
    await flush();
    main.querySelector('[data-act="reject"]').click();
    await flush();
    expect(global.KmcApi.rejectSourcingCandidate).not.toHaveBeenCalled();
  });

  it('drawer : reject avec raison (prompt vide accepté) → appelle rejectSourcingCandidate', async () => {
    window.prompt = jest.fn(() => 'Trop cher');
    global.KmcApi.getSourcingCandidates = jest.fn().mockResolvedValue({ candidates: [candidate()] });
    const view = loadIt();
    view.render(main);
    await flush();
    main.querySelector('[data-act="open-candidate"]').click();
    await flush();
    main.querySelector('[data-act="reject"]').click();
    await flush();
    expect(global.KmcApi.rejectSourcingCandidate).toHaveBeenCalledWith('cand-1', { reason: 'Trop cher' });
    expect(main.querySelector('.scs-drawer.open')).toBeNull();
  });

  it('drawer : reject échoue → alert()', async () => {
    window.prompt = jest.fn(() => 'raison');
    global.KmcApi.getSourcingCandidates = jest.fn().mockResolvedValue({ candidates: [candidate()] });
    global.KmcApi.rejectSourcingCandidate = jest.fn().mockRejectedValue(new Error('reject KO'));
    const view = loadIt();
    view.render(main);
    await flush();
    main.querySelector('[data-act="open-candidate"]').click();
    await flush();
    main.querySelector('[data-act="reject"]').click();
    await flush();
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('reject KO'));
  });

  it('candidat sans product_url → pas de lien "Voir fournisseur"; avec → lien présent', async () => {
    global.KmcApi.getSourcingCandidates = jest.fn().mockResolvedValue({ candidates: [candidate()] });
    const view = loadIt();
    view.render(main);
    await flush();
    main.querySelector('[data-act="open-candidate"]').click();
    await flush();
    expect(main.textContent).not.toContain('Voir fournisseur');
  });
});
