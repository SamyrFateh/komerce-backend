'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/tracking.test.js
 *
 * Tests du router routes/tracking.js (suivi public via qr_token)
 *
 * Couverture (invariants critiques) :
 *   ✓ GET /:token : 400 si token hors bornes de longueur (4-20)
 *   ✓ GET /:token : 404 si commande introuvable
 *   ✓ pickup_code/relay JAMAIS exposés tant que status pas available/collected/delivered
 *   ✓ pickupReady = true uniquement si à relais ET pickup_code défini
 *   ✓ téléphone client masqué (maskPhone)
 *   ✓ timeline construite depuis les timestamps order quand dispo, sinon dérivée de STATUS_ORDER
 *   ✓ POST /:token/verify-pickup : 400 si token/code manquants
 *   ✓ POST /:token/verify-pickup : 429 si rate-limit dépassé (5 tentatives / 15min)
 *   ✓ POST /:token/verify-pickup : 404 si commande introuvable
 *   ✓ POST /:token/verify-pickup : 400 si commande pas encore à relais
 *   ✓ POST /:token/verify-pickup : valid=true/false selon comparaison timing-safe
 */

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const mockComputeOrderStatusDetail = jest.fn().mockReturnValue('on_time');
const mockGetOrderStatusDetailMessage = jest.fn().mockReturnValue('Tout va bien');
jest.mock('../../utils/parcels', () => ({
  computeOrderStatusDetail: (...args) => mockComputeOrderStatusDetail(...args),
  getOrderStatusDetailMessage: (...args) => mockGetOrderStatusDetailMessage(...args),
}));

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const mockVerifyPickupCode = jest.fn();
jest.mock('../../services/pickup-secret-service', () => ({
  verifyPickupCode: (...args) => mockVerifyPickupCode(...args),
}));

const express = require('express');
const request = require('supertest');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  mockComputeOrderStatusDetail.mockReturnValue('on_time');
  mockGetOrderStatusDetailMessage.mockReturnValue('Tout va bien');

  app = express();
  app.use(express.json());
  jest.isolateModules(() => {
    const router = require('../../routes/tracking');
    app.use('/api/tracking', router);
  });
});

function baseOrderRow(overrides = {}) {
  return {
    id: 'O1', reference: 'ORD1', status: 'preparation', total_kmf: 5000,
    payment_mode: 'cash_relais', payment_status: 'pending', pickup_code: null,
    created_at: '2026-06-01', shipped_at: null, available_at: null, collected_at: null,
    ordered_at: '2026-06-01', preparation_at: '2026-06-02', in_transit_at: null,
    destination_island: 'Anjouan',
    client_name: 'Ali Said', client_phone: '+2693221111',
    relais_name: 'Relais Mutsamudu', relais_address: 'Rue principale',
    ...overrides,
  };
}

describe('GET /api/tracking/:token — validation', () => {
  test('400 si token trop court', async () => {
    const res = await request(app).get('/api/tracking/abc');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Token invalide' });
  });

  test('400 si token trop long', async () => {
    const res = await request(app).get('/api/tracking/' + 'a'.repeat(21));
    expect(res.status).toBe(400);
  });

  test('404 si la commande est introuvable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/tracking/TOKEN123');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Commande introuvable' });
  });
});

describe('GET /api/tracking/:token — exposition pickup_code / relay', () => {
  test('status preparation : pickup_code et relay masqués (pickupReady=false, relay=null)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [baseOrderRow({ status: 'preparation', pickup_code: '1234' })] })
      .mockResolvedValueOnce({ rows: [] }) // items
      .mockResolvedValueOnce({ rows: [] }); // parcels

    const res = await request(app).get('/api/tracking/TOKEN123');

    expect(res.status).toBe(200);
    expect(res.body.relay).toBeNull();
    expect(res.body.pickupReady).toBe(false);
  });

  test('status available + pickup_code défini : pickupReady=true, relay exposé', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [baseOrderRow({ status: 'available', pickup_code: '1234', pickup_secret_hash: 'hash-1' })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/tracking/TOKEN123');

    expect(res.status).toBe(200);
    expect(res.body.relay).toEqual({ name: 'Relais Mutsamudu', address: 'Rue principale' });
    expect(res.body.pickupReady).toBe(true);
  });

  test('status available mais pickup_code NULL : pickupReady=false malgré relay exposé', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [baseOrderRow({ status: 'available', pickup_code: null })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/tracking/TOKEN123');

    expect(res.body.relay).not.toBeNull();
    expect(res.body.pickupReady).toBe(false);
  });
});

describe('GET /api/tracking/:token — téléphone masqué', () => {
  test('le téléphone client est masqué (4 premiers + *** + 4 derniers)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [baseOrderRow({ client_phone: '+2693221111' })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/tracking/TOKEN123');

    expect(res.body.client.phone).toBe('+269***1111');
  });

  test('téléphone null -> reste null', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [baseOrderRow({ client_phone: null })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/tracking/TOKEN123');

    expect(res.body.client.phone).toBeNull();
  });
});

