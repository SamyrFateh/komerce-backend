/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * @komerce-arch
 * @role          notification-routes-tests-branches
 * @domain        notification
 * @layer         test
 * @criticality   medium
 * @inputs        express route fixtures
 * @outputs       jest assertions
 * @depends       routes/notification-api.js, routes/meta-whatsapp.js, routes/alerts.js
 * @used-by       feature-guard, jest
 * @doctrine      notification_non_bloquante, provider_adapter_isole
 * @impact-areas  notifications, alerts, webhooks, tests, governance
 * @version       2026-06
 */
'use strict';

/**
 * Complète tests/notifications/notification-api-meta-whatsapp-alerts.test.js
 * en couvrant les branches restées à 0% :
 *   - alerts.js       : POST /run, POST /:id/ack (succès + 404), erreurs -> next(err)
 *   - meta-whatsapp.js: verifyMetaSignature (signature manquante/malformée/invalide/valide),
 *                       GET webhook refusé (403), POST webhook succès + erreur (500),
 *                       arrêt du process si META_WA_APP_SECRET absent au chargement
 *   - notification-api.js : GET /stats (succès + table absente + erreur), GET / erreur -> next(err)
 *
 * IMPORTANT — piège évité : jest.resetModules() en dehors de jest.isolateModules()
 * invalide silencieusement la référence `db` importée en haut de fichier (le
 * mock jest.mock('../../db') est ré-instancié par un nouveau require), ce qui
 * décorrèle les mockResolvedValueOnce() des appels réels des tests suivants.
 * Le seul endroit qui a besoin d'un rechargement de module (arrêt du process
 * si secret absent) passe donc par jest.isolateModules(), qui restaure le
 * registre global automatiquement en sortie de callback.
 */

const express = require('express');
const request = require('supertest');
const crypto = require('crypto');

