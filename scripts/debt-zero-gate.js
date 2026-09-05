#!/usr/bin/env node
'use strict';

/**
 * @komerce-arch-lite
 * @feature       infrastructure
 * @domain        governance
 * @owner         backend
 *
 * Debt Zero : aucune croissance d'un mécanisme de tolérance sans validation
 * humaine explicite, justifiée et liée au SHA HEAD exact de la PR.
 *
 * Le registre canonique governance/debt-zero-registry.json décrit les sources
 * de tolérance connues et leur sémantique. Après son bootstrap, toute mutation
 * du registre est elle-même soumise à Debt Zero. Un nouveau JSON de baseline,
 * exemption, exception, suppression ou allowlist non enregistré est bloqué.
 */

const cp = require('child_process');
const https = require('https');

const REGISTRY_FILE = 'governance/debt-zero-registry.json';
const args = process.argv.slice(2);

function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

const BASE = argValue('--base') || process.env.BASE_SHA;
const HEAD = argValue('--head') || process.env.HEAD_SHA || 'HEAD';
const APPROVER = process.env.DEBT_APPROVER || 'SamyrFateh';

function git(argsList, { allowFail = false } = {}) {
  const result = cp.spawnSync('git', argsList, { encoding: 'utf8' });
  if (result.status !== 0 && !allowFail) {
    throw new Error(`git ${argsList.join(' ')}: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return result.status === 0 ? result.stdout : null;
}

function resolveCommit(ref) {
  return git(['rev-parse', ref]).trim();
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

function trackedGovernanceFiles(ref) {
  const raw = git(['ls-tree', '-r', '--name-only', ref, '--', 'scripts', 'governance']);
  return raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function getPath(obj, dottedPath) {
  if (!dottedPath) return obj;
  return String(dottedPath).split('.').reduce((value, key) => (
    value && typeof value === 'object' ? value[key] : undefined
  ), obj);
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
  const b = baseObj && typeof baseObj === 'object' && !Array.isArray(baseObj) ? baseObj : {};
  const h = headObj && typeof headObj === 'object' && !Array.isArray(headObj) ? headObj : {};
  for (const key of Object.keys(h).sort()) {
    if (key.startsWith('_')) continue;
    if (!Object.prototype.hasOwnProperty.call(b, key)) {
      failures.push(`${label}${key}: nouvelle exemption/allowance`);
    }
  }
}

function arrayGrowth(baseArray, headArray, label, failures, keyFn = stableStringify) {
  const before = new Set((Array.isArray(baseArray) ? baseArray : []).map(keyFn));
  for (const item of Array.isArray(headArray) ? headArray : []) {
    const key = keyFn(item);
    if (!before.has(key)) failures.push(`${label}: +${key}`);
  }
}

function identityKey(item, fields) {
  const value = item && typeof item === 'object' ? item : {};
  return fields.map(field => `${field}=${stableStringify(value[field])}`).join('|');
}

function identityArrayGrowth(baseArray, headArray, fields, label, failures) {
  arrayGrowth(baseArray, headArray, label, failures, item => identityKey(item, fields));
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
  const block = src.match(/const\s+RULE_FILE_EXEMPT\s*=\s*\{([\s\S]*?)\n\s*\};/);
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

function setMapGrowth(before, after, label, failures) {
  for (const [group, items] of after.entries()) {
    const prior = before.get(group) || new Set();
    for (const item of [...items].sort()) {
      if (!prior.has(item)) failures.push(`${label}${group}: +${item}`);
    }
  }
}

function collectionTokens(block) {
  if (!block) return new Set();
  const withoutComments = block
    .split(/\r?\n/)
    .map(line => line.replace(/\/\/.*$/, ''))
    .join('\n');
  const tokens = new Set();
  const re = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\/(?:\\.|[^/\n])+\/[gimsuy]*/g;
  for (const match of withoutComments.matchAll(re)) tokens.add(match[0].trim());
  return tokens;
}

function extractArchSourceAllowlists(src) {
  const out = new Map();
  if (!src) return out;

  const setRe = /const\s+(ALLOWED_[A-Z0-9_]+)\s*=\s*new Set\(\[([\s\S]*?)\]\s*\);/g;
  for (const match of src.matchAll(setRe)) out.set(match[1], collectionTokens(match[2]));

  const arrayRe = /const\s+(ALLOWED_[A-Z0-9_]+)\s*=\s*\[([\s\S]*?)\]\s*;/g;
  for (const match of src.matchAll(arrayRe)) out.set(match[1], collectionTokens(match[2]));

  const ownership = src.match(/const\s+COLUMN_OWNERSHIP\s*=\s*\[([\s\S]*?)\n\];/);
  if (ownership) {
    const re = /id:\s*'([^']+)'[\s\S]*?allowlist:\s*new Set\(\[([\s\S]*?)\]\)/g;
    for (const match of ownership[1].matchAll(re)) {
      out.set(`COLUMN_OWNERSHIP.${match[1]}.allowlist`, collectionTokens(match[2]));
    }
  }
  return out;
}

function compareNpmExceptions(baseArray, headArray, spec, file, failures) {
  const fields = Array.isArray(spec.identity) ? spec.identity : ['package', 'advisory'];
  const before = new Map((Array.isArray(baseArray) ? baseArray : []).map(item => [identityKey(item, fields), item]));
  for (const item of Array.isArray(headArray) ? headArray : []) {
    const key = identityKey(item, fields);
    const prior = before.get(key);
    if (!prior) {
      failures.push(`${file}: nouvelle exception npm ${key}`);
      continue;
    }
    if (stableStringify(item.scope) !== stableStringify(prior.scope)) {
      failures.push(`${file} ${key}: scope modifié ${stableStringify(prior.scope)} -> ${stableStringify(item.scope)}`);
    }
    const beforeExpiry = prior.expires ? Date.parse(prior.expires) : NaN;
    const afterExpiry = item.expires ? Date.parse(item.expires) : NaN;
    if (prior.expires && !item.expires) {
      failures.push(`${file} ${key}: expiration supprimée`);
    } else if (Number.isFinite(beforeExpiry) && Number.isFinite(afterExpiry) && afterExpiry > beforeExpiry) {
      failures.push(`${file} ${key}: expiration prolongée ${prior.expires} -> ${item.expires}`);
    } else if (item.expires && !Number.isFinite(afterExpiry)) {
      failures.push(`${file} ${key}: expiration invalide ${item.expires}`);
    }
  }
}

function compareQualityBaseline(baseValue, headValue, file, failures) {
  const b = baseValue || {};
  const h = headValue || {};
  for (const key of ['totalErrors', 'totalWarnings']) {
    const bv = typeof b[key] === 'number' ? b[key] : 0;
    const hv = typeof h[key] === 'number' ? h[key] : 0;
    if (hv > bv) failures.push(`${file} ${key}: ${bv} -> ${hv}`);
  }
  arrayGrowth(b.files, h.files, `${file} files`, failures);
}

function compareArchDebtBudget(baseValue, headValue, file, failures) {
  const b = baseValue || {};
  const h = headValue || {};
  numericMapGrowth(b.ratchet, h.ratchet, `${file} ratchet.`, failures);
  objectKeyGrowth(b.knownDriftAllowlist, h.knownDriftAllowlist, `${file} knownDriftAllowlist.`, failures);
}

function compareSpec(file, spec, baseValue, headValue, failures) {
  switch (spec.kind) {
    case 'numeric-map':
      numericMapGrowth(getPath(baseValue, spec.path), getPath(headValue, spec.path), `${file} `, failures);
      break;
    case 'object-keys':
      objectKeyGrowth(baseValue, headValue, `${file} `, failures);
      break;
    case 'entry-file-lists': {
      const b = baseValue && typeof baseValue === 'object' ? baseValue : {};
      const h = headValue && typeof headValue === 'object' ? headValue : {};
      objectKeyGrowth(b, h, `${file} `, failures);
      for (const key of Object.keys(h).filter(key => !key.startsWith('_')).sort()) {
        arrayGrowth(b[key]?.files, h[key]?.files, `${file} ${key}.files`, failures);
      }
      break;
    }
    case 'nested-file-lists': {
      for (const group of spec.groups || []) {
        const b = baseValue?.[group];
        const h = headValue?.[group];
        if (h && !b) failures.push(`${file} ${group}: nouveau groupe d'exemption`);
        arrayGrowth(b?.files, h?.files, `${file} ${group}.files`, failures);
      }
      break;
    }
    case 'arch-debt-budget':
      compareArchDebtBudget(baseValue, headValue, file, failures);
      break;
    case 'quality-baseline':
      compareQualityBaseline(baseValue, headValue, file, failures);
      break;
    case 'array-fields':
      for (const field of spec.fields || []) {
        arrayGrowth(baseValue?.[field], headValue?.[field], `${file} ${field}`, failures);
      }
      break;
    case 'identity-array':
      identityArrayGrowth(baseValue, headValue, spec.identity || [], file, failures);
      break;
    case 'npm-exceptions':
      compareNpmExceptions(baseValue, headValue, spec, file, failures);
      break;
    case 'arch-source-allowlists': {
      const before = extractArchSourceAllowlists(baseValue || '');
      const after = extractArchSourceAllowlists(headValue || '');
      setMapGrowth(before, after, `${file} `, failures);
      break;
    }
    case 'code-quality-source': {
      const before = extractRuleFileExemptions(baseValue || '');
      const after = extractRuleFileExemptions(headValue || '');
      setMapGrowth(before, after, `${file} RULE_FILE_EXEMPT.`, failures);
      break;
    }
    default:
      failures.push(`${REGISTRY_FILE}: kind inconnu '${spec.kind}' pour ${file}`);
  }
}

