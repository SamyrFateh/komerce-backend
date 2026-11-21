'use strict';
/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 *
 * Two independent PostgreSQL listeners receive only durable, AFTER COMMIT
 * dashboard invalidations, proving the migration's real trigger contract.
 * Disposable komerce_test DB only; no staging or production writes.
 */
const crypto=require('node:crypto');
const {describeE2E}=require('../helpers/e2eDbKit');

jest.setTimeout(30000);

describeE2E('Dashboard after-commit NOTIFY, two independent PostgreSQL sessions',({db})=>{
  const listeners=[];
  let transaction=null;
  let id=null;

  beforeAll(async()=>{
    for(let i=0;i<2;i++){
      const client=await db.getClient();
      const events=[];
      client.on('notification',m=>{
        if(m.channel==='komerce_dashboard_refresh')events.push(m.payload);
      });
      await client.query('LISTEN komerce_dashboard_refresh');
      listeners.push({client,events});
    }
    transaction=await db.getClient();
  });

  afterAll(async()=>{
    if(transaction){
      try{await transaction.query('ROLLBACK');}catch(_){}
      transaction.release();
    }
    if(id)try{await db.query('DELETE FROM products WHERE id=$1',[id]);}catch(_){}
    for(const entry of listeners){
      try{await entry.client.query('UNLISTEN komerce_dashboard_refresh');}catch(_){}
      entry.client.release();
    }
  });

  test('products writer rolls back silently but COMMIT is visible to both listeners, payload opaque',async()=>{
    id=crypto.randomUUID();
    const sql='INSERT INTO products (id,name,price_kmf,stock) VALUES ($1,$2,25000,5)';
    const name='E2E dashboard notify '+id.slice(0,8);
    const trigger=await db.query(
      "SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname='products' AND t.tgname='dashboard_refresh_after_write' AND NOT t.tgisinternal");
    expect(trigger.rows).toHaveLength(1);

    await transaction.query('BEGIN');
    await transaction.query(sql,[id,name]);
    await transaction.query('ROLLBACK');
    await new Promise(resolve=>setTimeout(resolve,250));
    expect(listeners.map(x=>x.events)).toEqual([[],[]]);

    await transaction.query('BEGIN');
    await transaction.query(sql,[id,name]);
    await transaction.query('COMMIT');
    const deadline=Date.now()+8000;
    while(Date.now()<deadline && listeners.some(x=>x.events.length===0)){
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    for(const {events} of listeners){
      expect(events).toEqual(['changed']);
      expect(JSON.stringify(events)).not.toContain(id);
      expect(JSON.stringify(events)).not.toContain(name);
    }
    const {rows}=await db.query('SELECT id FROM products WHERE id=$1',[id]);
    expect(rows).toHaveLength(1);
  });
});
