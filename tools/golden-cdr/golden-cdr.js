#!/usr/bin/env node
/**
 * GOLDEN CDR — Harnais de parité (LOT 0C-eco)
 * ==================================================================
 * Filet de référence du calcul CDR. Prérequis de TOUTE étape qui
 * déplace un prix (LOT 1A « BEFORE == AFTER », LOT 1B « DELTA EXPLIQUÉ »).
 *
 * Principe : le harnais appelle le VRAI computeCDR (services/pricing-cdr.js),
 * jamais une copie. Il fige un snapshot de config pour être DÉTERMINISTE :
 * le verdict de parité n'est alors imputable qu'au code, pas à la dérive DB.
 *
 *   MODE CAPTURE        node golden-cdr.js capture [--demo]
 *   MODE VERIFY         node golden-cdr.js verify [--demo]
 *   MODE TARGET         node golden-cdr.js target
 *   MODE PROMOTE-TARGET node golden-cdr.js promote-target
 */

'use strict';
const fs = require('fs');
const path = require('path');

const SERVICE_PATH = path.resolve(__dirname, '../../services/pricing-cdr.js');
let pricingCdr;
try {
  pricingCdr = require(SERVICE_PATH);
} catch (err) {
  console.error(`✗ Impossible de charger le service CDR (${SERVICE_PATH}) :\n  ${err.message}`);
  process.exit(2);
}
const { computeCDR, loadGlobalConfig } = pricingCdr;

const WITNESSES = require('./witnesses');
const {
  stableJSON,
  behaviorFingerprint,
  buildTargetDocument,
  assertPromotionPreconditions,
  buildPromotedDocument,
} = require('./target-promotion');

const GOLDEN_DIR = path.join(__dirname, 'golden');
const FIXTURE = path.join(__dirname, 'fixtures', 'config.demo.json');
const CURRENT_ARCHIVE = path.join(GOLDEN_DIR, 'cdr.golden.current.1b1.json');
const TARGET_1B1 = path.join(GOLDEN_DIR, 'cdr.golden.target.1b1.json');

function ri(n) { return Math.round(Number(n) || 0); }
function fingerprint(o) {
  return require('crypto').createHash('sha256').update(stableJSON(o)).digest('hex').slice(0, 16);
}

const CONF_ORDER = { high: 3, medium: 2, low: 1, none: 0 };
function minConfidence(allocs) {
  if (!allocs || !allocs.length) return 'none';
  return allocs.reduce((min, a) => (CONF_ORDER[a.confidence] ?? 1) < (CONF_ORDER[min] ?? 1) ? a.confidence : min, 'high');
}

function snapshotWitness(w, config) {
  const out = computeCDR(w.product, { config, volume_m3: w.ctx.volume_m3, channel: w.ctx.channel });
  const d = out.details || {};
  const allocs = d._allocations || [];
  const levels = allocs.reduce((acc, a) => { acc[a.allocation_level] = (acc[a.allocation_level] || 0) + 1; return acc; }, {});

  return {
    id: w.id,
    label: w.label,
    category: (w.product.category || null),
    channel: (w.ctx.channel || 'cash_relais'),
    breakdown: {
      purchase:     ri(d.product_cost),
      sourcing:     ri(d.sourcing),
      hub:          ri(d.hub),
      packaging:    ri(d.packaging),
      freight:      ri(d.freight),
      customs:      ri(d.customs),
      transitary:   ri(d.port_transitaire),
      distribution: ri(d.distribution),
      relay:        ri(d.relay),
      payment:      ri(d.payment),
      risk:         ri(d.risks),
      overhead:     ri(d.fixed_costs),
    },
    totals: {
      variable: ri(out.variable_cost_estimated_kmf),
      fixed:    ri(out.fixed_cost_allocation_kmf),
      risk:     ri(out.risk_provision_estimated_kmf),
      total:    ri(out.cost_complete_estimated_kmf),
    },
    provenance: {
      components_source: config.components_source || null,
      category_known:    Boolean(config.categories && config.categories[w.product.category]),
      volume_defaulted:  (w.ctx.volume_m3 == null),
      cost_zero:         (Number(w.product.cost_kmf) || 0) <= 0,
    },
    allocation: { levels, min_confidence: minConfidence(allocs) },
    warnings: (out.warnings || []).slice().sort(),
  };
}

