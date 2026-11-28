'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const svc=require('../../services/conversation-service');
const request={id:'11111111-1111-4111-8111-111111111111',status:'new'};
const actorId='22222222-2222-4222-8222-222222222222';
describe('conversation channel policy',()=>{
  test.each([['client','internal'],['hub','client'],['unknown','client']])('refuses scope %s on %s',(scope,visibility)=>{
    expect(()=>svc.prepare({scope,visibility,body:'test'})).toThrow();
  });
  test.each([['client','client'],['hub','internal'],['market','client'],['market','internal']])('permits authorized scope %s on %s',(scope,visibility)=>{
    expect(svc.prepare({scope,visibility,body:'message'})).toMatchObject({body:'message',visibility});
  });
  test('rejects empty message, fourth file and oversized text',()=>{
    expect(()=>svc.prepare({scope:'client',visibility:'client',body:' '})).toThrow('CONVERSATION_MESSAGE_EMPTY');
    expect(()=>svc.prepare({scope:'client',visibility:'client',body:'a'.repeat(2001)})).toThrow('CONVERSATION_TEXT_INVALID');
    expect(()=>svc.prepare({scope:'client',visibility:'client',files:[{},{},{},{}]})).toThrow('CONVERSATION_TOO_MANY_PHOTOS');
  });
  test('closed dossier fails before any write',async()=>{
    const q={query:jest.fn()};
    await expect(svc.append(q,{request:{...request,status:'closed'},actorId,scope:'client',visibility:'client',body:'test'})).rejects.toMatchObject({status:409});
    expect(q.query).not.toHaveBeenCalled();
  });
  test('Hub cannot send client-visible messages and client cannot write internal events',async()=>{
    const q={query:jest.fn()};
    await expect(svc.append(q,{request,actorId,scope:'hub',visibility:'client',body:'test'})).rejects.toMatchObject({status:403});
    await expect(svc.append(q,{request,actorId,scope:'client',visibility:'client',eventType:'closed',body:'test'})).rejects.toMatchObject({status:403});
    expect(q.query).not.toHaveBeenCalled();
  });
  test.each([['client',['client']],['hub',['internal']],['market',['client','internal']]])('list and attachment query both enforce SQL scope %s',async(scope,channels)=>{
    const q={query:jest.fn().mockResolvedValue({rows:[]})};
    await svc.list(q,{requestId:request.id,scope});
    expect(q.query.mock.calls[0][0]).toMatch(/visibility=ANY/);
    expect(q.query.mock.calls[0][1][1]).toEqual(channels);
    await expect(svc.attachment(q,{requestId:request.id,attachmentId:actorId,scope})).rejects.toMatchObject({status:404});
    expect(q.query.mock.calls[1][0]).toMatch(/visibility=ANY/);
    expect(q.query.mock.calls[1][1][2]).toEqual(channels);
  });
});