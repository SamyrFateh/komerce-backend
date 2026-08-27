#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()

service_path = ROOT / 'services/signal-service.js'
admin_path = ROOT / 'services/signal-admin-service.js'
test_path = ROOT / 'tests/unit/signal-service.test.js'
cap_path = ROOT / 'capabilities/decision-signals.capability.js'
doctrine_path = ROOT / 'docs/doctrine/DOCTRINE_ADMIN_DASHBOARDS.md'

service = service_path.read_text()
service = service.replace(
    '@db-read       cash_collections, order_items, orders, parcels, products, users',
    '@db-read       cash_collections, orders, parcels, purchase_orders'
)
service = service.replace(
    '@impact-areas  unknown',
    '@impact-areas  decision-signals, purchasing, orders, logistics',
    1,
)
service = service.replace(
    "title:         'Colis bloqué — ' + (r.tracking_number || r.id).substring(0, 12),",
    "title:         r.tracking_number ? 'Colis bloqué — ' + r.tracking_number.substring(0, 12) : 'Colis bloqué',"
)

start = service.index('/* ── 3. stock_rupture')
end = service.index('/* ═══════════════════════════════════════════════════════════════\n   MAIN GENERATOR')
new_generators = r'''/* ═══════════════════════════════════════════════════════════════
   4H TRUTH CLEANUP — historical signal types whose names/predicates
   no longer describe a canonical business fact.
   ═══════════════════════════════════════════════════════════════ */
const OBSOLETE_SIGNAL_TYPES = Object.freeze([
  'stock_rupture',
  'margin_drift',
  'dispute_sensitive',
]);

async function retireObsoleteSignalTypes() {
  try {
    const result = await db.query(`
      UPDATE signals
         SET status = 'resolved',
             resolved_at = COALESCE(resolved_at, NOW()),
             snoozed_until = NULL,
             updated_at = NOW()
       WHERE signal_type = ANY($1::text[])
         AND status IN ('open','acknowledged','snoozed')
    `, [OBSOLETE_SIGNAL_TYPES]);
    return result.rowCount || 0;
  } catch (e) {
    log.warn({ err: e }, '[signal-service] obsolete signal retirement error:');
    return 0;
  }
}

/* ── 3. ordered_without_purchase_order: chaîne sourcing non démarrée ── */
GENERATORS.ordered_without_purchase_order = async function() {
  try {
    const rows = (await db.query(`
      SELECT o.id, o.reference,
             EXTRACT(EPOCH FROM (NOW() - COALESCE(o.ordered_at, o.updated_at, o.created_at)))::int / 60 AS minutes_waiting
        FROM orders o
       WHERE o.status = 'ordered'
         AND COALESCE(o.ordered_at, o.updated_at, o.created_at) < NOW() - INTERVAL '15 minutes'
         AND NOT EXISTS (
           SELECT 1
             FROM purchase_orders po
            WHERE po.order_id = o.id
              AND po.status != 'cancelled'
         )
       ORDER BY COALESCE(o.ordered_at, o.updated_at, o.created_at) ASC
       LIMIT 50
    `)).rows;

    let generated = 0;
    const entityIds = [];
    for (const r of rows) {
      entityIds.push(r.id);
      await upsertSignal({
        signal_type: 'ordered_without_purchase_order',
        severity: 'critical',
        title: r.reference ? 'Commande sans PO — ' + r.reference : 'Commande sans PO',
        summary: 'Commande au statut ordered depuis ' + Number(r.minutes_waiting || 0) + ' min sans bon d’achat actif',
        source_module: 'signal-service',
        target_shell: 'bo',
        target_view: 'orders',
        target_filters: { status: 'ordered' },
        owner_role: 'sourcing',
        entity_type: 'order',
        entity_id: r.id,
        recommendation: 'Relancer le déclenchement sourcing et vérifier le mapping fournisseur',
        confidence: 'high',
        meta: { minutes_waiting: Number(r.minutes_waiting || 0) }
      });
      generated++;
    }
    await autoResolveSignals('ordered_without_purchase_order', entityIds);
    return { generated };
  } catch (e) {
    log.warn({ err: e }, '[signal-service] ordered_without_purchase_order error:');
    return { generated: 0, error: e.message };
  }
};

/* ── 4. purchase_order_overreceived: intégrité quantité PO ── */
GENERATORS.purchase_order_overreceived = async function() {
  try {
    const rows = (await db.query(`
      SELECT o.id, o.reference,
             COUNT(*)::int AS po_count,
             SUM(po.received_qty - po.qty)::int AS excess_qty
        FROM purchase_orders po
        JOIN orders o ON o.id = po.order_id
       WHERE po.status != 'cancelled'
         AND po.received_qty > po.qty
       GROUP BY o.id, o.reference
       ORDER BY SUM(po.received_qty - po.qty) DESC
       LIMIT 50
    `)).rows;

    let generated = 0;
    const entityIds = [];
    for (const r of rows) {
      entityIds.push(r.id);
      await upsertSignal({
        signal_type: 'purchase_order_overreceived',
        severity: 'critical',
        title: r.reference ? 'Réception PO incohérente — ' + r.reference : 'Réception PO incohérente',
        summary: Number(r.po_count || 0) + ' PO avec quantité reçue supérieure à la quantité commandée · excédent ' + Number(r.excess_qty || 0),
        source_module: 'signal-service',
        target_shell: 'bo',
        target_view: 'purchasing',
        target_filters: {},
        owner_role: 'hub',
        entity_type: 'order',
        entity_id: r.id,
        recommendation: 'Vérifier la réception fournisseur avant toute correction de donnée',
        confidence: 'high',
        meta: { po_count: Number(r.po_count || 0), excess_qty: Number(r.excess_qty || 0) }
      });
      generated++;
    }
    await autoResolveSignals('purchase_order_overreceived', entityIds);
    return { generated };
  } catch (e) {
    log.warn({ err: e }, '[signal-service] purchase_order_overreceived error:');
    return { generated: 0, error: e.message };
  }
};

/* ── 5. purchase_order_receipt_stuck: PO complètes, commande encore ordered ── */
GENERATORS.purchase_order_receipt_stuck = async function() {
  try {
    const rows = (await db.query(`
      SELECT o.id, o.reference,
             COUNT(*)::int AS po_count,
             EXTRACT(EPOCH FROM (NOW() - MAX(po.hub_received_at)))::int / 60 AS minutes_stuck
        FROM orders o
        JOIN purchase_orders po
          ON po.order_id = o.id
         AND po.status != 'cancelled'
       WHERE o.status = 'ordered'
       GROUP BY o.id, o.reference
      HAVING COUNT(*) > 0
         AND BOOL_AND(po.received_qty >= po.qty AND po.hub_received_at IS NOT NULL)
         AND MAX(po.hub_received_at) < NOW() - INTERVAL '15 minutes'
       ORDER BY MAX(po.hub_received_at) ASC
       LIMIT 50
    `)).rows;

    let generated = 0;
    const entityIds = [];
    for (const r of rows) {
      entityIds.push(r.id);
      await upsertSignal({
        signal_type: 'purchase_order_receipt_stuck',
        severity: 'warning',
        title: r.reference ? 'PO reçues, commande bloquée — ' + r.reference : 'PO reçues, commande bloquée',
        summary: Number(r.po_count || 0) + ' PO complètes mais commande toujours ordered depuis ' + Number(r.minutes_stuck || 0) + ' min',
        source_module: 'signal-service',
        target_shell: 'bo',
        target_view: 'orders',
        target_filters: { status: 'ordered' },
        owner_role: 'hub',
        entity_type: 'order',
        entity_id: r.id,
        recommendation: 'Vérifier la transition ordered → preparation et les scans de réception Hub',
        confidence: 'high',
        meta: { po_count: Number(r.po_count || 0), minutes_stuck: Number(r.minutes_stuck || 0) }
      });
      generated++;
    }
    await autoResolveSignals('purchase_order_receipt_stuck', entityIds);
    return { generated };
  } catch (e) {
    log.warn({ err: e }, '[signal-service] purchase_order_receipt_stuck error:');
    return { generated: 0, error: e.message };
  }
};

/* ── 6. pickup_overdue: disponible relais > 7 jours ── */
GENERATORS.pickup_overdue = async function() {
  try {
    const rows = (await db.query(`
      SELECT o.id, o.reference,
             EXTRACT(DAY FROM NOW() - o.available_at)::int AS days_waiting
        FROM orders o
       WHERE o.status = 'available'
         AND o.available_at IS NOT NULL
         AND o.available_at < NOW() - INTERVAL '7 days'
       ORDER BY o.available_at ASC
       LIMIT 50
    `)).rows;

    let generated = 0;
    const entityIds = [];
    for (const r of rows) {
      entityIds.push(r.id);
      await upsertSignal({
        signal_type: 'pickup_overdue',
        severity: 'warning',
        title: r.reference ? 'Retrait en retard — ' + r.reference : 'Retrait en retard',
        summary: 'Commande disponible au relais depuis ' + Number(r.days_waiting || 0) + ' jours',
        source_module: 'signal-service',
        target_shell: 'bo',
        target_view: 'orders',
        target_filters: { status: 'available' },
        owner_role: 'relais',
        entity_type: 'order',
        entity_id: r.id,
        recommendation: 'Contacter le relais et vérifier que le client a bien été informé',
        confidence: 'high',
        meta: { days_waiting: Number(r.days_waiting || 0) }
      });
      generated++;
    }
    await autoResolveSignals('pickup_overdue', entityIds);
    return { generated };
  } catch (e) {
    log.warn({ err: e }, '[signal-service] pickup_overdue error:');
    return { generated: 0, error: e.message };
  }
};

/* ── 7. preparation_stuck: préparation > 4 jours ── */
GENERATORS.preparation_stuck = async function() {
  try {
    const rows = (await db.query(`
      SELECT o.id, o.reference,
             EXTRACT(DAY FROM NOW() - o.preparation_at)::int AS days_stuck
        FROM orders o
       WHERE o.status = 'preparation'
         AND o.preparation_at IS NOT NULL
         AND o.preparation_at < NOW() - INTERVAL '4 days'
       ORDER BY o.preparation_at ASC
       LIMIT 50
    `)).rows;

    let generated = 0;
    const entityIds = [];
    for (const r of rows) {
      entityIds.push(r.id);
      await upsertSignal({
        signal_type: 'preparation_stuck',
        severity: 'info',
        title: r.reference ? 'Préparation bloquée — ' + r.reference : 'Préparation bloquée',
        summary: 'Commande en préparation depuis ' + Number(r.days_stuck || 0) + ' jours',
        source_module: 'signal-service',
        target_shell: 'bo',
        target_view: 'orders',
        target_filters: { status: 'preparation' },
        owner_role: 'hub',
        entity_type: 'order',
        entity_id: r.id,
        recommendation: 'Vérifier l’exécution Hub et les scans attendus',
        confidence: 'high',
        meta: { days_stuck: Number(r.days_stuck || 0) }
      });
      generated++;
    }
    await autoResolveSignals('preparation_stuck', entityIds);
    return { generated };
  } catch (e) {
    log.warn({ err: e }, '[signal-service] preparation_stuck error:');
    return { generated: 0, error: e.message };
  }
};

'''
service = service[:start] + new_generators + service[end:]

