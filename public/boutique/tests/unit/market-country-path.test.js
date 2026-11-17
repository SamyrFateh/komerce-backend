/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MARKET_SOURCE = fs.readFileSync(
  path.join(__dirname, '../../js/market-context.js'), 'utf8'
);
const HYDRATION_SOURCE = fs.readFileSync(
  path.join(__dirname, '../../js/market-hydration.js'), 'utf8'
);

const ACTIVE_MARKETS = [
  ['KM','Comores','KMF'], ['CM','Cameroun','XAF'], ['CG','Congo','XAF'],
  ['DJ','Djibouti','DJF'], ['YT','Mayotte','EUR'], ['GA','Gabon','XAF'],
].map(([code,name,currency])=>({code,name,currency,minor_unit:0,
  storefront_texts:{seo_title:'Komerce — La boutique en ligne '+(code==='CM'?'du Cameroun':name)} }));

function boot(pathname, search = '', registry = ACTIVE_MARKETS) {
  const nativeFetch = jest.fn(async () => ({ ok: true }));
  const window = {
    location: { origin: 'https://komerce.co', pathname, search },
    fetch: nativeFetch,
    addEventListener: jest.fn(),
    KomerceMarketRegistry: registry,
  };
  const sandbox = { window, URLSearchParams };
  vm.runInNewContext(MARKET_SOURCE, sandbox);
  return { window, nativeFetch };
}

describe('Boutique publique — URL pays canonique', () => {
  test.each([
    ['/KM', 'KM', 'KMF'],
    ['/CM', 'CM', 'XAF'],
    ['/CG', 'CG', 'XAF'],
    ['/DJ', 'DJ', 'DJF'],
    ['/YT', 'YT', 'EUR'],
    ['/cm/', 'CM', 'XAF'],
  ])('%s donne le catalogue du marché %s', (pathname, code, currency) => {
    const { window } = boot(pathname);
    expect(window.KomerceMarket.getPathCode()).toBe(code);
    expect(window.KomerceMarket.get().code).toBe(code);
    expect(window.KomerceMarket.get().currency).toBe(currency);
  });

  test('un nouveau pays GA vient uniquement de la projection active', () => {
    expect(boot('/GA').window.KomerceMarket.get().currency).toBe('XAF');
    expect(boot('/GA', '', ACTIVE_MARKETS.filter(m=>m.code!=='GA')).window.KomerceMarket.getPathCode()).toBeNull();
  });

  test('sans référentiel actif, aucun pays inventé même KM', () => {
    const {window}=boot('/', '', []);
    expect(()=>window.KomerceMarket.get()).toThrow('STORE_MARKET_UNAVAILABLE');
  });

  test('la route /CM prime sur ?market=KM, même après partage du lien', () => {
    const { window } = boot('/CM', '?market=KM');
    expect(window.KomerceMarket.get().code).toBe('CM');
    expect(window.KomerceMarket.getPreviewOverride()).toBe('CM');
  });

  test('la racine reste KM, et /boutique?market=CG fonctionne encore', () => {
    expect(boot('/').window.KomerceMarket.get().code).toBe('KM');
    expect(boot('/boutique').window.KomerceMarket.get().code).toBe('KM');
    expect(boot('/boutique', '?market=CG').window.KomerceMarket.get().code).toBe('CG');
  });

  test('un chemin arbitraire et un code invalide ne créent pas de marché fictif', () => {
    const { window } = boot('/admin/finance', '?market=FR');
    expect(window.KomerceMarket.getPathCode()).toBeNull();
    expect(window.KomerceMarket.get().code).toBe('KM');
  });

  test('/CM transporte le filtre vers la lecture relais, même avec ?market=KM', async () => {
    const { window, nativeFetch } = boot('/CM', '?market=KM');
    const logo = { href: '/', setAttribute(_name, value) { this.href = value; } };
    const document = {
      body: { dataset: {} },
      getElementById: () => null,
      querySelector: selector => selector === 'a.k-logo[href="/"]' ? logo : null,
    };
    vm.runInNewContext(HYDRATION_SOURCE, {
      window, document, URL, URLSearchParams,
      setTimeout: () => null,
    });

    expect(document.body.dataset.marketCode).toBe('CM');
    expect(logo.href).toBe('/CM');
    expect(document.title).toBe('Komerce — La boutique en ligne du Cameroun');
    await window.fetch('/api/relais');
    expect(nativeFetch).toHaveBeenCalledWith('/api/relais?market=CM', undefined);
  });
});
