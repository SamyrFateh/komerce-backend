'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');
const svc = require('../../services/cost-allocation/manual-cost-entry-service');

function executor({ order = { id: 'o1', market_id: 'm1', simulation_scope: 'RCT1' }, lines = [{ id: 'l1', price_kmf: 15000, quantity: 1 }], existing = [], event = null } = {}) {
  const calls = [];
  const query = jest.fn(async (sql, params) => {
    calls.push({ sql, params });
    if (/FROM order_cost_entry_events WHERE idempotency_key/.test(sql)) return { rows: event ? [event] : [] };
    if (/FROM orders WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: order ? [order] : [] };
    if (/SELECT order_item_id, amount_kmf, source, provenance, is_actual/.test(sql)) return { rows: existing };
    if (/FROM order_items WHERE order_id/.test(sql)) return { rows: lines };
    return { rows: [] };
  });
  return { query, calls };
}

const base = { orderId: 'o1', costType: 'sourcing', amountKmf: 300, provenance: 'FICTIF recette', reason: 'scénario E1', idempotencyKey: 'RCT1-E1-sourcing', actorId: 'u1' };
const inserts = (e) => e.calls.filter((c) => /INSERT INTO order_item_real_cost_allocations/.test(c.sql));

describe('L1 — saisie manuelle traçable', () => {
  test('ventile sur les lignes au prorata de la valeur, total conservé, source manual_entry, provenance conservée', async () => {
    const e = executor({ lines: [{ id: 'a', price_kmf: 10000, quantity: 1 }, { id: 'b', price_kmf: 2500, quantity: 2 }] });
    const r = await svc.recordManualCost(e, { ...base, amountKmf: 301 });
    expect(r.lines.reduce((s, l) => s + l.share, 0)).toBe(301);
    expect(r.lines.find((l) => l.id === 'a').share).toBeGreaterThan(r.lines.find((l) => l.id === 'b').share);
    const ins = inserts(e);
    expect(ins).toHaveLength(2);
    expect(ins[0].sql).toContain("'manual', $5, TRUE");
    expect(ins[0].params).toEqual(expect.arrayContaining(['manual_entry', 'FICTIF recette']));
    expect(e.calls.some((c) => /'manual_cost_entered'/.test(c.sql))).toBe(true);
  });

  test('montant 0 = zéro confirmé (lignes à 0), jamais un inconnu', async () => {
    const e = executor();
    const r = await svc.recordManualCost(e, { ...base, amountKmf: 0 });
    expect(r.lines[0].share).toBe(0);
    expect(inserts(e)).toHaveLength(1);
  });

  test.each(['freight', 'customs', 'port_transitaire', 'product_purchase', 'relay', 'inconnu'])('type %s refusé (collecteur automatique ou inconnu)', async (t) => {
    await expect(svc.recordManualCost(executor(), { ...base, costType: t })).rejects.toMatchObject({ code: 'MANUAL_COST_TYPE_NOT_ALLOWED' });
  });

  test('refus si un collecteur a déjà produit un réel de ce type (pas de double compte)', async () => {
    const e = executor({ existing: [{ source: 'customs_shipments', is_actual: true }] });
    await expect(svc.recordManualCost(e, base)).rejects.toMatchObject({ code: 'AUTO_COLLECTED' });
    expect(inserts(e)).toHaveLength(0);
  });

  test('saisie existante : refus, la correction est explicite', async () => {
    await expect(svc.recordManualCost(executor({ existing: [{ source: 'manual_entry', is_actual: true }] }), base)).rejects.toMatchObject({ code: 'MANUAL_COST_EXISTS' });
  });

  test('provenance, motif, clé et montant obligatoires', async () => {
    await expect(svc.recordManualCost(executor(), { ...base, provenance: ' ' })).rejects.toMatchObject({ code: 'MANUAL_COST_PROVENANCE_REQUIRED' });
    await expect(svc.recordManualCost(executor(), { ...base, reason: '' })).rejects.toMatchObject({ code: 'MANUAL_COST_REASON_REQUIRED' });
    await expect(svc.recordManualCost(executor(), { ...base, idempotencyKey: '' })).rejects.toMatchObject({ code: 'MANUAL_COST_IDEMPOTENCY_REQUIRED' });
    await expect(svc.recordManualCost(executor(), { ...base, amountKmf: -1 })).rejects.toMatchObject({ code: 'MANUAL_COST_AMOUNT_INVALID' });
  });

  test('fait simulé jamais sur activité réelle ; commande de recette : FICTIF obligatoire', async () => {
    await expect(svc.recordManualCost(executor({ order: { id: 'o1', market_id: 'm1', simulation_scope: null } }), base))
      .rejects.toMatchObject({ code: 'SIMULATED_FACT_ON_REAL_ORDER' });
    await expect(svc.recordManualCost(executor(), { ...base, provenance: 'facture 42' }))
      .rejects.toMatchObject({ code: 'REAL_FACT_ON_SIMULATED_ORDER' });
  });

  test('idempotence : rejeu = aucune écriture ; clé réutilisée ailleurs = refus', async () => {
    const e = executor({ event: { order_id: 'o1', cost_type: 'sourcing' } });
    expect(await svc.recordManualCost(e, base)).toMatchObject({ already: true });
    expect(inserts(e)).toHaveLength(0);
    await expect(svc.recordManualCost(executor({ event: { order_id: 'o2', cost_type: 'sourcing' } }), base)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  test('correction : remplace uniquement les lignes manuelles, journalise ancienne et nouvelle valeur', async () => {
    const old = [{ order_item_id: 'l1', amount_kmf: '300', source: 'manual_entry', provenance: 'FICTIF recette', is_actual: true }];
    const e = executor({ existing: old });
    const r = await svc.correctManualCost(e, { ...base, amountKmf: 350, idempotencyKey: 'RCT1-E1-sourcing-c1' });
    expect(r).toMatchObject({ corrected: true, amount_kmf: 350 });
    const del = e.calls.find((c) => /DELETE FROM order_item_real_cost_allocations/.test(c.sql));
    expect(del.sql).toContain('source = $3');
    expect(del.params).toEqual(['o1', 'sourcing', 'manual_entry']);
    const ev = e.calls.find((c) => /'manual_cost_corrected'/.test(c.sql));
    expect(JSON.parse(ev.params[3]).lines).toEqual(old);
  });

  test('les collecteurs automatiques n’écrivent ni n’effacent les types manuels', () => {
    const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
    for (const rel of ['services/cost-allocation/allocate.js', 'services/transport-cost-allocation.js']) {
      const src = read(rel);
      for (const t of svc.MANUAL_COST_TYPES) {
        expect(src).not.toMatch(new RegExp(`VALUES \\([^)]*'${t}'`));
      }
      // Les effacements automatiques sont bornés à un colis, une expédition, une source ou un type automatique.
      const deletes = src.match(/DELETE FROM order_item_real_cost_allocations[\s\S]*?`/g) || src.match(/DELETE FROM order_item_real_cost_allocations[^']*'/g) || [];
      for (const d of deletes) expect(d).toMatch(/shipment_id|parcel_id|source|product_purchase/);
    }
  });
});
