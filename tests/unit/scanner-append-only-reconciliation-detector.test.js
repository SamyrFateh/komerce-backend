'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {scanAppendOnlyReconciliationRisk}=require('../../scripts/audits/lib/reconciliation-detectors');
test('generic association candidate from an unrelated snapshot-linked promotion writer',()=>{
 const src=[
  'async function promoteLinks(client, sourceRows) {',
  '  for (const row of sourceRows) {',
  '    await client.query("INSERT INTO variant_asset_pairs (variant_id, asset_id) VALUES ($1, $2) ON CONFLICT (variant_id, asset_id) DO NOTHING", [row.variant_id, row.asset_id]);',
  '  }',
  '}'
 ].join('\n');
 const out=scanAppendOnlyReconciliationRisk(src,'src/different-domain.js');
 assert.equal(out.length,1);
 assert.equal(out[0].table,'variant_asset_pairs');
 assert.equal(out[0].function,'promoteLinks');
 assert.equal(out[0].kind,'APPEND_ONLY_ASSOCIATION_REPLAY_RISK');
});
test('reconciliation that explicitly deletes older associations is not flagged',()=>{
 const src=[
  'async function refreshLinks(client, rows) {',
  '  await client.query("DELETE FROM team_members WHERE team_id=$1", [id]);',
  '  for (const row of rows) {',
  '    await client.query("INSERT INTO team_members (team_id, member_id) VALUES ($1,$2) ON CONFLICT (team_id,member_id) DO NOTHING", [id,row.member_id]);',
  '  }',
  '}'
 ].join('\n');
 assert.equal(scanAppendOnlyReconciliationRisk(src,'src/team.js').length,0);
});
test('deduplicated unique-event insert is not a join-table reconciliation',()=>{
 const src=[
  'async function importEvents(client, events) {',
  '  for (const event of events) {',
  '    await client.query("INSERT INTO audit_inbox (event_id, name) VALUES ($1,$2) ON CONFLICT (event_id) DO NOTHING", [event.id,event.name]);',
  '  }',
  '}'
 ].join('\n');
 assert.equal(scanAppendOnlyReconciliationRisk(src,'src/events.js').length,0);
});
test('SQL only in comments does not trigger an alert',()=>{
 const src=[
  '/* async function promoteLinks(x) {',
  ' INSERT INTO assignment_pairs (actor_id, project_id) VALUES ($1,$2)',
  ' ON CONFLICT (actor_id,project_id) DO NOTHING',
  '} */',
  'async function promoteLinks(){return 1;}'
 ].join('\n');
 assert.equal(scanAppendOnlyReconciliationRisk(src,'src/comment.js').length,0);
});
test('same detector identifies the real product-to-image association site',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const src=fs.readFileSync(path.join(__dirname,'../../services/catalog-promotion.js'),'utf8');
 const hits=scanAppendOnlyReconciliationRisk(src,'services/catalog-promotion.js');
 assert.ok(hits.some(x=>x.table==='product_sku_media'));
});
