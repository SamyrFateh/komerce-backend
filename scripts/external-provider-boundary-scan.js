#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          external-provider-boundary-scan
 * @domain        external-provider-contracts
 * @layer         script
 * @criticality   medium
 * @inputs        repository source tree, governance/external-provider-registry.json
 * @outputs       read-only external boundary inventory report
 * @depends       node:fs, node:path
 * @used-by       operator audit, external-provider-contracts L2
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md
 * @impact-areas  external-provider-contracts, governance, provider-audit
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_REGISTRY = path.join(ROOT, 'governance', 'external-provider-registry.json');
const DEFAULT_SCAN_DIRS = ['services', 'routes', 'utils', 'bootstrap', 'scripts'];
const EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function walk(absDir, relDir, out = []) {
  if (!fs.existsSync(absDir)) return out;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const abs = path.join(absDir, entry.name);
    const rel = path.join(relDir, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) walk(abs, rel, out);
    else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) out.push(rel);
  }
  return out;
}

function extractHosts(source) {
  const hosts = new Set();
  const re = /https:\/\/([a-z0-9.-]+)/ig;
  let match;
  while ((match = re.exec(String(source || ''))) !== null) {
    hosts.add(match[1].toLowerCase());
  }
  return [...hosts].sort();
}

function readDomain(source) {
  const match = String(source || '').slice(0, 2500).match(/@domain\s+([^\s\n*]+)/);
  return match ? match[1].trim() : null;
}

function scopeForFile(rel) {
  if (rel.startsWith('scripts/')) return 'tooling';
  if (rel.startsWith('tests/')) return 'test';
  return 'runtime';
}

function hostMatchesPattern(host, pattern) {
  const h = String(host || '').toLowerCase();
  const p = String(pattern || '').toLowerCase();
  if (!h || !p) return false;
  if (p.startsWith('*.')) {
    const suffix = p.slice(2);
    return h === suffix || h.endsWith('.' + suffix);
  }
  return h === p;
}

