#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          agent-context-compiler
 * @domain        infrastructure
 * @layer         tooling
 * @criticality   high
 * @inputs        feature manifests, @komerce-arch headers, interventionIndex, git diff
 * @outputs       compact agent context projection, change-impact projection (--impact), context packs (--pack), mission brief (--handoff)
 * @depends       scripts/pr-enforcement-scope.js, scripts/lib/agent-context-impact.js, scripts/lib/agent-context-pack.js, scripts/lib/agent-context-handoff.js, scripts/setup-hooks-runner.js, scripts/run-staged-related-tests.js, docs/komerce-arch-header-graph.json
 * @used-by       coding agents, AGENTS.md
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/AGENT_TOKEN_ECONOMY.md
 * @impact-areas  governance, developer-workflow
 * @version       2026-10-v2
 */
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { classify, classifyDiff } = require('./pr-enforcement-scope');
const impactLib = require('./lib/agent-context-impact');
const packLib = require('./lib/agent-context-pack');
const handoffLib = require('./lib/agent-context-handoff');

const ROOT = path.resolve(__dirname, '..');
const FEATURE_ROOTS = [
  'features',
  'public/boutique/features',
];
const CATEGORY_PREFIX = { boutique: 'public/boutique', dash: 'public' };

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

function repoRel(abs) {
  return path.relative(ROOT, abs).replace(/\\/g, '/');
}

function declaredPath(cardBase, rel, category) {
  const clean = norm(rel).replace(/^\/+/, '');
  if (!clean || clean.endsWith('/')) return null;
  if (clean.startsWith('../')) return repoRel(path.resolve(cardBase, clean));

  const prefix = CATEGORY_PREFIX[category];
  if (prefix) return norm(`${prefix}/${clean}`);

  const rootCandidate = path.join(ROOT, clean);
  if (fs.existsSync(rootCandidate)) return clean;

  const localCandidate = path.resolve(cardBase, clean);
  if (fs.existsSync(localCandidate)) return repoRel(localCandidate);
  return clean;
}

function manifestOwnedFiles(manifest, cardBase) {
  const files = [];
  for (const [category, entries] of Object.entries(manifest.files || {})) {
    for (const rel of Array.isArray(entries) ? entries : []) {
      const resolved = declaredPath(cardBase, rel, category);
      if (resolved) files.push(resolved);
    }
  }
  return files;
}

