'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

let mockAllowedMarkets = new Set(['market-cm-id']);
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

jest.mock('../../middleware/require-market-scope', () => ({
  attachAuthorizedMarkets: (req, res, next) => {
    req.authorizedMarkets = new Set(mockAllowedMarkets);
    next();
  },
  requireMarketScope: getTarget => (req, res, next) => {
    const target = getTarget(req);
    if (!req.authorizedMarkets || !req.authorizedMarkets.has(target)) {
      return res.status(403).json({ error: 'Marché hors périmètre', code: 'market_scope_denied' });
    }
    return next();
  },
}));

jest.mock('../../middleware/require-dashboard-global-authority', () => ({
  hasDashboardGlobalAuthority: jest.fn(async () => mockGlobalAllowed),
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
  mockAllowedMarkets = new Set(['market-cm-id']);
  mockGlobalAllowed = false;
  mockUserRole = 'admin';
  mockBuildWorkspace.mockResolvedValue({
    scope: { code: 'CM', name: 'Market CM', currency: 'XAF' },
    summary: {},
    transit: { ready: [], in_transit: [], history: [] },
    customs: { shipments: [], candidates: [] },
  });
  mockConfirmTransit.mockResolvedValue({ parcel_ref: 'PCL-CM-001', status: 'in_transit' });
  mockCreateCustomsShipment.mockResolvedValue({ shipment: { reference: 'CUS-CM-001' } });
  mockUpdateCustomsShipment.mockResolvedValue({ shipment: { reference: 'CUS-CM-001' } });
  mockDeclareCustomsShipment.mockResolvedValue({ status: 'declared' });
  mockDeactivateCustomsShipment.mockResolvedValue({ reference: 'CUS-CM-001', is_active: false });
  mockActivateCustomsShipment.mockResolvedValue({ reference: 'CUS-CM-001', is_active: true });
});

test.each(['admin', 'agent_hub', 'agent_transitaire'])('%s peut lire le Workspace de son marché', async role => {
  mockUserRole = role;
  const res = await request(app()).get('/api/admin/workspaces/shipping-customs/market/CM');
  expect(res.status).toBe(200);
  expect(mockBuildWorkspace).toHaveBeenCalledWith({
    market: expect.objectContaining({ id: 'market-cm-id', code: 'CM' }),
  });
});

test('opérateur CM ne peut pas ouvrir CG', async () => {
  const res = await request(app()).get('/api/admin/workspaces/shipping-customs/market/CG');
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('market_scope_denied');
  expect(mockBuildWorkspace).not.toHaveBeenCalled();
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

test('agent_transitaire confirme le transit avec la référence métier et le marché serveur', async () => {
  mockUserRole = 'agent_transitaire';
  const res = await request(app())
    .post('/api/admin/workspaces/shipping-customs/market/CM/parcels/PCL-CM-001/confirm-transit')
    .send({ notes: 'Départ confirmé' });

  expect(res.status).toBe(200);
  expect(mockConfirmTransit).toHaveBeenCalledWith(
    'PCL-CM-001',
    expect.objectContaining({ id: 'market-cm-id', code: 'CM' }),
    expect.objectContaining({ id: 'agent_transitaire-1', role: 'agent_transitaire' }),
    'Départ confirmé'
  );
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
