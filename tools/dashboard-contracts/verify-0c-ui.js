#!/usr/bin/env node
'use strict';

/**
 * LOT 0C-ui — harnais de couverture des contrats dashboards prioritaires.
 *
 * Source consommée : docs/DASHBOARDS_360.json (généré depuis les vues + KmcApi).
 * Source de preuve : docs/contract/DASHBOARDS_CONTRACTS_0C.json.
 *
 * Le harnais ne devine jamais une forme. Un contrat est soit PROVEN avec preuve
 * et champs top-level, soit UNKNOWN avec une raison explicite.
 *
 * Usage :
 *   node tools/dashboard-contracts/verify-0c-ui.js
 *   node tools/dashboard-contracts/verify-0c-ui.js --json
 *   node tools/dashboard-contracts/verify-0c-ui.js --require-proven
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const MAP_FILE = path.join(ROOT, 'docs/DASHBOARDS_360.json');
const REGISTRY_FILE = path.join(ROOT, 'docs/contract/DASHBOARDS_CONTRACTS_0C.json');

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function key(view, method) {
  return `${view}::${method}`;
}

function verify() {
  const map = loadJson(MAP_FILE);
  const registry = loadJson(REGISTRY_FILE);
  const views = new Set(registry.scope?.views || []);
  const edges = (map.callEdges || []).filter(e => views.has(e.view));
  const contracts = registry.contracts || [];
  const byKey = new Map(contracts.map(c => [key(c.view, c.method), c]));
  const edgeKeys = new Set(edges.map(e => key(e.view, e.method)));

  const missing = [];
  const stale = [];
  const mismatches = [];
  const invalid = [];

  for (const edge of edges) {
    const k = key(edge.view, edge.method);
    const c = byKey.get(k);
    if (!c) {
      missing.push({ view: edge.view, method: edge.method, endpoint: edge.route || null });
      continue;
    }

    if (c.http_method && edge.httpMethod && c.http_method !== edge.httpMethod) {
      mismatches.push({ key: k, field: 'http_method', consumed: edge.httpMethod, registry: c.http_method });
    }
    if (c.endpoint && edge.route && c.endpoint !== edge.route) {
      mismatches.push({ key: k, field: 'endpoint', consumed: edge.route, registry: c.endpoint });
    }
    if (edge.route && !c.endpoint) {
      mismatches.push({ key: k, field: 'endpoint', consumed: edge.route, registry: null });
    }

    if (!['PROVEN', 'UNKNOWN'].includes(c.status)) {
      invalid.push({ key: k, reason: `status invalide: ${c.status}` });
    } else if (c.status === 'PROVEN') {
      if (!Array.isArray(c.top_level_fields) || c.top_level_fields.length === 0) {
        invalid.push({ key: k, reason: 'PROVEN sans top_level_fields' });
      }
      if (!c.proof?.path || !c.proof?.type) {
        invalid.push({ key: k, reason: 'PROVEN sans preuve path/type' });
      } else if (!fs.existsSync(path.join(ROOT, c.proof.path))) {
        invalid.push({ key: k, reason: `preuve introuvable: ${c.proof.path}` });
      }
    } else if (!c.reason || c.reason.trim().length < 8) {
      invalid.push({ key: k, reason: 'UNKNOWN sans raison explicite' });
    }
  }

  for (const c of contracts) {
    const k = key(c.view, c.method);
    if (!edgeKeys.has(k)) stale.push({ view: c.view, method: c.method });
  }

  const provenEdges = contracts.filter(c => c.status === 'PROVEN' && edgeKeys.has(key(c.view, c.method)));
  const unknownEdges = contracts.filter(c => c.status === 'UNKNOWN' && edgeKeys.has(key(c.view, c.method)));
  const resolvedEndpoints = new Set(edges.filter(e => e.route).map(e => `${e.httpMethod} ${e.route}`));
  const provenEndpoints = new Set(provenEdges.map(c => `${c.http_method} ${c.endpoint || c.resolved_endpoint || '(unresolved)'}`));

  return {
    scope_views: [...views],
    consumed_edges: edges.length,
    registered_edges: contracts.filter(c => edgeKeys.has(key(c.view, c.method))).length,
    resolved_endpoints: resolvedEndpoints.size,
    proven_edges: provenEdges.length,
    proven_endpoints: provenEndpoints.size,
    unknown_edges: unknownEdges.length,
    missing,
    stale,
    mismatches,
    invalid,
    unknown: unknownEdges.map(c => ({
      view: c.view,
      method: c.method,
      endpoint: c.endpoint || c.resolved_endpoint || null,
      reason: c.reason,
    })),
  };
}

function printHuman(r) {
  console.log('LOT 0C-ui — contrats Pilotage/Finance');
  console.log(`Vues prioritaires : ${r.scope_views.length}`);
  console.log(`Appels consommés  : ${r.consumed_edges}`);
  console.log(`Appels enregistrés: ${r.registered_edges}`);
  console.log(`PROVEN             : ${r.proven_edges}`);
  console.log(`UNKNOWN explicites : ${r.unknown_edges}`);
  console.log(`Endpoints résolus  : ${r.resolved_endpoints}`);
  if (r.missing.length) console.log(`MISSING             : ${r.missing.length}`);
  if (r.stale.length) console.log(`STALE               : ${r.stale.length}`);
  if (r.mismatches.length) console.log(`MISMATCH            : ${r.mismatches.length}`);
  if (r.invalid.length) console.log(`INVALID             : ${r.invalid.length}`);
  if (r.unknown.length) {
    console.log('\nDette de preuve explicite :');
    for (const u of r.unknown) console.log(`- ${u.view}.${u.method} → ${u.endpoint || 'URL non résolue'} — ${u.reason}`);
  }
}

function main() {
  const args = new Set(process.argv.slice(2));
  const r = verify();
  if (args.has('--json')) console.log(JSON.stringify(r, null, 2));
  else printHuman(r);

  const structuralFailure = r.missing.length || r.stale.length || r.mismatches.length || r.invalid.length;
  if (structuralFailure) process.exit(1);
  if (args.has('--require-proven') && r.unknown_edges > 0) process.exit(2);
}

if (require.main === module) main();
module.exports = { verify };
