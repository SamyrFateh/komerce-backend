#!/usr/bin/env node
/**
 * INVENTAIRE DES SURFACES — Extracteur 0A (LOT 0A)
 * ==================================================================
 * Reproductible comme golden-cdr et variables-inventory. Scanne les
 * vues admin (public/dashboards/admin/js/**View.js), recense les appels
 * API (KmcApi.method() + fetch() bruts), les CLASSE lecture/écriture, et
 * en déduit la nature réelle de chaque surface :
 *   - écrit 0 fois       → Dashboard (nature A, observation)
 *   - écrit              → Workspace (nature B, exécution)
 *   - lit ET écrit       → MIXTE (à scinder : dashboard + workspace)
 *
 * Croise avec les verdicts déjà figés en doctrine Partie III
 * (destination cible + KEEP/MERGE/REBUILD/DELETE).
 *
 *   node tools/surfaces-inventory/inventory-0a.js [--root <repo>] [--json]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = (() => { const i = process.argv.indexOf('--root'); return i >= 0 ? process.argv[i + 1] : path.resolve(__dirname, '../..'); })();
const AS_JSON = process.argv.includes('--json');
const VIEWS_DIR = path.join(ROOT, 'public', 'dashboards', 'admin', 'js');

// Verbes de LECTURE (préfixe de méthode KmcApi). Tout le reste = écriture.
const READ_PREFIXES = ['get', 'list', 'load', 'search', 'fetch', 'stats', 'count', 'sim'];

// Verdicts figés — doctrine DOCTRINE_ADMIN_DASHBOARDS.md Partie III.
// nature attendue (A/B/C/D), destination cible, verdict.
const VERDICTS = {
  SanteView:           ['A', 'Pilotage (base)',            'KEEP-base'],
  PilotageView:        ['A', 'Pilotage',                   'MERGE'],
  ControlTowerView:    ['A', 'Pilotage (top signals)',     'MERGE'],
  SalesView:           ['A', 'Commerce',                   'REBUILD'],
  ClientsView:         ['A/C', 'Commerce + Client 360',    'SPLIT'],
  OrdersLogisticsView: ['A', 'Opérations',                 'MERGE'],
  EconomicView:        ['A', 'Finance / Économie',         'MERGE'],
  CostingView:         ['A', 'Finance / Économie + Pricing WS', 'MERGE'],
  PilotageFinView:     ['A', 'Finance',                    'MERGE'],
  InvoicesView:        ['B', 'Finance/Compta WS',          'MERGE'],
  AccountingView:      ['B', 'Finance/Compta WS',          'MERGE'],
  HubRelaisView:       ['B', 'Operations/Hub-Relais WS',   'KEEP'],
  InventoryView:       ['B', 'Operations/Hub-Relais WS',   'MERGE'],
  TransitaireView:     ['B', 'Expéditions & Douane WS',    'MERGE'],
  CustomsView:         ['B', 'Expéditions & Douane WS',    'KEEP'],
  CategoriesView:      ['B', 'Catalogue WS',               'MERGE'],
  ProductsView:        ['B', 'Catalogue WS (+ Product 360)', 'MERGE'],
  CatalogApprovalView: ['B', 'Catalogue WS',               'MERGE'],
  SourcingView:        ['B', 'Sourcing WS',                'KEEP'],
  SourcingScannerView: ['B', 'Sourcing WS',                'MERGE'],
  SuppliersView:       ['B', 'Sourcing WS',                'MERGE'],
  PricingView:         ['B', 'Pricing WS',                 'KEEP'],
  PricingWorkshopView: ['B', 'Pricing WS',                 'MERGE'],
  PricingStrategyView: ['B', 'Pricing WS',                 'MERGE'],
  EconomicFlowView:    ['B', 'Pricing WS (carte éco)',     'MERGE'],
  SimulatorView:       ['B', 'Pricing WS (simulation)',    'MERGE'],
  ActionCenterView:    ['A', 'Action Center (base)',       'KEEP-base'],
  ProblemsView:        ['A', 'Action Center',              'REBUILD ⚠️ recompute JS'],
  SharedCartsView:     ['B', 'facette Client 360 / Commerce', 'MERGE'],
  SettingsView:        ['—', 'DISSOLVE (taxes/dims DELETE, règles → domaines)', 'DISSOLVE'],
};

function isRead(method) {
  const m = method.toLowerCase();
  return READ_PREFIXES.some(p => m.startsWith(p));
}

function walkViews() {
  const files = [];
  const scan = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) scan(p);
      else if (/View\.js$/.test(e.name)) files.push(p);
    }
  };
  scan(VIEWS_DIR);
  // dédup par nom de fichier (ClientsView existe en double : js/ et js/views/)
  const seen = new Map();
  for (const f of files) { const b = path.basename(f); if (!seen.has(b)) seen.set(b, f); }
  return [...seen.values()];
}

function analyze(file) {
  const txt = fs.readFileSync(file, 'utf8');
  const name = path.basename(file, '.js');
  // Appels KmcApi
  const kmc = [...txt.matchAll(/KmcApi\.([a-zA-Z]+)\(/g)].map(m => m[1]);
  // méthodes HTTP d'écriture, où qu'elles soient (fetch inline OU opts OU apiFetch)
  const httpWrites = [...txt.matchAll(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/g)].map(m => m[1]);
  const anyFetchCount = (txt.match(/fetch\(/g) || []).length;
  const usesApiFetch = /\bapiFetch\(/.test(txt);
  const bypassesKmcApi = anyFetchCount > 0 || usesApiFetch;   // n'utilise pas (que) KmcApi

  const reads = [...new Set(kmc.filter(isRead))];
  const writes = [...new Set(kmc.filter(m => !isRead(m)))];
  const rawWrites = httpWrites;   // POST/PUT/PATCH/DELETE hors KmcApi
  const hasWrite = writes.length > 0 || rawWrites.length > 0;
  // lecture : appels get* KmcApi, ou un fetch/apiFetch de lecture (présence fetch sans que tout soit write)
  const hasRead = reads.length > 0 || (bypassesKmcApi && anyFetchCount > httpWrites.length);
  const classifiedCalls = reads.length + writes.length + httpWrites.length;
  const scannerGap = classifiedCalls === 0 && anyFetchCount > 0 && !usesApiFetch;

  const v = VERDICTS[name] || ['?', '(non mappée Partie III)', '?'];
  const doctrineB = v[0] === 'B';

  let natureReelle, note = '';
  if (scannerGap) { natureReelle = '? — scanner gap'; note = `fetch brut ×${anyFetchCount} non classé → passe manuelle`; }
  else if (hasWrite && hasRead) { natureReelle = 'MIXTE'; note = 'lecture + écriture → à scinder (dashboard + workspace)'; }
  else if (hasWrite) natureReelle = 'B — workspace';
  else { // lecture seule
    natureReelle = 'A — lecture seule';
    if (doctrineB) note = 'workspace-cible mais SANS écriture aujourd\'hui → exécution à CONSTRUIRE';
  }

  return {
    surface: name,
    reads_count: reads.length,
    writes: [...writes, ...[...new Set(rawWrites)].map(x => `http:${x}`)],
    writes_count: writes.length + rawWrites.length,
    raw_fetch_violation: rawWrites.length > 0,   // doctrine api-client : « zéro fetch brut »
    scanner_gap: scannerGap,
    bypasses_kmcapi: bypassesKmcApi,
    nature_reelle: natureReelle,
    nature_doctrine: v[0],
    destination: v[1],
    verdict: v[2],
    note,
  };
}

const rows = walkViews().map(analyze).sort((a, b) => a.surface.localeCompare(b.surface));

if (AS_JSON) { console.log(JSON.stringify({ root: ROOT, generated_at: new Date().toISOString(), surfaces: rows }, null, 2)); process.exit(0); }

const line = (c) => `| ${c.join(' | ')} |`;
console.log(`# Inventaire 0A — sortie brute de l'extracteur\n`);
console.log(`_Racine : ${ROOT} · ${rows.length} surfaces._\n`);
console.log(line(['Surface', 'Nat. réelle', 'Doct.', 'L', 'É', 'Verbes d\'écriture', 'Destination', 'Verdict', 'Note']));
console.log(line(['---', '---', '---', '---', '---', '---', '---', '---', '---']));
for (const r of rows) {
  const w = r.writes.length ? r.writes.join(', ') : '—';
  const flag = r.raw_fetch_violation ? ' ⚠️fetch' : '';
  console.log(line([r.surface, r.nature_reelle + flag, r.nature_doctrine, String(r.reads_count), String(r.writes_count), w, r.destination, r.verdict, r.note || '—']));
}

// Findings — 3 catégories distinctes, pas un fourre-tout
const mixtes  = rows.filter(r => r.nature_reelle === 'MIXTE');
const toBuild = rows.filter(r => r.note.includes('à CONSTRUIRE'));
const gaps    = rows.filter(r => r.scanner_gap);
const bypass  = rows.filter(r => r.bypasses_kmcapi);
console.log(`\n## Findings\n`);
console.log(`**① MIXTES (à scinder dashboard/workspace) : ${mixtes.length}** — ${mixtes.map(m => m.surface).join(', ') || '(aucune)'}`);
console.log(`\n**② Workspaces-cibles en LECTURE SEULE (exécution à construire) : ${toBuild.length}** — ${toBuild.map(m => m.surface).join(', ') || '(aucune)'}`);
console.log(`\n**③ Angles morts du scanner (fetch opts-based non résolu → passe manuelle) : ${gaps.length}** — ${gaps.map(m => m.surface).join(', ') || '(aucun)'}`);
console.log(`\n**④ Vues contournant KmcApi (fetch/apiFetch bruts, doctrine « zéro fetch brut ») : ${bypass.length}** — ${bypass.map(b => b.surface).join(', ') || '(aucune)'}`);
