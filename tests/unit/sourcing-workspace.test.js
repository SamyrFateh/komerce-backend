'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
const mockGetClient = jest.fn();
const mockPricingConfig = jest.fn();
const mockListSources = jest.fn();
const mockSetSourceActive = jest.fn();
const mockHandoffImportResult = jest.fn();

jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args), getClient: (...args) => mockGetClient(...args) }));
jest.mock('../../services/pricing-engine', () => ({loadGlobalConfig:(...args)=>mockPricingConfig(...args)}));
jest.mock('../../services/sourcing-analysis', () => ({ getSynthesis: jest.fn(), getAnalysis: jest.fn(), getPortfolioView: jest.fn() }));
jest.mock('../../services/sourcing-mutations', () => ({ updateProduct: jest.fn() }));
jest.mock('../../services/sourcing-candidate-actions', () => ({
  updateCandidate: jest.fn(), scanCandidate: jest.fn(), watchlistCandidate: jest.fn(),
  rejectCandidate: jest.fn(), promoteCandidate: jest.fn(),
  confirmCandidateBoutiqueCategory: jest.fn(),
  handoffImportResult: (...args) => mockHandoffImportResult(...args),
}));
jest.mock('../../services/sourcing-import-dispatch', () => ({ connectorCatalog: jest.fn(() => ({})), dispatchToConnector: jest.fn() }));
jest.mock('../../services/sourcing-source-autopilot', () => ({
  listSources: (...args) => mockListSources(...args),
  setSourceActive: (...args) => mockSetSourceActive(...args),
}));
jest.mock('../../services/suppliers/catalog-import-orchestrator', () => ({ importCatalog: jest.fn() }));
jest.mock('../../services/partner-admin-service', () => ({
  listPartners: jest.fn(), getStats: jest.fn(), createPartner: jest.fn(), updatePartner: jest.fn(),
}));

const workspace = require('../../services/sourcing-workspace');

beforeEach(() => {
  jest.clearAllMocks();
  mockListSources.mockResolvedValue([]);
  mockHandoffImportResult.mockImplementation(async (result) => result);
});

