#!/usr/bin/env node
/**
 * gen-arch-live.js — Génère docs/ARCHITECTURE_LIVE.md
 *
 * Photographie l'état RÉEL du code à un instant T.
 * Jamais édité à la main. Régénéré par : npm run docs:arch
 *
 * Diffère de docs/ARCHITECTURE.md (normatif, édité à la main).
 */

const fs   = require('fs');
const path = require('path');

const ROOT     = path.resolve(__dirname, '..');
const CSS_DIR  = path.join(ROOT, 'css');
const JS_DIR   = path.join(ROOT, 'js');
const INDEX    = path.join(ROOT, 'index.html');
const BUNDLER  = path.join(__dirname, 'bundle-css.js');
const OUT      = path.join(ROOT, 'docs', 'BOUTIQUE_ARCHITECTURE_LIVE.md');

// Sélecteurs surveillés (miroir de docs/ARCHITECTURE.md §3)
const TRACKED_SELECTORS = [
  '.k-chip', '.k-cats-shell', '.k-hero-cats-sticky',
  '#k-subcats-wrap', '.k-subchip',
  '.k-grid', '.k-card', '.k-card-add', '.k-card-fav',
  '.k-side-cart', '#k-desktop-catalog-wrap',
  '.k-header', '.k-hero-media', '.k-modal',
];

const JS_OWNED_VARS = ['--pager-top', '--pager-h', '--pager-w', '--bnav-h', '--modal-scroll-y'];

// ════════════════════════════════════════════════════════════════
function listCss() {
  return fs.readdirSync(CSS_DIR).filter(f => f.endsWith('.css')).map(f => f.replace(/\.css$/, ''));
}
function readCss(name) { return fs.readFileSync(path.join(CSS_DIR, `${name}.css`), 'utf8'); }
function stripComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ''); }

function selectorOccurrences(css, selector) {
  const cleaned = stripComments(css);
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[,}\\s])${esc}(?![a-zA-Z0-9_-])[^{};]*\\{`, 'gm');
  const positions = [];
  let m;
  while ((m = re.exec(cleaned)) !== null) positions.push(m.index);
  // Pour chaque pos, déterminer si dans @media desktop
  return positions.map(pos => ({
    desktop: isInsideDesktopMQ(cleaned, pos),
  }));
}

function isInsideDesktopMQ(css, pos) {
  let stack = [];
  let i = 0;
  while (i < pos) {
    if (css[i] === '@') {
      const slice = css.slice(i, i + 80);
      const mq = slice.match(/^@media[^{]+\{/);
      if (mq) {
        const desktop = /min-width\s*:\s*(\d+)/.test(mq[0]) &&
          parseInt(mq[0].match(/min-width\s*:\s*(\d+)/)[1], 10) >= 900;
        i += mq[0].length;
        stack.push(desktop);
        continue;
      }
    }
    if (css[i] === '{') stack.push(false);
    else if (css[i] === '}') stack.pop();
    i++;
  }
  return stack.some(x => x === true);
}

// ════════════════════════════════════════════════════════════════
// 1. Inventaire CSS — disque vs bundle
// ════════════════════════════════════════════════════════════════
function inventoryCss() {
  const onDisk = listCss();
  const bundlerSrc = fs.readFileSync(BUNDLER, 'utf8');
  const bundleConfig = {};
  // Parse simple : "out: 'X', ... files: [...]"
  const re = /out:\s*'([^']+)'[^}]+files:\s*\[([^\]]+)\]/g;
  let m;
  while ((m = re.exec(bundlerSrc)) !== null) {
    const files = m[2].match(/'([^']+)'/g).map(s => s.slice(1, -1));
    bundleConfig[m[1]] = files;
  }
  const inBundle = {};
  for (const [bundle, files] of Object.entries(bundleConfig)) {
    // FIX BUG-C1 : first-write-wins — évite que tokens.css (présent dans base
    // ET event) soit rapporté comme appartenant au dernier bundle itéré.
    files.forEach(f => { if (!inBundle[f]) inBundle[f] = bundle; });
  }

  const rows = onDisk.map(f => {
    const lines = readCss(f).split('\n').length;
    return {
      file: `${f}.css`,
      lines,
      bundle: inBundle[f] || '— ORPHELIN —',
      orphan: !inBundle[f],
    };
  });
  return { rows, bundleConfig };
}

// ════════════════════════════════════════════════════════════════
// 2. Pour chaque sélecteur tracké : où est-il défini ?
// ════════════════════════════════════════════════════════════════
function selectorMap() {
  const onDisk = listCss();
  const map = {};
  for (const sel of TRACKED_SELECTORS) {
    map[sel] = [];
    for (const file of onDisk) {
      const css = readCss(file);
      const occs = selectorOccurrences(css, sel);
      if (occs.length === 0) continue;
      const baseCount = occs.filter(o => !o.desktop).length;
      const dtCount   = occs.filter(o => o.desktop).length;
      map[sel].push({ file: `${file}.css`, base: baseCount, desktop: dtCount });
    }
  }
  return map;
}

// ════════════════════════════════════════════════════════════════
// 3. Cascade : ordre de chargement réel dans index.html
// ════════════════════════════════════════════════════════════════
function loadOrder() {
  const html = fs.readFileSync(INDEX, 'utf8');
  const re = /<link[^>]+href=["']([^"']+\.css[^"']*)["']/g;
  const links = [];
  let m;
  while ((m = re.exec(html)) !== null) links.push(m[1]);
  return links;
}

// ════════════════════════════════════════════════════════════════
// 4. Tokens cassés détectés
// ════════════════════════════════════════════════════════════════
function findBrokenTokens() {
  const onDisk = listCss();
  const re = /var\(--[a-z-]+\)[0-9a-fA-F]{2,}/g;
  const out = [];
  for (const file of onDisk) {
    const css = readCss(file);
    // Strip comments en préservant les numéros de ligne (espaces de même taille)
    const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
    const lines = cssNoComments.split('\n');
    lines.forEach((line, idx) => {
      const matches = line.match(re);
      if (matches) matches.forEach(b => out.push({ file: `${file}.css`, line: idx + 1, broken: b }));
    });
  }
  return out;
}

// ════════════════════════════════════════════════════════════════
// 5. Hex hardcodés (résumé par fichier)
// ════════════════════════════════════════════════════════════════
function hexSummary() {
  const onDisk = listCss();
  const out = [];
  for (const file of onDisk) {
    if (file === 'tokens') continue;
    const css = stripComments(readCss(file));
    const matches = css.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    if (matches.length > 0) out.push({ file: `${file}.css`, count: matches.length });
  }
  return out.sort((a, b) => b.count - a.count);
}

// ════════════════════════════════════════════════════════════════
// 6. !important par fichier
// ════════════════════════════════════════════════════════════════
function importantSummary() {
  const onDisk = listCss();
  const out = [];
  for (const file of onDisk) {
    const css = stripComments(readCss(file));
    const count = (css.match(/!important/g) || []).length;
    if (count > 0) out.push({ file: `${file}.css`, count });
  }
  return out.sort((a, b) => b.count - a.count);
}

// ════════════════════════════════════════════════════════════════
// 7. JS — qui pose les variables JS-owned ?
// ════════════════════════════════════════════════════════════════
function jsVarOwners() {
  const out = {};
  if (!fs.existsSync(JS_DIR)) {
    console.warn(`  ⚠  Dossier js/ introuvable (${JS_DIR}) — section variables JS-owned ignorée.`);
    return out;
  }
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!entry.name.endsWith('.js')) continue;
      const src = fs.readFileSync(p, 'utf8');
      for (const v of JS_OWNED_VARS) {
        const re = new RegExp(`setProperty\\s*\\(\\s*['"]${v}['"]`, 'g');
        const matches = src.match(re);
        if (matches) {
          const rel = path.relative(ROOT, p);
          (out[v] = out[v] || []).push({ file: rel, count: matches.length });
        }
      }
    }
  }
  walk(JS_DIR);
  return out;
}

