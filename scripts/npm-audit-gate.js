#!/usr/bin/env node
/**
 * GOV-03 — npm audit gate (port Node.js, cross-platform)
 *
 * Usage:
 *   npm run audit:gate          // bloquant (exit 1 si moderate/high/critical)
 *   npm run audit:gate:observe  // observatoire (exit 0 toujours, log seulement)
 *   node scripts/npm-audit-gate.js --cwd=public/boutique   // audite un autre package.json du repo
 *
 * Câblage package.json :
 *   "audit:gate":         "node scripts/npm-audit-gate.js",
 *   "audit:gate:observe": "node scripts/npm-audit-gate.js --observe"
 *
 * Câblage public/boutique/package.json (dépendances isolées : stylelint,
 * @playwright/test — jamais auditées par le gate racine) :
 *   "audit:gate": "node ../../scripts/npm-audit-gate.js --cwd=."
 *
 * Note: utilise --json pour éviter la dépendance à l'endpoint legacy npm
 * /v1/security/audits/quick (retiré juin 2026). L'API bulk advisory reste
 * accessible via `npm audit --json` (auditReportVersion: 2).
 *
 * Doctrine GOV-03 : le gate doit livrer, dans sa propre sortie, tout ce
 * qu'il faut pour corriger — fichier:ligne + correctif exact — sans
 * renvoyer relancer une commande pour aller chercher l'info à la main.
 * (cf. scripts/audit-backend-arch.js, qui suit déjà ce standard.)
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { actionableVulnerabilities, inheritedBlockingCount } = require('./lib/npm-audit-core');

const cwdArg = process.argv.find(a => a.startsWith('--cwd='));
const ROOT = cwdArg ? path.resolve(cwdArg.slice('--cwd='.length)) : path.join(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const EXCEPTIONS_PATH = path.join(ROOT, 'scripts', 'npm-audit-exceptions.json');

const MODE = process.argv.includes('--observe') ? 'observe' : 'blocking';

console.log('╔══════════════════════════════════════════════════════════╗');
console.log(`║  GOV-03 — npm audit gate (mode: ${MODE.padEnd(22)})║`);
console.log('╚══════════════════════════════════════════════════════════╝');

// ── 1. Récupération du rapport ────────────────────────────────────────────

let rawOutput = '';
try {
  rawOutput = execSync('npm audit --json', { encoding: 'utf8', cwd: ROOT });
} catch (err) {
  rawOutput = err.stdout || '';
  if (!rawOutput) {
    console.error('⚠️  npm audit failed to run:', (err.stderr || err.message).slice(0, 200));
    process.exit(MODE === 'observe' ? 0 : 1);
  }
}

let data;
try {
  const match = rawOutput.match(/\{[\s\S]*\}/);
  data = JSON.parse(match ? match[0] : rawOutput);
} catch (e) {
  console.error('⚠️  Could not parse npm audit JSON:', e.message.slice(0, 100));
  process.exit(MODE === 'observe' ? 0 : 1);
}

const meta = (data.metadata || {}).vulnerabilities || {};
console.log(
  `\n📦 Vulnerabilities: critical=${meta.critical || 0} high=${meta.high || 0} ` +
  `moderate=${meta.moderate || 0} low=${meta.low || 0} total=${meta.total || 0}`
);

const allVulns = data.vulnerabilities || {};
let targets = actionableVulnerabilities(allVulns);
const inheritedCount = inheritedBlockingCount(allVulns);
if (inheritedCount > 0) {
  console.log(`ℹ️  npm audit v2: ${inheritedCount} entrée(s) héritée(s) moderate/high/critical regroupée(s) sous leur advisory source.`);
}

if (targets.length === 0) {
  console.log('\n✅ npm audit: 0 moderate/high/critical vulnerabilities');
  process.exit(0);
}

// ── 2. Exceptions datées (scripts/npm-audit-exceptions.json) ──────────────
// Format attendu : [{ "package": "foo", "expires": "2026-12-31", "reason": "..." }]

let exceptions = [];
if (fs.existsSync(EXCEPTIONS_PATH)) {
  try {
    exceptions = JSON.parse(fs.readFileSync(EXCEPTIONS_PATH, 'utf8'));
  } catch (e) {
    console.log(`⚠️  scripts/npm-audit-exceptions.json illisible (${e.message.slice(0, 80)}) — ignoré.`);
  }
}

const today = new Date().toISOString().slice(0, 10);
const exceptionFor = (name) => exceptions.find(x => x.package === name);

const expiredExceptions = [];
targets = targets.filter(v => {
  const ex = exceptionFor(v.name);
  if (!ex) return true;
  if (!ex.expires || ex.expires < today) {
    expiredExceptions.push({ name: v.name, ex });
    return true;
  }
  return false;
});

if (targets.length === 0) {
  console.log(`\n✅ npm audit: vulnérabilité(s) moderate/high/critical couverte(s) par exception valide.`);
  process.exit(0);
}

// ── 3. Localisation dans package.json ──────────────────────────────────────

const pkgRaw = fs.readFileSync(PKG_PATH, 'utf8');
const pkgLines = pkgRaw.split('\n');
const pkgJson = JSON.parse(pkgRaw);

function findLineFor(depName) {
  const escaped = depName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^\\s*"${escaped}"\\s*:`);
  for (let i = 0; i < pkgLines.length; i++) {
    if (re.test(pkgLines[i])) return i + 1;
  }
  return null;
}

function declaredRangeFor(depName) {
  return (pkgJson.dependencies || {})[depName] || (pkgJson.devDependencies || {})[depName] || null;
}

function resolveAncestor(v) {
  if (v.isDirect) return { name: v.name, direct: true };

  const nodePath = (v.nodes && v.nodes[0]) || '';
  const segments = nodePath.split('node_modules/').filter(Boolean).map(s => s.replace(/\/$/, ''));

  if (segments.length > 0) {
    const outer = segments[0];
    if (outer !== v.name && declaredRangeFor(outer)) {
      return { name: outer, direct: true, viaChain: segments };
    }
  }

  for (const eff of v.effects || []) {
    if (declaredRangeFor(eff)) return { name: eff, direct: true, viaChain: [eff, v.name] };
  }

  return { name: v.name, direct: false, viaChain: segments.length ? segments : [v.name] };
}

// ── 4. Détail de l'avis (titre, CWE, URL) ──────────────────────────────────

function advisoryDetail(v) {
  const advisories = (v.via || []).filter(x => typeof x === 'object');
  if (advisories.length === 0) {
    const causes = (v.via || []).filter(x => typeof x === 'string');
    return causes.length
      ? { text: `hérité de ${causes.join(', ')} (voir leur propre entrée)`, url: null }
      : { text: "(pas de détail d'avis disponible)", url: null };
  }
  const a = advisories[0];
  const cwe = (a.cwe || [])[0] ? ` [${a.cwe[0]}]` : '';
  return { text: `${a.title || '(sans titre)'}${cwe} — affecte ${a.range || v.range || '*'}`, url: a.url || null };
}

// ── 5. Rendu ────────────────────────────────────────────────────────────────

console.log(`\n⚠️  npm audit: ${targets.length} vulnérabilité(s) moderate/high/critical à traiter :\n`);

if (expiredExceptions.length) {
  console.log('── EXCEPTIONS EXPIRÉES (redeviennent bloquantes) ──');
  for (const { name, ex } of expiredExceptions) {
    console.log(`  ⏰ ${name} — exception expirée le ${ex.expires || '(date absente)'} : "${ex.reason || '(raison absente)'}"`);
    console.log('     → supprimer l\'entrée si le correctif est disponible ; toute prolongation nécessite une validation humaine explicite.');
  }
  console.log('');
}

const byTier = { critical: [], high: [], moderate: [] };
for (const v of targets) byTier[v.severity].push(v);

for (const tier of ['critical', 'high', 'moderate']) {
  if (byTier[tier].length === 0) continue;
  console.log(`── ${tier.toUpperCase()} (${byTier[tier].length}) ──`);

  for (const v of byTier[tier]) {
    const adv = advisoryDetail(v);
    console.log(`  ❌ ${v.name} — ${adv.text}`);
    if (adv.url) console.log(`       ${adv.url}`);

    const ancestor = resolveAncestor(v);

    if (ancestor.direct) {
      const line = findLineFor(ancestor.name);
      const range = declaredRangeFor(ancestor.name);
      if (line) {
        console.log(`     → package.json:${line} — "${ancestor.name}": "${range}"${
          ancestor.viaChain ? ` (introduit ${v.name} via ${ancestor.viaChain.join(' → ')})` : ''
        }`);
      } else {
        console.log(`     → dépendance directe "${ancestor.name}" (ligne non localisée — vérifier package.json)`);
      }
    } else {
      console.log(`     → transitive, chaîne : ${ancestor.viaChain.join(' → ')} (aucun ancêtre direct identifié dans package.json)`);
    }

    if (v.fixAvailable === true) {
      console.log(`     ✅ Correctif : \`npm audit fix\` suffit pour "${v.name}" (pas de breaking change).`);
    } else if (v.fixAvailable && typeof v.fixAvailable === 'object') {
      const f = v.fixAvailable;
      const breaking = f.isSemVerMajor ? ' ⚠️  MAJOR — breaking change probable' : '';
      console.log(`     ✅ Correctif : \`npm install ${f.name}@${f.version}\` (ou supérieur).${breaking}`);
      const fLine = findLineFor(f.name);
      if (fLine) console.log(`        Ligne à modifier : package.json:${fLine}`);
    } else {
      console.log('     ⛔ Aucun correctif amont publié. Options :');
      console.log('        (a) exception datée dans scripts/npm-audit-exceptions.json avec validation humaine explicite');
      console.log(`        (b) \`npm install ${v.name}@latest --force\` (⚠️ casse possible — à tester)`);
      console.log(`        (c) remplacer la dépendance "${v.name}"`);
    }
    console.log('');
  }
}

if (MODE === 'observe') {
  console.log('ℹ️  Mode observe — pas de blocage CI');
  process.exit(0);
} else {
  console.log(`❌ Mode bloquant — CI fail (${targets.length} violation(s) listée(s) ci-dessus, chacune avec sa correction).`);
  process.exit(1);
}
