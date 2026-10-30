'use strict';
// Read-only extraction of named physical relations from the checked-in
// pg_dump schema. Not a live DB check and never a claim of complete migrations.
function canonicalTables(text){
 const source=String(text),tables=new Set();
 const re=/^\s*CREATE\s+(?:UNLOGGED\s+|FOREIGN\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(?:"([a-z_][\w$]*)"|([a-z_][\w$]*))\s*(?:\(|PARTITION\s+OF\b)/gim;
 for(const m of source.matchAll(re))tables.add((m[1]||m[2]).toLowerCase());
 return tables;
}
function classifySchemaTarget(row,tables){
 const physical=Boolean(row.table&&tables.has(row.table));
 return {...row,physicalTableDeclared:physical,
  schemaEvidence:!row.table?'DYNAMIC_TARGET_UNKNOWN':
   physical?'IN_CHECKED_IN_CANONICAL_SCHEMA':'NOT_IN_CHECKED_IN_SCHEMA_REVIEW',
 };
}
module.exports={canonicalTables,classifySchemaTarget};
