'use strict';
const fs = require('fs');

function read(file) { return fs.readFileSync(file, 'utf8'); }
function write(file, content) { fs.writeFileSync(file, content, 'utf8'); }
function replaceOnce(content, from, to, file) {
  const count = content.split(from).length - 1;
  if (count !== 1) throw new Error(`${file}: expected exactly one match, got ${count}: ${from}`);
  return content.replace(from, to);
}

const passkeyFile = 'features/auth-passkey.feature.js';
let passkey = read(passkeyFile);
passkey = replaceOnce(passkey, ' * @status        staging', ' * @status        production', passkeyFile);
passkey = replaceOnce(
  passkey,
  "      'tests/unit/auth-passkey-management.test.js',\n",
  "      'tests/unit/auth-passkey-management.test.js',\n" +
  "      'tests/unit/webauthn-service.test.js',\n" +
  "      'tests/unit/webauthn-management-service.test.js',\n",
  passkeyFile
);
passkey = replaceOnce(
  passkey,
  "      'infrastructure (db.js, utils/logger.js)',",
  "      'infrastructure (db.js — accès aux tables WebAuthn et users en lecture)',\n" +
  "      'platform-ops (utils/logger.js — journalisation structurée des événements WebAuthn)',",
  passkeyFile
);
write(passkeyFile, passkey);

const identityFile = 'features/auth-identity.feature.js';
let identity = read(identityFile);
identity = replaceOnce(
  identity,
  "      'auth (middleware/auth.js — garde authenticate/requireAdmin utilisée par routes/client-auth.js, routes/auth.js)',\n",
  "      'auth (middleware/auth.js — garde authenticate/requireAdmin utilisée par routes/client-auth.js, routes/auth.js)',\n" +
  "      'auth-passkey (middleware/require-recent-auth.js — preuve récente exigée par les mutations de sécurité du profil)',\n",
  identityFile
);
write(identityFile, identity);

const registryFile = 'docs/doctrine/APP_FEATURE_REGISTRY.md';
let registry = read(registryFile);
registry = replaceOnce(
  registry,
  '> **Version** : 1.7 — 2026-08 (',
  '> **Version** : 1.8 — 2026-08 (Clôture AUTH : `auth-passkey` ajouté au registre canonique ; ',
  registryFile
);
registry = replaceOnce(
  registry,
  "| 16 | `auth-identity` | transversal | backend | [`auth-identity.feature.js`](../../features/auth-identity.feature.js) | production | Routes actives d'identité : OTP, login, magic-link, inscription — partage `domain: 'auth'` avec la ligne #15, voir note ⚠ ci-dessous |\n",
  "| 16 | `auth-identity` | transversal | backend | [`auth-identity.feature.js`](../../features/auth-identity.feature.js) | production | Routes actives d'identité : OTP, login, magic-link, inscription — partage `domain: 'auth'` avec la ligne #15, voir note ⚠ ci-dessous |\n" +
  "| 16b | `auth-passkey` | transversal | backend | [`auth-passkey.feature.js`](../../features/auth-passkey.feature.js) | production | WebAuthn/passkeys : enrôlement, login nominal, gestion des authentificateurs et step-up |\n",
  registryFile
);
write(registryFile, registry);

