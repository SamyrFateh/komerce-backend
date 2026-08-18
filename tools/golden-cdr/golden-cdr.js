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
 *   MODE CAPTURE   node golden-cdr.js capture [--demo]
 *     → charge la config (DB réelle, ou fixture démo), joue les témoins,
 *       écrit golden/cdr.golden[.demo].json (config figée + empreintes).
 *
 *   MODE VERIFY    node golden-cdr.js verify [--demo]
 *     → recharge le golden, rejoue computeCDR sur le CODE COURANT avec la
 *       config FIGÉE du golden, compare, imprime un diff expliqué.
 *       Sort en code 1 si divergence (gate CI).
 *
 * Usage typique :
 *   - Capturer une fois, sur la branche de référence (avant 1A).
 *   - Verify dans la CI : toute PR qui change le CDR sans intention casse le gate.
 *   - Avant 1B : re-capturer en « TARGET », comparer CURRENT↔TARGET, exiger
 *     que chaque écart soit expliqué (correction de vérité, doctrine I-7).
 */

'use strict';
const fs = require('fs');
const path = require('path');

// ── Résolution du vrai service (depuis tools/golden-cdr/ → services/) ──
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
const GOLDEN_DIR = path.join(__dirname, 'golden');
const FIXTURE = path.join(__dirname, 'fixtures', 'config.demo.json');

// ── Utilitaires déterministes ──────────────────────────────────────
function ri(n) { return Math.round(Number(n) || 0); }
function sortKeys(o) {
  if (Array.isArray(o)) return o.map(sortKeys);
  if (o && typeof o === 'object') {
    return Object.keys(o).sort().reduce((acc, k) => { acc[k] = sortKeys(o[k]); return acc; }, {});
  }
  return o;
}
function stableJSON(o) { return JSON.stringify(sortKeys(o), null, 2); }
function fingerprint(o) {
  return require('crypto').createHash('sha256').update(stableJSON(o)).digest('hex').slice(0, 16);
}

const CONF_ORDER = { high: 3, medium: 2, low: 1, none: 0 };
function minConfidence(allocs) {
  if (!allocs || !allocs.length) return 'none';
  return allocs.reduce((min, a) => (CONF_ORDER[a.confidence] ?? 1) < (CONF_ORDER[min] ?? 1) ? a.confidence : min, 'high');
}

// ── Snapshot d'un témoin : mappe la sortie computeCDR sur les noms doctrinaux ──
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
    // ── décomposition doctrinale (contrat du golden) ──
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
    // ── provenance : quelle source / quel fallback a été utilisé ──
    provenance: {
      components_source: config.components_source || null,
      category_known:    Boolean(config.categories && config.categories[w.product.category]),
      volume_defaulted:  (w.ctx.volume_m3 == null),
      cost_zero:         (Number(w.product.cost_kmf) || 0) <= 0,
    },
    // ── confiance d'allocation ──
    allocation: { levels, min_confidence: minConfidence(allocs) },
    warnings: (out.warnings || []).slice().sort(),
  };
}

// ── Chargement de la config ────────────────────────────────────────
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

// ── CAPTURE ────────────────────────────────────────────────────────
async function capture(demo) {
  const config = await loadConfig(demo);
  const snapshots = WITNESSES.map(w => snapshotWitness(w, config));
  const doc = {
    _kind: 'golden-cdr',
    captured_at: new Date().toISOString(),
    mode: demo ? 'demo' : 'db',
    config_fingerprint: fingerprint(config),
    witness_count: snapshots.length,
    frozen_config: config,   // figée pour un verify déterministe, DB-indépendant
    snapshots,
  };
  fs.mkdirSync(GOLDEN_DIR, { recursive: true });
  const p = goldenPath(demo);
  fs.writeFileSync(p, stableJSON(doc));
  console.log(`✓ Golden capturé : ${path.relative(process.cwd(), p)}`);
  console.log(`  ${snapshots.length} témoins · config ${doc.config_fingerprint} · mode ${doc.mode}`);
  return doc;
}

// ── VERIFY ─────────────────────────────────────────────────────────
function diffObjects(prefix, a, b, out) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) {
    const va = a ? a[k] : undefined, vb = b ? b[k] : undefined;
    if (va && typeof va === 'object' && !Array.isArray(va)) { diffObjects(`${prefix}.${k}`, va, vb, out); continue; }
    const sa = JSON.stringify(va), sb = JSON.stringify(vb);
    if (sa !== sb) out.push({ path: `${prefix}.${k}`, golden: va, current: vb });
  }
}

async function verify(demo) {
  const p = goldenPath(demo);
  if (!fs.existsSync(p)) {
    console.error(`✗ Golden absent : ${path.relative(process.cwd(), p)} — lance d'abord « capture ».`);
    process.exit(2);
  }
  const golden = JSON.parse(fs.readFileSync(p, 'utf8'));
  const config = golden.frozen_config;   // config FIGÉE → parité imputable au seul code
  const byId = new Map(golden.snapshots.map(s => [s.id, s]));

  let fails = 0, checked = 0;
  const missing = [];
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
      console.log(`\n✗ ${w.id} — ${w.label}`);
      for (const df of diffs) {
        console.log(`    ${df.path}\n        golden : ${JSON.stringify(df.golden)}\n        courant: ${JSON.stringify(df.current)}`);
      }
    }
  }

  console.log('');
  if (golden.snapshots.length !== WITNESSES.length || missing.length) {
    console.log(`⚠ Témoins non couverts par ce golden : ${missing.join(', ') || '(recompte)'} — re-capture nécessaire.`);
  }
  if (fails === 0 && !missing.length) {
    console.log(`✓ PARITÉ OK — ${checked} témoins identiques au golden (config ${golden.config_fingerprint}).`);
    process.exit(0);
  }
  console.log(`✗ PARITÉ ROMPUE — ${fails}/${checked} témoins divergent. Tout écart doit être EXPLIQUÉ (doctrine I-7) ou corrigé.`);
  process.exit(1);
}

// ── Entrée ─────────────────────────────────────────────────────────
(async () => {
  const args = process.argv.slice(2);
  const mode = args[0];
  const demo = args.includes('--demo');
  if (mode === 'capture') {
    await capture(demo);
    // pricing-cdr importe le pool DB et son monitor périodique ; après l'écriture
    // synchrone du golden, aucun travail utile ne reste. Sortie explicite pour que
    // le CLI rende la main au lieu de rester vivant sur ces handles runtime.
    process.exit(0);
  }
  else if (mode === 'verify') await verify(demo);
  else {
    console.log('Usage : node golden-cdr.js <capture|verify> [--demo]');
    process.exit(2);
  }
})().catch(err => { console.error('✗ Erreur harnais :', err.message); process.exit(2); });
