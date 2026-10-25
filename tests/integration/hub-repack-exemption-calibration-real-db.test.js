'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @purpose calibrated blind governance seam logistics(products) -> sourcing economics
 *
 * Real Hub service, actual PostgreSQL persistence and real Sourcing analysis.
 * Recreates one physical measurement twice from the same isolated seed.
 * Diagnostic assertions intentionally prove the CURRENT defect, not a fix.
 */
const ci = process.env.GITHUB_ACTIONS === 'true'
 && process.env.NODE_ENV === 'test'
 && process.env.KOMERCE_DISABLE_CRONS === 'true'
 && process.env.DATABASE_URL === 'postgresql://komerce:komerce@localhost:5432/komerce_test';
if (!ci) {
  describe.skip('Hub/Catalog repack exemption calibration — disposable PostgreSQL CI only', () => {
    test('skipped',()=>{});
  });
} else {
  const {randomUUID}=require('node:crypto');
  const {Pool}=require('pg');
  let mockClient;
  jest.mock('../../db',()=>({
    query:(...args)=>mockClient.query(...args),
    getClient:async()=>mockClient,
    connect:async()=>mockClient,
  }));
  const {recordVolume}=require('../../services/hub-operations');
  const {analyzeProduct, loadSourcingConfig}=require('../../services/sourcing-analysis');
  const pool=new Pool({connectionString:process.env.DATABASE_URL});
  const productId=randomUUID();
  let conn, cfg;
  beforeAll(async()=>{
    conn=await pool.connect();mockClient=conn;
    await conn.query('BEGIN');
    await conn.query(
      `INSERT INTO products(id,name,price_kmf,cost_kmf,stock,volume_cm3,repack_volume_cm3,repack_exempt)
       VALUES($1,'CI Hub Repack Exemption Calibration',20000,14000,10,30000,NULL,FALSE)`,
      [productId]
    );
    await conn.query('SAVEPOINT valid_measurement_seed');
    cfg=await loadSourcingConfig();
  });
  afterAll(async()=>{
    if(conn){await conn.query('ROLLBACK').catch(()=>{});conn.release();}
    await pool.end();
  });
  async function actual(){
    const {rows:[product]}=await conn.query('SELECT * FROM products WHERE id=$1',[productId]);
    const analysis=analyzeProduct(product,cfg,{});
    return {product,analysis};
  }
  test('NOMINAL: non-exempt product may be repacked; persisted volume drives correct Sourcing density',async()=>{
    await conn.query('ROLLBACK TO SAVEPOINT valid_measurement_seed');
    const response=await recordVolume(productId,'ci-hub-agent',{repack_volume_cm3:10000});
    const {product,analysis}=await actual();
    expect(response.status).toBe(200);
    expect(product.repack_exempt).toBe(false);
    expect(Number(product.repack_volume_cm3)).toBe(10000);
    expect(analysis.sourcing.volume_cm3).toBe(10000);
    expect(analysis.computed.margin_kmf_per_dm3).toBe(600);
    console.log('CALIBRATION_EVIDENCE '+JSON.stringify({
      caseId:'HUB_REPACK_EXEMPTION',mode:'NOMINAL',service:'hub.recordVolume -> sourcing.analyzeProduct',
      db:'POSTGRES_REAL',
      expected:{exempt:false,acceptedRepack:true,effectiveVolumeCm3:10000,densityKmfPerDm3:600},
      observed:{exempt:product.repack_exempt,acceptedRepack:Number(product.repack_volume_cm3)===10000,
        effectiveVolumeCm3:analysis.sourcing.volume_cm3,densityKmfPerDm3:analysis.computed.margin_kmf_per_dm3},
      invariantOK:true
    }));
  });
  test('DEVIATION: exempt product accepts forbidden repack and Sourcing treats it as shipped volume',async()=>{
    await conn.query('ROLLBACK TO SAVEPOINT valid_measurement_seed');
    await conn.query('UPDATE products SET repack_exempt=TRUE WHERE id=$1',[productId]);
    const response=await recordVolume(productId,'ci-hub-agent',{repack_volume_cm3:10000});
    const {product,analysis}=await actual();
    expect(response.status).toBe(200); // Existing behavior, should be guarded
    expect(product.repack_exempt).toBe(true);
    expect(Number(product.repack_volume_cm3)).toBe(10000); // existing fault
    expect(analysis.sourcing.volume_cm3).toBe(10000);      // 3x denser than physically allowed
    expect(analysis.computed.margin_kmf_per_dm3).toBe(600);
    console.log('CALIBRATION_EVIDENCE '+JSON.stringify({
      caseId:'HUB_REPACK_EXEMPTION',mode:'DEVIATION',service:'hub.recordVolume -> sourcing.analyzeProduct',
      db:'POSTGRES_REAL',stimulus:'repack_exempt=TRUE and positive repack_volume_cm3 supplied by hub operator',
      expected:{exempt:true,acceptedRepack:false,effectiveVolumeCm3:30000,densityKmfPerDm3:200},
      observed:{exempt:product.repack_exempt,acceptedRepack:Number(product.repack_volume_cm3)===10000,
        effectiveVolumeCm3:analysis.sourcing.volume_cm3,densityKmfPerDm3:analysis.computed.margin_kmf_per_dm3},
      invariantOK:false
    }));
  });
  test('NEGATIVE CONTROL: exempt product can still record normal physical volume',async()=>{
    await conn.query('ROLLBACK TO SAVEPOINT valid_measurement_seed');
    await conn.query('UPDATE products SET repack_exempt=TRUE WHERE id=$1',[productId]);
    const response=await recordVolume(productId,'ci-hub-agent',{volume_cm3:32000});
    const {product,analysis}=await actual();
    expect(response.status).toBe(200);
    expect(product.repack_exempt).toBe(true);
    expect(product.repack_volume_cm3).toBeNull();
    expect(Number(product.volume_cm3)).toBe(32000);
    expect(analysis.sourcing.volume_cm3).toBe(32000);
  });
}
