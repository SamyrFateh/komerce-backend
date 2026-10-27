'use strict';
/**
 * Independently cross-check @komerce-arch source declarations with Feature
 * Card declarations. Does not require/evaluate JS Feature Cards.
 * "!" means declared feature owner; "~" technical writer, not owner.
 */
function archHeader(source){
 const block=String(source).match(/\/\*\*?[\s\S]{0,9000}?@komerce-arch[\s\S]*?\*\//);
 const header=block?.[0]||'';
 const pick=name=>{
  const re=new RegExp('^\\s*\\*\\s*@'+name+'\\s+([^\\r\\n]*)','m');
  return (header.match(re)||[])[1]?.trim()||null;
 };
 const written=pick('db-write');
 const declared=written&&!/^\(?none\)?$/i.test(written)?
  written.split(',').map(s=>s.trim().toLowerCase()).filter(x=>/^[a-z_][a-z0-9_]*$/.test(x)):[];
 return {domain:pick('domain'),role:pick('role'),layer:pick('layer'),
  declaredWrites:[...new Set(declared)].sort(),headerPresent:Boolean(block)};
}
function cardAuthorities(cards){
 const tableMap=new Map(),features=[];
 for(const {file,source} of cards){
  const id=file.replace(/^features\//,'').replace(/\.feature\.js$/,'');
  const declaredDomain=(String(source).match(/^\s*\*\s*@domain\s+([a-z][a-z0-9-]*)/m)||[])[1]||null;
  const block=String(source).match(/\bdb\s*:\s*\{\s*tables\s*:\s*\[([\s\S]*?)\]\s*,?\s*\}/);
  if(!block){features.push({id,domain:declaredDomain,declaredTables:0,found:false});continue}
  const refs=[...block[1].matchAll(/['"]([a-z][a-z0-9_]*):\s*(R|W|RW)([!~]?)['"]/g)];
  features.push({id,domain:declaredDomain,declaredTables:refs.length,found:true});
  for(const [,table,access,tag] of refs){
   if(!tableMap.has(table))tableMap.set(table,{
    owners:new Set(),technicalWriters:new Set(),writers:new Set(),readers:new Set()});
   const row=tableMap.get(table);
   if(access.includes('W')){
    row.writers.add(id);
    if(tag==='!')row.owners.add(id);
    if(tag==='~')row.technicalWriters.add(id);
   }
   if(access.includes('R'))row.readers.add(id);
  }
 }
 const authorities={};
 for(const [key,group] of [...tableMap].sort(([a],[b])=>a.localeCompare(b)))
  authorities[key]=Object.fromEntries(Object.entries(group)
   .map(([kind,values])=>[kind,[...values].sort()]));
 return {authorities,features};
}
function qualify(writes,metadata,authorities){
 return writes.map(candidate=>{
  const header=metadata[candidate.file]||{
   domain:null,role:null,declaredWrites:[],headerPresent:false};
  const ref=candidate.table?authorities[candidate.table]:null;
  const owners=ref?.owners||[],headerDeclared=header.declaredWrites.includes(candidate.table);
  const status=!candidate.table?'DYNAMIC_TABLE_UNRESOLVED':
   !ref?'NOT_IN_FEATURE_CARDS':
   !owners.length?'FEATURE_OWNER_NOT_EXPLICIT':
   owners.length>1?'CONFLICTING_EXPLICIT_OWNERS':
   header.domain&&owners.includes(header.domain)?
    'OWNER_DOMAIN_MATCH_DECLARATION':'CROSS_DOMAIN_WRITE_REVIEW';
  return {...candidate,declaredDomain:header.domain,declaredRole:header.role,
   headerWriteDeclared:headerDeclared,explicitOwners:owners,
   declaredFeatureWriters:ref?.writers||[],declaredTechnicalWriters:ref?.technicalWriters||[],
   ownerResolution:status,headerStatus:!header.headerPresent?'MISSING_HEADER':
    !headerDeclared?'TABLE_NOT_DECLARED_IN_HEADER':'HEADER_MATCH_NOT_AUTHORIZATION',
   evidence:'STATIC_SQL_TEXT_NOT_RUNTIME_BUG',ownerValidated:false};
 });
}
module.exports={archHeader,cardAuthorities,qualify};
