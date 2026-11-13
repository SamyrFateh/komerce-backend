/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/css/hub-live-cockpit.css'), 'utf8');

describe('hub-live-cockpit.css — formulaire de réception dans la colonne', () => {
  test('le formulaire est une grille à colonne unique rétractable (minmax(0, 1fr))', () => {
    expect(css).toMatch(/\.hlc-form \{[^}]*grid-template-columns: minmax\(0, 1fr\);[^}]*min-width: 0;/);
  });

  test('la carte, le tableau et la colonne de saisie ne forcent plus la largeur', () => {
    expect(css).toContain('.hlc-form .kmc-workspace-receive-card { border: 0; padding: 0; background: transparent; min-width: 0; }');
    expect(css).toContain('.hlc-form .kmc-workspace-receive-card .kmc-workspace-table { min-width: 0; }');
    expect(css).toMatch(/\.hlc-form \.kmc-workspace-receive-card \.kmc-workspace-table td:last-child \{ min-width: 0;/);
  });
});

describe('hub-live-cockpit — ancienneté des tâches (H4 #3998)', () => {
  const js = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/hub-live-cockpit.js'), 'utf8');

  test('la pastille affiche l\'âge fourni par le serveur et l\'alerte, sans rien calculer côté navigateur', () => {
    expect(js).toMatch(/item\.age_hours != null/);
    expect(js).toMatch(/hlc-todo-age\$\{item\.overdue \? ' is-overdue' : ''\}/);
    expect(css).toMatch(/\.hlc-todo-age\.is-overdue/);
  });
});

describe('H4 #3998 — branchement global de la directrice dans le vrai poste Hub', () => {
  const central = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/hub-workstation.js'), 'utf8');
  const operations = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/operations-workspace.js'), 'utf8');
  test('le panneau est dans /admin/hub, pas un deuxième cockpit par marché', () => {
    expect(central).toContain('renderDirectorQueue(content,{document:doc,fetch:fetchFn,user})');
    expect(central).toContain("requestJSON(fetchFn,'/api/hub/director-todo')");
    expect(central).toContain("['admin', 'agent_hub'].includes(user && user.role)");
    expect(central).toContain('data-hub-director-list');
    expect(central).toContain('task.age_hours');
    expect(central).toContain('task.overdue');
    expect(central).toContain('/admin/hub-live?view=execute&market=');
    expect(operations).not.toContain("'/api/hub/director-todo'");
    expect(css).toContain('.hlc-director-task.is-overdue');
  });
});
