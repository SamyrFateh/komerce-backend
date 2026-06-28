#!/usr/bin/env node
/**
 * gen-backend-arch-live.js — Génère docs/BACKEND_ARCHITECTURE_LIVE.md
 *
 * Photographie l'état RÉEL du backend à un instant T : inventaire routes/
 * et services/, variables d'environnement requises, snapshot console.log,
 * collisions de migrations, score d'architecture (délégué à
 * audit-backend-arch.js, qui reste la seule source de vérité sur les
 * violations — ce script ne réimplémente pas les invariants).
 *
 * Jamais édité à la main. Régénéré par : npm run backend:arch
 *
 * Diffère de docs/backend/BACKEND_ARCHITECTURE.md (normatif, édité à la main).
 *
 * Usage : node scripts/gen-backend-arch-live.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT          = process.env.ROOT || process.cwd();
const ROUTES_DIR     = path.join(ROOT, 'routes');
const SERVICES_DIR   = path.join(ROOT, 'services');
const MIGRATIONS_DIR  = path.join(ROOT, 'migrations');
const SERVER_FILE     = path.join(ROOT, 'server.js');
const PACKAGE_JSON    = path.join(ROOT, 'package.json');
const VALIDATE_ENV    = path.join(ROOT, 'scripts', 'validate-required-env.js');
const AUDIT_SCRIPT    = path.join(__dirname, 'audit-backend-arch.js');
const OUT             = path.join(ROOT, 'docs', 'BACKEND_ARCHITECTURE_LIVE.md');

// ════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════

function readFile(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; }
}

function walkJs(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJs(full, results);
    else if (entry.name.endsWith('.js')) results.push(full);
  }
  return results;
}

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

function countLines(p) {
  const c = readFile(p);
  return c ? c.split('\n').length : 0;
}

function countRoutes(content) {
  const m = content.match(/router\.(get|post|put|patch|delete|all)\s*\(/g);
  return m ? m.length : 0;
}

function declaredRole(content) {
  const m = content.match(/@role\s+(\S+)/);
  return m ? m[1] : '—';
}

function countConsoleLog(content) {
  const lines = content.split('\n');
  let n = 0;
  for (const line of lines) {
    if (/console\.(log|debug)\s*\(/.test(line) && !line.trim().startsWith('//')) n++;
  }
  return n;
}

// ════════════════════════════════════════════════════════════════
// §1-2 — Inventaire routes/ et services/
// ════════════════════════════════════════════════════════════════

function inventory(dir) {
  return walkJs(dir)
    .map((f) => {
      const content = readFile(f);
      return {
        file: rel(f),
        lines: countLines(f),
        routes: countRoutes(content),
        role: declaredRole(content),
        consoleLog: countConsoleLog(content),
      };
    })
    .sort((a, b) => b.lines - a.lines);
}

// ════════════════════════════════════════════════════════════════
// §3 — REQUIRED_ENV (scripts/validate-required-env.js, source réelle)
// ════════════════════════════════════════════════════════════════

function inventoryRequiredEnv() {
  const content = readFile(VALIDATE_ENV);
  const requiredMatch = content.match(/REQUIRED_ENV\s*=\s*\[([\s\S]*?)\]/);
  const recommendedMatch = content.match(/RECOMMENDED_ENV\s*=\s*\[([\s\S]*?)\]/);
  const parseList = (block) =>
    block ? [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];

  const required = parseList(requiredMatch && requiredMatch[1]);
  const recommended = parseList(recommendedMatch && recommendedMatch[1]);

  // Vérification live : ce script de validation est-il réellement appelé
  // au démarrage (server.js) ou en CI/scripts npm (package.json) ?
  const serverContent = readFile(SERVER_FILE);
  const pkgContent = readFile(PACKAGE_JSON);
  const wiredInServer = /validate-required-env/.test(serverContent);
  const wiredInPackageJson = /validate-required-env/.test(pkgContent);

  return { required, recommended, wiredInServer, wiredInPackageJson, exists: !!content };
}

// ════════════════════════════════════════════════════════════════
// §5 — Collisions de migrations
// ════════════════════════════════════════════════════════════════

function inventoryMigrationCollisions() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));

  // Même règle que I-BACK-10 (audit-backend-arch.js) : la convention
  // NNNb_/NNNc_ (addendums numérotés) est intentionnelle et n'est PAS une
  // collision. La vraie collision : un fichier "bare" NNN.sql qui coexiste
  // avec NNN_description.sql — ambigu sur l'ordre d'exécution du runner.
  const bareFiles = files.filter((f) => /^\d+\.sql$/.test(f));
  const collisions = [];
  for (const bare of bareFiles) {
    const num = bare.replace('.sql', '');
    const siblings = files.filter((f) => f !== bare && f.startsWith(`${num}_`));
    if (siblings.length > 0) collisions.push({ num, files: [bare, ...siblings].sort() });
  }
  return collisions;
}

// ════════════════════════════════════════════════════════════════
// §6 — Score architecture : délégué à audit-backend-arch.js
// ════════════════════════════════════════════════════════════════

function runAudit() {
  const result = spawnSync('node', [AUDIT_SCRIPT], { cwd: ROOT, encoding: 'utf8' });
  const stdout = result.stdout || '';
  const warnMatch = stdout.match(/(\d+)\s+avertissement/);
  const violMatch = stdout.match(/(\d+)\s+violation\(s\) nouvelle/);
  const clean = /Aucune violation\. Architecture conforme/.test(stdout);
  return {
    exitCode: result.status,
    warnings: warnMatch ? parseInt(warnMatch[1], 10) : 0,
    violations: clean ? 0 : (violMatch ? parseInt(violMatch[1], 10) : (result.status === 0 ? 0 : null)),
    raw: stdout,
  };
}

// ════════════════════════════════════════════════════════════════
// Rendu markdown
// ════════════════════════════════════════════════════════════════

function render() {
  const routesInv   = inventory(ROUTES_DIR);
  const servicesInv = inventory(SERVICES_DIR);
  const env         = inventoryRequiredEnv();
  const collisions  = inventoryMigrationCollisions();
  const audit       = runAudit();

  let md = `# Backend Komerce — Architecture LIVE (généré)\n\n`;
  md += `> Généré par \`scripts/gen-backend-arch-live.js\` (\`npm run backend:arch\`).\n`;
  md += `> Ne jamais éditer ce fichier à la main — régénérer. Document normatif : \`docs/backend/BACKEND_ARCHITECTURE.md\`.\n\n`;
  md += `---\n\n`;

  // ── §1 routes/ ────────────────────────────────────────────────
  md += `## 1. Inventaire \`routes/\` (${routesInv.length} fichiers)\n\n`;
  md += `| Fichier | Lignes | Routes détectées | console.log |\n|---|---:|---:|---:|\n`;
  for (const r of routesInv) {
    const flag = r.lines > 1500 ? ' 🔴' : r.lines > 800 ? ' ⚠️' : '';
    md += `| \`${r.file}\`${flag} | ${r.lines} | ${r.routes} | ${r.consoleLog || ''} |\n`;
  }
  md += `\n> 🔴 > 1500 lignes (I-BACK-2 erreur) — ⚠️ > 800 lignes (I-BACK-2 warning).\n\n`;

  // ── §2 services/ ──────────────────────────────────────────────
  md += `## 2. Inventaire \`services/\` (${servicesInv.length} fichiers)\n\n`;
  md += `| Fichier | Lignes | Rôle déclaré (\`@role\`) | console.log |\n|---|---:|---|---:|\n`;
  for (const s of servicesInv) {
    const flag = s.lines > 1500 ? ' 🔴' : s.lines > 800 ? ' ⚠️' : '';
    md += `| \`${s.file}\`${flag} | ${s.lines} | ${s.role} | ${s.consoleLog || ''} |\n`;
  }
  md += `\n`;

  // ── §3 REQUIRED_ENV ───────────────────────────────────────────
  md += `## 3. Variables d'environnement requises\n\n`;
  if (!env.exists) {
    md += `\`scripts/validate-required-env.js\` introuvable — aucune source détectée.\n\n`;
  } else {
    md += `Source : \`scripts/validate-required-env.js\`.\n\n`;
    md += `**REQUIRED_ENV** (${env.required.length}) : ${env.required.map((v) => `\`${v}\``).join(', ') || '_(aucune)_'}\n\n`;
    md += `**RECOMMENDED_ENV** (${env.recommended.length}) : ${env.recommended.map((v) => `\`${v}\``).join(', ') || '_(aucune)_'}\n\n`;
    if (!env.wiredInServer && !env.wiredInPackageJson) {
      md += `⚠️ **Constat live** : ce script n'est référencé ni dans \`server.js\` ni dans \`package.json\`. ` +
            `Il existe mais n'est appelé par rien — le contrôle au démarrage qu'il décrit n'est pas actif. ` +
            `À traiter comme une dette explicite (brancher en \`prestart\`/CI, ou archiver s'il est obsolète), pas à corriger silencieusement ici.\n\n`;
    } else {
      md += `✅ Branché : ${env.wiredInServer ? '\`server.js\`' : ''}${env.wiredInServer && env.wiredInPackageJson ? ' + ' : ''}${env.wiredInPackageJson ? '\`package.json\`' : ''}.\n\n`;
    }
  }

  // ── §4 console.log snapshot ───────────────────────────────────
  const allFiles = [...routesInv, ...servicesInv].filter((f) => f.consoleLog > 0);
  md += `## 4. Snapshot \`console.log\`/\`console.debug\` (routes/ + services/)\n\n`;
  md += `> Informatif : \`I-BACK-7\` (script \`audit-backend-arch.js\`) détecte les nouveaux fichiers via la date de création, ` +
        `**pas** via la constante \`CONSOLE_LOG_BASELINE\` (déclarée dans le script mais non utilisée à ce jour — ` +
        `à garder en tête si elle doit un jour être réactivée).\n\n`;
  if (allFiles.length === 0) {
    md += `Aucune occurrence. ✅\n\n`;
  } else {
    const total = allFiles.reduce((s, f) => s + f.consoleLog, 0);
    md += `${total} occurrence(s) au total, répartition :\n\n`;
    md += `| Fichier | Nombre |\n|---|---:|\n`;
    allFiles
      .sort((a, b) => b.consoleLog - a.consoleLog)
      .forEach((f) => { md += `| \`${f.file}\` | ${f.consoleLog} |\n`; });
    md += `\n`;
  }

  // ── §5 Collisions migrations ──────────────────────────────────
  md += `## 5. Collisions de numéros de migration\n\n`;
  md += `> Règle I-BACK-10 exacte : un fichier "bare" \`NNN.sql\` qui coexiste avec \`NNN_description.sql\`. ` +
        `La convention \`NNNb_\`/\`NNNc_\` (addendums numérotés) est intentionnelle, pas une collision.\n\n`;
  if (collisions.length === 0) {
    md += `Aucune. ✅\n\n`;
  } else {
    md += `${collisions.length} collision(s) détectée(s) — violations I-BACK-10.\n\n`;
    md += `| Numéro | Fichiers |\n|---|---|\n`;
    collisions.forEach((c) => { md += `| ${c.num} | ${c.files.map((f) => `\`${f}\``).join('<br>')} |\n`; });
    md += `\n`;
  }

  // ── §6 Score architecture ─────────────────────────────────────
  md += `## 6. Score architecture (délégué à \`audit-backend-arch.js\`)\n\n`;
  if (audit.exitCode === 0 && audit.violations === 0) {
    md += `- **Statut** : ✅ conforme (\`npm run backend:audit\` exit 0)\n`;
  } else if (audit.exitCode === null) {
    md += `- **Statut** : ⚠️ impossible d'exécuter \`audit-backend-arch.js\` (voir logs)\n`;
  } else {
    md += `- **Statut** : ❌ ${audit.violations ?? '?'} violation(s) nouvelle(s) bloquante(s)\n`;
  }
  md += `- **Avertissements connus** (violations existantes, lots prévus) : ${audit.warnings}\n`;
  md += `- **Violations nouvelles** (cible : 0) : ${audit.violations ?? 'n/a'}\n\n`;
  md += `Détail complet : \`npm run backend:audit\`.\n\n`;

  md += `---\n\n*Généré par \`scripts/gen-backend-arch-live.js\`. Document normatif : \`docs/backend/BACKEND_ARCHITECTURE.md\`.*\n`;

  return md;
}

// ════════════════════════════════════════════════════════════════
const outDir = path.dirname(OUT);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(OUT, render(), 'utf8');
console.log(`  ✓  ${rel(OUT)} généré (${(fs.statSync(OUT).size / 1024).toFixed(1)} KB)`);
