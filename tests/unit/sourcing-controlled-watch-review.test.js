'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('node:fs');
const path = require('node:path');
const {
  AUTHORIZE, REVOKE, inputSnapshot, evaluateWatchEligibility,
  authorizedWatchSql,
} = require('../../services/sourcing-controlled-watch-review');
const { recordControlledWatchReview } = require('../../services/sourcing-candidate-actions');

const actorId = '00000000-0000-0000-0000-000000000001';
const candidate = () => ({
  id: '00000000-0000-0000-0000-000000000002',
  candidate_ref: 'KSC-000001',
  state: 'imported_to_catalog',
  product_id: '00000000-0000-0000-0000-000000000003',
  catalog_product_active: false,
  supplier_product_id: 'SOURCE-001',
  scan_at: new Date('2026-11-15T10:00:00.000Z'),
  scan_result: {
    sourcing_decision:'WATCH',economic_test_health_status:'fragile',
    economic_test_margin_pct:20, test_price_kmf:1000,variable_cost_complete_kmf:800,
  },
  purchase_price: '2.00', currency: 'EUR', purchase_price_kmf: '984',
  estimated_weight_kg: '0.500', estimated_volume_m3:'0.00500',
  komerce_category:'electronics', normalized_source_contract:{schema_version:'2'},
  data_sources:{category:'supplier'},
});

describe('sourcing WATCH controlled human review',()=>{
  test('only measured fragile positive WATCH may be authorized',()=>{
    expect(evaluateWatchEligibility(candidate()).eligible).toBe(true);
    for(const patch of [
      {scan_result:{...candidate().scan_result,sourcing_decision:'TEST'}},
      {scan_result:{...candidate().scan_result,economic_test_health_status:'unknown'}},
      {scan_result:{...candidate().scan_result,economic_test_health_status:'loss',economic_test_margin_pct:-8,test_price_kmf:700}},
      {scan_result:{...candidate().scan_result,economic_test_health_status:'danger',economic_test_margin_pct:5}},
      {scan_result:{...candidate().scan_result,fx_gate:{code:'fx_rate_unavailable'}}},
      {scan_result:{...candidate().scan_result,customs_review:{status:'REQUIRED'}}},
      {komerce_category:null}, {data_sources:{category:'default'}},
      {purchase_price_kmf:null}, {normalized_source_contract:null},
      {state:'rejected'}, {state:'quarantined'}, {catalog_product_active:true},
    ]){
      expect(evaluateWatchEligibility({...candidate(),...patch}).eligible).toBe(false);
    }
  });

  test('exact scan, every input and latest revocation are revalidated by SQL',()=>{
    const sql=authorizedWatchSql('candidate');
    expect(sql).toContain("result->>'scan_at'");
    expect(sql).toContain("result->'scan_result'=candidate.scan_result");
    expect(sql).toContain("result->'facts'=jsonb_build_object(");
    expect(sql).toContain('ORDER BY ev.created_at DESC, ev.id DESC LIMIT 1');
    expect(sql).toContain("AUTHORIZE_CONTROLLED_TEST");
    expect(sql).toContain("ev.triggered_by IS NOT NULL");
    expect(()=>authorizedWatchSql('candidate; DROP TABLE')).toThrow();
  });

  test('audit uses a snapshot and does not mutate the engine decision', async()=>{
    const q={query:jest.fn()
      .mockResolvedValueOnce({rows:[candidate()]})
      .mockResolvedValueOnce({rows:[]})};
    const database={withTransaction:jest.fn(async fn=>fn(q))};
    const result=await recordControlledWatchReview('KSC-000001',{
      action:AUTHORIZE,
      reason:'Essai commercial limité, faible quantité et marge validée en contrôle terrain.'
    },actorId,database);
    expect(result).toMatchObject({
      economic_decision:'WATCH',commercial_review:AUTHORIZE,
      catalogue_publication_changed:false,market_price_changed:false,
    });
    expect(database.withTransaction).toHaveBeenCalledTimes(1);
    expect(q.query).toHaveBeenCalledTimes(2);
    const sql=q.query.mock.calls[1][0];
    const evidence=JSON.parse(q.query.mock.calls[1][1][1]);
    expect(sql).toContain("VALUES ($1,'note_added',$2::jsonb,$3,$4)");
    expect(evidence).toMatchObject({
      kind:'CONTROLLED_WATCH_TEST_V1',action:AUTHORIZE,
      scan_at:'2026-11-15T10:00:00.000Z',scan_result:candidate().scan_result,
      facts:inputSnapshot(candidate()),
    });
    expect(q.query.mock.calls[1][1][3]).toBe(actorId);
  });

  test('revoke is append-only; a new scan will invalidate old authorizations',async()=>{
    const q={query:jest.fn().mockResolvedValueOnce({rows:[candidate()]}).mockResolvedValueOnce({rows:[]})};
    const database={withTransaction:async fn=>fn(q)};
    const result=await recordControlledWatchReview('KSC-000001',{
      action:REVOKE,reason:'L’essai est révoqué avant ouverture du marché pour motif commercial documenté.'
    },actorId,database);
    expect(result.commercial_review).toBe(REVOKE);
    expect(JSON.parse(q.query.mock.calls[1][1][1]).action).toBe(REVOKE);
  });

  test('unknown FX and invalid reasons are rejected without writes',async()=>{
    const invalid={...candidate(),scan_result:{...candidate().scan_result,fx_gate:{code:'fx_rate_unavailable'}}};
    const q={query:jest.fn().mockResolvedValueOnce({rows:[invalid]})};
    const database={withTransaction:async fn=>fn(q)};
    await expect(recordControlledWatchReview('KSC-000001',{
      action:AUTHORIZE,reason:'Impossible de justifier ce prix sans une cotation officielle.'
    },actorId,database)).rejects.toMatchObject({status:409,code:'WATCH_NOT_ELIGIBLE_FOR_MANUAL_TEST'});
    expect(q.query).toHaveBeenCalledTimes(1);
    await expect(recordControlledWatchReview('KSC-000001',{action:AUTHORIZE,reason:'court'},actorId,database))
      .rejects.toMatchObject({status:400,code:'WATCH_REASON_REQUIRED'});
    await expect(recordControlledWatchReview('KSC-000001',{action:AUTHORIZE,reason:'Justification suffisamment longue pour un contrôle.'},'bad',database))
      .rejects.toMatchObject({status:403,code:'REVIEWER_ID_REQUIRED'});
  });

  test('canonical UI requires typed motivation and route requires admin',()=>{
    const ui=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/js/sourcing-workspace.js'),'utf8');
    const route=fs.readFileSync(path.join(__dirname,'../../routes/admin-sourcing-workspace.js'),'utf8');
    expect(ui).toContain("data-watch-review-reason");
    expect(ui).toContain("action:'AUTHORIZE_CONTROLLED_TEST'");
    expect(ui).toContain('/commercial-watch-review');
    expect(route).toContain("if (req.user?.role !== 'admin')");
  });
});
