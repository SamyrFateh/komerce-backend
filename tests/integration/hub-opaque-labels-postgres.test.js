'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration hub-opaque-labels-postgres.test.js
 * @brief Vérifie les contraintes réelles PostgreSQL de la migration 427 sans muter les données.
 */
const db=require('../../db');
const describeDb=process.env.DATABASE_URL?describe:describe.skip;
jest.setTimeout(60000);

describeDb('hub_scan_labels — contraintes SQL PostgreSQL réelles',()=>{
  beforeAll(()=>{
    const hostname=new URL(process.env.DATABASE_URL).hostname;
    if(!['localhost','127.0.0.1','::1'].includes(hostname))
      throw new Error('HUB_LABELS_TEST_LOCAL_POSTGRES_ONLY');
  });
  afterAll(async()=>{await db.pool.end().catch(()=>{});});
  test('politique QR COMBOX : requête paramétrée exécutable sur PostgreSQL réel',async()=>{
    const labels=require('../../services/hub-opaque-labels');
    const {rows:[{id}]}=await db.query('SELECT gen_random_uuid() AS id');
    await expect(labels.boxRequiresOpaqueQr(db,id)).resolves.toBe(false);
  });
  test('tables créées et colonnes sensibles absentes du ticket',async()=>{
    const {rows}=await db.query(`SELECT
      to_regclass('public.hub_scan_labels')::text AS labels,
      to_regclass('public.hub_scan_label_box_scans')::text AS uses`);
    expect(rows[0]).toEqual({labels:'hub_scan_labels',uses:'hub_scan_label_box_scans'});
    const fields=await db.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='hub_scan_labels'
      ORDER BY column_name`);
    const names=fields.rows.map(r=>r.column_name);
    for(const required of ['qr_value','short_alias','market_id','relais_id','allocation_id','unit_number','physical_unit_id'])
      expect(names).toContain(required);
    for(const forbidden of ['client_name','client_phone','pickup_code','order_reference','price'])
      expect(names).not.toContain(forbidden);
  });
  test('uniques token, alias, article-numéro et COMBOX, anti-double-scan',async()=>{
    const {rows}=await db.query(`
      SELECT indexname,indexdef FROM pg_indexes
      WHERE schemaname='public' AND tablename IN ('hub_scan_labels','hub_scan_label_box_scans')`);
    const defs=rows.map(r=>r.indexdef).join('\n');
    for(const index of ['uq_hub_label_article','uq_hub_label_combox'])
      expect(rows.map(r=>r.indexname)).toContain(index);
    expect(defs).toContain('hub_scan_labels');
    const pk=await db.query(`
      SELECT c.conname FROM pg_constraint c
      WHERE c.conrelid='public.hub_scan_label_box_scans'::regclass AND c.contype='p'`);
    expect(pk.rows).toHaveLength(1);
  });
});
