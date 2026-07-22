'use strict';

const fs = require('fs');
const path = require('path');

describe('b-bus — registre des événements', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../js/b-bus.js'),
    'utf8'
  );

  test('modal:detail-ready est déclaré parmi les événements standard', () => {
    expect(source).toMatch(
      /Événements standard Komerce[\s\S]*\*\s+modal:detail-ready\b/
    );
  });

  test('modal:detail-ready n’est pas déclaré comme événement retiré', () => {
    const retiredSection = source.split(
      'Événements retirés du JSDoc'
    )[1] || '';

    expect(retiredSection).not.toContain('modal:detail-ready');
  });
});