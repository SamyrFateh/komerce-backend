'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

let mockAllowedMarkets = new Set(['market-cm-id']);
let mockGlobalAllowed = false;
let mockRole = 'admin';

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = { id: 'user-1', role: mockRole }; next(); },
  requireRole: roles => (req, res, next) => roles.includes(req.user.role)
    ? next()
    : res.status(403).json({ code: 'role_forbidden' }),
}));

jest.mock('../../middleware/require-market-delegated-role', () => ({
  attachMarketDelegatedRoleFor: () => (req, res, next) => next(),
}));

jest.mock('../../middleware/require-market-delegated-capability', () => ({
  attachAuthorizedMarketsForCapability: capability => (req, res, next) => {
    if (!mockAllowedMarkets.size) {
      return res.status(403).json({ code: 'MARKET_CAPABILITY_REQUIRED', error: `${capability} required` });
    }
    req.authorizedMarkets = new Set(mockAllowedMarkets);
    return next();
  },
}));

jest.mock('../../middleware/require-dashboard-global-authority', () => ({
  hasDashboardGlobalAuthority: jest.fn(async () => mockGlobalAllowed),
}));

const mockResolveOrder = jest.fn();
const mockLoadOrder360 = jest.fn();
jest.mock('../../services/order-360', () => ({
  resolveOrder: (...args) => mockResolveOrder(...args),
  loadOrder360: (...args) => mockLoadOrder360(...args),
}));

const mockProjectUpstream = jest.fn();
jest.mock('../../services/golden-upstream-evidence', () => ({
  projectUpstreamEvidence: (...args) => mockProjectUpstream(...args),
}));

jest.mock('../../utils/logger', () => {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
  return {
    child: () => logger,
    forModule: () => logger,
  };
});

const express = require('express');
const request = require('supertest');
const router = require('../../routes/admin-order-360');

function app() {
  const instance = express();
  instance.use('/api/admin/entities', router);
  return instance;
}

function resolvedOrder(marketId = 'market-cm-id', code = 'CM') {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    reference: 'CMD-CM-001',
    market_id: marketId,
    market_code: code,
    status: 'confirmed',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAllowedMarkets = new Set(['market-cm-id']);
  mockGlobalAllowed = false;
  mockRole = 'admin';
  mockResolveOrder.mockResolvedValue({ invalid: false, order: resolvedOrder() });
  mockLoadOrder360.mockResolvedValue({
    order: { reference: 'CMD-CM-001', market: { code: 'CM' } },
    summary: { parcels: 1 },
  });
});

test('operations.read CM permet de lire une commande CM après résolution serveur', async () => {
  const res = await request(app()).get('/api/admin/entities/orders/CMD-CM-001');

  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toContain('no-store');
  expect(mockResolveOrder).toHaveBeenCalledWith('CMD-CM-001');
  expect(mockLoadOrder360).toHaveBeenCalledWith(expect.objectContaining({ market_id: 'market-cm-id' }), { includePurchasing: true });
  expect(JSON.stringify(res.body)).not.toContain('market-cm-id');
});

test('market_operator garde Order 360 mais sans projection Achats admin-only', async () => {
  mockRole = 'market_operator';

  const res = await request(app()).get('/api/admin/entities/orders/CMD-CM-001');

  expect(res.status).toBe(200);
  expect(mockLoadOrder360).toHaveBeenCalledWith(
    expect.objectContaining({ market_id: 'market-cm-id' }),
    { includePurchasing: false }
  );
});

test('operations.read CM ne permet pas de lire une commande CG', async () => {
  mockResolveOrder.mockResolvedValue({ invalid: false, order: resolvedOrder('market-cg-id', 'CG') });

  const res = await request(app()).get('/api/admin/entities/orders/CMD-CG-001');

  expect(res.status).toBe(403);
  expect(res.body.code).toBe('MARKET_CAPABILITY_REQUIRED');
  expect(mockLoadOrder360).not.toHaveBeenCalled();
});

test('autorité globale explicite peut investiguer un autre marché', async () => {
  mockResolveOrder.mockResolvedValue({ invalid: false, order: resolvedOrder('market-cg-id', 'CG') });
  mockGlobalAllowed = true;

  const res = await request(app()).get('/api/admin/entities/orders/CMD-CG-001');

  expect(res.status).toBe(200);
  expect(mockLoadOrder360).toHaveBeenCalled();
});

