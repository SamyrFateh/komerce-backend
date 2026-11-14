'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
const mockTransition = jest.fn();
const mockDistributeOrder = jest.fn();
const mockProcessScan = jest.fn();
const mockScanIntoParcel = jest.fn();
const mockConfirmCash = jest.fn();

jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));
jest.mock('../../services/operations-relay-projection', () => ({ countRelayParcels: jest.fn(() => Promise.resolve({ available: 0, in_transit: 0 })) }));
jest.mock('../../services/order-status-machine', () => ({
  transitionOrderStatus: (...args) => mockTransition(...args),
}));
jest.mock('../../services/auto-parcel', () => ({
  distributeOrder: (...args) => mockDistributeOrder(...args),
}));
jest.mock('../../services/scan-engine', () => ({
  processScan: (...args) => mockProcessScan(...args),
}));
jest.mock('../../services/inventory-service', () => ({
  scanIntoParcel: (...args) => mockScanIntoParcel(...args),
}));
jest.mock('../../services/parcel-auto-create-service', () => ({
  confirmCashAndCreateParcel: (...args) => mockConfirmCash(...args),
}));
jest.mock('../../services/pickup-secret-service', () => ({
  cacheCodeForReveal: jest.fn(async () => true),
}));
jest.mock('../../utils/logger', () => ({
  child: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));

const workspace = require('../../services/operations-workspace');

const MARKET = Object.freeze({
  id: 'market-cm-id',
  code: 'CM',
  name: 'Cameroun',
  currency: 'XAF',
});

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockImplementation(async (sql) => {
    // L'agrégat de services/operations-workspace.js#querySignals n'a pas de
    // GROUP BY : Postgres renvoie toujours exactement une ligne, jamais un
    // tableau vide — contrairement aux autres requêtes de ce fichier
    // (listes), pour lesquelles le défaut générique { rows: [] } reste correct.
    if (String(sql).includes('collectes_en_retard')) {
      return {
        rows: [{
          collectes_en_retard: 0,
          cash_a_securiser_count: 0,
          cash_a_securiser_kmf: 0,
          relais_actifs: 0,
        }],
      };
    }
    return { rows: [] };
  });
  mockTransition.mockResolvedValue({ success: true });
  mockDistributeOrder.mockResolvedValue({ success: true, parcel_ref: 'PCL-CM-001' });
  mockProcessScan.mockResolvedValue({
    success: true,
    parcel: { status: 'shipped' },
    catchup_events: [],
    incidents: [],
  });
  mockScanIntoParcel.mockResolvedValue({ assigned: true, matched_proposal: true });
});

test('buildWorkspace scope toutes ses lectures DB par le market id serveur', async () => {
  await workspace.buildWorkspace({ market: MARKET });

  expect(mockQuery).toHaveBeenCalledTimes(9);
  for (const call of mockQuery.mock.calls) {
    expect(call[1]).toContain('market-cm-id');
    expect(String(call[0])).toMatch(/market_id\s*=\s*\$1|market_id\s*=\s*\$2/);
  }
});

test('agent relais : chaque lecture opérationnelle est limitée au relais serveur, sans fichier Hub', async () => {
  const relaisId = '11111111-1111-4111-8111-111111111111';
  const projection = await workspace.buildWorkspace({
    market: MARKET, viewer: { role: 'agent_relais', relais_id: relaisId },
  });

  expect(mockQuery).toHaveBeenCalledTimes(5); // commandes, colis, 3 signaux ; aucun Hub/distribution/inventaire
  for (const [sql, params] of mockQuery.mock.calls) {
    expect(params).toEqual([MARKET.id, relaisId]);
    expect(String(sql)).toMatch(/AND (o\.relais_id|p\.relais_id|r\.id) = \$2/);
    expect(String(sql)).toContain('o.simulation_scope IS NULL');
  }
  expect(projection.queues.hub.to_ship).toEqual([]);
  expect(projection.distribution).toEqual({ parcels: [], unassigned: [] });
  expect(projection.inventory).toEqual({ items: [], open_parcels: [] });
  expect(projection.data_quality.scope_mode).toBe('relay');
  const { countRelayParcels } = require('../../services/operations-relay-projection');
  expect(countRelayParcels).toHaveBeenCalledWith({ marketIds: [MARKET.id], relaisId });
});

test('agent relais : aucun rattachement valide signifie refus avant toute lecture', async () => {
  await expect(workspace.buildWorkspace({ market: MARKET, viewer: { role: 'agent_relais' } }))
    .rejects.toMatchObject({ code: 'relay_scope_required', status: 403 });
  await expect(workspace.buildWorkspace({ market: MARKET, viewer: { role: 'agent_relais', relais_id: 'autre' } }))
    .rejects.toMatchObject({ code: 'relay_scope_required', status: 403 });
  expect(mockQuery).not.toHaveBeenCalled();
});

