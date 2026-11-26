'use strict';
/** @test-kind integration @test-runner jest @test-requires postgres
 * ECO disposable database proof. Committed immutable fixtures are necessary for
 * real HTTP requests on separate connections. Run ONLY on dedicated CI postgres
 * container with explicit opt-in; no trigger disable, reset, or shared database.
 */
const request=require('supertest');
const {createMarketDelegationFixture,makeApp}=require('../helpers/marketDelegationE2EKit');
const {reviseBudget}=require('../../services/economic-cost-budget-service');
const crypto=require('crypto');
const {recordStructureCostEvent}=require('../../services/pricing-period-structure');
const url=process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const enabled=process.env.ECO_DISPOSABLE_PG_PROOF==='1';
const run=enabled?describe:describe.skip;
jest.setTimeout(60000);
run('ECO-1f canonical read API on disposable PostgreSQL',()=>{
  const db=require('../../db');
  const tag='ECOAPI'+crypto.randomBytes(5).toString('hex').toUpperCase();
  let fx,app,a,b,g;
  const month='2026-01-01', mount='/api/admin/workspaces/pricing';
  const q=(sql,params)=>db.query(sql,params);
  async function seed(marketId,suffix){
    const center=(await q('INSERT INTO economic_cost_centers(market_id,code,label) VALUES ($1,$2,$2) RETURNING id',[marketId,tag+suffix])).rows[0].id;
    const family=(await q("INSERT INTO economic_cost_families(center_id,code,label) VALUES ($1,'PERSONNEL','Personnel') RETURNING id",[center])).rows[0].id;
    const resource=(await q("INSERT INTO economic_cost_resources(center_id,code,label,resource_kind) VALUES ($1,'EQUIPE','Equipe','PERSONNEL') RETURNING id",[center])).rows[0].id;
    const post=(await q("INSERT INTO economic_cost_posts(center_id,family_id,resource_id,code,label,economic_nature,allocation_perimeter,allocation_basis) VALUES ($1,$2,$3,'SALAIRES','Salaires','FIXED','DIRECT','PERIOD') RETURNING id",[center,family,resource])).rows[0].id;
    return {center,post};
  }
  const endpoint=code=>mount+(code?'/market/'+code:'')+'/cost-centers';
  const get=(actor,code,period=month)=>request(app).get(endpoint(code)).query({periodStart:period}).set('Authorization',actor.token);
  beforeAll(async()=>{
    if(process.env.GITHUB_ACTIONS!=='true'||!url||url.hostname!=='localhost'||url.pathname!=='/komerce_test'||process.env.NODE_ENV!=='test')
      throw new Error('Refusing committed ECO fixtures outside disposable CI postgres');
    const pin=(await q('SELECT current_database() AS name')).rows[0].name;
    if(pin!=='komerce_test')throw new Error('Unexpected database');
    fx=await createMarketDelegationFixture(db);
    await q("INSERT INTO pricing_global_access_grants(user_id,reason) VALUES ($1,'ECO isolated CI') ON CONFLICT DO NOTHING",[fx.central.id]);
    app=makeApp([{mount,modulePath:'../../routes/admin-pricing-workspace'}]);
    a=await seed(fx.marketA.id,'A'); b=await seed(fx.marketB.id,'B'); g=await seed(null,'G');
    const input={postId:a.post,marketCode:fx.marketA.code,periodStart:month,expectedRevision:0,currency:'XAF',amountNative:'655957',reason:'Budget test',requestKey:tag+'B1'};
    await reviseBudget(fx.central,input);
    const latest=await reviseBudget(fx.central,{...input,amountNative:'327979',expectedRevision:1,requestKey:tag+'B2'});
    expect(latest.revision.revision).toBe(2);
    await expect(reviseBudget(fx.central,{...input,amountNative:'327979',expectedRevision:1,requestKey:tag+'B2'})).resolves.toMatchObject({outcome:'replayed'});
    const k=(await q("INSERT INTO economic_cost_commitments(post_id,period_start,currency,amount_native,amount_eur,fx_legs,fx_as_of,evidence_ref,request_key,recorded_by) VALUES ($1,$2,'EUR',100,100,'[]',now(),'CI contract',$3,$4) RETURNING id",[a.post,month,tag+'K1',fx.central.id])).rows[0].id;
    await q("INSERT INTO economic_cost_commitment_movements(commitment_id,kind,amount_native,evidence_ref,request_key,recorded_by) VALUES ($1,'RELEASE',30,'CI release',$2,$3)",[k,tag+'M1',fx.central.id]);
    const charge=(await q("INSERT INTO charges(family,name,amount_kmf,is_recurring,recurrence_period,market_owner_id) VALUES ('operationnelle',$1,0,true,'monthly',$2) RETURNING id",[tag,fx.marketA.id])).rows[0].id;
    await q('UPDATE economic_cost_posts SET structure_charge_id=$1 WHERE id=$2',[charge,a.post]);
    const event={charge_id:charge,scope_kind:'MARKET_DIRECT',market_id:fx.marketA.id,event_kind:'ACCRUAL',economic_from:'2026-01-01T00:00:00Z',economic_to:'2026-02-01T00:00:00Z',amount_original:1000,currency:'KMF',fx_rate_to_kmf:1,fx_source:'CI fixture',amount_kmf:1000,source_kind:'MANUAL',evidence_ref:'CI canonical structure'};
    await recordStructureCostEvent(event,fx.central.id);
    await recordStructureCostEvent({...event,economic_to:'2026-03-01T00:00:00Z',amount_original:2000,amount_kmf:2000},fx.central.id);

  });
  test('central sees exact market, latest budget and remaining commitment; no fake actual',async()=>{
    const response=await get(fx.central,fx.marketA.code);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.body.centers.map(c=>c.id)).toContain(a.center);
    expect(response.body.centers.map(c=>c.id)).not.toContain(b.center);
    expect(response.body.centers.map(c=>c.id)).not.toContain(g.center);
    const p=response.body.posts.find(p=>p.id===a.post);
    expect(p.budget).toMatchObject({revision:2,currency:'XAF',native:'327979.0000'});
    const actual=(await q('SELECT amount_eur::text AS eur FROM economic_cost_budget_revisions WHERE post_id=$1 AND revision=2',[a.post])).rows[0].eur;
    expect(p.budget.eur).toBe(actual);
    expect(p.commitments[0].remaining_native).toBe('70.0000');
    expect(p.commitments[0].remaining_eur).toBe('70.00');
    expect(response.body.commitmentSummary).toMatchObject({totalEur:'70.00',valuation:'FROZEN_OPENING_EUR'});
    expect(response.body.centers.find(c=>c.id===a.center).commitmentSummary.totalEur).toBe('70.00');
    expect(response.body.budgetSummary.totalEur).toBe(actual);
    expect(p.structureEvidence).toMatchObject({amountKmf:'1000.00',included:1,crossPeriod:1});
    expect(response.body.structureEvidence).toMatchObject({amountKmf:'1000.00',amountEur:'2.03',fxStatus:'GOVERNED_FIXED_PARITY_PROJECTION',included:1,crossPeriod:1});
    expect(response.body.structureEvidence.fxLegs[0]).toMatchObject({pair:'EUR/KMF',source:'currency_parities'});
    expect(response.body.centers.find(c=>c.id===a.center).structureEvidence.amountEur).toBe('2.03');
    expect(p.actual).toBeNull();expect(p.available).toBeNull();
  });
  test('market reader can read own scope only; group and foreign market refused',async()=>{
    expect((await get(fx.viewerA,fx.marketA.code)).status).toBe(200);
    expect((await get(fx.viewerA,fx.marketB.code)).status).toBe(403);
    expect((await get(fx.viewerA,null)).status).toBe(403);
    expect((await get(fx.outsider,fx.marketA.code)).status).toBe(403);
  });
  test('central group excludes both local markets and period with no budget stays null',async()=>{
    const result=await get(fx.central,null);expect(result.status).toBe(200);
    expect(result.body.centers.map(c=>c.id)).toContain(g.center);
    expect(result.body.centers.map(c=>c.id)).not.toContain(a.center);
    expect(result.body.structureEvidence.amountKmf).toBeNull();
    const next=await get(fx.central,fx.marketA.code,'2026-02-01');
    expect(next.status).toBe(200);
    expect(next.body.posts.find(p=>p.id===a.post)).toMatchObject({budget:null,commitments:[],actual:null});
  });
  test('browser authority injection and invalid period rejected',async()=>{
    expect((await request(app).get(endpoint(fx.marketA.code)).query({periodStart:month,market_id:fx.marketB.id}).set('Authorization',fx.viewerA.token)).status).toBe(400);
    expect((await get(fx.central,fx.marketA.code,'2026-01-02')).status).toBe(400);
    expect((await request(app).get(endpoint(fx.marketA.code)).query({periodStart:month})).status).toBe(401);
  });
});
