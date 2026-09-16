'use strict';

jest.mock('../../db', () => ({ withTransaction: jest.fn() }));
const db = require('../../db');
const { createClient } = require('../../services/suppliers/allegro-sandbox-client');

const checkoutId = '29738e61-7f6a-11e8-ac45-09db60ede9d6';
const env = {
  KOMERCE_ALLOW_ALLEGRO_SANDBOX: '1',
  ALLEGRO_SANDBOX_CLIENT_ID: 'app',
  ALLEGRO_SANDBOX_CLIENT_SECRET: 'secret',
  ALLEGRO_SANDBOX_USER_AGENT: 'KomerceTest/1',
  ALLEGRO_SANDBOX_TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32),
  ALLEGRO_SANDBOX_REFRESH_TOKEN: 'bootstrap',
};

const ok = data => ({ ok: true, json: async () => data });

function setup() {
  db.withTransaction.mockImplementation(async fn => fn({ query: async sql => {
    if (String(sql).startsWith('SELECT refresh')) return { rows: [] };
    return { rows: [] };
  } }));
  const fetchImpl = jest.fn(async url => {
    if (String(url).includes('/auth/')) {
      return ok({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600, token_type: 'bearer' });
    }
    return ok({ id: checkoutId, status: 'READY_FOR_PROCESSING', lineItems: [] });
  });
  return { client: createClient({ env, fetchImpl, dbImpl: db }), fetchImpl };
}

test('seller order read is restricted to one exact sandbox checkout-form UUID', async () => {
  const { client, fetchImpl } = setup();
  await expect(client.getSellerOrder(checkoutId)).resolves.toMatchObject({ id: checkoutId });
  const call = fetchImpl.mock.calls.find(([url]) => String(url).includes('/order/checkout-forms/'));
  expect(call).toBeDefined();
  expect(new URL(call[0]).toString()).toBe(`https://api.allegro.pl.allegrosandbox.pl/order/checkout-forms/${checkoutId}`);
  expect(call[1].method).toBe('GET');
  expect(call[1].headers.Authorization).toBe('Bearer access-1');
  expect(call[1].redirect).toBe('error');
});

test.each([
  '', '123', '../sale/offers', 'not-a-uuid',
  '29738e61-7f6a-01e8-ac45-09db60ede9d6',
  '29738e61-7f6a-11e8-0c45-09db60ede9d6',
])('invalid checkout id %j fails before OAuth/network', async id => {
  const { client, fetchImpl } = setup();
  await expect(client.getSellerOrder(id)).rejects.toThrow('CHECKOUT_FORM_ID_INVALID');
  expect(fetchImpl).not.toHaveBeenCalled();
});

test('generic catalog get still cannot access order endpoints', async () => {
  const { client, fetchImpl } = setup();
  await expect(client.get(`/order/checkout-forms/${checkoutId}`)).rejects.toThrow('READ_PATH_NOT_ALLOWED');
  expect(fetchImpl).not.toHaveBeenCalled();
});
