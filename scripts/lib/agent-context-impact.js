/**
 * @komerce-arch
 * @role          agent-context-impact-projection
 * @domain        infrastructure
 * @layer         tooling
 * @criticality   medium
 * @inputs        docs/komerce-arch-header-graph.json, docs/_generated/route-registry.json, docs/SECURITY_360.json, docs/FEATURE_360.json, feature manifests, migrations/
 * @outputs       compact change-impact projection for agents (writers, readers, tables, routes, consumers, tests, artifacts)
 * @depends       scripts/agent-context.js
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
 * `agent:context --impact <fichier|feature>` : la portée d'un changement en un
 * appel, AVANT de coder. Pure projection des sources canoniques déjà générées et
 * contrôlées par la CI (graphe des headers, registre de routes, SECURITY_360,
 * FEATURE_360, cartes) : aucune nouvelle vérité.
 *
 * Seule déclaration propre à ce module : ARTIFACT_RULES, les artefacts dérivés
 * que la CI exige COMMITTÉS selon le type de fichier touché (chaque règle cite
 * la gate qui échoue sinon ; le test vérifie que la commande existe).
 */

const path = require('path');

const ARTIFACT_RULES = Object.freeze([
  {
    id: 'security-360',
    applies: file => /^routes\//.test(file) || file === 'bootstrap/api-routes.js' || file === 'server.js',
    command: 'npm run security:360',
    gate: 'security:360:check (SECURITY_360.json et .md committés)',
  },
  {
    id: 'api-contract',
    applies: file => /^routes\//.test(file),
    command: 'npm run contract:generate',
    gate: 'contract-check (docs/contract/openapi.json et DEBT.md committés ; variables factices de la CI requises)',
  },
  {
    id: 'schema-intent',
    applies: file => /^migrations\/.+\.sql$/.test(file),
    command: 'bloc <!-- schema-pending --> dans docs/SCHEMA.md pour toute table créée',
    gate: 'check-schema-intent-doc (job migrations)',
  },
]);

