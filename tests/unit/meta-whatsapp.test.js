'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/meta-whatsapp.test.js
 *
 * Tests du router routes/meta-whatsapp.js (Lot C, AUDIT_TEST_COVERAGE_GLOBAL_2026-07-03.md).
 *
 * routes/meta-whatsapp.js était à 0 % — aucun test. Fichier sensible :
 * webhook public avec vérification HMAC-SHA256 (X-Hub-Signature-256), et
 * un fail-fast module-level (process.exit(1) si META_WA_APP_SECRET absent,
 * cf. commentaire "P4-2" dans le fichier source — même doctrine que
 * JWT_SECRET dans routes/auth.js).
 *
 * Couverture :
 *   ✓ fail-fast : process.exit(1) si META_WA_APP_SECRET absent au chargement du module
 *   ✓ GET /webhook/meta-whatsapp  : handshake Meta (mode/token/challenge), 403 si token invalide
 *   ✓ POST /webhook/meta-whatsapp : signature manquante/malformée → 403
 *                                    longueur de signature invalide → 403 (avant timingSafeEqual)
 *                                    signature de mauvaise valeur mais bonne longueur → 403
 *                                    signature valide → 200
 *                                    erreur interne (log.info qui jette) → 500
 */

const crypto = require('crypto');

const TEST_SECRET = 'test-meta-app-secret';
const TEST_VERIFY_TOKEN = 'test-verify-token';

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('../../utils/logger', () => ({ child: () => mockLog }));

const express = require('express');
const request = require('supertest');

function sign(bodyObj, secret = TEST_SECRET) {
  const raw = JSON.stringify(bodyObj);
  return 'sha256=' + crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
}

let app;
let originalSecret;
let originalToken;

beforeAll(() => {
  originalSecret = process.env.META_WA_APP_SECRET;
  originalToken = process.env.META_WA_VERIFY_TOKEN;
});

afterAll(() => {
  process.env.META_WA_APP_SECRET = originalSecret;
  process.env.META_WA_VERIFY_TOKEN = originalToken;
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.META_WA_APP_SECRET = TEST_SECRET;
  process.env.META_WA_VERIFY_TOKEN = TEST_VERIFY_TOKEN;

  app = express();
  app.use(express.json());
  jest.isolateModules(() => {
    const router = require('../../routes/meta-whatsapp');
    app.use('/', router);
  });
});

describe('meta-whatsapp — fail-fast au chargement', () => {
  it('process.exit(1) si META_WA_APP_SECRET absent', () => {
    delete process.env.META_WA_APP_SECRET;
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    jest.isolateModules(() => {
      require('../../routes/meta-whatsapp');
    });

    expect(mockLog.error).toHaveBeenCalledWith(
      expect.stringContaining('META_WA_APP_SECRET manquant')
    );
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    process.env.META_WA_APP_SECRET = TEST_SECRET;
  });
});

describe('GET /webhook/meta-whatsapp (handshake)', () => {
  it('mode=subscribe + token correct → 200 + challenge renvoyé tel quel', async () => {
    const res = await request(app)
      .get('/webhook/meta-whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': TEST_VERIFY_TOKEN, 'hub.challenge': 'CHALLENGE123' });
    expect(res.status).toBe(200);
    expect(res.text).toBe('CHALLENGE123');
  });

  it('token incorrect → 403', async () => {
    const res = await request(app)
      .get('/webhook/meta-whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong-token', 'hub.challenge': 'X' });
    expect(res.status).toBe(403);
  });

  it("mode différent de 'subscribe' → 403", async () => {
    const res = await request(app)
      .get('/webhook/meta-whatsapp')
      .query({ 'hub.mode': 'unsubscribe', 'hub.verify_token': TEST_VERIFY_TOKEN, 'hub.challenge': 'X' });
    expect(res.status).toBe(403);
  });

  it('paramètres absents → 403', async () => {
    const res = await request(app).get('/webhook/meta-whatsapp');
    expect(res.status).toBe(403);
  });
});

