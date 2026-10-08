'use strict';

const fs = require('fs');
const path = require('path');

test('navigation policy V4 porte la taxonomie métier cible complète', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'js', 'navigation-policy-v4.js'),
    'utf8'
  );
  ['Piloter', 'Flux', 'Entités', 'Workspaces', 'Marchés', 'Administration'].forEach(label => {
    expect(source).toContain(`label: '${label}'`);
  });
  expect(source).toContain("id: 'workspace-sourcing'");
  expect(source).toContain("id: 'entity-suppliers'");
});

test('Administration expose l’entrée Providers (lecture seule)', () => {
  const source = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/navigation-policy-v4.js'), 'utf8');
  expect(source).toContain("'admin-providers'");
  expect(source).toContain('/admin/providers');
});

test('Administration expose l’entrée Utilisateurs (lecture seule, admin)', () => {
  const source = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/navigation-policy-v4.js'), 'utf8');
  expect(source).toContain("id: 'admin-users'");
  expect(source).toContain("href: '/admin/users', roles: ['admin']");
});
