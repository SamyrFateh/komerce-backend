'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const audit = require('../../scripts/audit-canonical-dashboards-staging');

describe('staging canonical dashboard audit runner', () => {
  test('parses market and period explicitly', () => {
    expect(audit.parseArgs(['node','script','--market','cm','--period','90']))
      .toEqual({ market: 'CM', period: '90' });
  });

  test('metric map preserves only canonical key/value pairs', () => {
    expect(audit.metricMap([
      { key: 'ca_encaisse', value: 100 },
      null,
      { key: 'cmds_actives', value: 4 },
    ])).toEqual({ ca_encaisse: 100, cmds_actives: 4 });
  });
});
