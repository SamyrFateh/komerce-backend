#!/usr/bin/env node
'use strict';

/**
 * @komerce-arch
 * @role          feature-invariant-check
 * @domain        governance
 * @layer         gate
 * @criticality   high
 * @inputs        features/*.feature.js (HEAD et base git), jest.unit.config.js, playwright.config.js
 * @outputs       rapport + exit code
 * @depends       jest, features/*.feature.js
 * @used-by       scripts/map-check.js, scripts/pr-preflight.js, .github/workflows/pr-enforcement.yml, .github/workflows/nightly-e2e-certification.yml
 * @db-read       none
 * @db-txn        none
 * @doctrine      invariant_executable_non_speculatif
 * @impact-areas  governance, all-features
 * @version       2026-10
 *
 * ── Pourquoi ce gate existe ────────────────────────────────────────────────
 * Une Feature Card déclare ses invariants en deux formes :
 *   Forme chaîne : 'description'              → non exécutable, informatif
 *   Forme objet  : { statement, test: 'path' } → exécutable, prouvé ici
 *
 * Contrôles statiques (toujours, rapides, sans base) :
 *   1. le test référencé existe ;
 *   2. un runner OFFICIEL l'exécute réellement (jest unitaire, intégration,
 *      E2E API, Playwright enregistré, boutique) — sinon l'invariant est
 *      orphelin : aucun job ne le prouve jamais ;
 *   3. cliquet sans baseline : le nombre d'invariants textuels d'une carte ne
 *      croît pas par rapport au commit de base (--base, défaut merge-base
 *      origin/main) — tout nouvel invariant naît exécutable. Aucun fichier de
 *      tolérance : le stock historique est la mesure du commit de base.
 *
 * Exécution (--run=unit,db,boutique|all) : jest en lot (--json) par famille ;
 * chaque fichier doit avoir ≥ 1 test passé et AUCUN test ignoré/todo : un
 * succès « à vide » (suite skippée faute de DATABASE_URL) est un échec.
 * La famille db exige DATABASE_URL (échec, jamais skip). Playwright reste
 * exécuté par le job Dashboard ; ici seul son enregistrement est vérifié.
 *
 * Usage :
 *   node scripts/feature-invariant-check.js                 ← rapport statique
 *   node scripts/feature-invariant-check.js --strict        ← bloque (CI)
 *   node scripts/feature-invariant-check.js --strict --run=unit
 *   node scripts/feature-invariant-check.js --strict --run=db   (DATABASE_URL requis)
 *   --base <sha> : commit de comparaison du cliquet (CI : base de la PR)
 *   --verbose : sortie jest incluse
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FEAT_DIR = path.join(ROOT, 'features');

const KIND = Object.freeze({
  UNIT: 'unit', INTEGRATION: 'integration', E2E_API: 'e2e-api',
  PLAYWRIGHT: 'playwright', BOUTIQUE: 'boutique', UNKNOWN: 'unknown',
});
// Famille d'exécution : integration + e2e-api partagent la base reconstruite.
const RUN_FAMILY = Object.freeze({
  unit: KIND.UNIT, integration: 'db', 'e2e-api': 'db', boutique: KIND.BOUTIQUE,
});

function globToRegExp(glob) {
  const g = glob.replace(/^<rootDir>\//, '');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') { re += '(?:.*/)?'; i += g[i + 2] === '/' ? 2 : 1; }
    else if (c === '*') re += '[^/]*';
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