// PROD : la catégorie source canonique est la catégorie de calcul douanier,
// jamais une valeur libre ni une liste boutique recopiée dans le navigateur.
const config = {
  categories:{
    home:{key:'home',label:'Maison',is_active:true,classification_terms:{'waterproof key box':3}},
    jewelry:{key:'jewelry',label:'Bijoux',is_active:true,classification_terms:{ring:3}},
    inactive:{key:'inactive',label:'Inactif',is_active:false,classification_terms:{key:99}},
    default:{key:'default',label:'Par défaut',is_active:true},
  },
  boutique_customs_affinities:[],
};
const candidateRow = {
  candidate_ref:'KSC-000050',product_name:'Temporary Metal Waterproof Key Box At The Door',
  supplier_category:'Lock Box',komerce_category:'default',state:'watchlist',
};
test('suggestions dynamiques issues du classificateur existant, catégories inactives et default exclues', async () => {
  mockQuery.mockResolvedValueOnce({rows:[candidateRow]});
  mockPricingConfig.mockResolvedValueOnce(config);
  const choices=await workspace.getCandidateCategoryOptions('KSC-000050');
  expect(choices).toMatchObject({candidate_ref:'KSC-000050',current_category:null,source:'customs_categories'});
  expect(choices.categories.map(x=>x.key)).toEqual(['jewelry','home']);
  expect(choices.suggestions[0]).toMatchObject({key:'home',label:'Maison'});
  expect(choices.suggestions.every(x=>x.confidence==='low'||x.confidence==='medium'||x.confidence==='high')).toBe(true);
  expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('candidate_ref = $1'),['KSC-000050']);
});
test('une catégorie inventée est refusée avant toute écriture',async()=>{
  mockQuery.mockResolvedValueOnce({rows:[candidateRow]});
  mockPricingConfig.mockResolvedValueOnce(config);
  await expect(workspace.resolveCandidateCategory('KSC-000050','unknown',{id:'admin-1'}))
    .rejects.toMatchObject({status:400,code:'sourcing_category_invalid'});
  expect(mockGetClient).not.toHaveBeenCalled();
});
test('catégorie validée : UPDATE audité et scan dans UNE transaction ; aucune promotion automatique',async()=>{
  mockQuery.mockResolvedValueOnce({rows:[candidateRow]});
  mockPricingConfig.mockResolvedValueOnce(config);
  const client={query:jest.fn()
    .mockResolvedValueOnce({rows:[]})
    .mockResolvedValueOnce({rows:[{id:'secret-id',state:'watchlist',product_id:null}]})
    .mockResolvedValueOnce({rows:[]}),
    release:jest.fn()};
  mockGetClient.mockResolvedValueOnce(client);
  const actions=require('../../services/sourcing-candidate-actions');
  actions.updateCandidate.mockResolvedValueOnce({state:'watchlist'});
  actions.scanCandidate.mockResolvedValueOnce({state:'scanned',scan_result:{
    sourcing_decision:'TEST',reason:'Économiquement admissible',recommended_action:'Tester',
    variable_cost_complete_kmf:4250,minimum_safe_price_kmf:6500,
    test_price_kmf:7900,economic_test_health_status:'healthy',
  }});
  const result=await workspace.resolveCandidateCategory('KSC-000050','home',{id:'operator'});
  expect(result).toMatchObject({
    candidate_ref:'KSC-000050',category:{key:'home',label:'Maison'},
    state:'scanned',scan:{decision:'TEST',reason:'Économiquement admissible',
      economics:{variable_cost_complete_kmf:4250,minimum_safe_price_kmf:6500,
        test_price_kmf:7900,health_status:'healthy',market_price_decided:false}},
  });
  expect(result).not.toHaveProperty('id');
  expect(actions.updateCandidate).toHaveBeenCalledWith(
    'secret-id',{komerce_category:'home'},'operator',client);
  expect(actions.scanCandidate).toHaveBeenCalledWith('secret-id','operator',client);
  expect(client.query.mock.calls.map(args=>args[0])).toEqual([
    'BEGIN',expect.stringContaining('FOR UPDATE'),'COMMIT',
  ]);
  expect(client.release).toHaveBeenCalledTimes(1);
  expect(actions.promoteCandidate).not.toHaveBeenCalled();
});
test('échec de scan : transaction rollback, aucune correction partielle confirmée',async()=>{
  mockQuery.mockResolvedValueOnce({rows:[candidateRow]});
  mockPricingConfig.mockResolvedValueOnce(config);
  const client={query:jest.fn()
    .mockResolvedValueOnce({rows:[]})
    .mockResolvedValueOnce({rows:[{id:'secret-id',state:'watchlist',product_id:null}]})
    .mockResolvedValueOnce({rows:[]}),release:jest.fn()};
  mockGetClient.mockResolvedValueOnce(client);
  const actions=require('../../services/sourcing-candidate-actions');
  actions.updateCandidate.mockResolvedValueOnce({});
  actions.scanCandidate.mockRejectedValueOnce(new Error('scanner offline'));
  await expect(workspace.resolveCandidateCategory('KSC-000050','home',{id:'operator'}))
    .rejects.toThrow('scanner offline');
  expect(client.query.mock.calls.map(args=>args[0])).toEqual([
    'BEGIN',expect.stringContaining('FOR UPDATE'),'ROLLBACK',
  ]);
  expect(client.release).toHaveBeenCalledTimes(1);
});

test('product_ref est résolu côté serveur', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 'product-internal', product_ref: 'KPR-000001' }] });
  await expect(workspace.resolveProductRef('KPR-000001')).resolves.toEqual({ id: 'product-internal', product_ref: 'KPR-000001' });
  expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('product_ref = $1'), ['KPR-000001']);
});

test('candidate_ref est résolu côté serveur', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 'candidate-internal', candidate_ref: 'KSC-000001' }] });
  await expect(workspace.resolveCandidateRef('KSC-000001')).resolves.toEqual({ id: 'candidate-internal', candidate_ref: 'KSC-000001' });
});

test('partner_ref reste limité au type sourcing', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  await expect(workspace.resolvePartnerRef('KPT-000001')).rejects.toMatchObject({ code: 'sourcing_partner_not_found' });
  expect(mockQuery.mock.calls[0][0]).toContain("partner_type = 'sourcing'");
});

