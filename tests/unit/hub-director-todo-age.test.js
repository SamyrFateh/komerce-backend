/**
 * H4 (#3998) — ancienneté des tâches du dossier Hub, colis arrivé à rapprocher (HB-08), commande bloquée par rupture
 * (HB-02) et vue directrice tous marchés (alerte au-delà de 48 h). Lecture seule.
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';

const { getDossier, getDirectorTodo, withAge } = require('../../services/hub-procurement-dossier');

const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const NOW = new Date('2026-11-13T12:00:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString();

function reader({ items = [], parcels = [], blocked = [], queued = [], markets = null } = {}) {
  return {
    query: jest.fn(async (sql) => {
      if (markets && /FROM markets WHERE is_active/.test(sql)) return { rows: markets };
      if (/FROM orders o/.test(sql) && /JOIN order_items oi ON oi.order_id = o.id/.test(sql)) return { rows: items };
      if (/u\.unit_type = 'SUPPLIER_PACKAGE' AND u\.state = 'RECEIVED'/.test(sql)) return { rows: parcels };
      if (/bool_and\(v\.cancelled/.test(sql)) return { rows: blocked };
      if (/COUNT\(DISTINCT p.id\)::int AS open_parcels/.test(sql)) return { rows: queued };
      return { rows: [] };
    }),
  };
}
const item = (n, extra = {}) => ({
  order_id: id(2), order_ref: 'KR1', order_status: 'ordered', order_created_at: hoursAgo(60),
  order_item_id: id(n), product_id: id(n + 100), sku_id: id(n + 200), product_name: 'Article',
  fulfillment_source: 'IMPORT', ordered: 2, purchase_covered: 0, supplier_mapping_present: false, ...extra,
});

describe('withAge', () => {
  it('âge en heures entières, alerte à partir de 48 h, date inconnue sans alerte', () => {
    expect(withAge({ since: hoursAgo(47.5) }, NOW)).toMatchObject({ age_hours: 47, overdue: false });
    expect(withAge({ since: hoursAgo(48) }, NOW)).toMatchObject({ age_hours: 48, overdue: true });
    expect(withAge({}, NOW)).toMatchObject({ since: null, age_hours: null, overdue: false });
  });
});

describe('dossier — tâches datées et nouvelles tâches', () => {
  it('chaque tâche porte since / age_hours / overdue (sourcing requis daté de la commande)', async () => {
    const d = await getDossier({ marketId: id(1), now: NOW }, reader({ items: [item(3)] }));
    const t = d.cockpit.todo.find((x) => x.kind === 'SOURCING_REQUIRED');
    expect(t).toMatchObject({ age_hours: 60, overdue: true });
  });

  it('HB-08 : colis arrivé sans contenu → tâche RECONCILE_PARCEL avec son âge', async () => {
    const d = await getDossier({ marketId: id(1), now: NOW }, reader({ parcels: [{ unit_id: id(50), reference: 'KOM-PKG-1', created_at: hoursAgo(30) }] }));
    expect(d.cockpit.todo).toEqual([expect.objectContaining({
      id: `RECONCILE_PARCEL:${id(50)}`, kind: 'RECONCILE_PARCEL', age_hours: 30, overdue: false,
    })]);
  });

  it('HB-02 : commande bloquée par rupture → tâche BLOCKED_BY_SHORTFALL, quantité non couverte', async () => {
    const d = await getDossier({ marketId: id(1), now: NOW }, reader({
      items: [item(3, { purchase_covered: 1, supplier_mapping_present: true })],
      blocked: [{ order_id: id(2), order_ref: 'KR1', order_item_id: id(3), ordered: 2, covered: 1, since: hoursAgo(72) }],
    }));
    const t = d.cockpit.todo.find((x) => x.kind === 'BLOCKED_BY_SHORTFALL');
    expect(t).toMatchObject({ subject: { order_id: id(2) }, age_hours: 72, overdue: true, severity: 'anomaly' });
    expect(t.missing).toMatch(/1 u non couvertes/);
  });
});

describe('vue directrice — tous marchés', () => {
  it('fusionne les marchés actifs, plus ancienne d\'abord, dédoublonne un colis sans marché, compte les alertes', async () => {
    const parcels = [{ unit_id: id(50), reference: 'KOM-PKG-1', created_at: hoursAgo(10) }];
    const markets = [{ id: id(1), code: 'CM', name: 'Cameroun' }, { id: id(9), code: 'KM', name: 'Comores' }];
    const q = reader({ items: [item(3)], parcels, markets });
    const out = await getDirectorTodo({ now: NOW }, q);
    expect(out.scope).toBe('ALL_MARKETS');
    expect(out.overdue_after_hours).toBe(48);
    expect(out.tasks.filter((t) => t.kind === 'RECONCILE_PARCEL')).toHaveLength(1);
    // Une tâche opérationnelle de même identifiant local dans CM et KM doit apparaître deux fois.
    expect(out.tasks.filter((t) => t.kind === 'SOURCING_REQUIRED')).toHaveLength(2);
    expect(out.tasks[0].overdue).toBe(true);
    expect(out.tasks[0].market.code).toBe('CM');
    expect(out.overdue_count).toBeGreaterThanOrEqual(1);
    const ages = out.tasks.map((t) => t.age_hours);
    expect(ages).toEqual([...ages].sort((a, b) => b - a));
  });
});

describe('HB-12 : file de colis locaux saturés exposée au cockpit directrice', () => {
  it('la commande non affectable est visible avec relais et âge sans nouveau writer', async () => {
    const q = reader({ queued: [{
      order_id: id(60), order_ref: 'KQ60', relais_name: 'Relais Nord',
      open_parcels: 3, since: hoursAgo(52),
    }] });
    const dossier = await getDossier({ marketId: id(1), now: NOW }, q);
    expect(dossier.cockpit.todo).toEqual([expect.objectContaining({
      id: `PARCEL_CAPACITY_WAIT:${id(60)}`, kind: 'PARCEL_CAPACITY_WAIT',
      age_hours: 52, overdue: true, severity: 'anomaly',
      missing: expect.stringContaining('Relais Nord (3 ouverts)'),
    })]);
    const sql = q.query.mock.calls.map(args => args[0]).find(x => x.includes('COUNT(DISTINCT p.id)::int AS open_parcels'));
    expect(sql).toContain("COALESCE(oi.fulfillment_source, '') <> 'IMPORT'");
    expect(sql).toContain('HAVING COUNT(DISTINCT p.id) >= 3');
    expect(sql).toContain('AND BOOL_AND(');
  });
});
