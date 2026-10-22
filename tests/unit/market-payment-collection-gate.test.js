'use strict';
const {
  CENTRAL_MODES, isCentralCollectionAllowed, assertCentralCollectionAllowed,
} = require('../../services/market-payment-collection-gate');

const exec = (rows) => ({ query: jest.fn().mockResolvedValue({ rows }) });

describe('market-payment-collection-gate (lot 3, fail-closed)', () => {
  test('modes non centraux : toujours passants, sans requête', async () => {
    const e = exec([]);
    expect(await isCentralCollectionAllowed(e, 'm1', 'cash_relais')).toBe(true);
    expect(await isCentralCollectionAllowed(e, null, 'mobile_money')).toBe(true);
    expect(e.query).not.toHaveBeenCalled();
  });

  test.each(CENTRAL_MODES)('%s sans ligne autorisée → refus', async (mode) => {
    expect(await isCentralCollectionAllowed(exec([]), 'm1', mode)).toBe(false);
  });

  test('mode central avec ligne non révoquée → autorisé', async () => {
    const e = exec([{ '?column?': 1 }]);
    expect(await isCentralCollectionAllowed(e, 'm1', 'stripe_eur')).toBe(true);
    expect(e.query.mock.calls[0][0]).toMatch(/revoked_at IS NULL/);
  });

  test('marché inconnu (null) → refus sans requête', async () => {
    const e = exec([{}]);
    expect(await isCentralCollectionAllowed(e, null, 'paypal_eur')).toBe(false);
    expect(e.query).not.toHaveBeenCalled();
  });

  test('assert : lève PAYMENT_MODE_NOT_ALLOWED_FOR_MARKET en 409', async () => {
    await expect(assertCentralCollectionAllowed(exec([]), 'm1', 'stripe_eur'))
      .rejects.toMatchObject({ code: 'PAYMENT_MODE_NOT_ALLOWED_FOR_MARKET', statusCode: 409 });
    await expect(assertCentralCollectionAllowed(exec([{}]), 'm1', 'stripe_eur')).resolves.toBeUndefined();
  });
});
