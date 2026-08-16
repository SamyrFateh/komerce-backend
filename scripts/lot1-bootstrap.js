'use strict';

const fs = require('fs');

const file = 'features/infrastructure.feature.js';
let src = fs.readFileSync(file, 'utf8');
const from = `      // Workflow ACTIF — GitHub Actions ne charge que \`.github/workflows/\`.\n      '.github/workflows/ci.yml',`;
const to = `      // Workflows ACTIFS — GitHub Actions ne charge que \`.github/workflows/\`.\n      '.github/workflows/ci.yml',\n      '.github/workflows/pr-enforcement.yml',`;
if (!src.includes(from) && !src.includes("'.github/workflows/pr-enforcement.yml'")) {
  throw new Error('Point d’insertion du workflow PR introuvable dans infrastructure.feature.js');
}
if (!src.includes("'.github/workflows/pr-enforcement.yml'")) {
  src = src.replace(from, to);
  fs.writeFileSync(file, src, 'utf8');
  console.log('infrastructure.feature.js réaligné avec pr-enforcement.yml');
} else {
  console.log('infrastructure.feature.js déjà à jour');
}
