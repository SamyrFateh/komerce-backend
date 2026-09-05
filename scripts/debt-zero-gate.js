#!/usr/bin/env node
'use strict';

/**
 * @komerce-arch-lite
 * @feature       infrastructure
 * @domain        governance
 * @owner         backend
 *
 * Debt Zero v2 — aucune croissance d'un mécanisme de tolérance sans validation
 * humaine explicite, justifiée et liée au SHA HEAD exact de la PR.
 */

const cp = require('child_process');
const https = require('https');

const REGISTRY_FILE = 'governance/debt-zero-registry.json';
const argv = process.argv.slice(2);
const arg = flag => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
const BASE = arg('--base') || process.env.BASE_SHA;
const HEAD = arg('--head') || process.env.HEAD_SHA || 'HEAD';
const APPROVER = process.env.DEBT_APPROVER || 'SamyrFateh';

function git(args, allowFail = false) {
  const r = cp.spawnSync('git', args, { encoding: 'utf8' });
  if (r.status !== 0 && !allowFail) throw new Error(`git ${args.join(' ')}: ${(r.stderr || r.stdout || '').trim()}`);
  return r.status === 0 ? r.stdout : null;
}
const resolveCommit = ref => git(['rev-parse', ref]).trim();
const readAt = (ref, file) => git(['show', `${ref}:${file}`], true);
function readJsonAt(ref, file) {
  const raw = readAt(ref, file);
  if (raw == null) return null;
  try { return JSON.parse(raw); } catch (e) { throw new Error(`${file}@${ref}: JSON invalide (${e.message})`); }
}
const changedFiles = (base, head) => git(['diff', '--name-only', base, head]).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const trackedGovernanceFiles = ref => git(['ls-tree', '-r', '--name-only', ref, '--', 'scripts', 'governance']).split(/\r?\n/).map(s => s.trim()).filter(Boolean);

function stableValue(v) {
  if (Array.isArray(v)) return v.map(stableValue);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, stableValue(v[k])]));
  return v;
}
const stableStringify = v => JSON.stringify(stableValue(v));
const getPath = (obj, path) => !path ? obj : String(path).split('.').reduce((v, k) => v && typeof v === 'object' ? v[k] : undefined, obj);

function numericMapGrowth(base, head, label, failures) {
  const b = base && typeof base === 'object' ? base : {};
  const h = head && typeof head === 'object' ? head : {};
  for (const key of Object.keys(h).sort()) {
    if (typeof h[key] !== 'number') continue;
    const before = typeof b[key] === 'number' ? b[key] : 0;
    if (h[key] > before) failures.push(`${label}${key}: ${before} -> ${h[key]}`);
  }
}

function objectKeyGrowth(base, head, label, failures) {
  const b = base && typeof base === 'object' && !Array.isArray(base) ? base : {};
  const h = head && typeof head === 'object' && !Array.isArray(head) ? head : {};
  for (const key of Object.keys(h).sort()) {
    if (!key.startsWith('_') && !Object.prototype.hasOwnProperty.call(b, key)) failures.push(`${label}${key}: nouvelle exemption/allowance`);
  }
}

function arrayGrowth(base, head, label, failures, keyFn = stableStringify) {
  const before = new Set((Array.isArray(base) ? base : []).map(keyFn));
  for (const item of Array.isArray(head) ? head : []) {
    const key = keyFn(item);
    if (!before.has(key)) failures.push(`${label}: +${key}`);
  }
}

function identityKey(item, fields) {
  const v = item && typeof item === 'object' ? item : {};
  return fields.map(f => `${f}=${stableStringify(v[f])}`).join('|');
}
function identityArrayGrowth(base, head, fields, label, failures) {
  arrayGrowth(base, head, label, failures, item => identityKey(item, fields));
}

function countQualityDisables(src) {
  const out = new Map();
  if (!src) return out;
  const re = /quality-disable\s+([A-Z0-9-]+)/g;
  let m;
  while ((m = re.exec(src))) out.set(m[1], (out.get(m[1]) || 0) + 1);
  return out;
}
function qualityDisableGrowth(base, head, files, failures) {
  for (const file of files.filter(f => /\.(?:js|cjs|mjs|ts)$/i.test(f)).sort()) {
    const b = countQualityDisables(readAt(base, file));
    const h = countQualityDisables(readAt(head, file));
    for (const rule of [...new Set([...b.keys(), ...h.keys()])].sort()) {
      if ((h.get(rule) || 0) > (b.get(rule) || 0)) failures.push(`quality-disable ${file} [${rule}]: ${b.get(rule) || 0} -> ${h.get(rule) || 0}`);
    }
  }
}

