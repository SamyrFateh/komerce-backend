#!/usr/bin/env node
'use strict';

/**
 * @komerce-arch-lite
 * @role          csp-invariant-gate
 * @domain        boutique
 * @layer         build-gate
 * @purpose       Détecte les <script> inline présents dans les pages HTML alors
 *                que la CSP du serveur interdit l'exécution inline. Ces scripts
 *                sont SILENCIEUSEMENT MORTS en production : aucune erreur
 *                serveur, aucun test unitaire en échec, juste une fonctionnalité
 *                qui n'existe pas.
 * @impact-areas  csp, boutique, hero, service-worker
 *
 * ── Pourquoi ce gate existe ────────────────────────────────────────────────
 * Le durcissement FRESH-030 / AUD-04 a retiré 'unsafe-inline' de `script-src`
 * dans bootstrap/security.js. Quatre <script> inline d'index.html sont restés
 * en place et ont cessé de s'exécuter en production, sans que rien ne le
 * signale pendant des semaines :
 *
 *   (index):5    réinitialisation « nucléaire » du service worker    → morte
 *   (index):35   gestion de la mise à jour du service worker         → morte
 *   (index):91   anti-FOUC `k-home-premium-v1`                        → morte
 *   (index):680  mesure du hero sticky (mobile)                       → morte
 *
 * La troisième était la cause racine du « flash du hero en gros » : sans la
 * classe posée avant le CSS, `.k-hero-media` restait en `display:block` et
 * l'image hero s'affichait sur 1440px au lieu de 648px, jusqu'à ce qu'un
 * script externe finisse par poser la classe.
 *
 * Aucun test local ne pouvait le voir : la CSP vient d'un en-tête HTTP servi
 * par l'application, pas du HTML. Un serveur de fichiers statique ne l'envoie
 * pas — le symptôme n'existe qu'en conditions de production.
 *
 * Usage :
 *   node scripts/check-inline-scripts.js            ← rapport
 *   node scripts/check-inline-scripts.js --strict   ← bloque (CI / pre-commit)
 */

const fs = require('fs');
const path = require('path');

const BOUTIQUE = path.resolve(__dirname, '..');
const REPO = path.resolve(BOUTIQUE, '..', '..');
const SECURITY = path.join(REPO, 'bootstrap', 'security.js');
const strict = process.argv.includes('--strict');

const RED = '\x1b[31m', GRN = '\x1b[32m', YEL = '\x1b[33m', BLD = '\x1b[1m', DIM = '\x1b[2m', R = '\x1b[0m';

// ── 1. Lire la politique réellement configurée, jamais une valeur en dur ──
function lireScriptSrc() {
  if (!fs.existsSync(SECURITY)) return null;
  const src = fs.readFileSync(SECURITY, 'utf8');
  const m = src.match(/scriptSrc\s*:\s*\[([^\]]*)\]/);
  if (!m) return null;
  return {
    directive: m[1].replace(/\s+/g, ' ').trim(),
    unsafeInline: /'unsafe-inline'/.test(m[1]),
    nonce: /nonce-/.test(m[1]),
  };
}

const csp = lireScriptSrc();
console.log(`${BLD}Inline Scripts vs CSP — scripts morts en production${R}`);

if (!csp) {
  console.log(`${YEL}⚠ scriptSrc introuvable dans bootstrap/security.js — vérification impossible.${R}`);
  process.exit(strict ? 1 : 0);
}

if (csp.unsafeInline || csp.nonce) {
  console.log(`${GRN}${BLD}✔ La CSP autorise l'inline (unsafe-inline ou nonce) — rien à vérifier.${R}`);
  process.exit(0);
}

console.log(`${DIM}  script-src : ${csp.directive}${R}`);
console.log(`${DIM}  → l'inline est INTERDIT : tout <script> sans src est mort en production.${R}\n`);

// ── 2. Scanner les pages HTML servies ──
function pagesHtml(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (/^(node_modules|coverage|playwright-report|tests|docs|harnais)$/.test(e.name)) continue;
      pagesHtml(path.join(dir, e.name), acc);
    } else if (e.name.endsWith('.html')) {
      acc.push(path.join(dir, e.name));
    }
  }
  return acc;
}

let total = 0;
const parFichier = [];

for (const f of pagesHtml(BOUTIQUE)) {
  const src = fs.readFileSync(f, 'utf8');
  const lignes = src.split('\n');
  const trouves = [];

  const re = /<script\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(src))) {
    const attrs = m[1];
    if (/\bsrc\s*=/.test(attrs)) continue;                       // script externe : autorisé
    if (/\btype\s*=\s*["'](application\/json|application\/ld\+json|text\/template)["']/i.test(attrs)) continue;
    if (/\bnonce\s*=/.test(attrs)) continue;                     // nonce explicite

    const ligne = src.slice(0, m.index).split('\n').length;
    const apercu = (lignes[ligne] || lignes[ligne - 1] || '').trim().slice(0, 62);
    trouves.push({ ligne, apercu });
  }

  if (trouves.length) {
    total += trouves.length;
    parFichier.push({ fichier: path.relative(REPO, f), trouves });
  }
}

for (const { fichier, trouves } of parFichier) {
  console.log(`${RED}✗ ${fichier}${R}  ${DIM}(${trouves.length} script(s) inline)${R}`);
  for (const t of trouves) {
    console.log(`   ${RED}ligne ${t.ligne}${R}  ${DIM}${t.apercu}…${R}`);
  }
  console.log(`   ${DIM}Correctif : externaliser vers un fichier .js servi en same-origin.${R}`);
  console.log(`   ${DIM}Un script qui doit précéder le CSS reste un <script src> SYNCHRONE${R}`);
  console.log(`   ${DIM}placé AVANT les <link rel=stylesheet> — jamais defer ni async.${R}`);
}

if (!total) {
  console.log(`${GRN}${BLD}✔ Aucun script inline mort sous la CSP en vigueur.${R}`);
  process.exit(0);
}

console.log(`\n${BLD}Total : ${total} script(s) inline silencieusement mort(s) en production.${R}`);
process.exit(strict ? 1 : 0);
