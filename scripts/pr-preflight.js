#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          pre-pr-fail-fast-orchestrator
 * @domain        infrastructure
 * @layer         tooling
 * @criticality   high
 * @inputs        git diff versus base branch, existing canonical governance gates, .github/workflows/pr-enforcement.yml (parité)
 * @outputs       fail-fast preflight verdict before opening or updating a PR — rejoue tout gate CI reproductible localement ; tampon pre-push sur HEAD quand vert
 * @depends       scripts/pr-enforcement-scope.js, scripts/lib/preflight-stamp.js, scripts/setup-hooks-runner.js, npm scripts declared in package.json
 * @used-by       AGENTS.md, developers and coding agents before PR creation
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      carte_first, feature_first, debt_zero, green_before_pr, reuse_existing_gates
 * @impact-areas  governance, ci, developer-workflow
 * @version       2026-10-v2
 */
'use strict';

const cp = require('child_process');
const path = require('path');
const { classifyDiff } = require('./pr-enforcement-scope');
const stamp = require('./lib/preflight-stamp');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function argValue(flag, fallback = null) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

function has(flag) {
  return args.includes(flag);
}

function git(argsList) {
  const r = cp.spawnSync('git', argsList, { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || `git ${argsList.join(' ')} failed`).trim());
  }
  return String(r.stdout || '').trim();
}

function resolveBase(rawBase = 'origin/main') {
  try {
    return git(['rev-parse', rawBase]);
  } catch {
    throw new Error(
      `Base "${rawBase}" introuvable. Exécuter "git fetch origin main" puis relancer npm run pr:preflight.`
    );
  }
}

function command(label, file, argv, options = {}) {
  return { label, file, argv, ...options };
}

function npmRun(label, script, extra = []) {
  return command(label, npmBin, ['run', script, ...(extra.length ? ['--', ...extra] : [])]);
}

function nodeRun(label, script, extra = []) {
  return command(label, process.execPath, [script, ...extra]);
}

const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function inProcess(label, fn) {
  return { label, file: '(preflight)', argv: [], fn };
}

// Projections dérivées que la CI régénère puis RESTAURE avant `git diff
// --exit-code` (jobs changes et governance) : elles ne rendent jamais une PR
// rouge. Le preflight applique exactement la même exclusion. Le test de parité
// vérifie que cette liste reste égale aux `git restore` du workflow.
const CI_RESTORED_PROJECTIONS = Object.freeze([
  'docs/_generated/route-registry.json',
  'docs/komerce-arch-header-graph.json',
  'docs/KOMERCE_ARCH_HEADER_GRAPH.md',
  'docs/BUSINESS_FEATURE_GRAPH.json',
  'docs/BUSINESS_FEATURE_GRAPH.md',
  'docs/O6_INVENTORY.md',
  'docs/FEATURE_360.json',
  'docs/FEATURE_360.md',
  'docs/AGENT_REMEDIATION_INDEX.json',
]);

// Étapes de la CI volontairement non rejouées en local, avec leur raison.
// Toute autre commande de la CI doit être rejouée par le preflight : le test de
// parité (tests/unit/pr-preflight-ci-parity.test.js) échoue sinon.
const CI_ONLY = Object.freeze({
  'scripts/pr-governance-check.js': 'lit le corps de PR via l’API GitHub : n’existe qu’après ouverture de la PR',
  'scripts/pr-enforcement-scope.js': 'classification du diff : réutilisée en processus par le preflight (classifyDiff)',
  'scripts/ci-unit-repair-scope.js': 'optimisation CI des pushes de réparation de tests (saute les jobs lourds) : aucun gate à rejouer',
  'test:unit:coverage': 'suite complète + seuil global (~6 min) : en local, tests liés, et suite complète forcée dès qu’une migration change',
  'scripts/ci-db-bootstrap.js': 'exige un PostgreSQL reconstruit (job from-scratch)',
  'test:integration': 'exige un PostgreSQL reconstruit (job from-scratch)',
  'scripts/e2e-impact-scope.js': 'exige un PostgreSQL reconstruit (job from-scratch)',
  'scripts/run-e2e-feature-tests.js': 'exige un PostgreSQL reconstruit (job from-scratch)',
  'test:e2e:features': 'exige un PostgreSQL reconstruit (job from-scratch)',
});

