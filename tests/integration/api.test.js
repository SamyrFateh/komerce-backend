/**
 * KOMERCE — Tests d'Intégration: Routes API (V2.7)
 *
 * Couvre les routes critiques avec supertest.
 *
 * Prerequisites for active execution:
 *   - PostgreSQL running with schema loaded
 *   - env: DATABASE_URL, JWT_SECRET
 *
 * Without DATABASE_URL, this file registers a skipped placeholder instead of
 * importing server.js, because server.js intentionally exits on missing env.
 *
 * Run: npx jest tests/integration/api.test.js --forceExit --detectOpenHandles
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('API integration tests', () => {
    test('skipped because DATABASE_URL is not configured', () => {});
  });
} else {
  const request = require('supertest');

  let app;
  let adminToken;

  // ── Setup ───────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    // Set test env
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-ci';

    // Import app (starts Express but skips listen in test)
    app = require('../../server');

    // Small delay for migrations to complete
    await new Promise(r => setTimeout(r, 3000));

    // Try to get admin token
    try {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'admin@komerce.com', password: process.env.ADMIN_PASSWORD || 'admin123' });

      if (loginRes.status === 200 && loginRes.body.token) {
        adminToken = loginRes.body.token;
      }
    } catch (e) {
      console.warn('Could not get admin token:', e.message);
    }
  });

  afterAll(async () => {
    if (app && app.get && app.get('httpServer')) { await new Promise((resolve) => app.get('httpServer').close(resolve)); }
    // Give time for connections to close
    await new Promise(r => setTimeout(r, 1000));
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // Health checks
  // ═══════════════════════════════════════════════════════════════════════════════

  describe('GET /api/health', () => {
    test('returns 200 with status ok', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.db_latency_ms).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // Auth routes
  // ═══════════════════════════════════════════════════════════════════════════════

  describe('POST /api/auth/register', () => {
    test('rejects missing fields', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'test@test.com' });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    test('rejects invalid email', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          full_name: 'Test User',
          email: 'not-an-email',
          password: 'Test1234',
        });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('POST /api/auth/login', () => {
    test('rejects invalid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nonexistent@test.com', password: 'wrong' });
      expect([400, 401, 404]).toContain(res.status);
    });

    test('rejects missing password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'admin@komerce.com' });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // Public routes
  // ═══════════════════════════════════════════════════════════════════════════════

  describe('GET /api/products', () => {
    test('returns product list (public)', async () => {
      const res = await request(app).get('/api/products');
      expect([200, 401]).toContain(res.status); // May require auth depending on config
      if (res.status === 200) {
        expect(Array.isArray(res.body) || res.body.products).toBeTruthy();
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // Admin routes (auth required)
  // ═══════════════════════════════════════════════════════════════════════════════

  describe('GET /api/admin/orders', () => {
    test('rejects without auth', async () => {
      const res = await request(app).get('/api/admin/orders');
      expect(res.status).toBe(401);
    });

    test('returns orders with valid admin token', async () => {
      if (!adminToken) return; // Skip if no admin token
      const res = await request(app)
        .get('/api/admin/orders')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.orders).toBeDefined();
    });
  });

  describe('POST /api/admin/reset — production guard', () => {
    test('blocked when NODE_ENV=production', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const res = await request(app)
        .post('/api/admin/reset')
        .set('Authorization', `Bearer ${adminToken || 'fake'}`)
        .send({ mode: 'orders' });

      // Should be either 403 (blocked) or 401 (no auth)
      expect([401, 403]).toContain(res.status);
      if (res.status === 403) {
        expect(res.body.error).toContain('production');
      }

      process.env.NODE_ENV = origEnv;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // Hub routes (auth required)
  // ═══════════════════════════════════════════════════════════════════════════════

  describe('Hub endpoints', () => {
    test('GET /api/hub/pending rejects without auth', async () => {
      const res = await request(app).get('/api/hub/pending');
      expect(res.status).toBe(401);
    });

    test('GET /api/hub/today rejects without auth', async () => {
      const res = await request(app).get('/api/hub/today');
      expect(res.status).toBe(401);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // 404 handling
  // ═══════════════════════════════════════════════════════════════════════════════

  describe('404 handling', () => {
    test('API routes return JSON 404', async () => {
      const res = await request(app).get('/api/nonexistent-route');
      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // Request ID (V2.2)
  // ═══════════════════════════════════════════════════════════════════════════════

  describe('Request ID middleware', () => {
    test('response includes x-request-id header', async () => {
      const res = await request(app).get('/api/health');
      expect(res.headers['x-request-id']).toBeDefined();
    });

    test('echoes client x-request-id', async () => {
      const customId = 'test-req-12345';
      const res = await request(app)
        .get('/api/health')
        .set('x-request-id', customId);
      expect(res.headers['x-request-id']).toBe(customId);
    });
  });
}
