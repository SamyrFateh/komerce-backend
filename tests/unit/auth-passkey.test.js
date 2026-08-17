'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Couvre services/webauthn-service.js + routes/auth-passkey.js (AUTH-2).
 * La crypto/CBOR elle-même n'est PAS re-testée ici (déléguée à
 * @simplewebauthn/server, cf. règle d'or du lot) — on mocke les 4 fonctions
 * generate.../verify... de la lib et on teste que NOTRE code applique
 * correctement les 10 invariants (challenge, ceremony, user binding,
 * signCount, révocation, unicité).
 */

const mockGenerateRegistrationOptions = jest.fn();
const mockVerifyRegistrationResponse = jest.fn();
const mockGenerateAuthenticationOptions = jest.fn();
const mockVerifyAuthenticationResponse = jest.fn();

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: (...a) => mockGenerateRegistrationOptions(...a),
  verifyRegistrationResponse: (...a) => mockVerifyRegistrationResponse(...a),
  generateAuthenticationOptions: (...a) => mockGenerateAuthenticationOptions(...a),
  verifyAuthenticationResponse: (...a) => mockVerifyAuthenticationResponse(...a),
}));

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const { isoBase64URL } = require('@simplewebauthn/server/helpers');

function fakeClientDataJSON(challenge, type = 'webauthn.create') {
  const json = JSON.stringify({ type, challenge, origin: 'https://komerce.shop' });
  return isoBase64URL.fromUTF8String(json);
}

describe('services/webauthn-service', () => {
  let webauthn;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.WEBAUTHN_RP_ID = 'komerce.shop';
    process.env.WEBAUTHN_ORIGINS = 'https://komerce.shop';
    webauthn = require('../../services/webauthn-service');
  });

  // ── Invariant #1 — challenge à usage unique ──────────────────────────
  it('un challenge déjà consommé est rejeté (rejeu)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE ... RETURNING → rien trouvé (déjà consommé)
    const result = await webauthn._consumeChallenge({ challenge: 'used-one', ceremonyType: 'login' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('challenge_invalid_or_expired');
  });

  // ── Invariant #2 — challenge expiré ───────────────────────────────────
  it('un challenge expiré est rejeté (même requête que le rejeu — TTL en SQL)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // expires_at > NOW() échoue côté SQL
    const result = await webauthn._consumeChallenge({ challenge: 'expired-one', ceremonyType: 'register' });
    expect(result.ok).toBe(false);
  });

  // ── Invariant #3 — challenge lié au bon user ──────────────────────────
  it('registration verify : challenge d\'un autre user → rejeté', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'chal-1', user_id: 'user-B', ceremony_type: 'register' }],
    });
    const response = {
      id: 'cred-1',
      response: { clientDataJSON: fakeClientDataJSON('chal-abc') },
    };
    const result = await webauthn.verifyRegistration({ userId: 'user-A', response });
    expect(result.verified).toBe(false);
    expect(result.error).toBe('user_mismatch');
    expect(mockVerifyRegistrationResponse).not.toHaveBeenCalled();
  });

  // ── Invariant #4 & #5 — origin/rpID viennent de la config serveur ────
  it('registration verify : expectedOrigin/expectedRPID viennent de la config, pas du client', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'chal-1', user_id: 'user-A', ceremony_type: 'register' }] })
      .mockResolvedValueOnce({ rows: [] }); // _findCredentialByCredentialId → pas de doublon

    mockVerifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: { id: 'cred-1', publicKey: new Uint8Array([1, 2, 3]), counter: 0 },
        aaguid: 'aaguid-1',
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
      },
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT

    const response = {
      id: 'cred-1',
      response: { clientDataJSON: fakeClientDataJSON('chal-abc'), transports: ['internal'] },
      origin: 'https://evil.example', // le client PEUT prétendre ce qu'il veut — ignoré
    };
    const result = await webauthn.verifyRegistration({ userId: 'user-A', response });

    expect(result.verified).toBe(true);
    expect(mockVerifyRegistrationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOrigin: ['https://komerce.shop'],
        expectedRPID: 'komerce.shop',
        requireUserVerification: true,
      })
    );
  });

  // ── Invariant #6 — séparation des cérémonies ──────────────────────────
  it('une réponse register envoyée à login/verify est rejetée (ceremony mismatch)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'chal-1', user_id: 'user-A', ceremony_type: 'register' }],
    });
    const result = await webauthn._consumeChallenge({ challenge: 'chal-abc', ceremonyType: 'login' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('ceremony_mismatch');
  });

  // ── Invariant #7 — UV réellement demandé à la lib (pas seulement "preferred") ──
  it('login verify : requireUserVerification=true est toujours passé à la lib', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'row-1', user_id: 'user-A', credential_id: 'cred-1',
          public_key: isoBase64URL.fromBuffer(new Uint8Array([9, 9, 9])),
          sign_count: 0, transports: [], backup_eligible: false, backup_state: false, revoked_at: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'chal-1', user_id: null, ceremony_type: 'login' }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE sign_count

    mockVerifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 1 },
    });

    const response = { id: 'cred-1', response: { clientDataJSON: fakeClientDataJSON('chal-abc', 'webauthn.get') } };
    const result = await webauthn.verifyLogin({ response });

    expect(result.verified).toBe(true);
    expect(mockVerifyAuthenticationResponse).toHaveBeenCalledWith(
      expect.objectContaining({ requireUserVerification: true })
    );
  });

  // ── Invariant #8 — politique signCount ────────────────────────────────
  it('signCount : régression rejetée pour une credential non sauvegardée', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'row-1', user_id: 'user-A', credential_id: 'cred-1',
          public_key: isoBase64URL.fromBuffer(new Uint8Array([9, 9, 9])),
          sign_count: 10, transports: [], backup_eligible: false, backup_state: false, revoked_at: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'chal-1', user_id: null, ceremony_type: 'login' }] });

    mockVerifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 3 }, // < 10 stocké → régression
    });

    const response = { id: 'cred-1', response: { clientDataJSON: fakeClientDataJSON('chal-abc', 'webauthn.get') } };
    const result = await webauthn.verifyLogin({ response });

    expect(result.verified).toBe(false);
    expect(result.error).toBe('sign_count_regression');
  });

  it('signCount : régression tolérée pour une passkey synchronisée (backup_state=true)', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'row-1', user_id: 'user-A', credential_id: 'cred-1',
          public_key: isoBase64URL.fromBuffer(new Uint8Array([9, 9, 9])),
          sign_count: 10, transports: [], backup_eligible: true, backup_state: true, revoked_at: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'chal-1', user_id: null, ceremony_type: 'login' }] })
      .mockResolvedValueOnce({ rows: [] });

    mockVerifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 0 },
    });

    const response = { id: 'cred-1', response: { clientDataJSON: fakeClientDataJSON('chal-abc', 'webauthn.get') } };
    const result = await webauthn.verifyLogin({ response });

    expect(result.verified).toBe(true);
  });

  // ── Invariant #9 — unicité credential_id ──────────────────────────────
  it('un credential_id déjà enregistré est rejeté', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'chal-1', user_id: 'user-A', ceremony_type: 'register' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'existing-row' }] }); // doublon trouvé

    mockVerifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: { id: 'cred-dup', publicKey: new Uint8Array([1]), counter: 0 },
        aaguid: null,
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
      },
    });

    const response = { id: 'cred-dup', response: { clientDataJSON: fakeClientDataJSON('chal-abc'), transports: [] } };
    const result = await webauthn.verifyRegistration({ userId: 'user-A', response });

    expect(result.verified).toBe(false);
    expect(result.error).toBe('credential_already_registered');
  });

  // ── Invariant #10 — révocation ─────────────────────────────────────────
  it('une credential revoked_at non nul est refusée au login', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'row-1', user_id: 'user-A', credential_id: 'cred-1',
        public_key: 'anything', sign_count: 5, transports: [],
        backup_eligible: false, backup_state: false, revoked_at: new Date().toISOString(),
      }],
    });

    const response = { id: 'cred-1', response: { clientDataJSON: fakeClientDataJSON('chal-abc', 'webauthn.get') } };
    const result = await webauthn.verifyLogin({ response });

    expect(result.verified).toBe(false);
    expect(result.error).toBe('credential_revoked');
    expect(mockVerifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  it('login : credential inconnue → rejetée sans appeler la lib', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const response = { id: 'unknown-cred', response: { clientDataJSON: fakeClientDataJSON('chal-abc', 'webauthn.get') } };
    const result = await webauthn.verifyLogin({ response });
    expect(result.verified).toBe(false);
    expect(result.error).toBe('unknown_credential');
    expect(mockVerifyAuthenticationResponse).not.toHaveBeenCalled();
  });
});

