/**
 * @komerce-arch
 * @role          external-provider-boundary-scan-test
 * @domain        external-provider-contracts
 * @layer         test
 * @criticality   medium
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  extractHosts,
  hostMatchesPattern,
  scanRepository,
} = require('../../scripts/external-provider-boundary-scan');

function tempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'komerce-ext-provider-'));
  fs.mkdirSync(path.join(root, 'services'), { recursive: true });
  fs.mkdirSync(path.join(root, 'routes'), { recursive: true });
  return root;
}

describe('external-provider-boundary-scan', () => {
  test('extracts literal HTTPS hosts deterministically', () => {
    expect(extractHosts(
      "fetch('https://api.example.com/v1'); const x='https://api.example.com/v2';"
    )).toEqual(['api.example.com']);
    expect(hostMatchesPattern('sub.example.com', '*.example.com')).toBe(true);
    expect(hostMatchesPattern('example.net', '*.example.com')).toBe(false);
  });

  test('reports registered marker boundaries and unknown hosts without network calls', () => {
    const root = tempRepo();
    fs.writeFileSync(
      path.join(root, 'services', 'payment.js'),
      [
        '/** @domain payment */',
        "const stripe = require('stripe');",
        "const key = process.env.STRIPE_SECRET_KEY;",
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(root, 'routes', 'other.js'),
      [
        '/** @domain logistics */',
        "async function run(){ return fetch('https://api.unknown.test/v1'); }",
      ].join('\n')
    );

    const report = scanRepository({
      root,
      scanDirs: ['services', 'routes'],
      registry: {
        schema_version: 1,
        ignore_hosts: [],
        providers: [{
          id: 'stripe',
          family: 'payment',
          expected_scope: 'runtime',
          consumers: ['payments'],
          hosts: [],
          markers: ["require('stripe')", 'STRIPE_SECRET_KEY'],
          analysis_document: null,
          highest_proof: 'UNQUALIFIED',
        }],
      },
    });

    expect(report.scanned_files).toBe(2);
    expect(report.observed_providers).toHaveLength(1);
    expect(report.observed_providers[0]).toMatchObject({
      id: 'stripe',
      family: 'payment',
      observed_domains: ['payment'],
      observed_scopes: ['runtime'],
    });
    expect(report.observed_providers[0].files).toEqual(['services/payment.js']);
    expect(report.unknown_hosts).toEqual([{
      host: 'api.unknown.test',
      files: ['routes/other.js'],
    }]);
  });

  test('refuses duplicate provider ids in the registry', () => {
    const root = tempRepo();
    expect(() => scanRepository({
      root,
      scanDirs: ['services'],
      registry: {
        providers: [
          { id: 'same', family: 'x', hosts: [], markers: [] },
          { id: 'same', family: 'y', hosts: [], markers: [] },
        ],
      },
    })).toThrow('EXTERNAL_PROVIDER_REGISTRY_DUPLICATE_ID');
  });
});
