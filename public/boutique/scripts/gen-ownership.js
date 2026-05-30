#!/usr/bin/env node
'use strict';

/**
 * scripts/gen-ownership.js
 *
 * GÉNÉRATEUR DE CARTE DE PROPRIÉTÉ — point zéro de vérité de la boutique.
 *
 * Lit le code RÉEL (css/*.css + js/*.js) et produit docs/BOUTIQUE_OWNERSHIP_LIVE.md.
 * Ce fichier ne peut pas mentir : il est régénéré, jamais édité à la main.
 *
 * Détecte :
 *   1. Multipropriété CSS  — quel(s) fichier(s) stylent chaque famille .k-*
 *   2. Multipropriété DOM  — quel(s) module(s) JS écrivent le DOM de chaque zone
 *   3. Breakpoints         — toutes les valeurs @media par fichier (violation si ≠ 900/1200)
 *   4. Dette               — !important, CSS injecté via JS
 *
 * Usage : node scripts/gen-ownership.js
 * Precommit : ajouter "node scripts/gen-ownership.js && git add docs/BOUTIQUE_OWNERSHIP_LIVE.md"
 */

const fs   = require('fs');
const path = require('path');

const ROOT    = path.resolve(__dirname, '..');
const CSS_DIR = path.join(ROOT, 'css');
const JS_DIR  = path.join(ROOT, 'js');
const OUT     = path.join(ROOT, 'docs', 'BOUTIQUE_OWNERSHIP_LIVE.md');

// Breakpoints autorisés par la charte projet
const ALLOWED_BP = new Set(['900', '1200']);

// Familles de composants à tracer (préfixe de classe → libellé)
const FAMILIES = [
  ['k-modal',          'Modal produit'],
  ['k-side-cart',      'Side-cart desktop'],
  ['k-cart',           'Panier'],
  ['k-card',           'Carte produit'],
  ['k-grid',           'Grille produits'],
  ['k-header',         'Header'],
  ['k-hero',           'Hero'],
  ['k-chip',           'Chips catégories'],
  ['k-mega',           'Mega-nav desktop'],
  ['k-group',          'Panier groupe'],
  ['k-bnav',           'Bottom-nav mobile'],
  ['k-catalog',        'Section catalogue'],
];

function listFiles(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith(ext)).map(f => path.join(dir, f));
}

function read(f) { return fs.readFileSync(f, 'utf8'); }

// ─── 1. Multipropriété CSS ────────────────────────────────────────────────────
function cssOwnership() {
  const cssFiles = listFiles(CSS_DIR, '.css').filter(f => !f.includes('/dist/'));
  const rows = [];
  for (const [prefix, label] of FAMILIES) {
    const owners = [];
    const re = new RegExp(`\\.${prefix}[\\s,{:.\\[>]`, 'g');
    for (const f of cssFiles) {
      const count = (read(f).match(re) || []).length;
      if (count > 0) owners.push({ file: path.basename(f), count });
    }
    owners.sort((a, b) => b.count - a.count);
    rows.push({ label, prefix, owners });
  }
  return rows;
}

