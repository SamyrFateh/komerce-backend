#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          provider-certification-reconciliation
 * @domain        external-provider-contracts
 * @layer         script
 * @criticality   medium
 * @inputs        governance/external-provider-registry.json, governance/external-provider-capability-certifications.json
 * @outputs       deterministic reconciliation summary
 * @depends       node:fs, node:path
 * @used-by       CI/governance/manual audit
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md, docs/doctrine/DOCTRINE_PURCHASING_PROVIDER_GOLDEN_E2E.md
 * @impact-areas  external-provider-contracts, governance
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const REGISTRY_PATH = path.join(ROOT, 'governance/external-provider-registry.json');
const LEDGER_PATH = path.join(ROOT, 'governance/external-provider-capability-certifications.json');

const CLASSIFICATIONS = new Set(['CONFIRMED', 'RECLASSIFIED', 'GAP']);
const PROOFS = new Set(['UNQUALIFIED', 'P0', 'P1', 'P2', 'P3', 'P4']);
const SAFE_PROVIDER = /^[a-z0-9][a-z0-9-]{0,79}$/;
const SAFE_CAPABILITY = /^[a-z][a-z0-9_.-]{2,119}$/;
const SAFE_PATH = /^(?:docs|services|scripts|tests|governance)\/[A-Za-z0-9_./-]+$/;

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function validateLedger(registry, ledger, root = ROOT) {
  if (!registry || !Array.isArray(registry.providers)) throw new Error('RECONCILIATION_REGISTRY_INVALID');
  if (!ledger || ledger.schema_version !== 1 || !ledger.providers || typeof ledger.providers !== 'object') {
    throw new Error('RECONCILIATION_LEDGER_INVALID');
  }

  const knownProviders = new Set(registry.providers.map(p => p.id));
  const rows = [];

  for (const [provider, capabilities] of Object.entries(ledger.providers)) {
    if (!SAFE_PROVIDER.test(provider) || !knownProviders.has(provider)) {
      throw new Error(`RECONCILIATION_UNKNOWN_PROVIDER:${provider}`);
    }
    if (!Array.isArray(capabilities) || capabilities.length === 0) {
      throw new Error(`RECONCILIATION_CAPABILITIES_EMPTY:${provider}`);
    }

    const seen = new Set();
    for (const row of capabilities) {
      if (!SAFE_CAPABILITY.test(String(row.capability || ''))) {
        throw new Error(`RECONCILIATION_CAPABILITY_INVALID:${provider}`);
      }
      if (seen.has(row.capability)) throw new Error(`RECONCILIATION_CAPABILITY_DUPLICATE:${provider}:${row.capability}`);
      seen.add(row.capability);

      if (!CLASSIFICATIONS.has(row.classification)) {
        throw new Error(`RECONCILIATION_CLASSIFICATION_INVALID:${provider}:${row.capability}`);
      }
      if (!PROOFS.has(row.highest_proof)) {
        throw new Error(`RECONCILIATION_PROOF_INVALID:${provider}:${row.capability}`);
      }
      if (!String(row.availability || '').trim()) {
        throw new Error(`RECONCILIATION_AVAILABILITY_MISSING:${provider}:${row.capability}`);
      }
      if (!String(row.environment || '').trim()) {
        throw new Error(`RECONCILIATION_ENVIRONMENT_MISSING:${provider}:${row.capability}`);
      }
      if (!Array.isArray(row.evidence) || row.evidence.length === 0) {
        throw new Error(`RECONCILIATION_EVIDENCE_MISSING:${provider}:${row.capability}`);
      }

      for (const evidencePath of row.evidence) {
        if (!SAFE_PATH.test(String(evidencePath || '')) || evidencePath.includes('..')) {
          throw new Error(`RECONCILIATION_EVIDENCE_PATH_INVALID:${provider}:${row.capability}`);
        }
        if (!fs.existsSync(path.join(root, evidencePath))) {
          throw new Error(`RECONCILIATION_EVIDENCE_NOT_FOUND:${provider}:${row.capability}:${evidencePath}`);
        }
      }

      // A CLOSED capability must never pretend to hold a positive P-level.
      if (row.availability === 'CLOSED' && row.highest_proof !== 'UNQUALIFIED') {
        throw new Error(`RECONCILIATION_CLOSED_PROOF_OVERCLAIM:${provider}:${row.capability}`);
      }

      rows.push({ provider, ...row });
    }
  }

  return rows;
}

function summarize(rows) {
  const summary = {
    total_capabilities: rows.length,
    confirmed: 0,
    reclassified: 0,
    gap: 0,
    p4: 0,
    closed: 0,
  };
  for (const row of rows) {
    if (row.classification === 'CONFIRMED') summary.confirmed += 1;
    if (row.classification === 'RECLASSIFIED') summary.reclassified += 1;
    if (row.classification === 'GAP') summary.gap += 1;
    if (row.highest_proof === 'P4') summary.p4 += 1;
    if (row.availability === 'CLOSED') summary.closed += 1;
  }
  return summary;
}

function run({ registryPath = REGISTRY_PATH, ledgerPath = LEDGER_PATH, root = ROOT } = {}) {
  const registry = loadJson(registryPath);
  const ledger = loadJson(ledgerPath);
  const rows = validateLedger(registry, ledger, root);
  return { schema_version: 1, summary: summarize(rows), rows };
}

if (require.main === module) {
  try {
    const report = run();
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { CLASSIFICATIONS, PROOFS, validateLedger, summarize, run };