test('la file des colis a le même périmètre que le compteur relais : commandes réelles et vivantes', async () => {
  await workspace.buildWorkspace({ market: MARKET });
  const parcelSql = mockQuery.mock.calls.map(c => String(c[0])).find(sql => sql.includes('FROM parcels p') && sql.includes('p.recipient_name'));
  expect(parcelSql).toContain('o.simulation_scope IS NULL');
  expect(parcelSql).toContain("o.status::text NOT IN ('cancelled', 'refunded', 'collected')");
});

test('agrégat répartition groupe par commande et ne déduplique jamais sur le montant', async () => {
  await workspace.buildWorkspace({ market: MARKET });

  const distributionSql = mockQuery.mock.calls
    .map(call => String(call[0]))
    .find(sql => sql.includes('per_order'));

  expect(distributionSql).toContain('GROUP BY linked_order.id');
  expect(distributionSql).toContain('SUM(per_order.total_kmf)');
  expect(distributionSql).not.toContain('SUM(DISTINCT linked_order.total_kmf)');
});

test('scope public ne divulgue jamais UUID marché', () => {
  const scope = workspace.publicMarket(MARKET);

  expect(scope).toEqual({ code: 'CM', name: 'Cameroun', currency: 'XAF' });
  expect(JSON.stringify(scope)).not.toContain('market-cm-id');
});

test('buildQueues ne crée aucune transition métier côté présentation', () => {
  const queues = workspace.buildQueues(
    [
      { reference: 'CMD-1', status: 'confirmed', payment_mode: 'stripe_eur', payment_status: 'paid' },
      { reference: 'CMD-2', status: 'pending', payment_mode: 'cash_relais', payment_status: 'pending' },
    ],
    [
      { reference: 'PCL-1', status: 'preparation' },
      { reference: 'PCL-2', status: 'in_transit' },
      { reference: 'PCL-3', status: 'available' },
    ]
  );

  expect(queues.hub.to_ship.map(row => row.reference)).toEqual(['PCL-1']);
  expect(queues.relay.cash_pending.map(row => row.reference)).toEqual(['CMD-2']);
  const withConfirmed = workspace.buildQueues([
    { reference: 'CASH-OK', status: 'pending', payment_mode: 'cash_relais', payment_status: 'pending', cash_confirmed: true },
    { reference: 'CASH-TODO', status: 'pending', payment_mode: 'cash_relais', payment_status: 'pending', cash_confirmed: false },
  ], []);
  expect(withConfirmed.relay.cash_pending.map(row => row.reference)).toEqual(['CASH-TODO']);
  expect(queues.relay.to_receive.map(row => row.reference)).toEqual(['PCL-2']);
  expect(queues.relay.to_collect.map(row => row.reference)).toEqual(['PCL-3']);
});


test('G3 LOCAL_STOCK : réception directe exposée au seul relais affecté, sans file Hub', () => {
  const orders = [
    { id:'11111111-1111-4111-8111-111111111111', reference:'LOCAL-A', relais_id:'relay-A', local_receipt_candidate:true },
    { id:'22222222-2222-4222-8222-222222222222', reference:'LOCAL-B', relais_id:'relay-B', local_receipt_candidate:true },
    { id:'33333333-3333-4333-8333-333333333333', reference:'IMPORT-C', relais_id:'relay-A', local_receipt_candidate:false },
  ];
  const a = workspace.buildQueues(orders, [], { role:'agent_relais', relais_id:'relay-A' });
  expect(a.relay.local_receipt_pending.map(row => row.reference)).toEqual(['LOCAL-A']);
  expect(a.hub.to_ship).toEqual([]);
  expect(workspace.buildQueues(orders, [], { role:'agent_relais', relais_id:'relay-B' })
    .relay.local_receipt_pending.map(row => row.reference)).toEqual(['LOCAL-B']);
  expect(workspace.buildQueues(orders, [], { role:'agent_relais', relais_id:'relay-C' })
    .relay.local_receipt_pending).toHaveLength(0);
  for (const role of ['agent_hub', 'market_operator', 'agent_transitaire']) {
    expect(workspace.buildQueues(orders, [], { role })
      .relay.local_receipt_pending).toHaveLength(0);
  }
  expect(workspace.buildQueues(orders, [], { role:'admin' }).relay.local_receipt_pending).toHaveLength(2);
  expect(workspace.buildQueues(orders, []).relay.local_receipt_pending).toHaveLength(0);
});