write('tests/unit/webauthn-service.test.js', String.raw`'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Couverture structurelle dédiée de services/webauthn-service.js.
 * Complète auth-passkey.test.js avec les chemins de génération d'options
 * et de persistance des challenges, sans re-tester la crypto de la librairie.
 */

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

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

process.env.WEBAUTHN_RP_ID = 'komerce.shop';
process.env.WEBAUTHN_RP_NAME = 'Komerce';
process.env.WEBAUTHN_ORIGINS = 'https://komerce.shop';

const webauthn = require('../../services/webauthn-service');
const USER_ID = '11111111-1111-4111-8111-111111111111';

describe('webauthn-service — options et challenges', () => {
  beforeEach(() => jest.clearAllMocks());

  it('enregistrement : exclut les credentials actifs et persiste un challenge register lié au user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ credential_id: 'cred-existing', transports: ['internal'] }] });
    mockGenerateRegistrationOptions.mockResolvedValue({ challenge: 'reg-challenge' });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const options = await webauthn.getRegistrationOptions({ id: USER_ID, phone: '+2693000000', full_name: 'Client Komerce' });

    expect(options).toEqual({ challenge: 'reg-challenge' });
    expect(mockGenerateRegistrationOptions).toHaveBeenCalledWith(expect.objectContaining({
      rpID: 'komerce.shop',
      rpName: 'Komerce',
      userName: '+2693000000',
      attestationType: 'none',
      authenticatorSelection: expect.objectContaining({ userVerification: 'required' }),
      excludeCredentials: [{ id: 'cred-existing', transports: ['internal'] }],
    }));
    expect(mockQuery.mock.calls[1][0]).toMatch(/INSERT INTO webauthn_challenges/i);
    expect(mockQuery.mock.calls[1][1][0]).toBe(USER_ID);
    expect(mockQuery.mock.calls[1][1][1]).toBe('reg-challenge');
    expect(mockQuery.mock.calls[1][1][2]).toBe('register');
    expect(mockQuery.mock.calls[1][1][3]).toBeInstanceOf(Date);
  });

  it('login username-first inconnu : ne révèle pas le compte et stocke un challenge orphelin', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockGenerateAuthenticationOptions.mockResolvedValue({ challenge: 'login-challenge' });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const options = await webauthn.getLoginOptions({ phone: '+2693999999' });

    expect(options).toEqual({ challenge: 'login-challenge' });
    expect(mockGenerateAuthenticationOptions).toHaveBeenCalledWith(expect.objectContaining({
      rpID: 'komerce.shop',
      userVerification: 'required',
      allowCredentials: [],
    }));
    expect(mockQuery.mock.calls[1][1][0]).toBeNull();
    expect(mockQuery.mock.calls[1][1][1]).toBe('login-challenge');
    expect(mockQuery.mock.calls[1][1][2]).toBe('login');
  });

  it('step-up : aucune passkey active => indisponible sans générer de challenge', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(webauthn.getStepUpOptions({ userId: USER_ID })).resolves.toEqual({
      available: false,
      reason: 'no_active_credential',
    });
    expect(mockGenerateAuthenticationOptions).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
`);

write('tests/unit/webauthn-management-service.test.js', String.raw`'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Couverture structurelle dédiée de services/webauthn-management-service.js.
 * Vérifie les propriétés SQL de visibilité et d'idempotence qui complètent
 * les tests de route AUTH-6 existants.
 */

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));
const management = require('../../services/webauthn-management-service');

describe('webauthn-management-service — invariants SQL', () => {
  beforeEach(() => jest.clearAllMocks());

  it('liste seulement les credentials actifs, ordonnés par dernière utilisation puis création', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{
      id: '11111111-1111-4111-8111-111111111111',
      device_label: null,
      created_at: '2026-08-01T10:00:00Z',
      last_used_at: null,
      backup_eligible: 0,
      backup_state: 1,
    }] });

    const rows = await management.listCredentials('user-A');

    expect(mockQuery.mock.calls[0][0]).toMatch(/revoked_at IS NULL/i);
    expect(mockQuery.mock.calls[0][0]).toMatch(/ORDER BY COALESCE\(last_used_at, created_at\) DESC, created_at DESC/i);
    expect(mockQuery.mock.calls[0][1]).toEqual(['user-A']);
    expect(rows).toEqual([{
      id: '11111111-1111-4111-8111-111111111111',
      device_label: 'Passkey',
      created_at: '2026-08-01T10:00:00Z',
      last_used_at: null,
      backup_eligible: false,
      backup_state: true,
    }]);
  });

  it('révocation : reste idempotente et scellée à la paire credential/user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{
      id: '11111111-1111-4111-8111-111111111111',
      revoked_at: '2026-08-17T08:00:00Z',
    }] });

    const result = await management.revokeCredential({
      userId: 'user-A',
      credentialManagementId: '11111111-1111-4111-8111-111111111111',
    });

    expect(mockQuery.mock.calls[0][0]).toMatch(/SET revoked_at = COALESCE\(revoked_at, NOW\(\)\)/i);
    expect(mockQuery.mock.calls[0][0]).toMatch(/WHERE id = \$1\s+AND user_id = \$2/i);
    expect(mockQuery.mock.calls[0][1]).toEqual(['11111111-1111-4111-8111-111111111111', 'user-A']);
    expect(result).toEqual({
      revoked: true,
      id: '11111111-1111-4111-8111-111111111111',
      revoked_at: '2026-08-17T08:00:00Z',
    });
  });
});
`);
