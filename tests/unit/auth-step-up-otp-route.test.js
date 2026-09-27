'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/auth-step-up-otp-route.test.js
 *
 * Tests du router routes/auth-step-up-otp.js (AUTH-7b — step-up OTP).
 *
 * Couverture :
 *   POST /request : 409 si pas de téléphone sur le compte, TEST MODE
 *     court-circuit sans écriture DB, cooldown 5min → 429, fenêtre 15min
 *     → 429, succès → insert otp_codes + sendOtpMessage vers le téléphone
 *     DU COMPTE (jamais un téléphone fourni par le client)
 *   POST /verify  : 400 si code non 6 chiffres, 409 si pas de téléphone,
 *     TEST MODE (code maître) → cookie de session ré-émis, otp introuvable/
 *     expiré → 401, max tentatives → 429, code incorrect → 401 + tentatives
 *     restantes, succès → cookie de session avec method='otp'
 */

process.env.JWT_SECRET = 'test-secret-stable-32-characters-minimum';

let mockUser = { id: 'user-1', full_name: 'Ibrahim Diallo', phone: '+237600000001', role: 'market_operator' };

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (!mockUser) return res.status(401).json({ error: 'unauthorized' });
    req.user = mockUser;
    next();
  },
}));

jest.mock('../../db', () => ({ query: jest.fn() }));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.mock('../../services/notification-service', () => ({
  sendOtpMessage: jest.fn().mockResolvedValue({ success: true, channel: 'whatsapp' }),
}));

const bcrypt = require('bcryptjs');
jest.mock('bcryptjs', () => ({
  hash: jest.fn(async () => 'hashed-code'),
  compare: jest.fn(async () => true),
}));

const otpTestMode = require('../../services/otp-test-mode');
jest.mock('../../services/otp-test-mode', () => ({
  isOtpTestMode: jest.fn(() => false),
  getMasterCode: jest.fn(() => '424242'),
  isMasterCode: jest.fn(() => false),
}));

const mockSetAuthCookie = jest.fn();
jest.mock('../../utils/auth-cookie', () => ({
  setAuthCookie: (...args) => mockSetAuthCookie(...args),
}));

const mockSignAuthToken = jest.fn(() => 'signed.jwt.token');
jest.mock('../../utils/auth-session', () => ({
  signAuthToken: (...args) => mockSignAuthToken(...args),
}));

const express = require('express');
const request = require('supertest');
const db = require('../../db');
const notif = require('../../services/notification-service');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'user-1', full_name: 'Ibrahim Diallo', phone: '+237600000001', role: 'market_operator' };
  bcrypt.hash.mockResolvedValue('hashed-code');
  bcrypt.compare.mockResolvedValue(true);
  otpTestMode.isOtpTestMode.mockReturnValue(false);
  otpTestMode.isMasterCode.mockReturnValue(false);
  otpTestMode.getMasterCode.mockReturnValue('424242');
  process.env.NODE_ENV = 'test';
  delete process.env.OTP_DEV_ECHO;

  app = express();
  app.use(express.json());
  jest.isolateModules(() => {
    const router = require('../../routes/auth-step-up-otp');
    app.use('/api/auth/step-up/otp', router);
  });
  app.use((err, req, res, _next) => res.status(500).json({ error: err.message }));
});

