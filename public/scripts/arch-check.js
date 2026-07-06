#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STRICT = process.argv.includes('--strict');
const errors = [];
const warnings = [];
let total = 0;

const SCAN_DIRS = ['admin/js', 'admin-legacy/js'];

function scan(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return;
  for (const entry of fs.readdirSync(abs)) {
    const rel = path.join(dir, entry);
    const full = path.join(ROOT, rel);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) { scan(rel); continue; }
    if (!entry.endsWith('.js')) continue;
    total++;
    const head = fs.readFileSync(full, 'utf8').slice(0, 2000);
    if (!head.match(/@domain\s+\S+/)) errors.push(rel);
    if (!head.match(/@role\s+\S+/)) warnings.push(rel);
  }
}

SCAN_DIRS.forEach(scan);
// portal-pilotage.js est hors js/
const pp = path.join(ROOT, 'admin/portal-pilotage.js');
if (fs.existsSync(pp)) {
  total++;
  const head = fs.readFileSync(pp, 'utf8').slice(0, 2000);
  if (!head.match(/@domain/)) errors.push('admin/portal-pilotage.js');
}

console.log('\n  Architecture Check — Dashboards (N4)\n');
console.log('  Fichiers verifies  : ' + total);
console.log('  @domain manquants  : ' + errors.length);
console.log('  @role manquants    : ' + warnings.length);
if (errors.length === 0) console.log('\n  ✅ Headers conformes — ' + total + ' fichiers.\n');
else { errors.forEach(e => console.log('  ❌ ' + e)); console.log(''); }
if (STRICT && errors.length > 0) process.exit(1);
