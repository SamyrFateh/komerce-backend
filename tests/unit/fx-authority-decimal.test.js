'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Arithmétique décimale exacte et arrondi half-even de l'autorité FX (aucun flottant).
 */
const { roundHalfEven, parseDecimal, MINOR_UNITS, convert, FxError } = require('../../services/fx-authority');

describe('fx-authority — décimal exact', () => {
  test('parseDecimal : exact, refuse non numérique / notation scientifique / vide', () => {
    expect(parseDecimal('491.96775')).toEqual({ n: 49196775n, d: 100000n });
    expect(parseDecimal(12)).toEqual({ n: 12n, d: 1n });
    for (const bad of ['', 'abc', '1e3', null, undefined, NaN, '1,5']) {
      expect(() => parseDecimal(bad)).toThrow(expect.objectContaining({ code: 'fx_amount_invalid', statusCode: 422 }));
    }
  });

  test('half-even : 0,5→0 ; 1,5→2 ; 2,5→2 ; 2,51→3 ; négatif symétrique', () => {
    expect(roundHalfEven(5n, 10n, 0)).toBe(0n);
    expect(roundHalfEven(15n, 10n, 0)).toBe(2n);
    expect(roundHalfEven(25n, 10n, 0)).toBe(2n);
    expect(roundHalfEven(251n, 100n, 0)).toBe(3n);
    expect(roundHalfEven(-25n, 10n, 0)).toBe(-2n);
    expect(roundHalfEven(1005n, 1000n, 2)).toBe(100n); // 1,005 → 1,00 (pair)
    expect(roundHalfEven(1015n, 1000n, 2)).toBe(102n); // 1,015 → 1,02 (pair)
  });

  test('minor units ISO : zéro décimale KMF/XAF/DJF, deux EUR/USD/AED/CNY', () => {
    expect(MINOR_UNITS).toMatchObject({ KMF: 0, XAF: 0, DJF: 0, EUR: 2, USD: 2, AED: 2, CNY: 2 });
  });

  test('USD→CNY via pivot EUR : les deux cotations publiques sont sourcées, aucun taux USD/CNY inventé', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        if (sql.includes('fx_public_reference_quotes') && sql.includes('UNION ALL')) {
          return { rows: [{ id:'usd-ecb', rate_text:'1.2500', as_of:'2026-10-23', source_label:'BCE' }] };
        }
        if (sql.includes('fx_public_reference_quotes')) {
          return { rows: [{ id:'cny-ecb', rate_text:'7.5000', as_of:'2026-10-23', source_label:'BCE' }] };
        }
        return { rows: [] };
      }),
    };
    const amount = await convert({ amount:'100', from:'USD', to:'CNY', client });
    expect(amount).toMatchObject({
      amount_text:'600.00', pivot:'EUR',
      legs:[
        expect.objectContaining({ pair:'EUR/USD', id:'usd-ecb', side:'from' }),
        expect.objectContaining({ pair:'EUR/CNY', id:'cny-ecb', side:'to' }),
      ],
    });
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  test('identité et refus sans base : devise inconnue, montant invalide', async () => {
    const same = await convert({ amount: '1234.5', from: 'KMF', to: 'KMF' });
    expect(same).toMatchObject({ amount: 1234, from: 'KMF', to: 'KMF', pivot: 'EUR', legs: [] }); // 1234,5 → 1234 (pair)
    await expect(convert({ amount: 1, from: 'ZZZ', to: 'EUR' })).rejects.toMatchObject({ code: 'fx_currency_unsupported', statusCode: 422 });
    await expect(convert({ amount: 'x', from: 'EUR', to: 'EUR' })).rejects.toBeInstanceOf(FxError);
    const eur = await convert({ amount: '10.005', from: 'EUR', to: 'EUR' });
    expect(eur.amount_text).toBe('10.00');
  });
});