function extractRuleFileExemptions(src) {
  const out = new Map();
  if (!src) return out;
  const block = src.match(/const\s+RULE_FILE_EXEMPT\s*=\s*\{([\s\S]*?)\n\s*\};/);
  if (!block) return out;
  for (const m of block[1].matchAll(/'([^']+)'\s*:\s*new Set\(\[([\s\S]*?)\]\)/g)) {
    out.set(m[1], new Set([...m[2].matchAll(/'([^']+)'/g)].map(x => x[1])));
  }
  return out;
}

function collectionTokens(block) {
  if (!block) return new Set();
  const clean = block.split(/\r?\n/).map(line => line.replace(/\/\/.*$/, '')).join('\n');
  const out = new Set();
  for (const m of clean.matchAll(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\/(?:\\.|[^/\n])+\/[gimsuy]*/g)) out.add(m[0].trim());
  return out;
}

function extractArchSourceAllowlists(src) {
  const out = new Map();
  if (!src) return out;
  for (const m of src.matchAll(/const\s+(ALLOWED_[A-Z0-9_]+)\s*=\s*new Set\(\[([\s\S]*?)\]\s*\);/g)) out.set(m[1], collectionTokens(m[2]));
  for (const m of src.matchAll(/const\s+(ALLOWED_[A-Z0-9_]+)\s*=\s*\[([\s\S]*?)\]\s*;/g)) out.set(m[1], collectionTokens(m[2]));
  const ownership = src.match(/const\s+COLUMN_OWNERSHIP\s*=\s*\[([\s\S]*?)\n\s*\];/);
  if (ownership) {
    for (const m of ownership[1].matchAll(/id:\s*'([^']+)'[\s\S]*?allowlist:\s*new Set\(\[([\s\S]*?)\]\)/g)) {
      out.set(`COLUMN_OWNERSHIP.${m[1]}.allowlist`, collectionTokens(m[2]));
    }
  }
  return out;
}

function setMapGrowth(base, head, label, failures) {
  for (const [group, items] of head.entries()) {
    const before = base.get(group) || new Set();
    for (const item of [...items].sort()) if (!before.has(item)) failures.push(`${label}${group}: +${item}`);
  }
}

function compareNpmExceptions(base, head, spec, file, failures) {
  const fields = spec.identity || ['package', 'advisory'];
  const before = new Map((Array.isArray(base) ? base : []).map(x => [identityKey(x, fields), x]));
  for (const item of Array.isArray(head) ? head : []) {
    const key = identityKey(item, fields);
    const prior = before.get(key);
    if (!prior) { failures.push(`${file}: nouvelle exception npm ${key}`); continue; }
    if (stableStringify(item.scope) !== stableStringify(prior.scope)) failures.push(`${file} ${key}: scope modifié`);
    if (prior.expires && !item.expires) failures.push(`${file} ${key}: expiration supprimée`);
    const b = Date.parse(prior.expires || '');
    const h = Date.parse(item.expires || '');
    if (item.expires && !Number.isFinite(h)) failures.push(`${file} ${key}: expiration invalide ${item.expires}`);
    else if (Number.isFinite(b) && Number.isFinite(h) && h > b) failures.push(`${file} ${key}: expiration prolongée ${prior.expires} -> ${item.expires}`);
  }
}

