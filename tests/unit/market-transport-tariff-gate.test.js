'use strict';
const {
  isTransportTariffApplicable, assertTransportTariffApplicable, GLOBAL_TRANSPORT_TARIFF_CURRENCY,
} = require('../../services/market-transport-tariff-gate');

describe('market-transport-tariff-gate (lot 4, fail-closed)', () => {
  test('tarif global = KMF', () => expect(GLOBAL_TRANSPORT_TARIFF_CURRENCY).toBe('KMF'));

  test('commande sans ligne import : toujours applicable (aucun transport international)', () => {
    expect(isTransportTariffApplicable({ marketCurrency: 'XAF', importItemCount: 0 })).toBe(true);
    expect(isTransportTariffApplicable({ marketCurrency: null, importItemCount: 0 })).toBe(true);
  });

  test('ligne import en devise du tarif global : applicable', () => {
    expect(isTransportTariffApplicable({ marketCurrency: 'kmf', importItemCount: 2 })).toBe(true);
  });

  test.each(['XAF', 'DJF', 'EUR', '', null, undefined])('ligne import, devise %p : refusée', (c) => {
    expect(isTransportTariffApplicable({ marketCurrency: c, importItemCount: 1 })).toBe(false);
  });

  test('assert : 409 MARKET_TRANSPORT_TARIFF_MISSING', () => {
    expect(() => assertTransportTariffApplicable({ marketCurrency: 'XAF', importItemCount: 1 }))
      .toThrow(expect.objectContaining({ code: 'MARKET_TRANSPORT_TARIFF_MISSING', statusCode: 409 }));
    expect(() => assertTransportTariffApplicable({ marketCurrency: 'KMF', importItemCount: 1 })).not.toThrow();
  });
});
