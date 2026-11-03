/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';
const { sessionPredatesCredentials } = require('../../utils/credential-session-guard');
test('sessions before reset are revoked including same second', () => {
  expect(sessionPredatesCredentials(1793656800, '2026-11-02T22:00:00.500Z')).toBe(true);
  expect(sessionPredatesCredentials(1793656801, '2026-11-02T22:00:00.500Z')).toBe(false);
  expect(sessionPredatesCredentials(100, null)).toBe(false);
});
test('unexpected timestamps fail closed', () => {
  expect(sessionPredatesCredentials(undefined, '2026-11-02T22:00:00Z')).toBe(true);
  expect(sessionPredatesCredentials(100, 'invalid')).toBe(true);
});
