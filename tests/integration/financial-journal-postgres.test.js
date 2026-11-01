'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration financial-journal-postgres.test.js
 * @brief Lot 5 — journal financier (migration 359) sur PostgreSQL réel : projection idempotente, natif + EUR + taux figés,
 *        immuabilité, EUR jamais inventé, réconciliation événements métier ↔ journal ↔ agrégat dashboard Finance.
 */

const crypto = require('crypto');

jest.setTimeout(60000);

const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;
const id = () => crypto.randomUUID();

describeDb('journal financier — migration 359 (REAL_DB)', () => {
  const db = require('../../db');
  const fx = require('../../services/fx-authority');
  const journal = require('../../services/financial-journal');
  const projectors = require('../../services/financial-journal-projectors');
  const reporting = require('../../services/financial-journal-reporting');
  const metrics = require('../../services/dashboard-metrics');
  const tag = `FJ-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const ids = { orders: [], relais: [], products: [], items: [], pos: [], groups: [], payments: [], settlements: [], refunds: [], allocs: [] };
  let km; let supplier; let kmOrder; let kmOrder2; let refundId; let paymentId; let settlementId; let allocId;
  let seq = 0;
  const q = (sql, params) => db.query(sql, params);

  async function seedOrder({ totalKmf, totalEur = null, payment = 'paid', status = 'confirmed' }) {
    seq += 1;
    const relais = id(); const orderId = id();
    ids.relais.push(relais); ids.orders.push(orderId);
    await q(`INSERT INTO relais(id,name,agent_name,phone,address,island,market_id) VALUES($1,$2,'A','+269000111','R','Ngazidja',$3)`, [relais, `FJ Relais ${tag}-${seq}`, km]);
    await q(`INSERT INTO orders(id,reference,relais_id,market_id,total_kmf,total_eur,payment_mode,payment_status,status)
             VALUES($1,$2,$3,$4,$5,$6,'cash_relais',$7,$8)`, [orderId, `${tag}-O${seq}`, relais, km, totalKmf, totalEur, payment, status]);
    return orderId;
  }

  beforeAll(async () => {
    km = (await q("SELECT id FROM markets WHERE code='KM'")).rows[0].id;
    supplier = id();
    await q("INSERT INTO suppliers(id,name,platform) VALUES($1,$2,'cj')", [supplier, `FJ Supplier ${tag}`]);
    kmOrder = await seedOrder({ totalKmf: 10000, totalEur: 20.33 });
    kmOrder2 = await seedOrder({ totalKmf: 5000 }); // aucun EUR capturé : conversion par l'autorité
    // remboursement terminé
    refundId = id(); ids.refunds.push(refundId);
    await q(`INSERT INTO refunds(id,order_id,amount_kmf,amount_eur,refund_type,refund_method,status,completed_at)
             VALUES($1,$2,2000,4.07,'partial','store_credit','completed',NOW())`, [refundId, kmOrder]);
    // coût réel alloué
    const productId = id(); const itemId = id(); allocId = id();
    ids.products.push(productId); ids.items.push(itemId); ids.allocs.push(allocId);
    await q(`INSERT INTO products(id,name,price_kmf,stock,weight_kg,cost_kmf) VALUES($1,$2,10000,10,1,4000)`, [productId, `FJ Produit ${tag}`]);
    await q(`INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf,fulfillment_source) VALUES($1,$2,$3,1,10000,'LOCAL_STOCK')`, [itemId, kmOrder, productId]);
    await q(`INSERT INTO order_item_real_cost_allocations(id,order_id,order_item_id,cost_type,amount_kmf,allocation_method,is_actual)
             VALUES($1,$2,$3,'freight',700,'direct',true)`, [allocId, kmOrder, itemId]);
    // PO + paiement fournisseur USD + règlement prouvé
    const poId = id(); ids.pos.push(poId); const groupId = id(); ids.groups.push(groupId); paymentId = id(); ids.payments.push(paymentId);
    await db.withTransaction(async (client) => {
      await client.query('SET LOCAL session_replication_role = replica');
      await client.query(`INSERT INTO purchase_orders(id,supplier_id,status,qty,market_id) VALUES($1,$2,'confirmed',NULL,$3)`, [poId, supplier, km]);
    });
    await q(`INSERT INTO supplier_execution_groups(id,purchase_order_id,provider,supplier_parent_order_id) VALUES($1,$2,'cj',$3)`, [groupId, poId, `P-${tag}`]);
    await q(`INSERT INTO supplier_execution_payments(id,purchase_order_id,provider,payment_execution_key,supplier_execution_group_id,expected_amount,observed_amount,currency,status,reconciliation_status,real_debit_verified)
             VALUES($1,$2,'cj',$3,$4,100,100,'USD','succeeded','matched',true)`, [paymentId, poId, `${tag}-K`, groupId]);
    settlementId = id(); ids.settlements.push(settlementId);
    await db.withTransaction(async (client) => {
      await client.query(`INSERT INTO supplier_payment_settlements(id,supplier_execution_payment_id,kind,amount_currency,currency,amount_kmf,fees_kmf,proof_ref,idempotency_key)
                          VALUES($1,$2,'payment',100,'USD',40000,150,$3,$4)`, [settlementId, paymentId, `RELEVE-${tag}`, `idem-${tag}`]);
    });
  });

  afterAll(async () => {
    const run = (sql, p) => db.query(sql, p).catch(() => {});
    await run('SET session_replication_role = replica');
    await run('DELETE FROM financial_movement_documents WHERE movement_id IN (SELECT id FROM financial_movements WHERE provenance::text LIKE $1 OR source_id = ANY($2::text[]))', [`%${tag}%`, [...ids.orders, ...ids.refunds, ...ids.allocs, ...ids.settlements, ...ids.payments]]);
    await run('DELETE FROM financial_movements WHERE provenance::text LIKE $1 OR source_id = ANY($2::text[])', [`%${tag}%`, [...ids.orders, ...ids.refunds, ...ids.allocs, ...ids.settlements, ...ids.payments]]);
    await run('DELETE FROM supplier_payment_settlements WHERE id = ANY($1::uuid[])', [ids.settlements]);
    await run('DELETE FROM supplier_execution_payments WHERE id = ANY($1::uuid[])', [ids.payments]);
    await run('DELETE FROM supplier_execution_groups WHERE id = ANY($1::uuid[])', [ids.groups]);
    await run('DELETE FROM purchase_orders WHERE id = ANY($1::uuid[])', [ids.pos]);
    await run('DELETE FROM refunds WHERE id = ANY($1::uuid[])', [ids.refunds]);
    await run('DELETE FROM order_item_real_cost_allocations WHERE id = ANY($1::uuid[])', [ids.allocs]);
    await run('DELETE FROM order_items WHERE id = ANY($1::uuid[])', [ids.items]);
    await run('DELETE FROM orders WHERE id = ANY($1::uuid[])', [ids.orders]);
    await run('DELETE FROM products WHERE id = ANY($1::uuid[])', [ids.products]);
    await run('DELETE FROM relais WHERE id = ANY($1::uuid[])', [ids.relais]);
    await run('DELETE FROM suppliers WHERE id = $1', [supplier]);
    await run("SET session_replication_role = origin");
    await db.pool.end().catch(() => {});
  });

  const mine = async () => (await q(
    `SELECT * FROM financial_movements WHERE order_id = ANY($1::uuid[]) OR source_id = ANY($2::text[]) ORDER BY movement_key`,
    [ids.orders, [...ids.refunds, ...ids.allocs, ...ids.settlements, ...ids.payments]])).rows;

  test('projection : natif conservé, état, provenance, pièces', async () => {
    await db.withTransaction(client => projectors.projectAll(client, { marketId: km }));
    const rows = await mine();
    const byKind = kind => rows.filter(r => r.source_kind === kind);
    expect(byKind('order_payment')).toHaveLength(2);
    expect(byKind('order_refund')).toHaveLength(1);
    expect(byKind('cost_allocation')).toHaveLength(1);
    expect(byKind('supplier_settlement').map(r => r.facet).sort()).toEqual(['fees', 'main']);
    expect(byKind('supplier_payment')).toHaveLength(1);

    const usd = byKind('supplier_settlement').find(r => r.facet === 'main');
    expect(usd.currency).toBe('USD');
    expect(Number(usd.amount_native)).toBe(100);
    expect(usd.state).toBe('settled');
    expect(usd.provenance.origin_kmf).toBe('40000.00');
    const docs = (await q('SELECT doc_ref FROM financial_movement_documents WHERE movement_id = $1', [usd.id])).rows;
    expect(docs.map(d => d.doc_ref)).toEqual([`RELEVE-${tag}`]);

    const commitment = byKind('supplier_payment')[0];
    expect(commitment.state).toBe('observed');
    expect(rows.every(r => r.provenance && r.provenance.source)).toBe(true);
  });

  test('EUR : snapshot capturé conservé, conversion via l’autorité, jamais inventé', async () => {
    const rows = await mine();
    const paid = rows.filter(r => r.source_kind === 'order_payment');
    const captured = paid.find(r => r.order_id === kmOrder);
    expect(captured.fx_status).toBe('snapshot');
    expect(Number(captured.amount_eur)).toBe(20.33);

    const converted = paid.find(r => r.order_id === kmOrder2);
    const expected = await fx.convert({ amount: '5000', from: 'KMF', to: 'EUR', at: converted.occurred_at });
    expect(converted.fx_status).toBe('converted');
    expect(Number(converted.amount_eur)).toBe(expected.amount);
    expect(converted.fx_legs.length).toBeGreaterThan(0);

    // USD : sans fixing disponible l'EUR reste absent (jamais estimé) ; avec fixing, il vient de l'autorité.
    const usd = rows.find(r => r.source_kind === 'supplier_settlement' && r.facet === 'main');
    let authority = null;
    try { authority = await fx.convert({ amount: '100', from: 'USD', to: 'EUR', at: usd.occurred_at }); } catch (_) { /* taux absent */ }
    if (authority) { expect(usd.fx_status).toBe('converted'); expect(Number(usd.amount_eur)).toBe(authority.amount); }
    else { expect(usd.fx_status).toBe('unavailable'); expect(usd.amount_eur).toBeNull(); }
  });

  test('idempotence : rejouer ne crée rien et ne modifie aucun montant', async () => {
    const before = await mine();
    const report = await db.withTransaction(client => projectors.projectAll(client, { marketId: km }));
    expect(Object.values(report).reduce((n, r) => n + r.created, 0)).toBe(0);
    expect(Object.values(report).every(r => r.conflicts.length === 0)).toBe(true);
    const after = await mine();
    expect(after.map(r => [r.movement_key, r.amount_native, r.amount_eur, r.state])).toEqual(before.map(r => [r.movement_key, r.amount_native, r.amount_eur, r.state]));
  });

  test('immuabilité : montants, EUR et taux figés, état sans recul, pas de DELETE', async () => {
    const [row] = (await mine()).filter(r => r.source_kind === 'order_payment' && r.order_id === kmOrder);
    await expect(q('UPDATE financial_movements SET amount_native = amount_native + 1 WHERE id = $1', [row.id])).rejects.toThrow(/immuables/);
    await expect(q('UPDATE financial_movements SET amount_eur = 1 WHERE id = $1', [row.id])).rejects.toThrow(/figés/);
    await expect(q("UPDATE financial_movements SET state = 'planned' WHERE id = $1", [row.id])).rejects.toThrow(/ne recule pas/);
    await expect(q('DELETE FROM financial_movements WHERE id = $1', [row.id])).rejects.toThrow(/append-only/);
  });

  test('conflit : même clé avec montant différent est refusé, jamais réécrit', async () => {
    await expect(db.withTransaction(client => journal.recordMovement(client, {
      sourceKind: 'order_refund', sourceId: refundId, direction: 'outflow', category: 'refund', state: 'settled',
      amountNative: 9999, currency: 'KMF', occurredAt: new Date(), provenance: { source: 'refunds' },
    }))).rejects.toMatchObject({ code: 'JOURNAL_MOVEMENT_CONFLICT' });
  });

  test('EUR rattrapable : un mouvement « unavailable » reçoit son EUR une seule fois', async () => {
    const key = `${tag}-late`;
    await db.withTransaction(client => journal.recordMovement(client, {
      sourceKind: 'order_refund', sourceId: key, direction: 'outflow', category: 'refund', state: 'committed',
      amountNative: 150, currency: 'JPY', occurredAt: new Date(), provenance: { source: 'test', tag },
    }));
    const first = (await q("SELECT * FROM financial_movements WHERE source_id = $1", [key])).rows[0];
    expect(first.fx_status).toBe('unavailable');
    expect(first.amount_eur).toBeNull();
    const attached = await db.withTransaction(client => journal.recordMovement(client, {
      sourceKind: 'order_refund', sourceId: key, direction: 'outflow', category: 'refund', state: 'settled',
      amountNative: 150, currency: 'JPY', occurredAt: first.occurred_at, eur: { amount: 0.9, legs: [{ id: 'manual-proof' }] }, provenance: { source: 'test', tag },
    }));
    expect(attached.outcome).toBe('eur_attached');
    const second = (await q("SELECT * FROM financial_movements WHERE source_id = $1", [key])).rows[0];
    expect(second.fx_status).toBe('snapshot');
    expect(Number(second.amount_eur)).toBe(0.9);
    expect(second.state).toBe('settled');
  });

  test('projection Finance : lignes catégorie × état, EUR connu additionné, natifs par devise, restant fournisseur', async () => {
    const proj = await reporting.projection(db, { marketId: km });
    const line = (category, state) => proj.lines.find(l => l.category === category && l.state === state);
    const sales = line('sale', 'settled');
    expect(sales.movements).toBeGreaterThanOrEqual(2);
    const rows = await mine();
    const expectedEur = rows.filter(r => r.source_kind === 'order_payment').reduce((n, r) => n + Number(r.amount_eur), 0);
    // le marché KM peut contenir d'autres ventes réelles : on borne par le bas avec nos deux commandes
    expect(sales.eur_total).toBeGreaterThanOrEqual(Math.round(expectedEur * 100) / 100 - 0.001);
    expect(line('refund', 'settled').native.some(n => n.currency === 'KMF')).toBe(true);
    expect(line('supplier_purchase', 'observed')).toBeTruthy();
    // engagé 100 USD, réglé 100 USD : rien à décaisser pour ce PO
    const remainingUsd = (proj.supplier_remaining_native || []).find(r => r.currency === 'USD');
    expect(remainingUsd ? Number(remainingUsd.remaining_native) : 0).toBeGreaterThanOrEqual(0);
    expect(proj.eur_complete).toBe(proj.eur_unavailable_movements === 0);
  });

  test('payload Finance : la projection du journal est exposée avec la même source', async () => {
    const finance = require('../../services/dashboard-finance-canonical');
    const payload = await finance.buildFinance({ period: '30' }, {});
    expect(payload.journal).toBeTruthy();
    expect(payload.journal.basis).toBe('financial_movements');
    expect(Array.isArray(payload.journal.lines)).toBe(true);
  });

  test('réconciliation : événements métier ↔ journal ↔ EUR ↔ agrégat dashboard Finance', async () => {
    const recon = await reporting.reconcileWithSources(db, { marketId: km });
    const failed = recon.checks.filter(c => !c.ok);
    expect(failed).toEqual([]);

    // Agrégat dashboard (CA encaissé, même cohorte) = somme des origin_kmf du journal pour ces commandes.
    const dash = await metrics.getCAEncaisse({ market_id: km, from: new Date(Date.now() - 3600e3).toISOString(), to: new Date(Date.now() + 3600e3).toISOString() });
    const journalCohort = (await q(
      `SELECT COALESCE(SUM((m.provenance->>'origin_kmf')::numeric), 0)::text AS kmf
         FROM financial_movements m JOIN orders o ON o.id = m.order_id
        WHERE m.source_kind = 'order_payment' AND o.market_id = $1 AND o.payment_status = 'paid'
          AND o.status NOT IN ('cancelled','refunded') AND o.simulation_scope IS NULL
          AND o.created_at >= NOW() - interval '1 hour' AND o.created_at <= NOW() + interval '1 hour'`, [km])).rows[0].kmf;
    expect(Number(journalCohort)).toBe(Number(dash.value));
    expect(Number(dash.value)).toBeGreaterThanOrEqual(15000);

    const summary = await reporting.summarize(db, { marketId: km });
    const sales = summary.rows.filter(r => r.category === 'sale');
    expect(sales.length).toBeGreaterThan(0);
    expect(typeof summary.eur_complete).toBe('boolean');
  });
});
