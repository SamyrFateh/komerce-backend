'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @purpose prevent unnecessary runtime ACCESS EXCLUSIVE DDL locks
 */
const { applySchemaDdlWhenMissing } = require('../../scripts/fix-schema');
const add = "ALTER TABLE order_items ADD COLUMN IF NOT EXISTS availability_status TEXT DEFAULT 'pending'";
const idx = "CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_qr_token ON orders(qr_token)";
const drop = "ALTER TABLE parcels DROP CONSTRAINT IF EXISTS one_draft_per_order";
const table = "CREATE TABLE IF NOT EXISTS partners (id UUID PRIMARY KEY)";
function db(present) {
  return { query: jest.fn(async sql => sql.startsWith('SELECT ')
    ? { rows: [{ exists: present }] } : { rowCount: 0, rows: [] }) };
}

test('column already there: catalog read only, no table ALTER', async () => {
  const q=db(true);
  expect(await applySchemaDdlWhenMissing(q,add)).toMatchObject({skipped:true,kind:'column'});
  expect(q.query).toHaveBeenCalledTimes(1);
  expect(q.query.mock.calls[0][1]).toEqual(['order_items','availability_status']);
  expect(q.query.mock.calls[0][0]).toContain('pg_catalog.pg_attribute');
});
test('column missing: original idempotent DDL is applied', async () => {
  const q=db(false);
  await applySchemaDdlWhenMissing(q,add);
  expect(q.query).toHaveBeenCalledTimes(2);
  expect(q.query.mock.calls[1][0]).toBe(add);
});
test('existing index/table: skip repeated boot DDL', async () => {
  for(const sql of [idx,table]){
    const q=db(true);
    expect((await applySchemaDdlWhenMissing(q,sql)).skipped).toBe(true);
    expect(q.query).toHaveBeenCalledTimes(1);
  }
});
test('missing index: preserve normal CREATE INDEX behavior', async () => {
  const q=db(false);
  await applySchemaDdlWhenMissing(q,idx);
  expect(q.query.mock.calls[1][0]).toBe(idx);
});
test('missing constraint: skip DROP CONSTRAINT (which also locks the table)', async () => {
  const q=db(false);
  expect((await applySchemaDdlWhenMissing(q,drop)).skipped).toBe(true);
  expect(q.query).toHaveBeenCalledTimes(1);
});
test('existing constraint: original DROP CONSTRAINT remains executable', async () => {
  const q=db(true);
  await applySchemaDdlWhenMissing(q,drop);
  expect(q.query.mock.calls[1][0]).toBe(drop);
});
test('multi-statement SQL never short-circuits, even with known object', async () => {
  const q=db(true);
  const sql=add+'; UPDATE orders SET status=status';
  await applySchemaDdlWhenMissing(q,sql);
  expect(q.query).toHaveBeenCalledTimes(1);
  expect(q.query.mock.calls[0][0]).toBe(sql);
});
test('database catalog failures do not silently claim migration succeeded', async () => {
  const err=Object.assign(new Error('catalog unavailable'),{code:'57014'});
  const q={query:jest.fn().mockRejectedValue(err)};
  await expect(applySchemaDdlWhenMissing(q,add)).rejects.toBe(err);
  expect(q.query).toHaveBeenCalledTimes(1);
});
