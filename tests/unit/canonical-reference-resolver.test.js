'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
const mockSnapshot = jest.fn();

jest.mock('../../db', () => ({
  query: (...args) => mockQuery(...args),
}));

jest.mock('../../services/logistics-control-chain-projection', () => ({
  getOrderControlSnapshot: (...args) => mockSnapshot(...args),
}));

const fs = require('fs');
const path = require('path');
const resolver = require('../../services/canonical-reference-resolver');

describe('canonical reference resolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('normalise et borne la référence', () => {
    expect(resolver.normalizeReference('  K-104829  ')).toBe('K-104829');
    expect(() => resolver.normalizeReference('   ')).toThrow(/Référence requise/);
    expect(() => resolver.normalizeReference('x'.repeat(resolver.MAX_REFERENCE_LENGTH + 1)))
      .toThrow(/Référence trop longue/);
  });

  test('route vers la vérité propriétaire sans exposer Purchasing à un non-admin', () => {
    const po = {
      entity_type: 'PURCHASE_ORDER',
      canonical_id: '11111111-1111-1111-1111-111111111111',
      order_reference: 'K-104829',
    };
    expect(resolver.canonicalDestination(po, { role: 'admin' })).toEqual({
      owner: 'purchasing',
      href: '/admin/workspaces/purchasing?po=11111111-1111-1111-1111-111111111111',
      fallback_href: '/admin/orders/K-104829',
    });
    expect(resolver.canonicalDestination(po, { role: 'market_operator' })).toEqual({
      owner: 'purchasing',
      href: '/admin/orders/K-104829',
      fallback_href: '/admin/orders/K-104829',
    });

    expect(resolver.canonicalDestination({
      entity_type: 'HUB_UNIT',
      canonical_id: 'hu-1',
      order_reference: 'K-104829',
    }, { role: 'market_operator' })).toEqual({
      owner: 'logistics',
      href: '/admin/workspaces/operations',
      fallback_href: '/admin/orders/K-104829',
    });


    const parcel = {
      entity_type: 'PARCEL',
      canonical_id: 'parcel-1',
      order_reference: 'K-104829',
    };
    expect(resolver.canonicalDestination(parcel, { role: 'market_operator', global: false })).toEqual({
      owner: 'logistics',
      href: '/admin/orders/K-104829',
      fallback_href: '/admin/orders/K-104829',
    });
    expect(resolver.canonicalDestination(parcel, { role: 'admin', global: true })).toEqual({
      owner: 'logistics',
      href: '/admin/workspaces/shipping-customs',
      fallback_href: '/admin/orders/K-104829',
    });
  });

  test('résout une référence vers la lineage et la position courante sans créer de statut', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        entity_type: 'HUB_UNIT',
        matched_reference: 'KOM-RCV-87492',
        canonical_id: 'hu-1',
        order_id: 'order-1',
        order_reference: 'K-104829',
        market_id: 'market-cm',
        market_code: 'CM',
      }],
    });
    mockSnapshot.mockResolvedValueOnce({
      stage: 'HUB_CONTROL',
      health: 'RED',
      exception: { code: 'hub_quarantine', summary: 'Unité HUB en quarantaine', owner_role: 'hub' },
      envelope: { type: 'HUB_UNIT', refs: ['KOM-RCV-87492'] },
      split: false,
      lineage: {
        purchase_orders: ['po-1'],
        hub_units: ['KOM-RCV-87492'],
        parcels: [],
      },
    });

    const result = await resolver.resolveReference('KOM-RCV-87492', {
      role: 'market_operator',
      authorizedMarketIds: new Set(['market-cm']),
    });

    expect(result).toEqual({
      query: 'KOM-RCV-87492',
      found: true,
      ambiguous: false,
      matches: [{
        entity_type: 'HUB_UNIT',
        matched_reference: 'KOM-RCV-87492',
        canonical_id: 'hu-1',
        canonical_owner: 'logistics',
        customer_order_reference: 'K-104829',
        market_code: 'CM',
        current_position: {
          stage: 'HUB_CONTROL',
          health: 'RED',
          cause: { code: 'hub_quarantine', summary: 'Unité HUB en quarantaine', owner_role: 'hub' },
          envelope: { type: 'HUB_UNIT', refs: ['KOM-RCV-87492'] },
          split: false,
          lineage: {
            purchase_orders: ['po-1'],
            hub_units: ['KOM-RCV-87492'],
            parcels: [],
          },
        },
        canonical_href: '/admin/workspaces/operations',
        fallback_href: '/admin/orders/K-104829',
      }],
    });
    expect(mockSnapshot).toHaveBeenCalledWith({
      id: 'order-1',
      reference: 'K-104829',
      market_id: 'market-cm',
    });
  });

  test('résout un parent provider groupé vers la PO propriétaire et ses commandes clientes', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        entity_type: 'PARENT_ORDER',
        matched_reference: 'SHIPMENT-PARENT-42',
        canonical_id: 'group-id-42',
        purchase_order_id: 'po-group',
        order_id: 'order-1',
        order_reference: 'K-1',
        market_id: 'market-cm',
        market_code: 'CM',
      }],
    });
    mockSnapshot.mockResolvedValueOnce({
      stage: 'SUPPLIER',
      health: 'GREEN',
      exception: null,
      envelope: { type: 'PURCHASE_ORDER', refs: ['po-group'] },
      split: false,
      lineage: { purchase_orders: ['po-group'], hub_units: [], parcels: [] },
    });

    const result = await resolver.resolveReference('SHIPMENT-PARENT-42', {
      role: 'admin',
      global: true,
    });

    expect(result.matches[0]).toMatchObject({
      entity_type: 'PARENT_ORDER',
      matched_reference: 'SHIPMENT-PARENT-42',
      canonical_id: 'group-id-42',
      canonical_owner: 'purchasing',
      customer_order_reference: 'K-1',
      canonical_href: '/admin/workspaces/purchasing?po=po-group',
    });
  });

  test('une PO groupée peut retourner plusieurs commandes clientes sans fausse unicité', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          entity_type: 'PURCHASE_ORDER',
          matched_reference: 'po-group',
          canonical_id: 'po-group',
          order_id: 'order-1',
          order_reference: 'K-1',
          market_id: 'market-cm',
          market_code: 'CM',
        },
        {
          entity_type: 'PURCHASE_ORDER',
          matched_reference: 'po-group',
          canonical_id: 'po-group',
          order_id: 'order-2',
          order_reference: 'K-2',
          market_id: 'market-cm',
          market_code: 'CM',
        },
      ],
    });
    mockSnapshot
      .mockResolvedValueOnce({ stage: 'PURCHASING', health: 'GREEN', exception: null, envelope: { type: 'PURCHASE_ORDER', refs: ['po-group'] }, split: false, lineage: { purchase_orders: ['po-group'], hub_units: [], parcels: [] } })
      .mockResolvedValueOnce({ stage: 'SUPPLIER', health: 'ORANGE', exception: { code: 'supplier_delay' }, envelope: { type: 'PURCHASE_ORDER', refs: ['po-group'] }, split: false, lineage: { purchase_orders: ['po-group'], hub_units: [], parcels: [] } });

    const result = await resolver.resolveReference('po-group', {
      role: 'admin',
      global: true,
    });

    expect(result.found).toBe(true);
    expect(result.ambiguous).toBe(true);
    expect(result.matches.map(match => match.customer_order_reference)).toEqual(['K-1', 'K-2']);
    expect(new Set(result.matches.map(match => match.canonical_id))).toEqual(new Set(['po-group']));
  });

  test('ne révèle pas une référence hors des marchés operations.read autorisés', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        entity_type: 'PARCEL',
        matched_reference: 'KOM-BOX-1',
        canonical_id: 'parcel-1',
        order_id: 'order-1',
        order_reference: 'K-1',
        market_id: 'market-cg',
        market_code: 'CG',
      }],
    });

    const result = await resolver.resolveReference('KOM-BOX-1', {
      role: 'market_operator',
      authorizedMarketIds: new Set(['market-cm']),
    });

    expect(result).toEqual({
      query: 'KOM-BOX-1',
      found: false,
      matches: [],
    });
    expect(mockSnapshot).not.toHaveBeenCalled();
  });

  test('un owner existant sans commande devient un orphan explicite pour l autorité globale', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        entity_type: 'PURCHASE_ORDER',
        matched_reference: 'po-orphan',
        canonical_id: 'po-orphan',
      }] });

    const result = await resolver.resolveReference('po-orphan', {
      role: 'admin',
      global: true,
    });

    expect(result).toEqual({
      query: 'po-orphan',
      found: true,
      orphaned: true,
      ambiguous: false,
      matches: [],
      orphans: [{
        entity_type: 'PURCHASE_ORDER',
        matched_reference: 'po-orphan',
        canonical_id: 'po-orphan',
        canonical_owner: 'purchasing',
        reason: 'missing_customer_order_lineage',
      }],
    });
    expect(mockSnapshot).not.toHaveBeenCalled();
  });

  test('un orphan sans marché prouvable n est jamais révélé à un opérateur scoped', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await resolver.resolveReference('po-orphan', {
      role: 'market_operator',
      authorizedMarketIds: new Set(['market-cm']),
    });

    expect(result).toEqual({
      query: 'po-orphan',
      found: false,
      matches: [],
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('la détection des orphans reste read-only et vérifie la lineage au lieu d inventer un statut', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await resolver.queryOrphans('po-orphan');
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toMatch(/FROM purchase_orders po/);
    expect(sql).toMatch(/FROM supplier_execution_groups seg/);
    expect(sql).toMatch(/FROM hub_physical_units hpu/);
    expect(sql).toMatch(/FROM parcels p/);
    expect(sql).toMatch(/FROM customs_shipments cs/);
    expect(sql).toMatch(/NOT EXISTS/);
    expect(sql).not.toMatch(/INSERT|UPDATE|DELETE/i);
  });

  test('la requête reste une résolution d’identité read-only sur les owners existants', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await resolver.queryMatches('K-104829');

    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toMatch(/FROM orders o/);
    expect(sql).toMatch(/FROM purchase_orders po/);
    expect(sql).toMatch(/FROM supplier_execution_groups seg/);
    expect(sql).toMatch(/FROM hub_physical_units hpu/);
    expect(sql).toMatch(/FROM parcels p/);
    expect(sql).toMatch(/FROM customs_shipments cs/);
    expect(sql).not.toMatch(/INSERT|UPDATE|DELETE/i);
  });
  test('la route Canonical impose auth + rôle interne + autorité operations.read ou globale', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'admin-dashboard-market.js'), 'utf8');
    const block = source.match(/router\.get\(\n  '\/reference\/resolve',[\s\S]*?\n\);/);
    expect(block).not.toBeNull();
    expect(block[0]).toMatch(/authenticate/);
    expect(block[0]).toMatch(/attachMarketDashboardDelegation/);
    expect(block[0]).toMatch(/requireMarketDashboardReadRole/);
    expect(block[0]).toMatch(/attachReferenceResolverAuthority/);
    expect(block[0]).toMatch(/referenceResolver\.resolveReference/);
  });

});
