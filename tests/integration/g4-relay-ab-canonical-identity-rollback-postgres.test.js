'use strict';
/** @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration g4-relay-ab-canonical-identity-rollback-postgres.test.js
 * @brief Deux comptes et deux relais par writers canoniques, transactions rollback sur PG16 jetable seulement.
 */
const {randomBytes}=require('node:crypto');
const {
  assertDisposable,fixtureNames,prove,DB,
}=require('../../scripts/recette/g4-relay-ab-canonical-rollback');

const isolated=process.env.GITHUB_ACTIONS==='true' &&
  process.env.NODE_ENV==='test' &&
  process.env.KOMERCE_DISABLE_CRONS==='true' &&
  process.env.DATABASE_URL===DB &&
  process.env.KOMERCE_ENV!=='staging' &&
  process.env.KOMERCE_TARGET_ENV!=='staging' &&
  process.env.KOMERCE_ENV!=='production' &&
  process.env.KOMERCE_TARGET_ENV!=='production';

const describeDb=isolated?describe:describe.skip;
describeDb('G4 A/B: canonical identities proven and rolled back on disposable PostgreSQL 16',()=>{
  const db=require('../../db');
  const relayWriter=require('../../services/relais-mutation-service');
  const canonicalMembership=require('../../scripts/recette/staging-e2e-provision').ensureRelayAgentMembership;
  const RUN=()=>randomBytes(4).toString('hex').toUpperCase();
  jest.setTimeout(60000);
  afterAll(async()=>db.pool.end());
  async function counts(run8){
    const names=fixtureNames(run8);
    const {rows:[r]}=await db.query(
      'SELECT (SELECT COUNT(*)::int FROM users WHERE lower(email)=ANY($1::text[])) AS users,'+
      ' (SELECT COUNT(*)::int FROM relais WHERE name=ANY($2::text[])) AS relais',
      [names.map(x=>x.email),names.map(x=>x.relaisName)]
    );
    return [r.users,r.relais];
  }

  test('two genuinely distinct relay agents via canonical writers, both E2E, 0 durable rows',async()=>{
    const run8=RUN();
    expect(await counts(run8)).toEqual([0,0]);
    const out=await prove({db,run8});
    expect(out).toMatchObject({
      schema:'g4-canonical-relay-ab-rollback/1',
      run8,mode:'EPHEMERAL_ONLY_ROLLBACK',
      dedicated_agents:2,distinct_relais:2,market:'KM',
      role:'agent_relais',e2e_markers:2,
      post_rollback:{agents:0,relais:0,memberships:0,markers:0},
      membership:'EPHEMERAL_KM_ONLY_PROVEN',
      granted_capabilities:['execution.parcel.collect','execution.parcel.receive'],
      order_fixtures:'NOT_CREATED',
      chromium:'NOT_RUN',staging:'NOT_MODIFIED',
      certification:'NOT_PROVEN',committed:false,
    });
    expect(out.per_actor_readback.map(a=>a.label)).toEqual(['A','B']);
    expect(out.per_actor_readback.every(a=>a.active_relais && a.e2e_marker)).toBe(true);
    expect(JSON.stringify(out)).not.toMatch(/password|@komerce\.test|password_hash|secret/i);
    expect(await counts(run8)).toEqual([0,0]);
  });

  test('failure at second canonical relay writer aborts the entire transaction, including A',async()=>{
    const run8=RUN();
    let calls=0;
    const relayFailure={
      createRelais:async (...args)=>{
        if(++calls===2)throw Error('TEST_FAILURE_BEFORE_CREATING_RELAY_B');
        return relayWriter.createRelais(...args);
      },
    };
    await expect(prove({db,run8,relayWriter:relayFailure}))
      .rejects.toThrow('TEST_FAILURE_BEFORE_CREATING_RELAY_B');
    expect(calls).toBe(2);
    expect(await counts(run8)).toEqual([0,0]);
  });

  test('second membership grant failure rolls back A membership and both accounts',async()=>{
    const run8=RUN();
    let grants=0;
    const writer=async (...args)=>{
      if(++grants===2)throw Error('TEST_DENY_SECOND_RELAY_MEMBERSHIP');
      return canonicalMembership(...args);
    };
    await expect(prove({db,run8,membershipWriter:writer}))
      .rejects.toThrow('TEST_DENY_SECOND_RELAY_MEMBERSHIP');
    expect(grants).toBe(2);
    expect(await counts(run8)).toEqual([0,0]);
    // A third connection must find no lingering marker or delegation by run8.
    const {rows:[r]}=await db.query(
      "SELECT COUNT(*)::int AS n FROM assignment_memberships am "+
      "JOIN users u ON u.id=am.user_id WHERE lower(u.email) LIKE $1",
      ['e2e-g4-ab-'+run8.toLowerCase()+'-%@komerce.test']
    );
    expect(r.n).toBe(0);
  });
});
