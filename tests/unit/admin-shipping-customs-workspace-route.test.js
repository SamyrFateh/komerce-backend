'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

let mockGlobalAllowed = false;
let mockUserRole = 'admin';

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = {
      id: `${mockUserRole}-1`,
      role: mockUserRole,
      full_name: `${mockUserRole} Test`,
      email: `${mockUserRole}@example.test`,
    };
    next();
  },
  requireRole: roles => (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Rôle interdit', code: 'role_forbidden' });
    }
    return next();
  },
}));

jest.mock('../../middleware/require-dashboard-global-authority', () => ({
  hasDashboardGlobalAuthority: jest.fn(async () => mockGlobalAllowed),
}));

// MARKET-DELEGATION LOT B (audit logistics.read, migration 251) : GET
// /market/:marketCode est désormais gated, pour market_operator, par
// resolveAuthorization(..., requiredCapability: 'logistics.read'), plus
// seulement par operator_market_scopes. mockGrantedMarketCodes simule la
// détention réelle de la capability déléguée (distincte du scope legacy
// simulé plus haut).
let mockGrantedMarketCodes = new Set(['CM']);
let mockTransitMarketCodes = new Set(['CM']);
const mockResolveAuthorization = jest.fn();
jest.mock('../../services/market-delegation-service', () => ({
  resolveAuthorization: (...args) => mockResolveAuthorization(...args),
  audit: jest.fn(async () => undefined),
}));

const mockBuildWorkspace = jest.fn();
const mockConfirmTransit = jest.fn();
const mockCreateCustomsShipment = jest.fn();
const mockUpdateCustomsShipment = jest.fn();
const mockDeclareCustomsShipment = jest.fn();
const mockDeactivateCustomsShipment = jest.fn();
const mockActivateCustomsShipment = jest.fn();

jest.mock('../../services/shipping-customs-workspace', () => {
  class ShippingCustomsWorkspaceError extends Error {
    constructor(code, message, status = 400) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  return {
    ShippingCustomsWorkspaceError,
    buildWorkspace: (...args) => mockBuildWorkspace(...args),
    confirmTransit: (...args) => mockConfirmTransit(...args),
    createCustomsShipment: (...args) => mockCreateCustomsShipment(...args),
    updateCustomsShipment: (...args) => mockUpdateCustomsShipment(...args),
    declareCustomsShipment: (...args) => mockDeclareCustomsShipment(...args),
    deactivateCustomsShipment: (...args) => mockDeactivateCustomsShipment(...args),
    activateCustomsShipment: (...args) => mockActivateCustomsShipment(...args),
  };
});

const mockInternationalN1=jest.fn();
jest.mock('../../services/international-n1-reconciliation',()=>({
  ReconciliationError:class ReconciliationError extends Error{
    constructor(code,message,status=409){super(message);this.code=code;this.status=status;}
  },
  reconcile:(...args)=>mockInternationalN1(...args),
}));
// International transport stages remain separate from customs writes.
const mockJourneyList=jest.fn(),mockJourneyDetail=jest.fn(),mockJourneyDeclareCustoms=jest.fn();
const mockJourneyTransition=jest.fn(),mockJourneyTracking=jest.fn();
const mockJourneyFreight=jest.fn(),mockJourneyCustoms=jest.fn(),mockJourneyCost=jest.fn();
jest.mock('../../services/international-shipment-journey',()=>({
  JourneyError:class JourneyError extends Error{
    constructor(status,code,message){super(message);this.status=status;this.code=code;}
  },
  list:(...args)=>mockJourneyList(...args),
  detail:(...args)=>mockJourneyDetail(...args),
  declareCustoms:(...args)=>mockJourneyDeclareCustoms(...args),
  transition:(...args)=>mockJourneyTransition(...args),
  updateTracking:(...args)=>mockJourneyTracking(...args),
  recordFreight:(...args)=>mockJourneyFreight(...args),
  linkCustoms:(...args)=>mockJourneyCustoms(...args),
  recordCost:(...args)=>mockJourneyCost(...args),
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../db', () => ({
  query: jest.fn(async (sql, params) => {
    if (String(sql).includes('FROM markets')) {
      const code = params[0];
      const ids = { CM: 'market-cm-id', CG: 'market-cg-id' };
      return {
        rows: ids[code] ? [{ id: ids[code], code, name: `Market ${code}`, currency: 'XAF' }] : [],
      };
    }
    return { rows: [] };
  }),
}));

const express = require('express');
const request = require('supertest');
const router = require('../../routes/admin-shipping-customs-workspace');

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/admin/workspaces/shipping-customs', router);
  return instance;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGlobalAllowed = false;
  mockUserRole = 'admin';
  mockGrantedMarketCodes = new Set(['CM']);
  mockTransitMarketCodes = new Set(['CM']);
  mockResolveAuthorization.mockImplementation(async (_db, { marketCode, requiredCapability }) => {
    const allowed = requiredCapability === 'logistics.read'
      ? mockGrantedMarketCodes.has(marketCode)
      : requiredCapability === 'execution.transit.confirm'
        ? mockTransitMarketCodes.has(marketCode)
        : false;
    if (allowed) {
      const marketId = marketCode === 'CM' ? 'market-cm-id' : marketCode === 'CG' ? 'market-cg-id' : `market-${marketCode}-id`;
      return { market_id: marketId, market_code: marketCode, assignment_id: 'assignment-1', membership_id: 'membership-1' };
    }
    const error = new Error(`Capability ${requiredCapability} requise ou absente du ceiling actif.`);
    error.code = 'MARKET_CAPABILITY_REQUIRED';
    error.status = 403;
    throw error;
  });
  mockBuildWorkspace.mockResolvedValue({
    scope: { code: 'CM', name: 'Market CM', currency: 'XAF' },
    summary: {},
    transit: { ready: [], in_transit: [], history: [] },
    customs: { shipments: [], candidates: [] },
  });
  mockConfirmTransit.mockResolvedValue({ parcel_ref: 'PCL-CM-001', status: 'in_transit' });
  mockInternationalN1.mockResolvedValue({status:'partial',documented_total_kmf:'12000.00',allocation_rows:0});
  mockJourneyList.mockResolvedValue([]);
  mockJourneyDetail.mockResolvedValue({shipment:{reference:'INT-CM-001'},events:[],charges:[],parcels:[]});
  mockJourneyDeclareCustoms.mockResolvedValue({amount_kmf:'0',customs_status:'declared'});
  mockJourneyTransition.mockResolvedValue({stage:'in_transit'});
  mockJourneyTracking.mockResolvedValue({tracking_reference:'BOL-001'});
  mockJourneyFreight.mockResolvedValue({amount_kmf:'12000'});
  mockJourneyCustoms.mockResolvedValue({customs_reference:'CUS-001'});
  mockJourneyCost.mockResolvedValue({cost_id:'cost-1'});

  mockCreateCustomsShipment.mockResolvedValue({ shipment: { reference: 'CUS-CM-001' } });
  mockUpdateCustomsShipment.mockResolvedValue({ shipment: { reference: 'CUS-CM-001' } });
  mockDeclareCustomsShipment.mockResolvedValue({ status: 'declared' });
  mockDeactivateCustomsShipment.mockResolvedValue({ reference: 'CUS-CM-001', is_active: false });
  mockActivateCustomsShipment.mockResolvedValue({ reference: 'CUS-CM-001', is_active: true });
});

