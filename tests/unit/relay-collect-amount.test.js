'use strict';
const { resolveCollectAmount } = require('../../services/relay-collect-amount');

describe('relay-collect-amount — devise d’encaissement = devise du marché', () => {
  test('KM : KMF depuis le pivot interne', () => {
    expect(resolveCollectAmount({ total_kmf: 12000, market_currency: 'KMF' }))
      .toEqual({ amount: 12000, currency: 'KMF', available: true });
  });
  test('sans marché connu : KMF historique', () => {
    expect(resolveCollectAmount({ total_kmf: 500 })).toEqual({ amount: 500, currency: 'KMF', available: true });
  });
  test('CM : montant XAF du snapshot, jamais le KMF', () => {
    expect(resolveCollectAmount({ total_kmf: 12000, display_total_amount: '15500.00', display_currency: 'XAF', market_currency: 'XAF' }))
      .toEqual({ amount: 15500, currency: 'XAF', available: true });
  });
  test('CM sans snapshot : indisponible, pas de repli KMF', () => {
    expect(resolveCollectAmount({ total_kmf: 12000, market_currency: 'XAF' }))
      .toEqual({ amount: null, currency: 'XAF', available: false });
  });
  test('CM avec snapshot dans une autre devise (EUR) : indisponible', () => {
    expect(resolveCollectAmount({ total_kmf: 12000, display_total_amount: 30, display_currency: 'EUR', market_currency: 'XAF' }).available).toBe(false);
  });
  test('KM avec snapshot EUR : on encaisse en KMF (devise du marché)', () => {
    expect(resolveCollectAmount({ total_kmf: 9000, display_total_amount: 18, display_currency: 'EUR', market_currency: 'KMF' }))
      .toEqual({ amount: 9000, currency: 'KMF', available: true });
  });
});
