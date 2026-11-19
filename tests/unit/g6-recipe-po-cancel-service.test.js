/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
jest.mock('../../db',()=>({getClient:jest.fn()}));
const db=require('../../db');
const {assertPeers,readEligibility,cancelRecipePo}=require('../../services/g6-recipe-po-cancel-service');
const PO='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',role:'admin'};
const ITEM={line_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',order_id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',simulation_scope:'G6-BUYER',payment_mode:'cash_relais'};
const errCode=(f,code)=>expect(f).toThrow(expect.objectContaining({code}));
describe('G6 recipe PO scope guards',()=>{
 test('mixed peer and missing peer are refused',()=>{
   errCode(()=>assertPeers([]),'G6_PO_NO_ORDERS');
   errCode(()=>assertPeers([ITEM,{...ITEM,simulation_scope:null}]),'G6_PO_MIXED_SCOPE');
   errCode(()=>assertPeers([ITEM,{...ITEM,payment_mode:'stripe_eur'}]),'G6_PO_NON_CASH');
 });
 test('reader hides mixed PO, allows exclusively G6 cash',async()=>{
   const q={query:jest.fn().mockResolvedValueOnce({rows:[ITEM]}).mockResolvedValueOnce({rows:[ITEM,{...ITEM,simulation_scope:null}]})};
   expect((await readEligibility(PO,q)).eligible).toBe(true);
   expect(await readEligibility(PO,q)).toMatchObject({eligible:false,reason:'G6_PO_MIXED_SCOPE'});
 });
 test('admin and reason required before DB access',async()=>{
   await expect(cancelRecipePo(PO,{actor:{role:'agent_hub',id:ACTOR.id},reason:'Nettoyage de recette'})).rejects.toMatchObject({code:'G6_PO_ADMIN_ONLY'});
   await expect(cancelRecipePo(PO,{actor:ACTOR,reason:'a'})).rejects.toMatchObject({code:'G6_PO_REASON_REQUIRED'});
   expect(db.getClient).not.toHaveBeenCalled();
 });
});
describe('G6 recipe PO transaction',()=>{
 let client,rows;
 beforeEach(()=>{
   jest.resetAllMocks();
   rows={
     po:{id:PO,status:'confirmed',order_id:null},
     lines:[ITEM],physical:[],debits:[],detached:[{id:ITEM.line_id}]
   };
   client={query:jest.fn(async(sql)=>{
     if(sql.startsWith('SELECT id,status,order_id'))return {rows:rows.po?[rows.po]:[]};
     if(sql.includes('SELECT pl.id AS line_id'))return {rows:rows.lines};
     if(sql.includes('SELECT 1 FROM hub_purchase_allocations'))return {rows:rows.physical};
     if(sql.includes('SELECT 1 FROM supplier_execution_payments'))return {rows:rows.debits};
     if(sql.includes('UPDATE purchase_lines'))return {rows:rows.detached};
     return {rows:[]};
   }),release:jest.fn()};
   db.getClient.mockResolvedValue(client);
 });
 test('notified/confirmed all G6: one commit, purchase lines detached, no providers',async()=>{
   const result=await cancelRecipePo(PO,{actor:ACTOR,reason:'Fin recette contrôlée'});
   expect(result).toMatchObject({status:'cancelled',external_calls:0,detached:[ITEM.line_id]});
   const sql=client.query.mock.calls.map(x=>x[0]);
   expect(sql).toContain('BEGIN');expect(sql).toContain('COMMIT');
   expect(sql.join('\n')).toContain('UPDATE purchase_orders SET status=\'cancelled\'');
   expect(sql.join('\n')).toContain('UPDATE purchase_lines SET purchase_order_id=NULL');
   expect(sql.join('\n')).toContain('UPDATE alerts SET resolved_at=NOW()');
   expect(sql).not.toContain('ROLLBACK');expect(client.release).toHaveBeenCalledTimes(1);
 });
 for(const [kind,change,code] of [
   ['mixed',r=>r.lines.push({...ITEM,simulation_scope:'REAL'}),'G6_PO_MIXED_SCOPE'],
   ['physical',r=>r.physical.push({exists:1}),'G6_PO_PHYSICAL_RECEIVED'],
   ['debit',r=>r.debits.push({exists:1}),'G6_PO_REAL_DEBIT'],
   ['status',r=>r.po.status='hub_received','G6_PO_STATUS_FORBIDDEN']
 ]){
   test('refuses '+kind+' atomically',async()=>{change(rows);
     await expect(cancelRecipePo(PO,{actor:ACTOR,reason:'Fin recette contrôlée'})).rejects.toMatchObject({code});
     const sql=client.query.mock.calls.map(x=>x[0]);
     expect(sql).not.toContain('COMMIT');expect(sql).toContain('ROLLBACK');
     expect(sql.some(x=>x.startsWith('UPDATE purchase_orders'))).toBe(false);
   });
 }
});

test('les paramètres texte des UPDATE sont typés (pas de "could not determine data type")', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../services/g6-recipe-po-cancel-service.js'), 'utf8');
  expect(src).toMatch(/CONCAT\(COALESCE\(notes,''\),\$2::text\)/);
  expect(src).toMatch(/cancel_reason=\$2::text/);
});
