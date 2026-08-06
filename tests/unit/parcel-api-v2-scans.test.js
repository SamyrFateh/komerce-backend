'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/parcel-api-v2-scans.test.js
 * Tests unitaires de la route POST /:ref/scan de routes/parcel-api-v2/scans.js
 * — Bloc 6.
 *
 * scan-engine et notification-service sont require() dynamiquement DANS le
 * handler (pas en haut du fichier) — jest.mock fonctionne quand même car
 * l'interception se fait au niveau du registre de modules, indépendamment
 * du point d'appel de require().
 */

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  forModule: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

const dbQueries = [];
jest.mock('../../db', () => ({
  query: jest.fn(async (sql, params) => {
    dbQueries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    return { rows: [] };
  }),
}));

jest.mock('../../services/scan-engine', () => ({
  processScan: jest.fn(),
}));

jest.mock('../../services/notification-service', () => ({
  notifyParcelScan: jest.fn().mockResolvedValue({}),
}));

const express      = require('express');
const request      = require('supertest');
const db           = require('../../db');
const scanEngine   = require('../../services/scan-engine');
const notif        = require('../../services/notification-service');

let app;
let cached, setCache, clearCache;

beforeEach(() => {
  db.query.mockReset();
  scanEngine.processScan.mockReset();
  notif.notifyParcelScan.mockReset();
  notif.notifyParcelScan.mockResolvedValue({});
  dbQueries.length = 0;

  db.query.mockImplementation(async (sql, params) => {
    dbQueries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    return { rows: [] };
  });

  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (req.headers['x-test-role']) {
      req.user = {
        id: req.headers['x-test-user-id'] || 'u1',
        role: req.headers['x-test-role'],
        full_name: req.headers['x-test-name'] || 'Agent Test',
      };
    }
    next();
  });
  // Le router et helpers.js doivent venir de la MÊME instance de module
  // (sinon le _cache mémoire de helpers.js diffère entre le test et le router).
  jest.isolateModules(() => {
    const router  = require('../../routes/parcel-api-v2/scans');
    const helpers = require('../../routes/parcel-api-v2/helpers');
    cached     = helpers.cached;
    setCache   = helpers.setCache;
    clearCache = helpers.clearCache;
    app.use('/api/v2/parcels', router);
  });
  clearCache();
});

afterAll(() => { if (clearCache) clearCache(); });

function setParcelQuery(parcel) {
  db.query.mockImplementationOnce(async (sql, params) => {
    dbQueries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    return { rows: parcel ? [parcel] : [] };
  });
}

describe('POST /:ref/scan — validation', () => {
  test('400 si event_type absent du body', async () => {
    const res = await request(app).post('/api/v2/parcels/P1/scan').send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'event_type requis' });
    expect(db.query).not.toHaveBeenCalled();
  });

  test('404 si le colis n’existe pas', async () => {
    setParcelQuery(null);
    const res = await request(app).post('/api/v2/parcels/INCONNU/scan').send({ event_type: 'shipped' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Colis INCONNU introuvable' });
  });

  test('400 si event_type inconnu (hors mapping V2_TO_ENGINE_EVENT)', async () => {
    setParcelQuery({ id: 'PID1', reference: 'P1', status: 'preparation' });
    const res = await request(app).post('/api/v2/parcels/P1/scan').send({ event_type: 'teleported' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('event_type inconnu: teleported');
    expect(scanEngine.processScan).not.toHaveBeenCalled();
  });
});

describe('POST /:ref/scan — mapping event_type → scan-engine', () => {
  test.each([
    ['preparation', 'packed'],
    ['shipped', 'shipped'],
    ['in_transit', 'transit_confirmed'],
    ['arrived', 'relais_received'],
    ['available', 'relais_received'],
    ['collected', 'customer_collected'],
  ])('event_type=%s → engine event_type=%s', async (v2Type, engineType) => {
    setParcelQuery({ id: 'PID1', reference: 'P1', status: 'preparation' });
    scanEngine.processScan.mockResolvedValueOnce({ success: true, event_id: 'EV1', parcel: { status: 'x' } });

    await request(app).post('/api/v2/parcels/P1/scan').send({ event_type: v2Type });

    expect(scanEngine.processScan).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: engineType })
    );
  });
});

