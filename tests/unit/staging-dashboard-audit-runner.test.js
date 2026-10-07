'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const audit = require('../../scripts/audit-canonical-dashboards-staging');

describe('staging canonical dashboard audit runner', () => {
  test('parses market and period explicitly', () => {
    expect(audit.parseArgs(['node','script','--market','cm','--period','90']))
      .toEqual({ market: 'CM', period: '90' });
  });

  test('metric map preserves only canonical key/value pairs', () => {
    expect(audit.metricMap([
      { key: 'ca_encaisse', value: 100 },
      null,
      { key: 'cmds_actives', value: 4 },
    ])).toEqual({ ca_encaisse: 100, cmds_actives: 4 });
  });
});


  test('collecte des références représentatives depuis la chaîne sans inventer d’identité', () => {
    const refs = audit.representativeReferences({
      orders: [
        {
          order_reference: 'AUDIT-ORDER',
          lineage: {
            purchase_orders: ['po-1'],
            hub_units: [],
            parcels: [],
          },
        },
        {
          order_reference: 'AUDIT-HUB',
          lineage: {
            purchase_orders: [],
            hub_units: ['HU-1'],
            parcels: ['PARCEL-1'],
          },
        },
      ],
    }, 'CUS-1');

    expect(refs).toEqual([
      { kind: 'ORDER', reference: 'AUDIT-ORDER', owner: 'orders' },
      { kind: 'PURCHASE_ORDER', reference: 'po-1', owner: 'purchasing' },
      { kind: 'HUB_UNIT', reference: 'HU-1', owner: 'logistics' },
      { kind: 'PARCEL', reference: 'PARCEL-1', owner: 'logistics' },
      { kind: 'CUSTOMS_SHIPMENT', reference: 'CUS-1', owner: 'customs' },
    ]);
  });

  test('omet uniquement les familles absentes du seed', () => {
    expect(audit.representativeReferences({ orders: [{ order_reference: 'AUDIT-ONLY', lineage: {} }] }))
      .toEqual([{ kind: 'ORDER', reference: 'AUDIT-ONLY', owner: 'orders' }]);
  });