old_generate_tail = '''  let toRun = types || Object.keys(GENERATORS);\n  for (let type of toRun) {\n    if (GENERATORS[type]) {\n      results.generators[type] = await GENERATORS[type]();\n    } else {\n      results.generators[type] = { error: 'Unknown generator: ' + type };\n    }\n  }\n  return results;\n}'''
new_generate_tail = '''  let toRun = types || Object.keys(GENERATORS);\n  for (let type of toRun) {\n    if (GENERATORS[type]) {\n      results.generators[type] = await GENERATORS[type]();\n    } else {\n      results.generators[type] = { error: 'Unknown generator: ' + type };\n    }\n  }\n  // 4H: old misleading facts are closed after current truth has been refreshed.\n  results.retired_obsolete = await retireObsoleteSignalTypes();\n  return results;\n}'''
if old_generate_tail not in service:
    raise SystemExit('generateSignals tail marker not found')
service = service.replace(old_generate_tail, new_generate_tail, 1)
service = service.replace(
    '  expireOldSignals: expireOldSignals,\n  generateSignals: generateSignals,',
    '  expireOldSignals: expireOldSignals,\n  retireObsoleteSignalTypes: retireObsoleteSignalTypes,\n  generateSignals: generateSignals,',
    1,
)
service_path.write_text(service)

