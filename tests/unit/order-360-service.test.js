'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const service = require('../../services/order-360');

beforeEach(() => {
  jest.clearAllMocks();
});

test('normalizeReference accepte une référence lisible et refuse les caractères hors contrat', () => {
  expect(service.normalizeReference('CMD-CM-001')).toBe('CMD-CM-001');
  expect(service.normalizeReference('  CMD.CM_001  ')).toBe('CMD.CM_001');
  expect(service.normalizeReference('$$bad')).toBeNull();
  expect(service.normalizeReference('a'.repeat(81))).toBeNull();
});

test('resolveOrder résout la référence et conserve les IDs uniquement dans le contexte serveur', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 'order-id', reference: 'CMD-CM-001', market_id: 'market-cm-id', user_id: 'user-id',
    status: 'confirmed', payment_status: 'paid', payment_mode: 'stripe_eur', total_kmf: '12000',
    destination_island: 'Grande Comore', routing_mode: 'relay', transit_hub: 'DXB',
    created_at: '2026-08-20T00:00:00.000Z', updated_at: '2026-08-21T00:00:00.000Z',
    customer_name: 'Client Test', customer_email: 'client@example.test', customer_phone: '+2690000000',
    relais_name: 'Relais A', relais_address: 'Adresse A', relais_phone: '+2691111111', relais_island: 'Grande Comore',
    market_code: 'CM', market_name: 'Cameroun', market_currency: 'XAF',
  }] });

  const resolved = await service.resolveOrder('CMD-CM-001');
  expect(resolved.invalid).toBe(false);
  expect(resolved.order).toEqual(expect.objectContaining({ id: 'order-id', market_id: 'market-cm-id' }));
  expect(String(mockQuery.mock.calls[0][0])).toContain('UPPER(o.reference) = UPPER($1)');
});

test('publicOrder ne publie aucun identifiant interne', () => {
  const projected = service.publicOrder({
    id: 'order-id', market_id: 'market-id', user_id: 'user-id', reference: 'CMD-CM-001',
    status: 'confirmed', payment_status: 'paid', payment_mode: 'stripe_eur', total_kmf: '12000',
    destination_island: 'Grande Comore', routing_mode: 'relay', transit_hub: 'DXB',
    customer_name: 'Client Test', customer_email: 'client@example.test', customer_phone: '+2690000000',
    relais_name: 'Relais A', relais_address: 'Adresse A', relais_phone: '+2691111111', relais_island: 'Grande Comore',
    market_code: 'CM', market_name: 'Cameroun', market_currency: 'XAF',
    created_at: '2026-08-20T00:00:00.000Z', updated_at: '2026-08-21T00:00:00.000Z',
  });

  const serialized = JSON.stringify(projected);
  expect(serialized).not.toContain('order-id');
  expect(serialized).not.toContain('market-id');
  expect(serialized).not.toContain('user-id');
  expect(projected.payment.total_kmf).toBe(12000);
  expect(projected.market).toEqual({ code: 'CM', name: 'Cameroun', currency: 'XAF' });
});

test('loadOrder360 agrège les facettes sans exposer leurs UUID', async () => {
  mockQuery.mockImplementation(async sql => {
    const text = String(sql);
    if (text.includes('FROM order_items oi') && !text.includes('parcel_items')) {
      return { rows: [{ id: 'item-id', product_id: 'product-id', quantity: 2, price_kmf: 3000, product_name: 'Produit A', category: 'Maison', image_url: null }] };
    }
    if (text.includes('FROM parcels p')) {
      return { rows: [{ id: 'parcel-id', reference: 'COL-001', tracking_number: 'TRK001', status: 'shipped', type: 'standard', weight_kg: '1.5', created_at: '2026-08-20T00:00:00Z', prepared_at: null, shipped_at: '2026-08-21T00:00:00Z', updated_at: '2026-08-21T00:00:00Z' }] };
    }
    if (text.includes('FROM parcel_items pi')) {
      return { rows: [{ parcel_id: 'parcel-id', order_item_id: 'item-id', quantity: 2, product_name: 'Produit A' }] };
    }
    if (text.includes('FROM order_status_history h')) return { rows: [{ status: 'shipped', note: null, created_at: '2026-08-21T00:00:00Z', changed_by_name: 'Ops' }] };
    if (text.includes('FROM scans s')) return { rows: [] };
    if (text.includes('FROM order_incidents i')) return { rows: [{ type: 'retard', description: 'Test', priority: 'high', status: 'open', created_at: '2026-08-22T00:00:00Z', resolved_at: null, resolution_note: null, reporter_name: 'Hub' }] };
    if (text.includes('FROM order_comments c')) return { rows: [] };
    if (text.includes('FROM client_notifications')) return { rows: [{ event_key: 'order.shipped', severity: 'info', title: 'Expédiée', message: 'En route', status: 'open', created_at: '2026-08-21T00:00:00Z', acknowledged_at: null, resolved_at: null }] };
    if (text.includes('FROM invoices')) return { rows: [{ invoice_number: 'INV-001', payment_status: 'paid', delivered_via: 'account', delivered_at: null, created_at: '2026-08-20T00:00:00Z' }] };
    if (text.includes('FROM transaction_documents')) return { rows: [{ document_type: 'invoice', reference: 'DOC-001', status: 'issued', file_url: '/files/doc.pdf', issued_at: '2026-08-20T00:00:00Z' }] };
    return { rows: [] };
  });

  const payload = await service.loadOrder360({
    id: 'order-id', market_id: 'market-id', user_id: 'user-id', reference: 'CMD-CM-001',
    status: 'shipped', payment_status: 'paid', payment_mode: 'stripe_eur', total_kmf: '6000',
    market_code: 'CM', market_name: 'Cameroun', market_currency: 'XAF',
  });

  expect(payload.summary).toEqual(expect.objectContaining({ items: 1, quantity: 2, parcels: 1, open_incidents: 1, notifications: 1, documents: 1 }));
  expect(payload.parcels[0]).toEqual(expect.objectContaining({ reference: 'COL-001', tracking_number: 'TRK001' }));
  expect(payload.incidents[0].priority).toBe('high');
  const serialized = JSON.stringify(payload);
  expect(serialized).not.toContain('order-id');
  expect(serialized).not.toContain('parcel-id');
  expect(serialized).not.toContain('item-id');
  expect(serialized).not.toContain('market-id');
  expect(serialized).not.toContain('user-id');
});