// ════════════════════════════════════════════════════════════════
// RENDU MARKDOWN
// ════════════════════════════════════════════════════════════════
function render() {
  const stamp = new Date().toISOString();
  const inv   = inventoryCss();
  const map   = selectorMap();
  const links = loadOrder();
  const broken = findBrokenTokens();
  const hex   = hexSummary();
  const imp   = importantSummary();
  const jsv   = jsVarOwners();

  let md = '';
  md += `# Komerce Boutique — Architecture LIVE\n\n`;
  md += `> **Document généré automatiquement.** Ne pas éditer à la main.\n`;
  md += `> Régénération : \`npm run boutique:arch\`. Date : ${stamp}\n>\n`;
  md += `> Le pendant normatif est \`BOUTIQUE_ARCHITECTURE.md\` — édité à la main.\n`;
  md += `> Comparer les deux montre l'écart entre l'état souhaité et l'état réel.\n\n`;
  md += `---\n\n`;

  // ── 1. CSS sur disque
  md += `## 1. Inventaire CSS\n\n`;
  md += `${inv.rows.length} fichier(s) sur disque, ${inv.rows.filter(r => r.orphan).length} orphelin(s).\n\n`;
  md += `| Fichier | Lignes | Bundle |\n|---|---:|---|\n`;
  for (const r of inv.rows.sort((a, b) => a.file.localeCompare(b.file))) {
    md += `| \`${r.file}\` | ${r.lines} | ${r.orphan ? '🔴 **ORPHELIN**' : r.bundle} |\n`;
  }
  md += `\n`;

  // ── 2. Ordre de chargement réel
  md += `## 2. Ordre de chargement CSS (index.html)\n\n`;
  md += `Cascade : un fichier plus bas écrase ses prédécesseurs sur les sélecteurs communs.\n\n`;
  md += '```\n';
  links.forEach((l, i) => { md += `${(i + 1).toString().padStart(2)}. ${l}\n`; });
  md += '```\n\n';

  // ── 3. Cartographie des sélecteurs trackés
  md += `## 3. Cartographie des sélecteurs critiques\n\n`;
  md += `Pour chaque sélecteur tracké : où il est défini (base = hors @media, desktop = @media ≥900px).\n\n`;
  md += `| Sélecteur | Owners trouvés (base / desktop) |\n|---|---|\n`;
  for (const sel of TRACKED_SELECTORS) {
    const rows = map[sel];
    if (rows.length === 0) { md += `| \`${sel}\` | _(non trouvé)_ |\n`; continue; }
    const cells = rows.map(r => `\`${r.file}\` (${r.base}/${r.desktop})`).join('<br>');
    const conflict = rows.length > 1 ? ' ⚠️' : '';
    md += `| \`${sel}\`${conflict} | ${cells} |\n`;
  }
  md += `\n`;
  md += `> ⚠️ = sélecteur défini dans plus d'un fichier. Vérifier que c'est conforme à \`BOUTIQUE_ARCHITECTURE.md\` §3.\n\n`;

  // ── 4. Tokens cassés
  md += `## 4. Tokens cassés (\`var(--x)nnn\`)\n\n`;
  if (broken.length === 0) md += `Aucun. ✅\n\n`;
  else {
    md += `${broken.length} occurrence(s) — violations I-4.\n\n`;
    md += `| Fichier | Ligne | Pattern |\n|---|---:|---|\n`;
    broken.forEach(b => { md += `| \`${b.file}\` | ${b.line} | \`${b.broken}\` |\n`; });
    md += `\n`;
  }

  // ── 5. Hex hardcodés par fichier
  md += `## 5. Hex hardcodés hors tokens.css\n\n`;
  if (hex.length === 0) md += `Aucun. ✅\n\n`;
  else {
    const total = hex.reduce((s, x) => s + x.count, 0);
    md += `${total} occurrence(s) au total, répartition :\n\n`;
    md += `| Fichier | Nombre |\n|---|---:|\n`;
    hex.forEach(h => { md += `| \`${h.file}\` | ${h.count} |\n`; });
    md += `\n`;
  }

  // ── 6. !important
  md += `## 6. \`!important\` par fichier\n\n`;
  if (imp.length === 0) md += `Aucun. ✅\n\n`;
  else {
    const total = imp.reduce((s, x) => s + x.count, 0);
    md += `${total} déclaration(s) au total.\n\n`;
    md += `| Fichier | Nombre |\n|---|---:|\n`;
    imp.forEach(i => { md += `| \`${i.file}\` | ${i.count} |\n`; });
    md += `\n`;
  }

  // ── 7. Variables JS-owned
  md += `## 7. Variables CSS posées par JS\n\n`;
  md += `| Variable | Owner(s) JS trouvé(s) |\n|---|---|\n`;
  for (const v of JS_OWNED_VARS) {
    const owners = jsv[v];
    if (!owners || owners.length === 0) {
      md += `| \`${v}\` | _(non posée — variable inutilisée ?)_ |\n`;
    } else {
      const cells = owners.map(o => `\`${o.file}\` (×${o.count})`).join('<br>');
      const warn = owners.length > 1 ? ' ⚠️ multi-owner' : '';
      md += `| \`${v}\` | ${cells}${warn} |\n`;
    }
  }
  md += `\n`;
  md += `> ⚠️ multi-owner = variable posée par plusieurs fichiers JS. Vérifier la cohérence.\n\n`;

  // ── 8. Résumé exécutif
  const violationsCount =
    inv.rows.filter(r => r.orphan).length +
    broken.length +
    (hex.reduce((s, x) => s + x.count, 0)) +
    [...Object.values(map)].filter(rows => rows.length > 1).length;

  md += `## 8. Score architecture\n\n`;
  md += `- **CSS orphelins** : ${inv.rows.filter(r => r.orphan).length} (cible : 0)\n`;
  md += `- **Tokens cassés** : ${broken.length} (cible : 0)\n`;
  md += `- **Hex hardcodés** : ${hex.reduce((s, x) => s + x.count, 0)} (cible : 0 ou allowlist)\n`;
  md += `- **\`!important\`** : ${imp.reduce((s, x) => s + x.count, 0)} (cible : <10, idéal 0)\n`;
  md += `- **Sélecteurs multi-owner** : ${Object.entries(map).filter(([, rows]) => rows.length > 1).length} (vérifier vs \`BOUTIQUE_ARCHITECTURE.md\` §3)\n\n`;
  md += `---\n\n*Généré par \`boutique/scripts/gen-boutique-arch-live.js\`.*\n`;

  return md;
}

// ════════════════════════════════════════════════════════════════
const outDir = path.dirname(OUT);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(OUT, render(), 'utf8');
console.log(`  ✓  ${path.relative(ROOT, OUT)} généré (${(fs.statSync(OUT).size / 1024).toFixed(1)} KB)`);
