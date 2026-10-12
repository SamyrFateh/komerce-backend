'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../helpers/e2eDbKit', () => ({ assertTestDatabase: jest.fn(), uuid: jest.fn().mockReturnValue('22222222-2222-4222-8222-222222222222') }));
const { assertTestDatabase } = require('../helpers/e2eDbKit');
const { createGoldenJourney } = require('../helpers/goldenJourneySetup');
test('persistent Golden setup is test-only and stops before Hub', async () => {
  const sql=[];
  const db={query:jest.fn(async query=>{sql.push(query); if (/SELECT id FROM markets/.test(query)) return {rows:[{id:'market-km'}]}; return {rows:[]};})};
  const result=await createGoldenJourney(db,{marketCode:'KM'});
  expect(assertTestDatabase).toHaveBeenCalledTimes(1);
  expect(result.reference).toMatch(/^K-GOLDEN-/);
  expect(sql[1]).toBe('BEGIN');
  expect(sql[sql.length-1]).toBe('COMMIT');
  expect(sql.join('\n')).toContain('supplier_execution_fulfillments');
  expect(sql.join('\n')).not.toContain('hub_purchase_allocations');
});
