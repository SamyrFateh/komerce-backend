#!/usr/bin/env node
'use strict';

/**
 * feature-schema-check.js — Gate 2 : schéma strict des cartes d'identité.
 *
 *   Une carte porte l'INTENTION (non dérivable), jamais le dérivé recopié.
 *   Ce gate fait échouer toute carte (a) incomplète sur les champs d'intention,
 *   ou (b) polluée par du dérivé (methods/selectors/exports… = boulot du
 *   générateur, pas de la carte).
 *
 *   Deux niveaux de sévérité, pour une adoption par paliers (cliquet) :
 *     STRUCTUREL  champs sans lesquels la carte est cassée → bloque en --strict
 *     FORBIDDEN   dérivé recopié → bloque en --strict (toujours)
 *     GOUVERNANCE champs de maturité (authority, contrat, invariants, tests)
 *                 → bloque seulement en --strict --full (le temps de backfiller)
 *
 * Usage :
 *   node scripts/feature-schema-check.js              rapport
 *   node scripts/feature-schema-check.js --strict     exit 1 si STRUCTUREL/FORBIDDEN
 *   node scripts/feature-schema-check.js --strict --full   + GOUVERNANCE
 *   node scripts/feature-schema-check.js --root DIR
 */
const fs = require('fs'), path = require('path');
const args = args_(); function args_(){return process.argv.slice(2);}
const STRICT = args.includes('--strict'), FULL = args.includes('--full');
const ROOT = path.resolve(argVal('--root') || process.cwd());
function argVal(f){const i=args.indexOf(f);return i>=0?args[i+1]:null;}
const C={red:'\x1b[31m',grn:'\x1b[32m',ylw:'\x1b[33m',dim:'\x1b[2m',bld:'\x1b[1m',cyn:'\x1b[36m',r:'\x1b[0m'};

const GLOBS = ['features', 'public/boutique/features'];

// ── Schéma ──────────────────────────────────────────────────────────────────
const STRUCTURAL = ['name', 'type', 'status', 'service'];
const FORBIDDEN  = ['methods', 'selectors', 'exports', 'domEvents', 'metrics', 'routesReal', 'dependencies'];
function governanceChecks(m) {
  const miss = [];
  if (!m.perimeter || !Array.isArray(m.perimeter.in)  || !m.perimeter.in.length)  miss.push('perimeter.in');
  if (!m.perimeter || !Array.isArray(m.perimeter.out) || !m.perimeter.out.length) miss.push('perimeter.out');
  if (!m.files || !Object.keys(m.files).length) miss.push('files');
  if (!m.authority) miss.push('authority');
  if (!m.contract || !Array.isArray(m.contract.exposes))  miss.push('contract.exposes');
  if (!m.contract || !Array.isArray(m.contract.consumes)) miss.push('contract.consumes');
  if (!Array.isArray(m.invariants) || !m.invariants.length) miss.push('invariants');
  // Preuve de non-régression : tests OU verification OU contracts exécutables
  const hasProof = m.tests || m.verification || (m.contracts && Object.keys(m.contracts).length);
  if (!hasProof) miss.push('tests|verification|contracts');
  return miss;
}

function load() {
  const out = [];
  for (const dir of GLOBS) { const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) { if (!f.endsWith('.feature.js')) continue;
      const full = path.join(abs, f);
      try { const m = require(full); m.__file = path.relative(ROOT, full); out.push(m); }
      catch (e) { out.push({ name: f, __file: path.relative(ROOT, full), __broken: e.message }); }
    }
  }
  return out;
}

const cards = load();
console.log(`\n${C.bld}Gate 2 — Schéma des cartes${C.r}  ${C.dim}(${cards.length} carte(s), racine ${ROOT})${C.r}\n`);

let errStruct = 0, errForbidden = 0, debtGov = 0;
for (const m of cards) {
  if (m.__broken) { console.log(`${C.red}✖ ${m.name}${C.r} illisible: ${m.__broken}`); errStruct++; continue; }
  const missStruct = STRUCTURAL.filter(k => m[k] === undefined || m[k] === null || m[k] === '');
  const forb = FORBIDDEN.filter(k => k in m);
  const missGov = governanceChecks(m);

  errStruct += missStruct.length ? 1 : 0;
  errForbidden += forb.length ? 1 : 0;
  debtGov += missGov.length ? 1 : 0;

  if (!missStruct.length && !forb.length && !missGov.length) { console.log(`${C.grn}✔ ${m.name}${C.r}`); continue; }
  const tag = (missStruct.length || forb.length) ? `${C.red}✖` : `${C.ylw}▲`;
  console.log(`${tag} ${m.name}${C.r} ${C.dim}(${m.__file})${C.r}`);
  if (missStruct.length) console.log(`    ${C.red}structurel manquant${C.r} : ${missStruct.join(', ')}`);
  if (forb.length)       console.log(`    ${C.red}dérivé interdit${C.r}    : ${forb.join(', ')} ${C.dim}(→ générateur)${C.r}`);
  if (missGov.length)    console.log(`    ${C.ylw}gouvernance${C.r}        : ${missGov.join(', ')} ${C.dim}(à backfiller)${C.r}`);
}

console.log(`\n${C.bld}Bilan${C.r} : ${errStruct} cassée(s) structurel · ${errForbidden} polluée(s) dérivé · ${debtGov} immature(s) gouvernance`);
const hardFail = errStruct + errForbidden;
const govFail  = FULL ? debtGov : 0;
if (STRICT && (hardFail + govFail) > 0) {
  console.log(`${C.red}${C.bld}✖ Schéma non conforme${C.r}${FULL ? ' (mode --full : gouvernance incluse)' : C.dim+' (gouvernance non bloquante sans --full)'+C.r}`);
  process.exit(1);
}
console.log(`${C.grn}${C.bld}✔ Schéma OK${C.r}${!FULL && debtGov ? C.dim+` (${debtGov} carte(s) à backfiller — passe --full pour bloquer)`+C.r : ''}`);
