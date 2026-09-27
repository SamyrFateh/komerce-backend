'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '../../js/market-hydration.js'),
  'utf8'
);

function bootPreview(code = 'CM') {
  const nativeFetch = jest.fn(async () => ({ ok: true }));
  const market = {
    code,
    name: code === 'CM' ? 'Cameroun' : 'Congo',
    relay_default_zone: code === 'CM' ? 'Yaoundé' : 'Brazzaville',
    relay_group_label: 'Ville',
  };

  const document = {
    body: { dataset: {} },
    getElementById: jest.fn(() => null),
    querySelector: jest.fn(() => null),
  };

  const window = {
    location: {
      origin: 'https://komerce.co',
      search: `?market=${code}`,
    },
    fetch: nativeFetch,
    // window.K (client legacy komerce-api.js) n'existe pas dans ce double :
    // installRelayPreviewRequestScope() le détecte (retourne false) et
    // reprogramme une retry via setTimeout + DOMContentLoaded — exactement
    // le chemin réel pris quand market-hydration.js charge avant
    // komerce-api.js dans le vrai navigateur (voir commentaire source).
    // addEventListener doit donc exister sur ce double au même titre que
    // setTimeout ci-dessous.
    addEventListener: jest.fn(),
    KomerceMarket: {
      getPreviewOverride: () => code,
      getByCode: requested => requested === code ? market : undefined,
      get: () => market,
    },
  };

  vm.runInNewContext(SOURCE, {
    window,
    document,
    URL,
    URLSearchParams,
    console,
    // Le module reprogramme installRelayPreviewRequestScope() via
    // setTimeout tant que window.K n'est pas prêt (voir addEventListener
    // ci-dessus) ; ce bac à sable minimal ne fournit pas les timers globaux
    // du navigateur/Node par défaut, donc il faut les exposer explicitement.
    setTimeout,
  });

  return { window, nativeFetch };
}

describe('market-hydration — relay preview scope', () => {
  test('ajoute explicitement market=CM aux lectures /api/relais', async () => {
    const { window, nativeFetch } = bootPreview('CM');

    await window.fetch('/api/relais');
    await window.fetch('/api/relais/public?compact=1');

    expect(nativeFetch).toHaveBeenNthCalledWith(1, '/api/relais?market=CM', undefined);
    expect(nativeFetch).toHaveBeenNthCalledWith(
      2,
      '/api/relais/public?compact=1&market=CM',
      undefined
    );
  });

  test('écrase un ancien market de query avec le preview courant', async () => {
    const { window, nativeFetch } = bootPreview('CG');

    await window.fetch('https://komerce.co/api/relais?market=KM');

    const [url] = nativeFetch.mock.calls[0];
    expect(url).toBe('https://komerce.co/api/relais?market=CG');
  });

  test('ne touche ni les autres API ni les URLs cross-origin', async () => {
    const { window, nativeFetch } = bootPreview('CM');

    await window.fetch('/api/products');
    await window.fetch('https://example.org/api/relais');

    expect(nativeFetch).toHaveBeenNthCalledWith(1, '/api/products', undefined);
    expect(nativeFetch).toHaveBeenNthCalledWith(
      2,
      'https://example.org/api/relais',
      undefined
    );
  });
});
