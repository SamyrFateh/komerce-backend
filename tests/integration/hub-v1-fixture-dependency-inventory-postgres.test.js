'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration hub-v1-fixture-dependency-inventory-postgres.test.js
 * @brief Inventaire read-only d'un vrai graphe FK E2E-HUB-V1 sur PG16 jetable.
 */
const crypto=require('crypto');
const db=require('../../db');
const {inspect,exactRefs,buildCleanupInventory}=require('../../scripts/recette/hub-v1-fixture-dependency-inventory');
jest.setTimeout(60000);
const describeDb=process.env.DATABASE_URL?describe:describe.skip;
const id=()=>crypto.randomUUID();
describeDb('Hub V1 fixture cleanup discovery — PostgreSQL 16 isolé',()=>{
  const run='Z'+crypto.randomBytes(4).toString('hex').toUpperCase().slice(0,7);
  const ids={buyer:id(),relais:id(),product:id(),orders:[]};
  const q=(sql,args)=>db.query(sql,args);
  beforeAll(async()=>{
    // Refus AVANT les INSERT/DDL si ce test est lancé par erreur sur Railway.
    require('../../scripts/recette/hub-v1-certification-runner')
      .assertEphemeralTarget(process.env.DATABASE_URL, []);
    const {rows:[market]}=await q("SELECT id FROM markets WHERE code='KM'");
    await q("INSERT INTO users(id,full_name,email,phone,role) VALUES($1,$2,$3,$4,'client')",
      [ids.buyer,'E2E-HUB-V1 '+run,'e2e-hub-v1-'+run.toLowerCase()+'@komerce.test',
        '+2693'+String(Date.now()).slice(-7)]);
    await q("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,$2,'test','+2693000001','test',$3)",
      [ids.relais,'E2E-HUB-V1-'+run+'-RELAIS',market.id]);
    await q("INSERT INTO products(id,name,price_kmf,cost_kmf,volume_cm3,stock,price_aed,inventory_model,product_ref) VALUES($1,$2,10000,3000,1000,0,100,'SKU',$3)",
      [ids.product,'E2E fixture inventory '+run,'E2E-HUB-V1-'+run+'-A']);
    for(const ref of exactRefs(run)){
      const oid=id();ids.orders.push(oid);
      await q("INSERT INTO orders(id,user_id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur,simulation_scope) VALUES($1,$2,$3,$4,$5,'pending','pending','cash_relais',10000,20,'E2E-HUB-V1')",
        [oid,ids.buyer,ids.relais,market.id,ref]);
      await q("INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf,fulfillment_source) VALUES($1,$2,$3,1,10000,'IMPORT')",
        [id(),oid,ids.product]);
    }
  });
  afterAll(async()=>{await db.pool.end().catch(()=>{});});

  test('inventaire complet cohérent sur snapshot PostgreSQL, sans écriture ni DELETE',async()=>{
    const client=await db.getClient();
    let report;
    try{report=await buildCleanupInventory(client,run);}finally{client.release();}
    expect(report.roots).toHaveLength(4);
    expect(report.missing).toEqual([]);
    expect(report.snapshot_sha256).toMatch(/^[a-f0-9]{64}$/);
    const owned=Object.fromEntries(report.owned_roots_outside_fk_graph.map(x=>[x.table,x]));
    expect(owned.users.count).toBe(1);
    expect(owned.relais.count).toBe(1);
    expect(owned.products.count).toBe(1);
    expect(owned.users.ids).toContain(ids.buyer);
    expect(owned.relais.ids).toContain(ids.relais);
    expect(owned.products.ids).toContain(ids.product);
    expect(report.cleanup_strategy.decision).toMatch(/^(HOLD_|RETAIN_)/);
    expect(report.cleanup_certified).toBe(false);
    expect(report.delete_performed).toBe(false);
    expect(report.cleanup_scope_checks).toMatchObject({
      exact_roots:true,no_truncation:true,valid_owned_root_ids:true,
    });
    const stored=(await q("SELECT COUNT(*)::int AS n FROM orders WHERE reference=ANY($1::text[])",[exactRefs(run)])).rows[0].n;
    expect(stored).toBe(4);
  });


  test('PG16 peuplé : preuves append-only protégées, 2 inventaires identiques, aucune suppression',async()=>{
    // DDL et fixture strictement sur PostgreSQL jetable de la CI, jamais sur staging.
    const table='hub_v1_evidence_'+run.toLowerCase();
    const fn=table+'_retain';
    const qname=(n)=>'"'+n+'"';
    await q('CREATE TABLE public.'+qname(table)+
      ' (id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES public.orders(id), proof_code text NOT NULL)');
    try{
      for(let i=0;i<ids.orders.length;i++){
        await q('INSERT INTO public.'+qname(table)+
          ' (id,order_id,proof_code) VALUES($1,$2,$3)',
          [id(),ids.orders[i],'immutable-step-'+String(i+1)]);
      }
      await q('CREATE FUNCTION public.'+qname(fn)+
        "() RETURNS trigger LANGUAGE plpgsql AS $body$ BEGIN RAISE EXCEPTION 'HUB_V1_EPHEMERAL_IMMUTABLE_EVIDENCE'; END; $body$");
      await q('CREATE TRIGGER '+qname(table+'_protect')+' BEFORE DELETE ON public.'+
        qname(table)+' FOR EACH ROW EXECUTE FUNCTION public.'+qname(fn)+'()');

      const c=await db.getClient();
      let before,after;
      try{
        before=await buildCleanupInventory(c,run);
        after=await buildCleanupInventory(c,run);
      }finally{c.release();}
      for(const report of [before,after]){
        expect(report.roots).toHaveLength(4);
        expect(report.discovered_tables).toContainEqual({table,count:4});
        expect(report.dependency_identity_fingerprints).toEqual(expect.arrayContaining([
          expect.objectContaining({table,count:4,ids_sha256:expect.stringMatching(/^[a-f0-9]{64}$/)}),
        ]));
        expect(report.cleanup_strategy.decision).toBe('RETAIN_FIXTURE_PREFIX_NO_DELETE');
        expect(report.cleanup_strategy.immutable_tables).toContain(table);
        expect(report.verdict).toBe('HOLD_IMMUTABLE_PROOFS_RETAINED');
        expect(report.delete_performed).toBe(false);
        expect(report.cleanup_certified).toBe(false);
      }
      expect(after.snapshot_sha256).toBe(before.snapshot_sha256);
      // Le trigger doit réellement interdire de détruire une preuve.
      await expect(q('DELETE FROM public.'+qname(table)+' WHERE order_id=$1',
        [ids.orders[0]])).rejects.toThrow('HUB_V1_EPHEMERAL_IMMUTABLE_EVIDENCE');
      const {rows:[proofCount]}=await q('SELECT COUNT(*)::int AS n FROM public.'+qname(table));
      expect(proofCount.n).toBe(4);
      const {rows:[orders]}=await q('SELECT COUNT(*)::int AS n FROM orders WHERE reference=ANY($1::text[])',
        [exactRefs(run)]);
      expect(orders.n).toBe(4);
      const {rows:[lines]}=await q('SELECT COUNT(*)::int AS n FROM order_items WHERE order_id=ANY($1::uuid[])',
        [ids.orders]);
      expect(lines.n).toBe(4);
    }finally{
      // Cette destruction DDL est permise UNIQUEMENT sur la base jetable du test.
      await q('DROP TABLE IF EXISTS public.'+qname(table));
      await q('DROP FUNCTION IF EXISTS public.'+qname(fn)+'()');
    }
  });

  test('identités exactes, quatre commandes, quatre lignes réelles détectées sans suppression',async()=>{
    const client=await db.getClient();
    let report;
    try{report=await inspect(client,run);}finally{client.release();}
    expect(report.roots).toHaveLength(4);
    expect(report.missing).toEqual([]);
    expect(report.delete_performed).toBe(false);
    expect(report.cleanup_certified).toBe(false);
    expect(report.verdict).toMatch(/^HOLD_/);
    expect(report.discovered_tables).toEqual(expect.arrayContaining([
      expect.objectContaining({table:'orders',count:4}),
      expect.objectContaining({table:'order_items',count:4}),
    ]));
    expect((await q("SELECT COUNT(*)::int AS n FROM orders WHERE reference=ANY($1::text[])",[exactRefs(run)])).rows[0].n).toBe(4);
    expect((await q("SELECT COUNT(*)::int AS n FROM order_items WHERE order_id=ANY($1::uuid[])",[ids.orders])).rows[0].n).toBe(4);
  });
});
