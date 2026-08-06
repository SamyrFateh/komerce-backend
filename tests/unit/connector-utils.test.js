'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/connector-utils.test.js
 * Couverture des parseurs de _connector-utils.js (feature catalog)
 */

const {
  parseStrictNumber,
  parseStrictInteger,
  parsePositiveDimension,
  STRICT_NUMBER_RE,
  STRICT_INTEGER_RE,
} = require('../../services/suppliers/connectors/_connector-utils');

describe('_connector-utils', () => {

  describe('parseStrictNumber', () => {
    it('retourne { value } pour un entier valide', () => {
      expect(parseStrictNumber('100')).toEqual({ value: 100 });
      expect(parseStrictNumber('0')).toEqual({ value: 0 });
    });
    it('retourne { value } pour un décimal valide (point ou virgule)', () => {
      expect(parseStrictNumber('12.5')).toEqual({ value: 12.5 });
      expect(parseStrictNumber('12,5')).toEqual({ value: 12.5 });
    });
    it('retourne { invalid: true } pour une valeur illisible', () => {
      expect(parseStrictNumber('abc')).toEqual({ invalid: true });
      expect(parseStrictNumber('120 USD')).toEqual({ invalid: true });
    });
    it('retourne {} pour null, undefined ou chaîne vide', () => {
      expect(parseStrictNumber(null)).toEqual({});
      expect(parseStrictNumber(undefined)).toEqual({});
      expect(parseStrictNumber('')).toEqual({});
    });
    it('accepte un number JS directement', () => {
      expect(parseStrictNumber(42)).toEqual({ value: 42 });
      expect(parseStrictNumber(Infinity)).toEqual({ invalid: true });
    });
  });

  describe('parseStrictInteger', () => {
    it('retourne { value } pour un entier valide', () => {
      expect(parseStrictInteger('42')).toEqual({ value: 42 });
      expect(parseStrictInteger('0')).toEqual({ value: 0 });
    });
    it('retourne { invalid: true } pour un décimal', () => {
      expect(parseStrictInteger('3.5')).toEqual({ invalid: true });
      expect(parseStrictInteger('3,5')).toEqual({ invalid: true });
    });
    it('retourne { invalid: true } pour une chaîne non numérique', () => {
      expect(parseStrictInteger('abc')).toEqual({ invalid: true });
      expect(parseStrictInteger('12 units')).toEqual({ invalid: true });
    });
    it('retourne {} pour null, undefined ou vide', () => {
      expect(parseStrictInteger(null)).toEqual({});
      expect(parseStrictInteger('')).toEqual({});
    });
  });

  describe('parsePositiveDimension', () => {
    it('retourne { value } pour un nombre strictement positif', () => {
      expect(parsePositiveDimension('10')).toEqual({ value: 10 });
      expect(parsePositiveDimension('0.5')).toEqual({ value: 0.5 });
    });
    it('retourne { invalid: true } pour zéro', () => {
      expect(parsePositiveDimension('0')).toEqual({ invalid: true });
    });
    it('retourne { invalid: true } pour un négatif', () => {
      expect(parsePositiveDimension('-5')).toEqual({ invalid: true });
    });
    it('retourne { invalid: true } pour une chaîne illisible', () => {
      expect(parsePositiveDimension('abc')).toEqual({ invalid: true });
    });
    it('retourne {} pour null ou vide', () => {
      expect(parsePositiveDimension(null)).toEqual({});
      expect(parsePositiveDimension('')).toEqual({});
    });
  });

  describe('regexps exportées', () => {
    it('STRICT_NUMBER_RE matche entiers et décimaux', () => {
      expect(STRICT_NUMBER_RE.test('3.14')).toBe(true);
      expect(STRICT_NUMBER_RE.test('42')).toBe(true);
      expect(STRICT_NUMBER_RE.test('abc')).toBe(false);
      expect(STRICT_NUMBER_RE.test('120 USD')).toBe(false);
    });
    it('STRICT_INTEGER_RE matche uniquement les entiers', () => {
      expect(STRICT_INTEGER_RE.test('42')).toBe(true);
      expect(STRICT_INTEGER_RE.test('3.14')).toBe(false);
      expect(STRICT_INTEGER_RE.test('-10')).toBe(true);
    });
  });

});