function loadRunners(root = ROOT) {
  const unitCfg = require(path.join(root, 'jest.unit.config.js'));
  const unit = (unitCfg.testMatch || []).map(globToRegExp);
  let playwright = new Set();
  try {
    const src = fs.readFileSync(path.join(root, 'playwright.config.js'), 'utf8');
    const block = (src.match(/const DASHBOARD_SPECS = \[([\s\S]*?)\];/) || [])[1] || '';
    playwright = new Set([...block.matchAll(/'([^']+)'/g)].map(m => `tests/e2e/${m[1]}.spec.js`));
  } catch { /* pas de config Playwright : aucun spec n'est couvert */ }
  return { unit, playwright };
}

function classifyTest(rel) {
  if (/^tests\/e2e-api\/[^/]+\.e2e\.test\.js$/.test(rel)) return KIND.E2E_API;
  if (/^tests\/integration\/[^/]+\.test\.js$/.test(rel)) return KIND.INTEGRATION;
  if (/^tests\/e2e\/[^/]+\.spec\.js$/.test(rel)) return KIND.PLAYWRIGHT;
  if (/^public\/boutique\/tests\/unit\/.+\.test\.js$/.test(rel)) return KIND.BOUTIQUE;
  if (/^tests\/.+\.test\.js$/.test(rel)) return KIND.UNIT;
  return KIND.UNKNOWN;
}

/** Un runner officiel exécute-t-il ce fichier ? (sinon : invariant orphelin) */
function coveredByOfficialRunner(rel, kind, runners) {
  if (kind === KIND.UNIT) return runners.unit.some(re => re.test(rel));
  if (kind === KIND.PLAYWRIGHT) return runners.playwright.has(rel);
  return kind !== KIND.UNKNOWN;
}

/** Évalue une carte (données pures) depuis son texte, sans l'écrire sur disque. */
function evalCard(source, filename) {
  const Module = require('module');
  const m = new Module(filename, null);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  m._compile(source, filename);
  return m.exports;
}

function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}

function resolveBase(argv) {
  const i = argv.indexOf('--base');
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  const mb = git(['merge-base', 'HEAD', 'origin/main']);
  return mb ? mb.trim() : null;
}

/** Invariants textuels par carte au commit de base (stock historique mesuré). */
function textualAtBase(base) {
  const list = git(['ls-tree', '--name-only', base, 'features/']);
  if (list === null) throw new Error(`commit de base illisible : ${base}`);
  const out = {};
  for (const file of list.split('\n').filter(f => f.endsWith('.feature.js'))) {
    const src = git(['show', `${base}:${file}`]);
    let card;
    try { card = evalCard(src, path.join(ROOT, file)); } catch { continue; }
    const id = card.id || card.name || path.basename(file, '.feature.js');
    out[id] = (card.invariants || []).filter(inv => !(inv && typeof inv === 'object' && inv.test)).length;
  }
  return out;
}

function loadFeatures(dir = FEAT_DIR) {
  const out = [];
  for (const fname of fs.readdirSync(dir).filter(f => f.endsWith('.feature.js')).sort()) {
    let manifest;
    try { manifest = require(path.join(dir, fname)); } catch { continue; }
    out.push({ id: manifest.id || manifest.name || fname.replace('.feature.js', ''), invariants: manifest.invariants || [] });
  }
  return out;
}

function collect(features) {
  const executable = [];
  const textual = {};
  for (const f of features) {
    for (const inv of f.invariants) {
      if (inv && typeof inv === 'object' && inv.test) {
        executable.push({ feature: f.id, statement: inv.statement || '(sans libellé)', test: inv.test });
      } else {
        textual[f.id] = (textual[f.id] || 0) + 1;
      }
    }
  }
  return { executable, textual };
}

function staticFindings(executable, runners, root = ROOT) {
  const findings = [];
  for (const inv of executable) {
    const kind = classifyTest(inv.test);
    if (!fs.existsSync(path.resolve(root, inv.test))) {
      findings.push({ ...inv, kind, code: 'FICHIER_INTROUVABLE' });
    } else if (!coveredByOfficialRunner(inv.test, kind, runners)) {
      findings.push({ ...inv, kind, code: 'AUCUN_RUNNER_OFFICIEL' });
    }
  }
  return findings;
}

function ratchetFindings(textual, baseline) {
  const out = [];
  for (const [feature, count] of Object.entries(textual)) {
    const max = Object.prototype.hasOwnProperty.call(baseline, feature) ? baseline[feature] : 0;
    if (count > max) out.push({ feature, count, max });
  }
  return out.sort((a, b) => a.feature.localeCompare(b.feature));
}

