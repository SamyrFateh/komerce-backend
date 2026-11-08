'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration catalog-product-quality-hold-postgres.test.js
 * @brief Une référence globalement gelée bloque l'INSERT de nouvelles lignes de vente
 *   même hors UI ; les commentaires sont immuables et un dégel motivé rétablit le flux.
 * @safety CI PostgreSQL jetable exclusivement ; transaction ROLLBACK en fin de test.
 */
const isolated = process.env.GITHUB_ACTIONS === 'true'
  && process.env.NODE_ENV === 'test'
  && process.env.KOMERCE_DISABLE_CRONS === 'true'
  && process.env.DATABASE_URL === 'postgresql://komerce:komerce@localhost:5432/komerce_test';

if (!isolated) {
  describe.skip('quality hold PG16 — isolated CI DB required', () => {
    test('skipped outside disposable CI PostgreSQL', () => {});
  });
} else {
  jest.setTimeout(45000);
  const { randomUUID } = require('node:crypto');
  const db = require('../../db');

  test('le gel est global, la note immuable, le dégel unique et les commandes historiques conservées', async () => {
    const client = await db.getClient();
    const actor = randomUUID();
    const relayId = randomUUID();
    const productId = randomUUID();
    const orderId = randomUUID();
    const reference = 'QH-' + randomUUID().replace(/-/g,'').slice(0,14);
    let opened = false;

    async function mustFail(sql, params, message) {
      await client.query('SAVEPOINT quality_negative');
      try {
        await expect(client.query(sql, params)).rejects.toMatchObject({ code: 'P0001' });
      } finally {
        await client.query('ROLLBACK TO SAVEPOINT quality_negative');
        await client.query('RELEASE SAVEPOINT quality_negative');
      }
    }

    try {
      await client.query('BEGIN');
      opened = true;
      const marketId = (await client.query("SELECT id FROM markets WHERE code='KM'")).rows[0].id;
      await client.query(
        "INSERT INTO users(id,full_name,role,email) VALUES($1,'Quality CI agent','admin',$2)",
        [actor,'sav-quality-'+randomUUID()+'@komerce.test']
      );
      await client.query(
        "INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,$2,'CI','+2693000999','CI test',$3)",
        [relayId,reference,marketId]
      );
      await client.query(
        "INSERT INTO products(id,name,price_kmf,stock,is_active,is_available) VALUES($1,$2,1500,9,true,true)",
        [productId,'Synthetic '+reference]
      );
      await client.query(
        "INSERT INTO orders(id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur) VALUES($1,$2,$3,$4,'confirmed','paid','stripe_eur',1500,3)",
        [orderId,relayId,marketId,reference]
      );
      const insertLine = "INSERT INTO order_items(order_id,product_id,quantity,price_kmf) VALUES($1,$2,1,1500)";
      await client.query(insertLine,[orderId,productId]);
      const firstCount = Number((await client.query(
        'SELECT COUNT(*)::int AS n FROM order_items WHERE order_id=$1',[orderId]
      )).rows[0].n);
      expect(firstCount).toBe(1);

      const {rows:[note]} = await client.query(
        "INSERT INTO catalog_product_quality_notes(product_id,author_id,note) VALUES($1,$2,'Anomalie signalée sur cet article') RETURNING id",
        [productId,actor]
      );
      await mustFail('UPDATE catalog_product_quality_notes SET note=$2 WHERE id=$1',
        [note.id,'Réécriture refusée'], 'note immutable');

      const {rows:[hold]} = await client.query(
        "INSERT INTO catalog_product_sale_holds(product_id,reason,comment,frozen_by) VALUES($1,'defect','Défaut produit identifié, vente suspendue',$2) RETURNING id",
        [productId,actor]
      );
      await mustFail('UPDATE catalog_product_sale_holds SET comment=$2 WHERE id=$1',
        [hold.id,'Commentaire modifié illégalement'], 'hold original immutable');

      await client.query('SAVEPOINT quality_checkout');
      try {
        await expect(client.query(insertLine,[orderId,productId])).rejects.toMatchObject({code:'23514'});
      } finally {
        await client.query('ROLLBACK TO SAVEPOINT quality_checkout');
        await client.query('RELEASE SAVEPOINT quality_checkout');
      }
      const blockedCount = Number((await client.query(
        'SELECT COUNT(*)::int AS n FROM order_items WHERE order_id=$1',[orderId]
      )).rows[0].n);
      expect(blockedCount).toBe(1);

      await client.query(
        "UPDATE catalog_product_sale_holds SET released_at=now(),released_by=$2,release_comment='Inspection concluante, produit autorisé à la revente' WHERE id=$1",
        [hold.id,actor]
      );
      await mustFail(
        "UPDATE catalog_product_sale_holds SET release_comment='Deuxième décision interdite' WHERE id=$1",
        [hold.id], 'release immutable'
      );
      await client.query(insertLine,[orderId,productId]);
      const finalCount = Number((await client.query(
        'SELECT COUNT(*)::int AS n FROM order_items WHERE order_id=$1',[orderId]
      )).rows[0].n);
      expect(finalCount).toBe(2);
      const stock = Number((await client.query(
        'SELECT stock FROM products WHERE id=$1',[productId]
      )).rows[0].stock);
      expect(stock).toBe(9);
    } finally {
      if (opened) await client.query('ROLLBACK');
      client.release();
    }
  });
}