jest.mock('../../middleware/auth', () => ({
  // Header de test 'x-no-user' pour exercer le fallback `req.user?.full_name || 'admin'`
  // sans dupliquer un routeur/registre de modules isolé.
  authenticate: (req, _res, next) => {
    if (!req.headers['x-no-user']) { req.user = { full_name: 'Admin Test' }; }
    next();
  },
  requireAdmin: (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));

jest.mock('../../db', () => ({
  query: jest.fn(),
}));

jest.mock('../../services/alert-engine', () => ({
  getActiveAlerts: jest.fn(),
  runAll: jest.fn(),
  acknowledgeAlert: jest.fn(),
}));

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();
jest.mock('../../utils/logger', () => ({
  child: () => ({
    info: (...a) => mockLogInfo(...a),
    warn: (...a) => mockLogWarn(...a),
    error: (...a) => mockLogError(...a),
  }),
}));

const db = require('../../db');
const AlertEngine = require('../../services/alert-engine');

// meta-whatsapp.js lit META_WA_APP_SECRET / META_WA_VERIFY_TOKEN une seule
// fois au chargement du module — on les fixe donc AVANT le premier require,
// une bonne fois pour toutes, puis on garde la même instance de router.
process.env.META_WA_APP_SECRET = 'test-secret';
process.env.META_WA_VERIFY_TOKEN = 'verify-token';
const WA_SECRET = process.env.META_WA_APP_SECRET;
const metaWhatsappRouter = require('../../routes/meta-whatsapp');

function appWith(router, { withErrorHandler = true } = {}) {
  const app = express();
  app.use(express.json());
  app.use(router);
  if (withErrorHandler) {
    // Capture explicitement les next(err) pour vérifier qu'ils sont bien déclenchés
    app.use((err, _req, res, _next) => res.status(599).json({ forwarded: err.message || String(err) }));
  }
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('alerts route — POST /run', () => {
  it('lance la détection et retourne le décompte des nouvelles alertes', async () => {
    AlertEngine.runAll.mockResolvedValueOnce([{ id: 'new-1' }, { id: 'new-2' }]);
    AlertEngine.getActiveAlerts.mockResolvedValueOnce([{ id: 'new-1' }, { id: 'new-2' }, { id: 'old-1' }]);
    const router = require('../../routes/alerts');

    const res = await request(appWith(router)).post('/run');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message: 'Détection terminée — 2 nouvelle(s) alerte(s)',
      new_alerts: 2,
      total_active: 3,
      alerts: [{ id: 'new-1' }, { id: 'new-2' }, { id: 'old-1' }],
    });
  });

  it("transmet l'erreur à next(err) si AlertEngine.runAll échoue", async () => {
    AlertEngine.runAll.mockRejectedValueOnce(new Error('détection en échec'));
    const router = require('../../routes/alerts');

    const res = await request(appWith(router)).post('/run');

    expect(res.status).toBe(599);
    expect(res.body).toEqual({ forwarded: 'détection en échec' });
  });
});

describe('alerts route — POST /:id/ack', () => {
  it("acquitte une alerte existante avec le nom de l'admin connecté", async () => {
    AlertEngine.acknowledgeAlert.mockResolvedValueOnce({ id: 'a1', status: 'acknowledged' });
    const router = require('../../routes/alerts');

    const res = await request(appWith(router)).post('/a1/ack');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Alerte acquittée', alert: { id: 'a1', status: 'acknowledged' } });
    expect(AlertEngine.acknowledgeAlert).toHaveBeenCalledWith('a1', 'Admin Test');
  });

  it("404 si l'alerte est introuvable ou déjà traitée", async () => {
    AlertEngine.acknowledgeAlert.mockResolvedValueOnce(null);
    const router = require('../../routes/alerts');

    const res = await request(appWith(router)).post('/unknown/ack');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Alerte non trouvée ou déjà traitée' });
  });

  it("transmet l'erreur à next(err) si AlertEngine.acknowledgeAlert échoue", async () => {
    AlertEngine.acknowledgeAlert.mockRejectedValueOnce(new Error('DB down'));
    const router = require('../../routes/alerts');

    const res = await request(appWith(router)).post('/a1/ack');

    expect(res.status).toBe(599);
    expect(res.body).toEqual({ forwarded: 'DB down' });
  });
});

describe('alerts route — POST /:id/ack — fallback identité', () => {
  it("utilise 'admin' par défaut si req.user est absent", async () => {
    AlertEngine.acknowledgeAlert.mockResolvedValueOnce({ id: 'a1', status: 'acknowledged' });
    const router = require('../../routes/alerts');

    const res = await request(appWith(router))
      .post('/a1/ack')
      .set('x-no-user', '1');

    expect(res.status).toBe(200);
    expect(AlertEngine.acknowledgeAlert).toHaveBeenCalledWith('a1', 'admin');
  });
});

describe('alerts route — GET / erreur', () => {
  it("transmet l'erreur à next(err) si AlertEngine.getActiveAlerts échoue", async () => {
    AlertEngine.getActiveAlerts.mockRejectedValueOnce(new Error('boom'));
    const router = require('../../routes/alerts');

    const res = await request(appWith(router)).get('/');

    expect(res.status).toBe(599);
    expect(res.body).toEqual({ forwarded: 'boom' });
  });
});

describe('meta-whatsapp webhook route — verifyMetaSignature', () => {
  function sign(body) {
    return 'sha256=' + crypto.createHmac('sha256', WA_SECRET).update(JSON.stringify(body), 'utf8').digest('hex');
  }

  it('403 si le header X-Hub-Signature-256 est absent', async () => {
    const res = await request(appWith(metaWhatsappRouter)).post('/webhook/meta-whatsapp').send({ foo: 'bar' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Signature Meta manquante' });
  });

  it('403 si le header ne commence pas par "sha256="', async () => {
    const res = await request(appWith(metaWhatsappRouter))
      .post('/webhook/meta-whatsapp')
      .set('X-Hub-Signature-256', 'md5=abcdef')
      .send({ foo: 'bar' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Signature Meta manquante' });
  });

  it('403 "Signature Meta invalide" si la longueur du buffer de signature ne correspond pas', async () => {
    const res = await request(appWith(metaWhatsappRouter))
      .post('/webhook/meta-whatsapp')
      .set('X-Hub-Signature-256', 'sha256=trop-court')
      .send({ foo: 'bar' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Signature Meta invalide' });
  });

  it('403 "Signature Meta invalide" si la signature a la bonne longueur mais un contenu incorrect', async () => {
    const body = { foo: 'bar' };
    const wrongSig = sign({ foo: 'different-payload-x' }); // même longueur, mauvais contenu
    const res = await request(appWith(metaWhatsappRouter))
      .post('/webhook/meta-whatsapp')
      .set('X-Hub-Signature-256', wrongSig)
      .send(body);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Signature Meta invalide' });
  });

  it('200 si la signature HMAC est valide et transmet le corps au handler', async () => {
    const body = { entry: [{ id: 'wamid-1' }] };
    const res = await request(appWith(metaWhatsappRouter))
      .post('/webhook/meta-whatsapp')
      .set('X-Hub-Signature-256', sign(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(mockLogInfo).toHaveBeenCalled();
  });

  it('500 si le handler échoue après une signature valide (ex: erreur de log)', async () => {
    mockLogInfo.mockImplementationOnce(() => { throw new Error('log indisponible'); });

    const body = { entry: [{ id: 'wamid-2' }] };
    const res = await request(appWith(metaWhatsappRouter))
      .post('/webhook/meta-whatsapp')
      .set('X-Hub-Signature-256', sign(body))
      .send(body);

    expect(res.status).toBe(500);
    expect(mockLogError).toHaveBeenCalled();
  });

  it('utilise req.rawBody pour la signature si présent (au lieu de re-sérialiser req.body)', async () => {
    const app = express();
    app.use(express.json({
      verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); },
    }));
    app.use(metaWhatsappRouter);

    const body = { entry: [{ id: 'wamid-3' }] };
    const rawBody = JSON.stringify(body);
    const sig = 'sha256=' + crypto.createHmac('sha256', WA_SECRET).update(rawBody, 'utf8').digest('hex');

    const res = await request(app)
      .post('/webhook/meta-whatsapp')
      .set('X-Hub-Signature-256', sig)
      .send(body);

    expect(res.status).toBe(200);
  });
});

describe('meta-whatsapp webhook route — GET vérification refusée', () => {
  it('403 si le verify_token ne correspond pas', async () => {
    const res = await request(appWith(metaWhatsappRouter, { withErrorHandler: false }))
      .get('/webhook/meta-whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong-token', 'hub.challenge': 'xyz' });

    expect(res.status).toBe(403);
  });

  it('403 si mode absent ou différent de "subscribe"', async () => {
    const res = await request(appWith(metaWhatsappRouter, { withErrorHandler: false }))
      .get('/webhook/meta-whatsapp')
      .query({ 'hub.verify_token': 'verify-token', 'hub.challenge': 'xyz' });

    expect(res.status).toBe(403);
  });

  it('200 + renvoie le challenge si mode et token correspondent', async () => {
    const res = await request(appWith(metaWhatsappRouter, { withErrorHandler: false }))
      .get('/webhook/meta-whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-token', 'hub.challenge': 'xyz-42' });

    expect(res.status).toBe(200);
    expect(res.text).toBe('xyz-42');
  });
});

describe('meta-whatsapp module — démarrage sans META_WA_APP_SECRET', () => {
  it('logue une erreur fatale et arrête le process si META_WA_APP_SECRET est absent', () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    const originalSecret = process.env.META_WA_APP_SECRET;
    delete process.env.META_WA_APP_SECRET;

    try {
      // jest.isolateModules restaure automatiquement le registre global en
      // sortie de callback : aucune fuite vers `db`/`AlertEngine` importés
      // plus haut dans ce fichier.
      jest.isolateModules(() => {
        require('../../routes/meta-whatsapp');
      });
    } finally {
      process.env.META_WA_APP_SECRET = originalSecret;
    }

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockLogError).toHaveBeenCalledWith(expect.stringContaining('FATAL'));
    exitSpy.mockRestore();
  });
});

describe('notification-api route — GET /stats', () => {
  it('retourne les totaux et répartitions par canal/événement', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ channel: 'whatsapp', status: 'sent', count: 5 }] }) // byChannel
      .mockResolvedValueOnce({ rows: [{ event: 'payment_confirmed', count: 3 }] }) // byEvent
      .mockResolvedValueOnce({ rows: [{ total: 5, sent: 5, failed: 0, links: 0, whatsapp: 5, email: 0, sms: 0 }] }); // totals

    const router = require('../../routes/notification-api');
    const res = await request(appWith(router)).get('/stats');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      totals: { total: 5, sent: 5, failed: 0, links: 0, whatsapp: 5, email: 0, sms: 0 },
      by_channel: [{ channel: 'whatsapp', status: 'sent', count: 5 }],
      by_event: [{ event: 'payment_confirmed', count: 3 }],
    });
  });

  it("retourne une réponse vide si la table notification_log n'existe pas encore", async () => {
    db.query.mockRejectedValueOnce({ code: '42P01' });

    const router = require('../../routes/notification-api');
    const res = await request(appWith(router)).get('/stats');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      totals: {},
      by_channel: [],
      by_event: [],
      warning: 'Table not yet created',
    });
  });

  it('transmet une erreur inattendue (non 42P01) à next(err)', async () => {
    db.query.mockRejectedValueOnce(new Error('connexion DB perdue'));

    const router = require('../../routes/notification-api');
    const res = await request(appWith(router)).get('/stats');

    expect(res.status).toBe(599);
    expect(res.body).toEqual({ forwarded: 'connexion DB perdue' });
  });
});

