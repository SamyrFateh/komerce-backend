'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * B2 #3721 — client-supplied HTML must be escaped at Hub/Relais sinks.
 * Keeps this check deliberately independent from the browser implementation.
 */
const fs = require('fs');
const path = require('path');

const src = rel => fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');

describe('B2 — Hub/Relais client HTML isolation', () => {
  const hub = src('public/hub/js/hub.js');
  const admin = src('public/dashboards/admin/js/views/HubRelaisView.js');
  const relais = src('public/relais/js/relais.js');
  const utils = src('public/boutique/js/b-utils.js');

  it('escapes injected image markup from the Hub renderer', () => {
    const source = hub.match(/function esc\(v\)\{[^\n]+\}/)?.[0];
    expect(source).toBeDefined();
    const escape = new Function('return (' + source + ')')();
    const dangerous = '<img src=x onerror=alert(1)>';
    const rendered = '<div>' + escape(dangerous) + '</div>';
    expect(rendered).not.toContain('<img');
    expect(rendered).toContain('&lt;img');
    expect(hub).toContain('esc(o.client_name');
    expect(hub).toContain('esc(o.client_phone');
    expect(hub).toContain('esc(i.description');
  });

  it('keeps client identity escaped in admin and Relay HTML templates', () => {
    for (const marker of [
      'esc(o.client_name', 'esc(p.recipient_name', 'esc(o.reference)',
      'esc(p.reference',
    ]) expect(admin).toContain(marker);
    for (const marker of [
      'esc(c.nom', 'esc(c.phone', 'esc(o.client_nom',
      'esc(it.produit',
    ]) expect(relais).toContain(marker);
  });

  it('renders boutique toast text without an HTML sink', () => {
    expect(utils).toContain('message.textContent = String(msg');
    expect(utils).not.toMatch(/dom\.toast\.innerHTML\s*=/);
  });

  it('escapes supplier, competitor and product names in Sales and PricingStrategy views', () => {
    const sales = src('public/dashboards/admin/js/views/SalesView.js');
    const pricing = src('public/dashboards/admin/js/views/PricingStrategyView.js');
    expect(sales).toContain("esc(p.name || '—')");
    for (const marker of ['esc(p.name)', 'esc(c.competitor_name)', 'esc(c.notes)']) {
      expect(pricing).toContain(marker);
    }
  });
});