test('les identifiants internes sont retirés de toute projection', () => {
  const value = workspace.stripInternalIds({ id: 'a', product_id: 'b', keep: 1, nested: { partner_id: 'c', label: 'ok' } });
  expect(value).toEqual({ keep: 1, nested: { label: 'ok' } });
});

test('interrupteur source délègue à l’autorité autopilot avec premier passage quand ON', async () => {
  mockSetSourceActive.mockResolvedValue({ source_ref: 'api:cj', autopilot_enabled: true });
  await expect(workspace.setSourceAutopilot('api:cj', true))
    .resolves.toEqual({ source_ref: 'api:cj', autopilot_enabled: true });
  expect(mockSetSourceActive).toHaveBeenCalledWith('api:cj', true, { runNow: true });
});

test('interrupteur source OFF ne déclenche aucun premier passage', async () => {
  mockSetSourceActive.mockResolvedValue({ source_ref: 'api:cj', autopilot_enabled: false });
  await expect(workspace.setSourceAutopilot('api:cj', false))
    .resolves.toEqual({ source_ref: 'api:cj', autopilot_enabled: false });
  expect(mockSetSourceActive).toHaveBeenCalledWith('api:cj', false, { runNow: false });
});

test('un type partenaire hors sourcing est refusé avant écriture', async () => {
  await expect(workspace.createSupplier({ name: 'Relay', partner_type: 'relais' }))
    .rejects.toMatchObject({ code: 'sourcing_partner_type_forbidden' });
});

test('timed mesure la durée de chaque lecture pour Server-Timing', async () => {
  const timings = {};
  await expect(workspace.timed(timings, 'lecture', Promise.resolve('ok'))).resolves.toBe('ok');
  expect(typeof timings.lecture).toBe('number');
  await expect(workspace.timed(null, 'sans-mesure', Promise.resolve(1))).resolves.toBe(1);
});

// Frontière de responsabilité : après transmission, une ligne ne reste plus
// actionnable dans le Sourcing. Le produit continue en Raffinerie.
test('sourcing UI excludes candidates already handed off or rejected from its active queue', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const uiSource = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/sourcing-workspace.js'), 'utf8');
  expect(uiSource).toContain('context.focusCandidateRef');
  expect(uiSource).toContain('row.candidate_ref === context.focusCandidateRef');
  expect(uiSource).toContain(": !['imported_to_catalog', 'rejected'].includes(row.state)");
  expect(uiSource).toContain('Exceptions sourcing à traiter');
});

test('le chemin import manuel présente un formulaire sans dialogue prompt navigateur', () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/sourcing-workspace.js'), 'utf8');
  const importUi = source.slice(source.indexOf('function renderImports('), source.indexOf('function renderPortfolio('));
  expect(importUi).toContain("data-sourcing-manual-panel");
  expect(importUi).toContain("source_type: 'manual'");
  expect(importUi).toContain("source_type: 'csv'");
  expect(importUi).not.toContain('context.prompt(');
});

describe('L7 — montage du workspace candidats : erreur, délai, diagnostic', () => {
  const ui = require('../../public/dashboards/canonical/js/sourcing-workspace.js');
  function fakeDoc() {
    const make = () => ({ children: [], attrs: {}, textContent: '', className: '',
      appendChild(c) { this.children.push(c); return c; }, replaceChildren() { this.children = []; },
      setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {} });
    return { createElement: make, root: make() };
  }
  const fullText = n => [n.textContent, ...n.children.map(fullText)].join(' ');

  test('erreur API → message d’erreur affiché, pas de chargement infini', async () => {
    const d = fakeDoc();
    const fetch = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({ error: 'Service indisponible' }) }));
    await expect(ui.mount({ root: d.root, document: d, fetch, ui: {} })).rejects.toThrow('Service indisponible');
    expect(fullText(d.root)).toContain('Accès Sourcing indisponible');
    expect(fullText(d.root)).toContain('Service indisponible');
  });

  test('délai d’attente → message explicite', async () => {
    jest.useFakeTimers();
    try {
      const d = fakeDoc();
      const fetch = jest.fn((url, opts) => new Promise((_, reject) => {
        opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }));
      const pending = ui.mount({ root: d.root, document: d, fetch, ui: {} });
      const assertion = expect(pending).rejects.toThrow('prend trop de temps');
      await jest.advanceTimersByTimeAsync(20001);
      await assertion;
      expect(fullText(d.root)).toContain('prend trop de temps');
    } finally { jest.useRealTimers(); }
  });

  test('la santé n’est demandée qu’en mode diagnostic', async () => {
    const urls = [];
    const fetch = jest.fn(async url => { urls.push(url); throw new Error('stop'); });
    const d = fakeDoc();
    await ui.mount({ root: d.root, document: d, fetch, ui: {}, locationSearch: '' }).catch(() => {});
    await ui.mount({ root: d.root, document: d, fetch, ui: {}, locationSearch: '?diagnostic=1' }).catch(() => {});
    expect(urls).toEqual(['/api/admin/workspaces/sourcing', '/api/admin/workspaces/sourcing?include=health']);
  });
});