test.each(['admin', 'agent_hub', 'agent_transitaire', 'market_operator'])('%s peut lire le Workspace de son marché', async role => {
  mockUserRole = role;
  const res = await request(app()).get('/api/admin/workspaces/shipping-customs/market/CM');
  expect(res.status).toBe(200);
  expect(mockBuildWorkspace).toHaveBeenCalledWith({
    market: expect.objectContaining({ id: 'market-cm-id', code: 'CM' }),
  });
});

test('market_operator lit son flux mais ne reçoit aucun geste transit/douane spécialisé', async () => {
  mockUserRole = 'market_operator';
  const transit = await request(app())
    .post('/api/admin/workspaces/shipping-customs/market/CM/parcels/PCL-CM-001/confirm-transit')
    .send({});
  const customs = await request(app())
    .post('/api/admin/workspaces/shipping-customs/market/CM/customs/shipments')
    .send({ reference: 'CUS-CM-001', shipment_date: '2026-08-26', cif_value_kmf: 100000 });

  expect(transit.status).toBe(403);
  expect(customs.status).toBe(403);
  expect(mockConfirmTransit).not.toHaveBeenCalled();
  expect(mockCreateCustomsShipment).not.toHaveBeenCalled();
});

test('acteur sans logistics.read sur CG ne peut pas ouvrir CG', async () => {
  const res = await request(app()).get('/api/admin/workspaces/shipping-customs/market/CG');
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('MARKET_CAPABILITY_REQUIRED');
  expect(mockBuildWorkspace).not.toHaveBeenCalled();
});

test('market_operator avec logistics.read sur CM lit le Workspace (capability exacte)', async () => {
  mockUserRole = 'market_operator';
  mockGrantedMarketCodes = new Set(['CM']);

  const res = await request(app()).get('/api/admin/workspaces/shipping-customs/market/CM');

  expect(res.status).toBe(200);
  expect(mockBuildWorkspace).toHaveBeenCalledWith(expect.objectContaining({
    market: expect.objectContaining({ id: 'market-cm-id', code: 'CM' }),
  }));
  expect(mockResolveAuthorization).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    marketCode: 'CM',
    requiredCapability: 'logistics.read',
  }));
});