function list(value) {
  return Array.isArray(value) ? value : [];
}

function trackedChanges() {
  // Même périmètre que `git diff --exit-code` en CI : fichiers suivis seulement.
  const names = git(['diff', '--name-only', 'HEAD']).split('\n').filter(Boolean);
  const state = new Map();
  for (const name of names) {
    let digest = 'deleted';
    try {
      digest = git(['hash-object', '--', name]);
    } catch {
      digest = 'deleted';
    }
    state.set(name, digest);
  }
  return state;
}

function assertTreeUnchanged(before) {
  const after = trackedChanges();
  const mutated = [];
  const restored = [];
  for (const [name, digest] of after) {
    if (before.get(name) === digest) continue;
    if (CI_RESTORED_PROJECTIONS.includes(name)) {
      if (!before.has(name)) {
        git(['checkout', '--', name]);
        restored.push(name);
      }
      continue;
    }
    mutated.push(name);
  }
  for (const name of before.keys()) {
    if (!after.has(name) && !CI_RESTORED_PROJECTIONS.includes(name)) mutated.push(name);
  }
  if (restored.length) {
    console.log(`  projections CI régénérées puis restaurées : ${restored.join(', ')}`);
  }
  if (mutated.length) {
    throw new Error(
      `un gate a modifié des fichiers suivis (la CI échouerait sur "git diff --exit-code") : ${mutated.join(', ')}. ` +
      'Régénérer et committer ces artefacts dérivés, puis relancer.'
    );
  }
}

function assertFullHistory() {
  if (git(['rev-parse', '--is-shallow-repository']) === 'true') {
    throw new Error(
      'historique git superficiel : les gates de migration exigent l’historique complet, comme la CI. ' +
      'Exécuter "git fetch --unshallow origin" puis relancer.'
    );
  }
}

