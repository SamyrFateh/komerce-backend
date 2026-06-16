'use strict';

/**
 * Generates a machine-readable and human-readable graph from @komerce-arch headers.
 *
 * Source of truth: file headers.
 * Outputs:
 * - docs/komerce-arch-header-graph.json
 * - docs/KOMERCE_ARCH_HEADER_GRAPH.md
 *
 * This script is intentionally dependency-free so it can run in GitHub Actions
 * without installing the application packages.
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
const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  '.cache',
  '.next',
  'tmp',
  'temp'
]);

const FIELD_RE = /^\s*\*\s+@(\S+)\s*(.*)$/;
const ARCH_MARKER = '@komerce-arch';

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
  const firstMeaningful = src.replace(/^\uFEFF/, '').trimStart();
  const start = firstMeaningful.indexOf('/**');
  if (start !== 0) return null;

  const end = firstMeaningful.indexOf('*/', start);
  if (end < 0) return null;

  const block = firstMeaningful.slice(start, end + 2);
  if (!block.includes(ARCH_MARKER)) return null;

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
  if (!value) return [];
  const clean = String(value).trim();
  if (!clean || clean === 'none' || clean === 'n/a') return [];

  return clean
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)
    .filter(x => x !== '@unknown')
    .map(normalizeTarget);
}

