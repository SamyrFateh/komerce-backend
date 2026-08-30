#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  CONTRACTS,
  DASHBOARD_METRICS,
  CI_REQUIRED,
  remediationForBackendDebt,
  remediationForGateFinding,
} = require('./agent-remediation-contract.js');

const ROOT = path.resolve(__dirname, '..');
const scopeArg = process.argv.find(a => a.startsWith('--scope='));
const ONLY_SCOPE = scopeArg ? scopeArg.split('=')[1] : null;
const REQUIRED_FIELDS = ['scope', 'owner', 'cause', 'action', 'forbidden', 'baselinePolicy', 'severity'];

function fail(errors, message) { errors.push(message); }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function readJson(rel) { return JSON.parse(read(rel)); }

function checkCatalog(errors) {
  for (const [code, rule] of Object.entries(CONTRACTS)) {
    if (ONLY_SCOPE && rule.scope !== ONLY_SCOPE && rule.scope !== 'governance') continue;
    for (const field of REQUIRED_FIELDS) {
      if (rule[field] == null || rule[field] === '') fail(errors, `${code}: champ ${field} manquant`);
    }
    if (rule.baselinePolicy !== 'never-increase-to-pass') fail(errors, `${code}: baselinePolicy doit interdire le gonflement pour passer`);
  }
}

function checkDashboardCoverage(errors) {
  if (ONLY_SCOPE && ONLY_SCOPE !== 'dashboard') return;
  const baseline = readJson('scripts/.dashboards-360-baseline.json');
  for (const key of Object.keys(baseline).filter(k => k !== 'savedAt')) {
    if (!DASHBOARD_METRICS[key]) fail(errors, `Dashboard metric sans remédiation: ${key}`);
  }
  if (!DASHBOARD_METRICS.unprovenContracts) fail(errors, 'Dashboard informational metric unprovenContracts sans remédiation');
}

function currentBackendDebts() {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'debt-audit.js'), '--json'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || 'backend:debt failed');
  const parsed = JSON.parse(r.stdout);
  return Array.isArray(parsed) ? parsed : (parsed.debts || parsed.items || []);
}

function checkBackendDebtCoverage(errors) {
  if (ONLY_SCOPE && ONLY_SCOPE !== 'backend') return;
  for (const debt of currentBackendDebts()) {
    const rem = remediationForBackendDebt(debt);
    if (!rem?.code || !CONTRACTS[rem.code]) fail(errors, `Backend debt sans remédiation: ${debt.rule || debt.label}`);
    if (Number(debt.count || 0) > 0 && (!rem?.owner || !rem?.action || !rem?.forbidden)) {
      fail(errors, `Backend debt incomplet pour agent: ${debt.rule || debt.label}`);
    }
  }
}

function checkGateFindingCoverage(errors) {
  const model = readJson('docs/GATE_FINDINGS.json');
  for (const finding of model.findings || []) {
    if (ONLY_SCOPE && finding.scope && finding.scope !== ONLY_SCOPE && !(ONLY_SCOPE === 'backend' && finding.scope === 'root')) continue;
    const rem = remediationForGateFinding(finding);
    if (!rem?.code || !CONTRACTS[rem.code]) fail(errors, `Gate finding sans remédiation: ${finding.gate} ${finding.message}`);
  }
}

function checkWorkflowCoverage(errors) {
  const workflow = read('.github/workflows/pr-enforcement.yml');
  for (const item of CI_REQUIRED) {
    const contract = CONTRACTS[item.code];
    if (ONLY_SCOPE && contract?.scope !== ONLY_SCOPE && contract?.scope !== 'governance') continue;
    if (!workflow.includes(item.needle)) fail(errors, `${item.code}: gate CI attendu absent (${item.needle})`);
  }
}

function checkIndexFresh(errors) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'gen-agent-remediation-index.js'), '--check'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  if (r.status !== 0) fail(errors, String(r.stderr || r.stdout || 'Agent Remediation Index stale').trim());
}

function main() {
  const errors = [];
  try {
    checkCatalog(errors);
    checkDashboardCoverage(errors);
    checkBackendDebtCoverage(errors);
    checkGateFindingCoverage(errors);
    checkWorkflowCoverage(errors);
    checkIndexFresh(errors);
  } catch (e) {
    fail(errors, e.message);
  }
  if (errors.length) {
    console.error(`✖ Agent Remediation Contract — ${errors.length} violation(s)`);
    errors.forEach(e => console.error(`  - ${e}`));
    console.error('→ Corriger le contrat/source; ne pas exclure le gate ni relever une baseline pour obtenir du vert.');
    return 1;
  }
  console.log(`✔ Agent Remediation Contract conforme${ONLY_SCOPE ? ` — scope ${ONLY_SCOPE}` : ''}.`);
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { checkCatalog, checkDashboardCoverage, checkBackendDebtCoverage, checkGateFindingCoverage, checkWorkflowCoverage };
