'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const express = require('express');
const request = require('supertest');

let mockUser = { id: 'operator-1', role: 'market_operator' };
let readMarkets = new Set(['market-cm']);
let manageMarkets = new Set(['market-cm']);

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = mockUser; next(); },
  requireRole: roles => (req, res, next) => roles.includes(req.user.role)
    ? next()
    : res.status(403).json({ code: 'role_forbidden' }),
}));

jest.mock('../../middleware/require-market-delegated-role', () => ({
  attachMarketDelegatedRoleFor: () => (req, res, next) => next(),
}));

jest.mock('../../middleware/require-market-delegated-capability', () => ({
  attachAuthorizedMarketsForCapability: capability => (req, res, next) => {
    const markets = capability === 'partners.manage' ? manageMarkets : readMarkets;
    if (!markets.size) return res.status(403).json({ code: 'MARKET_CAPABILITY_REQUIRED' });
    req.authorizedMarkets = new Set(markets);
    next();
  },
}));

jest.mock('../../middleware/validate', () => ({
  validate: () => (req, res, next) => next(),
}));
jest.mock('../../validators', () => ({
  admin: { createPartner: {}, updatePartner: {}, deletePartner: {} },
}));

const mockDbQuery = jest.fn(async (sql, params) => {
  if (/SELECT code FROM markets WHERE id = ANY/.test(sql)) {
    const ids = params[0] || [];
    return { rows: ids.map(id => ({ code: id === 'market-km' ? 'KM' : 'CM' })) };
  }
  if (/SELECT id FROM markets WHERE code = \$1/.test(sql)) {
    return { rows: params[0] === 'KM' ? [{ id: 'market-km' }] : params[0] === 'CM' ? [{ id: 'market-cm' }] : [] };
  }
  return { rows: [] };
});
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));

const mockPartnerAdmin = {
  PartnerAdminError: class PartnerAdminError extends Error {},
  listPartners: jest.fn(async () => [{ id: 'p1', country_code: 'CM' }]),
  getStats: jest.fn(async () => []),
  getPartner: jest.fn(async () => ({ partner: { id: 'p1', country_code: 'CM' }, stats: null })),
  createPartner: jest.fn(async body => ({ id: 'p1', ...body })),
  updatePartner: jest.fn(async (id, body) => ({ id, ...body })),
  deletePartner: jest.fn(async id => ({ deleted: true, id })),
};
jest.mock('../../services/partner-admin-service', () => mockPartnerAdmin);

const router = require('../../routes/admin/partners');

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/admin', router);
  return instance;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'operator-1', role: 'market_operator' };
  readMarkets = new Set(['market-cm']);
  manageMarkets = new Set(['market-cm']);
});

test('partners.read borne la liste aux pays autorisés', async () => {
  const res = await request(app()).get('/api/admin/partners');
  expect(res.status).toBe(200);
  expect(mockPartnerAdmin.listPartners).toHaveBeenCalledWith(expect.objectContaining({ countryIn: ['CM'] }));
});

test('country demandé hors partners.read ne fuit aucune donnée', async () => {
  const res = await request(app()).get('/api/admin/partners?country=KM');
  expect(res.status).toBe(200);
  expect(res.body).toEqual([]);
  expect(mockPartnerAdmin.listPartners).not.toHaveBeenCalled();
});

test('absence de partners.manage ferme une mutation avant le service', async () => {
  manageMarkets = new Set();
  const res = await request(app()).post('/api/admin/partners').send({ name: 'X', partner_type: 'supplier', country_code: 'CM' });
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('MARKET_CAPABILITY_REQUIRED');
  expect(mockPartnerAdmin.createPartner).not.toHaveBeenCalled();
});

test('partners.manage autorise une création sur son marché', async () => {
  const res = await request(app()).post('/api/admin/partners').send({ name: 'X', partner_type: 'supplier', country_code: 'CM' });
  expect(res.status).toBe(201);
  expect(mockPartnerAdmin.createPartner).toHaveBeenCalled();
});

test('changement de country_code exige partners.manage sur source et destination', async () => {
  mockPartnerAdmin.getPartner.mockResolvedValueOnce({ partner: { id: 'p1', country_code: 'CM' }, stats: null });
  const res = await request(app()).put('/api/admin/partners/p1').send({ country_code: 'KM' });
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('MARKET_CAPABILITY_REQUIRED');
  expect(mockPartnerAdmin.updatePartner).not.toHaveBeenCalled();
});

test('admin central conserve le contrat historique sans capability marché', async () => {
  mockUser = { id: 'admin-1', role: 'admin' };
  readMarkets = new Set();
  manageMarkets = new Set();
  const res = await request(app()).get('/api/admin/partners?country=KM');
  expect(res.status).toBe(200);
  expect(mockPartnerAdmin.listPartners).toHaveBeenCalledWith(expect.objectContaining({ country: 'KM' }));
});
