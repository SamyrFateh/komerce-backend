'use strict';

const { normalizeName, namesMatch } = require('../../utils/name-normalize');

describe('normalizeName', () => {
  test('null/undefined/non-string ne crashent pas', () => {
    expect(normalizeName(null)).toBe('');
    expect(normalizeName(undefined)).toBe('');
    expect(normalizeName(42)).toBe('42');
  });

  test('casse ignorée', () => {
    expect(normalizeName('ELEONORE')).toBe(normalizeName('eleonore'));
  });

  test('accents ignorés', () => {
    expect(normalizeName('ÉLÉONORE')).toBe(normalizeName('Eleonore'));
    expect(normalizeName('François')).toBe(normalizeName('Francois'));
  });

  test('espaces multiples et bordures collapsés', () => {
    expect(normalizeName('  Jean   Pierre  ')).toBe(normalizeName('Jean Pierre'));
  });

  test('trait d\'union équivalent à un espace', () => {
    expect(normalizeName('JEAN-PIERRE')).toBe(normalizeName('Jean Pierre'));
    expect(normalizeName('Marie-Claire')).toBe(normalizeName('Marie Claire'));
  });

  test('variantes de tiret (cadratin, demi-cadratin) traitées comme trait d\'union', () => {
    expect(normalizeName('Jean\u2013Pierre')).toBe(normalizeName('Jean Pierre'));
    expect(normalizeName('Jean\u2014Pierre')).toBe(normalizeName('Jean Pierre'));
  });

  test('apostrophes typographiques unifiées', () => {
    expect(normalizeName('N\u2019Diaye')).toBe(normalizeName("N'Diaye"));
  });

  test('espace insécable traité comme un espace normal', () => {
    expect(normalizeName('Jean\u00A0Pierre')).toBe(normalizeName('Jean Pierre'));
  });

  test('ne fait AUCUNE correspondance partielle ou floue', () => {
    expect(normalizeName('Jean')).not.toBe(normalizeName('Jean-Paul'));
    expect(normalizeName('Fatima')).not.toBe(normalizeName('Fatma')); // pas de Levenshtein
  });
});

describe('namesMatch', () => {
  test('correspondance stricte après normalisation', () => {
    expect(namesMatch(
      { givenNames: 'ÉLÉONORE', familyName: 'Bacar' },
      { givenNames: 'eleonore', familyName: 'BACAR' },
    )).toBe(true);
  });

  test('trait d\'union vs espace côté formulaire agent', () => {
    expect(namesMatch(
      { givenNames: 'Jean Pierre', familyName: 'Ali' },
      { givenNames: 'JEAN-PIERRE', familyName: 'ali' },
    )).toBe(true);
  });

  test('mismatch sur le prénom seul → false', () => {
    expect(namesMatch(
      { givenNames: 'Fatima', familyName: 'Said' },
      { givenNames: 'Fatouma', familyName: 'Said' },
    )).toBe(false);
  });

  test('mismatch sur le nom seul → false', () => {
    expect(namesMatch(
      { givenNames: 'Fatima', familyName: 'Said' },
      { givenNames: 'Fatima', familyName: 'Saidi' },
    )).toBe(false);
  });

  test('deux paires vides ne matchent jamais', () => {
    expect(namesMatch(
      { givenNames: '', familyName: '' },
      { givenNames: '', familyName: '' },
    )).toBe(false);
    expect(namesMatch(
      { givenNames: null, familyName: null },
      { givenNames: undefined, familyName: undefined },
    )).toBe(false);
  });

  test('pas de correspondance par initiales', () => {
    expect(namesMatch(
      { givenNames: 'J', familyName: 'Ali' },
      { givenNames: 'Jean', familyName: 'Ali' },
    )).toBe(false);
  });

  test('pas de permutation libre des mots', () => {
    expect(namesMatch(
      { givenNames: 'Jean Pierre', familyName: 'Ali' },
      { givenNames: 'Pierre Jean', familyName: 'Ali' },
    )).toBe(false);
  });
});
