#!/usr/bin/env node
'use strict';
/**
 * G2 one EXACT statement-level proof: local-stock.qty_physical cannot become
 * negative, enforced by the canonical PostgreSQL CHECK across ALL writers.
 * This is a database-level invariant, NOT a proof of service business logic.
 * Each proof runs only on a disposable local PostgreSQL clone.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Client}=require('pg');
const {normalize}=require('./v35-invariant-census');
const {withClone}=require('./v16-cloned-database');
const {assertLocalTestTarget}=require('./cli');
const statement='qty_physical ne descend jamais sous zéro';
const feature='features/local-stock.feature.js';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const fail=s=>{throw Error('G2_EXACT_PROOF_TOOL_ERROR: '+s)};
function evaluate(raw){
 if(raw?.contract!=='komerce-local-stock-constraint-raw/v1'||
   raw.table!=='public.local_stock'||raw.constraint!=='local_stock_qty_non_negatif'||
   !/^CHECK\s*\(\(?qty_physical >= 0\)?\)$/.test(raw.constraintDefinition||'')||
   raw.negativeSqlState!=='23514'||
   raw.negativeConstraint!=='local_stock_qty_non_negatif'||
   raw.initialQuantity!==1||raw.positiveQuantity!==2||
   raw.quantityAfterRejectedWrite!==2||raw.rolledBack!==true)
  fail('DB CHECK, SQLSTATE 23514 and unchanged row required');
 return {contract:'komerce-independent-db-constraint-oracle/v1',
  verdict:'PASS_WITH_EVIDENCE',enforcedForAllWriters:true,
  sourceStatement:statement,table:raw.table,
  constraint:raw.constraint,validWrite:2,
  forbiddenWrite:-1,expectedSqlState:'23514'};
}
async function physical(url){
 const client=new Client({connectionString:url,connectionTimeoutMillis:5000});
 await client.connect();
 let begun=false,rolledBack=false;
 try{
  const {rows:[record]}=await client.query(
   "SELECT pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='local_stock' AND c.conname='local_stock_qty_non_negatif'");
  if(!record)fail('canonical DB constraint absent');
  const {rows:[market]}=await client.query("SELECT id FROM markets WHERE code='KM' LIMIT 1");
  if(!market)fail('canonical KM market missing');
  const product=crypto.randomUUID(),stock=crypto.randomUUID();
  await client.query('BEGIN');begun=true;
  await client.query("INSERT INTO products(id,name,price_kmf,stock) VALUES($1,'KBA G2 stock proof',5000,20)",[product]);
  await client.query('INSERT INTO local_stock(id,product_id,market_id,qty_physical) VALUES($1,$2,$3,1)',[stock,product,market.id]);
  await client.query('UPDATE local_stock SET qty_physical=2 WHERE id=$1',[stock]);
  await client.query('SAVEPOINT guard_probe');
  let sqlState=null,constraint=null;
  try{await client.query('UPDATE local_stock SET qty_physical=-1 WHERE id=$1',[stock]);}
  catch(e){sqlState=e.code;constraint=e.constraint;}
  if(sqlState)await client.query('ROLLBACK TO SAVEPOINT guard_probe');
  const {rows:[after]}=await client.query('SELECT qty_physical FROM local_stock WHERE id=$1',[stock]);
  await client.query('ROLLBACK');begun=false;rolledBack=true;
  return {contract:'komerce-local-stock-constraint-raw/v1',
   table:'public.local_stock',constraint:'local_stock_qty_non_negatif',
   constraintDefinition:record.definition,
   initialQuantity:1,positiveQuantity:2,
   negativeSqlState:sqlState,negativeConstraint:constraint,
   quantityAfterRejectedWrite:after?.qty_physical,
   rolledBack};
 }finally{
  if(begun)await client.query('ROLLBACK').catch(()=>{});
  await client.end();
 }
}
function amend(audit,census,proof){
 const invariant=census.all.filter(x=>x.source===feature&&x.statement===statement);
 if(invariant.length!==1||proof?.sourceFile!==feature||
    proof.statementSha!==invariant[0].sha||
    proof.sourceFileHash!==invariant[0].sourceHash||
    proof.oracle?.verdict!=='PASS_WITH_EVIDENCE'||
    proof.oracle?.contract!=='komerce-independent-db-constraint-oracle/v1'||
    proof.cloneDropped!==true||
    proof.sha!==audit.sha||
    audit?.contract!=='komerce-unified-business-logic-auditor/v35'||
    audit.semanticInvariantLedger?.summary?.semanticallyVerified!==0||
    audit.summary?.featureInvariantsDeclared!==census.summary.declaredInvariants)
  fail('feature statement or unqualified source evidence');
 const covered=1,denom=census.summary.declaredInvariants;
 const ratio=Number((100*covered/denom).toFixed(6));
 const copy=structuredClone(audit);
 copy.invariantCoverage.featureCardInvariantsCertified=covered;
 copy.invariantCoverage.summary.coveragePercent=ratio;
 copy.summary.featureInvariantsCertified=covered;
 copy.summary.invariantCoveragePercent=ratio;
 copy.summary.featureCardSemanticOracleMappingComplete=false;
 copy.semanticInvariantLedger.summary.semanticallyVerified=covered;
 copy.semanticInvariantLedger.summary.notCovered=denom-covered;
 copy.semanticInvariantLedger.summary.coveragePercent=ratio;
 copy.semanticInvariantLedger.summary.gate='PARTIAL_VERIFIED';
 const row=copy.semanticInvariantLedger.byDomain.find(x=>x.domain===invariant[0].domain);
 if(!row)fail('domain source absent');
 row.certified=covered;row.notCovered-=covered;
 copy.exactSemanticProofs=[{
  invariantId:invariant[0].id,statementHash:invariant[0].sha,
  sourceFile:feature,sourceFileHash:invariant[0].sourceHash,
  scope:'DATABASE_CONSTRAINT_ALL_WRITERS_ONLY',
  physicalConstraint:proof.oracle.constraint,
  provenanceSha:audit.sha,cloneDropped:true,
  verdict:'PASS_WITH_EVIDENCE'}];
 return copy;
}
async function run({auditPath,out}={},env=process.env){
 assertLocalTestTarget(env);
 if(!auditPath||!out)fail('usage --audit FILE --out DIR');
 const census=normalize(),audit=JSON.parse(fs.readFileSync(path.resolve(auditPath),'utf8'));
 const sha=env.GITHUB_SHA;
 if(!/^[a-f0-9]{40}$/.test(sha||'')||audit.sha!==sha)
  fail('full physical source SHA must equal immutable CI checkout');
 const match=census.all.filter(x=>x.source===feature&&x.statement===statement);
 if(match.length!==1)fail('exact Feature Card invariant missing or ambiguous');
 const cloned=await withClone(env,url=>physical(url));
 if(!cloned.cloneCreated||!cloned.cloneDroppedAfterExecution)
  fail('disposable database clone teardown absent');
 const oracle=evaluate(cloned.result);
 const proof={contract:'komerce-g2-db-invariant-physical/v1',
  sha,sourceFile:feature,sourceFileHash:match[0].sourceHash,
  statementSha:match[0].sha,invariantId:match[0].id,
  cloneDropped:true,dbIsolation:'LOCAL_CANONICAL_POSTGRES_CLONE',
  raw:cloned.result,oracle};
 const independentlyRechecked=evaluate(proof.raw);
 if(JSON.stringify(independentlyRechecked)!==JSON.stringify(proof.oracle))
  fail('proof oracle does not correspond to physical evidence');
 const amended=amend(audit,census,proof);
 const directory=path.resolve(out);fs.mkdirSync(directory,{recursive:true});
 fs.writeFileSync(path.join(directory,'g2-exact-invariant-proof.json'),JSON.stringify(proof,null,2)+'\n');
 const target=path.resolve(auditPath),tmp=target+'.g2tmp';
 fs.writeFileSync(tmp,JSON.stringify(amended,null,2)+'\n');
 fs.renameSync(tmp,target);
 const ledgerPath=path.join(path.dirname(target),'invariant-semantic-ledger.json');
 const ledger=JSON.parse(fs.readFileSync(ledgerPath,'utf8'));
 const item=ledger.rows.find(x=>x.id===proof.invariantId);
 const d=ledger.byDomain.find(x=>x.domain===match[0].domain);
 if(ledger.contract!=='komerce-semantic-invariant-ledger/v40'||
    ledger.summary.semanticallyVerified!==0||!item||!d)
  fail('semantic ledger source not aligned with full audit');
 item.verdict='CERTIFIED_DB_CONSTRAINT';
 item.reason='PG_CHECK_SQLSTATE_23514_INDEPENDENT_NEGATIVE_CONTROL';
 item.semanticOracleId=oracle.contract;item.exactAssertionVerified=true;
 item.physicalProofSha=sha;
 ledger.summary.semanticallyVerified=1;
 ledger.summary.notCovered=ledger.summary.declared-1;
 ledger.summary.coveragePercent=amended.summary.invariantCoveragePercent;
 ledger.summary.gate='PARTIAL_VERIFIED';
 d.certified=1;d.notCovered--;
 fs.writeFileSync(ledgerPath,JSON.stringify(ledger,null,2)+'\n');
 fs.writeFileSync(path.join(directory,'g2-summary.md'),[
  '# G2 exact DB invariant proof','','- Source SHA: '+sha,
  '- Feature Card: '+feature,'- Statement: '+statement,
  '- Oracle: '+oracle.contract,'- DB CHECK: '+oracle.constraint,
  '- Positive update: 2, negative update: -1 rejected (SQLSTATE 23514)',
  '- Exact invariant certified: 1/'+census.summary.declaredInvariants,
  '- Coverage: '+amended.summary.invariantCoveragePercent+'%',
  '- G2 completeness: **NOT CERTIFIED** (remaining declarations uncovered)',
  '- No claim that the owner service or all business domains are certified',''].join('\n'));
 console.log('BUSINESS_AUDIT_G2_EXACT '+JSON.stringify({
  sha,certified:1,declared:census.summary.declaredInvariants,
  oracle:oracle.contract,cloneDropped:true,gate:'PARTIAL_VERIFIED'}));
 return {proof,amended};
}
if(require.main===module){
 const a=process.argv.slice(2),opts={};
 for(let i=0;i<a.length;i+=2){
  if(!['--audit','--out'].includes(a[i])||!a[i+1]){
   console.error('G2_EXACT_PROOF_TOOL_ERROR: --audit FILE --out DIR');process.exit(2);
  }
  opts[a[i]==='--audit'?'auditPath':'out']=a[i+1];
 }
 run(opts).catch(e=>{console.error('G2_EXACT_PROOF_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2});
}
module.exports={evaluate,amend,physical,run};