/** Verdict d'un fichier depuis le rapport jest --json : jamais de succès à vide. */
function evaluateFileResult(result) {
  if (!result) return { ok: false, reason: 'non exécuté par jest (chemin non apparié)' };
  const assertions = result.assertionResults || [];
  const passed = assertions.filter(a => a.status === 'passed').length;
  const skipped = assertions.filter(a => ['pending', 'skipped', 'todo', 'disabled'].includes(a.status)).length;
  const failed = assertions.filter(a => a.status === 'failed').length;
  if (result.status === 'failed' || failed) {
    const text = String(result.message || '');
    const meaningful = text.split('\n').map(line => line.trim())
      .find(line => /^(?:[A-Za-z]+Error:|error:|Error:|FAIL|TypeError:|SyntaxError:|ReferenceError:)/.test(line));
    const detail = meaningful || text.split('\n').find(Boolean) || '';
    return { ok: false, reason: failed + ' test(s) en échec' +
      (detail ? ' — ' + detail.slice(0, 250) : '') };
  }
  if (!passed) return { ok: false, reason: 'aucun test passé (succès à vide)' };
  if (skipped) return { ok: false, reason: `${skipped} test(s) ignoré(s) : preuve incomplète` };
  return { ok: true, reason: `${passed} test(s) passé(s)` };
}

function runFamily(family, files, { verbose } = {}) {
  const isBoutique = family === KIND.BOUTIQUE;
  const cwd = isBoutique ? path.join(ROOT, 'public', 'boutique') : ROOT;

  let jestBin;
  try {
    jestBin = require.resolve('jest/bin/jest', { paths: [cwd] });
  } catch {
    return new Map(files.map(f => [f, {
      ok: false,
      reason: `jest introuvable dans ${path.relative(ROOT, cwd) || '.'}`
    }]));
  }

  const verdicts = new Map();
  const batchSize = process.platform === 'win32' ? 1 : 16;

  for (let offset = 0; offset < files.length; offset += batchSize) {
    const batch = files.slice(offset, offset + batchSize);
    const number = Math.floor(offset / batchSize) + 1;

    const outFile = path.join(
      os.tmpdir(),
      `kmc-invariants-${family}-${process.pid}-${number}.json`
    );

    try {
      fs.unlinkSync(outFile);
    } catch { /* aucun ancien rapport */ }

    const targets = batch.map(f =>
      (isBoutique ? path.relative(cwd, path.join(ROOT, f)) : f)
        .replace(/\\/g, '/')
    );

    const args = [
      jestBin,
      '--json',
      `--outputFile=${outFile}`,
      '--no-coverage',
      '--forceExit',
      '--runInBand',
      '--ci'
    ];

    if (family === KIND.UNIT) {
      args.push('--config', 'jest.unit.config.js');
    }

    if (!verbose) args.push('--silent');
    args.push('--runTestsByPath', ...targets);

    const result = spawnSync(process.execPath, args, {
      cwd,
      env: process.env,
      stdio: 'pipe',
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      timeout: 30 * 60_000
    });

    let report = null;
    try {
      report = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    } catch { /* rapport absent ou invalide */ }

    try {
      fs.unlinkSync(outFile);
    } catch { /* nettoyage */ }

    if (result.error || result.status !== 0 || !report) {
      console.error(`Jest batch ${number}:`, {
        status: result.status,
        signal: result.signal,
        error: result.error?.message,
        reportExists: Boolean(report),
        stderr: (result.stderr || '').slice(-1500)
      });
    }

    const byFile = new Map(
      (report?.testResults || []).map(r => [
        path.relative(ROOT, r.name || r.testFilePath || '')
          .replace(/\\/g, '/'),
        r
      ])
    );

    for (const file of batch) {
      const proof = evaluateFileResult(byFile.get(file));

      if (result.error || !report) {
        verdicts.set(file, {
          ok: false,
          reason: `Jest interrompu ou rapport absent (lot ${number}, exit ${result.status}, ${result.error?.message || 'sans rapport'})`
        });
      } else if (result.status !== 0 && proof.ok) {
        verdicts.set(file, {
          ok: false,
          reason: `Jest a quitté avec le code ${result.status} dans le lot ${number}`
        });
      } else {
        verdicts.set(file, proof);
      }
    }

    console.log(
      `  Jest ${family} lot ${number}: ${batch.length} fichier(s), exit ${result.status}`
    );
  }

  return verdicts;
}
function parseRunArg(argv) {
  const arg = argv.find(a => a.startsWith('--run='));
  if (!arg) return [];
  const list = arg.slice('--run='.length).split(',').map(s => s.trim()).filter(Boolean);
  if (list.includes('all')) return [KIND.UNIT, 'db', KIND.BOUTIQUE];
  const known = new Set([KIND.UNIT, 'db', KIND.BOUTIQUE]);
  for (const k of list) if (!known.has(k)) throw new Error(`--run inconnu : ${k} (unit, db, boutique, all)`);
  return list;
}

