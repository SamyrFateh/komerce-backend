/**
 * @komerce-arch
 * @role          agent-context-pack-projection
 * @domain        infrastructure
 * @layer         tooling
 * @criticality   medium
 * @inputs        feature manifests, docs/FEATURE_360.json, agent-context impact index, migrations/
 * @outputs       minimal context pack per change type (ui, authz, migration, service, route)
 * @depends       scripts/lib/agent-context-impact.js
 * @used-by       scripts/agent-context.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/AGENT_TOKEN_ECONOMY.md
 * @impact-areas  governance, developer-workflow
 * @version       2026-10-v1
 */
'use strict';

/**
 * `agent:context --pack <type> --feature <f>` : le contexte MINIMAL SUFFISANT
 * pour un type de changement, au lieu du maximum disponible. Sélection de
 * sections déjà générées (carte, FEATURE_360, projection d'impact) : aucune
 * nouvelle vérité. Règle anti-troncature : une liste n'est jamais coupée en
 * silence ; au-delà de sa limite, le pack donne le total et le moyen d'obtenir
 * la liste complète (--json).
 */

const impactLib = require('./agent-context-impact');

const PACK_TYPES = Object.freeze(['ui', 'authz', 'migration', 'service', 'route']);

const FILTERS = Object.freeze({
  ui: {
    invariants: /écran|ui\b|dashboard|boutique|affich|navigation|mock|canonical|vue\b/i,
    tests: /canonical|dashboard|boutique|\bui\b|-ui-|playwright|e2e/i,
  },
  authz: {
    invariants: /autoris|capabilit|scope|rôle|role|guard|garde|ceiling|plafond|central|délég|deleg|membership|permission/i,
    tests: /auth|security|scope|guard|capab|permission|isolation|authority|delegat|membership/i,
  },
  migration: {
    invariants: /table|append|trigger|contrainte|constraint|unique|\bfk\b|migration|sch[ée]ma|immuable|immutable|projection/i,
    tests: /integration|migration|schema|postgres|real-db/i,
  },
  service: { invariants: /./, tests: /./ },
  route: {
    invariants: /route|api|http|contrat|contract|endpoint|réponse|response/i,
    tests: /route|api|e2e|contract/i,
  },
});

function compact(value, max) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function statementOf(invariant) {
  return typeof invariant === 'string' ? invariant : (invariant && invariant.statement) || '';
}

function list(label, values, limit) {
  if (!values || !values.length) return null;
  const shown = values.slice(0, limit);
  const rest = values.length - shown.length;
  return `${label} (${values.length}):\n${shown.map(v => `  - ${v}`).join('\n')}${rest > 0 ? `\n  … ${rest} de plus : --json pour la liste complète` : ''}`;
}

