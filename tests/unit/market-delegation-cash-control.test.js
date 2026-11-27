'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
jest.mock('../../middleware/auth', () => ({ authenticate: (req,res,next) => next() }));
jest.mock('../../services/market-cash-control-policy-service', () => ({ readMarketCashPolicy: jest.fn() , updateMarketCashPolicy: jest.fn() }));
jest.mock('../../services/cash-custody-service', () => ({}));
const db = require('../../db');
const svc = require('../../services/market-cash-control-policy-service');
const router = require('../../routes/market-delegation-cash-control');
function handler(path,method='get') {
  const layer = router.stack.find(l=>l.route && l.route.path===path && l.route.methods[method]);
  return layer.route.stack.at(-1).handle;
}
function response() { const r={statusCode:200}; r.status=c=>{r.statusCode=c;return r}; r.json=b=>{r.body=b;return r}; return r; }
beforeEach(()=>{ jest.clearAllMocks(); });
test.each(['admin','market_operator'])('A1 %s: only authenticated admin role forwarded, route market wins', async role=>{
  const client={query:jest.fn().mockResolvedValue({rows:[]}),release:jest.fn()};
  db.getClient.mockResolvedValue(client);
  svc.readMarketCashPolicy.mockResolvedValue({ authz:{market_code:'CM',capabilities:['finance.read']}, policy:{}, settlements:[], read_only:true });
  const out=response(), next=jest.fn();
  await handler('/markets/:marketCode/cash-control-policy')({user:{id:'u1',role},params:{marketCode:'CM'},query:{market_id:'CG',actorRole:'admin'},body:{market_id:'CG'},headers:{}},out,next);
  expect(next).not.toHaveBeenCalled();
  expect(out.statusCode).toBe(200);
  const arg=svc.readMarketCashPolicy.mock.calls[0][1];
  expect(arg.marketCode).toBe('CM');
  expect(arg.userId).toBe('u1');
  expect(arg.actorRole).toBe(role==='admin'?'admin':undefined);
});
test('delegated refusal propagates 403',async()=>{
  db.getClient.mockResolvedValue({query:jest.fn().mockResolvedValue({rows:[]}),release:jest.fn()});
  svc.readMarketCashPolicy.mockRejectedValueOnce(Object.assign(new Error('refus'),{code:'MARKET_MEMBERSHIP_REQUIRED',status:403}));
  const out=response();
  await handler('/markets/:marketCode/cash-control-policy')({user:{id:'u1',role:'market_operator'},params:{marketCode:'CG'},query:{},headers:{}},out,jest.fn());
  expect(out.statusCode).toBe(403);
  expect(out.body.code).toBe('MARKET_MEMBERSHIP_REQUIRED');
});
test('PUT with client market id refuses before transaction',async()=>{const out=response();await handler('/markets/:marketCode/cash-control-policy','put')({user:{id:'u1',role:'admin'},params:{marketCode:'CM'},body:{market_id:'CG'},headers:{}},out,jest.fn());expect(out.statusCode).toBe(400);expect(svc.updateMarketCashPolicy).not.toHaveBeenCalled();expect(db.getClient).not.toHaveBeenCalled();});