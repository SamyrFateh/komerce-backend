'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const loginSource = fs.readFileSync(
  path.join(__dirname, '../../public/js/login.js'),
  'utf8'
);

test('le login dashboard autorise admin et market_operator, pas les rôles clients', () => {
  expect(loginSource).toContain("new Set(['admin', 'market_operator'])");
  expect(loginSource).toContain('ALLOWED_DASHBOARD_ROLES.has(user.role)');
  expect(loginSource).not.toContain("if (user.role !== 'admin')");
});

test('la destination par défaut est le Pilotage Canonical', () => {
  const pilotageMatches = loginSource.match(/return '\/admin\/pilotage';/g) || [];
  expect(pilotageMatches.length).toBeGreaterThanOrEqual(2);
  expect(loginSource).not.toContain("return '/admin/control-tower';");
});
