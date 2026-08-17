'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const path = require('path');
const semantics = require('../../governance/business-graph-warning-semantics');
const ROOT = path.resolve(__dirname, '../..');

describe('Business Graph warning semantics — vérité de la dette', () => {
  it('ne compte jamais les limites du générateur comme dette', () => {
    const warnings = [{
      type: 'DYNAMIC-LOCAL-DEPENDENCY-UNRESOLVED',
      ref: 'scope:backend',
      msg: 'import dynamique non résolu',
    }];
    const p = semantics.partition(warnings, { ROOT });
    expect(p.debt).toHaveLength(0);
    expect(p.generatorLimitations).toHaveLength(1);
    expect(p.summary).toEqual({ signals: 1, debt: 0, expectedTopology: 0, generatorLimitations: 1 });
  });

  it('ne compte jamais une topologie attendue comme dette', () => {
    const warnings = [{
      type: 'DASH-MANIFEST-DUPLICATE-COPY',
      ref: 'admin-dashboard',
      msg: 'copie déclarée du canonique',
    }];
    const p = semantics.partition(warnings, { ROOT });
    expect(p.debt).toHaveLength(0);
    expect(p.expectedTopology).toHaveLength(1);
  });

  it('compte invalid declaration, actionable drift et known debt comme dette', () => {
    const warnings = [
      { type: 'CONSUMES-REFERENCE-UNRESOLVED', ref: 'auth -> "notification"', msg: 'nom inconnu' },
      { type: 'OBSERVED-UNDECLARED-FEATURE-DEPENDENCY', ref: 'a -> b', msg: 'observée sans consumes' },
      { type: 'WRITER-NOT-OWNER', ref: 'orders', msg: '2 écrivain(s) déclaré(s) (orders, logistics) sans owner de lifecycle univoque' },
    ];
    const p = semantics.partition(warnings, { ROOT });
    expect(p.debt).toHaveLength(3);
    expect(p.expectedTopology).toHaveLength(0);
    expect(p.generatorLimitations).toHaveLength(0);
    expect(p.classified.map(x => x.semantic.category)).toEqual([
      'INVALID_DECLARATION', 'ACTIONABLE_DRIFT', 'KNOWN_DEBT',
    ]);
  });

  it('classe le wiring du composition root comme topologie attendue quand O6 le prouve', () => {
    const warning = { type: 'OBSERVED-UNDECLARED-FEATURE-DEPENDENCY', ref: 'infrastructure -> auth-passkey', msg: 'observée sans consumes' };
    const pairClassifications = [{
      from: 'infrastructure', to: 'auth-passkey', family: 'COMPOSITION_ROOT_WIRING',
      policy: 'application-wiring-not-consumption', exceptionRequired: false,
    }];
    const p = semantics.partition([warning], { ROOT, pairClassifications });
    expect(p.debt).toHaveLength(0);
    expect(p.expectedTopology).toEqual([warning]);
    expect(p.classified[0].semantic.category).toBe('EXPECTED_TOPOLOGY');
  });

  it('garde OBSERVED-UNDECLARED en dette sans disposition O6 correspondante', () => {
    const warning = { type: 'OBSERVED-UNDECLARED-FEATURE-DEPENDENCY', ref: 'orders -> shared-cart', msg: 'observée sans consumes' };
    const p = semantics.partition([warning], { ROOT, pairClassifications: [] });
    expect(p.debt).toEqual([warning]);
    expect(p.classified[0].semantic.category).toBe('ACTIONABLE_DRIFT');
  });

  it('ne blanchit pas une paire O6 qui exige une exception ou une autre policy', () => {
    const warning = { type: 'OBSERVED-UNDECLARED-FEATURE-DEPENDENCY', ref: 'infrastructure -> auth-passkey', msg: 'observée sans consumes' };
    const pairClassifications = [{
      from: 'infrastructure', to: 'auth-passkey', family: 'COMPOSITION_ROOT_WIRING',
      policy: 'application-wiring-not-consumption', exceptionRequired: true,
    }];
    const p = semantics.partition([warning], { ROOT, pairClassifications });
    expect(p.debt).toEqual([warning]);
    expect(p.classified[0].semantic.category).toBe('ACTIONABLE_DRIFT');
  });

  it('classe une dépendance observée uniquement dans les tests hors dette runtime', () => {
    const warning = { type: 'OBSERVED-UNDECLARED-FEATURE-DEPENDENCY', ref: 'inventory -> payments', msg: 'test-only' };
    const pairClassifications = [{
      from: 'inventory', to: 'payments', family: 'NON_RUNTIME_TEST',
      evidenceRole: 'TEST_ONLY', policy: 'non-runtime-evidence', exceptionRequired: false,
    }];
    const p = semantics.partition([warning], { ROOT, pairClassifications });
    expect(p.debt).toHaveLength(0);
    expect(p.expectedTopology).toEqual([warning]);
    expect(p.classified[0].semantic.category).toBe('EXPECTED_TOPOLOGY');
  });
});
