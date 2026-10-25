#!/usr/bin/env node
'use strict';
/**
 * Schema-guided, READ ONLY scan for INSERT statements that omit a physically
 * NOT NULL column with no SQL DEFAULT/IDENTITY/GENERATED value.
 *
 * Emits REVIEW candidates, NEVER a bug verdict. BEFORE INSERT triggers,
 * dynamically constructed SQL and application-specific table partitions may
 * make apparently missing values valid. Verify on actual route/service.
 *
 * Usage: node scripts/audits/sql-required-column-detector.js [--out DIR]
 * Only PostgreSQL CI (DATABASE_URL) is needed. Does not run source services.
 */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {Client}=require('pg');
const args=process.argv.slice(2),flag=(n,v)=>{let i=args.indexOf(n);return i<0?v:args[i+1];};
const OUT=path.resolve(flag('--out','audit-results/schema-guided'));
const rows=cp.execFileSync('git',['ls-files','-z'],{encoding:'utf8',maxBuffer:100*1024*1024}).split('\0').filter(Boolean);
const paths=rows.filter(p=>/^(?:services|routes|bootstrap)\//.test(p)&&/\.(?:js|cjs|mjs|ts)$/.test(p));
const clean=s=>s.replace(/\/\*[\s\S]*?\*\//g,v=>v.replace(/[^\n]/g,' ')).replace(/(^|[ \t])\/\/[^\n]*/gm,v=>v.replace(/[^\n]/g,' '));
const regex=/\bINSERT\s+INTO\s+(?:(?:public)\.)?([a-z][a-z0-9_]*)\s*\(([a-z0-9_,\s"]{3,1200})\)\s*VALUES\s*\(/gi;
const comments=[];
for(const file of paths){
 let text;
 try{text=fs.readFileSync(file,'utf8');}catch{continue;}
 const body=clean(text);
 for(const match of body.matchAll(regex)){
  const table=match[1].toLowerCase();
  const columns=match[2].split(',').map(x=>x.trim().replace(/^"|"$/g,'').toLowerCase()).filter(Boolean);
  // Avoid regex match across long unrelated statements or invalid lists.
  if(!columns.length||columns.some(c=>!/^[a-z][a-z0-9_]*$/.test(c)))continue;
  comments.push({file,table,columns,line:body.slice(0,match.index).split('\n').length});
 }
}
async function main(){
 if(!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
 const client=new Client({connectionString:process.env.DATABASE_URL});
 await client.connect();
 try{
  await client.query('BEGIN READ ONLY');
  const {rows:schema}=await client.query(
   "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND is_nullable='NO' AND column_default IS NULL AND is_identity='NO' AND is_generated='NEVER' AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE')"
  );
  const byTable=new Map();
  for(const row of schema){
   if(!byTable.has(row.table_name))byTable.set(row.table_name,[]);
   byTable.get(row.table_name).push(row.column_name);
  }
  const findings=[],passed=[];
  for(const c of comments){
   const required=byTable.get(c.table);
   if(!required)continue;
   const missing=required.filter(x=>!c.columns.includes(x));
   const item={...c,required,missing};
   if(missing.length)findings.push({...item,kind:'SQL_INSERT_MISSING_REQUIRED_COLUMNS',status:'STATIC_REVIEW'});
   else passed.push(item);
  }
  const histogram={};for(const f of findings)histogram[f.table]=(histogram[f.table]||0)+1;
  const summary={
   scannedRuntimeFiles:paths.length,
   insertLiteralValuesPatterns:comments.length,
   schemaResolvedInsertPatterns:findings.length+passed.length,
   missingColumnReviewSignals:findings.length,
   distinctFiles:new Set(findings.map(x=>x.file)).size,
   distinctTables:Object.keys(histogram).length,
   byTable:Object.fromEntries(Object.entries(histogram).sort((a,b)=>b[1]-a[1])),
   limitation:'Static REVIEW only: triggers can populate missing values; SQL assembled dynamically or INSERT SELECT not fully analyzed. Actual API+PostgreSQL proof required to mark bugs.'
  };
  fs.mkdirSync(OUT,{recursive:true});
  fs.writeFileSync(path.join(OUT,'findings.json'),JSON.stringify(findings,null,2)+'\n');
  fs.writeFileSync(path.join(OUT,'summary.json'),JSON.stringify(summary,null,2)+'\n');
  fs.writeFileSync(path.join(OUT,'controls.json'),JSON.stringify(passed,null,2)+'\n');
  console.log('SQL_REQUIRED_COLUMN_SCAN '+JSON.stringify(summary));
  console.log('SQL_REQUIRED_COLUMN_TOP '+JSON.stringify(findings.slice(0,50).map(f=>({file:f.file,line:f.line,table:f.table,missing:f.missing}))));
  const confirmedRisk=findings.filter(x=>x.file==='routes/parcels.js'&&x.table==='parcel_items');
  if(!confirmedRisk.some(x=>x.missing.includes('product_id')))throw Error('SQL schema scanner failed to find verified missing parcel_items.product_id');
  await client.query('ROLLBACK');
 }finally{await client.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
