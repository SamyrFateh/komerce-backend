'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const registry = path.join(__dirname, 'feature-registry-check.js');

const result = spawnSync(process.execPath, [registry, '--json'], {
  cwd: ROOT,
  encoding: 'utf8',
});

if (result.error) {
  console.error(`Feature Registry impossible a lancer: ${result.error.message}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(result.stdout || '{}');
} catch (error) {
  console.error('Sortie JSON invalide du Feature Registry.');
  if (result.stdout) console.error(result.stdout);
  if (result.stderr) console.error(result.stderr);
  process.exit(1);
}

const errors = Array.isArray(report.errors) ? report.errors : [];
const archivedWorkflowDebt = [];
const blockingErrors = [];

for (const error of errors) {
  const file = typeof error.file === 'string' ? error.file.replace(/\\/g, '/') : '';
  const workflowPrefix = '.github/workflows/';

  if (error.type === 'FILE-MISSING' && file.startsWith(workflowPrefix)) {
    const basename = file.slice(workflowPrefix.length);
    const archivedPath = path.join(ROOT, '.github', 'workflows-disabled', basename);
    if (basename && !basename.includes('/') && fs.existsSync(archivedPath)) {
      archivedWorkflowDebt.push({ ...error, archivedPath: `.github/workflows-disabled/${basename}` });
      continue;
    }
  }

  blockingErrors.push(error);
}

console.log(`Feature Registry cible: ${report.summary?.features ?? '?'} features, ${report.summary?.declared ?? '?'} fichiers declares.`);

if (archivedWorkflowDebt.length > 0) {
  console.log(`INFO ${archivedWorkflowDebt.length} declaration(s) de workflows volontairement archivees tolerees pendant le nettoyage.`);
}

if (blockingErrors.length > 0) {
  console.error(`ECHEC Feature Registry: ${blockingErrors.length} erreur(s) active(s).`);
  for (const error of blockingErrors) {
    const where = error.file || error.feature || 'inconnu';
    console.error(`- [${error.type || 'ERROR'}] ${where}: ${error.msg || ''}`);
  }
  process.exit(1);
}

const warnings = Array.isArray(report.warnings) ? report.warnings.length : 0;
console.log(`OK Feature Registry: aucune nouvelle erreur bloquante (${warnings} warning(s) observes).`);