describe('POST /:ref/scan — résolution actor', () => {
  test('actor_role explicite dans le body est prioritaire sur le rôle déduit', async () => {
    setParcelQuery({ id: 'PID1', reference: 'P1', status: 'preparation' });
    scanEngine.processScan.mockResolvedValueOnce({ success: true, event_id: 'EV1', parcel: { status: 'shipped' } });

    await request(app)
      .post('/api/v2/parcels/P1/scan')
      .set('x-test-role', 'agent_hub')
      .send({ event_type: 'shipped', actor_role: 'override_role' });

    expect(scanEngine.processScan).toHaveBeenCalledWith(
      expect.objectContaining({ actor_role: 'override_role' })
    );
  });

  test('role agent_hub → actor_role déduit "hub_agent" si non fourni', async () => {
    setParcelQuery({ id: 'PID1', reference: 'P1', status: 'preparation' });
    scanEngine.processScan.mockResolvedValueOnce({ success: true, event_id: 'EV1', parcel: { status: 'shipped' } });

    await request(app).post('/api/v2/parcels/P1/scan').set('x-test-role', 'agent_hub').send({ event_type: 'shipped' });

    expect(scanEngine.processScan).toHaveBeenCalledWith(
      expect.objectContaining({ actor_role: 'hub_agent' })
    );
  });

  test('role agent_relais → actor_role déduit "relay_agent"', async () => {
    setParcelQuery({ id: 'PID1', reference: 'P1', status: 'preparation' });
    scanEngine.processScan.mockResolvedValueOnce({ success: true, event_id: 'EV1', parcel: { status: 'shipped' } });

    await request(app).post('/api/v2/parcels/P1/scan').set('x-test-role', 'agent_relais').send({ event_type: 'shipped' });

    expect(scanEngine.processScan).toHaveBeenCalledWith(
      expect.objectContaining({ actor_role: 'relay_agent' })
    );
  });

  test('aucun req.user → actor_role "system", scanned_by null', async () => {
    setParcelQuery({ id: 'PID1', reference: 'P1', status: 'preparation' });
    scanEngine.processScan.mockResolvedValueOnce({ success: true, event_id: 'EV1', parcel: { status: 'shipped' } });

    await request(app).post('/api/v2/parcels/P1/scan').send({ event_type: 'shipped' });

    expect(scanEngine.processScan).toHaveBeenCalledWith(
      expect.objectContaining({ actor_role: 'system', scanned_by: null })
    );
  });

  test('actor_name fourni explicitement prioritaire sur req.user.full_name', async () => {
    setParcelQuery({ id: 'PID1', reference: 'P1', status: 'preparation' });
    scanEngine.processScan.mockResolvedValueOnce({ success: true, event_id: 'EV1', parcel: { status: 'shipped' } });

    await request(app)
      .post('/api/v2/parcels/P1/scan')
      .set('x-test-role', 'agent_hub')
      .set('x-test-name', 'Nom Du Token')
      .send({ event_type: 'shipped', actor_name: 'Nom Explicite' });

    expect(scanEngine.processScan).toHaveBeenCalledWith(
      expect.objectContaining({ actor_name: 'Nom Explicite' })
    );
  });

  test('aucun actor_name ni req.user.full_name → fallback "Système"', async () => {
    setParcelQuery({ id: 'PID1', reference: 'P1', status: 'preparation' });
    scanEngine.processScan.mockResolvedValueOnce({ success: true, event_id: 'EV1', parcel: { status: 'shipped' } });

    await request(app).post('/api/v2/parcels/P1/scan').send({ event_type: 'shipped' });

    expect(scanEngine.processScan).toHaveBeenCalledWith(
      expect.objectContaining({ actor_name: 'Système' })
    );
  });
});

