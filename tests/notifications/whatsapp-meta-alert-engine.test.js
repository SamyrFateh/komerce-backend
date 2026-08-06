/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * @komerce-arch
 * @role          notification-adapter-alert-engine-tests
 * @domain        notification
 * @layer         test
 * @criticality   medium
 * @inputs        adapter and alert engine fixtures
 * @outputs       jest assertions
 * @depends       services/whatsapp-meta.js, services/alert-engine.js
 * @used-by       feature-guard, jest
 * @doctrine      provider_adapter_isole, notification_non_bloquante
 * @impact-areas  notifications, alerts, tests, governance
 * @version       2026-06
 */
'use strict';

jest.mock('../../db', () => ({
  query: jest.fn(),
}));

describe('whatsapp meta adapter', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    delete process.env.META_WA_TOKEN;
    delete process.env.META_WA_PHONE_NUMBER_ID;
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  test('skips safely when Meta credentials are not configured', async () => {
    const { sendTemplateWhatsApp } = require('../../services/whatsapp-meta');

    await expect(sendTemplateWhatsApp({
      to: '+33600000001',
      templateName: 'order_confirmed',
    })).resolves.toEqual({
      success: false,
      skipped: true,
      reason: 'meta_not_configured',
    });
  });
});

describe('alert engine orchestration', () => {
  test('runAll returns fulfilled alert results and ignores rejected checks', async () => {
    const AlertEngine = require('../../services/alert-engine');

    AlertEngine.checkStuckParcels = jest.fn().mockResolvedValue([{ id: 'stuck' }]);
    AlertEngine.checkWeightMismatches = jest.fn().mockResolvedValue([]);
    AlertEngine.checkSLABreaches = jest.fn().mockRejectedValue(new Error('db transient'));
    AlertEngine.checkUnverifiedParcels = jest.fn().mockResolvedValue([{ id: 'unverified' }]);
    AlertEngine.checkCashPending = jest.fn().mockResolvedValue([]);

    await expect(AlertEngine.runAll()).resolves.toEqual([{ id: 'stuck' }, { id: 'unverified' }]);
  });
});
