#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          market-guard-inventory
 * @domain        infrastructure
 * @layer         tooling
 * @criticality   medium
 * @inputs        docs/SECURITY_360.json (gardes par route), docs/komerce-arch-header-graph.json (autorité centrale lue par chaque fichier)
 * @outputs       inventaire route x garde legacy x autorité centrale (résumé, checklist ou JSON) — dérivé, jamais committé
 * @depends       scripts/gen-security-360.js, scripts/lib/security-guard-tokens.js
 * @used-by       npm run market:guard-inventory, PR D du Market Control Plane (liste de contrôle)
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      AGENTS.md (sorties dérivées non committées)
 * @impact-areas  governance, security
 * @version       2026-10-v1
 */
'use strict';

/**
 * Inventaire des routes protégées par les gardes legacy `require-market-scope`
 * (voir scripts/lib/security-guard-tokens.js), pour la PR D du Market Control
 * Plane : « un seul moteur d'autorisation ». Pour chaque route : les gardes
 * actuelles, les rôles admis et l'autorité centrale réellement lue par le
 * fichier (tables `*_global_access_grants`, d'après le graphe de headers).
 *
 *   EXPLICIT_CENTRAL : le fichier consulte une table d'autorisation centrale ;
 *   ROLE_ONLY        : aucune autorité centrale ; l'accès central se fait par rôle.
 *
 *   node scripts/market-guard-inventory.js              # résumé par fichier
 *   node scripts/market-guard-inventory.js --checklist  # une ligne par route
 *   node scripts/market-guard-inventory.js --json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function centralDomains(graph, file) {
  const domains = new Set();
  for (const edge of (graph && graph.edges) || []) {
    if (edge.from !== file) continue;
    const m = /^db:(\w+)_global_access_grants$/.exec(edge.to || '');
    if (m) domains.add(m[1]);
  }
  return Array.from(domains).sort();
}

function buildInventory({ security, graph }) {
  const byFile = new Map();
  for (const route of (security && security.routes) || []) {
    if (!route.marketGuards || !route.marketGuards.length) continue;
    if (!route.file) throw new Error(`route gardée sans fichier source : ${route.key} (relancer npm run security:360)`);
    if (!byFile.has(route.file)) byFile.set(route.file, []);
    byFile.get(route.file).push({ key: route.key, level: route.level, roles: route.roles, marketGuards: route.marketGuards });
  }
  const files = Array.from(byFile.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([file, routes]) => {
    const domains = centralDomains(graph, file);
    return {
      file,
      access: domains.length ? 'EXPLICIT_CENTRAL' : 'ROLE_ONLY',
      centralAuthority: domains,
      roles: Array.from(new Set(routes.flatMap(r => r.roles))).sort(),
      routes: routes.sort((a, b) => a.key.localeCompare(b.key)),
    };
  });
  const count = access => files.filter(f => f.access === access).reduce((n, f) => n + f.routes.length, 0);
  return {
    summary: {
      files: files.length,
      routes: files.reduce((n, f) => n + f.routes.length, 0),
      explicitCentralRoutes: count('EXPLICIT_CENTRAL'),
      roleOnlyRoutes: count('ROLE_ONLY'),
    },
    files,
  };
}

function authorityLabel(file) {
  return file.centralAuthority.length ? file.centralAuthority.join('+') : 'AUCUNE (accès par rôle)';
}

function renderSummary(inv) {
  const { summary } = inv;
  const out = [
    `Gardes legacy require-market-scope : ${summary.routes} routes dans ${summary.files} fichiers`,
    `  autorité centrale explicite : ${summary.explicitCentralRoutes} routes`,
    `  accès par rôle seulement    : ${summary.roleOnlyRoutes} routes  <- à trancher en PR D`,
    '',
  ];
  for (const f of inv.files) {
    out.push(`${f.access === 'ROLE_ONLY' ? '!' : ' '} ${f.file} · ${f.routes.length} route(s) · rôles ${f.roles.join('/')} · autorité centrale : ${authorityLabel(f)}`);
  }
  return out.join('\n');
}

function renderChecklist(inv) {
  const out = [renderSummary(inv), ''];
  for (const f of inv.files) {
    out.push(`## ${f.file} — ${authorityLabel(f)}`);
    for (const r of f.routes) {
      out.push(`- [ ] ${r.key} · rôles ${r.roles.join('/') || '—'} · avant : ${r.marketGuards.join('+')} · après : ___ · test de refus : ___ · comptes à autoriser : ___`);
    }
    out.push('');
  }
  return out.join('\n').trimEnd();
}

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
}

function main(args = process.argv.slice(2)) {
  const inv = buildInventory({
    security: readJson('docs/SECURITY_360.json'),
    graph: readJson('docs/komerce-arch-header-graph.json'),
  });
  if (args.includes('--json')) process.stdout.write(`${JSON.stringify(inv, null, 2)}\n`);
  else process.stdout.write(`${args.includes('--checklist') ? renderChecklist(inv) : renderSummary(inv)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`market-guard-inventory: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { buildInventory, centralDomains, main, renderChecklist, renderSummary };