function isJsonSpec(spec) {
  return !['arch-source-allowlists', 'code-quality-source'].includes(spec.kind);
}

function compareRegisteredSources(base, head, registry, failures) {
  const specs = registry?.files && typeof registry.files === 'object' ? registry.files : {};
  for (const [file, spec] of Object.entries(specs).sort(([a], [b]) => a.localeCompare(b))) {
    const baseValue = isJsonSpec(spec) ? readJsonAt(base, file) : readAt(base, file);
    const headValue = isJsonSpec(spec) ? readJsonAt(head, file) : readAt(head, file);
    if (baseValue != null && headValue == null) continue; // suppression = réduction de surface
    if (headValue == null) continue;
    compareSpec(file, spec, baseValue, headValue, failures);
  }
}

function findUnknownToleranceFiles(head, registry, failures) {
  const known = new Set(Object.keys(registry?.files || {}));
  const suspicious = /(?:baseline|exempt|exception|suppress|allowlist)/i;
  for (const file of trackedGovernanceFiles(head).sort()) {
    if (!file.endsWith('.json')) continue;
    const name = file.split('/').pop();
    if (!suspicious.test(name)) continue;
    if (!known.has(file)) failures.push(`registre de tolérance non classifié: ${file}`);
  }
}

function registryForComparison(base, head, failures) {
  const baseRegistry = readJsonAt(base, REGISTRY_FILE);
  const headRegistry = readJsonAt(head, REGISTRY_FILE);
  if (!headRegistry) {
    failures.push(`${REGISTRY_FILE}: registre absent du HEAD`);
    return baseRegistry || { files: {} };
  }
  if (baseRegistry && stableStringify(baseRegistry) !== stableStringify(headRegistry)) {
    failures.push(`${REGISTRY_FILE}: registre Debt Zero modifié`);
    return baseRegistry;
  }
  // Bootstrap unique : main n'a pas encore de registre, le HEAD devient la source.
  return baseRegistry || headRegistry;
}

