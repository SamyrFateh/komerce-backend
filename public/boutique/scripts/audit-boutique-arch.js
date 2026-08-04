#!/usr/bin/env node
/**
 * audit-arch.js – Garde-fou architecture Komerce boutique
 *
 * Valide les invariants déclarés dans boutique/docs/BOUTIQUE_ARCHITECTURE.md.
 * Plante (exit 1) à la première violation, ou affiche un rapport et plante en fin.
 *
 * Usage : node boutique/scripts/audit-boutique-arch.js
 *         npm run audit:arch
 *
 * Sortie : exit 0 si tout passe, exit 1 sinon.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT     = path.resolve(__dirname, '..');
const CSS_DIR  = path.join(ROOT, 'css');
const JS_DIR   = path.join(ROOT, 'js');
const INDEX    = path.join(ROOT, 'index.html');
const BUNDLER  = path.join(__dirname, 'deploy-css.js');   // source de vérité CSS depuis migration bundle-css â†’ deploy-css

const violations = [];
function violate(rule, msg, detail) {
  violations.push({ rule, msg, detail });
}

// ════════════════════════════════════════════════════════════════
// CONFIG – source unique : doit refléter boutique/docs/BOUTIQUE_ARCHITECTURE.md §3
// ════════════════════════════════════════════════════════════════

// I-2 : Ownership CSS. Format : selector â†’ { owner, scope, allowedAlso? }
// `scope` : 'mobile' | 'desktop' | 'all'
// `allowedAlso` : fichiers où le sélecteur peut apparaître pour mention/commentaire
//                 (regex faible) sans être "défini" – utile pour les overrides légitimes
//                 dans le fichier owner du scope opposé.
const OWNERSHIP = [
  // â”€â”€ .k-chip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Base skin : categories.css. Overrides desktop : boutique-desktop.css.
  // Animations d'état (.transitioning) : interactions.css – owner légitme des transitions inter-composants.
  { selector: '.k-chip',           owner: 'categories.css',       scope: 'base' },
  { selector: '.k-chip',           owner: 'boutique-desktop.css', scope: 'desktop-override' },
  { selector: '.k-chip',           owner: 'interactions.css',     scope: 'all' }, // animations .transitioning uniquement

  // â”€â”€ .k-cats-shell â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Base : categories.css. Desktop : boutique-desktop.css.
  // hero.css : adaptation contextuelle quand cats-shell est enfant du hero (mobile).
  // skeleton : max-width â‰¥1500px – contrainte largeur globale, rôle du skeleton (§7 ARCHITECTURE.md).
  { selector: '.k-cats-shell',     owner: 'categories.css',                    scope: 'base' },
  { selector: '.k-cats-shell',     owner: 'boutique-desktop.css',              scope: 'desktop-override' },
  { selector: '.k-cats-shell',     owner: 'hero.css',                          scope: 'base' },      // contexte hero mobile

  // â”€â”€ .k-hero-cats-sticky â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  { selector: '.k-hero-cats-sticky', owner: 'hero.css',           scope: 'base' },
  { selector: '.k-hero-cats-sticky', owner: 'boutique-desktop.css', scope: 'desktop-override' },
  { selector: '.k-hero-cats-sticky', owner: 'categories.css',     scope: 'desktop-override' }, // PALETTE-FIX-01 Sprint 4 S4.2

  // â”€â”€ sous-cats (Lot I-2-A) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Migré depuis categories.css â†’ boutique-desktop.css (base + desktop).
  // categories.css conserve les overrides couleur par thème catégorie (Sprint 4 S4.2).
  { selector: '#k-subcats-wrap',   owner: 'boutique-desktop.css', scope: 'all' },
  { selector: '#k-subcats-wrap',   owner: 'categories.css',       scope: 'all' }, // color-theming subchip actif
  { selector: '.k-subchip',        owner: 'boutique-desktop.css', scope: 'all' },
  { selector: '.k-subchip',        owner: 'categories.css',       scope: 'all' }, // color-theming subchip actif

  // â”€â”€ .k-grid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // products.css : owner du layout de grille.
  // interactions.css : animations slide (k-grid-slide-in/out) – rôle explicite du fichier.
  // layout.css : overflow-x:clip fix sticky side-cart – structural global, commenté PATCH#227.
  // cart.css : adaptation flat-subcat dans contexte panier uniquement.
  { selector: '.k-grid',           owner: 'products.css',         scope: 'all' },
  { selector: '.k-grid',           owner: 'interactions.css',     scope: 'all' },   // animations slide uniquement
  { selector: '.k-grid',           owner: 'layout.css',           scope: 'desktop' }, // overflow fix PATCH#227
  { selector: '.k-grid',           owner: 'cart.css',             scope: 'all' },   // contexte flat-subcat panier

  // â”€â”€ .k-sec-grid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // products.css : owner layout. categories.css : padding contextuel sections catégorie.
  { selector: '.k-sec-grid',       owner: 'products.css',         scope: 'all' },
  { selector: '.k-sec-grid',       owner: 'categories.css',       scope: 'all' },   // padding contexte section-cat

  // â”€â”€ .k-card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // products.css : base. boutique-desktop.css : hover overlay.
  // skeleton : skin desktop (border-radius, shadow) – cascade §7 skeleton gagne.
  // categories.css : animation k-card-enter dans .k-grid-entering (transition inter-catégorie).
  { selector: '.k-card',           owner: 'products.css',         scope: 'base' },
  { selector: '.k-card',           owner: 'boutique-desktop.css', scope: 'desktop-override' },
  { selector: '.k-card',           owner: 'categories.css',       scope: 'all' }, // animation k-card-enter (.k-grid-entering .k-card)

  // â”€â”€ .k-card-add / .k-card-fav â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // products.css : base + états (boutons sur la card).
  // cart.css : sizing desktop dans contexte panier ouvert.
  // boutique-desktop.css : opacité hover desktop (.k-card-fav uniquement).
  { selector: '.k-card-add',       owner: 'products.css',         scope: 'all' },
  { selector: '.k-card-add',       owner: 'cart.css',             scope: 'desktop' }, // sizing contexte panier
  { selector: '.k-card-add',       owner: 'boutique-desktop.css', scope: 'desktop' }, // hover desktop (.k-card:hover .k-card-add)
  { selector: '.k-card-fav',       owner: 'products.css',         scope: 'all' },
  { selector: '.k-card-fav',       owner: 'cart.css',             scope: 'desktop' }, // sizing contexte panier
  { selector: '.k-card-fav',       owner: 'boutique-desktop.css', scope: 'desktop' }, // opacité hover desktop

  // â”€â”€ .k-side-cart â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  { selector: '.k-side-cart',      owner: 'layout.css',           scope: 'mobile-only' },
  { selector: '.k-side-cart',      owner: 'boutique-desktop.css', scope: 'desktop' },

  // â”€â”€ #k-desktop-catalog-wrap â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // skeleton : grid layout desktop (owner principal).
  // layout.css : overflow/sticky fixes – structural, ne peut pas vivre dans skeleton (PATCH#227).
  { selector: '#k-desktop-catalog-wrap', owner: 'layout.css',     scope: 'all' }, // overflow sticky fixes
];

// I-3 : Allowlist hex hors tokens.css. Justifier chaque exception.
const HEX_ALLOWLIST = [
  // Format : { file, hex, reason }\
  // Fallbacks CSS dans var(--token, #hex) – l'auditeur ne distingue pas le contexte
  { file: 'interactions.css', hex: '#fff',    reason: 'Fallback CSS dans var(--white, #fff) pour les navigateurs sans token – greeting chip §BUG-L3' },
  { file: 'interactions.css', hex: '#1a1a1a', reason: 'Fallback CSS dans var(--text, #1a1a1a) pour les navigateurs sans token – greeting chip §BUG-L3' },
  // Fallbacks var(--green-bg-leaf, #e8f3ec) / var(--ocean-dark, #4A9040) / var(--ocean, #64AF5A)
  // Les tokens existent dans tokens.css ; ces hex sont des filets de sécurité navigateurs anciens.
  { file: 'cart.css',         hex: '#e8f3ec', reason: 'Fallback var(--green-bg-leaf) – filet navigateurs anciens' },
  { file: 'interactions.css', hex: '#e8f3ec', reason: 'Fallback var(--green-bg-leaf) – filet navigateurs anciens' },
  { file: 'interactions.css', hex: '#4A9040', reason: 'Fallback var(--ocean-dark) – filet navigateurs anciens' },
  { file: 'interactions.css', hex: '#64AF5A', reason: 'Fallback var(--ocean) – filet navigateurs anciens' },
  // paypal.css — couleurs imposées par la charte de marque PayPal, non tokenisables.
  { file: 'paypal.css', hex: '#fafbfc',  reason: 'Brand PayPal – non tokenisable' },
  { file: 'paypal.css', hex: '#e3e8ee',  reason: 'Brand PayPal – non tokenisable' },
  { file: 'paypal.css', hex: '#111',     reason: 'Brand PayPal – non tokenisable' },
  { file: 'paypal.css', hex: '#0070ba',  reason: 'Brand PayPal blue – non tokenisable' },
  { file: 'paypal.css', hex: '#f0f7ff',  reason: 'Brand PayPal – non tokenisable' },
  { file: 'paypal.css', hex: '#f0f3f7',  reason: 'Brand PayPal – non tokenisable' },
  { file: 'paypal.css', hex: '#6b7785',  reason: 'Brand PayPal grey – non tokenisable' },
  { file: 'paypal.css', hex: '#c33',     reason: 'Brand PayPal error – non tokenisable' },
  { file: 'paypal.css', hex: '#fdecea',  reason: 'Brand PayPal error bg – non tokenisable' },

  // layout.css — fallback de var(--green-dark-text, #1d5b2a) ; le token existe (même valeur).
  { file: 'layout.css', hex: '#1d5b2a', reason: 'Fallback var(--green-dark-text) – filet navigateurs anciens' },

  // modal-product.css — fallback de var(--text-muted, #6B7B63) sur .k-modal-sku ;
  // le token existe dans tokens.css (même valeur), même doctrine que les fallbacks ci-dessus.
  { file: 'modal-product.css', hex: '#6B7B63', reason: 'Fallback var(--text-muted) – filet navigateurs anciens' },
];

// Bundles attendus — source unique de vérité : scripts/css-bundles.js
const { BUNDLES: _rawBundles } = require('./css-bundles.js');
const EXPECTED_BUNDLES = Object.fromEntries(_rawBundles.map(b => [b.out, b.files]));

// I-6 : Variables CSS posées par JS uniquement
const JS_OWNED_VARS = ['--pager-top', '--pager-h', '--pager-w', '--bnav-h', '--modal-scroll-y'];

// ════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════

function listCssFiles() {
  return fs.readdirSync(CSS_DIR)
    .filter(f => f.endsWith('.css'))
    .map(f => f.replace(/\.css$/, ''));
}

function readCss(name) {
  return fs.readFileSync(path.join(CSS_DIR, `${name}.css`), 'utf8');
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// "Définit" un sélecteur = apparaît au début d'une règle, suivi d'une accolade ouvrante
// (ou virgule + autre sélecteur + accolade).
function selectorIsDefinedIn(css, selector) {
  const cleaned = stripComments(css);
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match : début de ligne ou virgule, puis le sélecteur, puis (espace + autres selectors)*, puis {
  const re = new RegExp(`(^|[,}\\s])${esc}(?![a-zA-Z0-9_-])[^{};]*\\{`, 'm');
  return re.test(cleaned);
}

// Détecte si une définition est sous @media (min-width: 900px) – pour distinguer base / desktop-override
function selectorScopeIn(css, selector) {
  const cleaned = stripComments(css);
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // On scanne : pour chaque occurrence, on regarde si elle est dans un @media min-width >= 900
  const re = new RegExp(`(^|[,}\\s])${esc}(?![a-zA-Z0-9_-])[^{};]*\\{`, 'gm');
  let m;
  let hasBase = false, hasDesktop = false;
  while ((m = re.exec(cleaned)) !== null) {
    const before = cleaned.slice(0, m.index);
    // Trouver le @media le plus récent ouvert (non encore fermé) à cette position
    const inDesktopMQ = isInsideDesktopMediaQuery(cleaned, m.index);
    if (inDesktopMQ) hasDesktop = true; else hasBase = true;
  }
  return { hasBase, hasDesktop };
}

// Retourne true si la position pos est à l'intérieur d'un @media (min-width: >=900px) ouvert
function isInsideDesktopMediaQuery(css, pos) {
  // Simple parser à compteur d'accolades
  let depth = 0;
  let mediaStack = []; // pile : true = MQ desktop, false = autre bloc
  let i = 0;
  while (i < pos) {
    if (css[i] === '@') {
      // Tester si c'est @media
      const slice = css.slice(i, i + 80);
      const mq = slice.match(/^@media[^{]+\{/);
      if (mq) {
        const isDesktop = /min-width\s*:\s*(\d+)/.test(mq[0]) &&
          parseInt(mq[0].match(/min-width\s*:\s*(\d+)/)[1], 10) >= 900;
        // Avancer jusqu'à l'accolade ouvrante
        i += mq[0].length;
        depth++;
        mediaStack.push(isDesktop);
        continue;
      }
    }
    if (css[i] === '{') {
      depth++;
      mediaStack.push(false); // bloc normal
    } else if (css[i] === '}') {
      depth--;
      mediaStack.pop();
    }
    i++;
  }
  return mediaStack.some(x => x === true);
}

// ════════════════════════════════════════════════════════════════
// CHECK I-1 : Aucun CSS orphelin (sur disque mais pas bundlé)
// ════════════════════════════════════════════════════════════════
function checkI1_orphans() {
  const onDisk = new Set(listCssFiles());
  const bundled = new Set(Object.values(EXPECTED_BUNDLES).flat());
  const orphans = [...onDisk].filter(f => !bundled.has(f));
  if (orphans.length === 0) return;
  orphans.forEach(f => {
    violate('I-1', `CSS orphelin sur disque mais pas dans le bundler`,
      `css/${f}.css – soit ajouter à scripts/bundle-css.js, soit supprimer du disque.`);
  });
}

// ════════════════════════════════════════════════════════════════
// CHECK I-2 : Ownership CSS – un sélecteur, un owner
// ════════════════════════════════════════════════════════════════
function checkI2_ownership() {
  const onDisk = listCssFiles();
  // Grouper OWNERSHIP par selector
  const bySelector = {};
  for (const rule of OWNERSHIP) {
    (bySelector[rule.selector] = bySelector[rule.selector] || []).push(rule);
  }

  for (const [selector, rules] of Object.entries(bySelector)) {
    const allowedOwners = new Set(rules.map(r => r.owner.replace(/\.css$/, '')));

    for (const file of onDisk) {
      if (file === 'tokens' || file === 'reset') continue; // pas de sélecteurs visuels
      // Bypass : on ne contrôle que les bundlés
      const isBundled = Object.values(EXPECTED_BUNDLES).flat().includes(file);
      if (!isBundled) continue;

      const css = readCss(file);
      if (!selectorIsDefinedIn(css, selector)) continue;

      const { hasBase, hasDesktop } = selectorScopeIn(css, selector);
      const isAllowedOwner = allowedOwners.has(file);

      if (!isAllowedOwner) {
        violate('I-2',
          `Sélecteur "${selector}" défini hors de son owner`,
          `Trouvé dans css/${file}.css (base=${hasBase}, desktop=${hasDesktop}). ` +
          `Owners autorisés : ${[...allowedOwners].map(o => `${o}.css`).join(', ')}.`);
        continue;
      }

      // Vérifier scope (base vs desktop) en fonction des règles déclarées pour ce fichier
      const ruleForFile = rules.find(r => r.owner.replace(/\.css$/, '') === file);
      if (!ruleForFile) continue;

      if (ruleForFile.scope === 'mobile-only' && hasDesktop) {
        violate('I-2',
          `Sélecteur "${selector}" dans ${file}.css scope=mobile-only mais a une déclaration desktop (@media â‰¥900px)`,
          `Déplacer la déclaration desktop vers ${rules.find(r => r.scope === 'desktop')?.owner || 'l\'owner desktop'}.`);
      }
      if (ruleForFile.scope === 'base' && hasDesktop && !rules.some(r => r.scope.includes('desktop'))) {
        violate('I-2',
          `Sélecteur "${selector}" dans ${file}.css scope=base mais a une déclaration desktop`,
          `Soit déclarer un owner desktop, soit déplacer.`);
      }
    }
  }
}

// ════════════════════════════════════════════════════════════════
// CHECK I-3 : Aucun hex hors tokens.css (sauf allowlist)
// ════════════════════════════════════════════════════════════════
function checkI3_hexHardcoded() {
  const onDisk = listCssFiles();
  const allowlist = new Set(HEX_ALLOWLIST.map(e => `${e.file}::${e.hex.toLowerCase()}`));

  for (const file of onDisk) {
    if (file === 'tokens') continue;
    const css = stripComments(readCss(file));

    // Identifier les zones :root { ... } à exclure (déclarations de tokens locaux,
    // ex. event.css garde un :root pour les --ev-* sur les pages /event/*)
    const rootRanges = [];
    const rootRe = /:root\s*\{/g;
    let rm;
    while ((rm = rootRe.exec(css)) !== null) {
      // Trouver l'accolade fermante correspondante
      let depth = 1;
      let i = rm.index + rm[0].length;
      while (i < css.length && depth > 0) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') depth--;
        i++;
      }
      rootRanges.push([rm.index, i]);
    }
    const isInRoot = (pos) => rootRanges.some(([a, b]) => pos >= a && pos < b);

    const lines = css.split('\n');
    let runningPos = 0;
    lines.forEach((line, idx) => {
      const lineStartPos = runningPos;
      runningPos += line.length + 1; // +1 pour le \n
      // Hex 6 ou 8 chiffres, ou 3 chiffres autonomes
      const matches = [...line.matchAll(/#[0-9a-fA-F]{3,8}\b/g)];
      matches.forEach(match => {
        const hex = match[0];
        const absPos = lineStartPos + match.index;
        if (isInRoot(absPos)) return; // ignoré : c'est une déclaration de token
        const key = `${file}.css::${hex.toLowerCase()}`;
        if (allowlist.has(key)) return;
        violate('I-3',
          `Hex hardcodé hors tokens.css`,
          `css/${file}.css:${idx + 1} â†’ ${hex}. Ajouter un token sémantique dans tokens.css ` +
          `ou justifier dans HEX_ALLOWLIST de boutique/scripts/audit-boutique-arch.js.`);
      });
    });
  }
}

// ════════════════════════════════════════════════════════════════
// CHECK I-4 : Pattern var(--token)xxx interdit
// ════════════════════════════════════════════════════════════════
function checkI4_brokenTokens() {
  const onDisk = listCssFiles();
  const re = /var\(--[a-z-]+\)[0-9a-fA-F]{2,}/g;

  for (const file of onDisk) {
    const css = readCss(file);
    // Important : strip comments AVANT de scanner, sinon les exemples
    // pédagogiques dans tokens.css déclenchent des faux positifs.
    // On garde le mapping ligne en remplaçant les commentaires par des espaces
    // de même longueur.
    const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
    const lines = cssNoComments.split('\n');
    lines.forEach((line, idx) => {
      const matches = line.match(re);
      if (!matches) return;
      matches.forEach(broken => {
        violate('I-4',
          `Token cassé (résidu de migration find-replace)`,
          `css/${file}.css:${idx + 1} â†’ "${broken}". ` +
          `Probable hex original : "#${broken.replace(/var\(--[a-z-]+\)/, 'fff')}" ou similaire. ` +
          `Restaurer l'hex puis créer un token sémantique.`);
      });
    });
  }
}

// ════════════════════════════════════════════════════════════════
// CHECK I-6 : Variables CSS owned par JS ne sont pas posées par CSS
// ════════════════════════════════════════════════════════════════
function checkI6_jsOwnedVars() {
  const onDisk = listCssFiles();
  for (const file of onDisk) {
    if (file === 'tokens') continue; // tokens.css peut déclarer des fallbacks
    const css = stripComments(readCss(file));
    for (const v of JS_OWNED_VARS) {
      // Regex : la variable apparaît comme propriété custom à gauche d'un ":"
      // (et pas dans un var() qui consomme la valeur)
      const re = new RegExp(`${v.replace(/--/g, '--')}\\s*:`, 'g');
      const matches = css.match(re);
      if (matches) {
        violate('I-6',
          `Variable JS-owned déclarée par CSS`,
          `css/${file}.css définit "${v}" – interdit. Cette variable est posée exclusivement par JS.`);
      }
    }
  }
}

// ════════════════════════════════════════════════════════════════
// CHECK BUNDLE : deploy-css.js et audit utilisent la même source (css-bundles.js)
// ════════════════════════════════════════════════════════════════
function checkBundleConfig() {
  const src = fs.readFileSync(BUNDLER, 'utf8');
  const configPath = path.join(__dirname, 'css-bundles.js');

  // Vérifier que deploy-css.js importe bien css-bundles.js
  if (!src.includes('css-bundles')) {
    violate('BUNDLE', `deploy-css.js n'importe pas css-bundles.js`,
      `La source unique de vérité des bundles doit être scripts/css-bundles.js.`);
    return;
  }

  // Vérifier que css-bundles.js existe et est lisible
  if (!fs.existsSync(configPath)) {
    violate('BUNDLE', `scripts/css-bundles.js introuvable`,
      `Ce fichier est la source unique de vérité pour les bundles CSS.`);
    return;
  }

  // Vérifier que chaque fichier CSS source référencé existe sur disque
  const onDisk = new Set(listCssFiles());
  for (const [bundleName, expectedFiles] of Object.entries(EXPECTED_BUNDLES)) {
    for (const f of expectedFiles) {
      if (!onDisk.has(f)) {
        violate('BUNDLE', `Fichier "${f}" référencé dans bundle "${bundleName}" mais absent de css/`,
          `Soit créer css/${f}.css, soit retirer de scripts/css-bundles.js.`);
      }
    }
  }
}

// ════════════════════════════════════════════════════════════════
// RUN
// ════════════════════════════════════════════════════════════════

console.log('\n  🔍  Audit architecture Komerce – invariants boutique/docs/BOUTIQUE_ARCHITECTURE.md\n');

checkI1_orphans();
checkI2_ownership();
checkI3_hexHardcoded();
checkI4_brokenTokens();
checkI6_jsOwnedVars();
checkBundleConfig();

// Rapport
if (violations.length === 0) {
  console.log('  ✅  Aucune violation. Architecture conforme.\n');
  process.exit(0);
}

// Grouper par règle
const byRule = {};
violations.forEach(v => {
  (byRule[v.rule] = byRule[v.rule] || []).push(v);
});

const RULE_LABELS = {
  'I-1':    'I-1  Aucun CSS orphelin',
  'I-2':    'I-2  Un sélecteur, un owner',
  'I-3':    'I-3  Aucun hex hors tokens.css',
  'I-4':    'I-4  Aucun token cassé "var(--x)nnn"',
  'I-6':    'I-6  Variables JS-owned non déclarées par CSS',
  'BUNDLE': 'BUNDLE  Cohérence css-bundles.js',
};

console.log(`  âŒ  ${violations.length} violation(s) trouvée(s)\n`);
for (const [rule, items] of Object.entries(byRule)) {
  console.log(`  â”€â”€ ${RULE_LABELS[rule] || rule} â”€â”€ (${items.length})`);
  // Limiter l'affichage pour I-3 qui peut être bruyant
  const display = (rule === 'I-3' && items.length > 15) ? items.slice(0, 15) : items;
  display.forEach(v => {
    console.log(`     â€¢ ${v.msg}`);
    if (v.detail) console.log(`       ${v.detail}`);
  });
  if (display.length < items.length) {
    console.log(`     â€¦ et ${items.length - display.length} autres (tronqué).`);
  }
  console.log('');
}

console.log('  â†’ corrige et relance `npm run audit:arch`.\n');
process.exit(1);
