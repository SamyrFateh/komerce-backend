'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * Feature Fingerprint output truth: count successful parcel_items inserts,
 * never just the cardinality of requested item_ids.
 * Route callback and canonical SQL writer are REAL; SQL executor is simulated.
 * Independent PostgreSQL A/B proof lives on research/feature-fingerprint-eco-pg-20261026.
 */
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {assignWholeOrderItemToParcel}=require('../../services/parcel-item-mutation-service');

const source=fs.readFileSync(path.join(__dirname,'../../routes/hub-dashboard.js'),'utf8');
const start=source.indexOf("router.post('/orders/:id/create-parcel'");
const end=source.indexOf("router.post('/orders/:id/auto-prepare'",start);
if(start<0||end<0)throw Error('Real Hub create-parcel handler was not found');

async function attempt(itemIds){
  const membership=new Set();
  const db={
    query: async(sql,params=[])=>{
      if(/^SELECT id, reference FROM orders/.test(String(sql)))return {rows:[{id:'order-a',reference:'A'}]};
      if(/^INSERT INTO parcel_items/.test(String(sql).trim())){
        const [parcelId,lineId,orderId]=params;
        if(parcelId==='parcel-a'&&lineId==='line-a'&&orderId==='order-a'&&!membership.has(lineId)){
          membership.add(lineId);return {rowCount:1,rows:[]};
        }
        return {rowCount:0,rows:[]};
      }
      if(/^\s*INSERT INTO order_comments/.test(String(sql)))return {rowCount:1,rows:[]};
      throw Error('Unexpected SQL: '+String(sql).slice(0,80));
    }
  };
  let handler;
  vm.runInNewContext(source.slice(start,end),{
    router:{post:(name,...handlers)=>{if(name==='/orders/:id/create-parcel')handler=handlers.at(-1);}},
    hubAuth:[],db,
    generateParcelRef:async()=> 'FP-A',
    createHubParcel:async()=>({id:'parcel-a',reference:'FP-A',order_id:'order-a'}),
    assignWholeOrderItemToParcel,
    log:{warn:()=>{}},
    require:(name)=>{
      if(name==='../services/parcel-security')return {generateExternalCode:()=>null,generateSealCode:()=>null};
      throw Error('Unexpected import '+name);
    },console
  },{timeout:1000});
  expect(typeof handler).toBe('function');
  let status=null,response=null,nextError=null;
  const res={status(code){status=code;return this;},json(body){response=body;return this;}};
  await handler({body:{item_ids:itemIds},params:{id:'order-a'},user:{id:'actor'}},res,e=>{nextError=e;});
  if(nextError)throw nextError;
  return {status,announced:response.items_assigned,actual:membership.size};
}

describe('Hub create-parcel — truthful items_assigned',()=>{
  test.each([
    ['nominal', ['line-a'], 1],
    ['foreign order item', ['line-b'], 0],
    ['duplicate request', ['line-a','line-a'], 1],
    ['empty request', [], 0],
  ])('%s',async(_label,items,expected)=>{
    const result=await attempt(items);
    expect(result.status).toBe(201);
    expect(result.actual).toBe(expected);
    expect(result.announced).toBe(expected);
  });
});
