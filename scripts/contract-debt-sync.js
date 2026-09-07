'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONTRACT_PATH = path.join(ROOT, 'docs', 'contract', 'openapi.json');
const DEBT_PATH = path.join(ROOT, 'docs', 'contract', 'DEBT.md');
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

function collectUnknownResponses(contract) {
  const unknown = [];
  for (const [routePath, pathItem] of Object.entries(contract.paths || {})) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem?.[method];
      if (!operation) continue;
      const schema = operation.responses?.['200']?.content?.['application/json']?.schema;
      if (schema?.['x-contract-status'] !== 'UNKNOWN') continue;
      unknown.push({
        method: method.toUpperCase(),
        path: routePath,
        routeFile: operation['x-route-file'] || '',
      });
    }
  }
  return unknown.sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
}

function renderDebtMarkdown(contract, unknown) {
  const totalRoutes = contract['x-contract-debt']?.total_routes ?? Object.keys(contract.paths || {}).length;
  const lines = [
    '# Dette de contrat API',
    '',
    '> Fichier généré depuis `docs/contract/openapi.json` par `scripts/contract-debt-sync.js`.',
    '> Ne pas maintenir cette liste à la main.',
    '',
    `- Routes dans le contrat : **${totalRoutes}**`,
    `- Réponses 200 ` + '`UNKNOWN`' + ` : **${unknown.length}**`,
    '',
  ];

  if (!unknown.length) {
    lines.push('✅ Aucune réponse `UNKNOWN` restante.', '');
    return `${lines.join('\n')}\n`;
  }

  lines.push('| # | Opération | Source route |', '|---:|---|---|');
  unknown.forEach((entry, index) => {
    const source = entry.routeFile ? `\`${entry.routeFile}\`` : '—';
    lines.push(`| ${index + 1} | \`${entry.method} ${entry.path}\` | ${source} |`);
  });
  lines.push('', 'Chaque ligne doit être fermée par une preuve de forme de réponse (test, lecture de route/service fiable ou contrat explicite), jamais par une forme inventée.', '');
  return `${lines.join('\n')}\n`;
}

function main() {
  const mode = process.argv.includes('--write') ? 'write' : process.argv.includes('--check') ? 'check' : 'print';
  const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
  const unknown = collectUnknownResponses(contract);
  const declared = contract['x-contract-debt']?.unknown_responses;

  if (declared !== undefined && declared !== unknown.length) {
    console.error(`❌ x-contract-debt.unknown_responses=${declared} mais ${unknown.length} réponse(s) UNKNOWN sont réellement présentes.`);
    process.exit(1);
  }

  const rendered = renderDebtMarkdown(contract, unknown);

  if (mode === 'write') {
    fs.writeFileSync(DEBT_PATH, rendered);
    console.log(`✅ Contrat dette synchronisé : ${unknown.length} UNKNOWN.`);
    return;
  }

  if (mode === 'check') {
    const current = fs.existsSync(DEBT_PATH) ? fs.readFileSync(DEBT_PATH, 'utf8') : '';
    if (current !== rendered) {
      console.error(`❌ docs/contract/DEBT.md est stale. Attendu : ${unknown.length} UNKNOWN.`);
      console.error('   Correction : npm run contract:debt:write puis commiter le fichier généré.');
      process.exit(1);
    }
    console.log(`✅ Registre de dette contrat cohérent : ${unknown.length} UNKNOWN.`);
    return;
  }

  process.stdout.write(rendered);
}

if (require.main === module) main();

module.exports = { collectUnknownResponses, renderDebtMarkdown };
