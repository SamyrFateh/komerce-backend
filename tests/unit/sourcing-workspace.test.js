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
  }});
  const result=await workspace.resolveCandidateCategory('KSC-000050','home',{id:'operator'});
  expect(result).toMatchObject({
    candidate_ref:'KSC-000050',category:{key:'home',label:'Maison'},
    state:'scanned',scan:{decision:'TEST',reason:'Économiquement admissible'},
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
  expect(uiSource).toContain(".filter(row => !['imported_to_catalog', 'rejected'].includes(row.state))");
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

describe('confirmCommercialTaxonomy', () => {
  test('refuses absent category without database writes', async () => {
    const {confirmCommercialTaxonomy}=require('../../services/sourcing-workspace');
    await expect(confirmCommercialTaxonomy('KSC-000128','','Accessoires',{id:'admin'}))
      .rejects.toMatchObject({status:400,code:'commercial_taxonomy_required'});
    expect(mockGetClient).not.toHaveBeenCalled();
  });

  test('confirms an active boutique pair without changing customs or running scanner', async () => {
    const {confirmCommercialTaxonomy}=require('../../services/sourcing-workspace');
    const client={query:jest.fn()
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[{id:'candidate-1',state:'scanned',product_id:null}]})
      .mockResolvedValueOnce({rows:[{category:'Auto',subcategory:'Accessoires'}]})
      .mockResolvedValueOnce({rowCount:1})
      .mockResolvedValueOnce({rowCount:1})
      .mockResolvedValueOnce({rows:[]}),release:jest.fn()};
    mockGetClient.mockResolvedValueOnce(client);
    const result=await confirmCommercialTaxonomy('KSC-000128','Auto','Accessoires',{id:'admin'});
    expect(result.commercial_review.status).toBe('CONFIRMED');
    expect(result.customs_unchanged).toBe(true);
    expect(result.publication_authorized).toBe(false);
    expect(client.query.mock.calls.map(c=>c[0]).join(' ')).not.toContain('komerce_category');
    expect(client.query.mock.calls.map(c=>c[0]).join(' ')).not.toContain('scanCandidate');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });
});