function providerEvidence(provider, source, hosts) {
  const hostMatches = hosts.filter(host =>
    (provider.hosts || []).some(pattern => hostMatchesPattern(host, pattern))
  );
  const markerMatches = (provider.markers || []).filter(marker =>
    String(source || '').includes(marker)
  );
  if (!hostMatches.length && !markerMatches.length) return null;

  const lower = String(source || '').toLowerCase();
  const outbound = /\bfetch\s*\(|\brequire\(['"]stripe['"]\)|\.paymentintents\.|requesttopay/.test(lower);
  const inbound = /webhook/.test(lower);

  return {
    host_matches: hostMatches,
    marker_matches: markerMatches,
    outbound,
    inbound,
  };
}

function ignoredHost(host, registry) {
  return (registry.ignore_hosts || []).some(pattern => hostMatchesPattern(host, pattern));
}

function scanRepository(options = {}) {
  const root = options.root || ROOT;
  const registryPath = options.registryPath || DEFAULT_REGISTRY;
  const scanDirs = options.scanDirs || DEFAULT_SCAN_DIRS;
  const reg = options.registry || readJson(registryPath);
  const providers = Array.isArray(reg.providers) ? reg.providers : [];
  const ids = providers.map(p => p.id);
  if (new Set(ids).size !== ids.length) throw new Error('EXTERNAL_PROVIDER_REGISTRY_DUPLICATE_ID');

  const providerMap = new Map(providers.map(provider => [provider.id, {
    id: provider.id,
    family: provider.family,
    expected_scope: provider.expected_scope,
    configured_consumers: provider.consumers || [],
    analysis_document: provider.analysis_document || null,
    analysis_document_exists: provider.analysis_document
      ? fs.existsSync(path.join(root, provider.analysis_document))
      : false,
    highest_proof: provider.highest_proof || 'UNQUALIFIED',
    files: new Set(),
    domains: new Set(),
    scopes: new Set(),
    host_matches: new Set(),
    marker_matches: new Set(),
    outbound_files: new Set(),
    inbound_files: new Set(),
  }]));

  const files = [];
  for (const dir of scanDirs) {
    walk(path.join(root, dir), dir, files);
  }

  const unknownHosts = new Map();

  for (const rel of files.sort()) {
    const abs = path.join(root, rel);
    const source = fs.readFileSync(abs, 'utf8');
    const hosts = extractHosts(source);
    const domain = readDomain(source);
    const scope = scopeForFile(rel);
    const matchedHosts = new Set();

    for (const provider of providers) {
      const evidence = providerEvidence(provider, source, hosts);
      if (!evidence) continue;
      const row = providerMap.get(provider.id);
      row.files.add(rel);
      if (domain) row.domains.add(domain);
      row.scopes.add(scope);
      evidence.host_matches.forEach(v => {
        row.host_matches.add(v);
        matchedHosts.add(v);
      });
      evidence.marker_matches.forEach(v => row.marker_matches.add(v));
      if (evidence.outbound) row.outbound_files.add(rel);
      if (evidence.inbound) row.inbound_files.add(rel);
    }

    for (const host of hosts) {
      if (matchedHosts.has(host) || ignoredHost(host, reg)) continue;
      if (!unknownHosts.has(host)) unknownHosts.set(host, new Set());
      unknownHosts.get(host).add(rel);
    }
  }

  const observed = [...providerMap.values()]
    .filter(row => row.files.size > 0)
    .map(row => ({
      id: row.id,
      family: row.family,
      expected_scope: row.expected_scope,
      configured_consumers: row.configured_consumers,
      observed_domains: [...row.domains].sort(),
      observed_scopes: [...row.scopes].sort(),
      analysis_document: row.analysis_document,
      analysis_document_exists: row.analysis_document_exists,
      highest_proof: row.highest_proof,
      files: [...row.files].sort(),
      host_matches: [...row.host_matches].sort(),
      marker_matches: [...row.marker_matches].sort(),
      outbound_files: [...row.outbound_files].sort(),
      inbound_files: [...row.inbound_files].sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const registeredButUnobserved = providers
    .filter(provider => !providerMap.get(provider.id).files.size)
    .map(provider => ({
      id: provider.id,
      family: provider.family,
      expected_scope: provider.expected_scope,
      highest_proof: provider.highest_proof || 'UNQUALIFIED',
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const unknown_hosts = [...unknownHosts.entries()]
    .map(([host, hostFiles]) => ({ host, files: [...hostFiles].sort() }))
    .sort((a, b) => a.host.localeCompare(b.host));

  return {
    schema_version: reg.schema_version || 1,
    scanned_files: files.length,
    observed_providers: observed,
    registered_but_unobserved: registeredButUnobserved,
    unknown_hosts,
  };
}

function textReport(report) {
  const lines = [];
  lines.push('External Provider Boundary Scan');
  lines.push('scanned_files=' + report.scanned_files);
  lines.push('observed_providers=' + report.observed_providers.length);
  lines.push('registered_but_unobserved=' + report.registered_but_unobserved.length);
  lines.push('unknown_hosts=' + report.unknown_hosts.length);
  lines.push('');
  for (const provider of report.observed_providers) {
    lines.push(
      provider.id + ' [' + provider.family + '] scopes=' +
      (provider.observed_scopes.join(',') || '-') + ' domains=' +
      (provider.observed_domains.join(',') || '-') + ' proof=' + provider.highest_proof
    );
  }
  if (report.unknown_hosts.length) {
    lines.push('');
    lines.push('UNKNOWN HOSTS (observation only; L2 does not fail):');
    for (const item of report.unknown_hosts) {
      lines.push('- ' + item.host + ': ' + item.files.join(', '));
    }
  }
  return lines.join('\n');
}

function main(argv = process.argv.slice(2)) {
  const json = argv.includes('--json');
  const registryArg = argv.find(arg => arg.startsWith('--registry='));
  const registryPath = registryArg ? path.resolve(registryArg.slice('--registry='.length)) : DEFAULT_REGISTRY;
  const report = scanRepository({ registryPath });
  process.stdout.write(json ? JSON.stringify(report, null, 2) + '\n' : textReport(report) + '\n');
}

if (require.main === module) main();

module.exports = {
  DEFAULT_SCAN_DIRS,
  extractHosts,
  hostMatchesPattern,
  providerEvidence,
  scanRepository,
  textReport,
};
