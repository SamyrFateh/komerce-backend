'use strict';

const fs = require('fs');
const path = require('path');

const cssPath = path.resolve(__dirname, '../../css/modal-mobile-canonical.css');
const css = fs.readFileSync(cssPath, 'utf8');

function selectorBlocks(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`, 'g')) || [];
}

function ownerBlock(selector, signature) {
  const block = selectorBlocks(selector).find(candidate => candidate.includes(signature));
  expect(block).toBeDefined();
  return block;
}

describe('modal-mobile-canonical.css - MDM-9', () => {
  it('keeps suggestion rail sizing in the canonical owner rules', () => {
    const grid = ownerBlock('#k-modal .k-sug-grid', 'display: flex;');
    expect(grid).toContain('padding: 3px 28px 8px 14px;');
    expect(grid).toContain('gap: 10px;');

    const card = ownerBlock('#k-modal .k-sug-grid .k-sug-card', 'display: flex;');
    expect(card).toContain('flex: 0 0 128px;');
    expect(card).toContain('width: 128px;');
    expect(card).toContain('max-width: 128px;');
  });

  it('exposes the editorial entry and one-line reason labels', () => {
    expect(css).toContain('#k-modal .k-modal-sugg-peek-kicker');
    expect(css).toContain('#k-modal .k-modal-sugg-peek-copy');

    const reason = ownerBlock('#k-modal .k-sug-card-reason', 'white-space: nowrap;');
    expect(reason).toContain('text-overflow: ellipsis;');
  });

  it('keeps 44px hero touch targets and the contrast veil', () => {
    const controls = css.match(
      /#k-modal \.k-modal-back-overlay,[\s\S]*?#k-modal \.k-modal-cart-overlay\s*\{[^}]*\}/
    );

    expect(controls).not.toBeNull();
    expect(controls[0]).toContain('width: 44px;');
    expect(controls[0]).toContain('height: 44px;');

    const veil = ownerBlock(
      '#k-modal .k-modal-topbar-overlay::before',
      'linear-gradient'
    );

    expect(veil).toContain('height: 100px;');
  });
});
