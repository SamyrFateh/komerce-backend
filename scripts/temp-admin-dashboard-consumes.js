'use strict';
const fs = require('fs');

const manifestPath = 'public/dashboards/features/admin-dashboard.feature.js';
let src = fs.readFileSync(manifestPath, 'utf8');
const oldContract = `  contract: { exposes: [], consumes: ['sourcing'] },`;
const newContract = `  contract: {\n    exposes: [],\n    // Projection/UI shell : ces providers sont consommés via leurs interfaces\n    // HTTP par les vues admin. Le dashboard ne possède pas leurs mutations.\n    consumes: [\n      'catalog',\n      'customs',\n      'dashboard',\n      'decision-signals',\n      'documents',\n      'economic-engine',\n      'inventory',\n      'logistics',\n      'orders',\n      'payments',\n      'sourcing',\n    ],\n  },`;
if (!src.includes(oldContract)) throw new Error('admin-dashboard contract marker missing');
src = src.replace(oldContract, newContract);
fs.writeFileSync(manifestPath, src);

const baselinePath = 'governance/business-graph-drift-baseline.json';
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const key = 'OBSERVED-UNDECLARED-FEATURE-DEPENDENCY::ACTIONABLE_DRIFT';
if (baseline.baseline[key] !== 26) throw new Error(`unexpected starting baseline ${key}=${baseline.baseline[key]}`);
baseline.baseline[key] = 16;
baseline._comment_admin_dashboard_20260817 = '10 dépendances d’interface admin-dashboard→provider sont observées dans le graphe et désormais déclarées dans le manifest canonique de projection. Baseline resserrée 26→16, jamais relevée.';
fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n');

console.log('Admin dashboard interface dependencies staged.');
