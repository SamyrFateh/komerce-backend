'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'public', 'boutique');
const JS = path.join(ROOT, 'js');
const TESTS = path.join(ROOT, 'tests');
const SKIP = new Set(['main.js', 'komerce-api.js']);

function walk(dir, ext = '.js') {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === 'dist') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full, ext));
    else if (ent.name.endsWith(ext)) out.push(full);
  }
  return out;
}

function exportsOf(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = new Set();
  let m;
  const direct = /^export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  while ((m = direct.exec(src))) out.add(m[1]);
  const flat = src.replace(/export\s*\{([^}]+)\}/gms, (_, inner) => `export{${inner.replace(/\n/g, ' ')}}`);
  const block = /^export\{([^}]+)\}/gm;
  while ((m = block.exec(flat))) {
    for (const item of m[1].split(',').map(x => x.trim()).filter(Boolean)) {
      const parts = item.split(/\s+as\s+/);
      const original = parts[0].trim();
      const alias = parts[1]?.trim();
      if (original && original !== 'default') out.add(original);
      if (alias && alias !== 'default') out.add(alias);
    }
  }
  return out;
}

function importsOf(file) {
  const src = fs.readFileSync(file, 'utf8');
  const flat = src.replace(/^import\s*(\{[^}]*\}|\*[^;]*|[A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*['"][^'"]+['"]/gms, m => m.replace(/\n/g, ' '));
  const re = /^import\s*(?:\{([^}]*)\}|(\*\s+as\s+\w+)|([A-Za-z_$][\w$]*))?\s*(?:,\s*\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/gm;
  const out = [];
  let m;
  while ((m = re.exec(flat))) {
    const names = [];
    const block = `${m[1] || ''},${m[4] || ''}`.replace(/^,|,$/g, '');
    for (const item of block.split(',').map(x => x.trim()).filter(Boolean)) names.push(item.split(/\s+as\s+/)[0].trim());
    out.push({ names, source: m[5], kind: 'esm' });
  }
  return out;
}

function parseRequiredNames(block) {
  return block.split(',').map(x => x.trim()).filter(Boolean).map((item) => item.split(':')[0].trim()).filter(Boolean);
}

function requiresOf(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = [];
  let m;
  const declared = /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/gms;
  while ((m = declared.exec(src))) out.push({ names: parseRequiredNames(m[1]), source: m[2], kind: 'require' });
  const assigned = /\(\s*\{([^}]+)\}\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)\s*\)/gms;
  while ((m = assigned.exec(src))) out.push({ names: parseRequiredNames(m[1]), source: m[2], kind: 'require-assignment' });
  return out;
}

function dynamicImportsOf(file, exportMap) {
  const src = fs.readFileSync(file, 'utf8');
  const out = [];
  let m;
  const re = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = re.exec(src))) {
    const target = resolve(file, m[1]);
    if (!target || !exportMap.has(target)) continue;
    const names = [];
    for (const name of exportMap.get(target)) {
      const propRe = new RegExp(`(?:\\.|\\?\\.)${escapeRe(name)}\\b`);
      if (propRe.test(src)) names.push(name);
    }
    out.push({ names, source: m[1], kind: 'dynamic' });
  }
  return out;
}

function resolve(importer, spec) {
  if (!spec.startsWith('.')) return null;
  let p = path.resolve(path.dirname(importer), spec);
  if (!path.extname(p)) p += '.js';
  return p;
}

function escapeRe(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function wordCount(src, name) {
  const re = new RegExp(`\\b${escapeRe(name)}\\b`, 'g');
  return (src.match(re) || []).length;
}

const jsFiles = walk(JS);
const testFiles = walk(TESTS);
const exportMap = new Map(jsFiles.map(f => [f, SKIP.has(path.basename(f)) ? new Set() : exportsOf(f)]));
const consumed = new Map(jsFiles.map(f => [f, new Set()]));
const sourceDynamic = new Map(jsFiles.map(f => [f, new Map()]));
const testConsumed = new Map(jsFiles.map(f => [f, new Map()]));

function record(map, target, name, importer) {
  if (!map.has(target)) return;
  const byName = map.get(target);
  if (!byName.has(name)) byName.set(name, []);
  byName.get(name).push(path.relative(ROOT, importer));
}

for (const importer of jsFiles) {
  for (const imp of importsOf(importer)) {
    const target = resolve(importer, imp.source);
    if (!target || !consumed.has(target)) continue;
    for (const n of imp.names) consumed.get(target).add(n);
  }
  for (const imp of dynamicImportsOf(importer, exportMap)) {
    const target = resolve(importer, imp.source);
    if (!target) continue;
    for (const n of imp.names) record(sourceDynamic, target, n, importer);
  }
}

for (const importer of testFiles) {
  for (const imp of [...importsOf(importer), ...requiresOf(importer)]) {
    const target = resolve(importer, imp.source);
    if (!target || !testConsumed.has(target)) continue;
    for (const n of imp.names) record(testConsumed, target, n, importer);
  }
}

const unused = [];
for (const file of jsFiles) {
  if (!path.basename(file).startsWith('b-') || SKIP.has(path.basename(file))) continue;
  for (const name of exportMap.get(file) || []) {
    if (!consumed.get(file).has(name)) unused.push({ file, name });
  }
}

console.log(`unused_exports=${unused.length}`);
const counts = new Map();
for (const item of unused) {
  const own = fs.readFileSync(item.file, 'utf8');
  const ownRefs = Math.max(0, wordCount(own, item.name) - 1);
  const testConsumers = testConsumed.get(item.file)?.get(item.name) || [];
  const dynamicConsumers = sourceDynamic.get(item.file)?.get(item.name) || [];
  let category;
  if (dynamicConsumers.length) category = 'DYNAMIC_RUNTIME';
  else if (testConsumers.length) category = 'TEST_REQUIRE';
  else if (ownRefs) category = 'INTERNAL_ONLY';
  else category = 'NO_CONSUMER';
  counts.set(category, (counts.get(category) || 0) + 1);
  console.log(`${category}\t${path.relative(ROOT, item.file)}\t${item.name}\town=${ownRefs}\tdynamic=${dynamicConsumers.join(',') || '-'}\ttests=${testConsumers.join(',') || '-'}`);
}
console.log('category_counts=' + JSON.stringify(Object.fromEntries(counts)));
