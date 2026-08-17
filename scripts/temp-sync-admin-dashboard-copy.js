'use strict';
const fs = require('fs');
const p = 'public/features/admin-dashboard.feature.js';
let src = fs.readFileSync(p, 'utf8');
const from = "  contract: { exposes: [], consumes: ['sourcing'] },";
const to = [
  '  contract: {',
  '    exposes: [],',
  '    // Projection/UI shell : ces providers sont consommés via leurs interfaces',
  '    // HTTP par les vues admin. Le dashboard ne possède pas leurs mutations.',
  '    consumes: [',
  "      'catalog',",
  "      'customs',",
  "      'dashboard',",
  "      'decision-signals',",
  "      'documents',",
  "      'economic-engine',",
  "      'inventory',",
  "      'logistics',",
  "      'orders',",
  "      'payments',",
  "      'sourcing',",
  '    ],',
  '  },',
].join('\n');
if (!src.includes(from)) throw new Error('admin-dashboard copy contract marker missing');
src = src.replace(from, to);
fs.writeFileSync(p, src);
console.log('Governed admin-dashboard manifest copy synchronized exactly.');
