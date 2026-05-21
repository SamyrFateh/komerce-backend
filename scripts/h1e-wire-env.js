#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'server.js');
const MODE = process.argv.includes('--write') ? 'write' : 'check';

function fail(message) {
  console.error(`❌ H1E codemod refused: ${message}`);
  process.exit(1);
}

const original = fs.readFileSync(SERVER, 'utf8');

if (original.includes('loadAndValidateEnv();')) {
  fail('server.js already appears wired for H1E');
}

const oldBlock = `require('dotenv').config();

// ── Validation des variables d'environnement critiques ───────────────────────
const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET'];
const RECOMMENDED_ENV = ['ADMIN_PASSWORD', 'STRIPE_SECRET_KEY'];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(\`❌ FATAL: \${key} manquant — impossible de démarrer\`);
    process.exit(1);
  }
}
for (const key of RECOMMENDED_ENV) {
  if (!process.env[key]) {
    console.warn(\`⚠️  \${key} non défini — valeur par défaut utilisée (à configurer avant la prod)\`);
  }
}
`;

const newBlock = `const { loadAndValidateEnv } = require('./bootstrap/env');
loadAndValidateEnv();
`;

if (!original.includes(oldBlock)) {
  fail('env validation block not found');
}

const next = original.replace(oldBlock, newBlock);

const requiredNeedles = [
  "require('./bootstrap/env')",
  'loadAndValidateEnv();',
  "require('./bootstrap/security')",
  "require('./bootstrap/api-routes')",
  "require('./bootstrap/html-routes')",
  "require('./bootstrap/crons')",
  "app.use('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }));",
  "app.use(express.json({ limit: '1mb' }));",
  'app.listen(PORT',
];

for (const needle of requiredNeedles) {
  if (!next.includes(needle)) fail(`safety check missing after transform: ${needle}`);
}

const removedNeedles = [
  "const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET'];",
  "const RECOMMENDED_ENV = ['ADMIN_PASSWORD', 'STRIPE_SECRET_KEY'];",
];

for (const needle of removedNeedles) {
  if (next.includes(needle)) fail(`old env validation still present in server.js: ${needle}`);
}

console.log('✅ H1E env codemod checks passed');
console.log(`Mode: ${MODE}`);
console.log(`server.js length: ${original.length} → ${next.length}`);

if (MODE === 'write') {
  fs.writeFileSync(SERVER, next, 'utf8');
  console.log('✅ server.js updated. Review with: git diff -- server.js');
} else {
  console.log('No file written. Re-run with --write to apply.');
}
