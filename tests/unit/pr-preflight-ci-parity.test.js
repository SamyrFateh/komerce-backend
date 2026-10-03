'use strict';

/**
 * Parité preflight ↔ CI : toute commande exécutée par .github/workflows/pr-enforcement.yml
 * doit être rejouée par npm run pr:preflight, ou figurer dans CI_ONLY avec sa raison.
 * Ajouter un gate en CI sans l'ajouter au preflight fait échouer ce test : c'est ce
 * qui empêche le retour des rouges CI reproductibles localement.
 */

const fs = require('fs');
const path = require('path');
const { buildPlan, CI_ONLY, CI_RESTORED_PROJECTIONS } = require('../../scripts/pr-preflight');

const ROOT = path.resolve(__dirname, '../..');
const WORKFLOW = fs.readFileSync(path.join(ROOT, '.github/workflows/pr-enforcement.yml'), 'utf8');
const ROOT_SCRIPTS = require('../../package.json').scripts;
const BOUTIQUE_SCRIPTS = require('../../public/boutique/package.json').scripts;

function runBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^(\s*)(?:- )?run:\s*(.*)$/);
    if (!m) continue;
    const indent = m[1].length;
    const head = m[2].trim();
    if (head && !['|', '>-', '>', '|-'].includes(head)) {
      blocks.push(head);
      continue;
    }
    const body = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j];
      if (line.trim() === '') { body.push(''); continue; }
      if (line.match(/^\s*/)[0].length <= indent) break;
      body.push(line.trim());
    }
    blocks.push(body.filter(l => !l.startsWith('#')).join('\n'));
  }
  return blocks;
}

function nodeScripts(text, prefix = '') {
  return [...text.matchAll(/\bnode\s+(?:--check\s+)?(?:\.\/)?([\w./-]+\.(?:js|cjs|mjs))/g)]
    .map(m => prefix + m[1]);
}

function resolveNpm(name, scripts, prefix, seen = new Set()) {
  const key = `${prefix}:${name}`;
  if (seen.has(key)) return [];
  seen.add(key);
  const body = scripts[name];
  const ids = [`npm${prefix ? `[${prefix}]` : ''}:${name}`];
  // Un script déclaré CI_ONLY n'est pas déplié : sa raison couvre tout son contenu.
  if (!body || Object.prototype.hasOwnProperty.call(CI_ONLY, name)) return ids;
  ids.push(...nodeScripts(body, prefix));
  for (const m of body.matchAll(/npm run ([\w:.-]+)/g)) ids.push(...resolveNpm(m[1], scripts, prefix, seen));
  return ids;
}

function identifiers(text) {
  const ids = [...nodeScripts(text)];
  // `npm --prefix public/boutique ci` est une installation, pas un gate : seul `run` compte.
  for (const m of text.matchAll(/npm --prefix public\/boutique run ([\w:.-]+)/g)) {
    ids.push(...resolveNpm(m[1], BOUTIQUE_SCRIPTS, 'public/boutique/'));
  }
  const withoutPrefixed = text.replace(/npm --prefix public\/boutique (?:run )?[\w:.-]+/g, '');
  for (const m of withoutPrefixed.matchAll(/\bnpm run ([\w:.-]+)/g)) ids.push(...resolveNpm(m[1], ROOT_SCRIPTS, ''));
  for (const m of text.matchAll(/\bnpx jest\b([^\n]*(?:\n(?!\S*\s*(?:node|npm|npx)\b)[^\n]*)*)/g)) {
    ids.push(...(m[1].match(/tests\/[\w./-]+\.test\.js/g) || []));
  }
  return ids;
}

const ALL_SCOPES = {
  backend: true, dashboard: true, boutique: true, governance: true, migrations: true,
  schemaDump: true, golden: true, boutiqueCss: true, boutiqueJs: true,
  providerProofOnly: true, cjPilotProofOnly: true,
  backendFiles: ['services/x.js'], migrationFiles: ['migrations/999_x.sql'], changedFiles: ['x'],
};

function preflightIdentifiers() {
  const ids = new Set();
  for (const step of buildPlan(ALL_SCOPES, 'base', 'head')) {
    const text = step.file === process.execPath
      ? `node ${step.argv.join(' ')}`
      : `${path.basename(step.file).replace(/\.cmd$/, '')} ${step.argv.join(' ')}`;
    for (const id of identifiers(text)) ids.add(id);
  }
  return ids;
}

function covers(ciId, pre) {
  if (pre.has(ciId)) return true;
  if (Object.prototype.hasOwnProperty.call(CI_ONLY, ciId)) return true;
  // npm:<script> est couvert si le preflight exécute le même script node.
  if (ciId.startsWith('npm')) {
    const name = ciId.split(':').slice(1).join(':');
    if (Object.prototype.hasOwnProperty.call(CI_ONLY, name)) return true;
  }
  return false;
}

describe('parité preflight ↔ CI', () => {
  const ciIds = new Set(runBlocks(WORKFLOW).flatMap(identifiers));
  const pre = preflightIdentifiers();

  test('la CI exécute bien des gates détectables (garde-fou du parseur)', () => {
    expect(ciIds.has('scripts/check-migration-immutability.js')).toBe(true);
    expect(ciIds.has('npm:security:360:check')).toBe(true);
    expect(ciIds.has('scripts/run-staged-related-tests.js')).toBe(true);
    expect(ciIds.has('tests/unit/catalog-certification.test.js')).toBe(true);
    expect(ciIds.has('public/boutique/scripts/check-zindex-contract.js')).toBe(true);
  });

  test('chaque commande CI est rejouée par le preflight ou déclarée CI_ONLY', () => {
    const missing = [...ciIds].filter(id => !covers(id, pre)).sort();
    expect(missing).toEqual([]);
  });

  test('CI_ONLY ne contient aucune exemption morte et chaque raison est écrite', () => {
    for (const [id, reason] of Object.entries(CI_ONLY)) {
      expect(typeof reason).toBe('string');
      expect(reason.length).toBeGreaterThan(20);
      const present = ciIds.has(id) || [...ciIds].some(ci => ci.endsWith(`:${id}`));
      expect({ id, present }).toEqual({ id, present: true });
    }
  });

  test('les projections exclues du contrôle d’arbre sont exactement celles restaurées par la CI', () => {
    const restored = [...WORKFLOW.matchAll(/git restore --source=HEAD --([\s\S]*?)(?:\n\s*-|\n\s*\n|$)/g)]
      .flatMap(m => m[1].match(/docs\/[\w./-]+/g) || []);
    expect([...new Set(restored)].sort()).toEqual([...CI_RESTORED_PROJECTIONS].sort());
  });
});
