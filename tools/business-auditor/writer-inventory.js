'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {extractWrites}=require('./writer-sql');
const {archHeader,cardAuthorities,qualify}=require('./writer-ownership');
const {canonicalTables,classifySchemaTarget}=require('./writer-schema');
function sourceScope(file){
 if(/^(?:services|routes|middleware|controllers|workers|jobs|bootstrap|api|lib|utils)\//.test(file)||
    file==='db.js')return 'APPLICATION_CANDIDATE';
 if(/^scripts\//.test(file))return 'SCRIPTS_NOT_ASSUMED_RUNTIME';
 if(/^(?:tests|features|docs|tools|migrations|public)\//.test(file))
  return 'NON_RUNTIME_NOT_CERTIFIED';
 return 'UNCLASSIFIED';
}
function trackedJs(root){
 const p=cp.spawnSync('git',['ls-files','-z','--','*.js','*.cjs','*.mjs','*.ts'],{
  cwd:root,encoding:'utf8',timeout:20000,maxBuffer:25*1024*1024});
 if(p.status!==0||p.error)throw Error('Git inventory unavailable: '+String(p.stderr||p.error?.message||'unknown'));
 const files=p.stdout.split('\0').filter(Boolean).sort();
 if(!files.length)throw Error('No tracked JS/TS paths; refuse zero coverage');
 return files;
}
function buildWriterInventory(root,options={}){
 const read=options.read||fs.readFileSync,all=options.paths||trackedJs(root);
 const apps=all.filter(x=>sourceScope(x)==='APPLICATION_CANDIDATE');
 const files={},candidates=[];
 for(const file of apps){
  if(path.isAbsolute(file)||file.split(/[\\/]/).includes('..'))
   throw Error('Unsafe tracked source path: '+file);
  const src=read(path.join(root,file),'utf8');
  files[file]=archHeader(src);
  candidates.push(...extractWrites(src,file));
 }
 const paths=all.filter(x=>/^features\/[^/]+\.feature\.js$/.test(x));
 const features=cardAuthorities(paths.map(file=>({file,source:read(path.join(root,file),'utf8')})));
 const schema=canonicalTables(read(path.join(root,'docs/db/railway-live-schema.sql'),'utf8'));
 if(schema.size<80)throw Error('Checked-in PostgreSQL schema relation list unexpectedly empty');
 const qualified=qualify(candidates,files,features.authorities).map(x=>classifySchemaTarget(x,schema));
 const schemaBound=qualified.filter(x=>x.physicalTableDeclared);
 const nonSchema=qualified.filter(x=>!x.physicalTableDeclared);
 const tableMap=new Map();
 for(const x of schemaBound){
  const key=x.table||'<unresolved>';
  if(!tableMap.has(key))tableMap.set(key,{table:key,explicitOwners:x.explicitOwners,
   writers:new Set(),domains:new Set(),occurrences:0,directQueryCandidates:0,
   sourceHeaderGaps:0,crossDomainReview:0});
  const t=tableMap.get(key);t.occurrences++;
  t.writers.add(x.file);if(x.declaredDomain)t.domains.add(x.declaredDomain);
  if(x.binding==='DIRECT_QUERY_ARGUMENT')t.directQueryCandidates++;
  if(!x.headerWriteDeclared)t.sourceHeaderGaps++;
  if(x.ownerResolution==='CROSS_DOMAIN_WRITE_REVIEW')t.crossDomainReview++;
 }
 const tableSummary=[...tableMap.values()].map(x=>({
  ...x,writers:[...x.writers].sort(),domains:[...x.domains].sort(),
 })).sort((a,b)=>b.occurrences-a.occurrences||a.table.localeCompare(b.table));
 const gaps=new Set(['DYNAMIC_TABLE_UNRESOLVED','NOT_IN_FEATURE_CARDS',
  'FEATURE_OWNER_NOT_EXPLICIT','CONFLICTING_EXPLICIT_OWNERS','CROSS_DOMAIN_WRITE_REVIEW']);
 return {
  contract:'komerce-business-writer-inventory/v1',
  method:'LEXICAL_SQL_TEXT_X_ARCH_HEADERS_X_FEATURE_CARD_OWNER_MARKERS',
  coverage:{trackedJsFiles:all.length,applicationFiles:apps.length,
   excludedFiles:all.length-apps.length,excludedNotCertified:true,
   featureCardsRead:features.features.length,
   featureCardsWithDbDeclarations:features.features.filter(x=>x.found).length,
   canonicalSchemaTables:schema.size},
  summary:{candidateWrites:qualified.length,physicalTableCandidates:schemaBound.length,
   notProvenTableCandidates:nonSchema.length,
   possibleDirectQueryCalls:schemaBound.filter(x=>x.binding==='DIRECT_QUERY_ARGUMENT').length,
   tablesFound:tableSummary.length,ownershipReviewCandidates:schemaBound.filter(x=>gaps.has(x.ownerResolution)).length,
   crossDomainReviewCandidates:schemaBound.filter(x=>x.ownerResolution==='CROSS_DOMAIN_WRITE_REVIEW').length,
   headerMissingDeclarations:schemaBound.filter(x=>!x.headerWriteDeclared).length,
   runtimeWriteProofs:0,confirmedBusinessBugs:0},
  featureCards:features.features,tableSummary,writes:qualified,
  rejectedTargetSamples:nonSchema.slice(0,60).map(x=>({file:x.file,line:x.line,rawTarget:x.rawTarget,schemaEvidence:x.schemaEvidence})),
  rejectedTargetCount:nonSchema.length,
  limits:[
   'Lexical source parser: dynamic SQL, fragments, ORM calls, escaping and SQL from non-JS sources can be missed or misclassified',
   'A SQL literal need not execute; direct query syntax alone does not establish runtime reachability',
   'Counts are separated into checked-in schema table candidates and non-schema lexical candidates; this schema snapshot may omit future tables',
   'A Feature Card ! is a declared owner and ~ a declared technical writer, not proof of authority',
   'Cross-domain writers are candidates for owner review, not automatically forbidden',
   'Scripts, tests, public frontends, migrations and non-JS files are excluded from this runtime-candidate subset, not declared safe',
   'No source writer, SQL query, external service or production data was run',
  ],
 };
}
module.exports={buildWriterInventory,sourceScope,trackedJs};
