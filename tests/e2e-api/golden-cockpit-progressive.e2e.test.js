'use strict';
/**
 * @test-kind e2e-api
 * @test-runner jest
 * @test-requires postgres
 */
const db=require('../../db');
const { describeE2E, createCleanup }=require('../helpers/e2eDbKit');
const { createGoldenJourney }=require('../helpers/goldenJourneySetup');
const { inspectGoldenJourney, advanceGoldenJourney }=require('../helpers/goldenJourney');

describeE2E('Golden cockpit progressive full loop',()=>{
  const cleanup=createCleanup(db);
  afterAll(async()=>cleanup.run());
  test('create puis avance une frontière à la fois jusqu à la clôture reconciliée',async()=>{
    const created=await createGoldenJourney(db,{marketCode:'KM'});
    cleanup.track('orders',created.orderId);
    let state=await inspectGoldenJourney(db,created.reference);
    expect(state.next).toMatchObject({key:'HUB_INBOUND'});
    const expected=['CUSTOMS','RELAY_AVAILABLE','CUSTOMER_HANDOFF','FINANCIAL_CLOSE'];
    for(const key of expected){
      state=await advanceGoldenJourney(db,created.reference);
      expect(state.next).toMatchObject({key});
    }
    const before=await inspectGoldenJourney(db,created.reference);
    state=await advanceGoldenJourney(db,created.reference);
    expect(state.next).toMatchObject({key:'FINANCIAL_CLOSE'});
    expect(state.projection).toEqual(before.projection);
  });
});
