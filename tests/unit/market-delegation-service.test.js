'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const delegation = require('../../services/market-delegation-service');

describe('market-delegation-service — provisioning writers', () => {
  test('exposes delegation-owned writers for central referent and amount limits', () => {
    expect(typeof delegation.setCentralReferent).toBe('function');
    expect(typeof delegation.setCeilingAmountLimits).toBe('function');
  });
});


test('explicit member limits are part of the grant writer contract', () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'market-delegation-service.js'), 'utf8');
  expect(source).toMatch(/capabilityLimits = \{\}/);
  expect(source).toMatch(/membership_capabilities \(membership_id, capability, granted_by, limit_amount\)/);
});

describe('market-delegation-service — setAssignmentStatus (D2)', () => {
  const ID = '11111111-1111-4111-8111-111111111111';
  const fakeDb = () => {
    const calls = [];
    return {
      calls,
      async query(sql, params) {
        calls.push({ sql, params });
        if (/SELECT id, market_id, status/.test(sql)) return { rows: [{ id: ID, market_id: 'm1', status: 'ACTIVE' }] };
        if (/UPDATE market_operating_assignments/.test(sql)) return { rows: [{ id: ID, status: params[1] }] };
        return { rows: [] };
      },
    };
  };

  test('le motif est tracé dans l’audit quand il est fourni', async () => {
    const db = fakeDb();
    await delegation.setAssignmentStatus(db, { assignmentId: ID, status: 'SUSPENDED', reason: 'contrôle interne', actorUserId: 'u1' });
    const audit = db.calls.find(c => /market_delegation_audit/.test(c.sql));
    expect(JSON.stringify(audit.params)).toContain('contrôle interne');
  });

  test('sans motif, l’audit garde le format historique { status }', async () => {
    const db = fakeDb();
    await delegation.setAssignmentStatus(db, { assignmentId: ID, status: 'ACTIVE', actorUserId: 'u1' });
    const audit = db.calls.find(c => /market_delegation_audit/.test(c.sql));
    expect(JSON.stringify(audit.params)).not.toContain('reason');
  });
});

describe('preparation authority #4370', () => {
  function dbFor({ status = 'PROVISIONING', member = true, caps = ['team.read','network.create','execution.cash.confirm','catalog.expose'], ceiling = true } = {}) {
    return { query: jest.fn(async sql => {
      if (sql.includes('LEFT JOIN market_operating_assignments')) return { rows: [{ market_id:'m1', market_code:'GA', assignment_id:'a1', lifecycle_status:status }] };
      if (sql.includes('FROM assignment_memberships')) return { rows: member ? [{ id:'mem1', user_id:'u1' }] : [] };
      if (sql.includes('FROM membership_capabilities')) return { rows: caps.map(capability => ({capability})) };
      if (sql.includes('FROM assignment_capability_ceiling')) return { rows: ceiling ? [{effect:'ACT'}] : [] };
      return { rows:[] };
    }) };
  }
  test('allows scoped network preparation with active ceiling', async () => {
    await expect(delegation.resolveAuthorization(dbFor(),{userId:'u1',marketCode:'GA',requiredCapability:'network.create'}))
      .resolves.toMatchObject({market_id:'m1',membership_id:'mem1'});
  });
  test.each(['execution.cash.confirm','catalog.expose','pricing.activate','finance.act','hub.supervise','operations.read',null])('denies non-preparation authority: %s', async requiredCapability => {
    await expect(delegation.resolveAuthorization(dbFor(),{userId:'u1',marketCode:'GA',requiredCapability}))
      .rejects.toMatchObject({code:'MARKET_NOT_FOUND'});
  });
  test('explicit UI projection strips commercial capabilities', async () => {
    await expect(delegation.resolveAuthorization(dbFor(),{userId:'u1',marketCode:'GA',requiredCapability:null,allowProvisioningProjection:true}))
      .resolves.toMatchObject({capabilities:['team.read','network.create']});
  });
  test('requires membership and ceiling', async () => {
    await expect(delegation.resolveAuthorization(dbFor({member:false}),{userId:'u1',marketCode:'GA',requiredCapability:'network.create'}))
      .rejects.toMatchObject({code:'MARKET_MEMBERSHIP_REQUIRED'});
    await expect(delegation.resolveAuthorization(dbFor({ceiling:false}),{userId:'u1',marketCode:'GA',requiredCapability:'network.create'}))
      .rejects.toMatchObject({code:'MARKET_CAPABILITY_OUTSIDE_CEILING'});
  });
  test('suspension still denies mutation', async () => {
    await expect(delegation.resolveAuthorization(dbFor({status:'SUSPENDED'}),{userId:'u1',marketCode:'GA',requiredCapability:'network.create'}))
      .rejects.toMatchObject({code:'MARKET_SUSPENDED'});
  });
});

