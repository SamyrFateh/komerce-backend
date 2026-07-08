#!/usr/bin/env bash
set -euo pipefail

export NODE_ENV=${NODE_ENV:-test}
export JWT_SECRET=${JWT_SECRET:-ci-test-secret-not-for-prod}
export META_WA_APP_SECRET=${META_WA_APP_SECRET:-test-secret}

echo "== syntax: tests D-06 =="
node --check tests/integration/customs-shipments-contract.test.js
node --check tests/integration/hub-volume-photo-contract.test.js
node --check tests/integration/admin-documents-contract.test.js
node --check tests/integration/catalog-approval-queue-contract.test.js
node --check scripts/contract-generate.js

echo "== contract:generate =="
node scripts/contract-generate.js

echo "== UNKNOWN count =="
node - <<'NODE'
const fs = require('fs');
const spec = JSON.parse(fs.readFileSync('docs/contract/openapi.json', 'utf8'));
const unknown = [];
for (const [path, methods] of Object.entries(spec.paths || {})) {
  for (const [method, def] of Object.entries(methods || {})) {
    if (JSON.stringify(def).includes('UNKNOWN')) unknown.push(`${method.toUpperCase()} ${path}`);
  }
}
console.log(`${unknown.length} UNKNOWN`);
if (unknown.length) {
  console.error(unknown.join('\n'));
  process.exit(1);
}
NODE

echo "== contract:check =="
node scripts/contract-check.js

echo "D-06 OK"