test('G3 LOCAL_STOCK : la requête candidate conserve le scope, paiement, provenance et filtre de simulation', async () => {
  const relaisId = '11111111-1111-4111-8111-111111111111';
  await workspace.buildWorkspace({ market: MARKET, viewer: {role:'agent_relais', relais_id:relaisId} });
  const sql = mockQuery.mock.calls.map(call => String(call[0]))
    .find(source => source.includes('local_receipt_candidate'));
  expect(sql).toContain('o.payment_status = \'paid\'');
  expect(sql).toContain("local_oi.fulfillment_source = 'LOCAL_STOCK'");
  expect(sql).toContain('local_pi.order_item_id');
  expect(sql).toContain('AND o.relais_id = $2');
  expect(sql).toContain('o.simulation_scope IS NULL');
});

test('runDistribution ne distribue que les commandes présélectionnées dans le marché', async () => {
  mockQuery.mockResolvedValueOnce({
    rows: [
      { id: 'order-cm-1', reference: 'CMD-CM-001', relais_id: 'relay-cm', relais_market_id: 'market-cm-id' },
      { id: 'order-cm-2', reference: 'CMD-CM-002', relais_id: null, relais_market_id: null },
    ],
  });
  mockDistributeOrder
    .mockResolvedValueOnce({ success: true, parcel_ref: 'PCL-CM-001' })
    .mockResolvedValueOnce({ success: true, queued: true });

  const result = await workspace.runDistribution(MARKET);

  expect(mockQuery.mock.calls[0][1]).toEqual(['market-cm-id']);
  // Aucune commande 100 % locale ne quitte le circuit direct Relais via le Hub.
  // Les commandes mixtes restent éligibles par leurs seules lignes IMPORT sans colis.
  expect(String(mockQuery.mock.calls[0][0])).toContain("oi.fulfillment_source = 'IMPORT'");
  expect(String(mockQuery.mock.calls[0][0])).toContain('pi.order_item_id = oi.id');
  expect(mockDistributeOrder.mock.calls).toEqual([
    ['order-cm-1'],
    ['order-cm-2'],
  ]);
  expect(result).toEqual(expect.objectContaining({ attempted: 2, distributed: 1, queued: 1, errors: 0 }));
  expect(JSON.stringify(result)).not.toContain('order-cm-1');
});

test('runDistribution bloque tout avant mutation si un relais appartient à un autre marché', async () => {
  mockQuery.mockResolvedValueOnce({
    rows: [
      { id: 'order-cm-1', reference: 'CMD-CM-001', relais_id: 'relay-cg', relais_market_id: 'market-cg-id' },
    ],
  });

  await expect(workspace.runDistribution(MARKET)).rejects.toMatchObject({
    code: 'relay_market_mismatch',
    status: 409,
  });
  expect(mockDistributeOrder).not.toHaveBeenCalled();
});

test('distributeSingleOrder répartit UNE commande du marché via le writer canonique', async () => {
  mockQuery.mockResolvedValueOnce({
    rows: [{ id: 'order-cm-1', reference: 'CMD-CM-001', status: 'ordered', relais_id: 'relay-cm', relais_market_id: 'market-cm-id' }],
  });
  mockDistributeOrder.mockResolvedValueOnce({ success: true, parcel_ref: 'PCL-CM-009' });

  const result = await workspace.distributeSingleOrder('CMD-CM-001', MARKET);

  expect(mockQuery.mock.calls[0][1]).toEqual(['CMD-CM-001', 'market-cm-id']);
  expect(mockDistributeOrder.mock.calls).toEqual([['order-cm-1']]);
  expect(result).toEqual(expect.objectContaining({ order_ref: 'CMD-CM-001', success: true, parcel_ref: 'PCL-CM-009' }));
  expect(JSON.stringify(result)).not.toContain('order-cm-1');
});

test('distributeSingleOrder refuse une commande hors marché, hors statut ou à relais étranger sans appeler le writer', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  await expect(workspace.distributeSingleOrder('CMD-XX', MARKET)).rejects.toMatchObject({ status: 404 });
  mockQuery.mockResolvedValueOnce({
    rows: [{ id: 'o2', reference: 'CMD-CM-002', status: 'delivered', relais_id: null, relais_market_id: null }],
  });
  await expect(workspace.distributeSingleOrder('CMD-CM-002', MARKET)).rejects.toMatchObject({ code: 'order_not_distributable', status: 409 });
  mockQuery.mockResolvedValueOnce({
    rows: [{ id: 'o3', reference: 'CMD-CM-003', status: 'ordered', relais_id: 'relay-cg', relais_market_id: 'market-cg-id' }],
  });
  await expect(workspace.distributeSingleOrder('CMD-CM-003', MARKET)).rejects.toMatchObject({ code: 'relay_market_mismatch' });
  expect(mockDistributeOrder).not.toHaveBeenCalled();
});

