#!/usr/bin/env node
'use strict';

/**
 * @komerce-arch-lite
 * @feature       infrastructure
 * @domain        governance
 * @owner         backend
 *
 * debt-zero-gate.js — interdit toute croissance volontaire des mécanismes
 * de dette/tolérance entre la base d'une PR et son HEAD.
 *
 * Doctrine :
 *   - une dette existante peut diminuer ;
 *   - une baseline ne peut jamais augmenter ;
 *   - une nouvelle exemption/allowance est interdite ;
 *   - un nouveau quality-disable inline est interdit ;
 *   - aucune auto-écriture : ce gate est strictement read-only.
 *
 * Usage CI :
 *   node scripts/debt-zero-gate.js --base <sha> --head <sha>
 *
 * Usage local :
 *   node scripts/debt-zero-gate.js --base origin/main --head HEAD
 */

const cp = require('child_process');

const args = process.argv.slice(2);
function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

const BASE = argValue('--base') || process.env.BASE_SHA;
const HEAD = argValue('--head') || process.env.HEAD_SHA || 'HEAD';

function git(argsList, { allowFail = false } = {}) {
  const result = cp.spawnSync('git', argsList, { encoding: 'utf8' });
  if (result.status !== 0 && !allowFail) {
    throw new Error(`git ${argsList.join(' ')}: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return result.status === 0 ? result.stdout : null;
}

function readAt(ref, file) {
  return git(['show', `${ref}:${file}`], { allowFail: true });
}

function readJsonAt(ref, file) {
  const raw = readAt(ref, file);
  if (raw == null) return null;
  try { return JSON.parse(raw); }
  catch (error) { throw new Error(`${file}@${ref}: JSON invalide (${error.message})`); }
}

function changedFiles(base, head) {
  return git(['diff', '--name-only', base, head])
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);
}

function numericMapGrowth(baseMap, headMap, label, failures, prefix = '') {
  const b = baseMap && typeof baseMap === 'object' ? baseMap : {};
  const h = headMap && typeof headMap === 'object' ? headMap : {};
  for (const key of Object.keys(h).sort()) {
    const hv = h[key];
    if (typeof hv !== 'number') continue;
    const bv = typeof b[key] === 'number' ? b[key] : 0;
    if (hv > bv) failures.push(`${label}${prefix}${key}: ${bv} -> ${hv}`);
  }
}

function objectKeyGrowth(baseObj, headObj, label, failures) {
  const b = baseObj && typeof baseObj === 'object' ? baseObj : {};
  const h = headObj && typeof headObj === 'object' ? headObj : {};
  for (const key of Object.keys(h).sort()) {
    if (key.startsWith('_')) continue;
    if (!Object.prototype.hasOwnProperty.call(b, key)) failures.push(`${label}${key}: nouvelle exemption/allowance`);
  }
}

function countQualityDisables(src) {
  const out = new Map();
  if (!src) return out;
  const re = /quality-disable\s+([A-Z0-9-]+)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const rule = m[1];
    out.set(rule, (out.get(rule) || 0) + 1);
  }
  return out;
}

function qualityDisableGrowth(base, head, files, failures) {
  const sourceExt = /\.(?:js|cjs|mjs|ts)$/i;
  for (const file of files.filter(f => sourceExt.test(f)).sort()) {
    const before = countQualityDisables(readAt(base, file));
    const after = countQualityDisables(readAt(head, file));
    const rules = new Set([...before.keys(), ...after.keys()]);
    for (const rule of [...rules].sort()) {
      const b = before.get(rule) || 0;
      const h = after.get(rule) || 0;
      if (h > b) failures.push(`quality-disable ${file} [${rule}]: ${b} -> ${h}`);
    }
  }
}

function extractRuleFileExemptions(src) {
  const counts = new Map();
  if (!src) return counts;
  const block = src.match(/const\s+RULE_FILE_EXEMPT\s*=\s*\{([\s\S]*?)\n\};/);
  if (!block) return counts;
  const re = /'([^']+)'\s*:\s*new Set\(\[([\s\S]*?)\]\)/g;
  let m;
  while ((m = re.exec(block[1])) !== null) {
    const rule = m[1];
    const files = [...m[2].matchAll(/'([^']+)'/g)].map(x => x[1]);
    counts.set(rule, new Set(files));
  }
  return counts;
}

function ruleFileExemptionGrowth(base, head, failures) {
  const file = 'scripts/code-quality-gate.js';
  const before = extractRuleFileExemptions(readAt(base, file));
  const after = extractRuleFileExemptions(readAt(head, file));
  for (const [rule, files] of after.entries()) {
    const prior = before.get(rule) || new Set();
    for (const entry of [...files].sort()) {
      if (!prior.has(entry)) failures.push(`RULE_FILE_EXEMPT ${rule}: +${entry}`);
    }
  }
}

function checkBusinessGraphBaseline(base, head, failures) {
  const file = 'governance/business-graph-drift-baseline.json';
  const b = readJsonAt(base, file) || {};
  const h = readJsonAt(head, file) || {};
  numericMapGrowth(b.baseline, h.baseline, `${file} `, failures);
}

function checkArchDebtBudget(base, head, failures) {
  const file = 'scripts/arch-debt-budget.json';
  const b = readJsonAt(base, file) || {};
  const h = readJsonAt(head, file) || {};
  numericMapGrowth(b.ratchet, h.ratchet, `${file} ratchet.`, failures);
  objectKeyGrowth(b.knownDriftAllowlist, h.knownDriftAllowlist, `${file} knownDriftAllowlist.`, failures);
}

function checkQualityBaseline(base, head, failures) {
  const file = 'scripts/code-quality-baseline.json';
  const b = readJsonAt(base, file) || {};
  const h = readJsonAt(head, file) || {};
  for (const key of ['totalErrors', 'totalWarnings']) {
    const bv = typeof b[key] === 'number' ? b[key] : 0;
    const hv = typeof h[key] === 'number' ? h[key] : 0;
    if (hv > bv) failures.push(`${file} ${key}: ${bv} -> ${hv}`);
  }
  const bFiles = Array.isArray(b.files) ? b.files.length : 0;
  const hFiles = Array.isArray(h.files) ? h.files.length : 0;
  if (hFiles > bFiles) failures.push(`${file} files: ${bFiles} -> ${hFiles}`);
}

function checkTestExemptions(base, head, failures) {
  const file = 'governance/test-exemptions.json';
  const b = readJsonAt(base, file) || {};
  const h = readJsonAt(head, file) || {};
  objectKeyGrowth(b, h, `${file} `, failures);
}

function run({ base = BASE, head = HEAD } = {}) {
  if (!base) throw new Error('--base (ou BASE_SHA) est obligatoire');
  if (!head) throw new Error('--head (ou HEAD_SHA) est obligatoire');

  const failures = [];
  const files = changedFiles(base, head);

  checkBusinessGraphBaseline(base, head, failures);
  checkArchDebtBudget(base, head, failures);
  checkQualityBaseline(base, head, failures);
  checkTestExemptions(base, head, failures);
  ruleFileExemptionGrowth(base, head, failures);
  qualityDisableGrowth(base, head, files, failures);

  return { base, head, changedFiles: files, failures };
}

function main() {
  const result = run();
  console.log('\nDEBT ZERO GATE — anti-croissance des tolérances\n');
  if (result.failures.length > 0) {
    console.error('✖ Nouvelle dette/tolérance détectée :');
    for (const failure of result.failures) console.error(`  - ${failure}`);
    console.error('\nDoctrine : réduire ou supprimer la dette ; ne jamais relever une baseline ni ajouter une exemption.\n');
    process.exit(1);
  }
  console.log('✔ Aucune baseline, allowance, exemption ou quality-disable n\'a augmenté.\n');
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(`✖ debt-zero-gate: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  countQualityDisables,
  extractRuleFileExemptions,
  numericMapGrowth,
  objectKeyGrowth,
  run,
};
