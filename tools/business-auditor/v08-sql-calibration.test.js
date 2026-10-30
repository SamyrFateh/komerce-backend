'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {CASES}=require('./v08-sql-fixtures');
const {RULES}=require('./rules');
const {validateFixture,tableName}=require('./v08-sql-calibration');
test('all seven registered SQL detectors have paired independent temp fixtures',()=>{
 assert.equal(CASES.length,RULES.length);
 assert.deepEqual(CASES.map(x=>x.id).sort(),RULES.map(x=>x.id).sort());
 for(const c of CASES){const names=validateFixture(c);assert.ok(names.size>0);
  assert.ok(c.nominal.length>0&&c.adversarial.length>0);}
});
test('rejects attempts to write outside verified disposable temporary tables',()=>{
 const c=structuredClone(CASES[0]);
 c.adversarial=["INSERT INTO actual_orders VALUES ('unsafe')"];
 assert.throws(()=>validateFixture(c),/TEMP tables/);
 c.adversarial=["DELETE FROM order_items"];
 assert.throws(()=>validateFixture(c),/TEMP tables/);
});
test('forbid non-temp DDL, unknown rules, empty counterexample and duplicate schemas',()=>{
 assert.throws(()=>tableName('CREATE TABLE orders (id text)'),/TEMP required/);
 const c=structuredClone(CASES[0]);c.id='KBA-999';
 assert.throws(()=>validateFixture(c),/Unknown/);
 c.id=CASES[0].id;c.adversarial=[];
 assert.throws(()=>validateFixture(c),/Paired fixtures/);
 c.adversarial=CASES[0].adversarial.slice();c.tables.push(c.tables[0]);
 assert.throws(()=>validateFixture(c),/Duplicate/);
});
