#!/usr/bin/env node
/**
 * check-html-balance.js — Garde-fou HTML Komerce boutique
 * Version : 2.0 (2026-05-19)
 *
 * Détecte les déséquilibres de balises HTML avant qu'ils ne causent
 * des bugs de rendu, de z-index ou de structure DOM (P-1 documenté
 * dans docs/CARTOGRAPHY_360_BOUTIQUE.md §5).
 *
 * Ce que ce script vérifie :
 *   V-1  Équilibrage strict ouverture/fermeture de toutes les balises
 *   V-2  Balises void ne doivent pas avoir de tag fermant
 *   V-3  Imbrication interdite (a > a, button > button, form > form)
 *   V-4  IDs uniques (doublons = collision DOM)
 *   V-5  IDs critiques boutique présents dans index.html
 *        (tous ceux référencés dans b-store.js initDom + b-scroll-owner.js)
 *   V-6  (retiré) — les .k-product-card sont générées en JS, pas statiques
 *   V-7  Ordre des conteneurs overlay/drawer frères de body
 *
 * Corrections v2 vs v1 :
 *   - CRITICAL_IDS : aligné sur la liste réelle de b-store.js initDom
 *     (51 IDs au lieu de 11 ; source unique de vérité)
 *   - SIBLING_ORDER : corrigé k-product-modal → k-modal (ID réel dans index.html)
 *   - V-6 retirée (les cartes sont injectées par JS, aucune n'est statique)
 *   - Ajout de k-promo-rail dans OPTIONAL_IDS (référencé mais absent en prod)
 *
 * Usage :
 *   node scripts/check-html-balance.js [fichier.html ...]
 *   node scripts/check-html-balance.js          ← scanne tous les .html du projet
 *   npm run check:html
 *
 * Sortie : exit 0 si tout passe, exit 1 sinon.
 * Chaque erreur indique fichier + ligne + contexte.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ────────────────────────────────────────────────────────────────────
// CONFIG
// ────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '..');

/** Balises void HTML5 — ne doivent jamais avoir de tag fermant */
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** Imbrications invalides en HTML5 */
const FORBIDDEN_NESTING = [
  { parent: 'a',      child: 'a',      msg: '<a> ne peut pas imbriquer un autre <a>' },
  { parent: 'button', child: 'button', msg: '<button> ne peut pas imbriquer un autre <button>' },
  { parent: 'form',   child: 'form',   msg: '<form> ne peut pas imbriquer une autre <form>' },
  { parent: 'label',  child: 'label',  msg: '<label> ne peut pas imbriquer un autre <label>' },
  { parent: 'p',      child: 'div',    msg: '<p> ne peut pas contenir un élément de bloc <div>' },
];

/**
 * IDs critiques — DOIVENT être présents dans index.html.
 *
 * Source cannonique : b-store.js initDom() + b-scroll-owner.js.
 * Toute absence provoque dom.X = null et un crash runtime silencieux.
 *
 * PROCÉDURE DE MISE À JOUR :
 *   Quand tu ajoutes un ID dans b-store.js initDom() ou que tu retires
 *   un élément du HTML, mets à jour cette liste ET
 *   docs/CARTOGRAPHY_360_BOUTIQUE.md §5 dans la même PR.
 */
