#!/usr/bin/env node
'use strict';
/**
 * G2: exact Feature Card proof of the canonical non-null physical-location
 * chain orders.relais_id -> relais.id -> relais.market_id -> markets.id.
 * This is a DB/schema invariant across ALL writers, not an assertion that
 * market_id backfill was performed correctly or that authorization is valid.
 * The only writes are inside one rolled-back disposable local PG clone.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Client}=require('pg');
const {normalize}=require('./v35-invariant-census');
const {withClone}=require('./v16-cloned-database');
const {assertLocalTestTarget}=require('./cli');
const {evaluate:evaluateStock}=require('./v41-g2-local-stock-proof');
const FEATURE='features/market.feature.js';
const STATEMENTS=Object.freeze([
 'relais.market_id (M1b) est NOT NULL — un relais est un lieu physique, il ne peut pas exister sans marché',
 'orders.relais_id est NOT NULL dans le schéma (vérifié par exécution réelle, pas supposé) — aucune commande sans relais n\'est possible, le backfill orders.market_id est donc total par construction'
]);
const RULES=Object.freeze([
 {table:'relais',column:'market_id',constraint:'relais_market_id_fkey',
  references:'markets',refColumn:'id'},
 {table:'orders',column:'relais_id',constraint:'orders_relais_id_fkey',
  references:'relais',refColumn:'id'}
]);
const fail=s=>{throw Error('G2_RELAY_PROOF_ERROR: '+s)};
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function evaluate(raw){
 if(raw?.contract!=='komerce-market-relay-physical-raw/v46'||
    raw.rolledBack!==true||raw.joinResolved!==true||
    !Array.isArray(raw.rules)||raw.rules.length!==2)
  fail('physical rollback, two rules and valid market chain required');
 for(let i=0;i<RULES.length;i++){
  const expected=RULES[i],x=raw.rules[i];
  if(x?.table!==expected.table||x.column!==expected.column||
    x.constraint!==expected.constraint||x.notNull!==true||
    x.negativeSqlState!=='23502'||x.negativeColumn!==expected.column||
    x.unchangedAfterRejectedWrite!==true||
    x.validWriteObserved!==true||
    !new RegExp('^FOREIGN KEY \\('+expected.column+'\\) REFERENCES '+
      expected.references+'\\('+expected.refColumn+'\\)').test(
       String(x.foreignKeyDefinition||'')))
   fail('NOT NULL and exact FK with valid write, SQLSTATE 23502 and rollback required: '+expected.table+' details='+JSON.stringify({notNull:x.notNull,foreignKeyDefinition:x.foreignKeyDefinition,negativeSqlState:x.negativeSqlState,negativeColumn:x.negativeColumn,unchangedAfterRejectedWrite:x.unchangedAfterRejectedWrite,validWriteObserved:x.validWriteObserved}));
 }
 return {contract:'komerce-independent-relay-market-db-oracle/v46',
  verdict:'PASS_WITH_EVIDENCE',scope:'CANONICAL_DB_NON_NULL_AND_FK_CHAIN',
  supportedStatements:STATEMENTS,checks:2,allWritersConstrainedByDb:true,
  actualHistoricalMarketBackfillCertified:false};
}
async function physical(url){
 const client=new Client({connectionString:url,connectionTimeoutMillis:5000});
 await client.connect();
 let begun=false,rolledBack=false;
 try{
  const rules=[];
  for(const rule of RULES){
   const {rows:[col]}=await client.query(
    "SELECT a.attnotnull FROM pg_attribute a JOIN pg_class t ON t.oid=a.attrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname=$1 AND a.attname=$2 AND NOT a.attisdropped",
    [rule.table,rule.column]);
   const {rows:[fk]}=await client.query(
    "SELECT pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname=$1 AND c.conname=$2 AND c.contype='f' AND c.convalidated=true",
    [rule.table,rule.constraint]);
   rules.push({...rule,notNull:col?.attnotnull===true,
    foreignKeyDefinition:fk?.definition||null});
  }
  const {rows:[market]}=await client.query("SELECT id FROM markets WHERE code='KM' LIMIT 1");
  if(!market)fail('canonical market missing');
  const relay=crypto.randomUUID(),order=crypto.randomUUID();
  await client.query('BEGIN');begun=true;
  await client.query(
   "INSERT INTO relais(id,name,phone,address,market_id) VALUES($1,'KBA G2 physical location','+269100000','TEST',$2)",
   [relay,market.id]);
  await client.query(
   "INSERT INTO orders(id,reference,relais_id,market_id,total_kmf,payment_mode,status) VALUES($1,$2,$3,$4,5000,'stripe_eur','confirmed')",
   [order,'G2-'+crypto.randomUUID().slice(0,12),relay,market.id]);
  for(let i=0;i<rules.length;i++){
   const x=rules[i],id=i===0?relay:order;
   const {rows:[before]}=await client.query(
    'SELECT '+x.column+' AS link FROM '+x.table+' WHERE id=$1',[id]);
   x.validWriteObserved=before?.link===(i===0?market.id:relay);
   await client.query('SAVEPOINT probe_'+i);
   let negativeSqlState=null,negativeColumn=null;
   try{await client.query('UPDATE '+x.table+' SET '+x.column+'=NULL WHERE id=$1',[id]);}
   catch(e){negativeSqlState=e.code||null;negativeColumn=e.column||null;}
   if(negativeSqlState)await client.query('ROLLBACK TO SAVEPOINT probe_'+i);
   const {rows:[after]}=await client.query(
    'SELECT '+x.column+' AS link FROM '+x.table+' WHERE id=$1',[id]);
   x.unchangedAfterRejectedWrite=after?.link===before?.link;
   x.negativeSqlState=negativeSqlState;x.negativeColumn=negativeColumn;
  }
  const {rows:[chain]}=await client.query(
   'SELECT o.relais_id AS relay, r.market_id AS relay_market, m.id AS resolved_market FROM orders o JOIN relais r ON r.id=o.relais_id JOIN markets m ON m.id=r.market_id WHERE o.id=$1',[order]);
  const joinResolved=chain?.relay===relay&&chain.relay_market===market.id&&
   chain.resolved_market===market.id;
  await client.query('ROLLBACK');begun=false;rolledBack=true;
  return {contract:'komerce-market-relay-physical-raw/v46',
   rules,joinResolved,rolledBack};
 }finally{
  if(begun)await client.query('ROLLBACK').catch(()=>{});
  await client.end();
 }
}
function amend(audit,ledger,census,proof,stockProof){
 const n=census.summary.declaredInvariants;
 if(audit?.contract!=='komerce-unified-business-logic-auditor/v35'||
    audit?.summary?.featureInvariantsDeclared!==n||
    audit?.summary?.featureInvariantsCertified!==1||
    audit?.semanticInvariantLedger?.summary?.semanticallyVerified!==1||
    ledger?.contract!=='komerce-semantic-invariant-ledger/v40'||
    ledger.summary?.semanticallyVerified!==1||
    ledger.rows?.filter(x=>x.exactAssertionVerified===true).length!==1||
    audit.exactSemanticProofs?.length!==1||
    audit.sha!==proof?.sha||audit.sha!==stockProof?.sha||
    evaluateStock(stockProof.raw).verdict!=='PASS_WITH_EVIDENCE'||
    audit.exactSemanticProofs[0].invariantId!==stockProof.invariantId||
    proof.oracle?.verdict!=='PASS_WITH_EVIDENCE'||
    proof.oracle?.contract!=='komerce-independent-relay-market-db-oracle/v46'||
    proof.cloneDropped!==true||proof.matches?.length!==2)
  fail('G2 prior validated stock proof or current source ledger missing');
 const prior=census.all.find(x=>x.id===stockProof.invariantId);
 if(!prior||prior.sourceHash!==stockProof.sourceFileHash||
    prior.sha!==stockProof.statementSha)fail('previous G2 statement drifted');
 const seen=new Set([stockProof.invariantId]);
 const copy=structuredClone(audit),nextLedger=structuredClone(ledger);
 for(let i=0;i<2;i++){
  const match=proof.matches[i];
  const canonical=census.all.filter(x=>x.source===FEATURE&&x.statement===STATEMENTS[i]);
  if(canonical.length!==1||match.invariantId!==canonical[0].id||
     seen.has(match.invariantId)||match.statementHash!==canonical[0].sha||
     match.sourceHash!==canonical[0].sourceHash)
   fail('Feature Card exact statement changed or duplicate proof');
  seen.add(match.invariantId);
  const row=nextLedger.rows.find(x=>x.id===match.invariantId);
  if(!row||row.verdict!=='NOT_COVERED'||row.exactAssertionVerified!==false||
     row.sourceHash!==match.sourceHash||row.statementHash!==match.statementHash)
   fail('semantic ledger statement identity drift');
  row.verdict='CERTIFIED_DB_CONSTRAINT';
  row.reason='PG_NOT_NULL_FK_AND_SQLSTATE_23502_INDEPENDENT_NEGATIVE_CONTROL';
  row.semanticOracleId=proof.oracle.contract;
  row.exactAssertionVerified=true;row.physicalProofSha=audit.sha;
  const domain=nextLedger.byDomain.find(x=>x.domain===canonical[0].domain);
  const auditDomain=copy.semanticInvariantLedger.byDomain.find(x=>x.domain===canonical[0].domain);
  if(!domain||!auditDomain)fail('Feature Card source domain unavailable');
  domain.certified++;domain.notCovered--;
  auditDomain.certified++;auditDomain.notCovered--;
  copy.exactSemanticProofs.push({
   invariantId:match.invariantId,sourceFile:FEATURE,
   statementHash:match.statementHash,sourceFileHash:match.sourceHash,
   scope:'CANONICAL_DB_NON_NULL_AND_FK_CHAIN_ONLY',
   physicalConstraint:RULES[i].constraint,
   provenanceSha:audit.sha,cloneDropped:true,verdict:'PASS_WITH_EVIDENCE'});
 }
 const certified=3,ratio=Number((100*certified/n).toFixed(6));
 for(const x of [nextLedger.summary,copy.semanticInvariantLedger.summary]){
  x.semanticallyVerified=certified;x.notCovered=n-certified;
  x.coveragePercent=ratio;x.gate='PARTIAL_VERIFIED';
 }
 copy.invariantCoverage.featureCardInvariantsCertified=certified;
 copy.invariantCoverage.summary.coveragePercent=ratio;
 copy.summary.featureInvariantsCertified=certified;
 copy.summary.invariantCoveragePercent=ratio;
 copy.summary.featureCardSemanticOracleMappingComplete=false;
 if(nextLedger.rows.filter(x=>x.exactAssertionVerified===true).length!==certified||
    nextLedger.byDomain.reduce((s,x)=>s+x.certified,0)!==certified)
  fail('G2 reconciled count mismatch');
 return {audit:copy,ledger:nextLedger};
}
async function run({auditPath,out,stockProofPath}={},env=process.env){
 assertLocalTestTarget(env);
 if(!auditPath||!out||!stockProofPath)
  fail('usage --audit FULL/unified-audit.json --stock-proof G2/g2-exact-invariant-proof.json --out DIR');
 const sha=env.GITHUB_SHA;
 const audit=JSON.parse(fs.readFileSync(path.resolve(auditPath),'utf8'));
 if(!/^[a-f0-9]{40}$/.test(sha||'')||audit.sha!==sha)
  fail('immutable source SHA required');
 const dir=path.dirname(path.resolve(auditPath));
 const ledgerPath=path.join(dir,'invariant-semantic-ledger.json');
 const ledger=JSON.parse(fs.readFileSync(ledgerPath,'utf8'));
 const stock=JSON.parse(fs.readFileSync(path.resolve(stockProofPath),'utf8'));
 const census=normalize(),matches=STATEMENTS.map(statement=>{
  const m=census.all.filter(x=>x.source===FEATURE&&x.statement===statement);
  if(m.length!==1)fail('Feature Card invariant missing or ambiguous: '+statement);
  return {invariantId:m[0].id,statementHash:m[0].sha,sourceHash:m[0].sourceHash};
 });
 const cloned=await withClone(env,url=>physical(url));
 if(cloned.cloneCreated!==true||cloned.cloneDroppedAfterExecution!==true)
  fail('PG clone not dropped');
 const oracle=evaluate(cloned.result),proof={
  contract:'komerce-g2-market-relay-proof/v46',sha,source:FEATURE,matches,
  cloneDropped:true,raw:cloned.result,oracle};
 const second=evaluate(proof.raw);
 if(JSON.stringify(second)!==JSON.stringify(oracle))fail('independent oracle drift');
 const revised=amend(audit,ledger,census,proof,stock);
 const output=path.resolve(out);fs.mkdirSync(output,{recursive:true});
 fs.writeFileSync(path.join(output,'g2-market-relay-proof.json'),JSON.stringify(proof,null,2)+'\n');
 // Write the two reconciled reports only after all strict checks have passed.
 fs.writeFileSync(path.resolve(auditPath),JSON.stringify(revised.audit,null,2)+'\n');
 fs.writeFileSync(ledgerPath,JSON.stringify(revised.ledger,null,2)+'\n');
 fs.writeFileSync(path.join(output,'g2-market-relay-summary.md'),[
  '# G2 exact database constraints','','- SHA: '+sha,
  '- Existing local_stock CHECK proof: 1',
  '- Relay market_id NOT NULL and FK: PASS (23502 and unchanged row)',
  '- Orders relais_id NOT NULL and FK: PASS (23502 and unchanged row)',
  '- Canonical order → relay → market chain resolved: PASS',
  '- Total exact DB assertions: **3/'+census.summary.declaredInvariants+'**',
  '- Coverage: '+revised.audit.summary.invariantCoveragePercent+'%',
  '- Finance, sourcing, authorization, logistics business logic NOT certified',
  '- Original market_id backfill historical correctness NOT certified',
  '- Release G2 completeness: **NO_GO**',''].join('\n'));
 console.log('BUSINESS_AUDIT_G2_RELAY '+JSON.stringify({
  sha,declared:census.summary.declaredInvariants,certified:3,
  coveragePercent:revised.audit.summary.invariantCoveragePercent,
  cloneDropped:true,gate:'PARTIAL_VERIFIED'}));
 return {proof,...revised};
}
function parse(a){
 const o={};
 for(let i=0;i<a.length;i+=2){
  if(!['--audit','--out','--stock-proof'].includes(a[i])||!a[i+1])
   fail('usage --audit PATH --stock-proof PATH --out DIRECTORY');
  o[a[i]==='--audit'?'auditPath':a[i]==='--stock-proof'?'stockProofPath':'out']=a[i+1];
 }
 return o;
}
if(require.main===module)run(parse(process.argv.slice(2))).catch(e=>{
 console.error(e.stack||e.message);process.exitCode=2});
module.exports={STATEMENTS,RULES,evaluate,physical,amend,run,parse};
