/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const file=path.resolve(__dirname,'../../scripts/recette/g6-negative-g5a-storefront-chromium.js');
const source=fs.readFileSync(file,'utf8');
function fixtureSql(){
 const start="const {rows}=await db.query(`";
 const end="`,[MARKET,ref,SCENARIO,BRANCH])";
 const a=source.indexOf(start,source.indexOf('async function productFixture()'));
 const b=source.indexOf(end,a+start.length);
 if(a<0||b<a)throw Error('G6_G5A_FIXTURE_SQL_NOT_FOUND');
 return source.slice(a+start.length,b);
}
// Detect mismatched SQL grouping before the ORDER BY, even when the test
// has no live PostgreSQL connection. A stage-run then proves real execution.
function checkParenBalance(sql){
 let depth=0,inQuote=false,afterWhere=false,beforeOrder=null;
 for(let i=0;i<sql.length;i++){
  const c=sql[i];
  if(c==="'"){
   if(inQuote&&sql[i+1]==="'"){i++;continue}
   inQuote=!inQuote;continue;
  }
  if(inQuote)continue;
  if(c==='(')depth++;
  if(c===')'){depth--;if(depth<0)throw Error('G6_G5A_SQL_PREMATURE_CLOSE');}
  if(sql.slice(i).startsWith('WHERE m.code=$1'))afterWhere=true;
  if(afterWhere&&beforeOrder===null&&sql.slice(i).startsWith('ORDER BY (p.product_ref='))beforeOrder=depth;
 }
 if(inQuote)throw Error('G6_G5A_SQL_UNCLOSED_QUOTE');
 return {depth,beforeOrder};
}
describe('G6-G5A negative product fixture — PostgreSQL syntax preflight',()=>{
 test('all N01/N02/N03/N05 predicates close before the outer ORDER BY',()=>{
  const sql=fixtureSql();
  expect(sql).toContain("($3='N01'");
  expect(sql).toContain("($3='N02'");
  expect(sql).toContain("($3='N03'");
  expect(sql).toContain("($3='N05'");
  expect(sql).toContain("ORDER BY (p.product_ref='KPR-000165')");
  expect(checkParenBalance(sql)).toEqual({depth:0,beforeOrder:0});
 });
 test('detects the exact accidental missing parenthesis observed on staging',()=>{
  const sql=fixtureSql().replace("\n   ))\n ORDER BY", "\n   )\n ORDER BY");
  expect(checkParenBalance(sql)).toEqual({depth:1,beforeOrder:1});
 });
});
