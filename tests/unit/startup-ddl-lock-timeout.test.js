'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @purpose verify 3s local lock timeout on isolated startup DDL client only
 */
const { runStartupDdlWithLockTimeout, applySchemaDdlWhenMissing } = require('../../scripts/fix-schema');

const ALTER='ALTER TABLE orders ADD COLUMN IF NOT EXISTS pending_at TIMESTAMPTZ';
function fakePool({ errorAt = null, rollbackFails = false } = {}) {
  const calls=[];
  const client={
    query:jest.fn(async sql=>{
      calls.push(sql);
      if (errorAt && sql===errorAt) throw Object.assign(new Error('lock not available'),{code:'55P03'});
      if (rollbackFails && sql==='ROLLBACK') throw new Error('connection lost');
      return {rowCount:0,rows:[]};
    }),
    release:jest.fn()
  };
  return {
    query:jest.fn(async(sql)=>sql.startsWith('SELECT ')?{rows:[{exists:false}]}:{rows:[]}),
    connect:jest.fn(async()=>client),
    client,calls
  };
}
test('DDL in isolated transaction: BEGIN -> SET LOCAL 3s -> original DDL -> COMMIT',async()=>{
  const pool=fakePool();
  await runStartupDdlWithLockTimeout(pool,ALTER);
  expect(pool.calls).toEqual(['BEGIN',"SET LOCAL lock_timeout = '3s'",ALTER,'COMMIT']);
  expect(pool.client.release).toHaveBeenCalledWith(false);
  expect(pool.query).not.toHaveBeenCalled();
});
test('catalog check first, then protected DDL only if column absent',async()=>{
  const pool=fakePool();
  await applySchemaDdlWhenMissing(pool,ALTER);
  expect(pool.query).toHaveBeenCalledTimes(1);
  expect(pool.calls).toEqual(['BEGIN',"SET LOCAL lock_timeout = '3s'",ALTER,'COMMIT']);
});
test('already present DDL: no client checkout nor transaction',async()=>{
  const pool=fakePool();
  pool.query.mockResolvedValue({rows:[{exists:true}]});
  expect(await applySchemaDdlWhenMissing(pool,ALTER)).toMatchObject({skipped:true});
  expect(pool.connect).not.toHaveBeenCalled();
});
test('55P03 propagates; rollback occurs and the session is released without a leaked GUC',async()=>{
  const pool=fakePool({errorAt:ALTER});
  await expect(runStartupDdlWithLockTimeout(pool,ALTER)).rejects.toMatchObject({code:'55P03'});
  expect(pool.calls).toEqual(['BEGIN',"SET LOCAL lock_timeout = '3s'",ALTER,'ROLLBACK']);
  expect(pool.client.release).toHaveBeenCalledWith(false);
});
test('failed rollback discards the bad connection',async()=>{
  const pool=fakePool({errorAt:ALTER,rollbackFails:true});
  await expect(runStartupDdlWithLockTimeout(pool,ALTER)).rejects.toMatchObject({code:'55P03'});
  expect(pool.client.release).toHaveBeenCalledWith(true);
});
test('normal business SQL never changes lock_timeout or borrows a dedicated client',async()=>{
  const pool=fakePool();
  await runStartupDdlWithLockTimeout(pool,'SELECT 42');
  expect(pool.query).toHaveBeenCalledWith('SELECT 42');
  expect(pool.connect).not.toHaveBeenCalled();
});
test('concurrent index runs outside a DDL transaction (not supported by SET LOCAL)',async()=>{
  const pool=fakePool();
  const sql='CREATE INDEX CONCURRENTLY idx_foo ON orders(status)';
  await runStartupDdlWithLockTimeout(pool,sql);
  expect(pool.query).toHaveBeenCalledWith(sql);
  expect(pool.connect).not.toHaveBeenCalled();
});
test('DO block with DDL uses a local lock timeout',async()=>{
  const pool=fakePool();
  const sql="DO $$ BEGIN ALTER TABLE orders ADD COLUMN IF NOT EXISTS pending_at TIMESTAMPTZ; END $$";
  await runStartupDdlWithLockTimeout(pool,sql);
  expect(pool.calls).toEqual(['BEGIN',"SET LOCAL lock_timeout = '3s'",sql,'COMMIT']);
});
test('missing dedicated client is fatal outside Jest, never silently unprotected',async()=>{
  const original=process.env.NODE_ENV;
  try{
    process.env.NODE_ENV='production';
    await expect(runStartupDdlWithLockTimeout({query:jest.fn()},ALTER)).rejects.toThrow('STARTUP_DDL_DEDICATED_CLIENT_REQUIRED');
  }finally{process.env.NODE_ENV=original;}
});
