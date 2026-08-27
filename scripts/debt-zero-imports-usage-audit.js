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
    out.push({ names, source: m[5] });
  }
  return out;
}

function resolve(importer, spec) {
  if (!spec.startsWith('.')) return null;
  let p = path.resolve(path.dirname(importer), spec);
  if (!path.extname(p)) p += '.js';
  return p;
}

function wordCount(src, name) {
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'g');
  return (src.match(re) || []).length;
}

const jsFiles = walk(JS);
const testFiles = walk(TESTS);
const exportMap = new Map(jsFiles.map(f => [f, SKIP.has(path.basename(f)) ? new Set() : exportsOf(f)]));
const consumed = new Map(jsFiles.map(f => [f, new Set()]));
const testConsumed = new Map(jsFiles.map(f => [f, new Map()]));

for (const importer of jsFiles) {
  for (const imp of importsOf(importer)) {
    const target = resolve(importer, imp.source);
    if (!target || !consumed.has(target)) continue;
    for (const n of imp.names) consumed.get(target).add(n);
  }
}

for (const importer of testFiles) {
  for (const imp of importsOf(importer)) {
    const target = resolve(importer, imp.source);
    if (!target || !testConsumed.has(target)) continue;
    for (const n of imp.names) {
      const byName = testConsumed.get(target);
      if (!byName.has(n)) byName.set(n, []);
      byName.get(n).push(path.relative(ROOT, importer));
    }
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
  const exactTestImports = testConsumed.get(item.file)?.get(item.name) || [];
  const sourceRefs = [];
  for (const f of jsFiles) {
    if (f === item.file) continue;
    const src = fs.readFileSync(f, 'utf8');
    if (wordCount(src, item.name)) sourceRefs.push(path.relative(ROOT, f));
  }
  let category;
  if (exactTestImports.length) category = 'TEST_IMPORT';
  else if (sourceRefs.length) category = 'INDIRECT_SOURCE';
  else if (ownRefs) category = 'INTERNAL';
  else category = 'NONE';
  counts.set(category, (counts.get(category) || 0) + 1);
  console.log(`${category}\t${path.relative(ROOT, item.file)}\t${item.name}\town=${ownRefs}\tsource=${sourceRefs.join(',') || '-'}\ttestImports=${exactTestImports.join(',') || '-'}`);
}
console.log('category_counts=' + JSON.stringify(Object.fromEntries(counts)));
