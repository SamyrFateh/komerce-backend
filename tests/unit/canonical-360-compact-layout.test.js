'use strict';

/** @test-kind unit @test-runner jest @test-requires none
 * Navigation ownership contract for the compact desktop 360 dossiers.
 */
const order360 = require('../../public/dashboards/canonical/js/order-360');
const client360 = require('../../public/dashboards/canonical/js/client-360');

function node(tag = 'div') {
  return {
    tagName: tag.toLowerCase(), className: '', textContent: '', children: [],
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    setAttribute: jest.fn(), addEventListener: jest.fn(),
    querySelector(selector) {
      return selector === '.kmc-entity-extras'
        ? this.children.find(child => child.className === 'kmc-entity-extras') || null
        : null;
    },
  };
}
function harness() {
  const root = node('main');
  const doc = { createElement: jest.fn(tag => node(tag)) };
  const ui = {
    Section: { create: jest.fn(() => ({ element: node('section'), slot: node() })) },
    DataTable: { render: jest.fn() },
    MetricStrip: { render: jest.fn() },
    AlertPanel: { render: jest.fn() },
  };
  return { root, doc, ui };
}
function extrasOf(root) {
  return root.children.find(child => child.className === 'kmc-entity-extras');
}
test('Order 360: one relevant Client link, no competing dashboards, deep evidence folded', () => {
  const h = harness();
  order360.renderPayload(h.root,h.ui,h.doc,{
    order: {
      reference:'CMD-2026-001',status:'confirmed',
      customer:{name:'Amina',phone:'+2691234567'},
      market:{code:'KM',name:'Comores'},
      payment:{status:'pending',total_kmf:25000},
      destination:{relais:{name:'Mutsamudu'}},
    },
    summary:{items:1,items_assigned:0,parcels:0,open_incidents:1,documents:0},
    items:[{product_ref:'KPR-000001',product_name:'Produit réel',quantity:1,unit_price_kmf:25000}],
    parcels:[],history:[],scans:[],notifications:[],documents:[],invoices:[],comments:[],
    incidents:[],
  });
  const header = h.root.children[0];
  expect(header.children.find(c => c.tagName === 'span').textContent).toBe('DOSSIER COMMANDE');
  const nav = header.children.find(c => c.tagName === 'nav');
  expect(nav.children).toHaveLength(1);
  expect(nav.children[0].textContent).toBe('Client 360');
  expect(nav.children[0].setAttribute).toHaveBeenCalledWith('href',expect.stringContaining('/admin/clients/'));
  const more=extrasOf(h.root);
  expect(more).toBeDefined();
  expect(more.open).toBe(false);
  expect(more.children[0].tagName).toBe('summary');
  expect(more.children[0].textContent).toContain('Informations complémentaires');
  expect(more.children[1].children.length).toBeGreaterThanOrEqual(6);
  expect(h.root.children.some(c => c.id === 'parcours')).toBe(false);
  const keys=h.ui.MetricStrip.render.mock.calls[0][1].items.map(x=>x.key);
  expect(keys).toEqual(['status','payment','total','assigned','parcels','incidents']);
  expect(h.ui.DataTable.render).toHaveBeenCalled();
});

test('Client 360: identity and orders remain visible, other facets folded, privacy toggle survives', () => {
  const h=harness();
  const payload={
    client:{name:'Amina',phone:'+2691234567',email:'amina@test.invalid',country:'KM'},
    scope:{mode:'market',markets:[{code:'KM'}]},summary:{orders_valid:1,markets:1},
    finance:{ltv_kmf:25000,average_basket_kmf:25000},orders:[],
    top_products:[],timeline:[],security:{visibility:'restricted'},
  };
  client360.renderPayload(h.root,h.ui,h.doc,payload);
  let header=h.root.children[0];
  expect(header.children.find(c=>c.tagName==='span').textContent).toBe('DOSSIER CLIENT');
  expect(header.children.filter(c=>c.tagName==='nav')).toHaveLength(0);
  const toggle=header.children.find(c=>c.tagName==='button');
  expect(toggle.textContent).toBe('Afficher les coordonnées');
  const more=extrasOf(h.root);
  expect(more.open).toBe(false);
  expect(more.children[1].children.length).toBe(2); // products + timeline, market-limited
  const values=h.ui.DataTable.render.mock.calls[0][1].rows;
  expect(values).toContainEqual({champ:'Téléphone',valeur:'•••• 4567'});
  more.open=true;
  const click=toggle.addEventListener.mock.calls.find(call=>call[0]==='click')[1];
  click();
  expect(extrasOf(h.root).open).toBe(true);
  const newValues=h.ui.DataTable.render.mock.calls.at(-4)[1].rows;
  // Same data restored without security changes; the original privacy test
  // separately covers the exact reveal value.
  expect(h.root.children[0].children.find(c=>c.tagName==='button').textContent).toBe('Masquer les coordonnées');
});
