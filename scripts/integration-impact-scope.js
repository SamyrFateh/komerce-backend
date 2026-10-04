#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FEATURES_DIR = path.join(ROOT, 'features');
const INTEGRATION_DIR = path.join(ROOT, 'tests', 'integration');

function norm(file) {
  return String(file || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function flattenFiles(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) flattenFiles(item, out);
  } else if (typeof value === 'string') {
    out.push(norm(value));
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) flattenFiles(item, out);
  }
  return out;
}

function loadManifests() {
  return fs.readdirSync(FEATURES_DIR)
    .filter(name => name.endsWith('.feature.js'))
    .sort()
    .map(name => {
      const file = path.join(FEATURES_DIR, name);
      delete require.cache[require.resolve(file)];
      return require(file);
    })
    .filter(Boolean);
}

function buildOwnership(manifests) {
  const map = new Map();
  for (const manifest of manifests) {
    const name = String(manifest?.name || '').trim();
    for (const file of flattenFiles(manifest?.files || {})) {
      if (!map.has(file)) map.set(file, []);
      map.get(file).push(name);
    }
  }
  return map;
}

function consumeTargets(entry, knownNames) {
  const raw = typeof entry === 'string'
    ? entry
    : (entry && typeof entry === 'object' ? String(entry.feature || entry.name || '') : '');
  const text = raw.trim();
  if (!text) return [];
  return [...knownNames].filter(name => (
    text === name
    || text.startsWith(name + ' ')
    || text.startsWith(name + ' (')
    || text.startsWith(name + ':')
  ));
}

function buildDirectConsumers(manifests) {
  const known = new Set(manifests.map(m => String(m?.name || '').trim()).filter(Boolean));
  const reverse = new Map([...known].map(name => [name, new Set()]));
  for (const manifest of manifests) {
    const consumer = String(manifest?.name || '').trim();
    const consumes = Array.isArray(manifest?.contract?.consumes) ? manifest.contract.consumes : [];
    for (const entry of consumes) {
      for (const provider of consumeTargets(entry, known)) {
        if (provider !== consumer) reverse.get(provider)?.add(consumer);
      }
    }
  }
  return reverse;
}

function integrationSuitesByFeature(manifests) {
  const map = new Map();
  for (const manifest of manifests) {
    const name = String(manifest?.name || '').trim();
    const suites = flattenFiles(manifest?.files?.tests || manifest?.tests || [])
      .filter(file => /^tests\/integration\/.+\.test\.js$/i.test(file));
    map.set(name, new Set(suites));
  }
  return map;
}

function isIntegrationTest(file) {
  return /^tests\/integration\/.+\.test\.js$/i.test(norm(file));
}

function isNonRuntime(file) {
  const f = norm(file);
  return /^docs\//i.test(f)
    || /^governance\//i.test(f)
    || /^capabilities\//i.test(f);
}

function requiresFull(file, owners, manifestsByName) {
  const f = norm(file);
  if (
    f === 'server.js'
    || /^package(?:-lock)?\.json$/i.test(f)
    || /^jest\..+\.js$/i.test(f)
    || /^db\//i.test(f)
    || /^bootstrap\//i.test(f)
    || /^tests\/helpers\//i.test(f)
    || /^tests\/integration\/test-harness\//i.test(f)
    || f === 'scripts/ci-db-bootstrap.js'
    || f === 'scripts/ci-migrate.js'
    || f === 'scripts/run-migrations.js'
    || f === 'scripts/run-integration-tests.js'
    || f === 'scripts/integration-impact-scope.js'
    || f === 'docs/db/railway-live-schema.sql'
    || f === '.github/workflows/pr-enforcement.yml'
  ) return `global DB/integration surface: ${f}`;

  if (isIntegrationTest(f) || isNonRuntime(f) || /^features\/[^/]+\.feature\.js$/i.test(f)) return null;

  if (owners.length !== 1) {
    return owners.length === 0
      ? `unowned runtime file: ${f}`
      : `ambiguous ownership: ${f} -> ${owners.join(',')}`;
  }

  const owner = manifestsByName.get(owners[0]);
  if (!owner) return `owner manifest missing: ${owners[0]}`;
  if (String(owner.type || '').toLowerCase() === 'transversal') {
    return `transversal owner: ${owners[0]}`;
  }
  return null;
}

function computeImpact(files, { manifests = loadManifests() } = {}) {
  const changed = [...new Set((files || []).map(norm).filter(Boolean))].sort();
  const ownership = buildOwnership(manifests);
  const consumers = buildDirectConsumers(manifests);
  const suitesByFeature = integrationSuitesByFeature(manifests);
  const manifestsByName = new Map(manifests.map(m => [String(m?.name || '').trim(), m]));
  const selectedFeatures = new Set();
  const selectedSuites = new Set();

  for (const file of changed) {
    if (isIntegrationTest(file)) {
      selectedSuites.add(file);
      continue;
    }
    if (isNonRuntime(file) || /^features\/[^/]+\.feature\.js$/i.test(file)) continue;

    const owners = ownership.get(file) || [];
    const fullReason = requiresFull(file, owners, manifestsByName);
    if (fullReason) return { mode: 'full', suites: [], features: [], reason: fullReason, changed };

    const owner = owners[0];
    selectedFeatures.add(owner);
    for (const consumer of consumers.get(owner) || []) selectedFeatures.add(consumer);
  }

  for (const feature of selectedFeatures) {
    for (const suite of suitesByFeature.get(feature) || []) selectedSuites.add(suite);
  }

  const suites = [...selectedSuites].filter(file => fs.existsSync(path.join(ROOT, file))).sort();
  if (!suites.length) {
    if (!selectedFeatures.size) {
      return { mode: 'skip', suites: [], features: [], reason: 'no integration runtime impact', changed };
    }
    return {
      mode: 'full',
      suites: [],
      features: [...selectedFeatures].sort(),
      reason: `no declared integration proof for impacted feature(s): ${[...selectedFeatures].sort().join(',')}`,
      changed,
    };
  }

  return {
    mode: 'targeted',
    suites,
    features: [...selectedFeatures].sort(),
    reason: 'Feature First ownership + declared integration suites',
    changed,
  };
}

function diffFiles(base, head) {
  const r = cp.spawnSync('git', ['diff', '--name-only', base, head], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'git diff failed').trim());
  return r.stdout.split(/\r?\n/).map(norm).filter(Boolean);
}

function argValue(flag) {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

function appendGithubOutput(file, impact) {
  if (!file) return;
  const safeReason = String(impact.reason || '').replace(/[\r\n]+/g, ' ');
  fs.appendFileSync(file, [
    `mode=${impact.mode}`,
    `suites=${impact.suites.join(',')}`,
    `features=${impact.features.join(',')}`,
    `reason=${safeReason}`,
  ].join('\n') + '\n', 'utf8');
}

function main() {
  const explicit = argValue('--files');
  const files = explicit
    ? explicit.split(',').map(norm).filter(Boolean)
    : diffFiles(argValue('--base'), argValue('--head'));
  const impact = computeImpact(files);
  appendGithubOutput(argValue('--github-output'), impact);
  process.stdout.write(JSON.stringify(impact, null, 2) + '\n');
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(`Integration impact scope: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  norm,
  flattenFiles,
  buildOwnership,
  buildDirectConsumers,
  integrationSuitesByFeature,
  requiresFull,
  computeImpact,
  diffFiles,
};
