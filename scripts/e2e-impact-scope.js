#!/usr/bin/env node
'use strict';

/**
 * Calcule le rayon E2E Feature First d'une PR.
 *
 * Doctrine :
 * - une couche périphérique (connector/adapter) ne réveille que sa feature
 *   propriétaire + ses consommateurs directs déclarés ;
 * - tout changement profond/transversal, ambigu ou non possédé reste FULL ;
 * - les changements purement documentaires/gouvernance restent SKIP pour les
 *   E2E API (les gates Governance continuent de s'exécuter séparément).
 *
 * Cette optimisation ne réduit jamais les gates unitaires, architecture,
 * sécurité, DB bootstrap ni Integration DB proofs. Elle ne scope que la
 * campagne tests/e2e-api/**.
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FEATURES_DIR = path.join(ROOT, 'features');
const E2E_DIR = path.join(ROOT, 'tests', 'e2e-api');

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
  if (!fs.existsSync(FEATURES_DIR)) return [];
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

function e2eFeatureSet() {
  if (!fs.existsSync(E2E_DIR)) return new Set();
  return new Set(
    fs.readdirSync(E2E_DIR)
      .filter(name => name.endsWith('.e2e.test.js'))
      .map(name => name.split('.')[0])
      .filter(Boolean)
  );
}

function buildOwnership(manifests) {
  const map = new Map();
  for (const manifest of manifests || []) {
    const name = String(manifest?.name || '').trim();
    if (!name) continue;
    for (const file of flattenFiles(manifest.files || {})) {
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
  const known = new Set((manifests || []).map(m => String(m?.name || '').trim()).filter(Boolean));
  const reverse = new Map([...known].map(name => [name, new Set()]));

  for (const manifest of manifests || []) {
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

function isPeripheralRuntimeFile(file) {
  const f = norm(file);
  return /^services\/suppliers\/connectors\/[^/]+\.(?:js|cjs|mjs)$/i.test(f)
    || /^services\/suppliers\/[^/]*(?:adapter|connector)\.(?:js|cjs|mjs)$/i.test(f);
}

function isUnitTest(file) {
  return /^tests\/unit\/.+\.(?:test|spec)\.(?:js|cjs|mjs|ts)$/i.test(norm(file));
}

function directE2eFeature(file) {
  const m = /^tests\/e2e-api\/([^.\/]+)\..+\.e2e\.test\.js$/i.exec(norm(file));
  return m ? m[1] : null;
}

function isFeatureManifest(file) {
  return /^features\/[^/]+\.feature\.js$/i.test(norm(file));
}

function isNonRuntimeGovernanceOrDocs(file) {
  const f = norm(file);
  return /^docs\//i.test(f)
    || /^governance\//i.test(f)
    || /^features\//i.test(f)
    || /^capabilities\//i.test(f);
}

function isDeepOrTransversal(file) {
  const f = norm(file);
  return f === 'server.js'
    || /^package(?:-lock)?\.json$/i.test(f)
    || /^jest\..+\.js$/i.test(f)
    || /^migrations\//i.test(f)
    || /^schemas\//i.test(f)
    || /^db\//i.test(f)
    || /^bootstrap\//i.test(f)
    || /^core\//i.test(f)
    || /^middleware\//i.test(f)
    || /^validators\//i.test(f)
    || /^utils\//i.test(f)
    || /^routes\//i.test(f)
    || /^tests\/integration\//i.test(f)
    || /^tests\/helpers\//i.test(f)
    || /^tests\/invariants\//i.test(f)
    || /^\.github\/workflows\//i.test(f)
    || f === 'scripts/run-e2e-feature-tests.js'
    || f === 'scripts/e2e-impact-scope.js';
}

function isBackendRuntimeLike(file) {
  const f = norm(file);
  return /^(?:services|routes|middleware|validators|utils|core|bootstrap|db|schemas|migrations)\//i.test(f)
    || /^tests\//i.test(f)
    || f === 'server.js'
    || /^package(?:-lock)?\.json$/i.test(f)
    || /^jest\..+\.js$/i.test(f);
}

function computeImpact(files, {
  manifests = loadManifests(),
  e2eFeatures = e2eFeatureSet(),
} = {}) {
  const changed = [...new Set((files || []).map(norm).filter(Boolean))].sort();
  const ownership = buildOwnership(manifests);
  const consumers = buildDirectConsumers(manifests);
  const targeted = new Set();
  const reasons = [];

  for (const file of changed) {
    if (isDeepOrTransversal(file)) {
      return { mode: 'full', features: [], reason: `deep/transversal: ${file}`, changed };
    }

    const direct = directE2eFeature(file);
    if (direct) {
      targeted.add(direct);
      reasons.push(`e2e-owned:${direct}`);
      continue;
    }

    if (isFeatureManifest(file) || isNonRuntimeGovernanceOrDocs(file)) {
      continue;
    }

    if (isPeripheralRuntimeFile(file) || isUnitTest(file)) {
      const owners = ownership.get(file) || [];
      if (owners.length !== 1) {
        return {
          mode: 'full',
          features: [],
          reason: owners.length === 0
            ? `unowned peripheral/test file: ${file}`
            : `ambiguous ownership: ${file} -> ${owners.join(',')}`,
          changed,
        };
      }

      const owner = owners[0];
      if (!e2eFeatures.has(owner)) {
        return { mode: 'full', features: [], reason: `owner has no E2E suite: ${owner}`, changed };
      }

      targeted.add(owner);
      for (const consumer of consumers.get(owner) || []) {
        if (e2eFeatures.has(consumer)) targeted.add(consumer);
      }
      reasons.push(`peripheral:${file}->${owner}`);
      continue;
    }

    if (isBackendRuntimeLike(file)) {
      return { mode: 'full', features: [], reason: `runtime not proven peripheral: ${file}`, changed };
    }
  }

  const features = [...targeted].sort();
  if (!features.length) {
    return { mode: 'skip', features: [], reason: 'no E2E runtime impact', changed };
  }

  return {
    mode: 'targeted',
    features,
    reason: reasons.join('; ') || 'targeted feature ownership',
    changed,
  };
}

function diffFiles(base, head) {
  if (!base || !head) throw new Error('Les SHA --base et --head sont obligatoires.');
  const r = cp.spawnSync('git', ['diff', '--name-only', base, head], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git diff impossible: ${(r.stderr || r.stdout || '').trim()}`);
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
  fs.appendFileSync(
    file,
    [
      `mode=${impact.mode}`,
      `features=${impact.features.join(',')}`,
      `reason=${safeReason}`,
    ].join('\n') + '\n',
    'utf8'
  );
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
  try {
    main();
  } catch (error) {
    console.error(`E2E impact scope: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  norm,
  flattenFiles,
  buildOwnership,
  buildDirectConsumers,
  isPeripheralRuntimeFile,
  isUnitTest,
  directE2eFeature,
  isDeepOrTransversal,
  isBackendRuntimeLike,
  computeImpact,
  diffFiles,
};
