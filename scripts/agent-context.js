#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          agent-context-compiler
 * @domain        infrastructure
 * @layer         tooling
 * @criticality   high
 * @inputs        feature manifests, @komerce-arch headers, interventionIndex, git diff
 * @outputs       compact agent context projection
 * @depends       scripts/pr-enforcement-scope.js, docs/komerce-arch-header-graph.json
 * @used-by       coding agents, AGENTS.md
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/AGENT_TOKEN_ECONOMY.md
 * @impact-areas  governance, developer-workflow
 * @version       2026-10-v1
 */
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { classify, classifyDiff } = require('./pr-enforcement-scope');

const ROOT = path.resolve(__dirname, '..');
const FEATURE_ROOTS = [
  'features',
  'public/features',
  'public/dashboards/features',
  'public/boutique/features',
];

function argValue(args, flag, fallback = null) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

function norm(file) {
  return String(file || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function safeRead(relative) {
  try {
    return fs.readFileSync(path.join(ROOT, norm(relative)), 'utf8');
  } catch {
    return null;
  }
}

function git(args) {
  const r = cp.spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'git failed').trim());
  return String(r.stdout || '').trim();
}

function flattenFiles(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) flattenFiles(item, out);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) flattenFiles(item, out);
  } else if (typeof value === 'string' && value.trim()) {
    out.push(norm(value));
  }
  return out;
}

function featurePaths() {
  const found = [];
  for (const root of FEATURE_ROOTS) {
    const abs = path.join(ROOT, root);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs)) {
      if (name.endsWith('.feature.js')) found.push(norm(path.join(root, name)));
    }
  }
  return found.sort();
}

function loadFeatures() {
  return featurePaths().map(file => {
    const abs = path.join(ROOT, file);
    delete require.cache[require.resolve(abs)];
    const manifest = require(abs);
    return {
      file,
      manifest,
      ownedFiles: new Set(flattenFiles(manifest.files || {})),
    };
  });
}

function parseHeader(source) {
  const result = {};
  const useful = new Set([
    'role', 'domain', 'layer', 'criticality', 'owner',
    'doctrine', 'impact-areas', 'db-read', 'db-write',
  ]);
  for (const line of String(source || '').split(/\r?\n/).slice(0, 60)) {
    const m = line.match(/^\s*(?:\/\/|\/\*|\*)?\s*@([\w-]+)\s+(.+?)\s*$/);
    if (!m || !useful.has(m[1])) continue;
    result[m[1]] = m[2];
  }
  return result;
}

function loadGraph() {
  const raw = safeRead('docs/komerce-arch-header-graph.json');
  if (!raw) return { interventionIndex: {} };
  try {
    const parsed = JSON.parse(raw);
    return parsed && parsed.interventionIndex ? parsed : { interventionIndex: {} };
  } catch {
    return { interventionIndex: {} };
  }
}

function take(values, limit) {
  const list = Array.isArray(values) ? values.filter(Boolean) : [];
  if (list.length <= limit) return list;
  return [...list.slice(0, limit), `… +${list.length - limit}`];
}

function compact(value, max = 240) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function featureSummary(entry) {
  const f = entry.manifest || {};
  const authority = f.authority && typeof f.authority === 'object'
    ? Object.entries(f.authority).slice(0, 4).map(([k, v]) => `${k}=${compact(Array.isArray(v) ? v.join(', ') : v, 160)}`)
    : [];
  return {
    name: f.name || path.basename(entry.file, '.feature.js'),
    file: entry.file,
    owner: f.owner || null,
    service: compact(f.service, 280),
    perimeterIn: take(f.perimeter && f.perimeter.in, 4).map(v => compact(v, 180)),
    perimeterOut: take(f.perimeter && f.perimeter.out, 4).map(v => compact(v, 180)),
    authority,
    invariants: take(f.invariants, 8).map(v => compact(typeof v === 'string' ? v : v && v.statement, 220)),
  };
}

function resolveFeatureEntries(features, files, explicitNames) {
  const wanted = new Set((explicitNames || []).map(v => String(v).trim()).filter(Boolean));
  for (const file of files) {
    for (const entry of features) {
      if (entry.ownedFiles.has(file)) wanted.add(entry.manifest.name);
    }
  }
  return features.filter(entry => wanted.has(entry.manifest.name));
}

