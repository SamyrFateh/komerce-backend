#!/usr/bin/env node
'use strict';

/** P3b — projection de gates existants vers les 28 features canoniques. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BOUTIQUE = path.join(ROOT, 'public', 'boutique');
const OUT = path.join(ROOT, 'docs', 'GATE_FINDINGS.json');
const VERSION = 'GF-2.0';
const MIN = 18;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const JSON_SOURCES = [
  ['gate:feature-registry-check', 'root', 'root', 'scripts/feature-registry-check.js', null],
  ['gate:feature-registry-check', 'boutique', 'boutique', 'public/boutique/scripts/feature-registry-check.js', 'js'],
  ['gate:feature-classification-check', 'root', 'root', 'scripts/feature-classification-check.js', null],
  ['gate:feature-guard', 'boutique', 'guard', 'public/boutique/scripts/feature-guard.js', 'manifests'],
].map(([gate, scope, kind, script, coverage]) => ({ gate, scope, kind, script, coverage }));

const TEXT_SOURCES = [
  ['check:group-wording', 'js-css'], ['check:imports', 'js'],
  ['check:body-classes', 'js-css-index'], ['check:no-injection', 'js-css-index'],
  ['check:important', 'css'], ['check:css-guard', 'css'],
  ['check:css-specificity-guard', 'css'], ['check:breakpoints', 'css'],
  ['check:css-vars', 'css'], ['check:zindex', 'css'],
  ['check:keyframes', 'css'], ['check:sticky', 'css'],
  ['audit:modal-ownership', 'modal'], ['audit:modal-layout', 'modal'],
].map(([gate, coverage]) => ({ gate, npmScript: gate, coverage }));
const SOURCES = [...JSON_SOURCES, ...TEXT_SOURCES];

const norm = p => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
const stripAnsi = s => String(s || '').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
const addOwner = (index, file, feature) => {
  file = norm(file);
  if (!file || !feature) return;
  if (!index.has(file)) index.set(file, new Set());
  index.get(file).add(feature);
};

function loadManifests(dir) {
  const map = new Map();
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.feature.js') && !f.startsWith('_')).sort()) {
    const abs = path.join(dir, file);
    delete require.cache[require.resolve(abs)];
    const manifest = require(abs);
    map.set(manifest.name, manifest);
  }
  return map;
}

function buildCanonicalFileIndex(rootFeatures, boutiqueManifests) {
  const index = new Map();
  for (const feature of rootFeatures.values()) {
    for (const [group, files] of Object.entries(feature.files || {})) {
      for (const raw of files || []) {
        const file = group === 'boutique' && !norm(raw).startsWith('public/boutique/')
          ? `public/boutique/${norm(raw)}` : norm(raw);
        addOwner(index, file, feature.name);
      }
    }
  }
  const dir = path.join(BOUTIQUE, 'features');
  for (const manifest of boutiqueManifests.values()) {
    if (!manifest.canonicalFeature) continue;
    for (const files of Object.values(manifest.files || {})) {
      for (const raw of files || []) {
        const rel = norm(path.relative(ROOT, path.resolve(dir, raw)));
        if (rel.startsWith('public/boutique/')) addOwner(index, rel, manifest.canonicalFeature);
      }
    }
  }
  return index;
}

function walk(dir, predicate, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!['node_modules', 'coverage', 'dist'].includes(e.name)) walk(abs, predicate, out);
    } else if (predicate(abs)) out.push(norm(path.relative(ROOT, abs)));
  }
  return out;
}

function listCoverage(kind) {
  const js = () => walk(path.join(BOUTIQUE, 'js'), p => p.endsWith('.js'));
  const css = () => walk(path.join(BOUTIQUE, 'css'), p => p.endsWith('.css'));
  if (kind === 'js') return js();
  if (kind === 'css') return css();
  if (kind === 'js-css') return [...js(), ...css()];
  if (kind === 'js-css-index') return [...js(), ...css(), 'public/boutique/index.html'];
  if (kind === 'modal') return [...js(), ...css()].filter(f => /(?:^|\/)(?:b-)?modal|modal-/i.test(f));
  return [];
}

function assessCoverage(files, index) {
  const unique = [...new Set(files.map(norm))].sort();
  const unprojectable = [], multiProjected = [];
  for (const file of unique) {
    const owners = index.get(file);
    if (!owners?.size) unprojectable.push(file);
    else if (owners.size > 1) multiProjected.push({ file, features: [...owners].sort() });
  }
  return { files: unique, unprojectable, multiProjected };
}

function normalizeFile(raw) {
  let file = norm(raw).replace(/^['"`([{]+|['"`\])},;:]+$/g, '');
  const i = file.indexOf('public/boutique/');
  if (i >= 0) return file.slice(i);
  if (/^(js|css|features|scripts)\//.test(file)) return `public/boutique/${file}`;
  if (file === 'index.html') return 'public/boutique/index.html';
  return file;
}

function extractRepoFile(line) {
  const clean = stripAnsi(line);
  const m = clean.match(/((?:public\/boutique\/)?(?:js|css|features|scripts)\/[A-Za-z0-9_./@-]+\.(?:js|css|html|json))/)
    || clean.match(/((?:public\/boutique\/)?index\.html)/);
  return m ? normalizeFile(m[1]) : null;
}

function parseTextFindings(gate, output, exitCode) {
  const findings = [];
  let currentFile = null;
  for (const raw of String(output || '').split(/\r?\n/)) {
    const message = stripAnsi(raw).trim();
    if (!message || /^>\s|^npm\s|^Run\s/i.test(message)) continue;
    const file = extractRepoFile(message);
    if (file) currentFile = file;
    if (!/(❌|✖|⚠|\bWARN(?:ING)?\b|\bERROR\b|\bFAIL(?:ED)?\b|violation|interdit|inconnu|manquant|orphelin|conflict|duplicate|d[ée]passe)/i.test(message)) continue;
    if (!file && !currentFile) continue;
    const warn = /(⚠|\bWARN(?:ING)?\b|avertissement)/i.test(message);
    const fail = /(❌|✖|\bERROR\b|\bFAIL(?:ED)?\b|violation|interdit|conflict|duplicate)/i.test(message);
    findings.push({ gate, scope: 'boutique', verdict: fail ? 'fail' : warn ? 'warn' : exitCode ? 'fail' : 'warn', type: 'TEXT-GATE-DIAGNOSTIC', feature: null, file: file || currentFile, message });
  }
  return findings;
}

function run(command, args, cwd = ROOT) {
  const r = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } });
  return { exitCode: r.status ?? 1, output: [r.stdout, r.stderr].filter(Boolean).join('\n'), error: r.error?.message || null };
}

function resolveFindings(raw, canonicalNames, index) {
  const resolved = [], unattributed = [];
  for (const finding of raw) {
    if (finding.file) {
      const sourceFile = norm(finding.file), owners = index.get(sourceFile);
      if (owners?.size === 1) resolved.push({ ...finding, feature: [...owners][0], sourceFile, file: null });
      else unattributed.push(finding);
    } else if (canonicalNames.has(finding.feature)) resolved.push(finding);
    else unattributed.push(finding);
  }
  return { resolved, unattributed };
}

function normalizeJson(src, json, local) {
  if (src.kind === 'guard') {
    return (json.results || []).flatMap(result => {
      const feature = local.get(result.name)?.canonicalFeature || null;
      return [...(result.errors || []).map(message => ({ verdict: 'fail', message })), ...(result.warnings || []).map(message => ({ verdict: 'warn', message }))]
        .map(x => ({ gate: src.gate, scope: src.scope, type: 'FEATURE-GUARD', feature, file: null, message: String(x.message), verdict: x.verdict }));
    });
  }
  const convert = (entry, verdict) => {
    const localFeature = entry.feature != null ? local.get(String(entry.feature)) : null;
    return { gate: src.gate, scope: src.scope, type: entry.type || 'UNKNOWN', verdict,
      feature: localFeature ? localFeature.canonicalFeature : (entry.feature != null ? String(entry.feature) : null),
      file: entry.file != null ? normalizeFile(entry.file) : null,
      message: entry.msg != null ? String(entry.msg) : String(entry.message || '') };
  };
  return [...(json.errors || []).map(e => convert(e, 'fail')), ...(json.warnings || []).map(w => convert(w, 'warn'))];
}

function validateSourceContract(report) {
  const attributable = report.filter(s => s.status === 'ok' && !s.unprojectableCount && !s.multiProjectedCount).length;
  const failed = report.filter(s => s.status === 'failed');
  return { attributable, failed, ok: attributable >= MIN && failed.length === 0 };
}

function selfCheck() {
  const make = n => Array.from({ length: n }, () => ({ status: 'ok', unprojectableCount: 0, multiProjectedCount: 0 }));
  if (validateSourceContract(make(17)).ok || !validateSourceContract(make(18)).ok) throw new Error('P3b source threshold self-check failed');
  if (assessCoverage(['public/boutique/js/a.js'], new Map()).unprojectable.length !== 1) throw new Error('P3b coverage self-check failed');
}

function main() {
  selfCheck();
  const root = loadManifests(path.join(ROOT, 'features'));
  const local = loadManifests(path.join(BOUTIQUE, 'features'));
  const canonicalNames = new Set(root.keys());
  const index = buildCanonicalFileIndex(root, local);
  const findings = [], sources = [];

  for (const src of JSON_SOURCES) {
    const coverage = assessCoverage(src.coverage ? listCoverage(src.coverage) : [], index);
    const result = run(process.execPath, [path.join(ROOT, src.script), '--json']);
    let raw = [], parseError = null;
    try { raw = normalizeJson(src, JSON.parse(String(result.output).trim()), local); }
    catch (e) { parseError = e.message; }
    const attribution = resolveFindings(raw, canonicalNames, index);
    findings.push(...attribution.resolved);
    const failed = result.error || parseError || attribution.unattributed.length || coverage.unprojectable.length || coverage.multiProjected.length;
    sources.push({ gate: src.gate, scope: src.scope, script: src.script, status: failed ? 'failed' : 'ok', exitCode: result.exitCode,
      error: result.error || parseError || (attribution.unattributed.length ? `${attribution.unattributed.length} finding(s) sans attribution canonique` : undefined),
      errorCount: raw.filter(f => f.verdict === 'fail').length, warningCount: raw.filter(f => f.verdict === 'warn').length,
      coverageCount: coverage.files.length, unprojectableCount: coverage.unprojectable.length, multiProjectedCount: coverage.multiProjected.length,
      unprojectableFiles: coverage.unprojectable, multiProjectedFiles: coverage.multiProjected });
  }

  for (const src of TEXT_SOURCES) {
    const coverage = assessCoverage(listCoverage(src.coverage), index);
    const result = run(npm, ['--prefix', BOUTIQUE, 'run', src.npmScript]);
    const raw = parseTextFindings(src.gate, result.output, result.exitCode);
    const attribution = resolveFindings(raw, canonicalNames, index);
    findings.push(...attribution.resolved);
    const noDiagnostic = result.exitCode !== 0 && raw.length === 0;
    const failed = result.error || noDiagnostic || attribution.unattributed.length || coverage.unprojectable.length || coverage.multiProjected.length;
    sources.push({ gate: src.gate, scope: 'boutique', script: `npm --prefix public/boutique run ${src.npmScript}`, status: failed ? 'failed' : 'ok', exitCode: result.exitCode,
      error: result.error || (noDiagnostic ? 'sortie non nulle sans diagnostic attribuable' : undefined),
      errorCount: raw.filter(f => f.verdict === 'fail').length, warningCount: raw.filter(f => f.verdict === 'warn').length,
      coverageCount: coverage.files.length, unprojectableCount: coverage.unprojectable.length, multiProjectedCount: coverage.multiProjected.length,
      unprojectableFiles: coverage.unprojectable, multiProjectedFiles: coverage.multiProjected });
  }

  findings.sort((a, b) => `${a.gate}::${a.sourceFile || ''}::${a.message}`.localeCompare(`${b.gate}::${b.sourceFile || ''}::${b.message}`));
  const contract = validateSourceContract(sources);
  const model = { version: VERSION, generatedAt: new Date().toISOString().slice(0, 10), contract: {
    minimumAttributableSources: MIN, configuredSources: SOURCES.length, attributableSources: contract.attributable, coverageBeforeViolations: true,
  }, sources, findings };
  fs.writeFileSync(OUT, JSON.stringify(model, null, 2) + '\n');
  console.log(`docs/GATE_FINDINGS.json : ${contract.attributable}/${SOURCES.length} source(s) attribuable(s), ${findings.length} finding(s)`);
  for (const s of sources) {
    console.log(`  ${s.status === 'ok' ? '✔' : '✖'} ${s.gate} (${s.scope}) — couverture ${s.coverageCount}, ${s.errorCount || 0} fail, ${s.warningCount || 0} warn${s.error ? ` — ${s.error}` : ''}`);
    for (const f of s.unprojectableFiles || []) console.log(`      [UNPROJECTABLE] ${f}`);
    for (const m of s.multiProjectedFiles || []) console.log(`      [MULTI] ${m.file} -> ${m.features.join(', ')}`);
  }
  if (!contract.ok) {
    console.error(`P3b non clos : ${contract.attributable}/${MIN} sources attribuables ; ${contract.failed.length} source(s) en échec.`);
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { main, SOURCES, MIN, norm, extractRepoFile, parseTextFindings, buildCanonicalFileIndex, assessCoverage, resolveFindings, validateSourceContract };