admin = admin_path.read_text()
old_ops = "ops: Object.freeze(['parcel_blocked', 'cash_expiring', 'sla_breach', 'hub_tension', 'relay_tension', 'loyalty_pending']),"
new_ops = "ops: Object.freeze(['parcel_blocked', 'cash_expiring', 'ordered_without_purchase_order', 'purchase_order_overreceived', 'purchase_order_receipt_stuck', 'pickup_overdue', 'preparation_stuck', 'sla_breach', 'hub_tension', 'relay_tension', 'loyalty_pending']),"
if old_ops not in admin:
    raise SystemExit('FAMILY_TYPES ops marker not found')
admin_path.write_text(admin.replace(old_ops, new_ops, 1))

cap = cap_path.read_text()
cap = cap.replace(
    "      // cash_deposits, finance_config, incidents, orders, parcels, products,\n      // users, wallets) : lecture seule, cf. radar-queries.js / signal-service.js.",
    "      // cash_deposits, finance_config, incidents, orders, parcels, products,\n      // purchase_orders, users, wallets) : lecture seule, cf. radar-queries.js / signal-service.js."
)
cap_path.write_text(cap)

# Replace obsolete-generator tests (tail of file) with 4H truth tests.
tests = test_path.read_text()
# No internal UUID may be projected into a public signal title when tracking is absent.
tests = tests.replace(
    "expect(params[2]).toMatch(/Colis bloqué — p1/); // title fallback sur id (pas de tracking_number)",
    "expect(params[2]).toBe('Colis bloqué'); // aucun UUID interne dans le titre public"
)
tail_start = tests.index('// ─── GENERATORS.stock_rupture')
truth_tests = r'''// ─── LOT 4H — Decision Signals Truth ──────────────────────────────────────────
describe("LOT 4H truth generators", () => {
  test("les trois pseudo-vérités historiques ne sont plus des generators actifs", () => {
    const { GENERATORS } = loadService();
    expect(GENERATORS).not.toHaveProperty('stock_rupture');
    expect(GENERATORS).not.toHaveProperty('margin_drift');
    expect(GENERATORS).not.toHaveProperty('dispute_sensitive');
  });

  test("retire les anciens signaux actifs sans toucher la donnée métier", async () => {
    mockQuery = jest.fn().mockResolvedValueOnce({ rowCount: 3 });
    const { retireObsoleteSignalTypes } = loadService();
    const count = await retireObsoleteSignalTypes();
    expect(count).toBe(3);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/UPDATE signals/);
    expect(sql).toContain("status IN ('open','acknowledged','snoozed')");
    expect(params[0]).toEqual(['stock_rupture', 'margin_drift', 'dispute_sensitive']);
  });

  test("ordered_without_purchase_order utilise ordered + PO active + fenêtre 15 min", async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'CMD-PO', minutes_waiting: 37 }] })
      .mockResolvedValueOnce({ rows: [{ id: 's1' }] })
      .mockResolvedValueOnce({ rowCount: 0 });
    const { GENERATORS } = loadService();
    const result = await GENERATORS.ordered_without_purchase_order();
    expect(result.generated).toBe(1);
    const [selectSql] = mockQuery.mock.calls[0];
    expect(selectSql).toContain("o.status = 'ordered'");
    expect(selectSql).toContain("INTERVAL '15 minutes'");
    expect(selectSql).toContain('FROM purchase_orders po');
    const [, params] = mockQuery.mock.calls[1];
    expect(params[0]).toBe('ordered_without_purchase_order');
    expect(params[9]).toBe('order');
    expect(params[10]).toBe('o1');
  });

  test("purchase_order_overreceived compare received_qty à la vraie colonne qty", async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'o2', reference: 'CMD-OVER', po_count: 2, excess_qty: 3 }] })
      .mockResolvedValueOnce({ rows: [{ id: 's2' }] })
      .mockResolvedValueOnce({ rowCount: 0 });
    const { GENERATORS } = loadService();
    await GENERATORS.purchase_order_overreceived();
    const [selectSql] = mockQuery.mock.calls[0];
    expect(selectSql).toContain('po.received_qty > po.qty');
    expect(selectSql).not.toContain('po.quantity');
    const [, params] = mockQuery.mock.calls[1];
    expect(params[0]).toBe('purchase_order_overreceived');
    expect(params[1]).toBe('critical');
  });

  test("purchase_order_receipt_stuck exige toutes les PO complètes et horodatées", async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'o3', reference: 'CMD-STUCK', po_count: 2, minutes_stuck: 31 }] })
      .mockResolvedValueOnce({ rows: [{ id: 's3' }] })
      .mockResolvedValueOnce({ rowCount: 0 });
    const { GENERATORS } = loadService();
    await GENERATORS.purchase_order_receipt_stuck();
    const [selectSql] = mockQuery.mock.calls[0];
    expect(selectSql).toContain("o.status = 'ordered'");
    expect(selectSql).toContain('BOOL_AND(po.received_qty >= po.qty AND po.hub_received_at IS NOT NULL)');
    expect(selectSql).toContain("INTERVAL '15 minutes'");
  });

  test("pickup_overdue utilise available_at, pas updated_at", async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'o4', reference: 'CMD-PICK', days_waiting: 9 }] })
      .mockResolvedValueOnce({ rows: [{ id: 's4' }] })
      .mockResolvedValueOnce({ rowCount: 0 });
    const { GENERATORS } = loadService();
    await GENERATORS.pickup_overdue();
    const [selectSql] = mockQuery.mock.calls[0];
    expect(selectSql).toContain('o.available_at');
    expect(selectSql).toContain("INTERVAL '7 days'");
    expect(selectSql).not.toContain('o.updated_at');
  });

  test("preparation_stuck utilise preparation_at, pas updated_at", async () => {
    mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'o5', reference: 'CMD-PREP', days_stuck: 6 }] })
      .mockResolvedValueOnce({ rows: [{ id: 's5' }] })
      .mockResolvedValueOnce({ rowCount: 0 });
    const { GENERATORS } = loadService();
    await GENERATORS.preparation_stuck();
    const [selectSql] = mockQuery.mock.calls[0];
    expect(selectSql).toContain('o.preparation_at');
    expect(selectSql).toContain("INTERVAL '4 days'");
    expect(selectSql).not.toContain('o.updated_at');
  });

  test("chaque nouveau generator auto-résout le signal quand sa condition disparaît", async () => {
    const names = [
      'ordered_without_purchase_order',
      'purchase_order_overreceived',
      'purchase_order_receipt_stuck',
      'pickup_overdue',
      'preparation_stuck',
    ];
    for (const name of names) {
      mockQuery = jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rowCount: 1 });
      const { GENERATORS } = loadService();
      const result = await GENERATORS[name]();
      expect(result.generated).toBe(0);
      const [resolveSql, params] = mockQuery.mock.calls[1];
      expect(resolveSql).toContain("status = 'resolved'");
      expect(params).toEqual([name]);
    }
  });
});
'''
test_path.write_text(tests[:tail_start] + truth_tests)

# Close the residual product decision now that 4H has an explicit verdict.
doctrine = doctrine_path.read_text()
doctrine = doctrine.replace(
    'Restent des arbitrages de produit non bloquants pour le reset :\n\n1. règles légitimes de `ProblemsView` à conserver dans `signals` ;\n2. richesse exacte de Hub/Relais à conserver dans les workspaces ;\n3. priorisation des Entity 360 après le cutover dashboard.',
    'Arbitrages produit résiduels :\n\n1. ~~règles légitimes de `ProblemsView` à conserver dans `signals`~~ — **tranché par LOT 4H** : seules les anomalies prouvables depuis une SSOT backend sont absorbées ; aucune reconstruction de `ProblemsView` ;\n2. richesse exacte de Hub/Relais à conserver dans les workspaces ;\n3. priorisation des Entity 360 après le cutover dashboard.'
)
doctrine_path.write_text(doctrine)

print('LOT 4H patch applied')