describe('notification-api route — GET / filtres', () => {
  it('construit la clause WHERE avec tous les filtres fournis (parcel_ref, order_ref, channel, event)', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const router = require('../../routes/notification-api');
    const res = await request(appWith(router)).get('/').query({
      parcel_ref: 'KOM-P-2026-000001',
      order_ref: 'KOM-2026-000042',
      channel: 'whatsapp',
      event: 'payment_confirmed',
      limit: '5',
    });

    expect(res.status).toBe(200);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('WHERE parcel_ref = $1 AND order_ref = $2 AND channel = $3 AND event = $4');
    expect(params).toEqual(['KOM-P-2026-000001', 'KOM-2026-000042', 'whatsapp', 'payment_confirmed']);
  });

  it('plafonne la limite à 200 même si un limit plus grand est demandé', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const router = require('../../routes/notification-api');
    await request(appWith(router)).get('/').query({ limit: '9999' });

    const [sql] = db.query.mock.calls[0];
    expect(sql).toContain('LIMIT 200');
  });
});

describe('notification-api route — GET / erreur inattendue', () => {
  it('transmet une erreur non 42P01 à next(err)', async () => {
    db.query.mockRejectedValueOnce(new Error('connexion DB perdue'));

    const router = require('../../routes/notification-api');
    const res = await request(appWith(router)).get('/');

    expect(res.status).toBe(599);
    expect(res.body).toEqual({ forwarded: 'connexion DB perdue' });
  });
});
