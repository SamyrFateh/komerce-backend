#!/usr/bin/env node
/**
 * bundle-css.js — Komerce CSS bundler (Sprint 3)
 * Usage : node scripts/bundle-css.js
 * Produit 4 fichiers dans css/dist/
 */
const fs   = require('fs');
const path = require('path');

const CSS = path.join(__dirname, '..', 'css');
const OUT = path.join(CSS, 'dist');

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const stamp = new Date().toISOString().slice(0, 10);

const bundles = [
  {
    out: 'base.css',
    label: 'base — tokens · reset · layout · hero',
    files: ['tokens', 'reset', 'layout', 'hero'],
  },
  {
    out: 'components.css',
    label: 'components — categories · products · modal · cart · interactions · hero-cart-proxy · group-cart-flow · shared-followup',
    files: ['categories', 'products', 'modal', 'cart', 'interactions', 'hero-cart-proxy', 'group-cart-flow', 'shared-followup'],
  },
  {
    out: 'desktop.css',
    label: 'desktop — boutique-desktop · desktop-commerce-skeleton',
    files: ['boutique-desktop', 'desktop-commerce-skeleton'],
  },
  {
    out: 'event.css',
    label: 'event — tokens + event (chargé sur /event/*.html)',
    files: ['tokens', 'event'],
  },
];

let totalIn = 0;
let totalOut = 0;

for (const bundle of bundles) {
  const parts = bundle.files.map(name => {
    const src = path.join(CSS, `${name}.css`);
    if (!fs.existsSync(src)) {
      console.warn(`  ⚠ fichier introuvable : ${src}`);
      return '';
    }
    const content = fs.readFileSync(src, 'utf8');
    totalIn += content.split('\n').length;
    return `/* ── ${name}.css ${'─'.repeat(Math.max(0, 50 - name.length))} */\n${content}`;
  });

  const header = [
    `/* ${'═'.repeat(63)}`,
    `   KOMERCE — ${bundle.out} (bundle Sprint 3 · ${stamp})`,
    `   ${bundle.label}`,
    `   Généré par scripts/bundle-css.js — éditer les sources.`,
    `   ${'═'.repeat(63)} */`,
    '',
  ].join('\n');

  const output = header + parts.join('\n\n');
  const dest = path.join(OUT, bundle.out);
  fs.writeFileSync(dest, output, 'utf8');
  const lines = output.split('\n').length;
  totalOut += lines;
  console.log(`  ✓  ${bundle.out.padEnd(18)} ${lines} lignes  (← ${bundle.files.join(' + ')})`);
}

console.log(`\n  Total : ${totalIn} → ${totalOut} lignes dans css/dist/`);
console.log('  (4 requêtes HTTP au lieu de 13)');
