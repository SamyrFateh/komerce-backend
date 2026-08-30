'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/discovery-api.test.js
 *
 * Couverture lecture + mutation Discovery locale.
 */

const {
  fetchLocalStockAvailability,
  fetchServiceCard,
  fetchPhysicalOfferCard,
  createDiscoveryInquiry,
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

describe('createDiscoveryInquiry', () => {
  it('refuse un kind hors contrat sans appel réseau', async () => {
    const result = await createDiscoveryInquiry('marketplace_item', 'x-1');
    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'invalid_target' }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('service : POST uniquement service_id, jamais requester_phone', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ inquiry: { id: 'inq-1', status: 'sent', target_kind: 'service' } }),
    });

    const result = await createDiscoveryInquiry('service', SERVICE_ID);

    expect(result).toEqual({
      ok: true,
      inquiry: { id: 'inq-1', status: 'sent', target_kind: 'service' },
    });
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/providers-services/inquiries?market=KM',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const options = global.fetch.mock.calls[0][1];
    expect(JSON.parse(options.body)).toEqual({ service_id: SERVICE_ID });
    expect(options.body).not.toMatch(/phone/i);
  });

  it('physical_offer : POST uniquement physical_offer_id', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ inquiry: { id: 'inq-2', status: 'sent', target_kind: 'physical_offer' } }),
    });

    await createDiscoveryInquiry('physical_offer', OFFER_ID);
    const options = global.fetch.mock.calls[0][1];
    expect(JSON.parse(options.body)).toEqual({ physical_offer_id: OFFER_ID });
  });

  it('préserve le code identity_required pour permettre un message UX explicite', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Identité requise', code: 'identity_required' }),
    });

    const result = await createDiscoveryInquiry('service', SERVICE_ID);
    expect(result).toEqual({
      ok: false,
      status: 401,
      code: 'identity_required',
      error: 'Identité requise',
    });
  });

  it('échec réseau -> résultat structuré, jamais un throw silencieux', async () => {
    global.fetch.mockRejectedValue(new Error('network down'));
    await expect(createDiscoveryInquiry('service', SERVICE_ID)).resolves.toEqual(
      expect.objectContaining({ ok: false, code: 'network_error' })
    );
  });
});
