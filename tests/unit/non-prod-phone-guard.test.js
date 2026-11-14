'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
describe('utils/non-prod-phone-guard', () => {
  const OLD = process.env;
  beforeEach(() => { jest.resetModules(); process.env = { ...OLD }; });
  afterAll(() => { process.env = OLD; });
  const load = (env, list) => {
    process.env.KOMERCE_ENV = env;
    if (list === undefined) delete process.env.AUTHKEY_ALLOWED_PHONES; else process.env.AUTHKEY_ALLOWED_PHONES = list;
    return require('../../utils/non-prod-phone-guard').isNonProdPhoneAllowed;
  };

  it('production : toujours autorisé', () => expect(load('production', '')('+33600000000')).toBe(true));
  it('hors production, liste vide : refus', () => expect(load('staging', undefined)('+2693301234')).toBe(false));
  it('hors production : seulement les numéros listés (correspondance suffixe)', () => {
    const f = load('staging', '+2693301234, +33612345678');
    expect(f('+269 330 1234')).toBe(true);
    expect(f('+33700000000')).toBe(false);
  });
});
