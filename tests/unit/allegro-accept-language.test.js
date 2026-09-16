'use strict';

jest.mock('../../db', () => ({ withTransaction: jest.fn() }));

const { createClient } = require('../../services/suppliers/allegro-sandbox-client');

test('all authorized Allegro API calls override fetch wildcard language with supported pl-PL', async () => {
  const env = {
    KOMERCE_ALLOW_ALLEGRO_SANDBOX: '1',
    ALLEGRO_SANDBOX_CLIENT_ID: 'app',
    ALLEGRO_SANDBOX_CLIENT_SECRET: 'secret',
    ALLEGRO_SANDBOX_USER_AGENT: 'KomerceTest/1',
    ALLEGRO_SANDBOX_TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32),
    ALLEGRO_SANDBOX_REFRESH_TOKEN: 'bootstrap',
  };
  const tx = {
    query: jest.fn(async sql => {
      if (sql.startsWith('SELECT refresh')) return { rows: [] };
      return { rows: [] };
    }),
  };
  const dbImpl = { withTransaction: jest.fn(fn => fn(tx)) };
  const fetchImpl = jest.fn(async url => {
    if (url.includes('/auth/oauth/token')) {
      return { ok: true, json: async () => ({
        access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600, token_type: 'bearer',
      }) };
    }
    return { ok: true, json: async () => ({ offers: [] }) };
  });

  const client = createClient({ env, dbImpl, fetchImpl });
  await client.get('/sale/offers');

  const apiCall = fetchImpl.mock.calls.find(([url]) => url.includes('/sale/offers'));
  expect(apiCall).toBeTruthy();
  expect(apiCall[1].headers['Accept-Language']).toBe('pl-PL');
});