async function loadConfig(demo) {
  if (demo) {
    const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    delete raw._note;
    return raw;
  }
  return loadGlobalConfig();
}

function goldenPath(demo) {
  return path.join(GOLDEN_DIR, demo ? 'cdr.golden.demo.json' : 'cdr.golden.json');
}

function readDoc(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeDoc(filePath, doc) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${stableJSON(doc)}\n`);
}

function buildSnapshots(config) {
  return WITNESSES.map(w => snapshotWitness(w, config));
}

async function capture(demo) {
  const config = await loadConfig(demo);
  const snapshots = buildSnapshots(config);
  const doc = {
    _kind: 'golden-cdr',
    captured_at: new Date().toISOString(),
    mode: demo ? 'demo' : 'db',
    config_fingerprint: fingerprint(config),
    witness_count: snapshots.length,
    frozen_config: config,
    snapshots,
  };
  const p = goldenPath(demo);
  writeDoc(p, doc);
  console.log(`✓ Golden capturé : ${path.relative(process.cwd(), p)}`);
  console.log(`  ${snapshots.length} témoins · config ${doc.config_fingerprint} · mode ${doc.mode}`);
  return doc;
}

function diffObjects(prefix, a, b, out) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) {
    const va = a ? a[k] : undefined, vb = b ? b[k] : undefined;
    if (va && typeof va === 'object' && !Array.isArray(va)) { diffObjects(`${prefix}.${k}`, va, vb, out); continue; }
    const sa = JSON.stringify(va), sb = JSON.stringify(vb);
    if (sa !== sb) out.push({ path: `${prefix}.${k}`, golden: va, current: vb });
  }
}

function compareDocumentToCode(golden, { print = true } = {}) {
  const config = golden.frozen_config;
  const byId = new Map((golden.snapshots || []).map(s => [s.id, s]));

  let fails = 0, checked = 0;
  const missing = [];
  const results = [];
  for (const w of WITNESSES) {
    const ref = byId.get(w.id);
    if (!ref) { missing.push(w.id); continue; }
    checked++;
    const cur = snapshotWitness(w, config);
    const diffs = [];
    diffObjects('breakdown', ref.breakdown, cur.breakdown, diffs);
    diffObjects('totals', ref.totals, cur.totals, diffs);
    diffObjects('provenance', ref.provenance, cur.provenance, diffs);
    if (JSON.stringify(ref.warnings) !== JSON.stringify(cur.warnings)) {
      diffs.push({ path: 'warnings', golden: ref.warnings, current: cur.warnings });
    }
    if (diffs.length) {
      fails++;
      results.push({ witness: w.id, label: w.label, diffs });
      if (print) {
        console.log(`\n✗ ${w.id} — ${w.label}`);
        for (const df of diffs) {
          console.log(`    ${df.path}\n        golden : ${JSON.stringify(df.golden)}\n        courant: ${JSON.stringify(df.current)}`);
        }
      }
    }
  }

  return { fails, checked, missing, results };
}

async function verify(demo) {
  const p = goldenPath(demo);
  if (!fs.existsSync(p)) {
    console.error(`✗ Golden absent : ${path.relative(process.cwd(), p)} — lance d'abord « capture ».`);
    process.exitCode = 2;
    return false;
  }
  const golden = readDoc(p);
  const result = compareDocumentToCode(golden, { print: true });

  console.log('');
  if (golden.snapshots.length !== WITNESSES.length || result.missing.length) {
    console.log(`⚠ Témoins non couverts par ce golden : ${result.missing.join(', ') || '(recompte)'} — re-capture nécessaire.`);
  }
  if (result.fails === 0 && !result.missing.length) {
    console.log(`✓ PARITÉ OK — ${result.checked} témoins identiques au golden (config ${golden.config_fingerprint}).`);
    return true;
  }
  console.log(`✗ PARITÉ ROMPUE — ${result.fails}/${result.checked} témoins divergent. Tout écart doit être EXPLIQUÉ (doctrine I-7) ou corrigé.`);
  process.exitCode = 1;
  return false;
}