function guardsFromSources(files, readSource) {
  const guards = new Set();
  for (const file of files) {
    if (!/^routes\//.test(file)) continue;
    const source = readSource(file) || '';
    for (const m of source.matchAll(/require\(\s*['"](?:\.\.\/)+middleware\/([\w-]+)(?:\.js)?['"]\s*\)/g)) guards.add(m[1]);
  }
  return Array.from(guards).sort();
}

function buildPack(type, entry, { index, feature360, migration = null, readSource = () => null } = {}) {
  if (!PACK_TYPES.includes(type)) {
    throw new Error(`--pack : type inconnu "${type}". Types : ${PACK_TYPES.join(', ')}`);
  }
  const card = entry.manifest || {};
  const f360 = ((feature360 && feature360.features) || []).find(f => f.id === card.name) || {};
  const impact = impactLib.featureImpact(index, entry, {});
  const owned = Array.from(entry.ownedFiles || []);
  const filter = FILTERS[type];
  const invariants = (Array.isArray(card.invariants) ? card.invariants : []).map(statementOf).filter(Boolean);
  const relevant = invariants.filter(s => filter.invariants.test(s));
  const tests = owned.filter(f => /^tests\//.test(f) && filter.tests.test(f));
  const pack = {
    pack: type,
    feature: card.name,
    owner: card.owner || null,
    card: entry.file,
    service: compact(card.service, 260),
    authority: typeof card.authority === 'string' ? compact(card.authority, 320) : null,
    invariants: relevant,
    otherInvariants: invariants.length - relevant.length,
    tests,
  };

  if (type === 'ui') {
    pack.uiFiles = owned.filter(f => /^public\//.test(f));
    pack.apiCalled = ((card.contract && card.contract.exposes) || []).slice();
    pack.perimeterOut = ((card.perimeter && card.perimeter.out) || []).map(v => compact(v, 160));
  }
  if (type === 'authz') {
    pack.security = card.security ? compact(card.security.note || card.security.status, 420) : null;
    pack.guards = Array.from(new Set([
      ...owned.filter(f => /^middleware\//.test(f)).map(f => f.replace(/^middleware\/|\.js$/g, '')),
      ...guardsFromSources(owned, readSource),
    ])).sort();
    pack.routes = impact.routes.map(r => `${r.key} [${r.level}${r.roles.length ? ` ${r.roles.join('/')}` : ''}]`);
    pack.perimeterOut = ((card.perimeter && card.perimeter.out) || []).map(v => compact(v, 160));
  }
  if (type === 'migration') {
    pack.tables = impact.tables.map(t => `${t.table} : ${t.writers.length} écrivain(s), ${t.readers.length} lecteur(s)${t.foreignWriters.length ? ` · hors feature : ${t.foreignWriters.join(', ')}` : ''}`);
    pack.cardTables = ((card.db && card.db.tables) || []).slice();
    pack.migrations = owned.filter(f => /^migrations\/.+\.sql$/.test(f)).sort().reverse();
    pack.migration = migration;
    pack.artifacts = impactLib.artifactsFor(['migrations/x.sql']);
  }
  if (type === 'service') {
    pack.internalApis = (((f360.interfaces || {}).internalApis) || []).map(a => `${a.fn} · ${a.file}`);
    pack.tables = impact.tables.map(t => `${t.table} : ${t.writers.length} écrivain(s)${t.foreignWriters.length ? ` · hors feature : ${t.foreignWriters.join(', ')}` : ''}`);
    pack.consumedBy = impact.consumedBy;
  }
  if (type === 'route') {
    pack.routes = impact.routes.map(r => `${r.key} [${r.level}${r.roles.length ? ` ${r.roles.join('/')}` : ''}]`);
    pack.contract = ((card.contract && card.contract.exposes) || []).slice();
    pack.guards = guardsFromSources(owned, readSource);
    pack.artifacts = impactLib.artifactsFor(owned.filter(f => /^routes\//.test(f)));
  }
  return pack;
}

function levelSummary(routes) {
  const levels = {};
  for (const r of routes) {
    const m = r.match(/\[(\S+)/);
    const level = m ? m[1].replace(/\]$/, '') : '?';
    levels[level] = (levels[level] || 0) + 1;
  }
  return Object.entries(levels).map(([k, v]) => `${k}=${v}`).join(' ');
}

function renderPack(pack) {
  const out = [];
  const push = value => { if (value) out.push(value); };
  push(`PACK ${pack.pack} · feature ${pack.feature} · owner=${pack.owner || '—'} · ${pack.card}`);
  push(pack.service && `service: ${pack.service}`);
  push(pack.authority && `autorité: ${pack.authority}`);
  push(pack.security && `sécurité: ${pack.security}`);
  push(list('fichiers UI', pack.uiFiles, 12));
  push(list('API appelées (contrat)', pack.apiCalled, 12));
  push(list('gardes', pack.guards, 12));
  push(pack.routes && pack.routes.length ? `routes (${pack.routes.length}) : ${levelSummary(pack.routes)}` : null);
  push(list('routes (échantillon)', pack.routes, 8));
  push(list('contrat exposé', pack.contract, 10));
  push(list('tables (écrivains/lecteurs)', pack.tables, 12));
  push(list('tables déclarées par la carte', pack.cardTables, 20));
  push(list('migrations de la feature (récentes d’abord)', pack.migrations, 8));
  if (pack.migration) {
    push(`prochain numéro de migration libre : ${pack.migration.next}`);
    for (const c of pack.migration.collisions) push(`COLLISION ${c.number}: ${c.branch.join(', ')} vs main ${c.main.join(', ')}`);
  }
  push(list('API internes', pack.internalApis, 20));
  push(list('consommée par', pack.consumedBy, 15));
  push(list('hors périmètre (ne pas toucher)', pack.perimeterOut, 10));
  push(list(`invariants pertinents (${pack.otherInvariants} autres : --pack service)`, pack.invariants, 25));
  push(list('tests de la feature pour ce type', pack.tests, 10));
  for (const a of pack.artifacts || []) push(`à régénérer et committer : ${a.command} — sinon ${a.gate}`);
  const body = out.join('\n');
  return `${body}\nbudget: ${body.length} chars ≈ ${Math.ceil(body.length / 4)} tokens`;
}

module.exports = { FILTERS, PACK_TYPES, buildPack, guardsFromSources, renderPack };