describe('POST /:ref/scan — succès', () => {
  test('200 avec scan/parcel/catchup_events/incidents, vide cache, notifie en fire-and-forget', async () => {
    setParcelQuery({ id: 'PID1', reference: 'P1', status: 'preparation' });
    setCache('parcel_kpis', { stale: true }); // pour vérifier le clearCache() après succès

    scanEngine.processScan.mockResolvedValueOnce({
      success: true,
      event_id: 'EV1',
      parcel: { status: 'shipped' },
      catchup_events: [{ event_type: 'packed' }],
      incidents: [],
    });

    const res = await request(app).post('/api/v2/parcels/P1/scan').send({ event_type: 'shipped', location: 'Hub', notes: 'ok' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      scan: { id: 'EV1', event_type: 'shipped' },
      parcel: { reference: 'P1', old_status: 'preparation', new_status: 'shipped' },
      catchup_events: [{ event_type: 'packed' }],
      incidents: [],
    });

    // le cache mémoire (partagé avec read.js /kpis) doit être vidé après un scan réussi
    expect(cached('parcel_kpis')).toBeNull();
  });

  test('notifyParcelScan est appelé avec le nouveau statut (fire-and-forget, ne bloque pas la réponse)', async () => {
    setParcelQuery({ id: 'PID1', reference: 'P1', status: 'preparation' });
    scanEngine.processScan.mockResolvedValueOnce({ success: true, event_id: 'EV1', parcel: { status: 'shipped' } });

    await request(app).post('/api/v2/parcels/P1/scan').send({ event_type: 'shipped' });

    expect(notif.notifyParcelScan).toHaveBeenCalledWith('PID1', 'P1', 'shipped');
  });

  test('si notifyParcelScan échoue (promise rejetée), la requête répond quand même 200', async () => {
    setParcelQuery({ id: 'PID1', reference: 'P1', status: 'preparation' });
    scanEngine.processScan.mockResolvedValueOnce({ success: true, event_id: 'EV1', parcel: { status: 'shipped' } });
    notif.notifyParcelScan.mockRejectedValueOnce(new Error('notif down'));

    const res = await request(app).post('/api/v2/parcels/P1/scan').send({ event_type: 'shipped' });

    expect(res.status).toBe(200);
  });

  test('result.parcel.status absent → notifyParcelScan reçoit l’event_type engine en fallback', async () => {
    setParcelQuery({ id: 'PID1', reference: 'P1', status: 'preparation' });
    scanEngine.processScan.mockResolvedValueOnce({ success: true, event_id: 'EV1', parcel: {} });

    await request(app).post('/api/v2/parcels/P1/scan').send({ event_type: 'shipped' });

    expect(notif.notifyParcelScan).toHaveBeenCalledWith('PID1', 'P1', 'shipped'); // engineEventType fallback
  });
});

describe('POST /:ref/scan — rejet par le moteur de séquence (I-03)', () => {
  test('409 si processScan renvoie success=false, avec le titre du premier incident', async () => {
    setParcelQuery({ id: 'PID1', reference: 'P1', status: 'collected' });
    scanEngine.processScan.mockResolvedValueOnce({
      success: false,
      incidents: [{ title: 'Transition non autorisée: collected → shipped' }],
    });

    const res = await request(app).post('/api/v2/parcels/P1/scan').send({ event_type: 'shipped' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: 'Transition non autorisée: collected → shipped',
      incidents: [{ title: 'Transition non autorisée: collected → shipped' }],
    });
    expect(notif.notifyParcelScan).not.toHaveBeenCalled();
  });

  test('409 avec message générique si aucun incident fourni', async () => {
    setParcelQuery({ id: 'PID1', reference: 'P1', status: 'collected' });
    scanEngine.processScan.mockResolvedValueOnce({ success: false });

    const res = await request(app).post('/api/v2/parcels/P1/scan').send({ event_type: 'shipped' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Scan rejeté par le moteur de séquence');
    expect(res.body.incidents).toEqual([]);
  });

  test('échec du moteur ne vide PAS le cache (clearCache uniquement sur succès)', async () => {
    setCache('parcel_kpis', { kept: true });
    setParcelQuery({ id: 'PID1', reference: 'P1', status: 'collected' });
    scanEngine.processScan.mockResolvedValueOnce({ success: false, incidents: [] });

    await request(app).post('/api/v2/parcels/P1/scan').send({ event_type: 'shipped' });

    expect(cached('parcel_kpis')).toEqual({ kept: true });
  });
});

describe('POST /:ref/scan — erreurs', () => {
  test('erreur DB sur la résolution du colis → 500', async () => {
    db.query.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).post('/api/v2/parcels/P1/scan').send({ event_type: 'shipped' });
    expect(res.status).toBe(500);
  });

  test('erreur levée par scan-engine → 500 via next(err)', async () => {
    setParcelQuery({ id: 'PID1', reference: 'P1', status: 'preparation' });
    scanEngine.processScan.mockRejectedValueOnce(new Error('engine crash'));
    const res = await request(app).post('/api/v2/parcels/P1/scan').send({ event_type: 'shipped' });
    expect(res.status).toBe(500);
  });
});