function normalizeTarget(target) {
  return String(target)
    .replace(/^`|`$/g, '')
    .replace(/^\.\//, '')
    .trim();
}

function edgeId(edge) {
  return [edge.from, edge.to, edge.type, edge.label || ''].join('::');
}

function groupCount(items, keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item) || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function pushSortedList(md, title, rows, empty = '- none') {
  md.push(`## ${title}`);
  md.push('');
  if (!rows.length) {
    md.push(empty);
  } else {
    for (const row of rows) md.push(row);
  }
  md.push('');
}

function main() {
  const files = [];
  for (const root of SCAN_ROOTS) walk(root, files);
  files.sort();

  const nodes = [];
  const rawEdges = [];
  const roleToFile = new Map();
  const fileSet = new Set(files);
  const filesWithoutHeaders = [];

  for (const file of files) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const fields = parseHeader(src);
    if (!fields) {
      filesWithoutHeaders.push(file);
      continue;
    }

    const node = {
      id: file,
      file,
      role: fields.role || null,
      domain: fields.domain || null,
      layer: fields.layer || null,
      criticality: fields.criticality || null,
      inputs: splitList(fields.inputs),
      outputs: splitList(fields.outputs),
      depends: splitList(fields.depends),
      usedBy: splitList(fields['used-by']),
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

    if (!target.includes('/') && !target.endsWith('.js')) {
      return roleToFile.get(target) || target;
    }

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

  const graphNodeIds = new Set(allNodes.map(n => n.id));
  const unresolvedCodeEdges = edges.filter(edge => {
    if (edge.to.startsWith('db:') || edge.to.startsWith('doctrine:') || edge.to.startsWith('impact:')) return false;
    if (edge.from.startsWith('db:') || edge.from.startsWith('doctrine:') || edge.from.startsWith('impact:')) return false;
    return !graphNodeIds.has(edge.to) || !graphNodeIds.has(edge.from);
  });

  const interventionIndex = {};
  for (const node of nodes) {
    const adjacent = edges.filter(edge => edge.from === node.id || edge.to === node.id);
    interventionIndex[node.id] = {
      role: node.role,
      domain: node.domain,
      criticality: node.criticality,
      directDependsOn: adjacent.filter(e => e.from === node.id && e.type === 'depends').map(e => e.to),
      directUsedBy: adjacent.filter(e => e.to === node.id && e.type === 'uses').map(e => e.from),
      dbRead: node.dbRead,
      dbWrite: node.dbWrite,
      doctrines: node.doctrine,
      impactAreas: node.impactAreas,
      mustCheck: Array.from(new Set([
        ...adjacent
          .filter(e => ['depends', 'uses'].includes(e.type))
          .map(e => (e.from === node.id ? e.to : e.from))
          .filter(id => graphNodeIds.has(id)),
        ...node.impactAreas.map(area => `impact:${area}`),
        ...node.doctrine.map(doc => `doctrine:${doc}`),
        ...node.dbRead.map(table => `db:${table}`),
        ...node.dbWrite.map(table => `db:${table}`)
      ])).sort()
    };
  }

  const graph = {
    version: '2026-06',
    generatedAt: new Date().toISOString(),
    source: '@komerce-arch headers',
    scanRoots: SCAN_ROOTS,
    totals: {
      scannedCodeFiles: files.length,
      filesWithHeaders: nodes.length,
      filesWithoutHeaders: filesWithoutHeaders.length,
      graphNodes: allNodes.length,
      edges: edges.length,
      dbTables: tableNodes.size,
      doctrines: doctrineNodes.size,
      impactAreas: impactNodes.size,
      unresolvedCodeEdges: unresolvedCodeEdges.length
    },
    byDomain: groupCount(nodes, n => n.domain),
    byLayer: groupCount(nodes, n => n.layer),
    byCriticality: groupCount(nodes, n => n.criticality),
    nodes: allNodes,
    edges,
    interventionIndex,
    unresolvedCodeEdges,
    filesWithoutHeaders
  };

  fs.mkdirSync(DOCS, { recursive: true });
  fs.writeFileSync(path.join(DOCS, 'komerce-arch-header-graph.json'), JSON.stringify(graph, null, 2) + '\n');

  const criticalFiles = nodes
    .filter(n => ['critical', 'high'].includes(n.criticality))
    .sort((a, b) => (a.criticality === b.criticality ? a.file.localeCompare(b.file) : a.criticality.localeCompare(b.criticality)))
    .map(n => `- ${n.file} — ${n.role || 'no-role'} (${n.domain || 'unknown'}, ${n.criticality || 'unknown'})`);

  const dbWrites = edges
    .filter(e => e.type === 'db-write')
    .sort((a, b) => `${a.label}${a.from}`.localeCompare(`${b.label}${b.from}`))
    .slice(0, 120)
    .map(e => `- WRITE ${e.from} -> ${e.label}`);

  const unresolvedRows = unresolvedCodeEdges
    .sort((a, b) => `${a.from}${a.to}${a.type}`.localeCompare(`${b.from}${b.to}${b.type}`))
    .slice(0, 120)
    .map(e => `- ${e.type}: ${e.from} -> ${e.to} (${e.label})`);

  const uncoveredRows = filesWithoutHeaders
    .slice(0, 160)
    .map(file => `- ${file}`);

  const md = [];
  md.push('# Komerce Architecture Header Graph');
  md.push('');
  md.push(`Generated: ${graph.generatedAt}`);
  md.push('');
  md.push('This graph is generated from `@komerce-arch` headers. Do not edit it by hand; update headers, then regenerate.');
  md.push('');
  md.push('## Totals');
  md.push('');
  md.push(`- Scanned code files: ${graph.totals.scannedCodeFiles}`);
  md.push(`- Files with headers: ${graph.totals.filesWithHeaders}`);
  md.push(`- Files without headers: ${graph.totals.filesWithoutHeaders}`);
  md.push(`- Graph nodes: ${graph.totals.graphNodes}`);
  md.push(`- Edges: ${graph.totals.edges}`);
  md.push(`- DB tables: ${graph.totals.dbTables}`);
  md.push(`- Doctrines: ${graph.totals.doctrines}`);
  md.push(`- Impact areas: ${graph.totals.impactAreas}`);
  md.push(`- Unresolved code edges: ${graph.totals.unresolvedCodeEdges}`);
  md.push('');

  pushSortedList(md, 'Domains', Object.entries(graph.byDomain).sort().map(([domain, count]) => `- ${domain}: ${count}`));
  pushSortedList(md, 'Layers', Object.entries(graph.byLayer).sort().map(([layer, count]) => `- ${layer}: ${count}`));
  pushSortedList(md, 'Critical And High Files', criticalFiles);
  pushSortedList(md, 'DB Write Edges', dbWrites);
  pushSortedList(md, 'Unresolved Code Edges', unresolvedRows);
  pushSortedList(md, 'Files Still Without Headers', uncoveredRows);

  md.push('## Intervention Rule');
  md.push('');
  md.push('Before modifying a structural file, open `docs/komerce-arch-header-graph.json`, read `interventionIndex["<file>"]`, then check every `mustCheck` target before editing.');
  md.push('');
  md.push('When a file starts reading/writing DB tables, update `@db-read`, `@db-write`, and `@db-txn` before regenerating this graph.');
  md.push('');

  fs.writeFileSync(path.join(DOCS, 'KOMERCE_ARCH_HEADER_GRAPH.md'), md.join('\n'));

  console.log(`Generated graph: ${graph.totals.filesWithHeaders} files, ${graph.totals.edges} edges, ${graph.totals.unresolvedCodeEdges} unresolved code edges`);
}

main();