const CRITICAL_IDS = [
  // ── Structure principale ──────────────────────────────────────────
  'k-page-scroll',          // conteneur principal scrollable (mobile)
  'k-grid',                 // grille des produits

  // ── Modale produit (b-modal.js) ──────────────────────────────────
  'k-modal-overlay',        // overlay fond grisé
  'k-modal',                // conteneur fiche produit
  'k-modal-back',           // bouton retour
  'k-modal-back-label',     // libellé "Catalogue" / "Retour"
  'k-modal-close',          // bouton ✕
  'k-modal-cart-btn',       // bouton panier dans la modal
  'k-modal-cart-badge',     // badge quantité dans la modal
  'k-modal-img',            // image principale
  'k-modal-carousel',       // carousel wrapper
  'k-modal-carousel-track', // track du carousel
  'k-modal-dots',           // indicateurs carousel
  'k-modal-details',        // colonne détails
  'k-modal-promo-badge',    // badge promo
  'k-modal-name',           // nom produit
  'k-modal-desc',           // description
  'k-modal-price',          // prix actuel
  'k-modal-old-price',      // prix barré
  'k-modal-cat',            // catégorie
  'k-modal-stock',          // stock
  'k-modal-variants',       // variantes (couleur/taille)
  'k-qty-val',              // valeur quantité
  'k-qty-minus',            // bouton −
  'k-qty-plus',             // bouton +
  'k-add-cart-btn',         // bouton "Ajouter au panier"
  'k-sug-rail',             // rail de suggestions

  // ── Drawer panier (b-cart.js) ─────────────────────────────────────
  'k-cart-overlay',         // fond cliquable
  'k-cart-drawer',          // panneau latéral
  'k-cart-header',          // en-tête drawer
  'k-cart-header-title',    // titre "Mon Panier"
  'k-cart-close',           // bouton ✕
  'k-cart-body',            // liste des articles
  'k-cart-footer',          // total + CTA
  'k-cart-total-val',       // montant total
  'k-cart-total-conv',      // montant converti (XAF)
  'k-cart-continue',        // bouton "← Continuer"
  'k-cart-clear',           // bouton vider
  'k-cart-whatsapp',        // partage WhatsApp
  'k-cart-checkout',        // bouton "Commander"

  // ── Modal commande (b-checkout.js) ────────────────────────────────
  'k-order-modal',          // overlay commande
  'k-order-title',          // titre modale
  'k-order-body',           // formulaire
  'k-order-close',          // bouton ✕

  // ── Header / Nav ──────────────────────────────────────────────────
  'k-cart-btn',             // bouton panier (hero)
  'k-cart-badge',           // badge panier (hero)
  'k-search-input',         // input recherche
  'k-search-dropdown',      // dropdown recherche

  // ── Utilitaires ───────────────────────────────────────────────────
  'k-toast',                // conteneur toasts
  'k-bnav',                 // bottom nav mobile
];

/**
 * IDs référencés dans b-store.js mais ABSENTS de l'HTML en production.
 * Ils provoquent dom.X = null sans crasher — comportement optionnel documenté.
 * Listés ici pour éviter un faux positif V-5.
 *
 * k-promo-rail : rail promotionnel conditionnel (non affiché si aucune promo active)
 * k-loading    : indicateur chargement (peut être retiré une fois le grid chargé)
 */
const OPTIONAL_IDS = new Set([
  'k-promo-rail',
  'k-loading',
]);

/**
 * Ordre relatif attendu des IDs dans le DOM.
 * Le `before` doit apparaître avant le `after` dans le HTML.
 * Source : §5 + §6 CARTOGRAPHY_360_BOUTIQUE.md
 *
 * CORRECTION v2 : k-product-modal → k-modal (ID réel dans index.html)
 */
const SIBLING_ORDER = [
  {
    before: 'k-modal-overlay',
    after:  'k-modal',
    reason: 'L\'overlay (#k-modal-overlay) doit envelopper #k-modal — cf. P-1 §5',
  },
  {
    before: 'k-cart-overlay',
    after:  'k-cart-drawer',
    reason: 'L\'overlay panier doit précéder le drawer (z-index stacking)',
  },
  {
    before: 'k-cart-drawer',
    after:  'k-order-modal',
    reason: 'Le drawer panier doit précéder la modal commande (flux F4→F5)',
  },
];

// ────────────────────────────────────────────────────────────────────
// COLLECTE DES FICHIERS
// ────────────────────────────────────────────────────────────────────

function collectHtmlFiles(rootDir) {
  const results = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'playwright-report' || entry.name === 'test-results') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (entry.name.endsWith('.html')) results.push(full);
    }
  }
  walk(rootDir);
  return results;
}

