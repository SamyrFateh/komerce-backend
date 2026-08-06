#!/usr/bin/env node
'use strict';

/**
 * scripts/test-header-check.js — Gate : contrat d'exécution des tests
 * (mission "rendre le contexte d'exécution des tests explicite", Étape 4).
 *
 * Scanne chaque fichier de test EXÉCUTABLE (jamais importé — lecture pure)
 * et valide son header canonique :
 *
 *   /**
 *    * @test-kind unit|integration|e2e
 *    * @test-runner jest|playwright
 *    * @test-requires none|postgres|redis|webapp|...
 *    * /
 *
 * Détecte mécaniquement :
 *   - header absent
 *   - valeur inconnue (test-kind / test-runner)
 *   - combinaison impossible (ex: runner=playwright sur un .test.js, ou
 *     runner=jest sur un .spec.js hors périmètre boutique)
 *   - requires:none alors que le fichier utilise manifestement une
 *     infrastructure réelle (require('../../db') / new Pool / supertest
 *     contre un serveur réel, sans jest.mock ni garde DATABASE_URL)
 *   - suite mixte détectable (un fichier "unit"/requires:none qui contient
 *     encore le marqueur historique REAL_DB_INTEGRATION)
 *
 * Un nouveau test non classifié ne doit plus pouvoir entrer silencieusement :
 * ce gate est fait pour tourner dans testkit:check / predeploy, comme les
 * autres gates du repo (voir scripts/test-kit-usage-check.js pour le style
 * de sortie repris ici).
 *
 * Usage :
 *   node scripts/test-header-check.js            # rapport, exit 0
 *   node scripts/test-header-check.js --strict    # exit 1 si erreurs
 *   node scripts/test-header-check.js --json      # sortie machine
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const STRICT = args.includes('--strict');
const JSON_OUT = args.includes('--json');

const C = {
  red: '\x1b[31m', grn: '\x1b[32m', ylw: '\x1b[33m', dim: '\x1b[2m', r: '\x1b[0m',
};

// ── Périmètre : les mêmes groupes que l'inventaire Étape 1 ──────────────────
const GROUPS = [
  { dir: 'tests/unit', ext: '.test.js', expectRunner: 'jest' },
  { dir: 'tests/integration', ext: '.test.js', expectRunner: 'jest' },
  { dir: 'tests/e2e-api', ext: '.test.js', expectRunner: 'jest' },
  { dir: 'tests/contract', ext: '.test.js', expectRunner: 'jest' },
  { dir: 'tests/invariants', ext: '.test.js', expectRunner: 'jest' },
  { dir: 'tests/notifications', ext: '.test.js', expectRunner: 'jest' },
  { dir: 'public/boutique/tests', ext: '.test.js', expectRunner: 'jest', recursive: true },
  { dir: 'public/boutique/tests', ext: '.spec.js', expectRunner: 'playwright', recursive: true },
  { dir: 'public/dashboards/tests', ext: '.test.js', expectRunner: 'jest' },
];

const VALID_KIND = new Set(['unit', 'integration', 'e2e']);
const VALID_RUNNER = new Set(['jest', 'playwright']);
const VALID_REQUIRES = new Set(['none', 'postgres', 'redis', 'webapp']);

function listFiles({ dir, ext, recursive }) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const full = path.join(d, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        if (recursive) walk(full);
        continue;
      }
      if (name.endsWith(ext)) out.push(full);
    }
  };
  walk(abs);
  return out;
}

function parseHeader(content) {
  const m = content.match(/@test-kind\s+(\S+)[\s\S]*?@test-runner\s+(\S+)[\s\S]*?@test-requires\s+([^\n*]+)/);
  if (!m) return null;
  return {
    kind: m[1],
    runner: m[2],
    requires: m[3].split(',').map((s) => s.trim()).filter(Boolean),
  };
}

// Signaux qu'une vraie infra DB est utilisée sans garde ni mock — heuristique
// volontairement simple (le but est d'attraper les régressions grossières,
// pas de remplacer une revue humaine).
function looksLikeUnmockedRealDb(content) {
  const requiresDb = /require\(['"]\.\.\/\.\.\/db['"]\)/.test(content);
  if (!requiresDb) return false;
  const isMocked = /jest\.mock\(['"]\.\.\/\.\.\/db['"]/.test(content);
  const hasGuard = /DATABASE_URL/.test(content) || /e2eDbKit/.test(content) || /hasIntegrationEnv/.test(content);
  return requiresDb && !isMocked && !hasGuard;
}

function looksMixed(content, kind) {
  // Marqueur historique du repo pour un bloc REAL_DB à l'intérieur d'un
  // fichier par ailleurs unitaire — doit avoir été extrait (Étape 2).
  return kind === 'unit' && /REAL_DB_INTEGRATION/.test(content);
}

function main() {
  const errors = [];
  const warnings = [];
  let total = 0;
  const byKind = {};
  const byRunner = {};

  for (const group of GROUPS) {
    for (const abs of listFiles(group)) {
      total += 1;
      const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
      const content = fs.readFileSync(abs, 'utf8');
      const header = parseHeader(content);

      if (!header) {
        errors.push({ file: rel, code: 'MISSING_HEADER', detail: 'aucun header @test-kind trouvé' });
        continue;
      }

      if (!VALID_KIND.has(header.kind)) {
        errors.push({ file: rel, code: 'UNKNOWN_KIND', detail: `@test-kind ${header.kind}` });
      }
      if (!VALID_RUNNER.has(header.runner)) {
        errors.push({ file: rel, code: 'UNKNOWN_RUNNER', detail: `@test-runner ${header.runner}` });
      }
      for (const r of header.requires) {
        if (!VALID_REQUIRES.has(r)) {
          errors.push({ file: rel, code: 'UNKNOWN_REQUIRES', detail: `@test-requires ${r}` });
        }
      }

      if (header.runner !== group.expectRunner) {
        errors.push({
          file: rel, code: 'RUNNER_MISMATCH',
          detail: `extension/emplacement attend runner=${group.expectRunner}, header déclare ${header.runner}`,
        });
      }

      if (header.kind === 'unit' && !(header.requires.length === 1 && header.requires[0] === 'none')) {
        errors.push({
          file: rel, code: 'IMPOSSIBLE_COMBINATION',
          detail: `@test-kind unit avec @test-requires ${header.requires.join(',')} (attendu: none)`,
        });
      }

      if (header.requires.includes('none') && looksLikeUnmockedRealDb(content)) {
        errors.push({
          file: rel, code: 'REQUIRES_NONE_CONTRADICTED',
          detail: `require('../../db') non mocké et sans garde DATABASE_URL/e2eDbKit, mais @test-requires none`,
        });
      }

      if (looksMixed(content, header.kind)) {
        errors.push({
          file: rel, code: 'MIXED_SUITE',
          detail: `marqueur REAL_DB_INTEGRATION présent dans un fichier @test-kind unit — à extraire (mission Étape 2)`,
        });
      }

      byKind[header.kind] = (byKind[header.kind] || 0) + 1;
      byRunner[header.runner] = (byRunner[header.runner] || 0) + 1;
    }
  }

  const result = { total, byKind, byRunner, errors, warnings };

  if (JSON_OUT) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`${C.dim}Fichiers scannés : ${total}${C.r}`);
    console.log(`  by kind:    ${JSON.stringify(byKind)}`);
    console.log(`  by runner:  ${JSON.stringify(byRunner)}`);
    if (errors.length) {
      console.log(`\n${C.red}CLASSIFICATION ERRORS (${errors.length})${C.r}`);
      for (const e of errors) console.log(`  ${C.red}✖${C.r} ${e.file} — ${e.code}: ${e.detail}`);
    } else {
      console.log(`\n${C.grn}✔ aucune erreur de classification${C.r}`);
    }
  }

  if (STRICT && errors.length) {
    process.exitCode = 1;
  }
}

main();
