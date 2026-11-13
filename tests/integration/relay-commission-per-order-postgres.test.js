'use strict';
/** @test-kind integration @test-runner jest @test-requires postgres */
// Isolated real PostgreSQL semantics: temp tables + ROLLBACK, no business data mutation.
if (!process.env.DATABASE_URL) {
  describe.skip('relay per-order PostgreSQL (requires DATABASE_URL)', () => {
    it('needs postgres', () => {});
  });
} else {
  const crypto = require('crypto');
  const db = require('../../db');
  const { allocateParcelRealCosts } = require('../../services/cost-allocation/allocate');
  jest.setTimeout(30000);
  let client, ids;
  beforeEach(async () => {
    client = await db.pool.connect();
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE orders (id uuid PRIMARY KEY, relais_id uuid, simulation_scope text) ON COMMIT DROP;
      CREATE TEMP TABLE parcels (id uuid PRIMARY KEY, order_id uuid, status text) ON COMMIT DROP;
      CREATE TEMP TABLE order_items (id uuid PRIMARY KEY, order_id uuid) ON COMMIT DROP;
      CREATE TEMP TABLE parcel_items (parcel_id uuid, order_item_id uuid, quantity int) ON COMMIT DROP;
      CREATE TEMP TABLE cost_components (key text, default_value numeric, unit text,
        allocation_method text, updated_by uuid, provenance text, is_active bool,
        is_exceptional bool, active_from date, active_until date, display_order int) ON COMMIT DROP;
      CREATE TEMP TABLE finance_config (id int, commission_relais_standard_kmf numeric) ON COMMIT DROP;
      CREATE TEMP TABLE order_item_real_cost_allocations (order_id uuid, order_item_id uuid,
        parcel_id uuid, cost_type text, amount_kmf numeric(12,2), allocation_method text,
        source text, is_actual bool, confidence text, provenance text, notes text) ON COMMIT DROP;
    `);
    ids = Object.fromEntries(['order','relay','parcel1','parcel2','item1','item2','operator'].map(k => [k,crypto.randomUUID()]));
    await client.query('INSERT INTO orders(id,relais_id) VALUES($1,$2)',[ids.order,ids.relay]);
    await client.query(`INSERT INTO parcels(id,order_id,status) VALUES
      ($1,$3,'available'),($2,$3,'available')`,[ids.parcel1,ids.parcel2,ids.order]);
    await client.query('INSERT INTO order_items(id,order_id) VALUES ($1,$3),($2,$3)',[ids.item1,ids.item2,ids.order]);
    await client.query('INSERT INTO parcel_items(parcel_id,order_item_id,quantity) VALUES ($1,$3,1),($2,$4,2)',
      [ids.parcel1,ids.parcel2,ids.item1,ids.item2]);
    await client.query(`INSERT INTO cost_components(key,default_value,unit,allocation_method,
      updated_by,provenance,is_active,is_exceptional,display_order)
      VALUES('commission_relais_kmf',600.01,'kmf_per_order','per_order',$1,'Contrat SQL',TRUE,FALSE,1)`,[ids.operator]);
    await client.query('INSERT INTO finance_config(id,commission_relais_standard_kmf) VALUES(1,500)');
  });
  afterEach(async () => { if (client) { await client.query('ROLLBACK').catch(() => {}); client.release(); } });
  async function relayRows() {
    return (await client.query("SELECT * FROM order_item_real_cost_allocations WHERE cost_type='relay'")).rows;
  }
  it('1 forfait pour 2 colis, pas avant remise, sans duplication au replay', async () => {
    expect((await allocateParcelRealCosts(ids.parcel1,client)).reason).toBe('parcel_not_collected');
    await client.query("UPDATE parcels SET status='collected' WHERE id=$1",[ids.parcel1]);
    const first = await allocateParcelRealCosts(ids.parcel1,client);
    expect(first.relay_commission_basis).toBe('per_order');
    expect(first.allocations_count).toBe(1);
    await client.query("UPDATE parcels SET status='collected' WHERE id=$1",[ids.parcel2]);
    const second = await allocateParcelRealCosts(ids.parcel2,client);
    expect(second.orders[0].status).toBe('already_allocated_preserved');
    expect((await allocateParcelRealCosts(ids.parcel1,client)).allocations_count).toBe(0);
    const rows = await relayRows();
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount_kmf)).toBe(600.01);
    expect(rows[0].allocation_method).toBe('per_order');
    expect(rows[0].is_actual).toBe(true);
  });
  it('un historique per_item est préservé sans écriture nouvelle', async () => {
    await client.query(`INSERT INTO order_item_real_cost_allocations
      (order_id,order_item_id,parcel_id,cost_type,amount_kmf,allocation_method,source,is_actual)
      VALUES($1,$2,$3,'relay',1800,'per_item','legacy',TRUE)`,[ids.order,ids.item1,ids.parcel1]);
    await client.query("UPDATE parcels SET status='collected' WHERE id=$1",[ids.parcel2]);
    const r = await allocateParcelRealCosts(ids.parcel2,client);
    expect(r.allocations_count).toBe(0);
    expect(r.orders[0]).toMatchObject({ status: 'already_allocated_preserved',
      existing_total_kmf: 1800, existing_methods: ['per_item'] });
    expect(await relayRows()).toHaveLength(1);
  });
  it('une configuration per_item est refusée, sans coût posté', async () => {
    await client.query("UPDATE parcels SET status='collected' WHERE id=$1",[ids.parcel1]);
    await client.query("UPDATE cost_components SET unit='kmf',allocation_method='per_item'");
    await expect(allocateParcelRealCosts(ids.parcel1,client)).rejects.toMatchObject({
      code: 'RELAY_COMMISSION_BASIS_CONFLICT', status: 422,
    });
    expect(await relayRows()).toHaveLength(0);
  });
}
