'use strict';
const {
  isTransportTariffApplicable, assertTransportTariffApplicable, GLOBAL_TRANSPORT_TARIFF_CURRENCY,
  resolveEffectiveTransportRates,
} = require('../../services/market-transport-tariff-gate');
const { quoteTransportPriceForOrder } = require('../../services/transport-pricing');

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

  describe('tarifs de vente propres au Market', () => {
    const globalRates = { SEA_KMF_PER_KG_COMMERCIAL: 65, AIR_KMF_PER_KG_TAXABLE: 2500, AIR_VOLUMETRIC_DIVISOR: 6000 };

    test('Market non-KMF avec tarif propre : applicable', () => {
      expect(isTransportTariffApplicable({ marketCurrency: 'XAF', importItemCount: 1, marketRates: { SEA_KMF_PER_KG_COMMERCIAL: 90 } })).toBe(true);
    });

    test.each([{}, null, { SEA_KMF_PER_KG_COMMERCIAL: 0 }, { OTHER: 5 }])('Market non-KMF sans tarif valide %p : refusé', (mr) => {
      expect(isTransportTariffApplicable({ marketCurrency: 'DJF', importItemCount: 1, marketRates: mr })).toBe(false);
    });

    test('non-KMF : jamais de repli sur les tarifs globaux KMF', () => {
      const r = resolveEffectiveTransportRates({ marketCurrency: 'XAF', globalRates, marketRates: { SEA_KMF_PER_KG_COMMERCIAL: 90 } });
      expect(r).toEqual({ SEA_KMF_PER_KG_COMMERCIAL: 90, AIR_VOLUMETRIC_DIVISOR: 6000 });
      expect(r.AIR_KMF_PER_KG_TAXABLE).toBeUndefined();
    });

    test('KMF : globaux surchargés clé par clé par le Market', () => {
      expect(resolveEffectiveTransportRates({ marketCurrency: ' kmf ', globalRates, marketRates: { AIR_KMF_PER_KG_TAXABLE: 3000 } }))
        .toEqual({ SEA_KMF_PER_KG_COMMERCIAL: 65, AIR_KMF_PER_KG_TAXABLE: 3000, AIR_VOLUMETRIC_DIVISOR: 6000 });
      expect(resolveEffectiveTransportRates({ marketCurrency: 'KMF', globalRates, marketRates: {} }))
        .toEqual(globalRates);
    });

    test('devis au tarif du Market : montant calculé, SEA seul + AIR demandé → refus (rail non exposé, et aucun tarif AIR de repli)', () => {
      const rates = resolveEffectiveTransportRates({ marketCurrency: 'XAF', globalRates, marketRates: { SEA_KMF_PER_KG_COMMERCIAL: 90 } });
      const sea = quoteTransportPriceForOrder({ items: [{ requested_transport_rail: 'SEA_STANDARD', weight_kg: 2, volume_cm3: 0, quantity: 3 }], rates });
      expect(sea.transport_price_kmf).toBe(540); // 2 kg × 3 × 90, jamais 65 (global)
      expect(() => quoteTransportPriceForOrder({ items: [{ requested_transport_rail: 'AIR_EXPRESS', weight_kg: 1, volume_cm3: 0, quantity: 1 }], rates }))
        .toThrow(expect.objectContaining({ name: 'TransportPricingError' }));
      expect(rates.AIR_KMF_PER_KG_TAXABLE).toBeUndefined();
    });
  });
});
