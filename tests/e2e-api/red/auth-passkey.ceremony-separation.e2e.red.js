'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * E2E-P0-PASSKEY-CEREMONY-RED — auth-passkey · séparation register/login
 *
 * Contrat sécurité : un challenge WebAuthn émis pour une cérémonie ne peut
 * jamais être utilisé dans une autre cérémonie. `register` et `login` sont
 * des frontières distinctes, même si le challenge et la credential existent.
 *
 * FRONTIÈRE CRYPTO CONTRÔLÉE — et seulement elle :
 * @simplewebauthn/server génère/vérifie les objets WebAuthn. Routes Express,
 * middleware auth/recent-auth, service Komerce, PostgreSQL, stockage et
 * consommation des challenges restent réels.
 */

const request = require('supertest');
const express = require('express');

const mockGenerateRegistrationOptions = jest.fn();
const mockVerifyRegistrationResponse = jest.fn();
const mockGenerateAuthenticationOptions = jest.fn();
const mockVerifyAuthenticationResponse = jest.fn();

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: (...args) => mockGenerateRegistrationOptions(...args),
  verifyRegistrationResponse: (...args) => mockVerifyRegistrationResponse(...args),
  generateAuthenticationOptions: (...args) => mockGenerateAuthenticationOptions(...args),
  verifyAuthenticationResponse: (...args) => mockVerifyAuthenticationResponse(...args),
}));

const { describeE2E, createCleanup, tag, uuid } = require('../../helpers/e2eDbKit');

jest.setTimeout(60000);

describeE2E('E2E-P0-PASSKEY-CEREMONY-RED — auth-passkey · séparation register/login', ({ db }) => {
  const userId = uuid();
  const credentialId = 'cred-' + tag('ceremony');
  const phone = '+2693' + Math.floor(Math.random() * 9e6 + 1e6);
  const registerChallenge = tag('register-challenge');
  const loginChallenge = tag('login-challenge');
  const publicKey = Buffer.from('e2e-passkey-ceremony-public-key').toString('base64url');

  let cleanup;
  let app;
  let token;
  let previousJwtSecret;

  function clientDataJSON(challenge, type) {
    return Buffer.from(JSON.stringify({
      type,
      challenge,
      origin: 'https://komerce.test',
    })).toString('base64url');
  }

  function authenticationAssertion(challenge) {
    return {
      id: credentialId,
      rawId: credentialId,
      type: 'public-key',
      response: {
        clientDataJSON: clientDataJSON(challenge, 'webauthn.get'),
        authenticatorData: Buffer.from('auth-data').toString('base64url'),
        signature: Buffer.from('signature').toString('base64url'),
        userHandle: null,
      },
    };
  }

  function registrationResponse(challenge) {
    const newCredentialId = 'new-' + credentialId;
    return {
      id: newCredentialId,
      rawId: newCredentialId,
      type: 'public-key',
      response: {
        clientDataJSON: clientDataJSON(challenge, 'webauthn.create'),
        attestationObject: Buffer.from('attestation').toString('base64url'),
        transports: ['internal'],
      },
    };
  }

  async function storedCeremony(challenge) {
    const { rows } = await db.query(
      'SELECT ceremony_type FROM webauthn_challenges WHERE challenge = $1',
      [challenge]
    );
    return rows[0]?.ceremony_type || null;
  }

  async function credentialCount() {
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM webauthn_credentials WHERE user_id = $1',
      [userId]
    );
    return Number(rows[0].n);
  }

  async function signCount() {
    const { rows } = await db.query(
      'SELECT sign_count FROM webauthn_credentials WHERE credential_id = $1',
      [credentialId]
    );
    return Number(rows[0].sign_count);
  }

  beforeAll(async () => {
    cleanup = createCleanup(db);
    cleanup.track('users', 'id', userId); // credentials/challenges CASCADE

    previousJwtSecret = process.env.JWT_SECRET;
    if (!previousJwtSecret) process.env.JWT_SECRET = 'e2e-passkey-ceremony-secret-not-production';

    await db.query(
      `INSERT INTO users (id, full_name, email, phone, role)
       VALUES ($1, 'E2E Passkey Ceremony', $2, $3, 'client')`,
      [userId, tag('ceremony') + '@komerce.test', phone]
    );

    await db.query(
      `INSERT INTO webauthn_credentials
         (user_id, credential_id, public_key, sign_count, transports,
          backup_eligible, backup_state, device_label)
       VALUES ($1, $2, $3, 0, ARRAY['internal'], false, false, 'E2E ceremony device')`,
      [userId, credentialId, publicKey]
    );

    const { signAuthToken } = require('../../../utils/auth-session');
    token = signAuthToken({ id: userId, role: 'client' }, { method: 'otp' });

    app = express();
    app.use(express.json());
    app.use('/api/auth/passkey', require('../../../routes/auth-passkey'));
    app.use((err, _req, res, _next) => {
      res.status(err.status || 500).json({ error: err.message });
    });
  });

  afterAll(async () => {
    try {
      if (cleanup) await cleanup.run();
    } finally {
      if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousJwtSecret;
    }
  });

  beforeEach(() => {
    mockGenerateRegistrationOptions.mockReset();
    mockVerifyRegistrationResponse.mockReset();
    mockGenerateAuthenticationOptions.mockReset();
    mockVerifyAuthenticationResponse.mockReset();
  });

  it('challenge register présenté à login/verify : refus avant crypto et sans session', async () => {
    mockGenerateRegistrationOptions.mockResolvedValue({ challenge: registerChallenge });

    const options = await request(app)
      .post('/api/auth/passkey/register/options')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(options.status).toBe(200);
    expect(options.body.challenge).toBe(registerChallenge);
    expect(await storedCeremony(registerChallenge)).toBe('register');

    const misuse = await request(app)
      .post('/api/auth/passkey/login/verify')
      .send(authenticationAssertion(registerChallenge));

    expect(misuse.status).toBe(401);
    expect(misuse.body).toMatchObject({
      error: 'Authentification refusée',
      reason: 'ceremony_mismatch',
    });
    expect(misuse.headers['set-cookie']).toBeUndefined();
    expect(mockVerifyAuthenticationResponse).not.toHaveBeenCalled();
    expect(await signCount()).toBe(0);
  });

  it('challenge login présenté à register/verify : refus avant crypto et sans nouvelle credential', async () => {
    mockGenerateAuthenticationOptions.mockResolvedValue({ challenge: loginChallenge });

    const options = await request(app)
      .post('/api/auth/passkey/login/options')
      .send({ phone });

    expect(options.status).toBe(200);
    expect(options.body.challenge).toBe(loginChallenge);
    expect(await storedCeremony(loginChallenge)).toBe('login');

    const before = await credentialCount();

    const misuse = await request(app)
      .post('/api/auth/passkey/register/verify')
      .set('Authorization', `Bearer ${token}`)
      .send(registrationResponse(loginChallenge));

    expect(misuse.status).toBe(400);
    expect(misuse.body).toMatchObject({
      error: 'Enregistrement refusé',
      reason: 'ceremony_mismatch',
    });
    expect(mockVerifyRegistrationResponse).not.toHaveBeenCalled();
    expect(await credentialCount()).toBe(before);
  });
});
