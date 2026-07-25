#!/usr/bin/env node
/**
 * ============================================================
 * KOMERCE BOUTIQUE — Audit Gate (Niveau 1 — Pyramide Qualité)
 * Version 1.0.0 · 2026-06
 * 0 dépendances externes — Node.js >= 18 (utilise `npm audit --json`)
 * Doctrine : docs/doctrine/QUALITY_PYRAMID_DOCTRINE.md (Niveau 1)
 * ============================================================
 *
 * Porte d'entrée de la pyramide : exécute `npm audit --json`, bloque sur
 * toute vulnérabilité high/critical, et maintient un cliquet anti-régression :
 * une fois une vulnérabilité connue et acceptée (--accept), elle ne réapparaît
 * pas dans les violations bloquantes — mais toute NOUVELLE vulnérabilité
 * high/critical fait échouer le gate, même si le total baisse.
 *
 * Usage :
 *   node scripts/audit-gate.js                → rapport
 *   node scripts/audit-gate.js --strict       → exit(1) si vuln. high/critical non acceptée (CI)
 *   node scripts/audit-gate.js --accept       → fige l'état courant comme baseline acceptée
 *   node scripts/audit-gate.js --json         → sortie JSON machine
 */

'use strict';

const fs            = require('fs');
const path          = require('path');
const { execSync }  = require('child_process');

const ROOT          = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(__dirname, '.audit-baseline.json');

const args = (() => {
  const a = { strict: false, json: false, accept: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--strict') a.strict = true;
    else if (arg === '--json') a.json = true;
    else if (arg === '--accept') a.accept = true;
  }
  return a;
})();

const BLOCKING_LEVELS = new Set(['high', 'critical']);

// ── Exécution de npm audit ───────────────────────────────────────────────────

function runNpmAudit() {
  try {
    const out = execSync('npm audit --json --omit=dev', { cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 });
    return JSON.parse(out);
  } catch (e) {
    // npm audit retourne un exit code != 0 dès qu'il y a des vulnérabilités —
    // mais le JSON utile est dans stdout malgré l'exception.
    if (e.stdout) {
      try { return JSON.parse(e.stdout); } catch { /* fallthrough */ }
    }
    throw new Error(`npm audit n'a pas produit de JSON exploitable : ${e.message}`);
  }
}

// ── Extraction des vulnérabilités bloquantes (high/critical) ───────────────

function extractFindings(report) {
  const findings = [];
  const vulns = report.vulnerabilities || {};
  for (const [name, v] of Object.entries(vulns)) {
    if (!BLOCKING_LEVELS.has(v.severity)) continue;
    const via = Array.isArray(v.via)
      ? v.via.map(x => (typeof x === 'string' ? x : x.title || x.name)).filter(Boolean)
      : [];
    findings.push({
      name,
      severity: v.severity,
      range: v.range || null,
      fixAvailable: !!v.fixAvailable,
      via,
    });
  }
  return findings.sort((a, b) => a.name.localeCompare(b.name));
}

// ── Baseline (cliquet) ───────────────────────────────────────────────────────

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  try { return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')); } catch { return null; }
}

function saveBaseline(findings, meta) {
  const baseline = {
    savedAt: new Date().toISOString(),
    totalAccepted: findings.length,
    accepted: findings.map(f => ({ name: f.name, severity: f.severity, range: f.range })),
    metadata: meta,
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
  return baseline;
}

function acceptedKey(f) { return `${f.name}@${f.range || '*'}`; }

// ── Run ───────────────────────────────────────────────────────────────────────

function run() {
  const report   = runNpmAudit();
  const findings = extractFindings(report);
  const meta      = report.metadata && report.metadata.vulnerabilities || {};

  if (args.accept) {
    const baseline = saveBaseline(findings, meta);
    console.log(`\n  📌 Baseline figée : ${baseline.totalAccepted} vulnérabilité(s) high/critical acceptée(s) comme dette connue.\n`);
    console.log('  ⚠️  Toute NOUVELLE vulnérabilité high/critical fera quand même échouer --strict.\n');
    return;
  }

  const baseline      = loadBaseline();
  const acceptedKeys  = new Set((baseline ? baseline.accepted : []).map(acceptedKey));
  const newFindings   = findings.filter(f => !acceptedKeys.has(acceptedKey(f)));
  const knownFindings = findings.filter(f => acceptedKeys.has(acceptedKey(f)));

  if (args.json) {
    console.log(JSON.stringify({ metadata: meta, findings, newFindings, knownFindings }, null, 2));
    if (args.strict && newFindings.length > 0) process.exit(1);
    return;
  }

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  KOMERCE BOUTIQUE — Audit Gate (N1 — dépendances)        ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  console.log(`  Vulnérabilités high/critical : ${findings.length}`);
  console.log(`  Dette connue (baseline)      : ${knownFindings.length}`);
  console.log(`  Nouvelles (non acceptées)    : ${newFindings.length}\n`);

  if (findings.length === 0) {
    console.log('  ✅ Audit N1 — CONFORME (0 vulnérabilité high/critical).\n');
  } else {
    if (knownFindings.length > 0) {
      console.log('  ── Dette connue (baseline acceptée, non bloquante) ──────────\n');
      for (const f of knownFindings) {
        console.log(`  ⚠️  [${f.severity.toUpperCase()}] ${f.name}${f.range ? ' ' + f.range : ''}${f.fixAvailable ? ' (fix dispo)' : ''}`);
      }
      console.log('');
    }
    if (newFindings.length > 0) {
      console.log('  ── Nouvelles vulnérabilités (bloquantes) ────────────────────\n');
      for (const f of newFindings) {
        console.log(`  ❌ [${f.severity.toUpperCase()}] ${f.name}${f.range ? ' ' + f.range : ''}${f.fixAvailable ? ' (fix dispo)' : ''}`);
        if (f.via.length) console.log(`     via : ${f.via.join(', ')}`);
      }
      console.log(`\n  ❌ Audit N1 — ${newFindings.length} nouvelle(s) vulnérabilité(s) high/critical non acceptée(s).\n`);
    } else {
      console.log('  ✅ Audit N1 — aucune NOUVELLE vulnérabilité high/critical (dette connue gelée par le cliquet).\n');
    }
  }

  if (!baseline && findings.length > 0) {
    console.log(`  ℹ️  Aucune baseline trouvée (${path.relative(ROOT, BASELINE_PATH)}). Lancer --accept pour figer la dette actuelle.\n`);
  }

  if (args.strict && newFindings.length > 0) {
    console.log('  ── Mode --strict : exit(1)\n');
    process.exit(1);
  }
}

run();
