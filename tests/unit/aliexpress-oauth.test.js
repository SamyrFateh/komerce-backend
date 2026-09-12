'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const crypto = require('crypto');
const oauth = require('../../services/suppliers/aliexpress-oauth');

const KEY = crypto.randomBytes(32).toString('base64');
const ENV = {
  ALIEXPRESS_APP_KEY: 'app-key-test',
  ALIEXPRESS_APP_SECRET: 'secret-test',
  ALIEXPRESS_TOKEN_ENCRYPTION_KEY: KEY,
  ALIEXPRESS_OAUTH_REDIRECT_URI: 'https://komerce.co/api/integrations/aliexpress/oauth/callback',
};

function memoryDb() {
  let row = null;
  return {
    query: jest.fn(async (sql, params) => {
      if (/INSERT INTO supplier_oauth_connections/.test(sql)) {
        row = {
          supplier_key: params[0],
          access_token_ciphertext: params[1], access_token_iv: params[2], access_token_tag: params[3],
          refresh_token_ciphertext: params[4], refresh_token_iv: params[5], refresh_token_tag: params[6],
          access_expires_at: params[7], refresh_expires_at: params[8],
          provider_user_id: params[9], provider_user_nick: params[10], token_type: params[11],
          updated_at: params[12], last_refreshed_at: params[13], created_at: params[12],
        };
        return { rows: [] };
      }
      if (/FROM supplier_oauth_connections/.test(sql)) return { rows: row ? [row] : [] };
      throw new Error(`unexpected SQL: ${sql}`);
    }),
  };
}

describe('AliExpress OAuth session manager', () => {
  test('AES-256-GCM roundtrip et AAD empêchent le mélange access/refresh', () => {
    const encrypted = oauth.encryptToken('access-secret', KEY, 'access');
    expect(encrypted.ciphertext).not.toContain('access-secret');
    expect(oauth.decryptToken(encrypted, KEY, 'access')).toBe('access-secret');
    expect(() => oauth.decryptToken(encrypted, KEY, 'refresh')).toThrow();
  });

  test('authorization URL utilise la Open Platform api-sg et conserve la callback canonique', () => {
    const state = 'a'.repeat(43);
    const url = new URL(oauth.buildAuthorizationUrl(state, { env: ENV }));
    expect(url.origin + url.pathname).toBe('https://api-sg.aliexpress.com/oauth/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('force_auth')).toBe('true');
    expect(url.searchParams.get('client_id')).toBe('app-key-test');
    expect(url.searchParams.get('redirect_uri')).toBe(ENV.ALIEXPRESS_OAUTH_REDIRECT_URI);
    expect(url.searchParams.get('state')).toBe(state);
  });

  test('requête système GOP signe en SHA-256 sans transmettre le secret', () => {
    const now = new Date('2026-09-12T02:00:00Z');
    const url = new URL(oauth.buildSystemRequest('/auth/token/create', { code: 'code-123' }, { env: ENV, now }));
    expect(url.origin + url.pathname).toBe('https://api-sg.aliexpress.com/rest/auth/token/create');
    expect(url.searchParams.get('app_key')).toBe('app-key-test');
    expect(url.searchParams.get('code')).toBe('code-123');
    expect(url.searchParams.get('simplify')).toBe('true');
    expect(url.searchParams.get('sign_method')).toBe('sha256');
    expect(url.searchParams.get('timestamp')).toBe(String(now.getTime()));
    expect(url.searchParams.get('sign')).toMatch(/^[A-F0-9]{64}$/);
    expect(url.toString()).not.toContain('secret-test');
  });

  test('exchange code déplie gopResponseBody, respecte les expirations fournisseur et chiffre les tokens', async () => {
    const dbImpl = memoryDb();
    const now = new Date('2026-09-12T02:00:00Z');
    const accessExpiry = Date.parse('2026-09-13T01:30:00Z');
    const refreshExpirySeconds = Math.floor(Date.parse('2026-09-14T01:00:00Z') / 1000);
    const fetchImpl = jest.fn(async (rawUrl, init) => {
      const url = new URL(rawUrl);
      expect(url.pathname).toBe('/rest/auth/token/create');
      expect(url.searchParams.get('code')).toBe('code-123');
      expect(url.searchParams.get('sign')).toMatch(/^[A-F0-9]{64}$/);
      expect(init).toMatchObject({ method: 'POST' });
      expect(init.body).toBeUndefined();
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          gopResponseBody: JSON.stringify({
            access_token: 'access-1',
            refresh_token: 'refresh-1',
            expires_in: 86400,
            expire_time: accessExpiry,
            refresh_expires_in: 172800,
            refresh_token_valid_time: refreshExpirySeconds,
            user_id: 'u1',
            user_nick: 'sam',
          }),
        }),
      };
    });

    const status = await oauth.exchangeAuthorizationCode('code-123', { env: ENV, dbImpl, fetchImpl, now });
    expect(status.connected).toBe(true);
    expect(status).not.toHaveProperty('accessToken');
    expect(status).not.toHaveProperty('refreshToken');

    const loaded = await oauth.loadConnection({ env: ENV, dbImpl });
    expect(loaded.accessToken).toBe('access-1');
    expect(loaded.refreshToken).toBe('refresh-1');
    expect(loaded.accessExpiresAt.toISOString()).toBe('2026-09-13T01:30:00.000Z');
    expect(loaded.refreshExpiresAt.toISOString()).toBe('2026-09-14T01:00:00.000Z');
  });

  test('refresh appelle /auth/token/refresh et remplace aussi le refresh token', async () => {
    const dbImpl = memoryDb();
    const now = new Date('2026-09-12T02:00:00Z');
    const initial = oauth.normalizeTokenPayload({ access_token: 'a1', refresh_token: 'r1', expires_in: 60, refresh_expires_in: 172800 }, { env: ENV, now });
    await oauth.saveConnection(initial, { env: ENV, dbImpl, now });
    const connection = await oauth.loadConnection({ env: ENV, dbImpl });

    const refreshNow = new Date('2026-09-12T02:01:00Z');
    const fetchImpl = jest.fn(async (rawUrl) => {
      const url = new URL(rawUrl);
      expect(url.pathname).toBe('/rest/auth/token/refresh');
      expect(url.searchParams.get('refresh_token')).toBe('r1');
      expect(url.searchParams.get('sign_method')).toBe('sha256');
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          access_token: 'a2',
          refresh_token: 'r2',
          expires_in: 86400,
          refresh_expires_in: 172800,
        }),
      };
    });
    const refreshed = await oauth.refreshConnection(connection, { env: ENV, dbImpl, fetchImpl, now: refreshNow });
    expect(refreshed.accessToken).toBe('a2');
    expect(refreshed.refreshToken).toBe('r2');
    const loaded = await oauth.loadConnection({ env: ENV, dbImpl });
    expect(loaded.accessToken).toBe('a2');
    expect(loaded.refreshToken).toBe('r2');
  });

  test('refresh expiré échoue fermé et demande une nouvelle autorisation', async () => {
    await expect(oauth.refreshConnection({
      accessToken: 'a', refreshToken: 'r',
      accessExpiresAt: new Date('2026-09-11T00:00:00Z'),
      refreshExpiresAt: new Date('2026-09-11T00:00:00Z'),
    }, { env: ENV, now: new Date('2026-09-12T00:00:00Z') })).rejects.toThrow(/nouvelle autorisation/);
  });
});
