'use strict';

jest.mock('../../db', () => ({ withTransaction: jest.fn() }));
const { createClient, safeProvider422Diagnostic } = require('../../services/suppliers/allegro-sandbox-client');

const env = () => ({
  KOMERCE_ALLOW_ALLEGRO_SANDBOX: '1',
  KOMERCE_ENV: 'staging',
  KOMERCE_ALLOW_ALLEGRO_SANDBOX_SEED: '1',
  ALLEGRO_SANDBOX_CLIENT_ID: 'app',
  ALLEGRO_SANDBOX_CLIENT_SECRET: 'secret',
  ALLEGRO_SANDBOX_USER_AGENT: 'KomerceTest/1',
  ALLEGRO_SANDBOX_TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32),
  ALLEGRO_SANDBOX_REFRESH_TOKEN: 'bootstrap',
});

const ok = data => ({ ok: true, json: async () => data });
const token = () => ({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, token_type: 'bearer' });

function dbImpl() {
  return {
    withTransaction: async fn => fn({
      query: async sql => {
        if (sql.startsWith('SELECT refresh')) return { rows: [] };
        return { rows: [] };
      },
    }),
  };
}

test('safe 422 diagnostic keeps only bounded code/path tokens', () => {
  const payload = {
    errors: [
      { code: 'VALIDATION_ERROR', path: 'sellingMode.format', userMessage: 'SECRET free text', details: 'SECRET details' },
      { code: 'MISSING_REQUIRED_PARAMETER', path: 'parameters[0]', message: 'SECRET' },
      { code: 'bad code with spaces', path: 'ignored', userMessage: 'SECRET' },
      { code: 'X'.repeat(121), path: 'ignored' },
      { code: 'SAFE_CODE', path: '/unsafe/slash/path' },
      { code: 'SIXTH_SHOULD_NOT_APPEAR', path: 'field' },
    ],
  };
  const diagnostic = safeProvider422Diagnostic(payload);
  expect(diagnostic).toBe('[VALIDATION_ERROR@sellingMode.format,MISSING_REQUIRED_PARAMETER@parameters[0],SAFE_CODE]');
  expect(diagnostic).not.toMatch(/SECRET|SIXTH|free text|details/i);
});

test('422 error exposes only sanitized diagnostic and never provider free text', async () => {
  const fetchImpl = jest.fn(async url => {
    if (url.includes('/auth/')) return ok(token());
    return {
      ok: false,
      status: 422,
      json: async () => ({
        errors: [{
          code: 'VALIDATION_ERROR',
          path: 'sellingMode.format',
          userMessage: 'seller secret or arbitrary provider free text',
          message: 'do not leak me',
        }],
      }),
    };
  });
  const client = createClient({ env: env(), dbImpl: dbImpl(), fetchImpl, now: () => 0 });
  await expect(client.createDraftOffer({
    productId: 'abc-123',
    name: 'Komerce Sandbox Seed Product',
    externalId: 'komerce-sandbox-seed-1',
    pricePln: 29.9,
    stock: 10,
  })).rejects.toThrow('ALLEGRO_HTTP_422[VALIDATION_ERROR@sellingMode.format]');
  await client.createDraftOffer({
    productId: 'abc-123',
    name: 'Komerce Sandbox Seed Product',
    externalId: 'komerce-sandbox-seed-1',
    pricePln: 29.9,
    stock: 10,
  }).catch(error => {
    expect(error.message).not.toMatch(/seller secret|do not leak/i);
  });
});
