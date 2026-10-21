'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public/dashboards/canonical/css/canonical-shell-v4.css'), 'utf8');

test('le retour contextuel est visible dans la coque, le repli canonique reste masqué', () => {
  expect(css).toMatch(/body\.kmc-shell-v4 \.kmc-admin-back\s*\{\s*display:\s*none;/);
  expect(css).toMatch(/\.kmc-admin-back\[data-back-context="contextual"\]\s*\{\s*display:\s*inline-flex/);
});

test('rail étroit : le retour contextuel se réduit à une flèche (libellé porté par aria-label)', () => {
  const narrow = css.slice(css.indexOf('@media (max-width: 980px)'));
  expect(narrow).toMatch(/\.kmc-admin-back\[data-back-context="contextual"\]\s*\{[^}]*font-size:\s*0/);
  expect(narrow).toMatch(/\.kmc-admin-back\[data-back-context="contextual"\]::before\s*\{\s*content:\s*'←'/);
});

test('palette Komerce : onglet de domaine actif et bandeau d’aide en orange, plus d’indigo', () => {
  expect(css).not.toMatch(/#4053e8|#2563eb|#1d4ed8/i);
  expect(css).toContain('.kmc-admin-domain-tab.is-active');
});