function norm(file) {
  return String(file || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function securityKey(method, fullPath) {
  return `${String(method || '').toUpperCase()} ${String(fullPath || '').replace(/:(\w+)/g, '{$1}')}`;
}

function indexSources({ graph, routes, security, feature360 }) {
  const writers = new Map();
  const readers = new Map();
  for (const edge of (graph && graph.edges) || []) {
    if (!String(edge.to || '').startsWith('db:')) continue;
    const table = edge.to.slice(3);
    const bucket = edge.type === 'db-read' ? readers : (edge.type === 'db-write' || edge.type === 'db-write-via' ? writers : null);
    if (!bucket) continue;
    if (!bucket.has(table)) bucket.set(table, new Set());
    bucket.get(table).add(edge.type === 'db-write-via' && edge.via ? `${edge.from} (via ${edge.via})` : edge.from);
  }
  const security360 = new Map(((security && security.routes) || []).map(r => [r.key, r]));
  const routesByFile = new Map();
  for (const route of (routes && routes.routes) || []) {
    const file = norm(route.routeFile);
    if (!routesByFile.has(file)) routesByFile.set(file, []);
    const sec = security360.get(securityKey(route.method, route.fullPath));
    routesByFile.get(file).push({
      key: securityKey(route.method, route.fullPath),
      level: sec ? sec.level : 'NON CLASSÉE',
      roles: sec && Array.isArray(sec.roles) ? sec.roles : [],
    });
  }
  const features = new Map();
  for (const f of (feature360 && feature360.features) || []) features.set(f.id, f);
  return {
    writers,
    readers,
    routesByFile,
    intervention: (graph && graph.interventionIndex) || {},
    multiWriter: new Map(((graph && graph.multiWriterTables) || []).map(t => [t.table, t.writerCount])),
    features,
  };
}

function tableImpact(index, table) {
  return {
    table,
    writers: Array.from(index.writers.get(table) || []).sort(),
    readers: Array.from(index.readers.get(table) || []).sort(),
    multiWriter: index.multiWriter.get(table) || 0,
  };
}

function artifactsFor(files) {
  return ARTIFACT_RULES.filter(rule => files.some(file => rule.applies(norm(file))))
    .map(({ id, command, gate }) => ({ id, command, gate }));
}

function migrationNumbers(names) {
  const numbers = new Map();
  for (const name of names) {
    const m = path.basename(norm(name)).match(/^(\d{3,})_/);
    if (!m) continue;
    const n = Number(m[1]);
    if (!numbers.has(n)) numbers.set(n, []);
    numbers.get(n).push(path.basename(name));
  }
  return numbers;
}

// Prochain numéro libre au regard de origin/main ET des migrations locales, plus
// les numéros de la branche déjà pris sur main par un autre fichier (collision).
function migrationStatus({ mainFiles = [], localFiles = [] }) {
  const main = migrationNumbers(mainFiles);
  const local = migrationNumbers(localFiles);
  const all = [...main.keys(), ...local.keys()];
  const next = (all.length ? Math.max(...all) : 0) + 1;
  const collisions = [];
  for (const [n, files] of local) {
    // Après un merge de main, la branche contient AUSSI le fichier de main :
    // collision dès qu'un fichier N est propre à la branche alors que main a déjà N.
    const onMain = main.get(n) || [];
    const localOnly = files.filter(f => !onMain.includes(f));
    if (onMain.length && localOnly.length) collisions.push({ number: n, branch: localOnly, main: onMain });
  }
  return { next: String(next).padStart(3, '0'), collisions };
}

function fileImpact(index, file, extra = {}) {
  const target = norm(file);
  const iv = index.intervention[target] || {};
  // dbWriteVia = [{ via, tables: [...] }] : écriture indirecte par un service.
  const viaTables = (iv.dbWriteVia || []).flatMap(v => (typeof v === 'string' ? [v] : (v && v.tables) || []));
  const written = unique([...(iv.dbWrite || []), ...viaTables]);
  const usedBy = (iv.directUsedBy || []).map(norm);
  const ownRoutes = index.routesByFile.get(target) || [];
  const exposedVia = usedBy.filter(f => index.routesByFile.has(f))
    .map(f => ({ file: f, routes: index.routesByFile.get(f) }));
  return {
    kind: 'file',
    target,
    feature: extra.feature || null,
    role: iv.role || null,
    tablesWritten: written.map(t => tableImpact(index, t)),
    tablesRead: (iv.dbRead || []).slice().sort(),
    dependsOn: (iv.directDependsOn || []).slice().sort(),
    usedBy: usedBy.sort(),
    routes: ownRoutes,
    exposedVia,
    mustCheck: iv.mustCheck || [],
    tests: extra.tests || null,
    artifacts: artifactsFor([target]),
    migration: extra.migration || null,
  };
}

function featureImpact(index, entry, extra = {}) {
  const name = entry.manifest.name;
  const f360 = index.features.get(name) || {};
  const owned = Array.from(entry.ownedFiles || []).map(norm);
  const ownedSet = new Set(owned);
  const tables = (((f360.ownership || {}).ownsTables) || []).map(t => t.table).filter(Boolean).sort();
  const tableRows = tables.map(t => {
    const row = tableImpact(index, t);
    row.foreignWriters = row.writers.filter(w => !ownedSet.has(w.replace(/ \(via .*\)$/, '')));
    return row;
  });
  const routes = owned.filter(f => index.routesByFile.has(f)).flatMap(f => index.routesByFile.get(f));
  const invariants = Array.isArray(f360.invariants) ? f360.invariants : [];
  const tests = owned.filter(f => /^tests\//.test(f));
  return {
    kind: 'feature',
    target: name,
    owner: entry.manifest.owner || null,
    card: entry.file,
    files: owned.length,
    tables: tableRows,
    routes,
    consumedBy: unique(((f360.consumedBy) || []).map(c => c.consumer)).sort(),
    dependsOnFeatures: unique(((f360.businessDependencies) || []).map(d => d.provider)).sort(),
    invariants: { total: invariants.length, tested: invariants.filter(i => i && (i.test || (i.tests && i.tests.length))).length },
    tests,
    artifacts: artifactsFor(owned),
    migration: extra.migration || null,
  };
}

function listLine(label, values, limit) {
  if (!values.length) return null;
  const shown = values.slice(0, limit);
  const more = values.length > limit ? ` (+${values.length - limit} : --json pour la liste complète)` : '';
  return `${label} (${values.length}): ${shown.join(', ')}${more}`;
}

function routeSummary(routes) {
  const levels = {};
  for (const r of routes) levels[r.level] = (levels[r.level] || 0) + 1;
  return Object.entries(levels).map(([k, v]) => `${k}=${v}`).join(' ');
}

function renderImpact(impact) {
  const lines = [];
  const push = line => { if (line) lines.push(line); };
  if (impact.kind === 'file') {
    push(`IMPACT ${impact.target}${impact.feature ? ` · feature ${impact.feature}` : ''}${impact.role ? ` · ${impact.role}` : ''}`);
    for (const t of impact.tablesWritten) {
      push(`écrit ${t.table}: écrivains ${t.writers.length}${t.multiWriter > 1 ? ' (multi-écrivain)' : ''}, lecteurs ${t.readers.length}`);
      push(listLine('  autres écrivains', t.writers.filter(w => !w.startsWith(impact.target)), 6));
      push(listLine('  lecteurs', t.readers, 6));
    }
    push(listLine('lit', impact.tablesRead, 10));
    push(listLine('consommateurs directs (à revérifier)', impact.usedBy, 8));
    if (impact.routes.length) {
      push(`routes déclarées (${impact.routes.length}) ${routeSummary(impact.routes)}`);
      push(listLine('  routes', impact.routes.map(r => `${r.key} [${r.level}${r.roles.length ? ` ${r.roles.join('/')}` : ''}]`), 8));
    }
    for (const via of impact.exposedVia) {
      push(`exposé via ${via.file}: ${via.routes.length} route(s) ${routeSummary(via.routes)}`);
    }
    push(listLine('mustCheck', impact.mustCheck, 8));
  } else {
    push(`IMPACT feature ${impact.target} · owner=${impact.owner || '—'} · ${impact.card} · ${impact.files} fichiers`);
    for (const t of impact.tables) {
      push(`table ${t.table}: écrivains ${t.writers.length}, lecteurs ${t.readers.length}${t.foreignWriters.length ? ` · ÉCRIVAINS HORS FEATURE ${t.foreignWriters.length}` : ''}`);
      push(listLine('  écrivains hors feature', t.foreignWriters, 6));
    }
    if (impact.routes.length) push(`routes (${impact.routes.length}) ${routeSummary(impact.routes)}`);
    push(listLine('consommée par', impact.consumedBy, 12));
    push(listLine('dépend de', impact.dependsOnFeatures, 12));
    push(`invariants: ${impact.invariants.total} dont ${impact.invariants.tested} vérifiés par un test`);
    push(listLine('tests déclarés', impact.tests, 6));
  }
  if (impact.tests && impact.kind === 'file') {
    push(impact.tests.full
      ? 'tests: migration ou schéma touché → suite unitaire backend complète (comme le preflight)'
      : listLine('tests liés', impact.tests.list || [], 10) || 'tests liés: aucun trouvé');
  }
  for (const a of impact.artifacts) push(`à régénérer et committer: ${a.command} — sinon ${a.gate}`);
  if (impact.migration) {
    push(`migration: prochain numéro libre ${impact.migration.next}`);
    for (const c of impact.migration.collisions) {
      push(`  COLLISION ${c.number}: ${c.branch.join(', ')} vs main ${c.main.join(', ')}`);
    }
  }
  const body = lines.join('\n');
  return `${body}\nbudget: ${body.length} chars ≈ ${Math.ceil(body.length / 4)} tokens`;
}

module.exports = {
  ARTIFACT_RULES,
  artifactsFor,
  featureImpact,
  fileImpact,
  indexSources,
  migrationStatus,
  renderImpact,
  securityKey,
};
