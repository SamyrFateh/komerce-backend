#!/usr/bin/env node
'use strict';

/**
 * check-keyframes.js — Garde-fou animations CSS orphelines
 *
 * Même famille que check-css-vars.js : `animation: monAnim .3s ease` où
 * `@keyframes monAnim` n'existe nulle part (typo, rename incomplet, règle
 * supprimée mais pas l'appelant) → le navigateur ignore l'animation en
 * silence, aucune erreur console, aucun crash. L'élément reste statique là
 * où un designer attendait un effet.
 *
 * Ce que ce script vérifie :
 *   V-KF1  Chaque nom dans `animation:` / `animation-name:` (shorthand ou
 *          liste séparée par virgules) correspond à un `@keyframes` déclaré
 *          quelque part dans css/. Les mots-clés CSS valides (none, initial,
 *          inherit, unset, paused, running, forwards, backwards, both,
 *          infinite, alternate, normal, reverse, alternate-reverse, linear,
 *          ease, ease-in, ease-in-out, ease-out, step-start, step-end) et
 *          les fonctions de timing (cubic-bezier(...), steps(...), var(...))
 *          sont exclus — seul le token qui reste après filtrage est
 *          considéré comme un nom d'animation candidat.
 *
 * Ce que ce script NE fait PAS :
 *   - Suivre les noms d'animation posés dynamiquement via JS
 *     (`el.style.animation = ...`) — hors scope statique, cohérent avec les
 *     autres gates DOM/CSS du projet.
 *
 * Usage :
 *   node scripts/check-keyframes.js
 *   npm run check:keyframes
 */

const fs   = require('fs');
const path = require('path');

const ROOT    = path.resolve(__dirname, '..');
const CSS_DIR = path.join(ROOT, 'css');

const RESET = '\x1b[0m', RED = '\x1b[31m', GREEN = '\x1b[32m',
      BOLD = '\x1b[1m', DIM = '\x1b[2m', CYAN = '\x1b[36m';

function rel(p) { return path.relative(ROOT, p); }

function collectFiles(dir, ext) {
  const out = [];
  function walk(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'coverage'
        || e.name === 'playwright-report' || e.name === 'test-results') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (e.name.endsWith(ext)) out.push(full);
    }
  }
  walk(dir);
  return out;
}

const CSS_KEYWORDS = new Set([
  'none', 'initial', 'inherit', 'unset', 'revert', 'paused', 'running',
  'forwards', 'backwards', 'both', 'infinite', 'alternate', 'normal',
  'reverse', 'alternate-reverse', 'linear', 'ease', 'ease-in', 'ease-out',
  'ease-in-out', 'step-start', 'step-end',
]);

function collectDefinedKeyframes(cssFiles) {
  const defined = new Set();
  const KF_RE = /@(?:-webkit-|-moz-|-o-)?keyframes\s+([a-zA-Z_][a-zA-Z0-9_-]*)/g;
  for (const file of cssFiles) {
    const src = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = KF_RE.exec(src))) defined.add(m[1]);
  }
  return defined;
}

// Extrait, pour chaque déclaration animation(-name), les tokens candidats
// (identifiants qui ne sont ni mots-clés CSS, ni valeurs numériques/unités,
// ni des fonctions comme cubic-bezier(...)/steps(...)/var(...)).
function collectAnimationRefs(cssFiles) {
  const refs = []; // { name, file, line }
  const DECL_RE = /animation(-name)?\s*:\s*([^;{}]+)/g;
  for (const file of cssFiles) {
    const src = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = DECL_RE.exec(src))) {
      const rawValue = m[2];
      const lineNo = src.slice(0, m.index).split('\n').length;
      // Découper sur les virgules de haut niveau (plusieurs animations).
      const parts = splitTopLevel(rawValue, ',');
      for (const part of parts) {
        const tokens = part.trim().split(/\s+/).filter(Boolean);
        for (const tok of tokens) {
          if (tok.includes('(')) continue;               // cubic-bezier(...), var(...), steps(...)
          if (/^-?\d/.test(tok)) continue;                // durées/délais numériques (.3s, 200ms, 2)
          if (CSS_KEYWORDS.has(tok.toLowerCase())) continue;
          if (!/^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(tok)) continue;
          refs.push({ name: tok, file, line: lineNo });
        }
      }
    }
  }
  return refs;
}

function splitTopLevel(str, sep) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of str) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function main() {
  const cssFiles = collectFiles(CSS_DIR, '.css');
  const defined = collectDefinedKeyframes(cssFiles);
  const refs = collectAnimationRefs(cssFiles);

  console.log(`\n${BOLD}${CYAN}━━━ check-keyframes — Komerce Boutique ━━━${RESET}`);
  console.log(`${DIM}${cssFiles.length} feuille(s) CSS — ${defined.size} @keyframes définie(s) — ${refs.length} référence(s) animation(-name)${RESET}\n`);

  const seen = new Map();
  for (const r of refs) {
    if (defined.has(r.name)) continue;
    if (!seen.has(r.name)) seen.set(r.name, []);
    seen.get(r.name).push(r);
  }

  const errors = [];
  for (const [name, occs] of seen) {
    const locs = occs.slice(0, 3).map(o => `${rel(o.file)}:${o.line}`).join(', ');
    errors.push({
      code: 'V-KF1',
      msg: `animation '${name}' référencée mais @keyframes ${name} introuvable`,
      detail: `${locs}${occs.length > 3 ? ` …(+${occs.length - 3})` : ''}`,
    });
  }

  for (const e of errors) {
    console.log(`${RED}✖${RESET} ${BOLD}[${e.code}]${RESET} ${e.msg}`);
    console.log(`  ${DIM}↳ ${e.detail}${RESET}`);
  }

  console.log(`\n${BOLD}${CYAN}━━━ Résultat ━━━${RESET}`);
  if (errors.length === 0) {
    console.log(`${GREEN}${BOLD}✔ Toutes les animations référencées ont un @keyframes correspondant.${RESET}\n`);
    process.exit(0);
  }
  console.log(`${RED}${BOLD}✖ ${errors.length} erreur(s)${RESET}`);
  console.log(`${DIM}Corrigez avant de merger.${RESET}\n`);
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  collectDefinedKeyframes,
  collectAnimationRefs,
  splitTopLevel,
};