function loadFeatures() {
  return featurePaths().map(file => {
    const abs = path.join(ROOT, file);
    delete require.cache[require.resolve(abs)];
    const manifest = require(abs);
    return {
      file,
      manifest,
      ownedFiles: new Set(manifestOwnedFiles(manifest, path.dirname(abs))),
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
  const explicitNames = options.features || [];
  let scope = files.length
    ? classify(files)
    : (explicitNames.length ? classify([]) : scopeForFiles([], options.base, options.head));
  if (!files.length && !explicitNames.length && Array.isArray(scope.changedFiles)) {
    files = scope.changedFiles.slice();
  }

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

// --brief: ultra-compact entry point (~600-800 tokens).
// Feature names + owners + scope + gates only. No perimeter, no invariants,
// no headers, no ledger. The agent calls --expand only when it hits ambiguity.
function renderBrief(model, maxChars = 2800) {
  const lines = [];
  lines.push('KOMERCE AGENT CONTEXT v1 brief — appeler --expand <feature|file> si ambiguïté');

  const flags = Object.entries(model.scope).filter(([, v]) => v).map(([k]) => k);
  lines.push(`scope: ${flags.length ? flags.join(' ') : 'none'}`);

  if (model.files.length) lines.push(`files: ${take(model.files, 6).join(', ')}`);

  for (const feature of model.features) {
    lines.push(`[${feature.name}] owner=${feature.owner || '—'} | ${compact(feature.service, 120)}`);
  }

  lines.push(`gates: ${model.gates.join(' → ')}`);

  const body = lines.join('\n');
  const tokens = Math.ceil(body.length / 4);
  lines.push(`budget: ${body.length} chars ≈ ${tokens} tokens`);
  const full = lines.join('\n');
  return full.length <= maxChars ? full : full.slice(0, maxChars - 40) + '\n… budget atteint';
}

// --expand <name>: full detail for one feature or one file only.
// Returns perimeter, invariants, authority, headers, mustCheck — everything
// the brief omitted, scoped to a single item.
function expandSeed(target) {
  const clean = norm(target);
  if (!clean) return { files: [], features: [] };
  const abs = path.join(ROOT, clean);
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
    return { files: [clean], features: [] };
  }
  return { files: [], features: [clean] };
}

function renderExpand(model, target) {
  const lines = [];

  // Try feature match first
  const feature = model.features.find(f =>
    f.name.toLowerCase() === target.toLowerCase()
    || f.file.toLowerCase().includes(target.toLowerCase()));

  if (feature) {
    lines.push(`[feature ${feature.name}] owner=${feature.owner || '—'} · ${feature.file}`);
    if (feature.service) lines.push(`service: ${feature.service}`);
    if (feature.perimeterIn.length) lines.push(`in: ${feature.perimeterIn.join(' | ')}`);
    if (feature.perimeterOut.length) lines.push(`out: ${feature.perimeterOut.join(' | ')}`);
    if (feature.authority.length) lines.push(`authority: ${feature.authority.join(' | ')}`);
    if (feature.invariants.length) lines.push(`invariants: ${feature.invariants.join(' | ')}`);
  }

  // Try file header match
  const header = model.headers.find(h =>
    h.file.toLowerCase() === target.toLowerCase()
    || h.file.toLowerCase().includes(target.toLowerCase()));

  if (header) {
    const h = header.header;
    lines.push(`[file ${header.file}] role=${h.role || '—'} domain=${h.domain || '—'} layer=${h.layer || '—'} criticality=${h.criticality || '—'}`);
    if (h['db-read'] && h['db-read'] !== 'none') lines.push(`db-read: ${compact(h['db-read'], 240)}`);
    if (h['db-write'] && h['db-write'] !== 'none') lines.push(`db-write: ${compact(h['db-write'], 240)}`);
    if (h.doctrine) lines.push(`doctrine: ${compact(h.doctrine, 240)}`);
    if (header.mustCheck.length) lines.push(`mustCheck: ${header.mustCheck.join(', ')}`);
  }

  if (model.ledger && !lines.length) {
    lines.push(`ledger: ${model.ledger}`);
  } else if (model.ledger && feature) {
    lines.push(`ledger: ${model.ledger}`);
  }

  if (!lines.length) {
    lines.push(`expand: aucun résultat pour "${target}". Features disponibles : ${model.features.map(f => f.name).join(', ') || 'aucune'}`);
  }

  const body = lines.join('\n');
  const tokens = Math.ceil(body.length / 4);
  return body + `\nbudget: ${body.length} chars ≈ ${tokens} tokens`;
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

function readJson(relative) {
  const raw = safeRead(relative);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function mainMigrationFiles() {
  try {
    return git(['ls-tree', '--name-only', 'origin/main', 'migrations/']).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function localMigrationFiles() {
  const dir = path.join(ROOT, 'migrations');
  return fs.existsSync(dir) ? fs.readdirSync(dir).map(name => `migrations/${name}`) : [];
}

function trackedTestSources() {
  return git(['ls-files', 'tests/']).split('\n').filter(f => /\.(?:test|spec)\.(?:c|m)?js$/.test(f))
    .map(f => ({ path: f, source: safeRead(f) }));
}

// --impact <fichier|feature> : portée d'un changement en un appel (voir scripts/lib/agent-context-impact.js).
function buildImpact(target, options = {}) {
  const index = impactLib.indexSources({
    graph: options.graph || readJson('docs/komerce-arch-header-graph.json'),
    routes: options.routes || readJson('docs/_generated/route-registry.json'),
    security: options.security || readJson('docs/SECURITY_360.json'),
    feature360: options.feature360 || readJson('docs/FEATURE_360.json'),
  });
  const features = options.features || loadFeatures();
  const clean = norm(target);
  const migration = /^migrations(\/|$)/.test(clean)
    ? impactLib.migrationStatus({
      mainFiles: options.mainMigrations || mainMigrationFiles(),
      localFiles: options.localMigrations || localMigrationFiles(),
    })
    : null;
  const abs = path.join(ROOT, clean);
  const isFile = options.isFile != null ? options.isFile : (fs.existsSync(abs) && fs.statSync(abs).isFile());
  if (isFile || migration) {
    const owner = features.find(entry => entry.ownedFiles.has(clean));
    let tests = null;
    if (!options.skipTests) {
      if (/^migrations\/.+\.sql$/.test(clean) || clean === 'docs/db/railway-live-schema.sql') {
        tests = { full: true };
      } else {
        const lister = options.listRelatedTests || require('./run-staged-related-tests').listRelatedTests;
        let list = lister([clean]);
        if (/^scripts\//.test(clean)) {
          const tracked = options.trackedTests || trackedTestSources();
          list = Array.from(new Set([...list, ...impactLib.toolingTests(clean, tracked)])).sort();
        }
        tests = { full: false, list };
      }
    }
    return impactLib.fileImpact(index, clean, { feature: owner ? owner.manifest.name : null, tests, migration });
  }
  const entry = features.find(e => String(e.manifest.name).toLowerCase() === clean.toLowerCase());
  if (!entry) {
    throw new Error(`--impact : "${target}" n'est ni un fichier ni une feature. Features : ${features.map(e => e.manifest.name).join(', ')}`);
  }
  return impactLib.featureImpact(index, entry, { migration });
}

// --pack <type> --feature <f> | --files <a,b> : contexte minimal par type de changement.
function buildPacks(type, options = {}) {
  const features = options.features || loadFeatures();
  const files = (options.files || []).map(norm).filter(Boolean);
  const selected = resolveFeatureEntries(features, files, options.featureNames || []);
  if (!selected.length) {
    throw new Error(`--pack : aucune feature résolue. Passer --feature <nom> ou --files <chemins>. Features : ${features.map(e => e.manifest.name).join(', ')}`);
  }
  const feature360 = options.feature360 || readJson('docs/FEATURE_360.json');
  const index = impactLib.indexSources({
    graph: options.graph || readJson('docs/komerce-arch-header-graph.json'),
    routes: options.routes || readJson('docs/_generated/route-registry.json'),
    security: options.security || readJson('docs/SECURITY_360.json'),
    feature360,
  });
  const migration = type === 'migration'
    ? impactLib.migrationStatus({
      mainFiles: options.mainMigrations || mainMigrationFiles(),
      localFiles: options.localMigrations || localMigrationFiles(),
    })
    : null;
  return selected.map(entry => packLib.buildPack(type, entry, {
    index, feature360, migration, readSource: options.readSource || safeRead,
  }));
}

// --handoff <type> --feature <f> | --files <a,b> [--task "..."] : brief autonome
// pour un agent externe à budget limité (packs + impacts des fichiers + règles AGENTS.md).
function buildHandoff(type, options = {}) {
  const files = (options.files || []).map(norm).filter(Boolean);
  const packs = buildPacks(type, options);
  const impacts = files.map(file => buildImpact(file, options));
  const agentsMd = options.agentsMd != null ? options.agentsMd : fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  return handoffLib.renderHandoff({ task: options.task, packs, impacts, agentsMd });
}

function main() {
  const args = process.argv.slice(2);
  require('./setup-hooks-runner').ensureInstalled();
  const handoffType = argValue(args, '--handoff', '');
  if (handoffType) {
    process.stdout.write(buildHandoff(handoffType, {
      files: argValue(args, '--files', '').split(','),
      featureNames: argValue(args, '--feature', '').split(',').map(v => v.trim()).filter(Boolean),
      task: argValue(args, '--task', ''),
    }) + '\n');
    return;
  }
  const packType = argValue(args, '--pack', '');
  if (packType) {
    const packs = buildPacks(packType, {
      files: argValue(args, '--files', '').split(','),
      featureNames: argValue(args, '--feature', '').split(',').map(v => v.trim()).filter(Boolean),
    });
    process.stdout.write(args.includes('--json')
      ? JSON.stringify(packs, null, 2) + '\n'
      : packs.map(packLib.renderPack).join('\n\n') + '\n');
    return;
  }
  const impactTarget = argValue(args, '--impact', '');
  if (impactTarget) {
    const impact = buildImpact(impactTarget, { skipTests: args.includes('--no-tests') });
    process.stdout.write(args.includes('--json')
      ? JSON.stringify(impact, null, 2) + '\n'
      : impactLib.renderImpact(impact) + '\n');
    return;
  }
  const filesArg = argValue(args, '--files', '');
  const featureArg = argValue(args, '--feature', '');
  const requestedMaxChars = Number(argValue(args, '--max-chars', '')) || null;
  const maxChars = Math.max(2000, requestedMaxChars || 6000);
  const expandTarget = argValue(args, '--expand', '');

  let files = filesArg.split(',').map(norm).filter(Boolean);
  let features = featureArg.split(',').map(v => v.trim()).filter(Boolean);
  if (expandTarget && !files.length && !features.length) {
    const seed = expandSeed(expandTarget);
    files = seed.files;
    features = seed.features;
  }

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

  if (expandTarget) {
    process.stdout.write(renderExpand(model, expandTarget) + '\n');
    return;
  }

  if (args.includes('--brief')) {
    const briefMaxChars = Math.max(1600, Math.min(2800, requestedMaxChars || 2800));
    process.stdout.write(renderBrief(model, briefMaxChars) + '\n');
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
  buildHandoff,
  buildImpact,
  buildPacks,
  flattenFiles,
  declaredPath,
  manifestOwnedFiles,
  parseHeader,
  featureSummary,
  resolveFeatureEntries,
  gateHints,
  buildContext,
  expandSeed,
  renderBrief,
  renderExpand,
  renderContext,
};
