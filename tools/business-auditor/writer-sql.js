'use strict';
// Conservative lexical SQL mutation extraction from JS literals.
// No services loaded or run. Evidence does NOT imply executed SQL.
const crypto=require('node:crypto');
const MUTATION=/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|MERGE\s+INTO)\s+(?:(?:ONLY|IF\s+EXISTS|IF\s+NOT\s+EXISTS)\s+)*((?:(?:"[a-z_][\w$]*"|[a-z_][\w$]*)\s*\.\s*)?(?:"[a-z_][\w$]*"|[a-z_][\w$]*|\$\{[^}]*\}))/gi;
function normalizeTable(raw){
 const name=String(raw||'').replace(/"/g,'').replace(/\s+/g,'').toLowerCase();
 if(name.includes('$'+ '{'))return null;
 const base=name.split('.').pop();
 return /^[a-z_][\w$]*$/.test(base)?base:null;
}
function readLiterals(src){
 const out=[];const s=String(src);
 for(let i=0;i<s.length;){
  const ch=s[i],next=s[i+1];
  if(ch==='/'&&next==='/'){const pos=s.indexOf('\n',i+2);i=pos<0?s.length:pos;continue}
  if(ch==='/'&&next==='*'){const pos=s.indexOf('*/',i+2);i=pos<0?s.length:pos+2;continue}
  if(ch!=="'"&&ch!=='"'&&ch!=='\x60'){i++;continue}
  const q=ch,start=i;let value='',closed=false,dynamic=false;i++;
  for(;i<s.length;i++){
   if(s[i]==='\\'){if(i+1<s.length)value+=s[i]+s[++i];continue}
   if(s[i]===q){closed=true;i++;break}
   if(q==='\x60'&&s[i]==='$'&&s[i+1]==='{'){
    dynamic=true;value+='$'+'{DYNAMIC}';i+=2;let depth=1;
    while(i<s.length&&depth>0){if(s[i]==='{')depth++;else if(s[i]==='}')depth--;if(depth>0)i++}
    continue;
   }
   value+=s[i];
  }
  if(closed)out.push({value,start,dynamic});
 }
 return out;
}
function extractWrites(source,file){
 const result=[];
 for(const lit of readLiterals(source)){
  for(const hit of lit.value.matchAll(MUTATION)){
   const action=hit[1].replace(/\s+/g,' ').toUpperCase(),table=normalizeTable(hit[2]);
   const before=source.slice(Math.max(0,lit.start-150),lit.start);
   const direct=/(?:\.|\b)(?:query|execute|run)\s*\(\s*$/.test(before);
   const phrase=lit.value.slice(Math.max(0,hit.index-30),hit.index+hit[0].length+60).replace(/\s+/g,' ').slice(0,160);
   const key=[file,action,table||'?',phrase].join('|');
   const digest=crypto.createHash('sha256').update(key).digest('hex').slice(0,18);
   result.push({
    id:'KBA-W-'+digest,file,line:source.slice(0,lit.start+hit.index).split('\n').length,
    action,table,rawTarget:hit[2],dynamic:lit.dynamic||!table,
    binding:direct?'DIRECT_QUERY_ARGUMENT':'SQL_LITERAL_NOT_CALL_PROVEN',
    sqlExcerpt:phrase,executed:false,confirmedBug:false,
   });
  }
 }
 return result;
}
module.exports={readLiterals,extractWrites,normalizeTable};
