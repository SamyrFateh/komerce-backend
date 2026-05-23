#!/usr/bin/env node
'use strict';
/**
 * F1 — Codemod : console.* → logger structuré
 * Usage : node scripts/f1-console-to-logger.js <file> [--write]
 */

const fs = require('fs');
const path = require('path');

const [,, target, mode] = process.argv;
if (!target) { console.error('Usage: node f1-console-to-logger.js <file> [--write]'); process.exit(1); }

const absPath = path.resolve(target);
const original = fs.readFileSync(absPath, 'utf8');

// Detect relative path to utils/logger from the file
const relToRoot = path.relative(path.dirname(absPath), path.resolve(__dirname, '..'));
const loggerPath = (relToRoot === '' ? '.' : relToRoot) + '/utils/logger';

// Derive module name from filename
const moduleName = path.basename(absPath, '.js');

// Check if logger already imported
const alreadyHasLogger = /require.*utils\/logger/.test(original);

let next = original;

// Add logger import after the last require block if not present
if (!alreadyHasLogger) {
  // Find insertion point: after last top-level require line
  const lines = next.split('\n');
  let lastRequireLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^const .+ = require\(/.test(lines[i])) lastRequireLine = i;
  }
  if (lastRequireLine >= 0) {
    lines.splice(lastRequireLine + 1, 0, `const log = require('${loggerPath}').child({ module: '${moduleName}' });`);
    next = lines.join('\n');
  }
}

// Replace console.log / console.info → log.info
next = next.replace(/console\.log\(/g, 'log.info(');
// Replace console.warn → log.warn
next = next.replace(/console\.warn\(/g, 'log.warn(');
// Replace console.error → log.error
next = next.replace(/console\.error\(/g, 'log.error(');
// Replace console.debug → log.debug
next = next.replace(/console\.debug\(/g, 'log.debug(');

const addedCount = (original.match(/console\.(log|warn|error|debug)\(/g) || []).length;

console.log(`📁 ${path.relative(process.cwd(), absPath)}`);
console.log(`   Logger import: ${alreadyHasLogger ? 'already present' : 'added'}`);
console.log(`   Replacements:  ${addedCount} console.* calls migrated`);
console.log(`   Mode:          ${mode === '--write' ? 'WRITE' : 'dry-run'}`);

if (mode === '--write') {
  fs.writeFileSync(absPath, next, 'utf8');
  console.log(`   ✅ Written.`);
} else {
  console.log(`   Re-run with --write to apply.`);
}
