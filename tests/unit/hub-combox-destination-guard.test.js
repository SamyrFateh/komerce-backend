'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const {checkBoxDestination}=require('../../services/hub-combox-destination-guard');
const allocation={market_id:'KM',destination_ref:'relais:A'};
const check=async(rows,incoming=allocation)=>{
  const db={query:jest.fn(async()=>({rows}))};
  const result=await checkBoxDestination(db,'box-1',incoming);
  expect(db.query).toHaveBeenCalledTimes(1);
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('p.removed_at IS NULL'),['box-1']);
  return result;
};
test('COMBOX empty or same relay is accepted even across distinct orders',async()=>{
  expect(await check([])).toBeNull();
  expect(await check([{...allocation,order_id:'one'},{...allocation,order_id:'two'}])).toBeNull();
});
test('market mismatch takes precedence over relay mismatch',async()=>{
  expect(await check([{market_id:'CM',destination_ref:'relais:B'}])).toEqual({code:'HUB_BOX_MARKET_MISMATCH'});
});
test('different or unknown relay fails closed',async()=>{
  for(const rows of [[{market_id:'KM',destination_ref:'relais:B'}],[{market_id:'KM',destination_ref:null}]]){
    expect(await check(rows)).toMatchObject({code:'HUB_BOX_RELAY_MISMATCH'});
  }
  expect(await check([],{market_id:'KM',destination_ref:null})).toMatchObject({code:'HUB_BOX_RELAY_MISMATCH'});
});