describe('GET /api/tracking/:token — timeline', () => {
  test('timeline utilise les timestamps order quand au moins 2 étapes sont renseignées', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [baseOrderRow({ ordered_at: '2026-06-01', preparation_at: '2026-06-02' })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/tracking/TOKEN123');

    const statuses = res.body.timeline.map(t => t.status);
    expect(statuses).toEqual(['ordered', 'preparation']);
  });

  test('timeline dérivée de STATUS_ORDER si une seule étape connue (created_at seul)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [baseOrderRow({ ordered_at: null, preparation_at: null, status: 'shipped' })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/tracking/TOKEN123');

    const statuses = res.body.timeline.map(t => t.status);
    expect(statuses).toEqual(['ordered', 'preparation', 'shipped', 'in_transit', 'available', 'collected']);
    const shipped = res.body.timeline.find(t => t.status === 'shipped');
    expect(shipped.completed).toBe(true);
    const collected = res.body.timeline.find(t => t.status === 'collected');
    expect(collected.completed).toBe(false);
  });
});

describe('GET /api/tracking/:token — scan events groupés par colis', () => {
  test('les events sont attachés au bon colis et requêtés seulement si des parcels existent', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [baseOrderRow()] })
      .mockResolvedValueOnce({ rows: [] }) // items
      .mockResolvedValueOnce({ rows: [{ id: 'P1', reference: 'REF1', status: 'shipped' }] }) // parcels
      .mockResolvedValueOnce({ rows: [{ parcel_id: 'P1', event_type: 'shipped', location: 'Hub', notes: null, created_at: '2026-06-03' }] }); // scan events

    const res = await request(app).get('/api/tracking/TOKEN123');

    expect(res.body.parcels[0].events).toEqual([
      { type: 'shipped', label: 'Expédiée depuis Dubaï', location: 'Hub', notes: null, date: '2026-06-03' },
    ]);
    expect(mockQuery).toHaveBeenCalledTimes(4);
  });

  test('aucune requête scan_events si aucun colis', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [baseOrderRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }); // parcels vide

    await request(app).get('/api/tracking/TOKEN123');

    expect(mockQuery).toHaveBeenCalledTimes(3);
  });
});

describe('POST /api/tracking/:token/verify-pickup', () => {
  test('400 si token ou code manquant', async () => {
    const res = await request(app).post('/api/tracking/TOKEN123/verify-pickup').send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ valid: false, error: 'Token et code requis' });
  });

  test('429 si rate-limit dépassé (count > 5)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // DELETE expired
      .mockResolvedValueOnce({ rows: [{ count: 6, reset_at: new Date(Date.now() + 60000).toISOString() }] }); // INSERT..ON CONFLICT

    const res = await request(app).post('/api/tracking/TOKEN123/verify-pickup').send({ code: '1234' });

    expect(res.status).toBe(429);
    expect(res.body.valid).toBe(false);
    expect(res.body.retryAfter).toBeGreaterThan(0);
  });

  test('404 si commande introuvable', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 1, reset_at: new Date(Date.now() + 60000).toISOString() }] })
      .mockResolvedValueOnce({ rows: [] }); // SELECT order

    const res = await request(app).post('/api/tracking/TOKEN123/verify-pickup').send({ code: '1234' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ valid: false, error: 'Commande introuvable' });
  });

  test("400 si la commande n'est pas encore à relais", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 1, reset_at: new Date(Date.now() + 60000).toISOString() }] })
      .mockResolvedValueOnce({ rows: [{ pickup_code: '1234', status: 'preparation' }] });

    const res = await request(app).post('/api/tracking/TOKEN123/verify-pickup').send({ code: '1234' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ valid: false, error: 'Commande pas encore disponible au retrait' });
  });

  test('valid=true si le code correspond exactement (status available)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 1, reset_at: new Date(Date.now() + 60000).toISOString() }] })
      .mockResolvedValueOnce({ rows: [{ id: 'order-1', status: 'available' }] });
    mockVerifyPickupCode.mockResolvedValueOnce({ status: 200, body: {} });

    const res = await request(app).post('/api/tracking/TOKEN123/verify-pickup').send({ code: '4521' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: true });
    expect(mockVerifyPickupCode).toHaveBeenCalledWith({ orderId: 'order-1', code: '4521', agentId: null });
  });

  test('valid=false si le code ne correspond pas', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 1, reset_at: new Date(Date.now() + 60000).toISOString() }] })
      .mockResolvedValueOnce({ rows: [{ id: 'order-1', status: 'available' }] });
    mockVerifyPickupCode.mockResolvedValueOnce({ status: 401, body: {} });

    const res = await request(app).post('/api/tracking/TOKEN123/verify-pickup').send({ code: '0000' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: false });
  });
});

describe('DEBT-11 — suppression du writer tracking mort', () => {
  // P5 §4.6 : generateTrackingToken() écrivait qr_token sans expiration, en
  // dehors de toute transaction, et n'avait plus aucun appelant en dehors de
  // ce fichier depuis que l'émission est centralisée dans
  // qr-collection-core.js::issueOrRotateQrToken. Ce test verrouille sa
  // disparition définitive du module.
  test('generateTrackingToken n\'existe plus sur le router exporté', () => {
    const router = require('../../routes/tracking');
    expect(router.generateTrackingToken).toBeUndefined();
  });
});
