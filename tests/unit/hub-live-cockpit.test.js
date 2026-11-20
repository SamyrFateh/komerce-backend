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

test('le formulaire de simulation fournisseur utilise la référence du dossier PO',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/js/hub-live-cockpit.js'),'utf8');
  expect(source).toContain("'SIM-STAGING-' + po.simulation_reference");
  expect(source).not.toContain("po.lines[0]?.order_ref");
});

describe('G6 ergonomie UX3 — sélection explicite et alertes métier', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/hub-live-cockpit.js'), 'utf8');
  test('le cockpit ne choisit pas une commande arbitraire au chargement', () => {
    expect(source).toContain('if (!state.selectionInitialized)');
    expect(source).toContain('item.viewer_can_act !== false');
    expect(source).toContain("title: 'Sélectionnez un élément'");
  });
  test('la sélection reste partageable et suit la navigation navigateur', () => {
    expect(source).toContain('function readUrlSelection()');
    expect(source).toContain('function putUrlSelection(type, id)');
    expect(source).toContain("win.history.pushState");
    expect(source).toContain("win.addEventListener('popstate'");
  });
  test('une alerte serveur garde son dossier sélectionnable même absent de la file compacte', () => {
    expect(source).toContain('const inTodo = todo.some(item =>');
    expect(source).toContain('target.type === state.sel.type && target.id === state.sel.id');
    expect(source).toContain('if (!known && !inTodo) state.sel = null;');
  });
});

describe('Hub UX guidée — sans nouvel acte métier', () => {
  const cockpit = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/hub-live-cockpit.js'), 'utf8');
  const operations = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/operations-workspace.js'), 'utf8');
  const opsCss = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/css/operations-workspace.css'), 'utf8');

  test('un seul CTA actif est déplacé, jamais recréé ou redirigé vers un nouveau writer', () => {
    expect(cockpit).toContain('const primaryRow = Array.from(list.children).find');
    expect(cockpit).toContain('nextAction.appendChild(primaryRow)');
    expect(cockpit).toContain("right.insertBefore(nextAction, right.children[1]);");
    expect(cockpit).toContain("nextAction.setAttribute('data-hlc-next-action', '');");
  });

  test('ateliers accessibles, détails ouverts, raccourci réception vers le véritable onglet', () => {
    expect(operations).toContain('secondary.open = true');
    expect(operations).toContain("secondary.setAttribute('data-hub-physical-details', '');");
    expect(operations).toContain("context.view = 'reception';");
    expect(operations).toContain("context.renderCurrent();");
    expect(cockpit).toContain("['reception', 'Réception fournisseur']");
    expect(cockpit).toContain("['bags', 'Préparer les sacs']");
    expect(cockpit).toContain("['boxes', 'KOM-BOX']");
    expect(cockpit).toContain("['shipments', 'Expéditions']");
  });

  test('français métier seulement dans le rendu ; preuves et droits canoniques maintenus', () => {
    expect(cockpit).toContain("PICKED: 'Prélevé', PACKED: 'Emballé', DISPATCHED: 'Prêt au départ'");
    expect(cockpit).toContain("Ordre d’arrivée n°");
    expect(cockpit).toContain("Signification des états");
    expect(operations).toContain('manualProofLabel.hidden = !manualToggle.checked');
    expect(operations).toContain("data-receive-line");
    expect(operations).toContain("data-hub-box-scan");
    expect(opsCss).toContain('.kmc-workspace-receive-field-label');
    expect(css).toContain('.hlc-next-action .hlc-btn.is-primary');
  });
});

test('Hub UX : le conteneur data-hlc-actions englobe les actions du fil et le seul CTA déplacé', () => {
  const js = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/hub-live-cockpit.js'), 'utf8');
  expect(js).toContain("rootEl.setAttribute('data-hlc-actions', '');");
  expect(js).not.toContain("list.setAttribute('data-hlc-actions', '');");
  expect(js).toContain('nextAction.appendChild(primaryRow)');
  expect(js).toContain('rightP.appendChild(list)');
});
