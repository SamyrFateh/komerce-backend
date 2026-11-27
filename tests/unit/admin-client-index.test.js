'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('fs');
const path = require('path');

test('L2 : la route index Clients transmet le périmètre de recette au service (marché et global)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../routes/admin-client-index.js'), 'utf8');
  expect(src.match(/simulationScope: req\.query\.simulation_scope/g)).toHaveLength(2);
});


test('A1 : garde de lecture admin sans delegation et filtre SQL du marché résolu', async () => {
  jest.resetModules();
  jest.doMock('../../db', () => ({query:jest.fn()}));
  jest.doMock('../../middleware/auth', () => ({authenticate:jest.fn(),requireAdmin:jest.fn(),requireRole:()=>jest.fn()}));
  jest.doMock('../../middleware/require-market-delegated-role', () => ({attachMarketDelegatedRoleFor:()=>jest.fn()}));
  const deny=jest.fn((req,res,next)=>res.status(403).json({code:'MARKET_CAPABILITY_REQUIRED'}));
  jest.doMock('../../middleware/require-market-delegated-capability', () => ({requireMarketDelegatedCapability:()=>deny}));
  jest.doMock('../../services/client-index',()=>({listClients:jest.fn().mockResolvedValue({items:[]})}));
  const api=require('../../routes/admin-client-index')._test;
  const svc=require('../../services/client-index');
  const req={user:{role:'admin',id:'u1'},query:{},clientIndexMarket:{id:'m-cm',code:'CM'}};
  const res={set:jest.fn(),json:jest.fn(),status:jest.fn().mockReturnThis()};
  const next=jest.fn();
  api.requireClientIndexMarketRead(req,res,next);
  expect(next).toHaveBeenCalledTimes(1);
  expect(deny).not.toHaveBeenCalled();
  await api.marketHandler(req,res,next);
  expect(svc.listClients).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({marketIds:['m-cm']}));
  api.requireClientIndexMarketRead({...req,user:{role:'market_operator',id:'op'}},res,next);
  expect(deny).toHaveBeenCalledTimes(1);
  expect(res.status).toHaveBeenCalledWith(403);
});
