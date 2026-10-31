'use strict';
jest.mock('../../db',()=>({getClient:jest.fn(),query:jest.fn()}));
jest.mock('../../services/pricing-period-structure',()=>({
  recordStructureCostEvent:jest.fn(),
}));
const db=require('../../db');
const period=require('../../services/pricing-period-structure');
const service=require('../../services/market-structure-charge-reference');

const market={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',code:'KM'};
const actor='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const valid={reference:{name:'Loyer local',description:'Local dédié aux Comores',
  family:'operationnelle',recurrence_period:'monthly'},
  event:{amount_original:85000,currency:'KMF',fx_rate_to_kmf:1,amount_kmf:85000,
    fx_source:'KMF_FIXED',economic_from:'2026-10-01',economic_to:'2026-11-01',
    source_kind:'CONTRACT',evidence_ref:'contract://km/loyer'}};

let client;
beforeEach(()=>{
  jest.clearAllMocks();
  client={query:jest.fn(async(sql,params)=>{
    if(sql.includes('INSERT INTO charges'))return {rows:[{id:'charge-1',market_owner_id:market.id}]};
    return {rows:[]};
  }),release:jest.fn()};
  db.getClient.mockResolvedValue(client);
  period.recordStructureCostEvent.mockResolvedValue({id:'event-1'});
});

test('create: marché issu de la route, référence à zéro et fait atomique',async()=>{
  const result=await service.createMarketChargeAndFact(market,{
    ...valid,event:{...valid.event,scope_kind:'GROUP',market_id:'another-market'},
  },actor);
  expect(result.fact.id).toBe('event-1');
  const insert=client.query.mock.calls.find(([sql])=>sql.includes('INSERT INTO charges'));
  expect(insert[0]).toContain('VALUES ($1, $2, 0,');
  expect(insert[1][5]).toBe(market.id);
  expect(period.recordStructureCostEvent).toHaveBeenCalledWith(
    expect.objectContaining({charge_id:'charge-1',scope_kind:'MARKET_DIRECT',
      market_id:market.id,event_kind:'ACCRUAL',adjusts_event_id:null}),actor,
    {executor:client});
  expect(client.query.mock.calls.map(([sql])=>sql)).toEqual(expect.arrayContaining(['BEGIN','COMMIT']));
  expect(client.release).toHaveBeenCalledTimes(1);
});

test('create: preuve refusée = rollback, jamais de référence orpheline',async()=>{
  period.recordStructureCostEvent.mockRejectedValue(new Error('evidence_ref is required'));
  await expect(service.createMarketChargeAndFact(market,valid,actor)).rejects.toThrow(/evidence_ref/);
  expect(client.query.mock.calls.map(([sql])=>sql)).toContain('ROLLBACK');
  expect(client.query.mock.calls.map(([sql])=>sql)).not.toContain('COMMIT');
});

test('reference: rejet des données invalides avant toute transaction',async()=>{
  await expect(service.createMarketChargeAndFact(market,{reference:{name:'X'}},actor)).rejects.toThrow(/Nom/);
  expect(db.getClient).not.toHaveBeenCalled();
  expect(()=>service.referenceInput({name:'Loyer',family:'GROUP'})).toThrow(/Famille/);
});

test('description: écriture bornée au seul marché propriétaire',async()=>{
  db.query.mockResolvedValueOnce({rows:[{id:'charge-1',notes:'Loyer dédié'}]});
  const out=await service.updateMarketChargeDescription(market,'charge-1','Loyer dédié');
  expect(out.notes).toBe('Loyer dédié');
  const [sql,params]=db.query.mock.calls[0];
  expect(sql).toContain('market_owner_id=$3');
  expect(params).toEqual(['Loyer dédié','charge-1',market.id]);
  db.query.mockResolvedValueOnce({rows:[]});
  await expect(service.updateMarketChargeDescription(market,'other-charge','X')).rejects.toMatchObject({status:404});
});
