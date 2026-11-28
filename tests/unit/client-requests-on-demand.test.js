'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const mockList = jest.fn();
const mockRead = jest.fn();
const mockPost = jest.fn();
const mockAttachment = jest.fn();
const mockTx = {};
jest.mock('../../db', () => ({withTransaction: fn=>fn(mockTx)}));
jest.mock('../../middleware/auth', () => ({
  authenticate: (req,res,next)=>{ if(!req.headers.authorization)return res.sendStatus(401); req.user={id:'actor-1',role:req.headers.authorization};next(); },
  requireRole: roles=>(req,res,next)=>roles.includes(req.user.role)?next():res.sendStatus(403)
}));
jest.mock('../../middleware/require-verified-identity',()=>({requireVerifiedIdentityForCheckout:(_req,_res,next)=>next()}));
jest.mock('../../middleware/rate-limit',()=>({clientRequestLimiter:(_req,_res,next)=>next()}));
jest.mock('../../middleware/upload',()=>({validateMagicBytes:(_req,_res,next)=>next()}));
jest.mock('../../services/market-delegation-client-request-service',()=>({list:mockList,read:mockRead,post:mockPost,attachment:mockAttachment}));
jest.mock('../../services/signal-service',()=>({upsertSignal:jest.fn(),resolveSignalForEntity:jest.fn()}));
jest.mock('../../services/client-notification-service',()=>({emitClientRequestReply:jest.fn()}));
const router=require('../../routes/client-requests');
function app(){const a=express();a.use(express.json());a.use('/api',router);a.use((_err,_req,res,_next)=>res.sendStatus(500));return a}
beforeEach(()=>jest.clearAllMocks());
test('unauthenticated request never reaches conversation service',async()=>{
  await request(app()).get('/api/client-requests').expect(401);
  expect(mockList).not.toHaveBeenCalled();
});
test('market read uses URL market and authenticated actor, never query impersonation',async()=>{
  mockList.mockResolvedValue([]);
  const res=await request(app()).get('/api/markets/CM/client-requests?actor=admin&market=CG').set('Authorization','market_operator').expect(200);
  expect(mockList).toHaveBeenCalledWith(mockTx,expect.objectContaining({scope:'market',market:'CM',actor:{id:'actor-1',role:'market_operator',verifiedOtpPhone:null}}));
  expect(res.headers['cache-control']).toBe('private, no-store');
});
test('Hub route rejects an authenticated client before service invocation',async()=>{
  await request(app()).get('/api/hub/client-requests').set('Authorization','client').expect(403);
  expect(mockList).not.toHaveBeenCalled();
});
test('attachment refusal is preserved and no attachment bytes escape',async()=>{
  mockAttachment.mockRejectedValueOnce(Object.assign(new Error('denied'),{status:404,code:'NOT_FOUND'}));
  const res=await request(app()).get('/api/client-requests/REQ-1/attachments/private').set('Authorization','client').expect(404);
  expect(res.body.code).toBe('NOT_FOUND');
  expect(res.headers['cache-control']).toBe('private, no-store');
});
test('dashboard uses server-scoped endpoints, channel separation and bounded photo rendering',()=>{
  const dir=path.join(__dirname,'../../public/dashboards/canonical');
  const js=fs.readFileSync(path.join(dir,'js/client-requests.js'),'utf8');
  const css=fs.readFileSync(path.join(dir,'css/client-requests.css'),'utf8');
  expect(js).toContain("hub?'/api/hub/client-requests':'/api/markets/'");
  expect(js).toContain("if(m.visibility!==channel)continue");
  expect(js).toContain("credentials:'include',cache:'no-store'");
  expect(js).toContain("composer.hidden=!canWrite||r.status==='closed'");
  expect(css).toContain('.kmc-client-request-compose[hidden]{display:none}');
  expect(css).toContain('overflow:auto');
});
