'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.resolve(__dirname, '../../css/layout.css'), 'utf8');

describe('layout — hiérarchie des surfaces', () => {
  it('utilise une toile blanche sur mobile et desktop', () => {
    expect(css).toMatch(/html,\s*body\s*\{[^}]*background:\s*var\(--white\)/s);
    expect(css).toMatch(/#k-page-scroll,\s*#k-catalog-section\s*\{[^}]*background:\s*var\(--white\)/s);
  });
});
