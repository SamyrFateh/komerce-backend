'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { reserveRct1OrderReference, expectedProductTotalKmf, isAllowedRct1Reference } = require('../../services/rct1-checkout-reference-guard');
describe('RCT1 checkout transactional reference protection', () => {
  test.each(['RCT1-E1','RCT1-G','RCT1-F','RCT1-C','RCT1-C2'])('allows first canonical creation of %s', async reference => {
    const statements=[];
    const client={query:jest.fn(async(sql,params)=>{
      statements.push({sql,params});
      return {rows:[]};
    })};
    await expect(reserveRct1OrderReference(client,reference)).resolves.toEqual({already:false});
    expect(statements).toHaveLength(2);
    expect(statements[0].sql).toContain('pg_advisory_xact_lock');
    expect(statements[1].sql).toContain('FROM orders WHERE reference=$1');
    expect(statements[0].params).toEqual([reference]);
  });
  test('replay detects scoped preexisting order and makes zero writes', async () => {
    const client={query:jest.fn().mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[
      {id:'existing',reference:'RCT1-E1',simulation_scope:'RCT1'}
    ]})};
    await expect(reserveRct1OrderReference(client,'RCT1-E1')).resolves.toMatchObject({already:true});
    expect(client.query).toHaveBeenCalledTimes(2);
  });
  test('reference collision with real order is not accepted as replay', async () => {
    const client={query:jest.fn().mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[
      {id:'actual',reference:'RCT1-G',simulation_scope:null}
    ]})};
    await expect(reserveRct1OrderReference(client,'RCT1-G')).rejects.toThrow('RCT1_REFERENCE_COLLIDES_WITH_REAL_ORDER');
  });
  test('totaux produit attendus independants', () => {
    expect([expectedProductTotalKmf('RCT1-E1'), expectedProductTotalKmf('RCT1-G'), expectedProductTotalKmf('RCT1-X')]).toEqual([15000, 6000, null]);
    expect(isAllowedRct1Reference('RCT1-F')).toBe(true);
    expect(isAllowedRct1Reference('RCT1-E2')).toBe(false);
  });
  test('I3 : 2 lignes IMPORT, total produit 40 000 attendu independamment', () => {
    expect(expectedProductTotalKmf('RCT1-I3')).toBe(40000);
    expect(isAllowedRct1Reference('RCT1-I3')).toBe(true);
  });
  test('arbitrage P3 : le total attendu de G suit RCT1_P3_PRICE_KMF (defaut 6 000)', () => {
    jest.resetModules();
    process.env.RCT1_P3_PRICE_KMF = '7000';
    expect(require('../../services/rct1-checkout-reference-guard').expectedProductTotalKmf('RCT1-G')).toBe(7000);
    delete process.env.RCT1_P3_PRICE_KMF;
    jest.resetModules();
    expect(require('../../services/rct1-checkout-reference-guard').expectedProductTotalKmf('RCT1-G')).toBe(6000);
  });
  test('non RCT1 references cannot obtain a reservation', async () => {
    const client={query:jest.fn()};
    await expect(reserveRct1OrderReference(client,'RCT1-E2')).rejects.toThrow('RCT1_REFERENCE_NOT_ALLOWED');
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe('RCT1 reference CM (J/K)', () => {
  test('RCT1-CM1 autorisee, total produit attendu 15 000 KMF (20 000 XAF)', () => {
    expect(isAllowedRct1Reference('RCT1-CM1')).toBe(true);
    expect(expectedProductTotalKmf('RCT1-CM1')).toBe(15000);
    expect(isAllowedRct1Reference('RCT1-CG1')).toBe(false);
  });
});