function parseApprovalComment(body, expectedHead) {
  const text = String(body || '').trim();
  const lines = text.split(/\r?\n/);
  const first = (lines[0] || '').trim();
  const match = first.match(/^DEBT-APPROVAL\s+([0-9a-f]{40})$/i);
  if (!match || match[1].toLowerCase() !== expectedHead.toLowerCase()) return null;

  const explanation = lines.find(line => /^Explication\s*:/i.test(line))
    ?.replace(/^Explication\s*:\s*/i, '').trim() || '';
  const justification = lines.find(line => /^Justification\s*:/i.test(line))
    ?.replace(/^Justification\s*:\s*/i, '').trim() || '';

  if (explanation.length < 20 || justification.length < 20) return null;
  return { head: match[1], explanation, justification };
}

function extractPrFromRef(ref) {
  const match = String(ref || '').match(/^refs\/pull\/(\d+)\//);
  return match ? match[1] : null;
}

function githubGet(path) {
  const headers = {
    'User-Agent': 'komerce-debt-zero-gate',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'api.github.com', path, method: 'GET', headers }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`GitHub API HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
          return;
        }
        try { resolve(JSON.parse(data)); }
        catch (error) { reject(new Error(`GitHub API JSON invalide: ${error.message}`)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function findHumanApproval(headSha) {
  const repository = process.env.GITHUB_REPOSITORY;
  const prNumber = process.env.PR_NUMBER || process.env.GITHUB_PR_NUMBER || extractPrFromRef(process.env.GITHUB_REF);
  if (!repository || !prNumber) return null;
  const [owner, repo] = repository.split('/');
  const comments = await githubGet(`/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`);

  for (const comment of [...comments].reverse()) {
    if (comment?.user?.login !== APPROVER) continue;
    const parsed = parseApprovalComment(comment.body, headSha);
    if (parsed) return { ...parsed, author: comment.user.login, commentId: comment.id };
  }
  return null;
}

function run({ base = BASE, head = HEAD } = {}) {
  if (!base) throw new Error('--base (ou BASE_SHA) est obligatoire');
  if (!head) throw new Error('--head (ou HEAD_SHA) est obligatoire');

  const failures = [];
  const files = changedFiles(base, head);
  const registry = registryForComparison(base, head, failures);

  compareRegisteredSources(base, head, registry, failures);
  findUnknownToleranceFiles(head, registry, failures);
  qualityDisableGrowth(base, head, files, failures);

  return { base, head: resolveCommit(head), changedFiles: files, failures };
}

async function main() {
  const result = run();
  console.log('\nDEBT ZERO GATE v2 — anti-croissance des tolérances\n');

  if (result.failures.length === 0) {
    console.log('✔ Aucun mécanisme de dette/tolérance n\'a augmenté et aucun registre inconnu n\'est apparu.\n');
    return;
  }

  console.error('▲ Nouvelle dette/tolérance ou modification de gouvernance détectée :');
  for (const failure of result.failures) console.error(`  - ${failure}`);

  let approval = null;
  try { approval = await findHumanApproval(result.head); }
  catch (error) { console.error(`\n  Validation humaine non vérifiable: ${error.message}`); }

  if (approval) {
    console.log(`\n✔ Exception approuvée humainement par ${approval.author} pour HEAD ${result.head}.`);
    console.log(`  Explication : ${approval.explanation}`);
    console.log(`  Justification : ${approval.justification}\n`);
    return;
  }

  console.error(`\n✖ Blocage Debt Zero. Validation humaine requise de ${APPROVER}.`);
  console.error('  Ajouter un commentaire PR exactement sous cette forme :\n');
  console.error(`  DEBT-APPROVAL ${result.head}`);
  console.error('  Explication: <décrire précisément la dette/tolérance ou la modification de gouvernance>');
  console.error('  Justification: <expliquer pourquoi elle est acceptée maintenant>\n');
  console.error('  Tout nouveau commit change le SHA et invalide automatiquement cette validation.\n');
  process.exit(1);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`✖ debt-zero-gate: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  arrayGrowth,
  countQualityDisables,
  extractArchSourceAllowlists,
  extractRuleFileExemptions,
  identityArrayGrowth,
  numericMapGrowth,
  objectKeyGrowth,
  parseApprovalComment,
  registryForComparison,
  stableStringify,
  extractPrFromRef,
  run,
};
