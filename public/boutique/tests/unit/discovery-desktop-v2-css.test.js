'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(
  path.join(__dirname, '../../css/discovery-desktop-v2.css'),
  'utf8'
);

describe('Discovery desktop One Card CSS contract', () => {
  it('reste strictement desktop', () => {
    expect(css).toContain('@media (min-width: 900px)');
    expect(css).not.toContain('@media (max-width: 899px)');
  });

  it('ne redéfinit jamais le shell canonique k-card', () => {
    expect(css).not.toMatch(/(^|\n)\s*\.k-card\s*\{/);
    expect(css).not.toMatch(/(^|\n)\s*\.k-card-img-wrap\s*\{/);
    expect(css).not.toMatch(/(^|\n)\s*\.k-card-info\s*\{/);
  });

  it('projette environ cinq cartes visibles sans recréer une mini-carte Discovery', () => {
    expect(css).toMatch(/\.k-discovery-canonical-card\s*\{[\s\S]*?calc\(\(100% - 48px\) \/ 5\)/);
    expect(css).toMatch(/\.k-discovery-canonical-card\s*\{[\s\S]*?min-width:\s*260px/);
    expect(css).toMatch(/\.k-discovery-canonical-card\s*\{[\s\S]*?max-width:\s*320px/);
  });

  it('garde les trois verbes dans le slot action canonique', () => {
    expect(css).toContain('.k-discovery-canonical-action-slot');
    expect(css).toContain('[data-discovery-kind="physical_offer"] .k-discovery-canonical-action-slot');
    expect(css).toContain('[data-discovery-kind="service"] .k-discovery-canonical-action-slot');
    expect(css).toContain('.k-discovery-canonical-cta:focus-visible');
  });
});
