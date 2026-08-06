'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/health.test.js
 * Couvre routes/health.js
 *
 * _probeRedis, _probeStripe, _probePaypal ne sont pas exportées :
 * testées indirectement via GET /detailed en pilotant les variables
 * d'environnement (REDIS_URL, STRIPE_SECRET_KEY, PAYPAL_CLIENT_ID/SECRET).
 */

const express = require('express');
const request = require('supertest');

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));

jest.mock('../../services/monitoring', () => ({ getMetrics: jest.fn() }));

let mockUser = { id: 'admin-1', role: 'admin' };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (!mockUser) return res.status(401).json({ error: 'Token manquant — connectez-vous' });
    req.user = mockUser;
    next();
  },
  requireRole: (roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès réservé' });
    }
    next();
  },
}));

const mockRedisClient = {
  connect: jest.fn(),
  ping: jest.fn(),
  disconnect: jest.fn(),
};
jest.mock('redis', () => ({ createClient: jest.fn(() => mockRedisClient) }));

const mockStripeBalanceRetrieve = jest.fn();
jest.mock('stripe', () => jest.fn(() => ({ balance: { retrieve: mockStripeBalanceRetrieve } })));

const { getMetrics } = require('../../services/monitoring');
const healthRouter = require('../../routes/health');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/health', healthRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

const ENV_KEYS = ['REDIS_URL', 'STRIPE_SECRET_KEY', 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_ENV'];
let savedEnv;

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'admin-1', role: 'admin' };
  savedEnv = {};
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  global.fetch = jest.fn();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('GET /health — basic', () => {
  it('pas d\'auth requise → 200 sans token', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get('/health/');
    expect(res.status).toBe(200);
  });

  it('DB joignable → status ok + latence mesuree', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get('/health/');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('connected');
    expect(typeof res.body.db_latency_ms).toBe('number');
    expect(res.body).toHaveProperty('timestamp');
  });

  it('DB en panne → 503, status error', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('connexion refusee'));
    const res = await request(buildApp()).get('/health/');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      status: 'error',
      db: 'disconnected',
      error: 'connexion refusee',
      timestamp: res.body.timestamp,
    });
  });
});

describe('GET /health/ready', () => {
  it('DB ok → status ready', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  it('DB en panne → 503 not_ready', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('down'));
    const res = await request(buildApp()).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'not_ready' });
  });
});

describe('GET /health/metrics — admin only', () => {
  it('sans auth → 401', async () => {
    mockUser = null;
    const res = await request(buildApp()).get('/health/metrics');
    expect(res.status).toBe(401);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).get('/health/metrics');
    expect(res.status).toBe(403);
  });

  it('admin → 200 + business metrics agreges', async () => {
    getMetrics.mockReturnValue({ requests_total: 100 });
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ active_orders: 5, orders_30d: 10, cancelled_30d: 2 }] }) // orderStats
      .mockResolvedValueOnce({ rows: [{ avg_hours_creation_to_confirm: 2.5, median_hours_creation_to_confirm: 2.0 }] }) // delayStats
      .mockResolvedValueOnce({ rows: [{ active_parcels: 3, in_transit: 1, backorders: 0 }] }) // parcelStats
      .mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'Produit', category: 'electro', stock: 1 }] }); // stockAlerts

    const res = await request(buildApp()).get('/health/metrics');
    expect(res.status).toBe(200);
    expect(res.body.app).toEqual({ requests_total: 100 });
    expect(res.body.business.orders.conversion_rate_pct).toBe(80); // (10-2)/10*100
    expect(res.body.business.parcels).toEqual({ active_parcels: 3, in_transit: 1, backorders: 0 });
    expect(res.body.business.stock_alerts).toEqual({ count: 1, products: [{ id: 'p1', name: 'Produit', category: 'electro', stock: 1 }] });
  });

  it('orders_30d = 0 → conversion_rate_pct null (pas de division par zero)', async () => {
    getMetrics.mockReturnValue({});
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ active_orders: 0, orders_30d: 0, cancelled_30d: 0 }] })
      .mockResolvedValueOnce({ rows: [{ avg_hours_creation_to_confirm: null, median_hours_creation_to_confirm: null }] })
      .mockResolvedValueOnce({ rows: [{ active_parcels: 0, in_transit: 0, backorders: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/health/metrics');
    expect(res.status).toBe(200);
    expect(res.body.business.orders.conversion_rate_pct).toBeNull();
  });

  it('erreur DB → 500 via next', async () => {
    getMetrics.mockReturnValue({});
    mockDbQuery.mockRejectedValueOnce(new Error('db cassee'));
    const res = await request(buildApp()).get('/health/metrics');
    expect(res.status).toBe(500);
  });
});

