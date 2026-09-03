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
    expect(css).not.toMatch(/(^|\n)\s*\.k-card-name\s*\{/);
    expect(css).not.toMatch(/(^|\n)\s*\.k-card-price\s*\{/);
  });

  it('parle le même langage de section que le catalogue', () => {
    expect(css).toMatch(/\.k-discovery-header\s*\{[\s\S]*?border-bottom:\s*2px solid var\(--sand-dark\)/);
    expect(css).toMatch(/\.k-discovery-title\s*\{[\s\S]*?font-family:\s*var\(--font-display\)/);
    expect(css).toMatch(/\.k-discovery-title\s*\{[\s\S]*?color:\s*var\(--text\)/);
    expect(css).toMatch(/\.k-discovery-market\s*\{[\s\S]*?background:\s*var\(--sand-dark\)/);
  });

  it('reprend exactement la géométrie 4 colonnes / média carré du catalogue', () => {
    expect(css).toMatch(/\.k-discovery-rail\s*\{[\s\S]*?gap:\s*16px/);
    expect(css).toMatch(/\.k-discovery-canonical-card\s*\{[\s\S]*?calc\(\(100% - 48px\) \/ 4\)/);
    expect(css).toMatch(/\.k-discovery-canonical-card\s*\{[\s\S]*?min-width:\s*calc\(\(100% - 48px\) \/ 4\)/);
    expect(css).toMatch(/\.k-discovery-canonical-card\s*\{[\s\S]*?max-width:\s*none/);
    expect(css).toMatch(/\.k-discovery-canonical-media\s*\{[\s\S]*?aspect-ratio:\s*1 \/ 1/);
    expect(css).not.toContain('/ 5.2');
    expect(css).not.toContain('aspect-ratio: 4 / 3');
  });

  it('garde les trois verbes dans le slot action canonique', () => {
    expect(css).toContain('.k-discovery-canonical-action-slot');
    expect(css).toContain('[data-discovery-kind="physical_offer"] .k-discovery-canonical-action-slot');
    expect(css).toContain('[data-discovery-kind="service"] .k-discovery-canonical-action-slot');
    expect(css).toContain('.k-discovery-canonical-cta:focus-visible');
  });
});