describe('routes/auth-passkey', () => {
  let app;
  let currentUser;
  let currentAuth;
  const express = require('express');
  const request = require('supertest');

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    currentUser = null;
    currentAuth = null;
    process.env.WEBAUTHN_RP_ID = 'komerce.shop';
    process.env.WEBAUTHN_ORIGINS = 'https://komerce.shop';
    process.env.JWT_SECRET = 'test_secret_min_32_chars_aaaaaaaaaaaaaaaa';

    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = currentUser; req.auth = currentAuth; next(); });

    jest.isolateModules(() => {
      jest.doMock('../../middleware/auth', () => ({
        authenticate: (req, res, next) => {
          if (!req.user) return res.status(401).json({ error: 'unauthorized' });
          next();
        },
      }));
      const router = require('../../routes/auth-passkey');
      app.use('/api/auth/passkey', router);
    });
  });

  it('register/options sans session → 401 (K1 minimum requis)', async () => {
    const res = await request(app).post('/api/auth/passkey/register/options').send({});
    expect(res.status).toBe(401);
  });

  it('register/verify sans session → 401', async () => {
    const res = await request(app).post('/api/auth/passkey/register/verify').send({ id: 'x' });
    expect(res.status).toBe(401);
  });

  it('register/options avec session mais sans preuve récente → 428 step_up_required', async () => {
    currentUser = { id: 'user-A', role: 'client' };
    const res = await request(app).post('/api/auth/passkey/register/options').send({});
    expect(res.status).toBe(428);
    expect(res.body.code).toBe('step_up_required');
  });

  it('register/verify avec réponse malformée après preuve OTP récente → 400', async () => {
    currentUser = { id: 'user-A', role: 'client' };
    currentAuth = { authTime: Math.floor(Date.now() / 1000), amr: ['otp'] };
    const res = await request(app).post('/api/auth/passkey/register/verify').send({});
    expect(res.status).toBe(400);
  });

  it('login/verify avec réponse malformée (public) → 400', async () => {
    const res = await request(app).post('/api/auth/passkey/login/verify').send({});
    expect(res.status).toBe(400);
  });

  it('login/options est public (pas de session requise)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockGenerateAuthenticationOptions.mockResolvedValue({ challenge: 'chal-xyz' });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // insert challenge
    const res = await request(app).post('/api/auth/passkey/login/options').send({});
    expect(res.status).toBe(200);
  });
});
