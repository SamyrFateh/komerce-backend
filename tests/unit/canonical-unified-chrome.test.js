'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Visual contract: one final shared stylesheet for all Canonical entrypoints.
 * Source-level assertions complement browser visual QA (desktop/mobile).
 */
const fs = require('fs');
const path = require('path');

const canonical = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const cssName = 'canonical-unified-chrome-v1.css';
const css = fs.readFileSync(path.join(canonical, 'css', cssName), 'utf8');

describe('canonical unified admin chrome', () => {
  test.each(['index.html', 'access.html', 'market-autonomy.html', 'market-catalog.html'])(
    '%s loads the same shared chrome as its last stylesheet',
    filename => {
      const html = fs.readFileSync(path.join(canonical, filename), 'utf8');
      const stylesheets = [...html.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"/g)].map(m => m[1]);
      expect(stylesheets.at(-1)).toMatch(new RegExp(`/css/${cssName.replace(/\./g, '\\.')}\\?v=`));
      expect(stylesheets.filter(href => href.includes(cssName))).toHaveLength(1);
    }
  );

  test('unifies the sidebar without changing its link destinations or permissions', () => {
    expect(css).toContain('body.kmc-shell-v4 > .kmc-admin-navigation');
    expect(css).toContain('background-image: none');
    expect(css).toContain('.kmc-admin-primary-link.is-active');
    expect(css).toContain('.kmc-admin-home-label');
    expect(css).toContain('.kmc-admin-home-mark');
    expect(css).not.toMatch(/\b(fetch|localStorage|auth|href\s*=)\b/);
  });

  test('covers overview/workspace headers and all three live cockpits', () => {
    expect(css).toContain('[data-dashboard-role="hero"]');
    expect(css).toContain('.kmc-dashboard-header');
    expect(css).toContain('.kmc-workspace-header');
    expect(css).toContain('.kmc-import-runtime .kir-hero');
    expect(css).toContain('.kmc-import-runtime .kir-hero .kir-eyebrow');
    expect(css).toContain('height: auto');
    expect(css).toContain('@media (max-width: 900px)');
    expect(css).toContain('@media (max-width: 680px)');
  });
});
