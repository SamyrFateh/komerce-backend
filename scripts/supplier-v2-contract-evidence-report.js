#!/usr/bin/env node
'use strict';

/**
 * CJ <-> AliExpress normalized-source-contract evidence report.
 * Reads persisted sourcing_candidates evidence only. Never calls supplier APIs.
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');

const PROVIDERS = ['CJ', 'AliExpress'];
const REQUIRED_V2 = new Set(['schema_version', 'supplier_name', 'product_name', 'currency']);

function isPresent(value) {
  return value !== undefined && value !== null && value !== '';
}
function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
function pct(n, d) {
  return d ? Number(((n / d) * 100).toFixed(1)) : 0;
}
function classify(field, stats) {
  if (REQUIRED_V2.has(field)) return 'V2 CORE REQUIRED';
  const n = PROVIDERS.filter(p => (stats[p]?.present || 0) > 0).length;
  if (n === PROVIDERS.length) return 'V2 CORE OPTIONAL';
  if (n === 1) return 'SUPPLIER EXTENSION';
  return 'UNUSED SOURCE DATA';
}

function collect(rows) {
  const byProvider = Object.fromEntries(PROVIDERS.map(p => [p, []]));
  for (const row of rows) {
    const provider = PROVIDERS.find(p => p.toLowerCase() === String(row.supplier_name || '').toLowerCase());
    const c = row.normalized_source_contract;
    if (provider && c && typeof c === 'object' && !Array.isArray(c)) byProvider[provider].push(c);
  }
  const fields = new Set();
  Object.values(byProvider).forEach(cs => cs.forEach(c => Object.keys(c).forEach(f => fields.add(f))));
  const fieldReport = [...fields].sort().map(field => {
    const providers = {};
    for (const provider of PROVIDERS) {
      const contracts = byProvider[provider];
      const values = contracts.map(c => c[field]).filter(isPresent);
      providers[provider] = {
        total_contracts: contracts.length,
        present: values.length,
        presence_pct: pct(values.length, contracts.length),
        types: [...new Set(values.map(typeOf))].sort(),
      };
    }
    return { field, classification: classify(field, providers), providers };
  });
  return {
    report_version: 'sourcing-catalog-provider-contract-v1',
    providers: Object.fromEntries(PROVIDERS.map(p => [p, { normalized_v2_contracts: byProvider[p].length }])),
    fields: fieldReport,
  };
}

function markdown(report) {
  const lines = [
    '# CJ <-> AliExpress - persisted V2 contract evidence',
    '',
    '> Generated from persisted sourcing_candidates.normalized_source_contract only. No supplier API is called.',
    '',
    'CJ contracts: ' + report.providers.CJ.normalized_v2_contracts +
      ' | AliExpress contracts: ' + report.providers.AliExpress.normalized_v2_contracts,
    '',
    '| Field | Classification | CJ presence | CJ types | AliExpress presence | AliExpress types |',
    '| --- | --- | ---: | --- | ---: | --- |',
  ];
  for (const f of report.fields) {
    const cj = f.providers.CJ;
    const ali = f.providers.AliExpress;
    lines.push('| ' + f.field + ' | ' + f.classification +
      ' | ' + cj.presence_pct + '% (' + cj.present + '/' + cj.total_contracts + ')' +
      ' | ' + (cj.types.join(', ') || '-') +
      ' | ' + ali.presence_pct + '% (' + ali.present + '/' + ali.total_contracts + ')' +
      ' | ' + (ali.types.join(', ') || '-') + ' |');
  }
  lines.push('', '## Review rule', '',
    'Incompatible observed types, unexpected absence of a V2 required field, or source data known to exist in raw payload but absent from V2 is LOSS / INVESTIGATE before certification.');
  return lines.join('\n') + '\n';
}

async function main() {
  const { rows } = await db.query(
    "SELECT supplier_name, normalized_source_contract FROM sourcing_candidates " +
    "WHERE LOWER(supplier_name) IN ('cj', 'aliexpress') " +
    "AND normalized_source_contract IS NOT NULL " +
    "ORDER BY LOWER(supplier_name), supplier_product_id, id"
  );
  const report = collect(rows);
  const args = process.argv.slice(2);
  const jsonArg = args.find(a => a.startsWith('--json='));
  const mdArg = args.find(a => a.startsWith('--md='));
  const jsonPath = jsonArg && jsonArg.slice(7);
  const mdPath = mdArg && mdArg.slice(5);
  if (jsonPath) {
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
  }
  if (mdPath) {
    fs.mkdirSync(path.dirname(mdPath), { recursive: true });
    fs.writeFileSync(mdPath, markdown(report));
  }
  if (!jsonPath && !mdPath) process.stdout.write(markdown(report));
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exitCode = 1;
  }).finally(() => db.end && db.end());
}

module.exports = { collect, markdown, classify, isPresent, typeOf };