// ─── 2. Multipropriété DOM (JS) ───────────────────────────────────────────────
function domOwnership() {
  const jsFiles = listFiles(JS_DIR, '.js');
  const rows = [];
  for (const f of jsFiles) {
    const src = read(f);
    const dom = (src.match(/appendChild|insertBefore|removeChild|innerHTML\s*=|createElement/g) || []).length;
    const css = (src.match(/\.style\.|cssText|<style|insertRule/g) || []).length;
    const busOn   = (src.match(/bus\.on\(/g) || []).length;
    const busEmit = (src.match(/bus\.emit\(/g) || []).length;
    // Quelles familles ce module cible-t-il ?
    const targets = FAMILIES.filter(([p]) => new RegExp(`['"\\.#]${p}`).test(src)).map(([, l]) => l);
    if (dom + css > 0) {
      rows.push({ file: path.basename(f), dom, css, busOn, busEmit, targets });
    }
  }
  rows.sort((a, b) => (b.dom + b.css) - (a.dom + a.css));
  return rows;
}

// ─── 3. Breakpoints ───────────────────────────────────────────────────────────
function breakpoints() {
  const cssFiles = listFiles(CSS_DIR, '.css').filter(f => !f.includes('/dist/'));
  const perFile = [];
  const allBp = new Set();
  for (const f of cssFiles) {
    const bps = [...read(f).matchAll(/@media[^{]*?(\d{2,4})px/g)].map(m => m[1]);
    const uniq = [...new Set(bps)];
    uniq.forEach(b => allBp.add(b));
    const violations = uniq.filter(b => !ALLOWED_BP.has(b));
    if (uniq.length) perFile.push({ file: path.basename(f), uniq, violations });
  }
  perFile.sort((a, b) => b.violations.length - a.violations.length);
  return { perFile, allBp: [...allBp].sort((a, b) => a - b) };
}

// ─── 4. Dette ───────────────────────────────────────────────────────────────
function debt() {
  const cssFiles = listFiles(CSS_DIR, '.css').filter(f => !f.includes('/dist/'));
  const jsFiles  = listFiles(JS_DIR, '.js');
  const importantPerFile = [];
  let importantTotal = 0;
  for (const f of cssFiles) {
    const c = (read(f).match(/!important/g) || []).length;
    if (c > 0) { importantPerFile.push({ file: path.basename(f), count: c }); importantTotal += c; }
  }
  importantPerFile.sort((a, b) => b.count - a.count);

  const jsInject = [];
  for (const f of jsFiles) {
    const c = (read(f).match(/cssText|<style|insertRule/g) || []).length;
    if (c > 3) jsInject.push({ file: path.basename(f), count: c });
  }
  jsInject.sort((a, b) => b.count - a.count);
  return { importantPerFile, importantTotal, jsInject };
}

// ─── Rendu Markdown ───────────────────────────────────────────────────────────
function render() {
  const css = cssOwnership();
  const dom = domOwnership();
  const bp  = breakpoints();
  const d   = debt();
  const now = new Date().toISOString().slice(0, 10);

  let md = `# Boutique — Carte de propriété (LIVE / auto-générée)

> ⚠️ **NE PAS ÉDITER À LA MAIN.** Généré par \`scripts/gen-ownership.js\` depuis le code réel.
> Régénérer après chaque PR : \`node scripts/gen-ownership.js\`
> Dernière génération : ${now}

Ce fichier répond à une seule question : **quand je touche X, qu'est-ce que j'impacte ?**

---

## 1. Multipropriété CSS — qui style chaque composant

🔴 = plusieurs fichiers stylent la même famille (risque de cascade incontrôlée).

| Composant | Fichiers CSS (sélecteurs) | Owners | État |
|-----------|---------------------------|:------:|:----:|
`;
  for (const r of css) {
    if (!r.owners.length) continue;
    const list = r.owners.map(o => `${o.file} (${o.count})`).join(', ');
    const flag = r.owners.length > 1 ? '🔴' : '✅';
    md += `| **${r.label}** \`.${r.prefix}*\` | ${list} | ${r.owners.length} | ${flag} |\n`;
  }

  md += `\n---\n\n## 2. Multipropriété DOM — quels modules JS écrivent le DOM\n\n`;
  md += `Tri par volume d'écriture (DOM + CSS injecté). Les modules en tête sont les owners de fait.\n\n`;
  md += `| Module JS | DOM | CSS-inj | bus on/emit | Composants ciblés |\n`;
  md += `|-----------|:---:|:-------:|:-----------:|-------------------|\n`;
  for (const r of dom) {
    md += `| \`${r.file}\` | ${r.dom} | ${r.css} | ${r.busOn}/${r.busEmit} | ${r.targets.join(', ') || '—'} |\n`;
  }

  md += `\n---\n\n## 3. Breakpoints — violation V1\n\n`;
  md += `Charte projet : **un seul breakpoint, 900px** (1200px toléré). Tout le reste est une violation.\n\n`;
  md += `**Breakpoints distincts trouvés (${bp.allBp.length})** : ${bp.allBp.map(b => b + 'px').join(', ')}\n\n`;
  md += `| Fichier CSS | Breakpoints utilisés | Violations |\n|-------------|----------------------|:----------:|\n`;
  for (const r of bp.perFile) {
    const viol = r.violations.length ? '🔴 ' + r.violations.map(v => v + 'px').join(', ') : '✅';
    md += `| ${r.file} | ${r.uniq.map(u => u + 'px').join(', ')} | ${viol} |\n`;
  }

  md += `\n---\n\n## 4. Dette CSS\n\n`;
  md += `### \`!important\` — total : ${d.importantTotal}\n\n`;
  md += `| Fichier | Occurrences |\n|---------|:-----------:|\n`;
  for (const r of d.importantPerFile) md += `| ${r.file} | ${r.count} |\n`;
  md += `\n### CSS injecté via JS (devrait être 0 — le CSS vit dans .css)\n\n`;
  md += `| Module JS | Injections |\n|-----------|:----------:|\n`;
  for (const r of d.jsInject) md += `| ${r.file} | ${r.count} |\n`;

  // Score de contrôle
  const multiCss = css.filter(r => r.owners.length > 1).length;
  const totalViol = bp.perFile.reduce((s, r) => s + r.violations.length, 0);
  md += `\n---\n\n## 5. Score de contrôle\n\n`;
  md += `| Indicateur | Valeur | Cible |\n|------------|:------:|:-----:|\n`;
  md += `| Composants en multipropriété CSS | ${multiCss} | 0 |\n`;
  md += `| Modules JS écrivant le DOM | ${dom.filter(r => r.dom > 0).length} | ≤ 5 |\n`;
  md += `| Breakpoints distincts | ${bp.allBp.length} | ≤ 2 |\n`;
  md += `| Violations breakpoint | ${totalViol} | 0 |\n`;
  md += `| \`!important\` | ${d.importantTotal} | < 5 |\n`;
  md += `\n*Quand toutes les cibles sont vertes, la boutique est sous contrôle : chaque composant a un owner unique et un seul système de breakpoints.*\n`;

  return md;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
try {
  const md = render();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, md, 'utf8');
  console.log('✅ Carte de propriété générée →', path.relative(ROOT, OUT));
} catch (err) {
  console.error('❌ Génération échouée :', err.message);
  process.exit(1);
}