test('boutique options return only active commercial pairs and confirmed proposal',async()=>{
  const row={candidate_ref:'KSC-000050',supplier_name:'AliExpress',
    supplier_category:'Phones & Telecommunications > Phone Case',
    product_name:'Phone Case',state:'watchlist',
    commercial_taxonomy_review:{status:'CONFIRMED',category:'Tech',subcategory:'Phones'}};
  mockQuery.mockResolvedValueOnce({rows:[row]}).mockResolvedValueOnce({rows:[
    {category:'Tech',category_label:'Tech',subcategory:'Phones',subcategory_label:'Téléphones'},
    {category:'Maison',category_label:'Maison',subcategory:'Salon',subcategory_label:'Salon'},
  ]});
  const result=await workspace.getCandidateBoutiqueCategoryOptions('KSC-000050');
  expect(result.source).toBe('boutique_categories');
  expect(result.suggestions[0]).toMatchObject({category:'Tech',subcategory:'Phones',confidence:'confirmed'});
  expect(result).not.toHaveProperty('customs');
  expect(mockPricingConfig).not.toHaveBeenCalled();
});

test('workspace delegates the commercial confirmation to its Sourcing mutation owner',async()=>{
  const actions=require('../../services/sourcing-candidate-actions');
  actions.confirmCandidateBoutiqueCategory.mockResolvedValueOnce({
    candidate_ref:'KSC-000051', confirmed:true,draft_created:false,
  });
  const result=await workspace.confirmCandidateBoutiqueCategory('KSC-000051',
    {category:'Tech',subcategory:'Phones'},{id:'operator'});
  expect(result).toMatchObject({confirmed:true});
  expect(actions.confirmCandidateBoutiqueCategory).toHaveBeenCalledWith(
    'KSC-000051',{category:'Tech',subcategory:'Phones'},'operator');
  expect(mockGetClient).not.toHaveBeenCalled();
});

test('deep link Sourcing : candidate_ref ciblé transporte la référence métier', async () => {
  const ui = require('../../public/dashboards/canonical/js/sourcing-workspace.js');
  const doc = {
    createElement: () => ({
      children: [], textContent: '', className: '',
      appendChild(child) { this.children.push(child); return child; },
      replaceChildren(...children) { this.children = [...children]; },
      setAttribute() {}, addEventListener() {},
    }),
  };
  const urls = [];
  const fetch = jest.fn(async url => { urls.push(url); throw new Error('controlled_stop'); });
  await expect(ui.mount({
    root: doc.createElement('div'), document: doc, ui: {}, fetch,
    locationSearch: '?candidate_ref=KSC-000987',
  })).rejects.toThrow('controlled_stop');
  expect(urls).toEqual(['/api/admin/workspaces/sourcing?candidate_ref=KSC-000987']);
});

test('candidat ciblé : lecture priorisée et bornée', () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '../../services/sourcing-workspace.js'), 'utf8');
  expect(source).toContain('CASE WHEN sc.candidate_ref = $1 THEN 0 ELSE 1 END');
  expect(source).toContain('listCandidates(candidateRef)');
  expect(source).toContain('LIMIT 250');
});
