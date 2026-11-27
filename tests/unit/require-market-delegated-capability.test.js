'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockResolveAuthorization = jest.fn();
const mockResolveSingleMarketAuthorization = jest.fn();
const mockListAuthorizedMarketsForCapability = jest.fn();
const mockAudit = jest.fn();

jest.mock('../../db', () => ({}));

jest.mock('../../services/market-delegation-service', () => ({
  resolveAuthorization: (...args) => mockResolveAuthorization(...args),
  resolveSingleMarketAuthorization: (...args) => mockResolveSingleMarketAuthorization(...args),
  listAuthorizedMarketsForCapability: (...args) => mockListAuthorizedMarketsForCapability(...args),
  audit: (...args) => mockAudit(...args),
}));

const {
  requireMarketDelegatedCapability,
  requireSingleMarketDelegatedCapability,
} = require('../../middleware/require-market-delegated-capability');

function response() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('require-market-delegated-capability — request-local capability proof', () => {
  test('requireMarketDelegatedCapability expose toutes les capabilities résolues', async () => {
    mockResolveAuthorization.mockResolvedValue({
      assignment_id: 'assignment-1',
      membership_id: 'membership-1',
      market_id: 'market-cm',
      market_code: 'CM',
      capabilities: ['pricing.read', 'pricing.decide', 'pricing.activate'],
    });

    const req = {
      user: { id: 'user-1' },
      params: { marketCode: 'CM' },
      workspaceMarket: { id: 'market-cm' },
      headers: {},
      method: 'GET',
      path: '/',
    };
    const res = response();
    const next = jest.fn();

    await requireMarketDelegatedCapability('pricing.read', { audit: false })(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(req.marketDelegatedCapability).toEqual({
      capability: 'pricing.read',
      assignment_id: 'assignment-1',
      membership_id: 'membership-1',
      market_id: 'market-cm',
      market_code: 'CM',
      capabilities: ['pricing.read', 'pricing.decide', 'pricing.activate'],
    });
  });

  test('requireSingleMarketDelegatedCapability expose toutes les capabilities résolues', async () => {
    mockResolveSingleMarketAuthorization.mockResolvedValue({
      assignment_id: 'assignment-2',
      membership_id: 'membership-2',
      market_id: 'market-cm',
      market_code: 'CM',
      capabilities: ['logistics.read', 'execution.transit.confirm'],
    });

    const req = {
      user: { id: 'user-2' },
      headers: {},
      method: 'POST',
      path: '/confirm',
    };
    const res = response();
    const next = jest.fn();

    await requireSingleMarketDelegatedCapability('execution.transit.confirm', { audit: false })(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(req.marketDelegatedCapability).toEqual({
      capability: 'execution.transit.confirm',
      assignment_id: 'assignment-2',
      membership_id: 'membership-2',
      market_id: 'market-cm',
      market_code: 'CM',
      capabilities: ['logistics.read', 'execution.transit.confirm'],
    });
  });

  test.each([
    ['market explicite', requireMarketDelegatedCapability, mockResolveAuthorization, { params: { marketCode: 'CM' }, workspaceMarket: { id: 'market-cm' } }],
    ['marché unique', requireSingleMarketDelegatedCapability, mockResolveSingleMarketAuthorization, {}],
  ])('%s retombe sur [] si le resolver legacy ne fournit pas capabilities', async (_label, factory, resolver, extraReq) => {
    resolver.mockResolvedValue({
      assignment_id: 'assignment-legacy',
      membership_id: 'membership-legacy',
      market_id: 'market-cm',
      market_code: 'CM',
    });

    const req = {
      user: { id: 'user-legacy' },
      headers: {},
      method: 'GET',
      path: '/',
      ...extraReq,
    };
    const res = response();
    const next = jest.fn();

    await factory('pricing.read', { audit: false })(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.marketDelegatedCapability.capabilities).toEqual([]);
  });
});

describe('CANON-MARKET read authority', () => {
  const {resolveReadScope}=require('../../middleware/require-market-delegated-capability');
  test('central admin and local delegated reader are distinct scopes', async()=>{
    expect(await resolveReadScope({user:{id:'a',role:'admin'}},'operations.read')).toBeNull();
    mockListAuthorizedMarketsForCapability.mockResolvedValue([{market_id:'CM'},{market_id:'CM'}]);
    expect(await resolveReadScope({user:{id:'m',role:'market_operator'},query:{market_id:'CG'}},'operations.read')).toEqual(['CM']);
    expect(mockListAuthorizedMarketsForCapability).toHaveBeenCalledWith(expect.anything(),{userId:'m',requiredCapability:'operations.read'});
  });
  test('absence de droit et rôle étranger refusés',async()=>{
    mockListAuthorizedMarketsForCapability.mockResolvedValue([]);
    await expect(resolveReadScope({user:{id:'m',role:'market_operator'}},'operations.read')).rejects.toMatchObject({status:403});
    await expect(resolveReadScope({user:{id:'c',role:'client'}},'operations.read')).rejects.toMatchObject({status:403});
  });
});
