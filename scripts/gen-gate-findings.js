#!/usr/bin/env node
'use strict';

/**
 * scripts/gen-gate-findings.js — P3b, palier clôture.
 *
 *   Ne crée AUCUN gate. Exécute les gates existants qui exposent déjà une
 *   sortie --json avec attribution exploitable (feature et/ou fichier), et
 *   normalise leur sortie brute en un flux plat de findings :
 *
 *     { gate, scope, type, verdict, feature, file, message }
 *
 *   verdict est déduit uniquement de la colonne d'origine du gate
 *   (errors -> 'fail', warnings -> 'warn') — aucun score recalculé, aucun
 *   message reformulé : `message` est copié tel quel depuis `msg`.
 *
 *   Sources actuelles (les 3 seules dont la sortie --json porte une
 *   attribution feature/file exploitable au niveau finding, pas seulement
 *   au niveau summary) :
 *     - scripts/feature-registry-check.js            (scope: root)
 *     - public/boutique/scripts/feature-registry-check.js (scope: boutique)
 *     - scripts/feature-classification-check.js       (scope: root)
 *
 *   Écrit docs/GATE_FINDINGS.json. Sortie déterministe (tri stable).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'docs', 'GATE_FINDINGS.json');
const VERSION = 'GF-1.0';

const SOURCES = [
  { gate: 'gate:feature-registry-check', scope: 'root', script: 'scripts/feature-registry-check.js' },
  { gate: 'gate:feature-registry-check', scope: 'boutique', script: 'public/boutique/scripts/feature-registry-check.js' },
  { gate: 'gate:feature-classification-check', scope: 'root', script: 'scripts/feature-classification-check.js' },
];

function runGate(scriptRel) {
  const abs = path.join(ROOT, scriptRel);
  try {
    const stdout = execFileSync(process.execPath, [abs, '--json'], {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    });
    return { ok: true, json: JSON.parse(stdout) };
  } catch (e) {
    // Le gate peut sortir en code non-zéro (mode strict) tout en imprimant
    // un JSON valide sur stdout — on tente quand même de le parser.
    const stdout = e.stdout ? String(e.stdout) : '';
    try {
      return { ok: true, json: JSON.parse(stdout) };
    } catch (_) {
      return { ok: false, error: e.message };
    }
  }
}

// Normalise une entrée brute {type, feature, file, msg} d'un gate en finding
// plat. Ne réécrit jamais msg. feature/file sont copiés tels quels (peuvent
// être absents, multiples via ", ", ou null) — la résolution d'attribution
// (fichier -> feature canonique, désambiguïsation) est faite en aval par la
// projection Feature 360, jamais ici.
function normalizeEntry(gate, scope, verdict, entry) {
  return {
    gate, scope, verdict,
    type: entry.type || 'UNKNOWN',
    feature: entry.feature != null ? String(entry.feature) : null,
    file: entry.file != null ? String(entry.file).replace(/\\/g, '/') : null,
    message: entry.msg != null ? String(entry.msg) : '',
  };
}

function main() {
  const findings = [];
  const sourcesReport = [];

  for (const src of SOURCES) {
    const result = runGate(src.script);
    if (!result.ok) {
      sourcesReport.push({ gate: src.gate, scope: src.scope, script: src.script, status: 'failed', error: result.error });
      continue;
    }
    const j = result.json;
    const errors = Array.isArray(j.errors) ? j.errors : [];
    const warnings = Array.isArray(j.warnings) ? j.warnings : [];
    for (const e of errors) findings.push(normalizeEntry(src.gate, src.scope, 'fail', e));
    for (const w of warnings) findings.push(normalizeEntry(src.gate, src.scope, 'warn', w));
    sourcesReport.push({
      gate: src.gate, scope: src.scope, script: src.script, status: 'ok',
      errorCount: errors.length, warningCount: warnings.length,
    });
  }

  findings.sort((a, b) => {
    const ka = `${a.gate}::${a.scope}::${a.type}::${a.feature}::${a.file}::${a.message}`;
    const kb = `${b.gate}::${b.scope}::${b.type}::${b.feature}::${b.file}::${b.message}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const model = {
    version: VERSION,
    generatedAt: new Date().toISOString().slice(0, 10), // date seule — déterminisme des tests
    sources: sourcesReport,
    findings,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(model, null, 2) + '\n');
  console.log(`docs/GATE_FINDINGS.json : ${sourcesReport.length} source(s), ${findings.length} finding(s)`);
  for (const s of sourcesReport) {
    if (s.status === 'failed') console.log(`  ✖ ${s.gate} (${s.scope}) — ${s.error}`);
    else console.log(`  ✔ ${s.gate} (${s.scope}) — ${s.errorCount} error(s), ${s.warningCount} warning(s)`);
  }
}

if (require.main === module) main();
module.exports = { main, SOURCES };
