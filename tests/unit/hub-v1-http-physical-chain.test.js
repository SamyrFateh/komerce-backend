'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const src = fs.readFileSync(path.join(root, 'scripts/recette/hub-v1-http-physical-chain.js'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'routes/admin-operations-workspace.js'), 'utf8');

describe('chaine physique HTTP : memes routes que l UI', () => {
  test('n appelle ni /api/hub/* ni /api/scans/collect (interdits au front)', () => {
    const code = src.split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n');
    expect(code).not.toMatch(/['"`]\/api\/hub\//);
    expect(code).not.toMatch(/\/api\/scans\/collect/);
  });
  test('chaque route du workspace utilisee existe cote backend', () => {
    for (const tail of ['/supply/physical-code', '/bags', '/bags/:unitId/deposit', '/bags/:unitId/close', '/boxes', '/boxes/:unitId/bags', '/boxes/shipment', '/relay-shipments/:reference/receive', '/parcels/:reference/collect']) {
      expect(routes).toContain(`'/market/:marketCode${tail}'`);
    }
  });
  test('chaque ligne cite le fichier:ligne du front et les refus de roles sont attendus 403', () => {
    expect(src).toMatch(/operations-workspace\.js/);
    expect((src.match(/\$\{JS\}:\d+/g) || []).length).toBeGreaterThanOrEqual(8);
    expect(src).toMatch(/deny: true/);
  });
});

const { assess } = require('../../scripts/recette/staging-local-stock-real-relay-cert');

function localSnapshot(phase = 'before') {
  const after = phase !== 'before';
  const collected = phase === 'collected';
  return {
    order: { relais_id: 'r', status: collected ? 'collected' : after ? 'available' : 'ordered',
      payment_status: 'paid', stripe_payment_id: null, cash_paid_at: null },
    parcels: after ? [{ id: 'p', reference: 'LOCAL-P', relais_id: 'r', status: collected ? 'collected' : 'available',
      shipment_id: null, shipped_at: null, in_transit_at: null }] : [],
    lines: [{ quantity: 2, fulfillment_source: 'LOCAL_STOCK',
      qty_shipped: after ? 0 : null, qty_received: after ? 2 : null, qty_collected: collected ? 2 : 0 }],
    counts: { purchase_lines: 0, purchase_orders: 0, hub_allocations: 0,
      hub_units: 0, shipment_receipts: 0, shipped_scans: 0, shipping_history: 0,
      cash_collections: 0, consumed_allocations: 2, collected_history: collected ? 1 : 0,
      relay_receipts: after ? 1 : 0, available_history: after ? 1 : 0 },
  };
}

describe('LOCAL_STOCK: preuve dediee sans detour Hub', () => {
  test('le runner historique ne constitue pas une certification locale', () => {
    expect(src).toMatch(/local:ship/);
    expect(fs.readFileSync(path.join(root, 'scripts/recette/staging-local-stock-real-relay-cert.js'), 'utf8'))
      .toContain('/local-relay-receipt');
  });
  test('avant reception: exclusivement stock local, commande payee, aucun colis', () => {
    expect(assess(localSnapshot(), 'before')).toEqual([]);
  });
  test('reception physique et retrait au relais restent sans Hub ni transport fictif', () => {
    expect(assess(localSnapshot('available'), 'available')).toEqual([]);
    expect(assess(localSnapshot('collected'), 'collected')).toEqual([]);
  });
  test('un parcours Hub, une PO, une expedition ou un historique shipped invalident la preuve', () => {
    const cases = [
      s => { s.counts.hub_allocations = 1; },
      s => { s.counts.purchase_lines = 1; },
      s => { s.parcels[0].shipment_id = 'ship'; },
      s => { s.counts.shipped_scans = 1; },
      s => { s.counts.shipping_history = 1; },
      s => { s.lines[0].qty_shipped = 2; },
      s => { s.counts.consumed_allocations = 1; },
      s => { s.parcels[0].relais_id = 'other'; },
    ];
    for (const mutate of cases) {
      const s = localSnapshot('available');
      mutate(s);
      expect(assess(s, 'available').length).toBeGreaterThan(0);
    }
  });
  test('une attestation absente ou une commande deja distribuee refusent le PASS', () => {
    const noProof = localSnapshot('available');
    noProof.counts.relay_receipts = 0;
    expect(assess(noProof, 'available')).toContain('LOCAL_RECEIPT_PROOF_COUNT');
    const already = localSnapshot('available');
    expect(assess(already, 'before')).toContain('LOCAL_ALREADY_HAS_PARCEL');
  });
});