function buildPlan(scope, baseSha, headSha = 'HEAD', options = {}) {
  const before = options.treeSnapshot || null;
  const plan = [
    npmRun('Feature registry', 'feature:registry'),
    npmRun('Feature card schema', 'gate:schema'),
    npmRun('Touched files ownership', 'gate:touched-files', ['--base', baseSha]),
    npmRun('Docs history', 'gate:docs-lint'),
    nodeRun('Impact suppression hygiene', 'scripts/impact-suppression-check.js'),
    // Parité CI (job changes) : registre de routes hydraté avant l'audit.
    nodeRun('Route registry hydration', 'scripts/gen-route-registry.js'),
    npmRun('Feature audit', 'gate:feature-audit'),
    nodeRun('Debt Zero', 'scripts/debt-zero-gate.js', ['--base', baseSha, '--head', headSha]),
  ];

  if (scope.cjPilotProofOnly) {
    plan.push(command('CJ pilot report syntax', process.execPath, ['--check', 'scripts/cj-three-real-staging-pilot.js']));
  }

  if (scope.providerProofOnly) {
    plan.push(
      command('Provider proof syntax', process.execPath, ['--check', 'scripts/external-provider-batch-proof.js']),
      command('Provider proof unit contract', npxBin, ['jest', 'tests/unit/external-provider-batch-proof.test.js', '--runInBand', '--silent']),
      nodeRun('Provider offline inventory', 'scripts/external-provider-batch-proof.js', [
        '--mode=inventory', '--providers=all', '--out=artifacts/provider-contract-batch/report.json',
      ])
    );
  }

  if (scope.backend || scope.dashboard || scope.boutique) {
    plan.push(
      nodeRun('Touched tests / completion-at-contact', 'scripts/touched-tests-gate.js', [
        '--base', baseSha,
        '--strict',
      ])
    );
  }

  if (scope.backend) {
    // Les migrations rejoignent les fichiers backend : run-staged-related-tests
    // force alors la suite unitaire complète (angle mort n°1), ce qui rejoue en
    // local ce que la couverture CI attrape (ex. collision de numéro).
    const relatedFiles = [...list(scope.backendFiles), ...list(scope.migrationFiles)];
    plan.push(
      npmRun('Npm audit gate', 'audit:gate'),
      npmRun('Backend code quality', 'quality:gate'),
      command('Catalog + sourcing certification invariants', npxBin, [
        'jest',
        'tests/unit/certification-accounting.test.js',
        'tests/unit/catalog-certification.test.js',
        'tests/unit/sourcing-certification.test.js',
        '--runInBand', '--silent',
      ]),
      npmRun('Backend feature guard', 'feature:check'),
      nodeRun('Contract consumer check', 'scripts/contract-check.js'),
      npmRun('Security 360 freshness and ratchet', 'security:360:check'),
      nodeRun('Related unit tests', 'scripts/run-staged-related-tests.js', ['--files', relatedFiles.join(',')])
    );
  }

  if (scope.golden) {
    plan.push(nodeRun('Golden CDR parity', 'tools/golden-cdr/golden-cdr.js', ['verify']));
  }

  if (scope.migrations) {
    plan.push(
      inProcess('Migration history depth', assertFullHistory),
      nodeRun('Migration immutability', 'scripts/check-migration-immutability.js', ['--base', baseSha, '--head', headSha]),
      nodeRun('Schema freshness', 'scripts/check-schema-freshness.js'),
      nodeRun('Schema intent documentation', 'scripts/check-schema-intent-doc.js', ['--base', baseSha, '--head', headSha])
    );
    if (scope.schemaDump) {
      plan.push(nodeRun('Schema anti-resurrection', 'scripts/check-schema-resurrection.js'));
    }
  }

  if (scope.governance) {
    plan.push(
      npmRun('Architecture graph refresh', 'arch:gen'),
      nodeRun('Governance projections hydration', 'scripts/ci-refresh-governance-projections.js'),
      nodeRun('Architecture header hygiene', 'scripts/arch-db-check.js'),
      nodeRun('Headers ↔ SQL', 'scripts/arch-header-sql-check.js'),
      nodeRun('Hub authority gate', 'scripts/hub-authority-gate.js'),
      // Déjà exécuté par « Backend feature guard » (npm run feature:check) si backend.
      ...(scope.backend ? [] : [nodeRun('Feature slice guard', 'scripts/feature-guard.js', ['--strict'])]),
      nodeRun('Business graph semantic check', 'scripts/business-graph-gen.js', [
        '--check', '--dash-root', 'public', '--boutique-root', 'public/boutique',
      ]),
      npmRun('Business graph ratchet', 'business-graph:ratchet-check'),
      npmRun('Business graph dependency disposition', 'business-graph:disposition-check'),
      nodeRun('Feature 360 projection check', 'scripts/feature-360-check.js'),
      nodeRun('Agent remediation contract', 'scripts/check-agent-remediation-contract.js'),
      nodeRun('Agent remediation index check', 'scripts/gen-agent-remediation-index.js', ['--check'])
    );
  }

  if (scope.dashboard) {
    plan.push(npmRun('Dashboard 360 structural ratchet', 'dashboards:360:check'));
  }

  if (scope.boutique) {
    plan.push(
      command('Boutique fast gates', npmBin, ['--prefix', 'public/boutique', 'run', 'check:fast']),
      nodeRun('Boutique global ownership', 'scripts/boutique-ownership-full-check.js', ['--strict']),
      nodeRun('Boutique selector ownership', 'public/boutique/scripts/check-selector-ownership.js'),
      nodeRun('Boutique runtime CSS var ownership', 'public/boutique/scripts/check-runtime-css-var-ownership.js')
    );
    if (scope.boutiqueCss) {
      plan.push(
        nodeRun('Boutique CSS vars', 'public/boutique/scripts/check-css-vars.js', ['--strict']),
        nodeRun('Boutique z-index contract', 'public/boutique/scripts/check-zindex-contract.js', ['--strict']),
        nodeRun('Boutique sticky integrity', 'public/boutique/scripts/check-sticky-integrity.js', ['--strict'])
      );
    }
    if (scope.boutiqueJs) {
      plan.push(nodeRun('Sanitization on added front lines', 'scripts/arch-doctrine-sanitize-check.js', [`--diff=${baseSha}`]));
    }
  }

  // Parité CI : chaque job finit par `git diff --exit-code`. Un gate qui
  // réécrit un fichier suivi signale un artefact dérivé non committé.
  plan.push(inProcess('Tree unchanged (derived artifacts)', () => assertTreeUnchanged(before || new Map())));

  return plan;
}

