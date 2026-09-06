'use strict';
const fs = require('fs');
const p = 'scripts/contract-generate.js';
let src = fs.readFileSync(p, 'utf8');
const marker = "  // La route receipt retourne du HTML imprimable, pas du JSON.\n";

if (!src.includes('Document transactionnel PDF privé')) {
  const pdfOverride = `  'GET /api/auth/me/documents/{id}/download': {\n    '200': {\n      description: 'Document transactionnel PDF privé',\n      content: { 'application/pdf': { schema: { type: 'string', format: 'binary', 'x-contract-status': 'route-read' } } },\n    },\n    '404': { description: 'Document introuvable' },\n    '503': { description: 'Document temporairement indisponible' },\n  },\n`;
  if (!src.includes(marker)) throw new Error('PDF override insertion marker not found');
  src = src.replace(marker, pdfOverride + marker);
}

if (!src.includes('Scope marché créé')) {
  const scope201 = `  'POST /api/admin/users/{id}/market-scopes': {\n    '201': {\n      description: 'Scope marché créé',\n      content: { 'application/json': { schema: {\n        type: 'object',\n        'x-contract-status': 'route-read',\n        properties: {\n          success: { type: 'string', 'x-observed': true },\n          status: { type: 'string', 'x-observed': true },\n          scope: { type: 'string', 'x-observed': true },\n        },\n      } } },\n    },\n  },\n`;
  if (!src.includes(marker)) throw new Error('Market-scope 201 insertion marker not found');
  src = src.replace(marker, scope201 + marker);
}

fs.writeFileSync(p, src);
