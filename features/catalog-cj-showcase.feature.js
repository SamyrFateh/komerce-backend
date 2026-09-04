/**
 * @feature       catalog-cj-showcase
 * @type          governance-unit
 * @domain        catalog
 * @status        production
 * @owner         backend-core
 * @since         2026-09
 * @doctrine      docs/doctrine/FEATURE_DOCTRINE.md
 */
'use strict';

module.exports = {
  name: 'catalog-cj-showcase',
  nature: 'governance-unit',
  type: 'governance-unit',
  domain: 'catalog',
  status: 'production',
  owner: 'backend-core',
  classification: {
    axis: 'business',
    kind: 'business-feature',
    rationale: ['One-shot operational slice owned by catalog for the CJ-backed real-image showcase bootstrap.'],
  },
  since: '2026-09',
  doctrine: 'docs/doctrine/FEATURE_DOCTRINE.md',
  service: 'Bootstrap a small real-image CJ supplier slice through the canonical catalog refinery without creating a parallel catalog authority.',
  perimeter: {
    in: ['guarded CJ showcase seed', 'contract tests', 'operator documentation'],
    out: ['supplier connector ownership', 'generic catalog publication authority', 'runtime discovery ranking'],
  },
  files: {
    scripts: ['scripts/cj-real-showcase-seed.js'],
    tests: ['tests/unit/cj-real-showcase-seed.test.js'],
    docs: ['docs/cj-real-showcase-63.md'],
  },
  repos: { backend: 'one-shot catalog bootstrap' },
  db: { tables: [] },
  security: { status: 'INTERNAL', note: 'Execution is guarded by explicit runtime environment variable and server-side supplier credentials.' },
  contract: {
    exposes: [],
    consumes: ['catalog', 'sourcing'],
  },
  authority: 'catalog remains the sole product publication authority; sourcing remains the candidate lifecycle authority',
  invariants: [
    'CJ media stays attached to CJ supplier products and lineage',
    'the seed cannot run without KOMERCE_ALLOW_CJ_SHOWCASE_SEED=1',
    'no Showcase V2 deletion or rewrite is performed by this bootstrap',
  ],
};
