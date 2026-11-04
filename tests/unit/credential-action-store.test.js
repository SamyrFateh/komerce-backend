/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';
const store = require('../../services/credential-action-store');
test('invalid token is rejected without database access', async () => {
  const db = { query: jest.fn() };
  expect(await store.consumeActionToken(db, {token: 'invalid', purpose: 'password_reset'})).toBeNull();
  expect(db.query).not.toHaveBeenCalled();
});
test('tokens are represented by hashes in persistence', async () => {
  const db = {query: jest.fn().mockResolvedValue({rows: []})};
  const issued = await store.createActionToken(db, {userId: 'test-user', purpose: 'account_activation'});
  expect(db.query).toHaveBeenCalledTimes(2);
  expect(db.query.mock.calls[1][1][1]).not.toEqual(issued.token);
});
