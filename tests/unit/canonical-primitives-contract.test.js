'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const { createPrimitives } = require('../../public/dashboards/canonical/js/primitives');

describe('Canonical UI primitives contract', () => {
  test('KpiStrip et MetricStrip désignent le même primitive de présentation', () => {
    const ui = createPrimitives(null);

    expect(ui.KpiStrip).toBeDefined();
    expect(ui.MetricStrip).toBeDefined();
    expect(ui.KpiStrip).toBe(ui.MetricStrip);
  });
});
