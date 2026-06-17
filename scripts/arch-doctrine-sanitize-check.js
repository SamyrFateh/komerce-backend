'use strict';

/**
 * @komerce-arch
 * @role         governance-doctrine-sanitize
 * @domain       governance
 * @layer        tooling
 * @criticality  medium
 * @purpose      Porte doctrine sanitize_before_render. Deux paliers, fidele a la
 *               discipline du pre-commit (bloquer rarement et juste) :
 *                 - BLOQUANT : une SOURCE EXTERNE (req/params/query/body, location,
 *                   window.name, storage, document.URL/referrer) atterrit dans un sink
 *                   HTML (innerHTML/outerHTML/insertAdjacentHTML/document.write) sans
 *                   echappement. C'est la seule XSS prouvable ligne a ligne.
 *                 - OBSERVATION : tout rendu dynamique non visiblement echappe (aide a
 *                   la revue, ne bloque jamais).
 *               Capture l'instruction MULTI-LIGNE pour voir le sanitize/escape qui peut
 *               etre quelques lignes plus bas (template .map(...)).
 * @inputs       diff staged (defaut) ou fichiers front .js
 * @outputs      code de sortie non-nul UNIQUEMENT si une source externe non echappee
 *               est introduite dans un sink HTML
 * @depends      git
 * @used-by      pre-commit, CI
 * @db-read      none
 * @db-write     none
 * @db-txn       none
 * @doctrine     KOMERCE_ARCH_GRAPH_DOCTRINE, sanitize_before_render
 * @impact-areas governance, security, boutique
 *
 * Usage :
 *   node scripts/arch-doctrine-sanitize-check.js             # diff staged (bloque si source externe)
 *   node scripts/arch-doctrine-sanitize-check.js --diff=origin/main
 *   node scripts/arch-doctrine-sanitize-check.js --all [dir] # sweep complet (observation)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = process.cwd();
const FRONT_ROOTS = ['public'];
const EXT = /\.(js|cjs|mjs)$/;
const SINK_RE = /(?:\b(?:inner|outer)HTML\s*\+?=|\binsertAdjacentHTML\s*\(|\bdocument\.write\s*\()/;
const TAINT_RE = /\b(?:req|params|query|body)\.|location\.(?:hash|search|href|pathname)|document\.(?:URL|referrer|location)|window\.name|(?:local|session)Storage\b|URLSearchParams/;
const ESCAPER_RE = /sanitize\s*\(|escapeHtml\s*\(|DOMPurify/;

function isSafeInterp(x) {
  return ESCAPER_RE.test(x)
      || /safe[A-Z]\w*|fmt\w*\s*\(/.test(x)
      || /^\$\{\s*[\w.]*\b(?:id|length|count|size|index|idx)\b[\w.]*\s*\}$/.test(x)
      || /^\$\{\s*[-+*/%\d\s().]+\}$/.test(x)
      || /^\$\{[^}]*\?[^}]*(['"`]).*?\1[^}]*:[^}]*\1?.*?\1?[^}]*\}$/.test(x) // ternaire de litteraux
      || /^\$\{\s*(['"`]).*?\1\s*\}$/.test(x);
}

function depthDelta(s) {
  let d = 0;
  for (const c of s) { if ('([{'.includes(c)) d++; else if (')]}'.includes(c)) d--; }
  return d;
}

// capture l'instruction multi-ligne a partir de la ligne du sink
function captureStatement(lines, idx) {
  let stmt = lines[idx];
  let bt = (stmt.match(/`/g) || []).length;
  let depth = depthDelta(stmt);
  let j = idx;
  while (j < lines.length - 1 && j < idx + 60 && ((bt % 2 === 1) || depth > 0)) {
    j++;
    stmt += '\n' + lines[j];
    bt += (lines[j].match(/`/g) || []).length;
    depth += depthDelta(lines[j]);
  }
  return stmt;
}

// 'safe' | 'observe' | 'block'
function classify(stmt) {
  const escaped = ESCAPER_RE.test(stmt) || /\brender\w*\s*\(|\b\w*Markup\s*\(/.test(stmt);
  const interps = stmt.match(/\$\{[^}]*\}/g) || [];
  const taintedInterp = interps.some(x => TAINT_RE.test(x) && !ESCAPER_RE.test(x));

  // partie droite (apres le sink) pour detecter une source externe directe
  let rhs = stmt;
  const eq = stmt.split(/(?:inner|outer)HTML\s*\+?=/);
  if (eq.length > 1) rhs = eq.slice(1).join('=');
  else { const m = stmt.match(/(?:insertAdjacentHTML\s*\(|document\.write\s*\()([\s\S]*)$/); if (m) rhs = m[1]; }
  const directTaint = TAINT_RE.test(rhs) && !ESCAPER_RE.test(rhs);

  if ((taintedInterp || directTaint) && !escaped) return 'block';   // XSS prouvable
  if (escaped) return 'safe';

  // sûr aussi : vide, concat d'HTML existant, litteral a interpolations toutes sûres
  const r = rhs.replace(/;\s*$/, '').trim();
  if (r === '' || /^(?:''|""|``|'\s*'|"\s*")$/.test(r)) return 'safe';
  if (/\b(?:inner|outer)HTML\b/.test(r)) return 'safe';
  if (/^['"`]/.test(r) && interps.every(isSafeInterp)) return 'safe';

  return 'observe'; // dynamique, non visiblement echappe -> a revoir, mais on ne bloque pas
}

const isComment = l => { const t = l.trim(); return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'); };
const isFront = f => { f = f.replace(/\\/g, '/'); return EXT.test(f) && FRONT_ROOTS.some(r => f === r || f.startsWith(r + '/') || f.includes('/' + r + '/')); };

function scanFile(file, onlyLines) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) return [];
  const lines = fs.readFileSync(full, 'utf-8').split('\n');
  const out = [];
  lines.forEach((line, i) => {
    if (onlyLines && !onlyLines.has(i + 1)) return;
    if (isComment(line) || !SINK_RE.test(line)) return;
    const verdict = classify(captureStatement(lines, i));
    if (verdict !== 'safe') out.push({ file, line: i + 1, code: line.trim().slice(0, 110), verdict });
  });
  return out;
}

function changedLineMap(ref) {
  const cmd = ref ? `git diff --unified=0 ${ref}` : 'git diff --cached --unified=0';
  let out; try { out = execSync(cmd, { encoding: 'utf-8', timeout: 30000 }); } catch { return new Map(); }
  const map = new Map(); let cur = null;
  for (const ln of out.split('\n')) {
    const f = ln.match(/^\+\+\+ b\/(.+)$/); if (f) { cur = f[1]; if (!map.has(cur)) map.set(cur, new Set()); continue; }
    const h = ln.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (h && cur) { const s = +h[1], n = h[2] === undefined ? 1 : +h[2]; for (let k = 0; k < n; k++) map.get(cur).add(s + k); }
  }
  return map;
}

function walk(rel, acc) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return;
  const st = fs.statSync(full);
  if (st.isFile()) { if (EXT.test(full)) acc.push(rel.replace(/\\/g, '/')); return; }
  if (!st.isDirectory()) return;
  for (const e of fs.readdirSync(full)) { if (['node_modules', '.git', 'dist', 'coverage'].includes(e)) continue; walk(path.join(rel, e), acc); }
}

function main() {
  const argv = process.argv.slice(2);
  const all = argv.includes('--all');
  const diffArg = argv.find(a => a.startsWith('--diff='));
  const dir = all ? argv.find(a => !a.startsWith('--')) : null;

  let findings = [];
  if (all) {
    const files = []; for (const r of (dir ? [dir] : FRONT_ROOTS)) walk(r, files);
    for (const f of files) findings.push(...scanFile(f, null));
  } else {
    const map = changedLineMap(diffArg ? diffArg.split('=')[1] : null);
    for (const [file, set] of map) if (isFront(file)) findings.push(...scanFile(file, set));
  }

  const blocks = findings.filter(f => f.verdict === 'block');
  const obs = findings.filter(f => f.verdict === 'observe');

  console.log('============================================================');
  console.log(' KOMERCE - Doctrine sanitize_before_render');
  console.log('============================================================');
  console.log('Mode                    : ' + (all ? 'observation (sweep)' : 'bloquant (diff)'));
  console.log('Bloquant (source ext.)  : ' + blocks.length);
  console.log('Observation (a revoir)  : ' + obs.length);
  if (blocks.length) {
    console.log('--- BLOQUANT : source externe non echappee dans un sink HTML ---');
    for (const f of blocks) console.log('  ' + f.file + ':' + f.line + '\n      ' + f.code);
  }
  if (obs.length && all) {
    console.log('--- OBSERVATION : rendu dynamique non visiblement echappe ---');
    for (const f of obs) console.log('  ' + f.file + ':' + f.line + '  ' + f.code);
  }
  console.log('============================================================');

  if (!all && blocks.length) {
    console.log('Doctrine violee : entree externe rendue sans echappement. Corrige avec');
    console.log('sanitize(...) / escapeHtml(...) avant le rendu.');
    process.exit(1);
  }
  console.log('OK : aucune source externe non echappee introduite.'
    + (obs.length ? ' (' + obs.length + ' rendu(s) en observation)' : ''));
}

if (require.main === module) main();
module.exports = { classify, captureStatement, isSafeInterp };
