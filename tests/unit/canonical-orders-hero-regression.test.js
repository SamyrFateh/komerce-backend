'use strict';

/** @test-kind unit @test-runner jest @test-requires none
 * Preserve the illustrated Hero on the actual Commandes list, not only on Order 360.
 */
const fs = require('fs');
const path = require('path');
const orders = require('../../public/dashboards/canonical/js/orders');

function node(tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(), className: '', children: [], attributes: {},
    listeners: {}, textContent: '',
    appendChild(child) { this.children.push(child); return child; },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    addEventListener(key, listener) { this.listeners[key] = listener; },
    classList: { add() {} },
  };
  return el;
}
function find(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children) {
    const match = find(child, predicate);
    if (match) return match;
  }
  return null;
}
const payload = {
  summary: {cash_to_confirm: 1,orders_to_order: 1,awaiting_hub_reception: 0,
    parcels_to_create: 0,active_orders: 2 },
  signals: {commandes_bloquees: 0, paiements_en_attente: 1,
    retraits_en_retard: 0, litiges_ouverts: 0},
  work_queues: {
    pending_cash: [{reference:'CMD-KM-1',status:'pending',payment_status:'pending',
      market_code:'KM',total_kmf:25000,product_lines:1,parcel_count:0}],
    to_order: [{reference:'CMD-KM-2',status:'confirmed',market_code:'KM',
      total_kmf:12000,product_lines:1,parcel_count:0}],
  },
  priority_orders: [],
};

test('Commandes has the real canonical illustrated Hero, before all business content', async () => {
  const root = node('main');
  const doc = {createElement: tag => node(tag)};
  const view = {resolveMarketView: () => ({mode:'global'})};
  const fetch = jest.fn(async () => ({ok:true,json:async()=>payload}));
  await orders.mount({root,document:doc,fetch,adminContext:{},contextContract:view});
  expect(root.children).toHaveLength(1);
  const page = root.children[0];
  expect(page.attributes['data-dashboard-id']).toBe('orders');
  expect(page.attributes['data-dashboard-hierarchy']).toBe('hero-attention-primary-secondary');
  expect(page.className).toContain('kmc-domain-cockpit');
  const hero = page.children[0];
  expect(hero.tagName).toBe('HEADER');
  expect(hero.attributes['data-dashboard-role']).toBe('hero');
  expect(hero.className).toContain('kmc-dashboard-header');
  expect(hero.children.map(x=>x.textContent)).toEqual([
    'COMMERCE · COMMANDES', 'Commandes',
    expect.stringContaining('Ouvrez le dossier 360'),
  ]);
  expect(page.children[1].attributes['data-dashboard-role']).toBe('attention');
  expect(page.children[2].attributes['data-dashboard-role']).toBe('primary');

  const tab = find(page,x=>x.attributes['data-ord-tab']==='cash');
  expect(tab).not.toBeNull();
  tab.listeners.click();
  const after = root.children.at(-1);
  expect(after.children[0].attributes['data-dashboard-role']).toBe('hero');
  expect(after.children[0].children[1].textContent).toBe('Commandes');
});

test('existing illustration and styling activate by canonical role, not by a fake image URL', () => {
  const base = path.resolve(__dirname,'../../public/dashboards/canonical');
  const css = fs.readFileSync(path.join(base,'css/contextual-heroes-v2.css'),'utf8');
  const shell = fs.readFileSync(path.join(base,'css/komerce-layout-canon-v1.css'),'utf8');
  expect(css).toContain('[data-dashboard-id="orders"] > .kmc-dashboard-header::before');
  expect(css).toContain('/dashboards/canonical/assets/orders-hero-gold.svg');
  expect(shell).toContain('[data-dashboard-role="hero"].kmc-dashboard-header');
  expect(fs.existsSync(path.join(base,'assets/orders-hero-gold.svg'))).toBe(true);
});