test('scanParcel résout le colis dans le marché avant d appeler le moteur append-only', async () => {
  mockQuery.mockResolvedValueOnce({
    rows: [{
      id: 'parcel-cm-id',
      reference: 'PCL-CM-001',
      status: 'preparation',
      order_id: 'order-cm-id',
      relais_id: 'relay-cm',
      order_market_id: 'market-cm-id',
      relais_market_id: 'market-cm-id',
    }],
  });

  const result = await workspace.scanParcel('PCL-CM-001', 'ship', MARKET, {
    id: 'admin-1',
    role: 'admin',
    full_name: 'Admin Test',
  }, { reason: 'scanner_unavailable' });

  expect(mockQuery.mock.calls[0][1]).toEqual(['PCL-CM-001', 'market-cm-id']);
  expect(mockProcessScan).toHaveBeenCalledWith(expect.objectContaining({
    parcel_id: 'parcel-cm-id',
    event_type: 'shipped',
    metadata: expect.objectContaining({ market_code: 'CM', entry_mode: 'manual_confirmation', manual_reason: 'scanner_unavailable' }),
  }));
  expect(result.reference).toBe('PCL-CM-001');
});

test('P0 mode dégradé : la remise sans preuve de retrait ne passe jamais par le scan logistique', async () => {
  for (const reason of [undefined, { reason: 'manual_entry' }, { reason: 'scanner_unavailable' }]) {
    await expect(workspace.scanParcel('PCL-CM-001', 'collect', MARKET,
      { id: 'relay-1', role: 'agent_relais' }, reason))
      .rejects.toMatchObject({ code: 'PICKUP_CODE_REQUIRED', status: 409 });
  }
  expect(mockQuery).not.toHaveBeenCalled();
  expect(mockProcessScan).not.toHaveBeenCalled();
});

test('saisie manuelle volontaire : voie receive sans prétendre panne de lecteur', async () => {
  mockQuery.mockResolvedValueOnce({
    rows: [{ id: 'parcel-cm-id', reference: 'PCL-CM-001', status: 'shipped',
      order_id: 'order-cm-id', relais_id: 'relay-cm',
      order_market_id: 'market-cm-id', relais_market_id: 'market-cm-id' }],
  }).mockResolvedValueOnce({ rows: [{ attached: false }] });
  await workspace.scanParcel('PCL-CM-001', 'receive', MARKET,
    { id: 'relay-1', role: 'agent_relais' }, { reason: 'manual_entry' });
  expect(mockProcessScan).toHaveBeenCalledWith(expect.objectContaining({
    event_type: 'relais_received',
    metadata: expect.objectContaining({
      entry_mode: 'manual_confirmation', manual_reason: 'manual_entry',
    }),
  }));
});

test('scanParcel refuse une confirmation sans motif et n\'appelle pas le moteur', async () => {
  await expect(workspace.scanParcel('PCL-CM-001', 'ship', MARKET, { id: 'a', role: 'admin' }))
    .rejects.toMatchObject({ code: 'manual_reason_required' });
  await expect(workspace.scanParcel('PCL-CM-001', 'ship', MARKET, { id: 'a', role: 'admin' }, { reason: 'other' }))
    .rejects.toMatchObject({ code: 'manual_note_required' });
  expect(mockProcessScan).not.toHaveBeenCalled();
});

test.each([
  ['admin', 'ship', 'admin'],
  ['agent_hub', 'ship', 'hub_agent'],
  ['agent_relais', 'receive', 'relay_agent'],
  // rôle inattendu : la station qui exécute l'action décide (jamais d'étiquette « admin » par défaut)
  ['market_operator', 'receive', 'relay_agent'],
  [undefined, 'ship', 'hub_agent'],
])('scanParcel traduit le rôle %s (%s) en actor_role %s accepté par scan_events', async (role, action, expected) => {
  mockQuery.mockResolvedValueOnce({
    rows: [{ id: 'parcel-cm-id', reference: 'PCL-CM-001', status: 'preparation', order_id: 'order-cm-id', relais_id: 'relay-cm', order_market_id: 'market-cm-id', relais_market_id: 'market-cm-id' }],
  });

  await workspace.scanParcel('PCL-CM-001', action, MARKET, { id: 'actor-1', role }, { reason: 'offline' });

  expect(mockProcessScan).toHaveBeenLastCalledWith(expect.objectContaining({ actor_role: expected }));
});

