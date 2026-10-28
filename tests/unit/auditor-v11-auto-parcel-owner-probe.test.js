'use strict';
/**
 * Executes real auto-parcel owner with deterministic SQL client responses.
 * No database transaction is performed here; postgres rowCount is simulated.
 * @test-kind unit @test-runner jest @test-requires none
 */
jest.mock('../../utils/logger',()=>({child:()=>({info:jest.fn(),warn:jest.fn(),error:jest.fn(),debug:jest.fn()})}));
jest.mock('../../db',()=>({query:jest.fn(()=>{throw Error('GLOBAL_DB_ACCESS_FORBIDDEN')})}));
const fs=require('node:fs');
const {distributeOrder}=require('../../services/auto-parcel');
function fixture(inserted){
 const calls=[];
 const client={query:jest.fn(async(sql,params=[])=>{
  const q=String(sql);calls.push(q);
  if(q.includes('SELECT o.id, o.reference'))return {rows:[{
   id:'ORDER-V11',reference:'ORDER-V11',status:'ordered',
   relais_id:'RELAY-V11',relais_island:'Anjouan',total_kmf:1200
  }]};
  if(q.includes('SELECT pi.id FROM parcel_items'))return {rows:[]};
  if(q.includes('SELECT id, quantity, product_id FROM order_items'))return {rows:[
   {id:'ITEM-V11',quantity:1,product_id:'PRODUCT-V11'}]};
  if(q.includes('SELECT p.id, p.reference')&&q.includes('LATERAL'))
   return {rows:[{id:'PARCEL-V11',reference:'PARCEL-V11',item_count:0,order_count:0}]};
  if(q.includes('INSERT INTO parcel_items')&&q.includes('ON CONFLICT DO NOTHING')){
   return {rows:inserted?[{id:'MEMBER-V11'}]:[],rowCount:inserted?1:0};
  }
  throw Error('UNEXPECTED_SQL_IN_AUTO_PARCEL_TEST');
 })};
 return {client,calls};
}
test('V11 actual auto-parcel owner nominal insert vs ignored-conflict counterexample',async()=>{
 const first=fixture(true),second=fixture(false);
 const nominal=await distributeOrder('ORDER-V11',first.client);
 const adversarial=await distributeOrder('ORDER-V11',second.client);
 expect(nominal.success).toBe(true);
 expect(adversarial.success).toBe(true);
 expect(first.calls.filter(s=>s.includes('INSERT INTO parcel_items')).length).toBe(1);
 expect(second.calls.filter(s=>s.includes('INSERT INTO parcel_items')).length).toBe(1);
 expect(nominal.items_assigned).toBe(1);
 expect(Number.isInteger(adversarial.items_assigned)).toBe(true);
 const observation={
  contract:'komerce-v11-parcel-count-observation/v1',
  scope:'ACTUAL_LOGISTICS_OWNER_MOCKED_SQL_ROWCOUNT',
  oracle:'ASSIGNED_ITEMS_MUST_EQUAL_SUCCESSFUL_MEMBERSHIP_INSERTS',
  nominalSqlRowCount:1,nominalReported:nominal.items_assigned,
  adversarialSqlRowCount:0,adversarialReported:adversarial.items_assigned,
  sameItemAndParcel:true,sqlConflictIgnored:true,
  nominalControlPassed:nominal.items_assigned===1,
  conflictReportedAccurately:adversarial.items_assigned===0,
  dbQueriesToRealDb:0,physicalSqlConflictReproduced:false,
  productionIncidentProven:false
 };
 if(process.env.KOMERCE_V11_OBSERVATION_PATH){
  const exact='/tmp/komerce-independent-business-audit/v11-parcel-observation.json';
  expect(process.env.KOMERCE_V11_OBSERVATION_PATH).toBe(exact);
  fs.writeFileSync(exact,JSON.stringify(observation,null,2)+'\n');
 }
});
