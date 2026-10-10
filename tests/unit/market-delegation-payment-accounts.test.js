'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../middleware/auth', () => ({ authenticate: (req, res, next) => next() }));
jest.mock('../../services/market-payment-account-service', () => ({ listMarketPaymentAccounts: jest.fn() }));
const { listMarketPaymentAccounts } = require('../../services/market-payment-account-service');
const router = require('../../routes/market-delegation-payment-accounts');

function handler() {
  const layer = router.stack.find(l => l.route && l.route.path === '/markets/:marketCode/payment-accounts');
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
const res = () => { const r = { statusCode: 200 }; r.status = c => { r.statusCode = c; return r; }; r.json = b => { r.body = b; return r; }; return r; };

beforeEach(() => listMarketPaymentAccounts.mockReset());

describe('route Market : comptes de paiement (lecture seule)', () => {
  test('une seule route GET, marché pris du chemin et acteur de la session', async () => {
    expect(router.stack.filter(l => l.route).map(l => Object.keys(l.route.methods))).toEqual([['get']]);
    listMarketPaymentAccounts.mockResolvedValue({ accounts: [], read_only: true });
    const out = res();
    await handler()({ params: { marketCode: 'CM' }, user: { id: 'u1' }, body: { market_id: 'x' } }, out, jest.fn());
    expect(listMarketPaymentAccounts).toHaveBeenCalledWith(expect.anything(), { marketCode: 'CM', actorUserId: 'u1' });
    expect(out.body).toEqual({ accounts: [], read_only: true });
  });

  test('erreur de délégation connue → statut et code ; erreur inconnue → next', async () => {
    listMarketPaymentAccounts.mockRejectedValueOnce(Object.assign(new Error('refus'), { status: 403, code: 'FORBIDDEN' }));
    const out = res();
    await handler()({ params: { marketCode: 'CM' }, user: { id: 'u1' } }, out, jest.fn());
    expect(out.statusCode).toBe(403);
    expect(out.body).toEqual({ error: 'refus', code: 'FORBIDDEN' });
    const failure = new Error('boom');
    listMarketPaymentAccounts.mockRejectedValueOnce(failure);
    const next = jest.fn();
    await handler()({ params: { marketCode: 'CM' }, user: { id: 'u1' } }, res(), next);
    expect(next).toHaveBeenCalledWith(failure);
  });
});
