'use strict';
/** @test-kind integration @test-runner jest @test-requires postgres */
const { Pool } = require('pg');
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;
jest.setTimeout(45000);

const run = pool ? describe : describe.skip;
run('Hub stage note — preuve PostgreSQL de non-réécriture', () => {
  afterAll(async () => { if (pool) await pool.end(); });

  test('UPDATE et DELETE directs refusés ; notes legacy libres ; cascade parent possible', async () => {
    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      const selected = await client.query('SELECT id FROM public.markets LIMIT 1');
      let marketId = selected.rows[0]?.id;
      if (!marketId) {
        const market = await client.query(`
          INSERT INTO public.markets(code,name,currency,lifecycle_status)
          VALUES ('ZZ','CI journal Hub','KMF','ACTIVE') RETURNING id
        `);
        marketId=market.rows[0].id;
      }
      const relay = await client.query(`
        INSERT INTO public.relais(name,phone,address,market_id)
        VALUES ('CI journal','0000000000','CI sandbox', $1) RETURNING id
      `,[marketId]);
      const order = await client.query(`
        INSERT INTO public.orders(reference,relais_id,total_kmf,payment_mode,market_id)
        VALUES ('CI-HUB-STAGE-'||gen_random_uuid()::text,$1,0,'cash_relais',$2) RETURNING id
      `,[relay.rows[0].id,marketId]);
      const orderId=order.rows[0].id;
      const note = await client.query(`
        INSERT INTO public.order_comments(order_id,author_name,text,hub_stage_key)
        VALUES ($1,'CI auteur immuable','Fournisseur relancé','supplier') RETURNING id
      `,[orderId]);
      const noteId=note.rows[0].id;

      await client.query('SAVEPOINT guard_update');
      await expect(client.query('UPDATE public.order_comments SET text=$1 WHERE id=$2',
        ['Message falsifié',noteId])).rejects.toMatchObject({code:'P0001'});
      await client.query('ROLLBACK TO SAVEPOINT guard_update');

      await client.query('SAVEPOINT guard_delete');
      await expect(client.query('DELETE FROM public.order_comments WHERE id=$1',[noteId]))
        .rejects.toMatchObject({code:'P0001'});
      await client.query('ROLLBACK TO SAVEPOINT guard_delete');

      const legacy = await client.query(`
        INSERT INTO public.order_comments(order_id,author_name,text)
        VALUES ($1,'CI','Ancien commentaire') RETURNING id
      `,[orderId]);
      const legacyId=legacy.rows[0].id;
      await client.query('UPDATE public.order_comments SET text=$1 WHERE id=$2',
        ['Ancien commentaire révisé',legacyId]);
      await client.query('DELETE FROM public.order_comments WHERE id=$1',[legacyId]);

      // La suppression du dossier entier est régie par la FK et la politique
      // de rétention, pas par une action d'édition de commentaire.
      await client.query('DELETE FROM public.orders WHERE id=$1',[orderId]);
      const count=await client.query('SELECT count(*)::int AS n FROM public.order_comments WHERE id=$1',[noteId]);
      expect(count.rows[0].n).toBe(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