function ensureCurrentArchive(official) {
  if (!fs.existsSync(CURRENT_ARCHIVE)) {
    writeDoc(CURRENT_ARCHIVE, official);
    console.log(`✓ CURRENT 1B-1 archivé : ${path.relative(process.cwd(), CURRENT_ARCHIVE)}`);
    return official;
  }

  const archive = readDoc(CURRENT_ARCHIVE);
  if (behaviorFingerprint(official) !== behaviorFingerprint(archive)) {
    throw new Error('CURRENT officiel diffère déjà de l’archive 1B-1 — refus de régénérer TARGET');
  }
  return archive;
}

function generateTarget() {
  const officialPath = goldenPath(false);
  if (!fs.existsSync(officialPath)) throw new Error('Golden CURRENT officiel absent');

  const official = readDoc(officialPath);
  const archive = ensureCurrentArchive(official);
  const snapshots = buildSnapshots(archive.frozen_config);
  const target = buildTargetDocument(archive, snapshots, new Date().toISOString());
  writeDoc(TARGET_1B1, target);

  const moved = archive.snapshots.reduce((count, before) => {
    const after = target.snapshots.find(s => s.id === before.id);
    return count + (JSON.stringify(before) === JSON.stringify(after) ? 0 : 1);
  }, 0);

  console.log(`✓ TARGET 1B-1 généré sans DB : ${path.relative(process.cwd(), TARGET_1B1)}`);
  console.log(`  ${target.witness_count} témoins · même config ${target.config_fingerprint} · ${moved} témoin(s) déplacé(s)`);
  console.log('  Étape suivante : vérifier le delta expliqué puis lancer « promote-target ».');
  return target;
}

function promoteTarget() {
  const officialPath = goldenPath(false);
  for (const p of [officialPath, CURRENT_ARCHIVE, TARGET_1B1]) {
    if (!fs.existsSync(p)) throw new Error(`Golden promotion: fichier absent ${path.relative(process.cwd(), p)}`);
  }

  const official = readDoc(officialPath);
  const archive = readDoc(CURRENT_ARCHIVE);
  const target = readDoc(TARGET_1B1);
  assertPromotionPreconditions({ official, archive, target });

  const targetCheck = compareDocumentToCode(target, { print: false });
  if (targetCheck.fails || targetCheck.missing.length) {
    throw new Error(`Golden promotion: TARGET ne correspond pas au code courant (${targetCheck.fails} divergence(s), ${targetCheck.missing.length} témoin(s) manquant(s))`);
  }

  const promoted = buildPromotedDocument(target, archive, new Date().toISOString());
  writeDoc(officialPath, promoted);
  console.log(`✓ TARGET 1B-1 promu : ${path.relative(process.cwd(), officialPath)}`);
  console.log(`  CURRENT archivé conservé : ${path.relative(process.cwd(), CURRENT_ARCHIVE)}`);
  return promoted;
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0];
  const demo = args.includes('--demo');

  if (mode === 'capture') await capture(demo);
  else if (mode === 'verify') await verify(demo);
  else if (mode === 'target' && !demo) generateTarget();
  else if (mode === 'promote-target' && !demo) promoteTarget();
  else {
    console.log('Usage : node golden-cdr.js <capture|verify|target|promote-target> [--demo]');
    process.exitCode = 2;
  }
}

if (require.main === module) {
  main()
    .catch(err => { console.error('✗ Erreur harnais :', err.message); process.exitCode = 2; })
    .finally(() => {
      if (process.exitCode) process.exit(process.exitCode);
      process.exit(0);
    });
}

module.exports = {
  snapshotWitness,
  buildSnapshots,
  compareDocumentToCode,
  generateTarget,
  promoteTarget,
};
