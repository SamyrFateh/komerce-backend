'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/otp-route.test.js
 *
 * Tests du router routes/otp.js (Lot B1 — Auth/identité).
 *
 * Couverture :
 *   POST /request : phone manquant, format invalide, purpose invalide,
 *     TEST MODE court-circuit, cooldown 5min → 429, fenêtre 15min → 429,
 *     succès → insert otp_codes + sendOtpMessage
 *   POST /verify  : phone/code manquants, code non 6 chiffres, purpose
 *     invalide, TEST MODE (code maître) → session immédiate, otp introuvable/
 *     expiré → 401, max tentatives atteint → 429 + invalidation, code
 *     incorrect → 401 + tentatives restantes, succès → session (user
 *     existant / nouveau compte léger)
 *   POST /test-reset : 404 hors mode test, succès sans phone, succès avec
 *     phone → purge otp_codes + users légers
 */

process.env.JWT_SECRET = 'test-secret-stable-32-characters-minimum';

jest.mock('../../db', () => ({ query: jest.fn() }));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.mock('../../utils/phone', () => ({
  normalizePhone: jest.fn((raw) => {
    if (!raw) return null;
    const s = String(raw).trim();
    if (/^\+\d{8,15}$/.test(s)) return s;
    if (/^\d{6,9}$/.test(s)) return '+269' + s;
    return null;
  }),
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

const express = require('express');
const request = require('supertest');
const db = require('../../db');
const notif = require('../../services/notification-service');

let app;

beforeEach(() => {
  jest.clearAllMocks();
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
    const router = require('../../routes/otp');
    app.use('/api/auth/otp', router);
  });
  app.use((err, req, res, _next) => res.status(500).json({ error: err.message }));
});

// ═══════════════════════════════════════════════════════════════════════
describe('POST /request', () => {
  it('400 si phone manquant', async () => {
    const res = await request(app).post('/api/auth/otp/request').send({});
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('400 si format de numéro invalide', async () => {
    const res = await request(app).post('/api/auth/otp/request').send({ phone: 'abc' });
    expect(res.status).toBe(400);
  });

  it('400 si purpose invalide', async () => {
    const res = await request(app).post('/api/auth/otp/request').send({ phone: '+269111111', purpose: 'hacking' });
    expect(res.status).toBe(400);
  });

  it('TEST MODE → court-circuit, renvoie le code maître', async () => {
    otpTestMode.isOtpTestMode.mockReturnValue(true);
    const res = await request(app).post('/api/auth/otp/request').send({ phone: '+269111111' });
    expect(res.status).toBe(200);
    expect(res.body._test.code).toBe('424242');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('429 si cooldown actif (code envoyé < 5 min)', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ created_at: new Date().toISOString() }] });
    const res = await request(app).post('/api/auth/otp/request').send({ phone: '+269111111' });
    expect(res.status).toBe(429);
    expect(res.body.retryAfter).toBeGreaterThan(0);
  });

  it('429 si fenêtre 15min dépassée (3 demandes max)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })           // pas de cooldown
      .mockResolvedValueOnce({ rows: [{ count: 3 }] }); // fenêtre déjà à 3
    const res = await request(app).post('/api/auth/otp/request').send({ phone: '+269111111' });
    expect(res.status).toBe(429);
  });

  it('succès → insert otp_codes + envoi WhatsApp', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })          // cooldown
      .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // fenêtre
      .mockResolvedValueOnce({ rows: [] })          // UPDATE anciens codes
      .mockResolvedValueOnce({ rows: [] })          // INSERT otp_codes
      .mockResolvedValueOnce({ rows: [{ full_name: 'Ali' }] }); // findUserByPhone

    const res = await request(app).post('/api/auth/otp/request').send({ phone: '+269111111' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(notif.sendOtpMessage).toHaveBeenCalledWith(expect.objectContaining({
      phone: '+269111111', name: 'Ali',
    }));
  });

  it('erreur DB inattendue → next(err) → 500', async () => {
    db.query.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).post('/api/auth/otp/request').send({ phone: '+269111111' });
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('POST /verify', () => {
  it('400 si phone ou code manquant', async () => {
    const res = await request(app).post('/api/auth/otp/verify').send({ phone: '+269111111' });
    expect(res.status).toBe(400);
  });

  it('400 si code non 6 chiffres', async () => {
    const res = await request(app).post('/api/auth/otp/verify').send({ phone: '+269111111', code: '123' });
    expect(res.status).toBe(400);
  });

  it('400 si purpose invalide', async () => {
    const res = await request(app).post('/api/auth/otp/verify').send({ phone: '+269111111', code: '123456', purpose: 'hacking' });
    expect(res.status).toBe(400);
  });

  it('TEST MODE (code maître) → session immédiate sans DB', async () => {
    otpTestMode.isMasterCode.mockReturnValue(true);
    db.query.mockResolvedValueOnce({ rows: [{ id: 'u1', full_name: 'Ali', phone: '+269111111', role: 'client' }] });
    const res = await request(app).post('/api/auth/otp/verify').send({ phone: '+269111111', code: '424242' });
    expect(res.status).toBe(200);
    expect(res.body._test.mode).toBe(true);
    expect(res.headers['set-cookie'][0]).toMatch(/kmrc_jwt=/);
  });

  it('401 si aucun code en attente / expiré', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/auth/otp/verify').send({ phone: '+269111111', code: '123456' });
    expect(res.status).toBe(401);
  });

  it('429 si max tentatives atteint → invalide le code', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'otp-1', code: 'hash', attempts: 5 }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE verified=TRUE
    const res = await request(app).post('/api/auth/otp/verify').send({ phone: '+269111111', code: '123456' });
    expect(res.status).toBe(429);
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it('401 si code incorrect → tentatives restantes', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'otp-1', code: 'hash', attempts: 1 }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE attempts+1
    bcrypt.compare.mockResolvedValueOnce(false);
    const res = await request(app).post('/api/auth/otp/verify').send({ phone: '+269111111', code: '123456' });
    expect(res.status).toBe(401);
    expect(res.body.remainingAttempts).toBe(3);
  });

  it('succès → user existant → session + created:false', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'otp-1', code: 'hash', attempts: 0 }] })
      .mockResolvedValueOnce({ rows: [] })          // UPDATE attempts+1
      .mockResolvedValueOnce({ rows: [] })          // UPDATE verified=TRUE
      .mockResolvedValueOnce({ rows: [{ id: 'u1', full_name: 'Ali', phone: '+269111111', role: 'client' }] }); // findUserByPhone

    const res = await request(app).post('/api/auth/otp/verify').send({ phone: '+269111111', code: '123456' });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(false);
    expect(res.body.user.id).toBe('u1');
    expect(res.headers['set-cookie'][0]).toMatch(/kmrc_jwt=/);
  });

  it('succès → nouveau compte léger → created:true', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'otp-1', code: 'hash', attempts: 0 }] })
      .mockResolvedValueOnce({ rows: [] })          // UPDATE attempts+1
      .mockResolvedValueOnce({ rows: [] })          // UPDATE verified=TRUE
      .mockResolvedValueOnce({ rows: [] })          // findUserByPhone → aucun
      .mockResolvedValueOnce({ rows: [{ id: 'u2', full_name: 'Client', phone: '+269111111', role: 'client' }] }); // createLightweightUser

    const res = await request(app).post('/api/auth/otp/verify').send({ phone: '+269111111', code: '123456', name: 'Nouveau' });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(true);
  });

  it('erreur DB inattendue → next(err) → 500', async () => {
    db.query.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).post('/api/auth/otp/verify').send({ phone: '+269111111', code: '123456' });
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('POST /test-reset', () => {
  it('404 hors mode test', async () => {
    const res = await request(app).post('/api/auth/otp/test-reset').send({});
    expect(res.status).toBe(404);
  });

  it('succès sans phone → cookie effacé, pas de purge', async () => {
    otpTestMode.isOtpTestMode.mockReturnValue(true);
    const res = await request(app).post('/api/auth/otp/test-reset').send({});
    expect(res.status).toBe(200);
    expect(res.body.purged).toBeNull();
    expect(res.headers['set-cookie'][0]).toMatch(/kmrc_jwt=;/);
  });

  it('succès avec phone → purge otp_codes + users légers', async () => {
    otpTestMode.isOtpTestMode.mockReturnValue(true);
    db.query
      .mockResolvedValueOnce({ rows: [] })                          // DELETE otp_codes
      .mockResolvedValueOnce({ rows: [{ id: 'u1' }, { id: 'u2' }] }); // DELETE users RETURNING

    const res = await request(app).post('/api/auth/otp/test-reset').send({ phone: '+269111111' });
    expect(res.status).toBe(200);
    expect(res.body.purged).toEqual({ phone: '+269111111', deletedUsers: 2 });
  });
});