describe('GET /health/detailed — dependances externes', () => {
  it('sans auth → 401', async () => {
    mockUser = null;
    const res = await request(buildApp()).get('/health/detailed');
    expect(res.status).toBe(401);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).get('/health/detailed');
    expect(res.status).toBe(403);
  });

  it('toutes les dependances optionnelles absentes/desactivees + DB ok → 200 status ok', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get('/health/detailed');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.dependencies.db.status).toBe('ok');
    expect(res.body.dependencies.redis).toEqual({ status: 'disabled', reason: 'REDIS_URL absent' });
    expect(res.body.dependencies.stripe).toEqual({ status: 'disabled', reason: 'STRIPE_SECRET_KEY absent' });
    expect(res.body.dependencies.paypal).toEqual({ status: 'disabled', reason: 'PAYPAL_CLIENT_ID/SECRET absent' });
  });

  it('DB en panne → degraded 503, autres deps inchangees', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(buildApp()).get('/health/detailed');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.dependencies.db).toEqual({ status: 'error', error: 'db down' });
  });

  it('Redis configure et joignable → status ok + latence', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    mockRedisClient.connect.mockResolvedValue();
    mockRedisClient.ping.mockResolvedValue('PONG');
    mockRedisClient.disconnect.mockResolvedValue();
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/health/detailed');
    expect(res.body.dependencies.redis.status).toBe('ok');
    expect(typeof res.body.dependencies.redis.latency_ms).toBe('number');
  });

  it('Redis configure mais ping echoue → status error, global toujours degraded', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    mockRedisClient.connect.mockResolvedValue();
    mockRedisClient.ping.mockRejectedValue(new Error('ECONNREFUSED'));
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/health/detailed');
    expect(res.status).toBe(503);
    expect(res.body.dependencies.redis).toEqual({ status: 'error', error: 'ECONNREFUSED' });
  });

  it('Stripe configure et joignable → status ok', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
    mockStripeBalanceRetrieve.mockResolvedValue({ available: [] });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/health/detailed');
    expect(res.body.dependencies.stripe.status).toBe('ok');
  });

  it('Stripe configure mais en erreur → masque le detail, expose juste err.type', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
    const stripeErr = new Error('clé invalide');
    stripeErr.type = 'StripeAuthenticationError';
    mockStripeBalanceRetrieve.mockRejectedValue(stripeErr);
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/health/detailed');
    expect(res.body.dependencies.stripe).toEqual({ status: 'error', error: 'StripeAuthenticationError' });
  });

  it('PayPal configure et joignable → status ok', async () => {
    process.env.PAYPAL_CLIENT_ID = 'id';
    process.env.PAYPAL_CLIENT_SECRET = 'secret';
    global.fetch.mockResolvedValue({ ok: true, status: 200 });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/health/detailed');
    expect(res.body.dependencies.paypal.status).toBe('ok');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api-m.sandbox.paypal.com/v1/oauth2/token',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('PayPal en environnement production → utilise le endpoint live', async () => {
    process.env.PAYPAL_CLIENT_ID = 'id';
    process.env.PAYPAL_CLIENT_SECRET = 'secret';
    process.env.PAYPAL_ENV = 'production';
    global.fetch.mockResolvedValue({ ok: true, status: 200 });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    await request(buildApp()).get('/health/detailed');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api-m.paypal.com/v1/oauth2/token',
      expect.anything()
    );
  });

  it('PayPal repond avec un statut HTTP non-ok → status error + http_status', async () => {
    process.env.PAYPAL_CLIENT_ID = 'id';
    process.env.PAYPAL_CLIENT_SECRET = 'secret';
    global.fetch.mockResolvedValue({ ok: false, status: 401 });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/health/detailed');
    expect(res.body.dependencies.paypal).toEqual({ status: 'error', http_status: 401 });
  });

  it('PayPal fetch leve une exception reseau → status error + message', async () => {
    process.env.PAYPAL_CLIENT_ID = 'id';
    process.env.PAYPAL_CLIENT_SECRET = 'secret';
    global.fetch.mockRejectedValue(new Error('network unreachable'));
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/health/detailed');
    expect(res.body.dependencies.paypal).toEqual({ status: 'error', error: 'network unreachable' });
  });

  it('toutes les dependances optionnelles ok + db ok → status global ok malgre presence de redis/stripe/paypal', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
    process.env.PAYPAL_CLIENT_ID = 'id';
    process.env.PAYPAL_CLIENT_SECRET = 'secret';
    mockRedisClient.connect.mockResolvedValue();
    mockRedisClient.ping.mockResolvedValue('PONG');
    mockRedisClient.disconnect.mockResolvedValue();
    mockStripeBalanceRetrieve.mockResolvedValue({});
    global.fetch.mockResolvedValue({ ok: true, status: 200 });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/health/detailed');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('GET /health/version', () => {
  it("pas d'auth requise, renvoie version et commit", async () => {
    const res = await request(buildApp()).get('/health/version');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('version');
    expect(res.body).toHaveProperty('commit');
  });
});
