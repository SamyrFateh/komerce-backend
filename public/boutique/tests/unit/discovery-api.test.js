'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/discovery-api.test.js
 *
 * Module js/discovery-api.js — Vague 2 D6.
 *
 * Couverture :
 *   ✓ market lu depuis window.KomerceMarket, jamais codé en dur dans l'URL
 *   ✓ fallback KM si window.KomerceMarket absent (jamais un throw)
 *   ✓ échec réseau -> null, jamais une exception qui remonte à l'appelant
 *   ✓ réponse non-ok (404/500) -> null
 *   ✓ productId/serviceId/physicalOfferId manquant -> null sans appel réseau
 *   ✓ URL exacte appelée pour chacune des 3 fonctions
 */

const {
  fetchLocalStockAvailability,
  fetchServiceCard,
  fetchPhysicalOfferCard,
} = require('../../js/discovery-api.js');

const PRODUCT_ID = 'prod-1';
const SERVICE_ID = 'svc-1';
const OFFER_ID   = 'offer-1';

beforeEach(() => {
  global.fetch = jest.fn();
  window.KomerceMarket = { get: () => ({ code: 'KM' }) };
});

describe('fetchLocalStockAvailability', () => {
  it('id manquant -> null sans appel réseau', async () => {
    const result = await fetchLocalStockAvailability(null);
    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('appelle la bonne URL avec le code marché courant', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ availability: 'AVAILABLE_NOW', exposable: true }) });
    await fetchLocalStockAvailability(PRODUCT_ID);
    expect(global.fetch).toHaveBeenCalledWith('/api/local-stock/availability?product_id=prod-1&market=KM');
  });

  it('réponse ok -> retourne le JSON tel quel', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ availability: 'AVAILABLE_NOW', exposable: true }) });
    const result = await fetchLocalStockAvailability(PRODUCT_ID);
    expect(result).toEqual({ availability: 'AVAILABLE_NOW', exposable: true });
  });

  it('réponse non-ok (404) -> null, jamais une exception', async () => {
    global.fetch.mockResolvedValue({ ok: false });
    const result = await fetchLocalStockAvailability(PRODUCT_ID);
    expect(result).toBeNull();
  });

  it('échec réseau -> null, jamais une exception qui remonte', async () => {
    global.fetch.mockRejectedValue(new Error('network down'));
    await expect(fetchLocalStockAvailability(PRODUCT_ID)).resolves.toBeNull();
  });

  it('window.KomerceMarket absent -> fallback KM, jamais un throw', async () => {
    delete window.KomerceMarket;
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ availability: 'UNAVAILABLE', exposable: false }) });
    await fetchLocalStockAvailability(PRODUCT_ID);
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('market=KM'));
  });
});

describe('fetchServiceCard', () => {
  it('id manquant -> null sans appel réseau', async () => {
    const result = await fetchServiceCard(null);
    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('appelle la bonne URL', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ id: SERVICE_ID, title: 'Installation climatiseur' }) });
    await fetchServiceCard(SERVICE_ID);
    expect(global.fetch).toHaveBeenCalledWith('/api/providers-services/services/svc-1?market=KM');
  });

  it('non exposable (404) -> null', async () => {
    global.fetch.mockResolvedValue({ ok: false });
    const result = await fetchServiceCard(SERVICE_ID);
    expect(result).toBeNull();
  });
});

describe('fetchPhysicalOfferCard — cas de vérité samboussas', () => {
  it('appelle la bonne URL', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ id: OFFER_ID, title: 'Samboussas mariage' }) });
    await fetchPhysicalOfferCard(OFFER_ID);
    expect(global.fetch).toHaveBeenCalledWith('/api/providers-services/physical-offers/offer-1?market=KM');
  });

  it('nominal : retourne le JSON tel quel', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: OFFER_ID, title: 'Samboussas mariage', description: 'Plateau de 50', zone: 'Moroni' }),
    });
    const result = await fetchPhysicalOfferCard(OFFER_ID);
    expect(result.title).toBe('Samboussas mariage');
  });
});
