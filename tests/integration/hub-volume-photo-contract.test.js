'use strict';

/**
 * tests/integration/hub-volume-photo-contract.test.js
 *
 * D-06 — Contrat HTTP réel pour les 2 routes hub découvertes en drift :
 *   POST /api/hub/volume
 *   POST /api/hub/photo
 *
 * Verrouille : auth admin/agent_hub, validation Joi, update volume produit,
 * upload multipart, défense magic bytes et trace scan_events seal_photo.
 *
 * Run :
 *   DATABASE_URL=postgres://... JWT_SECRET=ci-test-secret-not-for-prod \
 *   npx jest tests/integration/hub-volume-photo-contract.test.js --runInBand
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('hub-volume-photo-contract D-06 (needs DATABASE_URL)', () => {
    test('skipped — DATABASE_URL not configured', () => {});
  });
} else {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const request = require('supertest');
  const { createUser, cleanup } = require('./test-harness/seed-helpers');

  let app;
  let db;
  let adminUser;
  let agentUser;
  let clientUser;
  let productId;
  let relaisId;
  let orderId;
  let parcelId;
  let parcelRef;
  let pngPath;
  let badPngPath;

  const BASE = '/api/hub';
  const nilUuid = '00000000-0000-0000-0000-000000000000';
  const bearer = (token) => ['Authorization', `Bearer ${token}`];
  const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  async function seedGraph() {
    const tag = suffix();

    const { rows: [product] } = await db.query(
      `INSERT INTO products (name, category, price_kmf, stock, is_active)
       VALUES ($1, 'test', 4200, 10, TRUE)
       RETURNING id`,
      [`IT Hub Volume ${tag}`]
    );
    productId = product.id;

    const { rows: [relais] } = await db.query(
      `INSERT INTO relais (name, agent_name, phone, address, island)
       VALUES ($1, $2, $3, $4, 'Anjouan')
       RETURNING id`,
      [`IT Hub Relais ${tag}`, 'Agent D06', `+2693${Math.floor(1000000 + Math.random() * 8999999)}`, 'Adresse test D06']
    );
    relaisId = relais.id;

    const { rows: [order] } = await db.query(
      `INSERT INTO orders (reference, relais_id, total_kmf, payment_mode, status)
       VALUES ($1, $2, 4200, 'cash_relais', 'confirmed')
       RETURNING id, reference`,
      [`IT-HUB-ORDER-${tag}`, relaisId]
    );
    orderId = order.id;

    const { rows: [parcel] } = await db.query(
      `INSERT INTO parcels (order_id, reference, type, status, relais_id)
       VALUES ($1, $2, 'standard', 'draft', $3)
       RETURNING id, reference`,
      [orderId, `IT-HUB-PARCEL-${tag}`, relaisId]
    );
    parcelId = parcel.id;
    parcelRef = parcel.reference;
  }

  function createTempImages() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'komerce-d06-hub-'));
    pngPath = path.join(dir, 'valid.png');
    badPngPath = path.join(dir, 'not-an-image.png');

    // PNG 1×1 transparent.
    fs.writeFileSync(pngPath, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
      'base64'
    ));
    fs.writeFileSync(badPngPath, Buffer.from('not a real image file', 'utf8'));
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-secret-not-for-prod';

    app = require('../../server');
    db = require('../../db');

    await new Promise((resolve) => setTimeout(resolve, 2000));

    adminUser = await createUser({ role: 'admin' });
    agentUser = await createUser({ role: 'agent_hub' });
    clientUser = await createUser({ role: 'client' });
    await seedGraph();
    createTempImages();
  }, 30000);

  afterAll(async () => {
    if (app && app.get && app.get('httpServer')) { await new Promise((resolve) => app.get('httpServer').close(resolve)); }
    try { await db.query(`DELETE FROM scan_events WHERE parcel_id = $1`, [parcelId]); } catch (_) {}
    try { await db.query(`DELETE FROM parcels WHERE id = $1`, [parcelId]); } catch (_) {}
    try { await db.query(`DELETE FROM orders WHERE id = $1`, [orderId]); } catch (_) {}
    try { await db.query(`DELETE FROM relais WHERE id = $1`, [relaisId]); } catch (_) {}
    try { await db.query(`DELETE FROM products WHERE id = $1`, [productId]); } catch (_) {}
    try {
      if (pngPath) fs.rmSync(path.dirname(pngPath), { recursive: true, force: true });
    } catch (_) {}
    await cleanup();
    if (db.end) await db.end().catch(() => {});
  }, 20000);

  describe('POST /volume', () => {
    test('401 sans token', async () => {
      const res = await request(app).post(`${BASE}/volume`).send({ product_id: productId, volume_cm3: 9000 });
      expect(res.status).toBe(401);
    });

    test('403 token client', async () => {
      const res = await request(app)
        .post(`${BASE}/volume`)
        .set(...bearer(clientUser.token))
        .send({ product_id: productId, volume_cm3: 9000 });
      expect([401, 403]).toContain(res.status);
    });

    test('400 volume_cm3/repack_volume_cm3 absents', async () => {
      const res = await request(app)
        .post(`${BASE}/volume`)
        .set(...bearer(agentUser.token))
        .send({ product_id: productId });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    test('404 produit introuvable', async () => {
      const res = await request(app)
        .post(`${BASE}/volume`)
        .set(...bearer(agentUser.token))
        .send({ product_id: nilUuid, volume_cm3: 9000 });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
    });

    test('200 agent_hub — enregistre volume + repack', async () => {
      const res = await request(app)
        .post(`${BASE}/volume`)
        .set(...bearer(agentUser.token))
        .send({ product_id: productId, volume_cm3: 12000, repack_volume_cm3: 8000 });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message');
      expect(res.body).toHaveProperty('product');
      expect(res.body).toHaveProperty('repack_gain_cm3', 4000);
      expect(res.body).toHaveProperty('recorded_by', agentUser.id);
      expect(res.body.product).toMatchObject({ id: productId });
      expect(Number(res.body.product.volume_cm3)).toBe(12000);
      expect(Number(res.body.product.repack_volume_cm3)).toBe(8000);
    });
  });

  describe('POST /photo', () => {
    test('401 sans token', async () => {
      const res = await request(app)
        .post(`${BASE}/photo`)
        .field('parcel_id', parcelId)
        .attach('photo', pngPath);
      expect(res.status).toBe(401);
    });

    test('400 sans fichier photo', async () => {
      const res = await request(app)
        .post(`${BASE}/photo`)
        .set(...bearer(agentUser.token))
        .field('parcel_id', parcelId);
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    test('400 parcel_id invalide avec fichier valide', async () => {
      const res = await request(app)
        .post(`${BASE}/photo`)
        .set(...bearer(agentUser.token))
        .field('parcel_id', 'not-a-uuid')
        .attach('photo', pngPath);
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    test('404 colis introuvable', async () => {
      const res = await request(app)
        .post(`${BASE}/photo`)
        .set(...bearer(agentUser.token))
        .field('parcel_id', nilUuid)
        .attach('photo', pngPath);
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
    });

    test('415 fichier .png dont les magic bytes ne sont pas une image', async () => {
      const res = await request(app)
        .post(`${BASE}/photo`)
        .set(...bearer(agentUser.token))
        .field('parcel_id', parcelId)
        .attach('photo', badPngPath);
      expect(res.status).toBe(415);
      expect(res.body).toHaveProperty('code', 'INVALID_MAGIC_BYTES');
    });

    test('201 agent_hub — enregistre photo de scellé et scan_event', async () => {
      const res = await request(app)
        .post(`${BASE}/photo`)
        .set(...bearer(agentUser.token))
        .field('parcel_id', parcelId)
        .field('notes', 'photo scellé D-06')
        .attach('photo', pngPath);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('message', `Photo de scellé enregistrée pour ${parcelRef}`);
      expect(res.body).toHaveProperty('event_id');
      expect(res.body).toHaveProperty('photo_url');
      expect(res.body).toHaveProperty('photo_count');
      expect(res.body).toHaveProperty('recorded_at');

      const { rows } = await db.query(
        `SELECT event_type, scanned_by, actor_role, photo_urls, notes
           FROM scan_events
          WHERE id = $1`,
        [res.body.event_id]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        event_type: 'seal_photo',
        scanned_by: agentUser.id,
        actor_role: 'hub_agent',
        notes: 'photo scellé D-06',
      });
      expect(Array.isArray(rows[0].photo_urls)).toBe(true);
      expect(rows[0].photo_urls[0]).toBe(res.body.photo_url);
    });
  });
}