function compareSpec(file, spec, base, head, failures) {
  switch (spec.kind) {
    case 'numeric-map': return numericMapGrowth(getPath(base, spec.path), getPath(head, spec.path), `${file} `, failures);
    case 'object-keys': return objectKeyGrowth(base, head, `${file} `, failures);
    case 'entry-file-lists': {
      const b = base || {}, h = head || {};
      objectKeyGrowth(b, h, `${file} `, failures);
      for (const key of Object.keys(h).filter(k => !k.startsWith('_')).sort()) arrayGrowth(b[key]?.files, h[key]?.files, `${file} ${key}.files`, failures);
      return;
    }
    case 'nested-file-lists':
      for (const group of spec.groups || []) {
        if (head?.[group] && !base?.[group]) failures.push(`${file} ${group}: nouveau groupe d'exemption`);
        arrayGrowth(base?.[group]?.files, head?.[group]?.files, `${file} ${group}.files`, failures);
      }
      return;
    case 'arch-debt-budget':
      numericMapGrowth(base?.ratchet, head?.ratchet, `${file} ratchet.`, failures);
      objectKeyGrowth(base?.knownDriftAllowlist, head?.knownDriftAllowlist, `${file} knownDriftAllowlist.`, failures);
      return;
    case 'quality-baseline':
      for (const key of ['totalErrors', 'totalWarnings']) {
        const b = typeof base?.[key] === 'number' ? base[key] : 0;
        const h = typeof head?.[key] === 'number' ? head[key] : 0;
        if (h > b) failures.push(`${file} ${key}: ${b} -> ${h}`);
      }
      arrayGrowth(base?.files, head?.files, `${file} files`, failures);
      return;
    case 'array-fields':
      for (const field of spec.fields || []) arrayGrowth(base?.[field], head?.[field], `${file} ${field}`, failures);
      return;
    case 'identity-array':
      return identityArrayGrowth(getPath(base, spec.path), getPath(head, spec.path), spec.identity || [], file, failures);
    case 'npm-exceptions': return compareNpmExceptions(base, head, spec, file, failures);
    case 'arch-source-allowlists': return setMapGrowth(extractArchSourceAllowlists(base || ''), extractArchSourceAllowlists(head || ''), `${file} `, failures);
    case 'code-quality-source': return setMapGrowth(extractRuleFileExemptions(base || ''), extractRuleFileExemptions(head || ''), `${file} RULE_FILE_EXEMPT.`, failures);
    default: failures.push(`${REGISTRY_FILE}: kind inconnu '${spec.kind}' pour ${file}`);
  }
}

const sourceSpec = spec => ['arch-source-allowlists', 'code-quality-source'].includes(spec.kind);
function compareRegisteredSources(base, head, registry, failures) {
  for (const [file, spec] of Object.entries(registry?.files || {}).sort(([a], [b]) => a.localeCompare(b))) {
    const b = sourceSpec(spec) ? readAt(base, file) : readJsonAt(base, file);
    const h = sourceSpec(spec) ? readAt(head, file) : readJsonAt(head, file);
    if (h == null) continue; // suppression = réduction de surface
    compareSpec(file, spec, b, h, failures);
  }
}

