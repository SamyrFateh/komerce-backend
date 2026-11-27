'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const { hasPricingGlobalAuthority, requirePricingGlobalAuthority } = require('../../middleware/require-pricing-global-authority');

beforeEach(() => jest.clearAllMocks());

test('grant actif ouvre autorité pricing globale', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
  await expect(hasPricingGlobalAuthority('u1')).resolves.toBe(true);
  expect(mockQuery.mock.calls[0][0]).toContain('pricing_global_access_grants');
});

test('absence de grant refuse autorité', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  await expect(hasPricingGlobalAuthority('u1')).resolves.toBe(false);
});

test('middleware renvoie 403 sans grant', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  const req = { user: { id: 'u1', role: 'admin' } };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  await requirePricingGlobalAuthority(req, res, next);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'pricing_global_access_denied' }));
  expect(next).not.toHaveBeenCalled();
});

test('autorité déjà résolue ne relit pas la DB', async () => {
  const req = { user: { id: 'u1' }, pricingGlobalAuthority: true };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  requirePricingGlobalAuthority(req, res, next);
  expect(next).toHaveBeenCalled();
  expect(mockQuery).not.toHaveBeenCalled();
});

test('A1: authenticated admin GET needs no separate grant, POST retains its guard',async()=>{
  const {requirePricingGlobalAuthority}=require('../../middleware/require-pricing-global-authority');
  mockQuery.mockReset();
  const response=()=>({statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}});
  const readNext=jest.fn();
  await requirePricingGlobalAuthority({method:'GET',user:{id:'a',role:'admin'}},response(),readNext);
  expect(readNext).toHaveBeenCalledTimes(1);expect(mockQuery).not.toHaveBeenCalled();
  mockQuery.mockResolvedValueOnce({rows:[]});
  const writeNext=jest.fn(),res=response();
  await requirePricingGlobalAuthority({method:'POST',user:{id:'a',role:'admin'}},res,writeNext);
  expect(res.statusCode).toBe(403);expect(writeNext).not.toHaveBeenCalled();
});
