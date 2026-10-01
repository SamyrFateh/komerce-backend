'use strict';

jest.mock('../../db', () => ({ query: jest.fn(), withTransaction: jest.fn(), getClient: jest.fn() }));

const crypto = require('crypto');
const svc = require('../../services/provider-credential-service');

const KEY = crypto.randomBytes(32).toString('hex');
const env = { KOMERCE_PROVIDER_CREDENTIALS_MASTER_KEY: KEY };
const base = { provider: 'cj', credentialRef: 'cred_' + 'a'.repeat(32), authType: 'api_key' };

describe('enveloppe AES-256-GCM', () => {
  const secrets = { api_key: 'sk-super-secret-value' };

  test('le chiffré ne contient pas le secret et le déchiffrement le restitue', () => {
    const enc = svc._encryptEnvelope({ ...base, secrets }, env);
    expect(JSON.stringify(enc)).not.toContain(secrets.api_key);
    expect(Buffer.from(enc.ciphertext, 'base64').toString('utf8')).not.toContain(secrets.api_key);
    expect(svc._decryptEnvelope({ ...base, envelope: enc }, env)).toEqual(secrets);
  });

  test('IV aléatoire : deux chiffrements du même secret diffèrent', () => {
    const a = svc._encryptEnvelope({ ...base, secrets }, env);
    const b = svc._encryptEnvelope({ ...base, secrets }, env);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  test('tag altéré, AAD différent ou mauvaise clé maître → illisible, sans fuite', () => {
    const enc = svc._encryptEnvelope({ ...base, secrets }, env);
    const tampered = { ...enc, tag: Buffer.alloc(16, 1).toString('base64') };
    expect(() => svc._decryptEnvelope({ ...base, envelope: tampered }, env)).toThrow(/illisibles/);
    expect(() => svc._decryptEnvelope({ ...base, provider: 'allegro', envelope: enc }, env)).toThrow(/illisibles/);
    expect(() => svc._decryptEnvelope({ ...base, credentialRef: 'cred_' + 'b'.repeat(32), envelope: enc }, env)).toThrow(/illisibles/);
    const other = { KOMERCE_PROVIDER_CREDENTIALS_MASTER_KEY: crypto.randomBytes(32).toString('hex') };
    try { svc._decryptEnvelope({ ...base, envelope: enc }, other); } catch (e) {
      expect(e.code).toBe('credentials_unreadable');
      expect(e.message).not.toContain(secrets.api_key);
    }
  });

  test('clé maître absente ou invalide → échec fermé', () => {
    expect(() => svc._encryptEnvelope({ ...base, secrets }, {})).toThrow(/pas disponible/);
    expect(() => svc._encryptEnvelope({ ...base, secrets }, { KOMERCE_PROVIDER_CREDENTIALS_MASTER_KEY: 'abcd' })).toThrow(/pas disponible/);
  });

  test('key_version suit KOMERCE_PROVIDER_CREDENTIALS_KEY_VERSION', () => {
    const enc = svc._encryptEnvelope({ ...base, secrets }, { ...env, KOMERCE_PROVIDER_CREDENTIALS_KEY_VERSION: '3' });
    expect(enc.keyVersion).toBe(3);
  });
});

describe('validation des champs (contrat du registre)', () => {
  const cj = { mode: 'api_key', scope: 'source', fields: [{ key: 'api_key', label: 'Clé API', secret: true }] };

  test('champs requis, inconnus, caractères de contrôle', () => {
    expect(svc._validateSecrets(cj, { api_key: '  abc  ' })).toEqual({ api_key: 'abc' });
    expect(() => svc._validateSecrets(cj, {})).toThrow(/obligatoire/);
    expect(() => svc._validateSecrets(cj, { api_key: 'x', extra: 'y' })).toThrow(/inconnu/);
    expect(() => svc._validateSecrets(cj, { api_key: 'a\nb' })).toThrow(/invalide/);
  });

  test('connecteur plateforme/oauth/none non configurable par saisie', () => {
    expect(() => svc._validateSecrets({ mode: 'oauth', scope: 'platform' }, {})).toThrow(/ne se configure pas/);
    expect(() => svc._validateSecrets({ mode: 'none' }, {})).toThrow(/ne se configure pas/);
    expect(() => svc._validateSecrets({ mode: 'client_credentials', scope: 'platform' }, {})).toThrow(/ne se configure pas/);
  });
});

describe('état crédentiel (autorité backend, fail-closed)', () => {
  const api = { mode: 'api_key', hasEnvironmentCredentials: false };
  test('aucun credential → missing', () => {
    expect(svc.deriveCredentialState({ contract: api, vault: null })).toBe('missing');
  });
  test('vault testé ok → valid ; échec → invalid ; non testé → untested', () => {
    expect(svc.deriveCredentialState({ contract: api, vault: { last_test_status: 'ok' } })).toBe('valid');
    expect(svc.deriveCredentialState({ contract: api, vault: { last_test_status: 'failed' } })).toBe('invalid');
    expect(svc.deriveCredentialState({ contract: api, vault: { last_test_status: null } })).toBe('untested');
  });
  test('un échec de vault l’emporte sur une source déjà certifiée', () => {
    expect(svc.deriveCredentialState({ contract: api, vault: { last_test_status: 'failed' }, productionCertified: true })).toBe('invalid');
  });
  test('repli env : valid seulement si connexion vérifiée', () => {
    const env2 = { mode: 'api_key', hasEnvironmentCredentials: true };
    expect(svc.deriveCredentialState({ contract: env2, vault: null })).toBe('untested');
    expect(svc.deriveCredentialState({ contract: env2, vault: null, connectionTestStatus: 'ok' })).toBe('valid');
    expect(svc.deriveCredentialState({ contract: env2, vault: null, connectionTestStatus: 'failed' })).toBe('invalid');
  });
  test('mode none → not_required', () => {
    expect(svc.deriveCredentialState({ contract: { mode: 'none' }, vault: null })).toBe('not_required');
  });
});

describe('assainisseur commun', () => {
  test('retire les secrets connus du texte', () => {
    const out = svc.redactSecrets('HTTP 401 key=sk-abc-123456 secret=zzzz9999', { api_key: 'sk-abc-123456', client_secret: 'zzzz9999' });
    expect(out).not.toContain('sk-abc-123456');
    expect(out).not.toContain('zzzz9999');
  });
});
