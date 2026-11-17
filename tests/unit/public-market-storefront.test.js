/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

const { projectPublicMarket, listPublicMarkets } = require('../../services/public-market-storefront');

const active = {
  code: 'GA', name: 'Gabon', currency: 'XAF', minor_unit: 0,
  is_active: true, lifecycle_status: 'ACTIVE',
  storefront_texts: {
    welcome: 'Bienvenue au Gabon', seo_title: 'Komerce Gabon',
    secret_key: 'NEVER_PUBLIC', payment_credentials: 'NEVER_PUBLIC',
  },
};

describe('public storefront markets projection', () => {
  test('returns only display-safe fields from an active canonical market', () => {
    const market = projectPublicMarket(active);
    expect(market).toEqual({
      code: 'GA', name: 'Gabon', currency: 'XAF', minor_unit: 0,
      storefront_texts: { welcome: 'Bienvenue au Gabon', seo_title: 'Komerce Gabon' },
    });
    expect(JSON.stringify(market)).not.toContain('NEVER_PUBLIC');
  });

  test.each([
    ['PROVISIONING', false], ['SUSPENDED', false], ['CLOSED', false],
    ['ACTIVE', false],
  ])('rejects lifecycle %s / is_active=%s', (lifecycle_status, is_active) => {
    expect(projectPublicMarket({ ...active, lifecycle_status, is_active })).toBeNull();
  });

  test('rejects invalid market code, currency and minor units', () => {
    expect(projectPublicMarket({ ...active, code: 'GAB' })).toBeNull();
    expect(projectPublicMarket({ ...active, currency: 'XX' })).toBeNull();
    expect(projectPublicMarket({ ...active, minor_unit: -1 })).toBeNull();
  });

  test('retains distinct markets sharing a currency', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [
      { ...active, code: 'CM', name: 'Cameroun' },
      { ...active, code: 'CG', name: 'Congo' },
      { ...active, lifecycle_status: 'PROVISIONING', code: 'GA' },
    ] });
    const markets = await listPublicMarkets({ query });
    expect(markets.map(m => m.code)).toEqual(['CM', 'CG']);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("lifecycle_status = 'ACTIVE'"));
  });

  test('propagates database errors rather than inventing fallback markets', async () => {
    const query = jest.fn().mockRejectedValue(new Error('database unavailable'));
    await expect(listPublicMarkets({ query })).rejects.toThrow('database unavailable');
  });
});
