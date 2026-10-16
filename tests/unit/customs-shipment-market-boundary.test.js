'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../services/cost-allocation', () => ({allocateShipmentRealCosts: jest.fn()}));
jest.mock('../../services/documents/customs-invoice', () => ({issueForShipment:jest.fn()}));
const {assertShipmentParcelMarket} = require('../../services/customs-shipment-service');
const id1='11111111-1111-4111-8111-111111111111';
const id2='22222222-2222-4222-8222-222222222222';
function client(shipmentMarket, parcels) {
  return {query:jest.fn(async (sql) => {
    if(sql.includes('FROM customs_shipments')) return {rows:[{market_id:shipmentMarket}]};
    if(sql.includes('FROM parcels p')) return {rows:parcels};
    throw new Error('Unexpected SQL');
  })};
}
test('accepts complete, same-market parcel set',async()=>{
  const q=client('KM',[{id:id1,market_id:'KM'},{id:id2,market_id:'KM'}]);
  await expect(assertShipmentParcelMarket(q,'shipment',[id1,id2])).resolves.toBeUndefined();
  expect(q.query.mock.calls[1][0]).toContain('FOR UPDATE OF p');
});
test('rejects foreign-market parcel',async()=>{
  const q=client('KM',[{id:id1,market_id:'KM'},{id:id2,market_id:'CM'}]);
  await expect(assertShipmentParcelMarket(q,'shipment',[id1,id2])).rejects.toMatchObject({
    code:'CUSTOMS_PARCEL_MARKET_MISMATCH'
  });
});
test('rejects missing parcel, duplicate refs, and shipment without market',async()=>{
  await expect(assertShipmentParcelMarket(client('KM',[{id:id1,market_id:'KM'}]),'s',[id1,id2]))
    .rejects.toMatchObject({code:'CUSTOMS_PARCEL_MARKET_MISMATCH'});
  await expect(assertShipmentParcelMarket(client('KM',[]),'s',[id1,id1]))
    .rejects.toMatchObject({code:'CUSTOMS_DUPLICATE_PARCEL'});
  await expect(assertShipmentParcelMarket(client(null,[]),'s',[id1]))
    .rejects.toMatchObject({code:'CUSTOMS_SHIPMENT_MARKET_REQUIRED'});
});
