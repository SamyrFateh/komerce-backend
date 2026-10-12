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
  test.each(['KM','CM','CG'])('%s : create puis avance une frontière à la fois jusqu à la clôture reconciliée',async(marketCode)=>{
    const created=await createGoldenJourney(db,{marketCode});
    cleanup.trackSql(`UPDATE orders SET status='cancelled', updated_at=NOW() WHERE id=$1`,[created.orderId]);
    let state=await inspectGoldenJourney(db,created.reference);
    expect(state.next).toMatchObject({key:'HUB_INBOUND'});
    const expected=['CUSTOMS','RELAY_AVAILABLE','CUSTOMER_HANDOFF'];
    for(const key of expected){
      state=await advanceGoldenJourney(db,created.reference);
      expect(state.next).toMatchObject({key});
    }
    state=await advanceGoldenJourney(db,created.reference);
    expect(state.complete).toBe(true);
    expect(state.next).toBeNull();
    expect(state.projection.verdict).toBe('FINANCIAL_CLOSE_MATCHED');
    const before=await inspectGoldenJourney(db,created.reference);
    state=await advanceGoldenJourney(db,created.reference);
    expect(state.complete).toBe(true);
    expect(state.next).toBeNull();
    expect(state.projection.steps).toEqual(before.projection.steps);
    expect(state.projection.verdict).toBe(before.projection.verdict);
  });
});
