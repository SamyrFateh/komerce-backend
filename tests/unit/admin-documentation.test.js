/**
 * Documentation produit HTML : garde des rôles, intégrité des procédures et visuels.
 * Ces assertions de contrat ne remplacent pas le rendu Chromium sur staging.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const repo = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(repo, file), 'utf8');

describe('Documentation produit Canonical', () => {
  const html = read('public/dashboards/canonical/documentation.html');
  const nav = read('public/dashboards/canonical/js/navigation-policy-v4.js');
  const routes = read('bootstrap/html-routes.js');
  const guide = read('public/dashboards/canonical/js/documentation.js');

  test('une seule entrée documentaire, hors des domaines métier', () => {
    expect(nav).toContain("label: 'Documentation', href: '/admin/documentation'");
    expect(nav).toContain("id: 'help'");
    expect(nav).toContain("if (path === '/admin/documentation') return 'documentation'");
    expect(nav).toContain("if (surface === 'documentation') return DOCUMENTATION_ROLES.includes(role)");
  });

  test('route staff avec session et rôle vérifiés par le serveur', () => {
    expect(routes).toMatch(/app\.get\('\/admin\/documentation',\s*authenticate,\s*requireRole\(/);
    expect(routes).toContain("path.join(publicDir, 'dashboards', 'canonical', 'documentation.html')");
  });

  test('procédures détaillées et navigation interne complètes', () => {
    const processes = [
      'process-produit', 'process-import', 'process-local', 'process-cash',
      'process-procurement', 'process-retour', 'process-incident', 'process-marche'
    ];
    processes.forEach(id => {
      expect(html).toContain('id="' + id + '"');
      expect(html).toContain('href="#' + id + '"');
    });
    expect(html).toContain('17 chapitres');
    expect(html).toContain('data-roles="');
    expect(guide).toContain("input.addEventListener('input', apply)");
    expect(guide).toContain("printer.addEventListener('click'");
    expect(html).not.toMatch(/<script(?:\s[^>]*)?>\s*(?:function|const|let|var)/);
  });

  test('les onze visuels sont des maquettes explicitement étiquetées', () => {
    const fileNames = [
      '01_Pilotage.png', '02_Commerce.png', '03_Atelier_economique.png',
      '04_Catalogue_pays.png', '05_Commandes.png', '06_Marches.png',
      '07_Operations.png', '08_Hub_Relais.png', '09_Expeditions_Douane.png',
      '10_Sourcing.png', '11_Finance.png'
    ];
    fileNames.forEach(file => {
      expect(fs.existsSync(path.join(repo, 'public/dashboards/canonical/manual/screens', file))).toBe(true);
      expect(html).toContain('/dashboards/canonical/manual/screens/' + file);
    });
    expect(html).toContain('maquettes de référence validées');
    expect(html).toContain('ne sont pas des captures');
  });

  test('aucune mutation métier dans le module de lecture', () => {
    expect(guide).not.toMatch(/\bfetch\s*\(/);
    expect(guide).not.toMatch(/\b(localStorage|sessionStorage)\b/);
  });
});