function runPlan(plan, dryRun = false) {
  for (let i = 0; i < plan.length; i += 1) {
    const step = plan[i];
    process.stdout.write(`\n[${i + 1}/${plan.length}] ${step.label}\n`);
    if (step.fn) {
      if (!dryRun) {
        try {
          step.fn();
        } catch (error) {
          throw new Error(`${step.label} : ${error.message}`);
        }
      }
      continue;
    }
    process.stdout.write(`  $ ${step.file} ${step.argv.join(' ')}\n`);
    if (dryRun) continue;
    const r = cp.spawnSync(step.file, step.argv, {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    });
    if (r.error) throw r.error;
    if (r.status !== 0) {
      throw new Error(`${step.label} a échoué (exit ${r.status}). Corriger avant d'ouvrir/mettre à jour la PR.`);
    }
  }
}

function main() {
  const baseRef = argValue('--base', process.env.PREFLIGHT_BASE || 'origin/main');
  const headRef = argValue('--head', 'HEAD');
  const baseSha = resolveBase(baseRef);
  const headSha = git(['rev-parse', headRef]);
  const scope = classifyDiff(baseSha, headSha);
  const treeSnapshot = trackedChanges();
  const plan = buildPlan(scope, baseSha, headSha, { treeSnapshot });
  const dryRun = has('--dry-run');
  require('./setup-hooks-runner').ensureInstalled();
  const markGreen = () => {
    const reason = stamp.refusal({ dryRun, headRef, dirtyFiles: treeSnapshot.size });
    if (reason) {
      console.log(`(tampon pre-push non posé : ${reason})`);
      return;
    }
    stamp.writeGreen({ sha: headSha, gitPath: name => git(['rev-parse', '--git-path', name]) });
  };

  console.log('\nKOMERCE — GREEN BEFORE PR');
  console.log(`base: ${baseRef} (${baseSha.slice(0, 8)})`);
  console.log(`head: ${headSha.slice(0, 8)}`);
  console.log(`changed: ${scope.changedFiles.length}`);
  console.log(`scope: backend=${scope.backend} dashboard=${scope.dashboard} boutique=${scope.boutique} migrations=${scope.migrations} governance=${scope.governance}`);

  if (!scope.changedFiles.length) {
    console.log('\n✔ Aucun changement à valider.');
    markGreen();
    return;
  }

  runPlan(plan, dryRun);
  markGreen();
  console.log('\n✔ PRE-FLIGHT VERT — la PR peut maintenant servir de preuve indépendante.');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`\n✖ PRE-FLIGHT BLOQUÉ — ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  CI_ONLY,
  CI_RESTORED_PROJECTIONS,
  assertFullHistory,
  assertTreeUnchanged,
  buildPlan,
  resolveBase,
  runPlan,
  trackedChanges,
};
