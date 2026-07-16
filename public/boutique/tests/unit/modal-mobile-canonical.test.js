'use strict';

const fs = require('fs');
const path = require('path');

const CSS_PATH = path.join(__dirname, '../../css/modal-mobile-canonical.css');

describe('modal-mobile-canonical — MDM-9 gallery modes', () => {
  const css = fs.readFileSync(CSS_PATH, 'utf8');

  test('single mode uses a compact visual-viewport height', () => {
    expect(css).toMatch(/data-gallery-mode=["']single["']/);
    expect(css).toMatch(/--k-modal-vvh[^;]*\*\s*0\.36/);
    expect(css).toMatch(/min-height:\s*150px/);
  });

  test('multiple mode preserves the canonical 48 percent gallery', () => {
    expect(css).toMatch(/data-gallery-mode=["']multiple["']/);
    expect(css).toMatch(/--k-modal-vvh[^;]*\*\s*0\.48/);
    expect(css).toMatch(/min-height:\s*180px/);
  });

  test('subject scale applies only to the single-image slide', () => {
    expect(css).toMatch(/data-gallery-mode=["']single["'][^}]*\.k-modal-slide\s*\{/s);
    expect(css).toMatch(/scale\(var\(--k-modal-subject-scale,\s*1\)\)/);
    expect(css).not.toMatch(/data-gallery-mode=["']multiple["'][^}]*--k-modal-subject-scale/s);
  });

  test('keeps the Samsung visual viewport owner as the height source', () => {
    expect(css).toMatch(/calc\(var\(--k-modal-vvh,\s*100dvh\)\s*\*\s*0\.36\)/);
    expect(css).toMatch(/calc\(var\(--k-modal-vvh,\s*100dvh\)\s*\*\s*0\.48\)/);
  });
});
