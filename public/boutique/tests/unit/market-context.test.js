/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../../js/market-context.js'), 'utf8');
const km = { code: 'KM', name: 'Comores', currency: 'KMF', minor_unit: 0 };
const cm = { code: 'CM', name: 'Cameroun', currency: 'XAF', minor_unit: 0 };

function boot(registry, pathname = '/', search = '') {
  const window = { KomerceMarketRegistry: registry, location: { pathname, search } };
  vm.runInNewContext(source, { window, URLSearchParams });
  return window.KomerceMarket;
}

describe('MarketContext — projection du registre canonique', () => {
  test('rejette les lignes invalides et ne fabrique pas un marché', () => {
    const api = boot([null, { ...cm, code: 'C' }, { ...cm, currency: 'XX' },
      { ...cm, name: '' }, km]);
    expect(api.get().code).toBe('KM');
    expect(api.getByCode('CM')).toBeUndefined();
    expect(api.getByCode()).toBeUndefined();
    expect(api.getPathCode()).toBeNull();
    expect(api.getPreviewOverride()).toBeNull();
  });

  test('refuse un registre non chargé et ne revient pas au marché par défaut', () => {
    for (const registry of [undefined, {}, []]) {
      const api = boot(registry, '/CM', '?market=KM');
      expect(() => api.getPreviewOverride()).toThrow('STORE_MARKET_UNAVAILABLE');
      expect(() => api.get()).toThrow('STORE_MARKET_UNAVAILABLE');
    }
  });

  test('projette les valeurs éditoriales et la devise sans les reconstruire', () => {
    const texts = {
      gentile: 'Boutique camerounaise', gentile_short: 'CM', delivery_line: 'Livraison CM',
      payment_label: 'Cash', pickup_label: 'Retrait CM', relay_group_label: 'Ville',
      relay_default_zone: 'Douala', seo_title: 'Komerce CM', seo_description: 'Description',
      og_title: 'OG CM', og_description: 'OG description', footer_tagline: 'CM footer',
      free_ship_label: 'Livraison', price_label: 'XAF', welcome: 'Bienvenue au Cameroun',
    };
    const api = boot([km, { ...cm, storefront_texts: texts }], '/cm/', '?market=KM');
    expect(api.get()).toEqual({ code: 'CM', name: 'Cameroun', currency: 'XAF', minor_unit: 0, ...texts });
    expect(api.getByCode('cm')).toBe(api.get());
    expect(Object.isFrozen(api.get())).toBe(true);
    expect(api.getPathCode()).toBe('CM');
  });

  test('une ligne sans textes garde une identité pays explicite', () => {
    const api = boot([km, { ...cm, storefront_texts: 'invalid' }], '/boutique', '?market=%20cm%20');
    expect(api.get()).toMatchObject({ code: 'CM', gentile: 'Komerce — Cameroun',
      gentile_short: 'Cameroun', seo_title: 'Komerce — Cameroun', price_label: 'Prix en XAF' });
    expect(api.getPreviewOverride()).toBe('CM');
  });
});
