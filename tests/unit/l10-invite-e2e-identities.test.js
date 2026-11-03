'use strict';
/** @test-kind unit — L10 invitations via API, jamais de mot de passe ni SQL mutation. */
const { run, parseAccounts } = require('../../scripts/recette/l10-invite-e2e-identities');
const env = { STAGING_BASE_URL: 'https://staging.example.test', KOMERCE_STAGING_ADMIN_TOKEN: 'test-only',
  KOMERCE_E2E_IDENTITIES_JSON: JSON.stringify([{ full_name: 'Test CM CG', email: 'role@example.test',
    role: 'market_operator', market_codes: ['CM', 'CG'] }]), KOMERCE_E2E_IDENTITIES_APPLY: '1' };
const db = { query: jest.fn() };
const guard = jest.fn(async () => ({ confirmed: true }));
test('les comptes E2E ne contiennent aucun mot de passe', () => {
  const a = parseAccounts(env.KOMERCE_E2E_IDENTITIES_JSON);
  expect(a[0]).toEqual({ full_name:'Test CM CG', email:'role@example.test', role:'market_operator',
    market_codes:['CM','CG'], invite:true });
  expect(JSON.stringify(a)).not.toContain('password');
});
test('dry-run sécurisé : aucune API de création', async () => {
  const fetchImpl = jest.fn();
  const x = await run({ db, env, fetchImpl, guard });
  expect(x.mode).toBe('dry-run');
  expect(x.count).toBe(1);
  expect(fetchImpl).not.toHaveBeenCalled();
});
test('activation refusée si le fingerprint staging ne correspond pas', async () => {
  const fetchImpl = jest.fn();
  await expect(run({ db, env, fetchImpl, apply:true,
    guard: async () => ({ confirmed: false }) })).rejects.toThrow('STAGING_TARGET_NOT_CONFIRMED');
  expect(fetchImpl).not.toHaveBeenCalled();
});
test('l’invitation est réalisée uniquement via l’API admin canonique', async () => {
  const fetchImpl = jest.fn(async () => ({
    ok: true, json: async () => ({ id: 'test-id', account_activation_required:true, invitation_sent:true }),
  }));
  const result = await run({ db, env, fetchImpl, guard, apply:true });
  expect(result.accounts).toHaveLength(1);
  expect(fetchImpl.mock.calls[0][0]).toBe('https://staging.example.test/api/admin/users');
  const request = JSON.parse(fetchImpl.mock.calls[0][1].body);
  expect(request).not.toHaveProperty('password');
  expect(request.market_codes).toEqual(['CM','CG']);
  expect(request.invite).toBe(true);
});
test('un rôle non marché ne peut porter des scopes de marché', () => {
  expect(() => parseAccounts(JSON.stringify([{
    full_name:'Hub Test',email:'hub@example.test',role:'agent_hub',market_codes:['KM'],
  }]))).toThrow('E2E_NON_MARKET_OPERATOR_SCOPE_FORBIDDEN');
});