test('révocation de logistics.read retire l’accès market_operator', async () => {
  mockUserRole = 'market_operator';
  mockGrantedMarketCodes = new Set();

  const res = await request(app()).get('/api/admin/workspaces/shipping-customs/market/CM');

  expect(res.status).toBe(403);
  expect(res.body.code).toBe('MARKET_CAPABILITY_REQUIRED');
  expect(mockBuildWorkspace).not.toHaveBeenCalled();
});

test('autorité centrale explicite court-circuite la capability marché', async () => {
  mockGrantedMarketCodes = new Set();
  mockGlobalAllowed = true;
  mockUserRole = 'agent_hub';

  const res = await request(app()).get('/api/admin/workspaces/shipping-customs/market/CM');

  expect(res.status).toBe(200);
  expect(mockBuildWorkspace).toHaveBeenCalled();
  expect(mockResolveAuthorization).not.toHaveBeenCalled();
});

test('autorité globale explicite peut entrer dans CG seulement après sélection explicite', async () => {
  mockGlobalAllowed = true;
  const res = await request(app()).get('/api/admin/workspaces/shipping-customs/market/CG');
  expect(res.status).toBe(200);
  expect(mockBuildWorkspace).toHaveBeenCalledWith({
    market: expect.objectContaining({ id: 'market-cg-id', code: 'CG' }),
  });
});

test('market_id client est rejeté avant lecture ou mutation', async () => {
  const read = await request(app()).get('/api/admin/workspaces/shipping-customs/market/CM?market_id=market-cg-id');
  const write = await request(app())
    .post('/api/admin/workspaces/shipping-customs/market/CM/parcels/PCL-CM-001/confirm-transit')
    .send({ marketId: 'market-cg-id' });

  expect(read.status).toBe(400);
  expect(write.status).toBe(400);
  expect(read.body.code).toBe('client_market_id_forbidden');
  expect(write.body.code).toBe('client_market_id_forbidden');
  expect(mockConfirmTransit).not.toHaveBeenCalled();
});

test('agent_transitaire confirme le transit seulement avec execution.transit.confirm sur ce marché', async () => {
  mockUserRole = 'agent_transitaire';
  const res = await request(app())
    .post('/api/admin/workspaces/shipping-customs/market/CM/parcels/PCL-CM-001/confirm-transit')
    .send({ notes: 'Départ confirmé' });

  expect(res.status).toBe(200);
  expect(mockResolveAuthorization).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    marketCode: 'CM',
    requiredCapability: 'execution.transit.confirm',
  }));
  expect(mockConfirmTransit).toHaveBeenCalledWith(
    'PCL-CM-001',
    expect.objectContaining({ id: 'market-cm-id', code: 'CM' }),
    expect.objectContaining({ id: 'agent_transitaire-1', role: 'agent_transitaire' }),
    'Départ confirmé'
  );
});

test('agent_transitaire CM est refusé sur CG en lecture et en transit', async () => {
  mockUserRole = 'agent_transitaire';
  mockGrantedMarketCodes = new Set(['CM']);
  mockTransitMarketCodes = new Set(['CM']);

  const read = await request(app()).get('/api/admin/workspaces/shipping-customs/market/CG');
  const transit = await request(app())
    .post('/api/admin/workspaces/shipping-customs/market/CG/parcels/PCL-CG-001/confirm-transit')
    .send({});

  expect(read.status).toBe(403);
  expect(transit.status).toBe(403);
  expect(mockBuildWorkspace).not.toHaveBeenCalled();
  expect(mockConfirmTransit).not.toHaveBeenCalled();
});

test('agent_hub conserve le transit historique mais ne peut pas écrire la douane', async () => {
  mockUserRole = 'agent_hub';
  const transit = await request(app())
    .post('/api/admin/workspaces/shipping-customs/market/CM/parcels/PCL-CM-001/confirm-transit')
    .send({});
  const customs = await request(app())
    .post('/api/admin/workspaces/shipping-customs/market/CM/customs/shipments')
    .send({ reference: 'CUS-CM-001', shipment_date: '2026-08-26', cif_value_kmf: 100000 });

  expect(transit.status).toBe(200);
  expect(customs.status).toBe(403);
  expect(mockConfirmTransit).toHaveBeenCalledTimes(1);
  expect(mockCreateCustomsShipment).not.toHaveBeenCalled();
});

