#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          pre-pr-fail-fast-orchestrator
 * @domain        infrastructure
 * @layer         tooling
 * @criticality   high
 * @inputs        git diff versus base branch, existing canonical governance gates
 * @outputs       fail-fast preflight verdict before opening or updating a PR
 * @depends       scripts/pr-enforcement-scope.js, npm scripts declared in package.json
 * @used-by       AGENTS.md, developers and coding agents before PR creation
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      carte_first, feature_first, debt_zero, green_before_pr, reuse_existing_gates
 * @impact-areas  governance, ci, developer-workflow
 * @version       2026-10-v1
 */
'use strict';

const cp = require('child_process');
const path = require('path');
const { classifyDiff } = require('./pr-enforcement-scope');

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

function buildPlan(scope, baseSha, headSha = 'HEAD') {
  const plan = [
    npmRun('Feature registry', 'feature:registry'),
    npmRun('Feature card schema', 'gate:schema'),
    npmRun('Touched files ownership', 'gate:touched-files', ['--base', baseSha]),
    npmRun('Docs history', 'gate:docs-lint'),
    npmRun('Feature audit', 'gate:feature-audit'),
    nodeRun('Debt Zero', 'scripts/debt-zero-gate.js', ['--base', baseSha, '--head', headSha]),
  ];

  if (scope.backend || scope.dashboard || scope.boutique) {
    plan.push(
      nodeRun('Touched tests / completion-at-contact', 'scripts/touched-tests-gate.js', [
        '--base', baseSha,
        '--strict',
      ])
    );
  }

  if (scope.backend) {
    plan.push(
      npmRun('Backend code quality', 'quality:gate'),
      npmRun('Backend feature guard', 'feature:check'),
      nodeRun('Contract consumer check', 'scripts/contract-check.js')
    );
  }

  if (scope.governance) {
    plan.push(
      npmRun('Architecture graph refresh', 'arch:gen'),
      nodeRun('Architecture header hygiene', 'scripts/arch-db-check.js'),
      nodeRun('Headers ↔ SQL', 'scripts/arch-header-sql-check.js'),
      npmRun('Business graph ratchet', 'business-graph:ratchet-check')
    );
  }

  if (scope.boutique) {
    plan.push(
      command('Boutique fast gates', npmBin, ['--prefix', 'public/boutique', 'run', 'check:fast'])
    );
  }

  return plan;
}

function runPlan(plan, dryRun = false) {
  for (let i = 0; i < plan.length; i += 1) {
    const step = plan[i];
    process.stdout.write(`\n[${i + 1}/${plan.length}] ${step.label}\n`);
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
  const plan = buildPlan(scope, baseSha, headSha);

  console.log('\nKOMERCE — GREEN BEFORE PR');
  console.log(`base: ${baseRef} (${baseSha.slice(0, 8)})`);
  console.log(`head: ${headSha.slice(0, 8)}`);
  console.log(`changed: ${scope.changedFiles.length}`);
  console.log(`scope: backend=${scope.backend} dashboard=${scope.dashboard} boutique=${scope.boutique} migrations=${scope.migrations} governance=${scope.governance}`);

  if (!scope.changedFiles.length) {
    console.log('\n✔ Aucun changement à valider.');
    return;
  }

  runPlan(plan, has('--dry-run'));
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
  buildPlan,
  resolveBase,
  runPlan,
};
