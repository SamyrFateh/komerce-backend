/**
 * KOMERCE — Tests Unitaires : routes/parcels (Lot B3)
 *
 * Sécurité logistique v1.0 (S1-S7) : external_code/seal_code à la création,
 * event logging, checkpoint poids, vérification scellé. Le `validate`
 * middleware et les schémas Joi réels sont utilisés tels quels (déjà
 * couverts par tests/unit/validators.test.js) — pas de mock ici, on veut le
 * vrai comportement 400 sur payload invalide. `services/parcel-security`,
 * `utils/parcelSync`, `utils/orderParcelLinkRules` sont mockés (logique déjà
 * testée isolément).
 *
 * Run : npx jest tests/unit/parcels-route.test.js
 */

'use strict';

const express = require('express');
const request = require('supertest');

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

let mockUser = { id: 'admin-1', role: 'admin' };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (!mockUser) return res.status(401).json({ error: 'Token manquant' });
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

jest.mock('../../services/parcel-security', () => ({
  generateExternalCode: jest.fn(() => 'EXT-STUB'),
  generateSealCode: jest.fn(() => 'SEAL-STUB'),
  logParcelEvent: jest.fn().mockResolvedValue({}),
  checkWeightIntegrity: jest.fn(() => null),
  verifySeal: jest.fn(() => ({ valid: true })),
}));

jest.mock('../../utils/parcelSync', () => ({ safeSyncScanToParcels: jest.fn().mockResolvedValue({}) }));
jest.mock('../../utils/reference', () => ({ generateParcelRef: jest.fn().mockResolvedValue('COL-000123') }));
jest.mock('../../utils/orderParcelLinkRules', () => ({ evaluateOrderParcelLinkRules: jest.fn().mockResolvedValue(null) }));

const parcelSecurity = require('../../services/parcel-security');
const { safeSyncScanToParcels } = require('../../utils/parcelSync');
const { evaluateOrderParcelLinkRules } = require('../../utils/orderParcelLinkRules');

const router = require('../../routes/parcels');