function relevantLedger(featureNames) {
  const raw = safeRead('.agent/LEDGER.md');
  if (!raw) return null;
  const parts = raw.split(/(?=^##\s+)/m).filter(Boolean);
  const active = parts.filter(part => /^##\s+.*\b(OUVERT|EN COURS)\b/im.test(part));
  const names = featureNames.map(v => String(v).toLowerCase());
  const relevant = active.find(part => names.some(name => part.toLowerCase().includes(name)));
  const chosen = relevant || (featureNames.length ? null : active[active.length - 1]);
  if (!chosen) return null;
  return compact(chosen.replace(/^##\s+/, ''), 700);
}

function scopeForFiles(files, base, head) {
  if (files.length) return classify(files);
  try {
    return classifyDiff(base || 'origin/main', head || 'HEAD');
  } catch {
    return classify([]);
  }
}

function gateHints(scope) {
  const hints = ['npm run pr:preflight'];
  if (scope.dashboard) hints.push('Dashboard Canonical gates');
  if (scope.boutique) hints.push('Boutique fast gates');
  if (scope.backend) hints.push('Related backend unit tests');
  if (scope.backendSource) hints.push('Global backend coverage threshold');
  if (scope.migrations) hints.push('Migration/schema gates');
  if (scope.dbRebuildRequired || scope.integrationRequired || scope.e2eApiRequired) {
    hints.push('From-scratch / integration / E2E API proof');
  }
  if (scope.governance) hints.push('Governance + Feature First gates');
  return hints;
}

function buildContext(options = {}) {
  const features = loadFeatures();
  let files = (options.files || []).map(norm).filter(Boolean);
  let scope = scopeForFiles(files, options.base, options.head);
  if (!files.length && Array.isArray(scope.changedFiles)) files = scope.changedFiles.slice();

  const explicitNames = options.features || [];
  const selected = resolveFeatureEntries(features, files, explicitNames);
  const graph = loadGraph();

  const headers = files.slice(0, 8).map(file => {
    const source = safeRead(file);
    const header = parseHeader(source);
    const entry = graph.interventionIndex && graph.interventionIndex[file];
    return {
      file,
      header,
      mustCheck: take(entry && entry.mustCheck, 8),
    };
  }).filter(item => Object.keys(item.header).length || item.mustCheck.length);

  const selectedNames = selected.map(entry => entry.manifest.name);
  return {
    files: take(files, 12),
    scope: {
      backend: Boolean(scope.backend),
      backendSource: Boolean(scope.backendSource),
      dashboard: Boolean(scope.dashboard),
      boutique: Boolean(scope.boutique),
      migrations: Boolean(scope.migrations),
      governance: Boolean(scope.governance),
      dbRebuildRequired: Boolean(scope.dbRebuildRequired),
      integrationRequired: Boolean(scope.integrationRequired),
      e2eApiRequired: Boolean(scope.e2eApiRequired),
    },
    features: selected.map(featureSummary),
    headers,
    ledger: relevantLedger(selectedNames),
    gates: gateHints(scope),
  };
}

function renderContext(model, maxChars = 6000) {
  const lines = [];
  const add = line => {
    const next = [...lines, line].join('\n');
    if (next.length > maxChars - 120) return false;
    lines.push(line);
    return true;
  };

  add('KOMERCE AGENT CONTEXT v1 — projection compacte, aucune nouvelle autorité');
  add(`scope: backend=${model.scope.backend} backendSource=${model.scope.backendSource} dashboard=${model.scope.dashboard} boutique=${model.scope.boutique} migrations=${model.scope.migrations} governance=${model.scope.governance}`);
  if (model.files.length) add(`files: ${model.files.join(', ')}`);

  for (const feature of model.features) {
    if (!add(`\n[feature ${feature.name}] owner=${feature.owner || '—'} · ${feature.file}`)) break;
    if (feature.service) add(`service: ${feature.service}`);
    if (feature.perimeterIn.length) add(`in: ${feature.perimeterIn.join(' | ')}`);
    if (feature.perimeterOut.length) add(`out: ${feature.perimeterOut.join(' | ')}`);
    if (feature.authority.length) add(`authority: ${feature.authority.join(' | ')}`);
    if (feature.invariants.length) add(`invariants: ${feature.invariants.join(' | ')}`);
  }

  for (const item of model.headers) {
    const h = item.header;
    if (!add(`\n[file ${item.file}] role=${h.role || '—'} domain=${h.domain || '—'} layer=${h.layer || '—'} criticality=${h.criticality || '—'}`)) break;
    if (h['db-write'] && h['db-write'] !== 'none') add(`db-write: ${compact(h['db-write'], 240)}`);
    if (h.doctrine) add(`doctrine: ${compact(h.doctrine, 240)}`);
    if (item.mustCheck.length) add(`mustCheck: ${item.mustCheck.join(', ')}`);
  }

  if (model.ledger) add(`\nledger actif pertinent: ${model.ledger}`);
  add(`\ngates: ${model.gates.join(' → ')}`);

  const body = lines.join('\n');
  const tokens = Math.ceil(body.length / 4);
  const footer = `\nbudget: ${body.length} chars ≈ ${tokens} tokens`;
  if (body.length + footer.length <= maxChars) return body + footer;
  return body.slice(0, Math.max(0, maxChars - 80)) + '\n… budget atteint';
}

function main() {
  const args = process.argv.slice(2);
  const filesArg = argValue(args, '--files', '');
  const featureArg = argValue(args, '--feature', '');
  const maxChars = Math.max(2000, Number(argValue(args, '--max-chars', '6000')) || 6000);
  const files = filesArg.split(',').map(norm).filter(Boolean);
  const features = featureArg.split(',').map(v => v.trim()).filter(Boolean);
  const model = buildContext({
    files,
    features,
    base: argValue(args, '--base', 'origin/main'),
    head: argValue(args, '--head', 'HEAD'),
  });

  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(model, null, 2) + '\n');
    return;
  }
  process.stdout.write(renderContext(model, maxChars) + '\n');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`agent-context: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  flattenFiles,
  parseHeader,
  featureSummary,
  resolveFeatureEntries,
  gateHints,
  buildContext,
  renderContext,
};
