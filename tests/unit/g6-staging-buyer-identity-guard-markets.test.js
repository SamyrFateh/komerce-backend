/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const { findMarkedG6BuyerByPhone, preseedG6BuyerOtp } = require('../../services/g6-staging-buyer-identity-guard');
const USER = { id: '76dacd6c-c1d8-4313-9455-f0d8f063835b', email: 'g6-e2e-8acbf99f@komerce.test', role: 'client' };
const staging = { KOMERCE_ENV: 'staging', NODE_ENV: 'test' };
const hit = () => ({ query: jest.fn().mockResolvedValue({ rows: [USER] }) });

test.each([['KM', '+2693123456'], ['CM', '+237612345678'], ['CG', '+242061234567']])('%s : numero fictif dans la plage accepte (recherche DB faite)', async (_m, phone) => {
  const db = hit();
  expect(await findMarkedG6BuyerByPhone(db, phone, staging)).toEqual(USER);
  expect(db.query).toHaveBeenCalledTimes(1);
});
test.each([
  ['KM trop court', '+269312345'], ['KM trop long', '+26931234567'],
  ['CM 8 chiffres', '+23761234567'], ['CM 10 chiffres', '+2376123456789'],
  ['CG 8 chiffres', '+24206123456'], ['CG 10 chiffres', '+2420612345678'],
  ['autre indicatif', '+33612345678'], ['sans plus', '237612345678'], ['espace', '+237 612345678'],
  ['prefixe parasite', 'x+237612345678'], ['suffixe parasite', '+237612345678x'], ['vide', ''],
])('hors plage refuse sans toucher la base : %s', async (_n, phone) => {
  const db = hit();
  expect(await findMarkedG6BuyerByPhone(db, phone, staging)).toBeNull();
  expect(db.query).not.toHaveBeenCalled();
});
test.each(['+237612345678', '+242061234567'])('production reste fail-closed pour %s', async phone => {
  const db = hit();
  expect(await findMarkedG6BuyerByPhone(db, phone, { KOMERCE_ENV: 'production' })).toBeNull();
  expect(db.query).not.toHaveBeenCalled();
});
test.each(['+237612345678', '+242061234567'])('preseed OTP accepte %s en staging/test et refuse hors staging', async phone => {
  const db = { query: jest.fn().mockResolvedValueOnce({ rows: [{ one: 1 }] }).mockResolvedValueOnce({ rows: [USER] }).mockResolvedValueOnce({ rowCount: 0 }).mockResolvedValueOnce({ rowCount: 1 }) };
  expect(await preseedG6BuyerOtp(db, { buyer: USER, phone, code: '623172', env: staging })).toEqual({ prepared: true, expires_in_seconds: 600 });
  await expect(preseedG6BuyerOtp({ query: jest.fn() }, { buyer: USER, phone, code: '623172', env: { KOMERCE_ENV: 'production', NODE_ENV: 'test' } }))
    .rejects.toMatchObject({ code: 'G6_OTP_FIXTURE_PROVISION_FORBIDDEN' });
});
test('un acheteur marque dont le numero est celui d un autre marche reste distinct (ambiguite refusee)', async () => {
  const db = { query: jest.fn().mockResolvedValue({ rows: [USER, USER] }) };
  await expect(findMarkedG6BuyerByPhone(db, '+237612345678', staging)).rejects.toMatchObject({ code: 'G6_PHONE_AMBIGUOUS' });
});
