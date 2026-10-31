'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
let mockRole = 'admin';
const mockAuthorized = jest.fn();
jest.mock('../../db', () => ({query:jest.fn()}));
jest.mock('../../middleware/auth', () => ({
  authenticate:(req,res,next)=>{req.user={id:'user-km',role:mockRole};next();}
}));
jest.mock('../../services/market-delegation-service', () => ({
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

beforeEach(()=>{
  jest.resetAllMocks();
  mockRole='admin';
  db.query.mockImplementation(async sql => {
    if (String(sql).includes('FROM users')) return {rows:[{role:mockRole}]};
    return {rows:[{market_code:'CM'},{market_code:'KM'}]};
  });
});

test('Admin réel : les marchés actifs assignés sont accessibles sans membership',async()=>{
  const response=await request(app).get('/api/market-delegation/catalog/authorized-markets');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    required_capability:'catalog.read',
    market_codes:['CM','KM'],
  });
  expect(response.headers['cache-control']).toBe('private, no-store');
  expect(mockAuthorized).not.toHaveBeenCalled();
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('FROM users'),['user-km']);
});

test('Opérateur : seuls les marchés avec membership catalog.read sont exposés',async()=>{
  mockRole='market_operator';
  mockAuthorized.mockResolvedValue([
    {market_code:'CG'},{market_code:'CG'},{market_code:'CM'},
  ]);
  const response=await request(app).get('/api/market-delegation/catalog/authorized-markets');
  expect(response.status).toBe(200);
  expect(response.body.market_codes).toEqual(['CG','CM']);
  expect(mockAuthorized).toHaveBeenCalledWith(db,{
    userId:'user-km',requiredCapability:'catalog.read',
  });
});

test('Opérateur sans membership : aucune autorisation catalog.read inventée',async()=>{
  mockRole='market_operator';
  mockAuthorized.mockResolvedValue([]);
  const response=await request(app).get('/api/market-delegation/catalog/authorized-markets');
  expect(response.status).toBe(200);
  expect(response.body.market_codes).toEqual([]);
});

test('Rôle Admin mis en cache mais révoqué en base ne donne aucun accès central',async()=>{
  db.query.mockImplementation(async sql => String(sql).includes('FROM users')
    ? {rows:[{role:'client'}]} : {rows:[]});
  mockAuthorized.mockResolvedValue([]);
  const response=await request(app).get('/api/market-delegation/catalog/authorized-markets');
  expect(response.status).toBe(200);
  expect(response.body.market_codes).toEqual([]);
  expect(mockAuthorized).toHaveBeenCalled();
});

test('Échec SQL : aucune permission inventée',async()=>{
  db.query.mockRejectedValue(new Error('connection_failed'));
  const response=await request(app).get('/api/market-delegation/catalog/authorized-markets');
  expect(response.status).toBe(500);
  expect(response.body.market_codes).toBeUndefined();
});
