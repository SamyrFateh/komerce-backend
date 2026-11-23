/**
 * @komerce-arch
 * @role          unit-relay-short-code
 * @domain        logistics
 * @layer         test
 * @criticality   high
 * @inputs        relay name and mocked executor
 * @outputs       stable market-scoped short code assertions
 * @depends       services/relais-mutation-service.js
 * @db-read       none
 * @db-write      none
 * @db-txn        mock
 * @impact-areas  logistics, market, orders
 * @version       2026-11
 */
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';
const { relayCodeStem, ensureRelaisShortCode } = require('../../services/relais-mutation-service');

describe('relay code comes from the actual relay name', () => {
  test('normalizes accents and removes generic business words', () => {
    expect(relayCodeStem('Relais Komerce Yaoundé Centre')).toBe('YA');
    expect(relayCodeStem('Relais Komerce Brazzaville Centre')).toBe('BR');
    expect(relayCodeStem('Relais Moroni Volo-Volo')).toBe('MO');
  });

  test('assigned once, never recomputed after a rename', async () => {
    const q = jest.fn().mockResolvedValue({ rows: [{ id:'r1', name:'Relais Yaoundé Nouveau',short_code:'YA01' }] });
    expect(await ensureRelaisShortCode({query:q},{marketId:'m1',relaisId:'r1'})).toBe('YA01');
    expect(q).toHaveBeenCalledTimes(1);
  });

  test('tenth relay is numbered YAO10, not refused or renamed', async () => {
    const query = jest.fn(async (sql, params) => {
      if (sql.includes('SELECT id, name, short_code')) return {rows:[{id:'r10',name:'Relais Yaoundé Quartier 10',short_code:null}]};
      if (sql.includes('pg_advisory_xact_lock')) return {rows:[]};
      if (sql.includes('SELECT short_code FROM relais')) return {rows:Array.from({length:9},(_,i)=>({short_code:'YA'+(i+1)}))};
      if (sql.includes('UPDATE relais SET short_code')) return {rows:[{short_code:params[2]}]};
      throw new Error('Unexpected SQL: '+sql);
    });
    expect(await ensureRelaisShortCode({query},{marketId:'m1',relaisId:'r10'})).toBe('YA10');
  });

  test('market-local numeric suffix avoids two same-named relays colliding', async () => {
    const calls = [];
    const query = jest.fn(async (sql,params) => {
      calls.push(sql);
      if(sql.includes('SELECT id, name, short_code'))return {rows:[{id:'r2',name:'Relais Komerce Yaoundé Est',short_code:null}]};
      if(sql.includes('pg_advisory_xact_lock'))return {rows:[]};
      if(sql.includes('SELECT short_code FROM relais'))return {rows:[{short_code:'YA01'}]};
      if(sql.includes('UPDATE relais SET short_code'))return {rows:[{short_code:params[2]}]};
      throw new Error('Unexpected: '+sql);
    });
    expect(await ensureRelaisShortCode({query},{marketId:'m1',relaisId:'r2'})).toBe('YA02');
    expect(calls.some(x=>x.includes('pg_advisory_xact_lock'))).toBe(true);
  });
});