test('assignInventory revalide article et colis dans le même marché avant mutation', async () => {
  mockQuery
    .mockResolvedValueOnce({
      rows: [{ id: 'item-cm-id', status: 'proposed', order_id: 'order-cm-id', market_id: 'market-cm-id' }],
    })
    .mockResolvedValueOnce({
      rows: [{
        id: 'parcel-cm-id',
        reference: 'PCL-CM-001',
        status: 'preparation',
        order_id: 'order-cm-id',
        relais_id: 'relay-cm',
        order_market_id: 'market-cm-id',
        relais_market_id: 'market-cm-id',
      }],
    });

  const result = await workspace.assignInventory('item-cm-id', 'PCL-CM-001', MARKET);

  expect(mockScanIntoParcel).toHaveBeenCalledWith('item-cm-id', 'parcel-cm-id');
  expect(result).toEqual(expect.objectContaining({ parcel_ref: 'PCL-CM-001', assigned: true }));
});

test('assignInventory refuse un colis fermé même dans le bon marché', async () => {
  mockQuery
    .mockResolvedValueOnce({
      rows: [{ id: 'item-cm-id', status: 'proposed', order_id: 'order-cm-id', market_id: 'market-cm-id' }],
    })
    .mockResolvedValueOnce({
      rows: [{
        id: 'parcel-cm-id',
        reference: 'PCL-CM-001',
        status: 'shipped',
        order_id: 'order-cm-id',
        relais_id: 'relay-cm',
        order_market_id: 'market-cm-id',
        relais_market_id: 'market-cm-id',
      }],
    });

  await expect(workspace.assignInventory('item-cm-id', 'PCL-CM-001', MARKET)).rejects.toMatchObject({
    code: 'inventory_parcel_not_open',
    status: 409,
  });
  expect(mockScanIntoParcel).not.toHaveBeenCalled();
});

test('buildWorkspace expose payload.signals — collectes en retard, cash à sécuriser en KMF, incidents et relais triés', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (String(sql).includes('collectes_en_retard')) {
      return {
        rows: [{
          collectes_en_retard: 3,
          cash_a_securiser_count: 2,
          cash_a_securiser_kmf: '47000',
          relais_actifs: 5,
        }],
      };
    }
    if (String(sql).includes('order_incidents')) {
      return {
        rows: [
          { id: 'inc-1', type: 'blocage', priority: 'high', status: 'open', created_at: '2026-09-01T00:00:00Z', relais_name: 'Relais Akwa' },
        ],
      };
    }
    if (String(sql).includes('GROUP BY r.id')) {
      return {
        rows: [
          { id: 'relais-1', name: 'Relais Akwa', island: 'Douala', disponibles: 4, en_retard: 3, cash_pending_kmf: '15000', collectes_7j: 2 },
        ],
      };
    }
    return { rows: [] };
  });

  const result = await workspace.buildWorkspace({ market: MARKET });

  expect(result.signals).toEqual({
    collectes_en_retard: 3,
    cash_a_securiser: { count: 2, total_kmf: 47000 },
    relais_actifs: 5,
    incidents_ouverts: 1,
    incidents: [
      { id: 'inc-1', type: 'blocage', priority: 'high', relais_name: 'Relais Akwa', created_at: '2026-09-01T00:00:00Z' },
    ],
    par_relais: [
      { id: 'relais-1', name: 'Relais Akwa', island: 'Douala', disponibles: 4, en_retard: 3, cash_pending_kmf: 15000, collectes_7j: 2 },
    ],
  });
  // cash_a_securiser_kmf et cash_pending_kmf arrivent en string depuis
  // Postgres (bigint) — vérifie que le service les convertit bien en Number,
  // jamais laissés en chaîne pour l'UI.
  expect(typeof result.signals.cash_a_securiser.total_kmf).toBe('number');
  expect(typeof result.signals.par_relais[0].cash_pending_kmf).toBe('number');
});

test('querySignals ne propose jamais de signal "stock sous seuil" — donnée absente du schéma, jamais inventée', async () => {
  const result = await workspace.buildWorkspace({ market: MARKET });
  expect(result.signals).not.toHaveProperty('stock_alert');
  expect(result.signals).not.toHaveProperty('hubs_en_tension');
  expect(Object.keys(result.signals)).toEqual([
    'collectes_en_retard', 'cash_a_securiser', 'relais_actifs', 'incidents_ouverts', 'incidents', 'par_relais',
  ]);
});
