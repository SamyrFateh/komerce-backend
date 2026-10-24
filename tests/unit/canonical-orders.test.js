/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

'use strict';

const fs = require('fs');
const path = require('path');
const adminContextContract = require('../../public/dashboards/canonical/js/admin-context');
const orders = require('../../public/dashboards/canonical/js/orders');

const payload = {
  work_queues: {
    pending_cash: [{ reference: 'CMD-1', status: 'pending', total_kmf: 1000, payment_mode: 'cash' }],
    ready_for_parcel: [{ reference: 'CMD-2', status: 'confirmed', total_kmf: 2000 }, { reference: 'CMD-1', status: 'pending', total_kmf: 1000 }],
  },
  priority_orders: [{ reference: 'CMD-3', client_name: 'A', status: 'available', payment_status: 'paid', problem: 'Retrait relais en retard' }],
};

describe('canonical orders view (lecture seule sur la projection dashboard-orders)', () => {
  test('buildRows fusionne les files serveur sans recalcul ni doublon', () => {
    const rows = orders.buildRows(payload);
    expect(rows.map(r => r.reference)).toEqual(['CMD-1', 'CMD-2', 'CMD-3']);
    expect(rows[0].queues).toEqual(['cash', 'parcel']);
    expect(rows[0].action).toBe('Confirmer le paiement');
    expect(rows[2].action).toBe('Retrait relais en retard');
  });

  test('endpoint global et marché dérivés du contexte serveur', () => {
    const ctx = { actor: { id: 'hq-admin', role: 'admin' }, access: { mode: 'global', allowedMarkets: ['CM'], defaultMarket: null, capabilities: ['dashboard.market.read'] } };
    expect(() => orders.endpointForContext(ctx, undefined, null)).toThrow('canonical_orders_admin_context_contract_missing');
    expect(orders.endpointForContext(ctx, adminContextContract, null)).toBe('/api/admin/dashboard/orders');
  });

  test('aucune nouvelle taxonomie : statuts affichés = statuts existants, pas de fetch hors projection', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/orders.js'), 'utf8');
    expect(src).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'/);
    expect(Object.keys(orders.STATUS_LABELS)).toEqual(expect.arrayContaining(['pending', 'confirmed', 'collected']));
  });
  test('buildRows relaie marché, produits et colis tels que servis (null conservé, jamais 0)', () => {
    const rows = orders.buildRows({ work_queues: { ready_for_parcel: [
      { reference: 'A', status: 'confirmed', market_code: 'KM', product_lines: 2, first_product_name: 'Coque', parcel_count: 0 },
      { reference: 'B', status: 'confirmed' },
    ] } });
    expect(rows[0]).toMatchObject({ market_code: 'KM', product_lines: 2, first_product_name: 'Coque', parcel_count: 0 });
    expect(rows[1]).toMatchObject({ market_code: null, parcel_count: undefined });
  });
});

describe('L8 — trois files de prochaine action', () => {
  const ordersModule = require('../../public/dashboards/canonical/js/orders.js');
  const payload = { work_queues: {
    to_order: [{ reference: 'CMD-A', status: 'confirmed', market_code: 'KM', next_action: { label: 'À commander' } }],
    awaiting_hub_reception: [{ reference: 'CMD-B', status: 'ordered', next_action: { label: 'En attente de réception Hub (2/5)' } }],
    ready_for_parcel: [{ reference: 'CMD-C', status: 'ordered', next_action: { label: 'Préparer le colis' } }],
  } };

  test('chaque commande porte l’action serveur ; l’attente n’est pas actionnable', () => {
    const rows = ordersModule.buildRows(payload);
    expect(rows.map(r => [r.reference, r.action, r.actionable, r.queues[0]])).toEqual([
      ['CMD-A', 'À commander', true, 'to_order'],
      ['CMD-B', 'En attente de réception Hub (2/5)', false, 'awaiting'],
      ['CMD-C', 'Préparer le colis', true, 'parcel'],
    ]);
    expect(rows.some(r => /Créer le colis/.test(r.action))).toBe(false);
  });

  test('onglets et lien Hub live › Exécution avec le marché', () => {
    expect(ordersModule.TABS.map(t => t.label)).toEqual(expect.arrayContaining(['À commander', 'En attente de réception Hub', 'Préparer le colis']));
    expect(ordersModule.hubExecutionHref('KM')).toBe('/admin/hub-live?view=execute&market=KM');
  });
});

describe('RCT1 renders via the same canonical screen without live actions', () => {
  test('one renderer for real and RCT1; no alternative table-only renderer', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/orders.js'), 'utf8');
    expect(src).not.toContain('function renderRct1(');
    expect(src).toContain('render(doc, rootNode, payload, { tab:');
    expect(src).toContain("const isRecette = payload.simulation_scope === 'RCT1'");
    expect(src).toContain('renderDetail(doc, selected, isRecette)');
  });
  test('RCT1 rows reuse the same navigation and queue contracts', () => {
    const rows = orders.buildRows({
      work_queues: { pending_cash: [], to_order: [], awaiting_hub_reception: [], ready_for_parcel: [] },
      priority_orders: [
        { reference: 'RCT1-E1', status: 'collected', market_code: 'KM', problem: 'Consultation RCT1', actionable: false },
        { reference: 'RCT1-CM1', status: 'cancelled', market_code: 'CM', problem: 'Consultation RCT1', actionable: false },
      ],
    });
    expect(rows.map(r => r.reference)).toEqual(['RCT1-E1', 'RCT1-CM1']);
    expect(rows.every(r => r.actionable === false)).toBe(true);
  });
});


test('canonical Orders uses a fresh cache key after RCT1 response contract change', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/index.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/orders.js'), 'utf8');
  expect(html).toContain('/dashboards/canonical/js/orders.js?v=261024-2');
  expect(js).not.toContain('function renderRct1(');
  expect(js).toContain("payload.simulation_scope === 'RCT1'");
});
