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


describe('GAP-3 — provider registry reflects scoped evidence rather than assumed live capability', () => {
  const root = path.resolve(__dirname, '../..');
  const registry = JSON.parse(fs.readFileSync(
    path.join(root, 'governance/external-provider-registry.json'), 'utf8'
  ));
  const provider = id => registry.providers.find(p => p.id === id);

  test('PayPal retains global UNQUALIFIED and links only to the archived Sandbox P1 order readback', () => {
    const paypal = provider('paypal');
    const evidence = 'docs/_archive/external-provider-proofs/PAYPAL_SANDBOX_ORDER_P1_2026-09-23.md';
    expect(paypal.highest_proof).toBe('UNQUALIFIED');
    expect(paypal.qualification_note).toContain('SANDBOX ORDER_CREATE_AND_EXACT_READBACK');
    expect(paypal.qualification_note).toContain(evidence);
    const archive = fs.readFileSync(path.join(root, evidence), 'utf8');
    expect(archive).toContain('readback_confirmed');
    expect(archive).toContain('capture_attempted');
    expect(archive).toContain('UNQUALIFIED');
  });

  test('Brevo implementation is recorded without asserting an active caller or delivery', () => {
    const brevo = provider('brevo');
    expect(brevo.consumers).toEqual(['notifications']);
    expect(brevo.highest_proof).toBe('UNQUALIFIED');
    expect(brevo.qualification_note).toContain('no application caller');
    const source = fs.readFileSync(path.join(root, 'utils/email.js'), 'utf8');
    expect(source).toContain('https://api.brevo.com/v3/smtp/email');
    expect(source).toContain('module.exports = { sendOrderEmail, templates }');
    const observed = scanRepository().observed_providers.find(p => p.id === 'brevo');
    expect(observed.files).toContain('utils/email.js');
  });

  test.each(['twilio', 'africas-talking'])('%s remains config-only with no consumers', id => {
    const entry = provider(id);
    expect(entry.expected_scope).toBe('config-only');
    expect(entry.consumers).toEqual([]);
    expect(entry.highest_proof).toBe('UNQUALIFIED');
    expect(entry.qualification_note).toContain('no active runtime API consumer');
  });
});
