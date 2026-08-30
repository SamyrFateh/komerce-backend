#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  CONTRACT_VERSION,
  CONTRACTS,
  DASHBOARD_METRICS,
  remediationForBackendDebt,
  remediation,
} = require('./agent-remediation-contract.js');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'AGENT_REMEDIATION_INDEX.json');
const CHECK = process.argv.includes('--check');

function readJson(rel, fallback = null) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
  catch (_) { return fallback; }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (key === 'generatedAt' || key === 'savedAt') continue;
      out[key] = stable(value[key]);
    }
    return out;
  }
  return value;
}

function runBackendDebt() {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'debt-audit.js'), '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  if (r.status !== 0) throw new Error(`backend:debt failed: ${r.stderr || r.stdout}`);
  try { return JSON.parse(r.stdout); }
  catch (e) { throw new Error(`backend:debt JSON illisible: ${e.message}`); }
}

function backendSection() {
  const raw = runBackendDebt();
  const rows = Array.isArray(raw) ? raw : (raw.debts || raw.items || []);
  const measured = rows.map(row => ({
    rule: row.rule || null,
    label: row.label || null,
    count: Number(row.count || 0),
    entries: Array.isArray(row.entries) ? row.entries : [],
    lot: row.lot || null,
    note: row.note || null,
    remediation: remediationForBackendDebt(row),
  }));
  return {
    measuredCount: measured.length,
    openCount: measured.filter(x => x.count > 0 && x.remediation?.severity !== 'info').reduce((n, x) => n + x.count, 0),
    reviewedCount: measured.filter(x => x.count > 0 && x.remediation?.severity === 'info').reduce((n, x) => n + x.count, 0),
    measured,
  };
}

function dashboardSection() {
  const live = readJson('docs/DASHBOARDS_360.json', { summary: {} });
  const baseline = readJson('scripts/.dashboards-360-baseline.json', {});
  const summary = live.summary || {};
  const metrics = Object.entries(DASHBOARD_METRICS).map(([metric, code]) => ({
    metric,
    value: Number(summary[metric] || 0),
    baseline: metric === 'unprovenContracts' ? null : Array.isArray(baseline[metric]) ? baseline[metric].length : 0,
    remediation: remediation(code, { metric }),
  }));
  return {
    summary,
    blockingDebt: metrics.filter(m => m.metric !== 'unprovenContracts').reduce((n, m) => n + m.value, 0),
    informationalDebt: Number(summary.unprovenContracts || 0),
    metrics,
  };
}

function boutiqueSection() {
  const cascade = readJson('public/boutique/scripts/.css-guard-baseline.json', { total: null });
  const specificity = readJson('public/boutique/scripts/.css-specificity-guard-baseline.json', { total: null });
  const important = readJson('public/boutique/scripts/.important-baseline.json', { total: null, reviewedGuardIds: [] });
  const selectors = require(path.join(ROOT, 'public', 'boutique', 'scripts', 'critical-selector-ownership.js'));
  const runtimeVars = require(path.join(ROOT, 'public', 'boutique', 'scripts', 'runtime-css-var-ownership.js'));
  return {
    cascadeDebt: Number(cascade.total || 0),
    specificityDebt: Number(specificity.total || 0),
    importantOpenDebt: Number(important.total || 0),
    reviewedImportantGuards: important.reviewedGuardIds || [],
    criticalSelectorContracts: Object.keys(selectors.CRITICAL_SELECTOR_OWNERSHIP || {}).length,
    runtimeVariableContracts: Object.keys(runtimeVars.RUNTIME_CSS_VAR_OWNERSHIP || {}).length,
    remediation: {
      cascade: remediation('BOUTIQUE-CASCADE'),
      specificity: remediation('BOUTIQUE-SPECIFICITY'),
      important: remediation('BOUTIQUE-IMPORTANT'),
      selectorOwnership: remediation('BOUTIQUE-SELECTOR-OWNERSHIP'),
      runtimeVariableOwnership: remediation('BOUTIQUE-RUNTIME-VAR-OWNERSHIP'),
      globalOwnership: remediation('BOUTIQUE-GLOBAL-OWNERSHIP'),
    },
  };
}

function gateFindingsSection() {
  const gate = readJson('docs/GATE_FINDINGS.json', { version: null, sources: [], findings: [] });
  return {
    sourceVersion: gate.version || null,
    sources: (gate.sources || []).map(s => ({ gate: s.gate, scope: s.scope, status: s.status, errorCount: s.errorCount || 0, warningCount: s.warningCount || 0 })),
    currentFindings: (gate.findings || []).length,
  };
}

function buildModel() {
  return {
    version: 'ARI-1.0',
    contractVersion: CONTRACT_VERSION,
    generatedAt: new Date().toISOString().slice(0, 10),
    policy: {
      principle: '1 measured deviation = 1 stable remediation code = 1 canonical owner = 1 allowed repair path',
      baselineRule: 'never increase an allowlist/baseline only to make a gate pass',
      generatedTruth: 'regenerate this index from executable measurements; never hand-edit it',
    },
    backend: backendSection(),
    dashboard: dashboardSection(),
    boutique: boutiqueSection(),
    gateFindings: gateFindingsSection(),
    catalog: Object.fromEntries(Object.entries(CONTRACTS).map(([code, value]) => [code, value])),
  };
}

function main() {
  const model = buildModel();
  if (CHECK) {
    const current = readJson('docs/AGENT_REMEDIATION_INDEX.json');
    if (!current) {
      console.error('✖ AGENT_REMEDIATION_INDEX.json absent — lancer npm run agent:remediation:gen');
      return 1;
    }
    if (JSON.stringify(stable(current)) !== JSON.stringify(stable(model))) {
      console.error('✖ AGENT_REMEDIATION_INDEX.json stale — lancer npm run agent:remediation:gen puis commiter le résultat.');
      return 1;
    }
    console.log('✔ Agent Remediation Index frais et conforme aux mesures courantes.');
    return 0;
  }
  fs.writeFileSync(OUT, `${JSON.stringify(model, null, 2)}\n`, 'utf8');
  console.log(`✔ ${path.relative(ROOT, OUT)} généré.`);
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { stable, backendSection, dashboardSection, boutiqueSection, gateFindingsSection, buildModel };