test('admin crée la douane avec parcel_refs sans identifiant marché client', async () => {
  const body = {
    reference: 'CUS-CM-001',
    shipment_date: '2026-08-26',
    cif_value_kmf: 100000,
    parcel_refs: ['PCL-CM-001'],
  };
  const res = await request(app())
    .post('/api/admin/workspaces/shipping-customs/market/CM/customs/shipments')
    .send(body);

  expect(res.status).toBe(201);
  expect(mockCreateCustomsShipment).toHaveBeenCalledWith(
    body,
    expect.objectContaining({ id: 'market-cm-id', code: 'CM' }),
    expect.objectContaining({ id: 'admin-1', role: 'admin' })
  );
});

// DOUANE-2A: audit actor must be wired by the authenticated mutation boundary.
describe('DOUANE-2A actor audit wiring: routes/admin-shipping-customs-workspace.js', () => {
  test('keeps authenticated actor propagation explicit', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../../routes/admin-shipping-customs-workspace.js'), 'utf8');
    expect(src).toMatch(/updateCustomsShipment\([\s\S]*?actionActor\(req\)/);
  });
});

describe('Chaîne internationale réelle — autorité marché et gestes séparés',()=>{
  const base='/api/admin/workspaces/shipping-customs/market/CM/international';
  test('responsable pays lit dossiers et preuves mais ne les modifie pas',async()=>{
    mockUserRole='market_operator';
    expect((await request(app()).get(base)).status).toBe(200);
    expect(mockJourneyList).toHaveBeenCalledWith(expect.objectContaining({code:'CM'}));
    expect((await request(app()).get(base+'/INT-CM-001')).status).toBe(200);
    expect((await request(app()).post(base+'/INT-CM-001/customs-amount').send({amount_kmf:5})).status).toBe(403);
    expect((await request(app()).post(base+'/INT-CM-001/freight').send({amount_kmf:2})).status).toBe(403);
    expect(mockJourneyDeclareCustoms).not.toHaveBeenCalled();
  });
  test('agent transitaire peut confirmer un transit avec capability mais jamais saisir un coût',async()=>{
    mockUserRole='agent_transitaire';
    const ok=await request(app()).post(base+'/INT-CM-001/transition').send({
      to_stage:'in_transit',proof_ref:'BL-1',
    });
    expect(ok.status).toBe(200);
    expect(mockJourneyTransition).toHaveBeenCalledWith(
      expect.objectContaining({code:'CM'}),expect.objectContaining({role:'agent_transitaire'}),
      'INT-CM-001',expect.objectContaining({proof_ref:'BL-1'})
    );
    expect((await request(app()).post(base+'/INT-CM-001/costs').send({amount_kmf:5})).status).toBe(403);
    expect((await request(app()).post(base+'/INT-CM-001/freight').send({amount_kmf:5})).status).toBe(403);
  });
  test('transitaire hors marché ou sans capability ne confirme aucun mouvement',async()=>{
    mockUserRole='agent_transitaire';
    mockTransitMarketCodes=new Set();
    expect((await request(app()).post(base+'/INT-CM-001/transition').send({proof_ref:'BL-1'})).status).toBe(403);
    expect(mockJourneyTransition).not.toHaveBeenCalled();
    expect((await request(app()).post(base.replace('/CM/','/CG/')+'/INT-CG-001/transition').send({proof_ref:'BL-2'})).status).toBe(403);
  });
  test('admin enregistre fret, droits et frais uniquement dans le marché résolu',async()=>{
    mockUserRole='admin';mockGlobalAllowed=true;
    expect((await request(app()).post(base+'/INT-CM-001/freight').send({invoice_ref:'FR-001',amount_kmf:12000})).status).toBe(200);
    expect((await request(app()).post(base+'/INT-CM-001/costs').send({fee_type:'handling',amount_kmf:50})).status).toBe(201);
    expect((await request(app()).post(base+'/INT-CM-001/link-customs').send({customs_reference:'CUS-001'})).status).toBe(200);
    expect((await request(app()).post(base+'/INT-CM-001/customs-amount').send({amount_kmf:'0',proof_ref:'DECL-1'})).status).toBe(200);
    expect(mockJourneyDeclareCustoms).toHaveBeenCalled();
    expect((await request(app()).post(base+'/INT-CM-001/customs-amount').send({market_id:'fake'})).status).toBe(400);
  });
});

test('shipment financial reconciliation is Admin-only and market-scoped',async()=>{
  const url='/api/admin/workspaces/shipping-customs/market/CM/international/INT-CM-001/reconcile-costs';
  mockUserRole='market_operator';
  expect((await request(app()).post(url).send({})).status).toBe(403);
  expect(mockInternationalN1).not.toHaveBeenCalled();
  mockUserRole='admin';mockGlobalAllowed=true;
  expect((await request(app()).post(url).send({})).status).toBe(200);
  expect(mockInternationalN1).toHaveBeenCalledWith(
    expect.objectContaining({id:'market-cm-id'}),expect.objectContaining({role:'admin'}),'INT-CM-001',undefined,{});
});
