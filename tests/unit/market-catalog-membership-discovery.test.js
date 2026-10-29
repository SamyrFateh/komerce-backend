'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const mockAuthorized=jest.fn();
jest.mock('../../db',()=>({query:jest.fn()}));
jest.mock('../../middleware/auth',()=>({
  authenticate:(req,res,next)=>{req.user={id:'user-km',role:'admin'};next();}
}));
jest.mock('../../services/market-delegation-service',()=>({
  listAuthorizedMarketsForCapability:(...args)=>mockAuthorized(...args),
}));
jest.mock('../../services/market-delegation-catalog-service',()=>({}));
jest.mock('../../services/market-operation-guard',()=>({assertMarketOperationAllowed:jest.fn()}));
const express=require('express');
const request=require('supertest');
const db=require('../../db');
const router=require('../../routes/market-delegation-catalog');
const app=express();
app.use('/api/market-delegation',router);

beforeEach(()=>jest.resetAllMocks());

test('catalog.read : seuls les marchés avec membership active sont exposés',async()=>{
  mockAuthorized.mockResolvedValue([
    {market_code:'CG'},{market_code:'CG'},{market_code:'CM'},
  ]);
  const response=await request(app).get('/api/market-delegation/catalog/authorized-markets');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    required_capability:'catalog.read',
    market_codes:['CG','CM'],
  });
  expect(response.headers['cache-control']).toBe('private, no-store');
  expect(mockAuthorized).toHaveBeenCalledWith(db,{
    userId:'user-km', requiredCapability:'catalog.read',
  });
});

test('admin global sans membership : aucune autorisation catalog.read inventée',async()=>{
  mockAuthorized.mockResolvedValue([]);
  const response=await request(app).get('/api/market-delegation/catalog/authorized-markets');
  expect(response.status).toBe(200);
  expect(response.body.market_codes).toEqual([]);
});

test('échec lecture des délégations : aucune permission inventée',async()=>{
  mockAuthorized.mockRejectedValue(new Error('connection_failed'));
  const response=await request(app).get('/api/market-delegation/catalog/authorized-markets');
  expect(response.status).toBe(500);
  expect(response.body.market_codes).toBeUndefined();
});
