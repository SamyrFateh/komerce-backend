'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const { createProviderInquiry } = require('../../js/providers-services-api.js');

beforeEach(() => {
  global.fetch = jest.fn();
  window.KomerceMarket = { get: () => ({ code: 'KM' }) };
});

describe('createProviderInquiry', () => {
  it('refuse une cible hors contrat sans appel réseau', async () => {
    const result = await createProviderInquiry('marketplace_item', 'x-1');
    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'invalid_target' }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refuse une intention hors request/callback', async () => {
    const result = await createProviderInquiry('service', 'svc-1', null, 'call');
    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'invalid_intent' }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('service : POST cible + intent, jamais requester_phone', async () => {
    global.fetch.mockResolvedValue({
      ok: true, status: 201,
      json: async () => ({ inquiry: { id: 'inq-1', status: 'sent', intent: 'request', target_kind: 'service' } }),
    });

    const result = await createProviderInquiry('service', 'svc-1');
    expect(result.ok).toBe(true);
    const options = global.fetch.mock.calls[0][1];
    expect(JSON.parse(options.body)).toEqual({ service_id: 'svc-1', intent: 'request' });
    expect(options.body).not.toMatch(/phone/i);
  });

  it('physical_offer : transporte callback et précision sans contact provider', async () => {
    global.fetch.mockResolvedValue({
      ok: true, status: 201,
      json: async () => ({ inquiry: { id: 'inq-2', status: 'sent', intent: 'callback', target_kind: 'physical_offer' } }),
    });

    await createProviderInquiry('physical_offer', 'offer-1', null, 'callback', 'Confirmer le stock pour 50 sacs');
    const options = global.fetch.mock.calls[0][1];
    expect(JSON.parse(options.body)).toEqual({
      physical_offer_id: 'offer-1',
      intent: 'callback',
      requester_note: 'Confirmer le stock pour 50 sacs',
    });
  });

  it('transmet requested_window et requester_note seulement quand fournis', async () => {
    global.fetch.mockResolvedValue({
      ok: true, status: 201,
      json: async () => ({ inquiry: { id: 'inq-3', status: 'sent', intent: 'request', target_kind: 'service' } }),
    });

    await createProviderInquiry('service', 'svc-1', 'Cette semaine', 'request', 'Toyota Hilux 2012');
    const options = global.fetch.mock.calls[0][1];
    expect(JSON.parse(options.body)).toEqual({
      service_id: 'svc-1', intent: 'request',
      requested_window: 'Cette semaine', requester_note: 'Toyota Hilux 2012',
    });
  });

  it('préserve identity_required pour un message UX explicite', async () => {
    global.fetch.mockResolvedValue({
      ok: false, status: 401,
      json: async () => ({ error: 'Identité requise', code: 'identity_required' }),
    });
    const result = await createProviderInquiry('service', 'svc-1');
    expect(result).toEqual({ ok: false, status: 401, code: 'identity_required', error: 'Identité requise' });
  });

  it('réponse succès sans inquiry id est refusée', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 201, json: async () => ({ inquiry: { status: 'sent' } }) });
    const result = await createProviderInquiry('service', 'svc-1');
    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'invalid_response' }));
  });

  it('échec réseau -> résultat structuré, jamais un throw', async () => {
    global.fetch.mockRejectedValue(new Error('network down'));
    await expect(createProviderInquiry('service', 'svc-1')).resolves.toEqual(
      expect.objectContaining({ ok: false, code: 'network_error' })
    );
  });
});
