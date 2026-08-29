/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';

const { build } = require('../../scripts/lib/feature-360-builder');

describe('Feature 360 internal API projection', () => {
  test('reuses Business Feature Graph resolution for multi-file and string APIs', () => {
    const model = build();
    const byId = new Map(model.features.map(feature => [feature.id, feature]));

    const auth = byId.get('auth');
    const infrastructure = byId.get('infrastructure');

    expect(auth.governanceHealth.unresolvedInternalApis).toBe(0);
    expect(auth.architecturalDebt.debtItems.filter(item => item.type === 'UNRESOLVED_INTERNAL_API')).toEqual([]);
    expect(infrastructure.governanceHealth.unresolvedInternalApis).toBe(0);
    expect(infrastructure.architecturalDebt.debtItems.filter(item => item.type === 'UNRESOLVED_INTERNAL_API')).toEqual([]);
  });
});
