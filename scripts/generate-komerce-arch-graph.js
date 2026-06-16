'use strict';

/**
 * Generates a machine-readable and human-readable graph from @komerce-arch headers.
 *
 * Source of truth: file headers.
 * Output: docs/komerce-arch-header-graph.json and docs/KOMERCE_ARCH_HEADER_GRAPH.md.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');

const SCAN_ROOTS = [
  'server.js',
  'bootstrap',
  'routes',
  'services',
  'middleware',
  'utils',
  'public/boutique/js'
];

const EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.cache', '.next']);

const FIELD_RE = /^ \* @(\S+)\s*(.*)$/;

function walk(relativePath, out) {
  const full = path.join(ROOT, relativePath);
  if (!fs.existsSync(full)) return;
  const stat = fs.statSync(full);
  if (stat.isFile()) {
    if (EXTENSIONS.has(path.extname(full))) out.push(relativePath.replace(/\\/g, '/'));
    return;
  }
  if (!stat.isDirectory()) return;
  for (const entry of fs.readdirSync(full)) {
    if (IGNORE_DIRS.has(entry)) continue;
    walk(path.join(relativePath, entry), out);
  }
}

function parseHeader(src) {
  const start = src.indexOf('/**');
  if (start !== 0) return null;
  const end = src.indexOf('*/', start);
  if (end < 0) return null;
  const block = src.slice(start, end + 2);
  if (!block.includes('@komerce-arch')) return null;

  const fields = {};
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(FIELD_RE);
    if (!m) continue;
    const key = m[1];
    const value = m[2].trim();
    fields[key] = value;
  }
  return fields;
}

function splitList(value) {
  if (!value || value === 'none') return [];
  return value
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)
    .filter(x => x !== '@unknown');
}

