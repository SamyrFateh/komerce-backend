#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role    shelf-atlas-integrity-gate
 * @domain  catalog
 * @layer   ci-gate
 * @purpose Empêche qu'un atlas de navigation corrompu / mal dimensionné / sans
 *          alpha soit mergé. Décode réellement le WebP (pas juste sa présence)
 *          et vérifie que chaque crop `atlas:c:r` du registre tombe dans la grille.
 *
 * Zéro dépendance : parse l'en-tête WebP (RIFF/WEBP + VP8X|VP8L|VP8 ) à la main.
 * Sortie non nulle + message clair au premier échec.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ATLAS = path.join(ROOT, 'public/boutique/categories/mode-pilot-atlas.webp');
const REGISTRY = path.join(ROOT, 'public/boutique/js/render/category-shelf-visuals.js');

// Géométrie attendue (doit rester synchro avec renderAtlasCell : 768x512, cellules 256).
const EXPECT_W = 768;
const EXPECT_H = 512;
const CELL = 256;
const COLS = EXPECT_W / CELL; // 3
const ROWS = EXPECT_H / CELL; // 2

function fail(msg) { console.error(`✗ shelf-atlas: ${msg}`); process.exit(1); }
function u24le(b, o) { return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16); }

function decodeWebp(buf) {
  if (buf.length < 16) fail('fichier trop court pour être un WebP');
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    fail(`ce n'est pas un WebP valide (magic RIFF/WEBP absent — premiers octets: ${buf.slice(0, 4).toString('hex')})`);
  }
  const fourcc = buf.toString('ascii', 12, 16);
  if (fourcc === 'VP8X') {
    const flags = buf[20];
    const alpha = (flags & 0x10) !== 0;
    const width = u24le(buf, 24) + 1;
    const height = u24le(buf, 27) + 1;
    return { fmt: 'VP8X', width, height, alpha };
  }
  if (fourcc === 'VP8L') {
    // signature 0x2F puis 14 bits w-1, 14 bits h-1, 1 bit alpha_is_used
    if (buf[21] !== 0x2f) fail('VP8L: signature invalide');
    const b = buf.readUInt32LE(21) >>> 8; // 24 bits après la signature
    const width = (b & 0x3fff) + 1;
    const height = ((b >> 14) & 0x3fff) + 1;
    const alpha = ((b >> 28) & 1) === 1;
    return { fmt: 'VP8L', width, height, alpha };
  }
  if (fourcc === 'VP8 ') {
    // WebP lossy : pas de canal alpha
    const width = buf.readUInt16LE(26) & 0x3fff;
    const height = buf.readUInt16LE(28) & 0x3fff;
    return { fmt: 'VP8 ', width, height, alpha: false };
  }
  fail(`chunk WebP inattendu: ${fourcc}`);
}

// 1) L'atlas existe et se décode
if (!fs.existsSync(ATLAS)) fail(`fichier absent: ${path.relative(ROOT, ATLAS)}`);
const buf = fs.readFileSync(ATLAS);
const img = decodeWebp(buf);

// 2) Dimensions exactes
if (img.width !== EXPECT_W || img.height !== EXPECT_H) {
  fail(`dimensions ${img.width}x${img.height}, attendu ${EXPECT_W}x${EXPECT_H} (${img.fmt})`);
}

// 3) Canal alpha obligatoire (objets détourés sur fond transparent)
if (!img.alpha) fail(`pas de canal alpha (${img.fmt}) — les objets doivent être détourés sur fond transparent`);

// 4) Chaque crop atlas:c:r du registre tombe dans la grille COLSxROWS
const src = fs.readFileSync(REGISTRY, 'utf8');
const refs = [...src.matchAll(/atlas:(\d):(\d)/g)];
if (refs.length === 0) fail('aucune référence atlas:c:r trouvée dans le registre');
for (const m of refs) {
  const col = Number(m[1]);
  const row = Number(m[2]);
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) {
    fail(`crop hors grille: atlas:${col}:${row} (grille ${COLS}x${ROWS})`);
  }
}

console.log(`✓ shelf-atlas: ${img.fmt} ${img.width}x${img.height}, alpha ok, ${refs.length} crops dans la grille ${COLS}x${ROWS}`);
