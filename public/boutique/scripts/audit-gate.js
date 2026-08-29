#!/usr/bin/env node
/**
 * ============================================================
 * KOMERCE BOUTIQUE — Audit Gate (Niveau 1 — Pyramide Qualité)
 * ============================================================
 *
 * Le workspace Boutique est un workspace d'outillage frontend : Jest,
 * Playwright, Babel, stylelint, serveur local, etc. vivent principalement en
 * devDependencies. `npm audit --omit=dev` rendait donc ce gate artificiellement
 * vert en excluant presque toute la surface réellement installée par `npm ci`.
 *
 * Le gate audite désormais l'arbre COMPLET du workspace avec `npm audit --json`.
 * Il bloque toute vulnérabilité high/critical non acceptée et conserve le
 * cliquet historique uniquement pour d'éventuelles dettes explicitement revues.
 *
 * Usage :
 *   node scripts/audit-gate.js
 *   node scripts/audit-gate.js --strict
 *   node scripts/audit-gate.js --accept
 *   node scripts/audit-gate.js --json
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(__dirname, '.audit-baseline.json');

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = { strict: false, json: false, accept: false };
  for (const arg of argv) {
    if (arg === '--strict') parsed.strict = true;
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--accept') parsed.accept = true;
  }
  return parsed;
}

const BLOCKING_LEVELS = new Set(['high', 'critical']);

function runNpmAudit(exec = execSync) {
  try {
    const out = exec('npm audit --json', {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20,
    });
    return JSON.parse(out);
  } catch (error) {
    // npm audit retourne un exit code non nul lorsqu'il trouve des vulnérabilités,
    // mais son JSON exploitable reste disponible sur stdout.
    if (error.stdout) {
      try { return JSON.parse(error.stdout); } catch { /* fallthrough */ }
    }
    throw new Error(`npm audit n'a pas produit de JSON exploitable : ${error.message}`);
  }
}

function extractFindings(report) {
  const findings = [];
  const vulnerabilities = report.vulnerabilities || {};
  for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
    if (!BLOCKING_LEVELS.has(vulnerability.severity)) continue;
    const via = Array.isArray(vulnerability.via)
      ? vulnerability.via
        .map(item => (typeof item === 'string' ? item : item.title || item.name))
        .filter(Boolean)
      : [];
    findings.push({
      name,
      severity: vulnerability.severity,
      range: vulnerability.range || null,
      fixAvailable: Boolean(vulnerability.fixAvailable),
      via,
    });
  }
  return findings.sort((a, b) => a.name.localeCompare(b.name));
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  try { return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')); }
  catch { return null; }
}

function saveBaseline(findings, metadata) {
  const baseline = {
    savedAt: new Date().toISOString(),
    totalAccepted: findings.length,
    accepted: findings.map(item => ({
      name: item.name,
      severity: item.severity,
      range: item.range,
    })),
    metadata,
  };
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  return baseline;
}

function acceptedKey(finding) {
  return `${finding.name}@${finding.range || '*'}`;
}

function evaluate(report, baseline = loadBaseline()) {
  const findings = extractFindings(report);
  const metadata = report.metadata?.vulnerabilities || {};
  const acceptedKeys = new Set((baseline?.accepted || []).map(acceptedKey));
  const newFindings = findings.filter(item => !acceptedKeys.has(acceptedKey(item)));
  const knownFindings = findings.filter(item => acceptedKeys.has(acceptedKey(item)));
  return { metadata, findings, newFindings, knownFindings, baseline };
}

function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const report = runNpmAudit();
  const evaluated = evaluate(report);

  if (args.accept) {
    const baseline = saveBaseline(evaluated.findings, evaluated.metadata);
    console.log(`\n  📌 Baseline figée : ${baseline.totalAccepted} vulnérabilité(s) high/critical explicitement acceptée(s).\n`);
    console.log('  ⚠️  Toute nouvelle vulnérabilité high/critical reste bloquante.\n');
    return 0;
  }

  if (args.json) {
    console.log(JSON.stringify({
      metadata: evaluated.metadata,
      findings: evaluated.findings,
      newFindings: evaluated.newFindings,
      knownFindings: evaluated.knownFindings,
    }, null, 2));
    return args.strict && evaluated.newFindings.length > 0 ? 1 : 0;
  }

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  KOMERCE BOUTIQUE — Audit Gate (arbre npm complet)       ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  console.log(`  Vulnérabilités high/critical : ${evaluated.findings.length}`);
  console.log(`  Dette connue (baseline)      : ${evaluated.knownFindings.length}`);
  console.log(`  Nouvelles (non acceptées)    : ${evaluated.newFindings.length}\n`);

  if (evaluated.findings.length === 0) {
    console.log('  ✅ Audit N1 — CONFORME (0 vulnérabilité high/critical sur l’arbre installé).\n');
  } else {
    if (evaluated.knownFindings.length > 0) {
      console.log('  ── Dette connue explicitement acceptée ─────────────────────\n');
      for (const finding of evaluated.knownFindings) {
        console.log(`  ⚠️  [${finding.severity.toUpperCase()}] ${finding.name}${finding.range ? ` ${finding.range}` : ''}${finding.fixAvailable ? ' (fix dispo)' : ''}`);
      }
      console.log('');
    }

    if (evaluated.newFindings.length > 0) {
      console.log('  ── Nouvelles vulnérabilités bloquantes ─────────────────────\n');
      for (const finding of evaluated.newFindings) {
        console.log(`  ❌ [${finding.severity.toUpperCase()}] ${finding.name}${finding.range ? ` ${finding.range}` : ''}${finding.fixAvailable ? ' (fix dispo)' : ''}`);
        if (finding.via.length) console.log(`     via : ${finding.via.join(', ')}`);
      }
      console.log(`\n  ❌ Audit N1 — ${evaluated.newFindings.length} nouvelle(s) vulnérabilité(s) high/critical.\n`);
    } else {
      console.log('  ✅ Audit N1 — aucune nouvelle vulnérabilité high/critical.\n');
    }
  }

  if (!evaluated.baseline && evaluated.findings.length > 0) {
    console.log(`  ℹ️  Aucune baseline trouvée (${path.relative(ROOT, BASELINE_PATH)}).`);
    console.log('  Ne pas utiliser --accept par réflexe : corriger d’abord la dépendance si possible.\n');
  }

  return args.strict && evaluated.newFindings.length > 0 ? 1 : 0;
}

if (require.main === module) process.exit(run());

module.exports = {
  BLOCKING_LEVELS,
  parseArgs,
  runNpmAudit,
  extractFindings,
  acceptedKey,
  evaluate,
  run,
};
