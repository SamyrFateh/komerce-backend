'use strict';

/**
 * tests/unit/collective-workspace-internals.test.js
 * Couvre services/collective-workspace-internals.js
 */

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));

const db = require('../../db');
const { CONFIG, _generateToken, _hashToken, logEvent } = require('../../services/collective-workspace-internals');

describe('CONFIG', () => {
  it('expose les prefixes de tokens et durees de session attendus', () => {
    expect(CONFIG.PUBLIC_TOKEN_PREFIX).toBe('WS-');
    expect(CONFIG.CREATOR_TOKEN_PREFIX).toBe('WC-');
    expect(CONFIG.PAYMENT_TOKEN_PREFIX).toBe('PT-');
    expect(CONFIG.SESSION_DURATION_MIN_MS).toBeLessThan(CONFIG.SESSION_DURATION_MS);
  });
});

describe('_generateToken', () => {
  it('prefixe le token avec le prefixe fourni', () => {
    const token = _generateToken('WS-');
    expect(token.startsWith('WS-')).toBe(true);
  });

  it('genere un token de longueur coherente avec TOKEN_BYTES en base64url', () => {
    const token = _generateToken('WC-');
    const raw = token.slice('WC-'.length);
    // base64url de 24 octets → ~32 caracteres (pas de padding)
    expect(raw.length).toBeGreaterThanOrEqual(28);
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('genere des tokens uniques a chaque appel (entropie cryptographique)', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => _generateToken('WS-')));
    expect(tokens.size).toBe(50);
  });

  it('prefixe vide → token = juste la partie aleatoire', () => {
    const token = _generateToken('');
    expect(token.length).toBeGreaterThan(0);
  });
});

describe('_hashToken', () => {
  it('produit un hash hexadecimal de 64 caracteres (sha256)', () => {
    const hash = _hashToken('WS-abc123');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('est deterministe : meme input → meme hash', () => {
    const h1 = _hashToken('WS-same-token');
    const h2 = _hashToken('WS-same-token');
    expect(h1).toBe(h2);
  });

  it('inputs differents → hashs differents', () => {
    const h1 = _hashToken('WS-token-1');
    const h2 = _hashToken('WS-token-2');
    expect(h1).not.toBe(h2);
  });

  it('chaine vide → ne crash pas et retourne un hash valide', () => {
    expect(() => _hashToken('')).not.toThrow();
    expect(_hashToken('')).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('logEvent', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sans client fourni → utilise db par defaut', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await logEvent(null, 'ws-1', 'created', 'creator', 'user-1', { foo: 'bar' });
    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO collective_workspace_events');
    expect(params).toEqual(['ws-1', 'created', 'creator', 'user-1', JSON.stringify({ foo: 'bar' })]);
  });

  it('client fourni → utilise le client plutot que db', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await logEvent(client, 'ws-1', 'closed', 'creator', 'user-1');
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('actorType/actorIdentifier absents → fallback null', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await logEvent(null, 'ws-1', 'expired');
    const [, params] = db.query.mock.calls[0];
    expect(params).toEqual(['ws-1', 'expired', null, null, JSON.stringify({})]);
  });

  it('payload non fourni → serialise en objet vide par defaut', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await logEvent(null, 'ws-1', 'created', 'creator', 'user-1');
    const [, params] = db.query.mock.calls[0];
    expect(params[4]).toBe('{}');
  });
});
