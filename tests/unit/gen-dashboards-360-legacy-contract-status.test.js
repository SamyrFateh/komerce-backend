'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Legacy Dashboard 360 must read x-contract-status from the response schema,
 * exactly like the Canonical generator. Only source "test" is PROVEN.
 */

const {
  extractContractStatus,
  isProvenStatus,
  parseOpenApiContract,
  build,
} = require('../../scripts/gen-dashboards-360');

describe('Legacy Dashboard 360 — OpenAPI proof status', () => {
  test('reads status from a 2xx response schema', () => {
    const def = {
      responses: {
        200: {
          content: {
            'application/json': {
              schema: { 'x-contract-status': 'test' },
            },
          },
        },
      },
    };
    expect(extractContractStatus(def)).toBe('test');
    expect(isProvenStatus(extractContractStatus(def))).toBe(true);
  });

  test('route-read remains unproven', () => {
    const def = {
      responses: {
        200: {
          content: {
            'application/json': {
              schema: { 'x-contract-status': 'route-read' },
            },
          },
        },
      },
    };
    expect(extractContractStatus(def)).toBe('route-read');
    expect(isProvenStatus(extractContractStatus(def))).toBe(false);
  });

  test('real contract exposes existing HTTP-tested dashboard dependencies as PROVEN', () => {
    const contract = parseOpenApiContract();
    expect(contract['GET /api/orders']).toBe('PROVEN');
    expect(contract['GET /api/products']).toBe('PROVEN');
    expect(contract['GET /api/admin/costing/orders']).toBe('PROVEN');
    expect(contract['GET /api/admin/economic/executive']).toBe('PROVEN');
    expect(contract['POST /api/transitaire/ship']).toBe('PROVEN');
  });

  test('Legacy Dashboard 360 has no called response contract left unproven', () => {
    const model = build();
    expect(model.summary.unprovenContracts).toBe(0);
    expect(model.diagnostics.unprovenContracts).toEqual([]);
  });
});
