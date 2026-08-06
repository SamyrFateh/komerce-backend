'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('fs');
const path = require('path');

describe('interactions.css — séparation catalogue et modale', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '../../css/interactions.css'),
    'utf8'
  );

  test('la variante catalogue possède sa classe dédiée', () => {
    expect(css).toContain('.k-catalog-sug-add');
    expect(css).toContain('.k-catalog-sug-add:active');
    expect(css).toContain('.k-catalog-sug-add img');
  });

  test('interactions.css ne possède plus la classe modale', () => {
    expect(css).not.toMatch(/(^|\n)\s*\.k-sug-add(?:[:\s,{])/m);
  });
});