// ────────────────────────────────────────────────────────────────────
// TOKENIZER HTML MINIMAL
// ────────────────────────────────────────────────────────────────────

/**
 * Tokenise le HTML en tokens { type, name, attrs, line, col, raw }.
 * Types : 'open', 'close', 'selfclose', 'doctype', 'comment', 'text'
 *
 * Limitations acceptées :
 *   - Ne gère pas les CDATA ni SVG/MathML namespaces
 *   - Contenu de <script> et <style> traité comme texte opaque
 */
function tokenize(src) {
  const tokens = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;

  function advanceChar() {
    if (src[i] === '\n') { line++; lineStart = i + 1; }
    i++;
  }

  function advanceN(n) {
    for (let k = 0; k < n; k++) advanceChar();
  }

  function col() { return i - lineStart + 1; }

  while (i < src.length) {
    if (src[i] !== '<') {
      const start = i;
      const tokLine = line;
      while (i < src.length && src[i] !== '<') advanceChar();
      tokens.push({ type: 'text', raw: src.slice(start, i), line: tokLine, col: col() });
      continue;
    }

    const tokLine = line;
    const tokCol  = col();

    // Commentaire <!-- ... -->
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      const closeIdx = end === -1 ? src.length - 3 : end;
      const raw = src.slice(i, closeIdx + 3);
      advanceN(raw.length);
      tokens.push({ type: 'comment', raw, line: tokLine, col: tokCol });
      continue;
    }

    // DOCTYPE
    if (src.slice(i, i + 9).toLowerCase() === '<!doctype') {
      const end = src.indexOf('>', i);
      if (end === -1) { advanceChar(); continue; }
      const raw = src.slice(i, end + 1);
      advanceN(raw.length);
      tokens.push({ type: 'doctype', raw, line: tokLine, col: tokCol });
      continue;
    }

    // Fermeture </tag>
    if (src[i + 1] === '/') {
      const end = src.indexOf('>', i);
      if (end === -1) { advanceChar(); continue; }
      const raw  = src.slice(i, end + 1);
      const name = raw.slice(2, raw.length - 1).trim().toLowerCase().split(/[\s>]/)[0];
      advanceN(raw.length);
      tokens.push({ type: 'close', name, raw, line: tokLine, col: tokCol });
      continue;
    }

    // Ouverture <tag ...> ou self-close <tag ... />
    const end = src.indexOf('>', i);
    if (end === -1) { advanceChar(); continue; }
    const raw   = src.slice(i, end + 1);
    const inner = raw.slice(1, raw.length - 1).trimEnd();
    const selfClose = inner.endsWith('/');
    const nameMatch = inner.match(/^([a-zA-Z][a-zA-Z0-9:-]*)/);
    if (!nameMatch) { advanceN(raw.length); continue; }
    const name = nameMatch[1].toLowerCase();

    // Extraire id et data-id
    const attrs = {};
    const attrRe = /([a-zA-Z][a-zA-Z0-9_:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>/"]+)))?/g;
    let m;
    let first = true;
    while ((m = attrRe.exec(inner)) !== null) {
      if (first) { first = false; continue; } // saute le nom du tag
      attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
    }

    advanceN(raw.length);

    const isSelfClose = selfClose || VOID_TAGS.has(name);
    tokens.push({
      type: isSelfClose ? 'selfclose' : 'open',
      name, attrs, raw, line: tokLine, col: tokCol,
    });

    // Contenu brut <script> / <style> : saute jusqu'au tag fermant
    if ((name === 'script' || name === 'style') && !isSelfClose) {
      const closeTag = `</${name}`;
      const closeIdx = src.toLowerCase().indexOf(closeTag, i);
      if (closeIdx !== -1) {
        const content = src.slice(i, closeIdx);
        for (const c of content) {
          if (c === '\n') { line++; }
        }
        i = closeIdx;
      }
    }
  }

  return tokens;
}

// ────────────────────────────────────────────────────────────────────
// ANALYSEUR
// ────────────────────────────────────────────────────────────────────

function analyzeFile(filepath, src) {
  const errors   = [];
  const warnings = [];
  const rel      = path.relative(ROOT, filepath);

  function err(line, col, code, msg, detail) {
    errors.push({ file: rel, line, col, code, msg, detail });
  }
  function warn(line, col, code, msg, detail) {
    warnings.push({ file: rel, line, col, code, msg, detail });
  }

  const tokens  = tokenize(src);
  const stack   = [];
  const seenIds = new Map();
  const idLines = new Map();

  for (const tok of tokens) {
    if (tok.type === 'open') {
      // V-3 : imbrications interdites
      for (const rule of FORBIDDEN_NESTING) {
        if (tok.name === rule.child && stack.some(s => s.name === rule.parent)) {
          err(tok.line, tok.col, 'V-3',
            `Imbrication interdite : ${rule.msg}`,
            `<${tok.name}> ligne ${tok.line} imbriqué dans <${rule.parent}> en cours`);
        }
      }

      stack.push({ name: tok.name, line: tok.line, col: tok.col });

      // V-4 : IDs uniques
      if (tok.attrs && tok.attrs.id) {
        const id = tok.attrs.id;
        if (seenIds.has(id)) {
          err(tok.line, tok.col, 'V-4',
            `ID dupliqué : #${id}`,
            `Déjà déclaré ligne ${seenIds.get(id).line}`);
        } else {
          seenIds.set(id, { line: tok.line });
          idLines.set(id, tok.line);
        }
      }

    } else if (tok.type === 'close') {
      // V-2 : void tag ne devrait pas être fermé
      if (VOID_TAGS.has(tok.name)) {
        warn(tok.line, tok.col, 'V-2',
          `Balise void <${tok.name}> ne devrait pas être fermée`,
          `</${tok.name}> ligne ${tok.line}`);
        continue;
      }

      // V-1 : équilibrage
      if (stack.length === 0) {
        err(tok.line, tok.col, 'V-1',
          `Fermeture </${tok.name}> sans ouverture correspondante`,
          'Pile vide');
        continue;
      }

      const top = stack[stack.length - 1];
      if (top.name === tok.name) {
        stack.pop();
      } else {
        const matchIdx = stack.map(s => s.name).lastIndexOf(tok.name);
        if (matchIdx === -1) {
          err(tok.line, tok.col, 'V-1',
            `Fermeture </${tok.name}> sans ouverture correspondante`,
            `Pile actuelle : ${stack.slice(-5).map(s => `<${s.name}>`).join(' > ')}`);
        } else {
          const orphans = stack.splice(matchIdx);
          orphans.pop();
          for (const o of orphans.reverse()) {
            err(tok.line, tok.col, 'V-1',
              `Balise <${o.name}> (ligne ${o.line}) non fermée avant </${tok.name}>`,
              `Vérifiez l'indentation autour de la ligne ${o.line}`);
          }
        }
      }

    } else if (tok.type === 'selfclose') {
      if (tok.attrs && tok.attrs.id) {
        const id = tok.attrs.id;
        if (seenIds.has(id)) {
          err(tok.line, tok.col, 'V-4',
            `ID dupliqué : #${id}`,
            `Déjà déclaré ligne ${seenIds.get(id).line}`);
        } else {
          seenIds.set(id, { line: tok.line });
          idLines.set(id, tok.line);
        }
      }
    }
  }

  // Éléments non fermés en fin de fichier
  for (const s of stack) {
    err(s.line, s.col, 'V-1',
      `Balise <${s.name}> (ligne ${s.line}) jamais fermée`,
      'Fin du fichier atteinte');
  }

  // ── V-5 : IDs critiques présents (index.html uniquement) ─────────
  if (path.basename(filepath) === 'index.html') {
    for (const id of CRITICAL_IDS) {
      if (!idLines.has(id) && !OPTIONAL_IDS.has(id)) {
        err(0, 0, 'V-5',
          `ID critique manquant : #${id}`,
          `Requis par b-store.js initDom() — son absence provoque dom.X = null runtime silencieux`);
      }
    }

    // ── V-7 : ordre relatif des conteneurs ────────────────────────
    for (const rule of SIBLING_ORDER) {
      const lineBefore = idLines.get(rule.before);
      const lineAfter  = idLines.get(rule.after);
      if (lineBefore !== undefined && lineAfter !== undefined) {
        if (lineBefore > lineAfter) {
          err(lineAfter, 0, 'V-7',
            `Ordre DOM incorrect : #${rule.before} doit apparaître avant #${rule.after}`,
            rule.reason);
        }
      }
    }
  }

  return { errors, warnings };
}

// ────────────────────────────────────────────────────────────────────
// RAPPORT
// ────────────────────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN  = '\x1b[32m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const CYAN   = '\x1b[36m';

function formatLoc(e) {
  if (e.line === 0) return `${e.file}`;
  return `${e.file}:${e.line}${e.col ? ':' + e.col : ''}`;
}

function printIssue(e, prefix, color) {
  console.log(`${color}${prefix}${RESET} ${BOLD}[${e.code}]${RESET} ${e.msg}`);
  console.log(`  ${DIM}${formatLoc(e)}${RESET}`);
  if (e.detail) console.log(`  ${DIM}↳ ${e.detail}${RESET}`);
}

// ────────────────────────────────────────────────────────────────────
// MAIN
// ────────────────────────────────────────────────────────────────────

(function main() {
  let files;
  if (process.argv.length > 2) {
    files = process.argv.slice(2).map(f => path.resolve(process.cwd(), f));
  } else {
    files = collectHtmlFiles(ROOT);
  }

  if (files.length === 0) {
    console.log(`${YELLOW}⚠${RESET}  Aucun fichier HTML trouvé dans ${ROOT}`);
    process.exit(0);
  }

  console.log(`\n${BOLD}${CYAN}━━━ check-html-balance v2 — Komerce Boutique ━━━${RESET}`);
  console.log(`${DIM}Analyse de ${files.length} fichier(s) — ${CRITICAL_IDS.length} IDs critiques surveillés…${RESET}\n`);

  let totalErrors   = 0;
  let totalWarnings = 0;

  for (const filepath of files) {
    if (!fs.existsSync(filepath)) {
      console.log(`${YELLOW}⚠${RESET}  Fichier introuvable : ${filepath}`);
      continue;
    }

    const src = fs.readFileSync(filepath, 'utf8');
    const { errors, warnings } = analyzeFile(filepath, src);

    if (errors.length === 0 && warnings.length === 0) {
      console.log(`${GREEN}✔${RESET}  ${path.relative(ROOT, filepath)}`);
      continue;
    }

    console.log(`\n${BOLD}${path.relative(ROOT, filepath)}${RESET}`);
    for (const e of errors)   printIssue(e, '✖', RED);
    for (const w of warnings) printIssue(w, '⚠', YELLOW);

    totalErrors   += errors.length;
    totalWarnings += warnings.length;
  }

  console.log(`\n${BOLD}${CYAN}━━━ Résultat ━━━${RESET}`);
  if (totalErrors === 0 && totalWarnings === 0) {
    console.log(`${GREEN}${BOLD}✔ Tous les fichiers HTML sont équilibrés et valides.${RESET}\n`);
    process.exit(0);
  }

  if (totalErrors > 0) {
    console.log(`${RED}${BOLD}✖ ${totalErrors} erreur(s)${RESET}${totalWarnings > 0 ? `, ${YELLOW}${totalWarnings} avertissement(s)${RESET}` : ''}`);
    console.log(`${DIM}Corrigez les erreurs (exit 1) avant de merger.${RESET}\n`);
    process.exit(1);
  }

  console.log(`${YELLOW}⚠ 0 erreur, ${totalWarnings} avertissement(s) — exit 0${RESET}`);
  console.log(`${DIM}Avertissements informatifs uniquement.${RESET}\n`);
  process.exit(0);
})();
