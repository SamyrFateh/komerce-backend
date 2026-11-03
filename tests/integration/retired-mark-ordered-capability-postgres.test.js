'use strict';
/** @test-kind integration
 * @test-requires postgres
 * L1 residual: final absence in registry, ceilings, memberships and templates.
 */
const describePg=process.env.DATABASE_URL ? describe : describe.skip;
describePg('P0-5 — capability mark-ordered retirée en PG16 (migration 380)',()=>{
  const db=require('../../db');
  afterAll(async()=>{if(db.pool?.end) await db.pool.end();});

  test('aucun droit persistant dans le registre, plafonds ou adhésions', async()=>{
    const {rows}=await db.query(`
      SELECT 'registry' AS source, COUNT(*)::int AS n FROM capability_registry WHERE capability='execution.order.mark_ordered'
      UNION ALL SELECT 'member', COUNT(*)::int FROM membership_capabilities WHERE capability='execution.order.mark_ordered'
      UNION ALL SELECT 'ceiling', COUNT(*)::int FROM assignment_capability_ceiling WHERE capability='execution.order.mark_ordered'
      UNION ALL SELECT 'template', COUNT(*)::int FROM ceiling_template_capabilities WHERE capability='execution.order.mark_ordered'`);
    expect(rows).toHaveLength(4);
    expect(rows.every(r=>r.n===0)).toBe(true);
  });

  test('référence historique d'audit préservée par snapshot sans autoriser un ancien droit',async()=>{
    const {rows:[c]}=await db.query(`
      SELECT
        EXISTS(SELECT 1 FROM information_schema.columns
          WHERE table_name='market_delegation_audit' AND column_name='retired_capability') AS snapshot,
        EXISTS(SELECT 1 FROM pg_constraint
          WHERE conname='market_delegation_audit_capability_fkey' AND confdeltype='n') AS fk_null_on_retire`);
    expect(c.snapshot).toBe(true);
    expect(c.fk_null_on_retire).toBe(true);
  });
});
