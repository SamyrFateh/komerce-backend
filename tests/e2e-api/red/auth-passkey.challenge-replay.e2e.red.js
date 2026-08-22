'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * E2E-P0-PASSKEY-RED — auth-passkey · challenge login à usage unique
 *
 * Contrat sécurité : une assertion WebAuthn ne peut consommer un challenge
 * login qu'une seule fois. Le rejeu exact de la même assertion doit être
 * refusé avant toute seconde vérification cryptographique, sans nouvelle
 * mutation de credential et sans nouvelle session.
 *
 * FRONTIÈRE CRYPTO CONTRÔLÉE — et seulement elle :
 * @simplewebauthn/server génère/vérifie les objets WebAuthn. Routes Express,
 * service Komerce, PostgreSQL, consommation atomique du challenge, credential
 * et émission de session restent réels.
 */

const request = require('supertest');
const express = require('express');

const mockGenerateAuthenticationOptions = jest.fn();
const mockVerifyAuthenticationResponse = jest.fn();

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
  generateAuthenticationOptions: (...args) => mockGenerateAuthenticationOptions(...args),
  verifyAuthenticationResponse: (...args) => mockVerifyAuthenticationResponse(...args),
}));

const { describeE2E, createCleanup, tag, uuid } = require('../../helpers/e2eDbKit');

jest.setTimeout(60000);

describeE2E('E2E-P0-PASSKEY-RED — auth-passkey · challenge login à usage unique', ({ db }) => {
  const userId = uuid();
  const credentialId = 'cred-' + tag('replay');
  const phone = '+2693' + Math.floor(Math.random() * 9e6 + 1e6);
  const challenge = tag('challenge');
  const publicKey = Buffer.from('e2e-passkey-public-key').toString('base64url');

  let cleanup;
  let app;
  let previousJwtSecret;

  function assertionFor(challengeValue) {
    const clientData = {
      type: 'webauthn.get',
      challenge: challengeValue,
      origin: 'https://komerce.test',
    };
    return {
      id: credentialId,
      rawId: credentialId,
      type: 'public-key',
      response: {
        clientDataJSON: Buffer.from(JSON.stringify(clientData)).toString('base64url'),
        authenticatorData: Buffer.from('auth-data').toString('base64url'),
        signature: Buffer.from('signature').toString('base64url'),
        userHandle: null,
      },
    };
  }

  beforeAll(async () => {
    cleanup = createCleanup(db);
    cleanup.track('users', 'id', userId); // credentials/challenges CASCADE

    previousJwtSecret = process.env.JWT_SECRET;
    if (!previousJwtSecret) process.env.JWT_SECRET = 'e2e-passkey-session-secret-not-production';

    await db.query(
      `INSERT INTO users (id, full_name, email, phone, role)
       VALUES ($1, 'E2E Passkey Replay', $2, $3, 'client')`,
      [userId, tag('passkey') + '@komerce.test', phone]
    );

    await db.query(
      `INSERT INTO webauthn_credentials
         (user_id, credential_id, public_key, sign_count, transports,
          backup_eligible, backup_state, device_label)
       VALUES ($1, $2, $3, 0, ARRAY['internal'], false, false, 'E2E device')`,
      [userId, credentialId, publicKey]
    );

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
    mockGenerateAuthenticationOptions.mockReset();
    mockVerifyAuthenticationResponse.mockReset();
  });

  it('rejeu exact : première assertion acceptée, seconde refusée sans second effet', async () => {
    mockGenerateAuthenticationOptions.mockResolvedValue({ challenge });
    mockVerifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 1 },
    });

    const options = await request(app)
      .post('/api/auth/passkey/login/options')
      .send({ phone });

    expect(options.status).toBe(200);
    expect(options.body.challenge).toBe(challenge);

    const before = await db.query(
      `SELECT ceremony_type, consumed_at
       FROM webauthn_challenges WHERE challenge = $1`,
      [challenge]
    );
    expect(before.rows).toHaveLength(1);
    expect(before.rows[0].ceremony_type).toBe('login');
    expect(before.rows[0].consumed_at).toBeNull();

    const assertion = assertionFor(challenge);

    const first = await request(app)
      .post('/api/auth/passkey/login/verify')
      .send(assertion);

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ verified: true, user: { id: userId } });
    expect(first.headers['set-cookie']).toBeDefined();

    const afterFirst = await db.query(
      `SELECT c.consumed_at, w.sign_count
       FROM webauthn_challenges c
       CROSS JOIN webauthn_credentials w
       WHERE c.challenge = $1 AND w.credential_id = $2`,
      [challenge, credentialId]
    );
    expect(afterFirst.rows).toHaveLength(1);
    expect(afterFirst.rows[0].consumed_at).not.toBeNull();
    expect(Number(afterFirst.rows[0].sign_count)).toBe(1);

    const second = await request(app)
      .post('/api/auth/passkey/login/verify')
      .send(assertion);

    expect(second.status).toBe(401);
    expect(second.body).toMatchObject({
      error: 'Authentification refusée',
      reason: 'challenge_invalid_or_expired',
    });
    expect(second.headers['set-cookie']).toBeUndefined();

    const afterReplay = await db.query(
      'SELECT sign_count FROM webauthn_credentials WHERE credential_id = $1',
      [credentialId]
    );
    expect(Number(afterReplay.rows[0].sign_count)).toBe(1);

    // La seconde requête doit être arrêtée AVANT la frontière crypto.
    expect(mockVerifyAuthenticationResponse).toHaveBeenCalledTimes(1);
  });
});