test('central default lookup preserves the historical SQL contract and denies provisioning by default', async () => {
  const db = {query:jest.fn().mockResolvedValue({rows:[{assignment_id:'a1',lifecycle_status:'PROVISIONING'}]})};
  await expect(delegation.resolveActiveAssignmentByMarketCode(db,'GA')).rejects.toMatchObject({code:'MARKET_NOT_FOUND'});
  expect(db.query.mock.calls[0][1]).toEqual(['GA']);
  expect(db.query.mock.calls[0][0]).toContain("m.lifecycle_status IN ('ACTIVE','SUSPENDED')");
  await expect(delegation.resolveActiveAssignmentByMarketCode(db,'GA',{allowProvisioning:true})).resolves.toMatchObject({assignment_id:'a1'});
  expect(db.query.mock.calls[1][1]).toEqual(['GA']);
  expect(db.query.mock.calls[1][0]).toContain("m.lifecycle_status IN ('ACTIVE','SUSPENDED','PROVISIONING')");
  await expect(delegation.resolveActiveAssignmentByMarketCode(db,'GA',{allowProvisioning:'true'})).rejects.toMatchObject({code:'MARKET_NOT_FOUND'});
});

test('pre-opening pricing requires an explicit route opt-in and never permits activation',async()=>{
  function fakeDb(){return {query:jest.fn(async sql=>{
    if(sql.includes('LEFT JOIN market_operating_assignments'))return {rows:[{market_id:'m1',market_code:'GA',assignment_id:'a1',lifecycle_status:'PROVISIONING'}]};
    if(sql.includes('FROM assignment_memberships'))return {rows:[{id:'mem',user_id:'u1'}]};
    if(sql.includes('FROM membership_capabilities'))return {rows:['pricing.read','pricing.decide','pricing.activate','catalog.expose','pricing.cost_component.update'].map(capability=>({capability}))};
    if(sql.includes('FROM assignment_capability_ceiling'))return {rows:[{effect:'ACT'}]};
    return {rows:[]};
  })};}
  const base={userId:'u1',marketCode:'GA',requiredCapability:'pricing.decide'};
  await expect(delegation.resolveAuthorization(fakeDb(),base)).rejects.toMatchObject({code:'MARKET_NOT_FOUND'});
  await expect(delegation.resolveAuthorization(fakeDb(),{...base,allowPreparationPricing:true})).resolves.toMatchObject({capabilities:['pricing.read','pricing.decide']});
  for(const requiredCapability of ['pricing.activate','catalog.expose','pricing.cost_component.update']){
    await expect(delegation.resolveAuthorization(fakeDb(),{...base,requiredCapability,allowPreparationPricing:true})).rejects.toMatchObject({code:'MARKET_NOT_FOUND'});
  }
});

test('preparation economic reference capability is opt-in and does not grant finance or exposure',async()=>{
  const db={query:jest.fn(async sql=>{
    if(sql.includes('LEFT JOIN market_operating_assignments'))return {rows:[{market_id:'m1',market_code:'GA',assignment_id:'a1',lifecycle_status:'PROVISIONING'}]};
    if(sql.includes('FROM assignment_memberships'))return {rows:[{id:'mem',user_id:'u1'}]};
    if(sql.includes('FROM membership_capabilities'))return {rows:['pricing.read','pricing.cost_component.update','structure.event.record','finance.act','catalog.expose'].map(capability=>({capability}))};
    if(sql.includes('FROM assignment_capability_ceiling'))return {rows:[{effect:'ACT'}]};
    return {rows:[]};
  })};
  const base={userId:'u1',marketCode:'GA',requiredCapability:'pricing.cost_component.update'};
  await expect(delegation.resolveAuthorization(db,base)).rejects.toMatchObject({code:'MARKET_NOT_FOUND'});
  await expect(delegation.resolveAuthorization(db,{...base,allowPreparationReference:true})).resolves.toMatchObject({capabilities:['pricing.read','pricing.cost_component.update','structure.event.record']});
  await expect(delegation.resolveAuthorization(db,{...base,requiredCapability:'finance.act',allowPreparationReference:true})).rejects.toMatchObject({code:'MARKET_NOT_FOUND'});
});