test('référence invalide et commande absente sont arrêtées avant les facettes', async () => {
  mockResolveOrder.mockResolvedValueOnce({ invalid: true, order: null });
  let res = await request(app()).get('/api/admin/entities/orders/%24%24bad');
  expect(res.status).toBe(400);
  expect(res.body.code).toBe('invalid_order_reference');

  mockResolveOrder.mockResolvedValueOnce({ invalid: false, order: null });
  res = await request(app()).get('/api/admin/entities/orders/CMD-404');
  expect(res.status).toBe(404);
  expect(res.body.code).toBe('order_not_found');
  expect(mockLoadOrder360).not.toHaveBeenCalled();
});

test('commande sans marché est fail-closed pour un opérateur pays', async () => {
  mockResolveOrder.mockResolvedValue({ invalid: false, order: resolvedOrder(null, null) });

  const res = await request(app()).get('/api/admin/entities/orders/CMD-OLD-001');

  expect(res.status).toBe(403);
  expect(res.body.code).toBe('order_market_unresolved');
  expect(mockLoadOrder360).not.toHaveBeenCalled();
});


describe('Golden evidence route contract', () => {
  test('route source keeps Golden evidence behind admin auth and Golden reference guard', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '../../routes/admin-order-360.js'), 'utf8');
    expect(source).toContain("'/orders/:orderReference/golden-evidence'");
    expect(source).toContain("attachMarketDelegatedRoleFor(['admin'])");
    expect(source).toContain("requireRole(['admin'])");
    expect(source).toContain("/^K-GOLDEN-/i");
    expect(source).toContain('projectGoldenEvidence(db, req.order360Order)');
  });
});


describe('Golden advance route contract', () => {
  test('mutation is admin-only, Golden-only and forbidden in production', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '../../routes/admin-order-360.js'), 'utf8');
    expect(source).toContain("'/orders/:orderReference/golden-advance'");
    expect(source).toContain("attachMarketDelegatedRoleFor(['admin'])");
    expect(source).toContain("requireRole(['admin'])");
    expect(source).toContain("process.env.NODE_ENV === 'production'");
    expect(source).toContain('golden_advance_production_forbidden');
    expect(source).toContain('advanceGoldenJourney(db, req.order360Order.reference)');
  });
});


describe('Golden create route contract', () => {
  test('creation is admin-only and forbidden in production', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '../../routes/admin-order-360.js'), 'utf8');
    expect(source).toContain("'/golden-create'");
    expect(source).toContain("['KM','CM','CG'].includes(marketCode)");
    expect(source).toContain("golden_market_unsupported");
    expect(source).toContain("attachMarketDelegatedRoleFor(['admin'])");
    expect(source).toContain("requireRole(['admin'])");
    expect(source).toContain('golden_create_production_forbidden');
    expect(source).toContain("createGoldenJourney(db, { marketCode })");
  });
});


describe('Golden upstream route', () => {
  const PID = '11111111-1111-4111-8111-111111111111';

  test('sans autorité dashboard globale → 403 fail-closed, aucune lecture', async () => {
    mockGlobalAllowed = false;
    const res = await request(app()).get(`/api/admin/entities/golden-upstream?product_id=${PID}&market=KM`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('golden_upstream_global_authority_required');
    expect(mockProjectUpstream).not.toHaveBeenCalled();
  });

  test('autorité globale → projection read-only, no-store, paramètres transmis tels quels', async () => {
    mockGlobalAllowed = true;
    mockProjectUpstream.mockResolvedValue({ stage: 'NON DÉMARRÉ', gates: [], certification: 'NON CERTIFIÉE' });
    const res = await request(app()).get(`/api/admin/entities/golden-upstream?product_id=${PID}&market=KM&order_reference=K-GOLDEN-1`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.body.certification).toBe('NON CERTIFIÉE');
    expect(mockProjectUpstream).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ productId: PID, marketCode: 'KM', orderReference: 'K-GOLDEN-1' }));
  });

  test('export du dossier (?download=1) : pièce jointe nommée par l’empreinte, même projection', async () => {
    mockGlobalAllowed = true;
    mockProjectUpstream.mockResolvedValue({ stage: 'PREUVE MANQUANTE', gates: [], certification: 'NON CERTIFIÉE', dossier: { sha256: 'a'.repeat(64), complete: false } });
    const attached = await request(app()).get(`/api/admin/entities/golden-upstream?product_id=${PID}&market=KM&download=1`);
    expect(attached.status).toBe(200);
    expect(attached.headers['content-disposition']).toBe(`attachment; filename="golden-dossier-${'a'.repeat(12)}.json"`);
    expect(attached.body.dossier.complete).toBe(false);
    const inline = await request(app()).get(`/api/admin/entities/golden-upstream?product_id=${PID}&market=KM`);
    expect(inline.headers['content-disposition']).toBeUndefined();
  });
});
