'use strict';
const assert = require('node:assert/strict');
const { inspect } = require('../../scripts/recette/rct1-checkout-readiness');
(async()=>{
  const sql = [];
  const client = {
    async query(query) {
      sql.push(query);
      if (query.includes('FROM products')) return {rows:[{product_ref:'RCT1-P1',is_active:false,is_available:false}]};
      if (query.includes('FROM relais')) return {rows:[{id:'relay-id',market_code:'KM',market_status:'ACTIVE'}]};
      if (query.includes('FROM orders')) return {rows:[]};
      return {rows:[]};
    },
    release(){}
  };
  const result = await inspect({db:{pool:{connect:async()=>client}}});
  assert.deepEqual(result.missing_products,['RCT1-P2','RCT1-P3','RCT1-P4','RCT1-P5']);
  assert.deepEqual(result.missing_markets_with_active_relay,['CM','CG']);
  assert.equal(result.checkout_apply_allowed,false);
  assert.equal(sql[0],'BEGIN READ ONLY');
  assert.equal(sql.at(-1),'ROLLBACK');
  assert.equal(sql.some(s => /INSERT|UPDATE|DELETE|COMMIT|FOR UPDATE/i.test(s)),false);
  process.stdout.write('RCT1 checkout readiness: read-only PASS\n');
})().catch(e=>{console.error(e);process.exitCode=1});