describe('meta-whatsapp — branches de repli (defaults)', () => {
  it("META_WA_VERIFY_TOKEN absent → fallback sur le token par défaut 'komerce_meta_verify_token'", async () => {
    delete process.env.META_WA_VERIFY_TOKEN;
    let localApp;
    jest.isolateModules(() => {
      const router = require('../../routes/meta-whatsapp');
      localApp = express();
      localApp.use(express.json());
      localApp.use('/', router);
    });

    const res = await request(localApp)
      .get('/webhook/meta-whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'komerce_meta_verify_token', 'hub.challenge': 'C1' });

    expect(res.status).toBe(200);
    expect(res.text).toBe('C1');

    process.env.META_WA_VERIFY_TOKEN = TEST_VERIFY_TOKEN;
  });

  it('req.body falsy (pas de parsing JSON) → fallback {} sans planter', async () => {
    const goodSig = sign({});
    const res = await request(app)
      .post('/webhook/meta-whatsapp')
      .set('Content-Type', 'text/plain')
      .set('X-Hub-Signature-256', goodSig)
      .send('');
    expect(res.status).toBe(200);
    expect(mockLog.info).toHaveBeenCalledWith({
      event_type: 'unknown', entry_count: 0, message_count: 0,
      status_count: 0, statuses: [], wamids: [],
    }, '[META-WA][WEBHOOK]');
  });
});

describe('POST /webhook/meta-whatsapp (signature HMAC)', () => {
  const payload = { object: 'whatsapp_business_account', entry: [{ id: 'e1', changes: [] }] };

  it('signature absente → 403 "Signature Meta manquante"', async () => {
    const res = await request(app).post('/webhook/meta-whatsapp').send(payload);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Signature Meta manquante' });
  });

  it("signature sans préfixe 'sha256=' → 403 \"Signature Meta manquante\"", async () => {
    const res = await request(app)
      .post('/webhook/meta-whatsapp')
      .set('X-Hub-Signature-256', 'deadbeef')
      .send(payload);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Signature Meta manquante' });
  });

  it('signature de longueur invalide → 403 "Signature Meta invalide" (avant comparaison)', async () => {
    const res = await request(app)
      .post('/webhook/meta-whatsapp')
      .set('X-Hub-Signature-256', 'sha256=trop-court')
      .send(payload);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Signature Meta invalide' });
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('longueur invalide'));
  });

  it('signature de bonne longueur mais fausse valeur (mauvais secret) → 403', async () => {
    const badSig = sign(payload, 'un-autre-secret-de-meme-taille');
    const res = await request(app)
      .post('/webhook/meta-whatsapp')
      .set('X-Hub-Signature-256', badSig)
      .send(payload);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Signature Meta invalide' });
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('HMAC invalide'));
  });

  it('signature valide → 200, journalise uniquement le résumé technique', async () => {
    const goodSig = sign(payload);
    const res = await request(app)
      .post('/webhook/meta-whatsapp')
      .set('X-Hub-Signature-256', goodSig)
      .send(payload);
    expect(res.status).toBe(200);
    expect(mockLog.info).toHaveBeenCalledWith({
      event_type: 'unknown', entry_count: 1, message_count: 0,
      status_count: 0, statuses: [], wamids: [],
    }, '[META-WA][WEBHOOK]');
  });

  it('un message client signé ne révèle ni téléphone, ni nom, ni contenu dans les logs', async () => {
    const phone = '+2693991234';
    const name = 'Client Test Sensible';
    const message = 'Mon message privé et confidentiel';
    const body = {
      object: 'whatsapp_business_account',
      entry: [{ id: 'wa-account-private', changes: [{
        field: 'messages',
        value: {
          metadata: { display_phone_number: phone, phone_number_id: phone },
          contacts: [{ profile: { name }, wa_id: phone }],
          messages: [{ from: phone, id: 'wamid.HBgMQUJDREVGR0g', type: 'text', text: { body: message } }],
        },
      }] }],
    };
    const res = await request(app)
      .post('/webhook/meta-whatsapp')
      .set('X-Hub-Signature-256', sign(body))
      .send(body);
    expect(res.status).toBe(200);
    expect(mockLog.info).toHaveBeenCalledWith({
      event_type: 'messages', entry_count: 1, message_count: 1,
      status_count: 0, statuses: [], wamids: ['wamid.HBgMQUJDREVGR0g'],
    }, '[META-WA][WEBHOOK]');
    const emitted = JSON.stringify(mockLog.info.mock.calls);
    for (const secret of [phone, name, message, 'wa-account-private']) {
      expect(emitted).not.toContain(secret);
    }
  });

  it('un statut signé ne révèle pas le destinataire, le nom ou un texte arbitraire', async () => {
    const phone = '+2693991234';
    const privateText = 'Ne jamais journaliser ce contenu';
    const body = {
      entry: [{ changes: [{ value: {
        statuses: [
          { id: 'wamid.HBgMQUJDREVGR0g', status: 'delivered', recipient_id: phone },
          { id: 'not-a-wamid-' + phone, status: privateText, recipient_id: phone },
        ],
        contacts: [{ profile: { name: privateText } }],
      } }] }],
    };
    const res = await request(app)
      .post('/webhook/meta-whatsapp')
      .set('X-Hub-Signature-256', sign(body))
      .send(body);
    expect(res.status).toBe(200);
    expect(mockLog.info).toHaveBeenCalledWith({
      event_type: 'statuses', entry_count: 1, message_count: 0,
      status_count: 2, statuses: ['delivered'], wamids: ['wamid.HBgMQUJDREVGR0g'],
    }, '[META-WA][WEBHOOK]');
    const emitted = JSON.stringify(mockLog.info.mock.calls);
    expect(emitted).not.toContain(phone);
    expect(emitted).not.toContain(privateText);
  });

  it('une signature invalide ne journalise aucun événement, même si le payload contient des données privées', async () => {
    const body = { entry: [{ changes: [{ value: { messages: [{ from: '+2693991234', text: { body: 'PRIVATE' } }] } }] }] };
    const res = await request(app)
      .post('/webhook/meta-whatsapp')
      .set('X-Hub-Signature-256', sign({ not: 'this body' }))
      .send(body);
    expect(res.status).toBe(403);
    expect(mockLog.info).not.toHaveBeenCalled();
  });

  it('signature valide mais erreur interne (log.info jette) → 500 via catch', async () => {
    mockLog.info.mockImplementationOnce(() => { throw new Error('log broken'); });
    const goodSig = sign(payload);
    const res = await request(app)
      .post('/webhook/meta-whatsapp')
      .set('X-Hub-Signature-256', goodSig)
      .send(payload);
    expect(res.status).toBe(500);
    expect(mockLog.error).toHaveBeenCalled();
  });
});