function main(argv = process.argv.slice(2)) {
  const strict = argv.includes('--strict');
  const verbose = argv.includes('--verbose');
  const families = parseRunArg(argv);
  const features = loadFeatures();
  const { executable, textual } = collect(features);

  const base = resolveBase(argv);
  if (!base) {
    console.log('✗ commit de base introuvable (--base <sha> ou origin/main) : cliquet non vérifiable');
    return strict ? 1 : 0;
  }
  const baseline = textualAtBase(base);
  const runners = loadRunners();
  const staticErr = staticFindings(executable, runners);
  const ratchet = ratchetFindings(textual, baseline);
  const totalTextual = Object.values(textual).reduce((s, n) => s + n, 0);

  console.log('Feature Invariant Check');
  console.log(`  ${features.length} carte(s) · ${executable.length} invariant(s) exécutable(s) · ${totalTextual} textuel(s) · base ${base.slice(0, 9)}`);
  for (const f of staticErr) console.log(`✗ ${f.code}  [${f.feature}] ${f.statement.slice(0, 80)}\n   test : ${f.test} (${f.kind})`);
  for (const r of ratchet) console.log(`✗ CLIQUET_TEXTUEL  [${r.feature}] ${r.count} invariant(s) textuel(s) > ${r.max} au commit de base — déclarer le nouvel invariant sous forme { statement, test }`);

  let runErr = 0;
  for (const family of families) {
    if (family === 'db' && !process.env.DATABASE_URL) {
      console.log('✗ DATABASE_URL absent : la famille db ne peut pas être prouvée (jamais de skip)');
      runErr++;
      continue;
    }
    const files = [...new Set(executable
      .filter(i => RUN_FAMILY[classifyTest(i.test)] === family && fs.existsSync(path.resolve(ROOT, i.test)))
      .map(i => i.test))].sort();
    const verdicts = runFamily(family, files, { verbose });
    let ok = 0;
    for (const [file, v] of verdicts) {
      if (v.ok) { ok++; continue; }
      runErr++;
      const owners = executable.filter(i => i.test === file).map(i => i.feature);
      console.log(`✗ PREUVE_ÉCHOUÉE  [${[...new Set(owners)].join(', ')}] ${file} — ${v.reason}`);
    }
    console.log(`  famille ${family} : ${ok}/${files.length} fichier(s) prouvé(s)`);
  }

  const errors = staticErr.length + ratchet.length + runErr;
  if (!errors) {
    console.log(`✔ invariants : liens officiels OK, cliquet OK${families.length ? `, exécution ${families.join('+')} OK` : ''}`);
    return 0;
  }
  console.log(`✗ ${errors} écart(s)`);
  return strict ? 1 : 0;
}

if (require.main === module) process.exit(main());

module.exports = {
  KIND, globToRegExp, loadRunners, classifyTest, coveredByOfficialRunner, collect, evalCard, textualAtBase,
  staticFindings, ratchetFindings, evaluateFileResult, parseRunArg, main,
};
