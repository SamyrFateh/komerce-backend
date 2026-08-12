'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const prompt = require('../../services/prompts/catalog-enrichment.prompt');

const BASE = {
  description_fr: 'Coffret cadeau artistique présenté comme un objet décoratif destiné à offrir.',
  category: 'Créations personnelles',
  fragility: null,
  confidence: 0.94,
  review_notes: [],
};

describe('catalog enrichment — invariants éditoriaux client', () => {
  test('le prompt exige explicitement une fiche française distincte des métadonnées source', () => {
    const system = prompt.buildSystemPrompt({ allowedCategories: ['Créations personnelles'] });
    expect(system).toContain('fiche CLIENT en FRANÇAIS');
    expect(system).toContain('noms de fichiers');
    expect(system).toContain('crédits photo');
    expect(system).toContain(`maximum ${prompt.CLIENT_TITLE_MAX_LENGTH} caractères`);
  });

  test('le message transporte le rayon et la sous-catégorie quand ils sont connus', () => {
    const payload = JSON.parse(prompt.buildUserMessage({
      name_source: 'gift box product',
      description_source: 'boxed artistic gift',
      source_locale: 'en',
      current_category: 'Créations personnelles',
      current_subcategory: 'Cadeau',
    }));
    expect(payload).toMatchObject({
      current_category: 'Créations personnelles',
      current_subcategory: 'Cadeau',
      source_locale: 'en',
    });
  });

  test('accepte un titre commercial français court et propre', () => {
    const verdict = prompt.validateOutput({
      ...BASE,
      name_fr: 'Coffret cadeau artistique',
    }, { allowedCategories: ['Créations personnelles'] });
    expect(verdict.ok).toBe(true);
    expect(verdict.value.name_fr).toBe('Coffret cadeau artistique');
  });

  test('refuse le cas de régression Wikimedia visible dans la boutique', () => {
    const verdict = prompt.validateOutput({
      ...BASE,
      name_fr: 'HK LCSD HKMoA HKMoH HKHM gift StanleyWong Another Mountainman artist works WeLoveHK September 2020 SS2 03',
    }, { allowedCategories: ['Créations personnelles'] });
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.join(' ')).toMatch(/trop long|métadonnées|codes/i);
  });

  test.each([
    ['File:gift-box.jpg', 'fichier'],
    ['https://commons.wikimedia.org/gift-box', 'source'],
    ['HK LCSD HKHM SS2 coffret', 'métadonnées'],
  ])('refuse un titre bruité : %s', (nameFr) => {
    const verdict = prompt.validateOutput({ ...BASE, name_fr: nameFr }, { allowedCategories: ['Créations personnelles'] });
    expect(verdict.ok).toBe(false);
  });

  test('refuse une description qui republie une URL ou des métadonnées de source', () => {
    const verdict = prompt.validateOutput({
      ...BASE,
      name_fr: 'Coffret cadeau artistique',
      description_fr: 'Voir https://commons.wikimedia.org pour la fiche Wikimedia Commons originale.',
    }, { allowedCategories: ['Créations personnelles'] });
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.join(' ')).toMatch(/description_fr.*bruit/i);
  });
});
