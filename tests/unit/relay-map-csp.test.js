/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

'use strict';

const { buildHelmetOptions } = require('../../bootstrap/security');

test('CSP autorise uniquement l’hôte Google utilisé par la carte relais embarquée', () => {
  const frameSrc = buildHelmetOptions().contentSecurityPolicy.directives.frameSrc;
  expect(frameSrc).toContain('https://www.google.com');
  expect(frameSrc).not.toContain('https:');
  expect(frameSrc).not.toContain('*');
});
