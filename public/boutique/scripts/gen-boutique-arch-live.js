#!/usr/bin/env node
/**
 * gen-boutique-arch-live.js — photographie exécutable de l'architecture Boutique.
 *
 * Source de vérité bundle : scripts/css-bundles.js.
 * Le wrapper historique bundle-css.js ne contient plus de configuration et ne doit
 * jamais être parsé pour reconstruire l'ownership des sources CSS.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { BUNDLES } = require('./css-bundles.js');

const ROOT = path.resolve(__dirname, '..');
const CSS_DIR = path.join(ROOT, 'css');
const JS_DIR = path.join(ROOT, 'js');
const INDEX = path.join(ROOT, 'index.html');
const OUT = path.join(ROOT, 'docs', 'BOUTIQUE_ARCHITECTURE_LIVE.md');

const TRACKED_SELECTORS = [
  '.k-chip', '.k-cats-shell', '.k-hero-cats-sticky',
  '#k-subcats-wrap', '.k-subchip',
  '.k-grid', '.k-card', '.k-card-add', '.k-card-fav',
  '.k-side-cart', '#k-desktop-catalog-wrap',
  '.k-header', '.k-hero-media', '.k-modal',
];

const JS_OWNED_VARS = ['--pager-top', '--pager-h', '--pager-w', '--bnav-h', '--modal-scroll-y'];

function listCss() {
  return fs.readdirSync(CSS_DIR)
    .filter(file => file.endsWith('.css'))
    .map(file => file.replace(/\.css$/, ''))
    .sort();
}

function readCss(name) {
  return fs.readFileSync(path.join(CSS_DIR, `${name}.css`), 'utf8');
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function bundleIndex() {
  if (!Array.isArray(BUNDLES) || BUNDLES.length === 0) {
    throw new Error('css-bundles.js ne fournit aucun bundle canonique');
  }

  const sourceToBundles = new Map();
  const bundleConfig = {};

  for (const bundle of BUNDLES) {
    if (!bundle || typeof bundle.out !== 'string' || !Array.isArray(bundle.files)) {
      throw new Error('Entrée BUNDLES invalide dans css-bundles.js');
    }
    bundleConfig[bundle.out] = [...bundle.files];
    for (const source of bundle.files) {
      if (!sourceToBundles.has(source)) sourceToBundles.set(source, []);
      sourceToBundles.get(source).push(bundle.out);
    }
  }

  return { sourceToBundles, bundleConfig };
}

function inventoryCss() {
  const onDisk = listCss();
  const onDiskSet = new Set(onDisk);
  const { sourceToBundles, bundleConfig } = bundleIndex();

  const rows = onDisk.map(source => {
    const bundles = sourceToBundles.get(source) || [];
    return {
      file: `${source}.css`,
      lines: readCss(source).split('\n').length,
      bundles,
      bundle: bundles.join(', ') || '— ORPHELIN —',
      orphan: bundles.length === 0,
    };
  });

  const missingSources = [...sourceToBundles.keys()]
    .filter(source => !onDiskSet.has(source))
    .map(source => `${source}.css`)
    .sort();

  return { rows, bundleConfig, missingSources };
}

function isInsideDesktopMQ(css, pos) {
  const stack = [];
  let i = 0;
  while (i < pos) {
    if (css[i] === '@') {
      const slice = css.slice(i, i + 100);
      const mq = slice.match(/^@media[^{]+\{/);
      if (mq) {
        const width = mq[0].match(/min-width\s*:\s*(\d+)/);
        stack.push(Boolean(width && Number.parseInt(width[1], 10) >= 900));
        i += mq[0].length;
        continue;
      }
    }
    if (css[i] === '{') stack.push(false);
    else if (css[i] === '}') stack.pop();
    i += 1;
  }
  return stack.some(Boolean);
}

function selectorOccurrences(css, selector) {
  const cleaned = stripComments(css);
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[,}\\s])${escaped}(?![a-zA-Z0-9_-])[^{};]*\\{`, 'gm');
  const positions = [];
  let match;
  while ((match = re.exec(cleaned)) !== null) positions.push(match.index);
  return positions.map(pos => ({ desktop: isInsideDesktopMQ(cleaned, pos) }));
}

function selectorMap() {
  const map = {};
  for (const selector of TRACKED_SELECTORS) {
    map[selector] = [];
    for (const source of listCss()) {
      const occurrences = selectorOccurrences(readCss(source), selector);
      if (occurrences.length === 0) continue;
      map[selector].push({
        file: `${source}.css`,
        base: occurrences.filter(item => !item.desktop).length,
        desktop: occurrences.filter(item => item.desktop).length,
      });
    }
  }
  return map;
}

function loadOrder() {
  const html = fs.readFileSync(INDEX, 'utf8');
  const re = /<link[^>]+href=["']([^"']+\.css[^"']*)["']/g;
  const links = [];
  let match;
  while ((match = re.exec(html)) !== null) links.push(match[1]);
  return links;
}

function findBrokenTokens() {
  const out = [];
  const re = /var\(--[a-z-]+\)[0-9a-fA-F]{2,}/g;
  for (const source of listCss()) {
    const css = readCss(source).replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '));
    css.split('\n').forEach((line, index) => {
      const matches = line.match(re) || [];
      for (const broken of matches) out.push({ file: `${source}.css`, line: index + 1, broken });
    });
  }
  return out;
}

function hexSummary() {
  const out = [];
  for (const source of listCss()) {
    if (source === 'tokens') continue;
    const matches = stripComments(readCss(source)).match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    if (matches.length > 0) out.push({ file: `${source}.css`, count: matches.length });
  }
  return out.sort((a, b) => b.count - a.count);
}

function importantSummary() {
  const out = [];
  for (const source of listCss()) {
    const count = (stripComments(readCss(source)).match(/!important/g) || []).length;
    if (count > 0) out.push({ file: `${source}.css`, count });
  }
  return out.sort((a, b) => b.count - a.count);
}

function jsVarOwners() {
  const out = {};
  if (!fs.existsSync(JS_DIR)) return out;

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.js')) continue;
      const src = fs.readFileSync(full, 'utf8');
      for (const variable of JS_OWNED_VARS) {
        const re = new RegExp(`setProperty\\s*\\(\\s*['"]${variable}['"]`, 'g');
        const matches = src.match(re);
        if (!matches) continue;
        (out[variable] = out[variable] || []).push({
          file: path.relative(ROOT, full).split(path.sep).join('/'),
          count: matches.length,
        });
      }
    }
  }

  walk(JS_DIR);
  return out;
}

function buildSnapshot() {
  return {
    inventory: inventoryCss(),
    selectors: selectorMap(),
    loadOrder: loadOrder(),
    brokenTokens: findBrokenTokens(),
    hex: hexSummary(),
    important: importantSummary(),
    jsOwnedVars: jsVarOwners(),
  };
}

function render(snapshot = buildSnapshot()) {
  const inv = snapshot.inventory;
  const map = snapshot.selectors;
  const broken = snapshot.brokenTokens;
  const hex = snapshot.hex;
  const imp = snapshot.important;
  const jsv = snapshot.jsOwnedVars;
  const orphanCount = inv.rows.filter(row => row.orphan).length;
  const hexCount = hex.reduce((sum, item) => sum + item.count, 0);
  const importantCount = imp.reduce((sum, item) => sum + item.count, 0);
  const multiOwnerCount = Object.values(map).filter(rows => rows.length > 1).length;

  let md = '# Komerce Boutique — Architecture LIVE\n\n';
  md += '> **Document généré automatiquement.** Ne pas éditer à la main.\n';
  md += '> Régénération : `npm run boutique:arch`.\n>\n';
  md += '> Source canonique des bundles : `scripts/css-bundles.js`.\n';
  md += '> Le pendant normatif est `BOUTIQUE_ARCHITECTURE.md`.\n\n---\n\n';

  md += '## 1. Inventaire CSS\n\n';
  md += `${inv.rows.length} fichier(s) source sur disque, ${orphanCount} orphelin(s), ${inv.missingSources.length} source(s) bundle manquante(s).\n\n`;
  md += '| Fichier | Lignes | Bundle(s) |\n|---|---:|---|\n';
  for (const row of inv.rows) {
    md += `| \`${row.file}\` | ${row.lines} | ${row.orphan ? '🔴 **ORPHELIN**' : row.bundle} |\n`;
  }
  if (inv.missingSources.length > 0) {
    md += `\nSources déclarées mais absentes : ${inv.missingSources.map(file => `\`${file}\``).join(', ')}.\n`;
  }

  md += '\n## 2. Ordre de chargement CSS (index.html)\n\n';
  md += 'Cascade réelle des bundles livrés :\n\n```\n';
  snapshot.loadOrder.forEach((link, index) => { md += `${String(index + 1).padStart(2)}. ${link}\n`; });
  md += '```\n\n';

  md += '## 3. Cartographie des sélecteurs critiques\n\n';
  md += '| Sélecteur | Owners trouvés (base / desktop) |\n|---|---|\n';
  for (const selector of TRACKED_SELECTORS) {
    const rows = map[selector];
    if (rows.length === 0) {
      md += `| \`${selector}\` | _(non trouvé)_ |\n`;
      continue;
    }
    const cells = rows.map(row => `\`${row.file}\` (${row.base}/${row.desktop})`).join('<br>');
    md += `| \`${selector}\`${rows.length > 1 ? ' ⚠️' : ''} | ${cells} |\n`;
  }
  md += '\n> ⚠️ = plusieurs fichiers touchent le sélecteur ; confronter au contrat d’ownership avant modification.\n\n';

  md += '## 4. Tokens cassés (`var(--x)nnn`)\n\n';
  md += broken.length === 0 ? 'Aucun. ✅\n\n' : `${broken.length} occurrence(s). ❌\n\n`;

  md += '## 5. Hex hardcodés hors tokens.css\n\n';
  if (hex.length === 0) md += 'Aucun. ✅\n\n';
  else {
    md += `${hexCount} occurrence(s) au total.\n\n| Fichier | Nombre |\n|---|---:|\n`;
    for (const item of hex) md += `| \`${item.file}\` | ${item.count} |\n`;
    md += '\n';
  }

  md += '## 6. `!important` par fichier\n\n';
  if (imp.length === 0) md += 'Aucun. ✅\n\n';
  else {
    md += `${importantCount} déclaration(s) au total.\n\n| Fichier | Nombre |\n|---|---:|\n`;
    for (const item of imp) md += `| \`${item.file}\` | ${item.count} |\n`;
    md += '\n';
  }

  md += '## 7. Variables CSS posées par JS\n\n';
  md += '| Variable | Owner(s) JS trouvé(s) |\n|---|---|\n';
  for (const variable of JS_OWNED_VARS) {
    const owners = jsv[variable] || [];
    if (owners.length === 0) {
      md += `| \`${variable}\` | _(non posée — à vérifier)_ |\n`;
      continue;
    }
    const cells = owners.map(owner => `\`${owner.file}\` (×${owner.count})`).join('<br>');
    md += `| \`${variable}\` | ${cells}${owners.length > 1 ? ' ⚠️ multi-owner' : ''} |\n`;
  }

  md += '\n## 8. Score architecture\n\n';
  md += `- **CSS orphelins** : ${orphanCount} (cible : 0)\n`;
  md += `- **Sources bundle manquantes** : ${inv.missingSources.length} (cible : 0)\n`;
  md += `- **Tokens cassés** : ${broken.length} (cible : 0)\n`;
  md += `- **Hex hardcodés** : ${hexCount} (cible : 0 ou exceptions documentées)\n`;
  md += `- **\`!important\`** : ${importantCount} (cible : 0 ou exceptions indispensables)\n`;
  md += `- **Sélecteurs multi-owner observés** : ${multiOwnerCount} (à classifier par ownership)\n`;
  md += '\n---\n\n*Généré par `scripts/gen-boutique-arch-live.js` depuis les sources réelles.*\n';

  return md;
}

function writeLiveDoc() {
  const outDir = path.dirname(OUT);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUT, render(), 'utf8');
  console.log(`  ✓  ${path.relative(ROOT, OUT)} généré (${(fs.statSync(OUT).size / 1024).toFixed(1)} KB)`);
}

if (require.main === module) writeLiveDoc();

module.exports = {
  ROOT,
  TRACKED_SELECTORS,
  JS_OWNED_VARS,
  bundleIndex,
  inventoryCss,
  selectorMap,
  loadOrder,
  findBrokenTokens,
  hexSummary,
  importantSummary,
  jsVarOwners,
  buildSnapshot,
  render,
  writeLiveDoc,
};