function normalizeTarget(target) {
  return target
    .replace(/^`|`$/g, '')
    .replace(/^\.\//, '')
    .trim();
}

function edgeId(edge) {
  return [edge.from, edge.to, edge.type, edge.label || ''].join('::');
}

function main() {
  const files = [];
  for (const root of SCAN_ROOTS) walk(root, files);
  files.sort();

  const nodes = [];
  const rawEdges = [];
  const roleToFile = new Map();
  const fileSet = new Set(files);

  for (const file of files) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const fields = parseHeader(src);
    if (!fields) continue;

    const node = {
      id: file,
      file,
      role: fields.role || null,
      domain: fields.domain || null,
      layer: fields.layer || null,
      criticality: fields.criticality || null,
      inputs: splitList(fields.inputs),
      outputs: splitList(fields.outputs),
      depends: splitList(fields.depends).map(normalizeTarget),
      usedBy: splitList(fields['used-by']).map(normalizeTarget),
      dbRead: splitList(fields['db-read']),
      dbWrite: splitList(fields['db-write']),
      dbTxn: splitList(fields['db-txn']),
      doctrine: splitList(fields.doctrine),
      impactAreas: splitList(fields['impact-areas']),
      version: fields.version || null
    };
    nodes.push(node);
    if (node.role) roleToFile.set(node.role, file);
  }

  const nodeIds = new Set(nodes.map(n => n.id));
  const tableNodes = new Map();
  const doctrineNodes = new Map();
  const impactNodes = new Map();

  function addTableNode(table) {
    const id = `db:${table}`;
    if (!tableNodes.has(id)) tableNodes.set(id, { id, type: 'db-table', table });
    return id;
  }

  function addDoctrineNode(doctrine) {
    const id = `doctrine:${doctrine}`;
    if (!doctrineNodes.has(id)) doctrineNodes.set(id, { id, type: 'doctrine', doctrine });
    return id;
  }

  function addImpactNode(area) {
    const id = `impact:${area}`;
    if (!impactNodes.has(id)) impactNodes.set(id, { id, type: 'impact-area', area });
    return id;
  }

  function resolveCodeTarget(target) {
    if (nodeIds.has(target)) return target;
    if (fileSet.has(target)) return target;
    if (roleToFile.has(target)) return roleToFile.get(target);
    if (target.startsWith('public/boutique/js/') && nodeIds.has(target)) return target;
    if (!target.includes('/') && !target.endsWith('.js')) return roleToFile.get(target) || target;
    return target;
  }

  for (const node of nodes) {
    for (const dep of node.depends) {
      rawEdges.push({ from: node.id, to: resolveCodeTarget(dep), type: 'depends', label: dep });
    }
    for (const consumer of node.usedBy) {
      rawEdges.push({ from: resolveCodeTarget(consumer), to: node.id, type: 'uses', label: consumer });
    }
    for (const table of node.dbRead) {
      rawEdges.push({ from: node.id, to: addTableNode(table), type: 'db-read', label: table });
    }
    for (const table of node.dbWrite) {
      rawEdges.push({ from: node.id, to: addTableNode(table), type: 'db-write', label: table });
    }
    for (const doctrine of node.doctrine) {
      rawEdges.push({ from: node.id, to: addDoctrineNode(doctrine), type: 'doctrine', label: doctrine });
    }
    for (const area of node.impactAreas) {
      rawEdges.push({ from: node.id, to: addImpactNode(area), type: 'impact', label: area });
    }
  }

  const seen = new Set();
  const edges = [];
  for (const edge of rawEdges) {
    if (!edge.from || !edge.to) continue;
    const id = edgeId(edge);
    if (seen.has(id)) continue;
    seen.add(id);
    edges.push(edge);
  }

  const allNodes = [
    ...nodes.map(n => ({ ...n, type: 'file' })),
    ...tableNodes.values(),
    ...doctrineNodes.values(),
    ...impactNodes.values()
  ];

  const byDomain = nodes.reduce((acc, node) => {
    const key = node.domain || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const byCriticality = nodes.reduce((acc, node) => {
    const key = node.criticality || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const unresolvedEdges = edges.filter(edge => {
    if (edge.to.startsWith('db:') || edge.to.startsWith('doctrine:') || edge.to.startsWith('impact:')) return false;
    if (edge.from.startsWith('db:') || edge.from.startsWith('doctrine:') || edge.from.startsWith('impact:')) return false;
    return !nodeIds.has(edge.to) || !nodeIds.has(edge.from);
  });

  const graph = {
    version: '2026-06',
    generatedAt: new Date().toISOString(),
    source: '@komerce-arch headers',
    totals: {
      filesWithHeaders: nodes.length,
      graphNodes: allNodes.length,
      edges: edges.length,
      dbTables: tableNodes.size,
      doctrines: doctrineNodes.size,
      impactAreas: impactNodes.size,
      unresolvedCodeEdges: unresolvedEdges.length
    },
    byDomain,
    byCriticality,
    nodes: allNodes,
    edges,
    unresolvedCodeEdges: unresolvedEdges
  };

  fs.mkdirSync(DOCS, { recursive: true });
  fs.writeFileSync(path.join(DOCS, 'komerce-arch-header-graph.json'), JSON.stringify(graph, null, 2) + '\n');

  const md = [];
  md.push('# Komerce Architecture Header Graph');
  md.push('');
  md.push(`Generated: ${graph.generatedAt}`);
  md.push('');
  md.push('This graph is generated from `@komerce-arch` headers. Do not edit it by hand; update headers, then regenerate.');
  md.push('');
  md.push('## Totals');
  md.push('');
  md.push(`- Files with headers: ${graph.totals.filesWithHeaders}`);
  md.push(`- Graph nodes: ${graph.totals.graphNodes}`);
  md.push(`- Edges: ${graph.totals.edges}`);
  md.push(`- DB tables: ${graph.totals.dbTables}`);
  md.push(`- Doctrines: ${graph.totals.doctrines}`);
  md.push(`- Impact areas: ${graph.totals.impactAreas}`);
  md.push(`- Unresolved code edges: ${graph.totals.unresolvedCodeEdges}`);
  md.push('');
  md.push('## Domains');
  md.push('');
  for (const [domain, count] of Object.entries(byDomain).sort()) md.push(`- ${domain}: ${count}`);
  md.push('');
  md.push('## Critical Files');
  md.push('');
  for (const node of nodes.filter(n => n.criticality === 'critical').sort((a, b) => a.file.localeCompare(b.file))) {
    md.push(`- ${node.file} — ${node.role || 'no-role'} (${node.domain || 'unknown'})`);
  }
  md.push('');
  md.push('## DB Touchpoint Edges');
  md.push('');
  for (const edge of edges.filter(e => e.type === 'db-write').slice(0, 80)) {
    md.push(`- WRITE ${edge.from} -> ${edge.label}`);
  }
  md.push('');
  md.push('## Unresolved Code Edges');
  md.push('');
  if (!unresolvedEdges.length) {
    md.push('- none');
  } else {
    for (const edge of unresolvedEdges.slice(0, 80)) {
      md.push(`- ${edge.type}: ${edge.from} -> ${edge.to} (${edge.label})`);
    }
  }
  md.push('');
  md.push('## Maintenance Rule');
  md.push('');
  md.push('When a file header changes, regenerate this graph. When a file starts reading/writing DB tables, update `@db-read`, `@db-write`, and `@db-txn` first.');
  md.push('');

  fs.writeFileSync(path.join(DOCS, 'KOMERCE_ARCH_HEADER_GRAPH.md'), md.join('\n'));

  console.log(`Generated graph: ${graph.totals.filesWithHeaders} files, ${graph.totals.edges} edges`);
}

main();
