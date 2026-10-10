'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { stripContact, wantsLiveProjection, applyLiveProjection } = require('../../services/live-projection');

describe('live-projection — aucun contact dans les réponses Live (LIVE-07)', () => {
  const payload = {
    data: [{ reference: 'CMD-1', client_name: 'A', client_phone: '+2691', client_email: 'a@b.c', is_urgent: true }],
    order: { reference: 'CMD-1', client_phone: '+2691', user_phone: '+2692', relais_phone: '+2693', pickup_code: '••••AB12', pickup_secret_last4: 'AB12',
      timeline: [{ status: 'shipped', changed_by_name: 'X' }], items: [{ produit_nom: 'P' }] },
    when: new Date('2026-10-10T00:00:00Z'),
  };

  test('retire téléphone, e-mail, code de retrait et secrets à toute profondeur, garde le reste', () => {
    const out = stripContact(payload);
    expect(out.data[0]).toEqual({ reference: 'CMD-1', client_name: 'A', is_urgent: true });
    expect(out.order).toEqual({ reference: 'CMD-1', timeline: [{ status: 'shipped', changed_by_name: 'X' }], items: [{ produit_nom: 'P' }] });
    expect(out.when).toBe(payload.when);
    expect(JSON.stringify(out)).not.toMatch(/phone|email|pickup|secret/i);
  });

  test('ne s’applique que sur ?projection=live : les applis /hub et /relais gardent la réponse complète', () => {
    expect(wantsLiveProjection({ query: { projection: 'live' } })).toBe(true);
    expect(wantsLiveProjection({ query: {} })).toBe(false);
    expect(wantsLiveProjection({ query: { projection: 'full' } })).toBe(false);
    expect(wantsLiveProjection(undefined)).toBe(false);
    expect(applyLiveProjection({ query: {} }, payload)).toBe(payload);
    expect(applyLiveProjection({ query: { projection: 'live' } }, payload)).not.toBe(payload);
  });

  test('ne mute pas la source', () => {
    stripContact(payload);
    expect(payload.data[0].client_phone).toBe('+2691');
  });
});
