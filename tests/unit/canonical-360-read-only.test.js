/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Doctrine : les fiches 360 sont en lecture seule, hormis les gestes de
 * nettoyage G6-BUYER explicitement réservés à l'admin et au paiement cash relais.
 * Aucun writer générique ne doit être introduit dans une fiche 360.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const JS = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'js');
const SURFACES = ['order-360.js', 'product-360.js', 'supplier-360.js', 'client-360.js', 'client-index.js'];
const read = name => fs.readFileSync(path.join(JS, name), 'utf8');

describe.each(SURFACES)('%s — lecture seule', name => {
  const source = read(name);

  test('aucun verbe HTTP mutant', () => {
    if (name === 'order-360.js') {
      const posts = source.match(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/gi) || [];
      const expected = source.includes('Clôturer la recette (marchandise au Hub)') ? 2 : 1;
      expect(posts).toHaveLength(expected);
      expect(posts.every(v => /POST/i.test(v))).toBe(true);
      expect(source).toContain("order.simulation_scope !== 'G6-BUYER'");
      expect(source).toContain("order.payment?.mode !== 'cash_relais'");
      expect(source).toContain("options.user?.role !== 'admin'");
    } else expect(source).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/i);
    expect(source.replace(/\bq\.delete\(/g, 'queryParamsDelete(')).not.toMatch(/\.(post|put|patch|delete)\(/);
  });

  test('aucun formulaire ni bouton de soumission', () => {
    // Seul l'index clients a un formulaire : filtre de recherche (GET, sans verbe mutant).
    if (name !== 'client-index.js') expect(source).not.toMatch(/createElement\(\s*['"]form['"]/);
    if (name !== 'client-index.js') expect(source).not.toMatch(/type\s*=\s*['"]submit['"]/);
  });

  test('boutons : uniquement recherche/pagination (GET) de l’index clients', () => {
    const hasButton = /['"]button['"]/.test(source);
    if (name === 'client-index.js') expect(hasButton).toBe(true);
    // L12a : Client 360 porte un seul bouton local « Afficher/Masquer les coordonnées » (affichage, aucune écriture).
    else if (name === 'client-360.js') {
      expect((source.match(/createElement\('button'\)|text\(doc, 'button'/g) || []).length).toBe(1);
      expect(source).toContain('Afficher les coordonnées');
    } else if (name === 'order-360.js') {
      const expected = source.includes('Clôturer la recette (marchandise au Hub)') ? 2 : 1;
      expect((source.match(/text\(doc,\s*'button'/g) || []).length).toBe(expected);
      expect(source).toContain('Annuler la commande de recette');
    } else expect(hasButton).toBe(false);
  });
});