describe('POST /request', () => {
  it('401 si non authentifié', async () => {
    mockUser = null;
    const res = await request(app).post('/api/auth/step-up/otp/request');
    expect(res.status).toBe(401);
  });

  it('409 si aucun téléphone sur le compte — jamais accepté depuis le body', async () => {
    mockUser = { id: 'user-1', full_name: 'Aicha Said', phone: null, role: 'market_operator' };
    const res = await request(app)
      .post('/api/auth/step-up/otp/request')
      .send({ phone: '+269000000000' }); // un téléphone fourni par le client doit être ignoré
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('step_up_otp_no_phone');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('TEST MODE : court-circuite sans écriture DB, renvoie le code maître', async () => {
    otpTestMode.isOtpTestMode.mockReturnValue(true);
    const res = await request(app).post('/api/auth/step-up/otp/request');
    expect(res.status).toBe(200);
    expect(res.body._test.code).toBe('424242');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('429 si un OTP a été demandé il y a moins de 5 minutes', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ created_at: new Date().toISOString() }] });
    const res = await request(app).post('/api/auth/step-up/otp/request');
    expect(res.status).toBe(429);
    expect(res.body.retryAfter).toBeGreaterThan(0);
  });

  it("429 si la fenêtre de 15 minutes a atteint le maximum de demandes", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] }) // pas de cooldown récent
      .mockResolvedValueOnce({ rows: [{ count: 3 }] }); // fenêtre pleine
    const res = await request(app).post('/api/auth/step-up/otp/request');
    expect(res.status).toBe(429);
  });

  it('succès : insère un OTP purpose=step_up et envoie au téléphone DU COMPTE, jamais un autre', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rowCount: 0 }) // invalidation des anciens OTP
      .mockResolvedValueOnce({ rowCount: 1 }); // insert

    const res = await request(app)
      .post('/api/auth/step-up/otp/request')
      .send({ phone: '+000000000000' }); // ignoré : le service utilise mockUser.phone

    expect(res.status).toBe(200);
    expect(notif.sendOtpMessage).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+237600000001', name: 'Ibrahim Diallo' })
    );
    const insertCall = db.query.mock.calls.find(c => /INSERT INTO otp_codes/.test(c[0]));
    expect(insertCall[1]).toEqual(expect.arrayContaining(['+237600000001', 'hashed-code', 'step_up']));
  });
});

describe('POST /verify', () => {
  it('401 si non authentifié', async () => {
    mockUser = null;
    const res = await request(app).post('/api/auth/step-up/otp/verify').send({ code: '123456' });
    expect(res.status).toBe(401);
  });

  it('400 si le code ne fait pas 6 chiffres', async () => {
    const res = await request(app).post('/api/auth/step-up/otp/verify').send({ code: 'abc' });
    expect(res.status).toBe(400);
  });

  it('409 si aucun téléphone sur le compte', async () => {
    mockUser = { id: 'user-1', full_name: 'Aicha Said', phone: null, role: 'market_operator' };
    const res = await request(app).post('/api/auth/step-up/otp/verify').send({ code: '123456' });
    expect(res.status).toBe(409);
  });

  it('TEST MODE (code maître) : ré-émet le cookie de session sans toucher la DB', async () => {
    otpTestMode.isMasterCode.mockReturnValue(true);
    const res = await request(app).post('/api/auth/step-up/otp/verify').send({ code: '424242' });
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(mockSignAuthToken).toHaveBeenCalledWith(
      mockUser,
      expect.objectContaining({ method: 'otp', phone: '+237600000001' })
    );
    expect(mockSetAuthCookie).toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });

  it('401 si aucun OTP step_up non expiré trouvé', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/auth/step-up/otp/verify').send({ code: '123456' });
    expect(res.status).toBe(401);
    expect(mockSetAuthCookie).not.toHaveBeenCalled();
  });

  it('429 + invalidation si le nombre max de tentatives est atteint', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'otp-1', code: 'hashed-code', attempts: 5 }] })
      .mockResolvedValueOnce({ rowCount: 1 }); // invalidation
    const res = await request(app).post('/api/auth/step-up/otp/verify').send({ code: '123456' });
    expect(res.status).toBe(429);
  });

  it('401 + tentatives restantes si le code est incorrect', async () => {
    bcrypt.compare.mockResolvedValueOnce(false);
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'otp-1', code: 'hashed-code', attempts: 1 }] })
      .mockResolvedValueOnce({ rowCount: 1 }); // increment attempts
    const res = await request(app).post('/api/auth/step-up/otp/verify').send({ code: '123456' });
    expect(res.status).toBe(401);
    expect(res.body.remainingAttempts).toBe(3);
  });

  it('succès : marque consommé et ré-émet la session avec method=otp', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'otp-1', code: 'hashed-code', attempts: 0 }] })
      .mockResolvedValueOnce({ rowCount: 1 }) // increment attempts
      .mockResolvedValueOnce({ rowCount: 1 }); // marque consommé

    const res = await request(app).post('/api/auth/step-up/otp/verify').send({ code: '123456' });
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(mockSignAuthToken).toHaveBeenCalledWith(
      mockUser,
      expect.objectContaining({ method: 'otp', phone: '+237600000001' })
    );
    expect(mockSetAuthCookie).toHaveBeenCalledWith(expect.anything(), 'signed.jwt.token');
  });
});