function validateRegisteredTargets(head, registry, failures) {
  for (const [file, spec] of Object.entries(registry?.files || {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (readAt(head, file) == null) {
      failures.push(`${REGISTRY_FILE}: cible enregistrée absente du HEAD: ${file} (${spec.kind})`);
    }
  }
}

function findUnknownToleranceFiles(head, registry, failures) {
  const known = new Set(Object.keys(registry?.files || {}));
  const suspicious = /(?:baseline|exempt|exception|suppress|allowlist)/i;
  for (const file of trackedGovernanceFiles(head).sort()) {
    if (file.endsWith('.json') && suspicious.test(file.split('/').pop()) && !known.has(file)) failures.push(`registre de tolérance non classifié: ${file}`);
  }
}

function registryForComparison(base, head, failures) {
  const b = readJsonAt(base, REGISTRY_FILE);
  const h = readJsonAt(head, REGISTRY_FILE);
  if (!h) { failures.push(`${REGISTRY_FILE}: registre absent du HEAD`); return b || { files: {} }; }
  if (b && stableStringify(b) !== stableStringify(h)) { failures.push(`${REGISTRY_FILE}: registre Debt Zero modifié`); return b; }
  return b || h; // bootstrap unique si main n'a pas encore le registre
}

function parseApprovalSignal(body) {
  return String(body || '').trim().split(/\r?\n/)[0]?.trim() === 'DEBT-APPROVAL';
}

function parseApprovalContext(body) {
  const lines = String(body || '').split(/\r?\n/);
  const pick = label => {
    const line = lines.find(x => new RegExp(`^${label}\\s*:`, 'i').test(x.trim()));
    return line ? line.trim().replace(new RegExp(`^${label}\\s*:\\s*`, 'i'), '').trim() : '';
  };
  const explanation = pick('Explication');
  const justification = pick('Justification');
  return explanation.length >= 20 && justification.length >= 20 ? { explanation, justification } : null;
}

const extractPrFromRef = ref => String(ref || '').match(/^refs\/pull\/(\d+)\//)?.[1] || null;

function githubGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'api.github.com', path, headers: { 'User-Agent': 'komerce-debt-zero-gate', Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`GitHub API HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(`GitHub API JSON invalide: ${e.message}`)); }
      });
    });
    req.on('error', reject); req.end();
  });
}

async function findHumanApproval(head) {
  const repo = process.env.GITHUB_REPOSITORY;
  const pr = process.env.PR_NUMBER || process.env.GITHUB_PR_NUMBER || extractPrFromRef(process.env.GITHUB_REF);
  if (!repo || !pr) return null;

  const [comments, reviews, prMeta, commitMeta] = await Promise.all([
    githubGet(`/repos/${repo}/issues/${pr}/comments?per_page=100`),
    githubGet(`/repos/${repo}/pulls/${pr}/reviews?per_page=100`),
    githubGet(`/repos/${repo}/pulls/${pr}`),
    githubGet(`/repos/${repo}/commits/${head}`),
  ]);

  const context = parseApprovalContext(prMeta?.body);
  if (!context) return null;
  const headAt = Date.parse(commitMeta?.commit?.committer?.date || commitMeta?.commit?.author?.date || '');
  if (!Number.isFinite(headAt)) return null;

  const entries = [...comments, ...reviews].sort((a, b) => {
    const at = Date.parse(a?.created_at || a?.submitted_at || '') || 0;
    const bt = Date.parse(b?.created_at || b?.submitted_at || '') || 0;
    return at - bt;
  });
  for (const entry of entries.reverse()) {
    if (entry?.user?.login !== APPROVER || !parseApprovalSignal(entry.body)) continue;
    const approvedAt = Date.parse(entry?.created_at || entry?.submitted_at || '');
    if (!Number.isFinite(approvedAt) || approvedAt < headAt) continue;
    return { author: entry.user.login, commentId: entry.id, approvedAt, ...context };
  }
  return null;
}

function run({ base = BASE, head = HEAD } = {}) {
  if (!base) throw new Error('--base (ou BASE_SHA) est obligatoire');
  if (!head) throw new Error('--head (ou HEAD_SHA) est obligatoire');
  const failures = [], files = changedFiles(base, head);
  const registry = registryForComparison(base, head, failures);
  const headRegistry = readJsonAt(head, REGISTRY_FILE) || registry;
  validateRegisteredTargets(head, headRegistry, failures);
  compareRegisteredSources(base, head, registry, failures);
  findUnknownToleranceFiles(head, headRegistry, failures);
  qualityDisableGrowth(base, head, files, failures);
  return { base, head: resolveCommit(head), changedFiles: files, failures };
}

async function main() {
  const result = run();
  console.log('\nDEBT ZERO GATE v2 — anti-croissance des tolérances\n');
  if (!result.failures.length) return console.log("✔ Aucun mécanisme de dette/tolérance n'a augmenté et aucun registre inconnu n'est apparu.\n");
  console.error('▲ Nouvelle dette/tolérance ou modification de gouvernance détectée :');
  result.failures.forEach(f => console.error(`  - ${f}`));
  let approval = null;
  try { approval = await findHumanApproval(result.head); } catch (e) { console.error(`\n  Validation humaine non vérifiable: ${e.message}`); }
  if (approval) {
    console.log(`\n✔ Exception approuvée humainement par ${approval.author} pour HEAD ${result.head}.`);
    console.log(`  Explication : ${approval.explanation}`);
    console.log(`  Justification : ${approval.justification}\n`);
    return;
  }
  console.error(`\n✖ Blocage Debt Zero. Validation humaine requise de ${APPROVER}.`);
  console.error('\n  Commenter simplement : DEBT-APPROVAL');
  console.error('  La PR doit contenir Explication: et Justification:.');
  console.error('  Tout nouveau commit postérieur à l’accord invalide automatiquement cette validation.\n');
  process.exit(1);
}

if (require.main === module) main().catch(e => { console.error(`✖ debt-zero-gate: ${e.message}`); process.exit(1); });

module.exports = {
  arrayGrowth,
  countQualityDisables,
  extractArchSourceAllowlists,
  extractRuleFileExemptions,
  identityArrayGrowth,
  numericMapGrowth,
  objectKeyGrowth,
  parseApprovalSignal,
  parseApprovalContext,
  registryForComparison,
  stableStringify,
  validateRegisteredTargets,
  extractPrFromRef,
  run,
};