const VALID_UUID_1 = '11111111-1111-1111-1111-111111111111';
const VALID_UUID_2 = '22222222-2222-2222-2222-222222222222';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/parcels', router);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('routes/parcels', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDbQuery.mockReset();
    mockUser = { id: 'admin-1', role: 'admin' };
    parcelSecurity.generateExternalCode.mockReturnValue('EXT-STUB');
    parcelSecurity.generateSealCode.mockReturnValue('SEAL-STUB');
    parcelSecurity.logParcelEvent.mockResolvedValue({});
    parcelSecurity.checkWeightIntegrity.mockReturnValue(null);
    parcelSecurity.verifySeal.mockReturnValue({ valid: true });
    safeSyncScanToParcels.mockResolvedValue({});
    evaluateOrderParcelLinkRules.mockResolvedValue(null);
  });

  describe('GET /', () => {
    test('refuse un rôle non autorisé', async () => {
      mockUser = { id: 'u1', role: 'client' };
      const res = await request(buildApp()).get('/api/parcels');
      expect(res.status).toBe(403);
    });

    test('liste paginée avec filtres par défaut', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(buildApp()).get('/api/parcels');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: [], pagination: { page: 1, limit: 50, total: 0, pages: 0 } });
    });

    test('400 si un paramètre de requête est invalide (validate réel)', async () => {
      const res = await request(buildApp()).get('/api/parcels').query({ order_id: 'pas-un-uuid' });
      expect(res.status).toBe(400);
      expect(mockDbQuery).not.toHaveBeenCalled();
    });

    test('agent_relais est restreint à son point relais', async () => {
      mockUser = { id: 'agent-1', role: 'agent_relais' };
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ count: '2' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'p1' }, { id: 'p2' }] });

      const res = await request(buildApp()).get('/api/parcels');

      expect(res.status).toBe(200);
      const countSql = mockDbQuery.mock.calls[0][0];
      expect(countSql).toMatch(/relais r WHERE r.phone/);
    });
  });

  describe('GET /:ref', () => {
    test('404 si colis introuvable', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(buildApp()).get('/api/parcels/COL-999');
      expect(res.status).toBe(404);
    });

    test('renvoie le colis avec ses items', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: 'p1', reference: 'COL-1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'it1' }] });

      const res = await request(buildApp()).get('/api/parcels/COL-1');

      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([{ id: 'it1' }]);
    });
  });

  describe('GET /:ref/events', () => {
    test('404 si colis introuvable', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(buildApp()).get('/api/parcels/COL-999/events');
      expect(res.status).toBe(404);
    });

    test('renvoie l\'historique des événements', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: 'p1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'ev1' }, { id: 'ev2' }] });

      const res = await request(buildApp()).get('/api/parcels/COL-1/events');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ parcel_id: 'p1', events: [{ id: 'ev1' }, { id: 'ev2' }], count: 2 });
    });
  });

  describe('POST /', () => {
    test('403 pour agent_relais (adminAgent uniquement)', async () => {
      mockUser = { id: 'agent-1', role: 'agent_relais' };
      const res = await request(buildApp()).post('/api/parcels').send({ order_id: VALID_UUID_1 });
      expect(res.status).toBe(403);
    });

    test('400 si order_id absent ou invalide (validate réel)', async () => {
      const res = await request(buildApp()).post('/api/parcels').send({ order_id: 'pas-un-uuid' });
      expect(res.status).toBe(400);
    });

    test('404 si la commande est introuvable', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(buildApp()).post('/api/parcels').send({ order_id: VALID_UUID_1 });
      expect(res.status).toBe(404);
    });

    test('crée un colis avec external_code/seal_code et journalise (S1/S2)', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: VALID_UUID_1 }] }) // orderCheck
        .mockResolvedValueOnce({
          rows: [{ id: 'p1', reference: 'COL-000123', external_code: 'EXT-STUB', seal_code: 'SEAL-STUB', status: 'draft' }],
        }); // INSERT

      const res = await request(buildApp())
        .post('/api/parcels')
        .send({ order_id: VALID_UUID_1, type: 'fragile', notes: 'attention' });

      expect(res.status).toBe(201);
      expect(res.body.external_code).toBe('EXT-STUB');
      // created + sealed events (pas de weight_kg fourni)
      expect(parcelSecurity.logParcelEvent).toHaveBeenCalledTimes(2);
      expect(parcelSecurity.logParcelEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event_type: 'created' }));
      expect(parcelSecurity.logParcelEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event_type: 'sealed' }));
    });

    test('journalise aussi weight_recorded si weight_kg fourni', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: VALID_UUID_1 }] })
        .mockResolvedValueOnce({ rows: [{ id: 'p1', reference: 'COL-000123' }] })
        .mockResolvedValueOnce({ rows: [] }); // UPDATE last_weight_at

      const res = await request(buildApp())
        .post('/api/parcels')
        .send({ order_id: VALID_UUID_1, weight_kg: 4.2 });

      expect(res.status).toBe(201);
      expect(parcelSecurity.logParcelEvent).toHaveBeenCalledTimes(3);
      expect(parcelSecurity.logParcelEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event_type: 'weight_recorded' }));
    });

    test('409 si un colis draft existe déjà pour la commande (contrainte one_draft_per_order)', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: VALID_UUID_1 }] });
      mockDbQuery.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505', constraint: 'one_draft_per_order' }));

      const res = await request(buildApp()).post('/api/parcels').send({ order_id: VALID_UUID_1 });

      expect(res.status).toBe(409);
    });
  });

  describe('PATCH /:id/status', () => {
    test('400 si status invalide (validate réel)', async () => {
      const res = await request(buildApp()).patch(`/api/parcels/${VALID_UUID_1}/status`).send({ status: 'teleporte' });
      expect(res.status).toBe(400);
    });

    test('404 si colis introuvable', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(buildApp())
        .patch(`/api/parcels/${VALID_UUID_1}/status`)
        .send({ status: 'shipped' });
      expect(res.status).toBe(404);
    });

    test('change le statut, sync le scan, journalise et évalue les règles de liaison', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: VALID_UUID_1, order_id: VALID_UUID_2, status: 'preparation', external_code: 'EXT-1' }] })
        .mockResolvedValueOnce({ rows: [{ id: VALID_UUID_1, status: 'shipped' }] }) // SELECT parcel
        .mockResolvedValueOnce({ rows: [{ id: VALID_UUID_2, status: 'confirmed', computed_status: 'shipped' }] }); // SELECT order

      const res = await request(buildApp())
        .patch(`/api/parcels/${VALID_UUID_1}/status`)
        .send({ status: 'shipped' });

      expect(res.status).toBe(200);
      expect(safeSyncScanToParcels).toHaveBeenCalledWith(expect.objectContaining({ step: 'shipped' }));
      expect(parcelSecurity.logParcelEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event_type: 'status_changed' }));
      expect(res.body.order).toEqual({ id: VALID_UUID_2, status: 'confirmed', computed_status: 'shipped' });
    });

    test('order est null si la commande liée est introuvable', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: VALID_UUID_1, order_id: VALID_UUID_2, status: 'preparation', external_code: 'EXT-1' }] })
        .mockResolvedValueOnce({ rows: [{ id: VALID_UUID_1, status: 'collected' }] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(buildApp())
        .patch(`/api/parcels/${VALID_UUID_1}/status`)
        .send({ status: 'collected' });

      expect(res.body.order).toBeNull();
    });
  });

  describe('POST /:id/weight', () => {
    test('400 si weight_kg absent ou non numérique', async () => {
      const res = await request(buildApp()).post(`/api/parcels/${VALID_UUID_1}/weight`).send({});
      expect(res.status).toBe(400);
    });

    test('404 si colis introuvable', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(buildApp())
        .post(`/api/parcels/${VALID_UUID_1}/weight`)
        .send({ weight_kg: 3.5 });
      expect(res.status).toBe(404);
    });

    test('enregistre un checkpoint poids sans anomalie', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: VALID_UUID_1, last_weight_kg: 3.0, external_code: 'EXT-1' }] })
        .mockResolvedValueOnce({ rows: [] }); // UPDATE

      const res = await request(buildApp())
        .post(`/api/parcels/${VALID_UUID_1}/weight`)
        .send({ weight_kg: 3.2, location: 'hub' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.anomaly).toBeNull();
    });

    test('signale une anomalie de poids (status=warning)', async () => {
      parcelSecurity.checkWeightIntegrity.mockReturnValueOnce({ message: 'écart suspect' });
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: VALID_UUID_1, last_weight_kg: 3.0, external_code: 'EXT-1' }] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(buildApp())
        .post(`/api/parcels/${VALID_UUID_1}/weight`)
        .send({ weight_kg: 9.9 });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('warning');
      expect(res.body.anomaly).toEqual({ message: 'écart suspect' });
      expect(parcelSecurity.logParcelEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event_type: 'anomaly_detected' }));
    });

    // ── XREL-01 : garde cross-relais ────────────────────────────────────
    test('[XREL-01] agent_relais sur colis d\'une commande d\'un AUTRE relais → 403, UPDATE jamais exécuté', async () => {
      mockUser = { id: 'agent-1', role: 'agent_relais', relais_id: 'relais-A' };
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: VALID_UUID_1, last_weight_kg: 3.0, external_code: 'EXT-1', relais_id: 'relais-B' }] });

      const res = await request(buildApp())
        .post(`/api/parcels/${VALID_UUID_1}/weight`)
        .send({ weight_kg: 3.2 });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/relais/);
      // Une seule requête (la lecture) — le garde bloque AVANT tout UPDATE.
      expect(mockDbQuery).toHaveBeenCalledTimes(1);
    });

    test('[XREL-01] agent_relais sur colis de SON PROPRE relais → autorisé (continue)', async () => {
      mockUser = { id: 'agent-1', role: 'agent_relais', relais_id: 'relais-A' };
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: VALID_UUID_1, last_weight_kg: 3.0, external_code: 'EXT-1', relais_id: 'relais-A' }] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(buildApp())
        .post(`/api/parcels/${VALID_UUID_1}/weight`)
        .send({ weight_kg: 3.2 });

      expect(res.status).toBe(200);
    });
  });

  describe('POST /:id/verify-seal', () => {
    // Helper : mock des 2 requêtes de rate-limit XREL-02 (DELETE puis INSERT..RETURNING)
    // en plus de la lecture du colis, dans l'ordre où le handler les émet.
    function mockRateLimitOk() {
      mockDbQuery
        .mockResolvedValueOnce({}) // DELETE FROM pickup_verify_attempts (cleanup)
        .mockResolvedValueOnce({ rows: [{ count: 1, reset_at: new Date(Date.now() + 15 * 60 * 1000) }] }); // INSERT..RETURNING
    }

    test('400 si seal_code absent', async () => {
      const res = await request(buildApp()).post(`/api/parcels/${VALID_UUID_1}/verify-seal`).send({});
      expect(res.status).toBe(400);
    });

    test('404 si colis introuvable', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(buildApp())
        .post(`/api/parcels/${VALID_UUID_1}/verify-seal`)
        .send({ seal_code: 'X' });
      expect(res.status).toBe(404);
    });

    test('scellé valide → 200', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: VALID_UUID_1, seal_code: 'SEAL-1', external_code: 'EXT-1', relais_id: null }] });
      mockRateLimitOk();
      parcelSecurity.verifySeal.mockReturnValueOnce({ valid: true });

      const res = await request(buildApp())
        .post(`/api/parcels/${VALID_UUID_1}/verify-seal`)
        .send({ seal_code: 'SEAL-1' });

      expect(res.status).toBe(200);
      expect(res.body.seal_valid).toBe(true);
    });

    test('scellé invalide (mismatch) → 422 avec message alerte', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: VALID_UUID_1, seal_code: 'SEAL-1', external_code: 'EXT-1', relais_id: null }] });
      mockRateLimitOk();
      parcelSecurity.verifySeal.mockReturnValueOnce({ valid: false, reason: 'seal_mismatch' });

      const res = await request(buildApp())
        .post(`/api/parcels/${VALID_UUID_1}/verify-seal`)
        .send({ seal_code: 'FAUX' });

      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/ALERTE/);
    });

    test('scellé manquant → 422 avec message générique', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: VALID_UUID_1, seal_code: null, external_code: 'EXT-1', relais_id: null }] });
      mockRateLimitOk();
      parcelSecurity.verifySeal.mockReturnValueOnce({ valid: false, reason: 'seal_missing' });

      const res = await request(buildApp())
        .post(`/api/parcels/${VALID_UUID_1}/verify-seal`)
        .send({ seal_code: 'X' });

      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/manquant/);
    });

    // ── XREL-02 : garde cross-relais ────────────────────────────────────
    test('[XREL-02] agent_relais sur colis d\'une commande d\'un AUTRE relais → 403, verifySeal jamais appelé', async () => {
      mockUser = { id: 'agent-1', role: 'agent_relais', relais_id: 'relais-A' };
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: VALID_UUID_1, seal_code: 'SEAL-1', external_code: 'EXT-1', relais_id: 'relais-B' }] });

      const res = await request(buildApp())
        .post(`/api/parcels/${VALID_UUID_1}/verify-seal`)
        .send({ seal_code: 'SEAL-1' });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/relais/);
      expect(parcelSecurity.verifySeal).not.toHaveBeenCalled();
      // Le rate-limit ne doit même pas être consulté après un 403 IDOR.
      expect(mockDbQuery).toHaveBeenCalledTimes(1);
    });

    test('[XREL-02] agent_relais sur colis de SON PROPRE relais → autorisé (continue)', async () => {
      mockUser = { id: 'agent-1', role: 'agent_relais', relais_id: 'relais-A' };
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: VALID_UUID_1, seal_code: 'SEAL-1', external_code: 'EXT-1', relais_id: 'relais-A' }] });
      mockRateLimitOk();
      parcelSecurity.verifySeal.mockReturnValueOnce({ valid: true });

      const res = await request(buildApp())
        .post(`/api/parcels/${VALID_UUID_1}/verify-seal`)
        .send({ seal_code: 'SEAL-1' });

      expect(res.status).toBe(200);
    });

    // ── XREL-02 : rate-limit (oracle de scellé) ─────────────────────────
    test('[XREL-02] trop de tentatives → 429, verifySeal jamais appelé', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: VALID_UUID_1, seal_code: 'SEAL-1', external_code: 'EXT-1', relais_id: null }] })
        .mockResolvedValueOnce({}) // DELETE cleanup
        .mockResolvedValueOnce({ rows: [{ count: 999, reset_at: new Date(Date.now() + 5 * 60 * 1000) }] }); // limite dépassée

      const res = await request(buildApp())
        .post(`/api/parcels/${VALID_UUID_1}/verify-seal`)
        .send({ seal_code: 'SEAL-1' });

      expect(res.status).toBe(429);
      expect(res.body.retryAfter).toBeGreaterThan(0);
      expect(parcelSecurity.verifySeal).not.toHaveBeenCalled();
    });
  });

  describe('POST /:id/items', () => {
    test('400 si order_item_id/quantity invalides (validate réel)', async () => {
      const res = await request(buildApp())
        .post(`/api/parcels/${VALID_UUID_1}/items`)
        .send({ order_item_id: 'pas-uuid', quantity: 0 });
      expect(res.status).toBe(400);
    });

    test('404 si colis introuvable', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(buildApp())
        .post(`/api/parcels/${VALID_UUID_1}/items`)
        .send({ order_item_id: VALID_UUID_2, quantity: 1 });
      expect(res.status).toBe(404);
    });

    test('404 si order_item introuvable', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: VALID_UUID_1, order_id: VALID_UUID_2 }] })
        .mockResolvedValueOnce({ rows: [] });
      const res = await request(buildApp())
        .post(`/api/parcels/${VALID_UUID_1}/items`)
        .send({ order_item_id: VALID_UUID_2, quantity: 1 });
      expect(res.status).toBe(404);
    });

    test('ajoute un article au colis', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: VALID_UUID_1, order_id: VALID_UUID_2 }] })
        .mockResolvedValueOnce({ rows: [{ id: VALID_UUID_2 }] })
        .mockResolvedValueOnce({ rows: [{ id: 'pi1', quantity: 2 }] });

      const res = await request(buildApp())
        .post(`/api/parcels/${VALID_UUID_1}/items`)
        .send({ order_item_id: VALID_UUID_2, quantity: 2 });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: 'pi1', quantity: 2 });
    });

    test('409 si l\'article est déjà assigné à un colis (contrainte unique)', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: VALID_UUID_1, order_id: VALID_UUID_2 }] })
        .mockResolvedValueOnce({ rows: [{ id: VALID_UUID_2 }] });
      mockDbQuery.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505', constraint: 'unique_order_item_per_parcel' }));

      const res = await request(buildApp())
        .post(`/api/parcels/${VALID_UUID_1}/items`)
        .send({ order_item_id: VALID_UUID_2, quantity: 1 });

      expect(res.status).toBe(409);
    });
  });

  describe('DELETE /:id/items/:item_id', () => {
    test('404 si article de colis introuvable', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(buildApp()).delete(`/api/parcels/${VALID_UUID_1}/items/${VALID_UUID_2}`);
      expect(res.status).toBe(404);
    });

    test('retire un article du colis', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: VALID_UUID_2 }] });
      const res = await request(buildApp()).delete(`/api/parcels/${VALID_UUID_1}/items/${VALID_UUID_2}`);
      expect(res.status).toBe(200);
      expect(res.body.deleted).toEqual({ id: VALID_UUID_2 });
    });
  });

  describe('endpoints démantelés (DOUANE_DECLARATION_PIVOT)', () => {
    test('POST /optimize renvoie 410 Gone', async () => {
      const res = await request(buildApp()).post('/api/parcels/optimize');
      expect(res.status).toBe(410);
    });

    test('POST /bootstrap/:orderId renvoie 410 Gone', async () => {
      const res = await request(buildApp()).post(`/api/parcels/bootstrap/${VALID_UUID_1}`);
      expect(res.status).toBe(410);
    });

    test('les endpoints démantelés restent réservés admin/agent_hub', async () => {
      mockUser = { id: 'agent-1', role: 'agent_relais' };
      const res = await request(buildApp()).post('/api/parcels/optimize');
      expect(res.status).toBe(403);
    });
  });
});
