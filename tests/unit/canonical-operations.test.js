'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const schemaContract = require('../../public/dashboards/canonical/js/dashboard-schema');
const adminContextContract = require('../../public/dashboards/canonical/js/admin-context');
const operations = require('../../public/dashboards/canonical/js/operations');
const operationsDecision = require('../../public/dashboards/canonical/js/operations-decision');
const fs = require('fs');
const path = require('path');

function payloadFixture() {
  return {
    kpis: [
      { key: 'cmds_aujourdhui', value: 4, unit: 'count', data_quality: {} },
      { key: 'paiements_en_attente', value: 2, unit: 'count', data_quality: {} },
      { key: 'colis_preparation', value: 3, unit: 'count', data_quality: {} },
      { key: 'colis_transit', value: 5, unit: 'count', data_quality: {} },
      { key: 'disponibles_relais', value: 6, unit: 'count', data_quality: {} },
      { key: 'retards_critiques', value: 1, unit: 'count', data_quality: { warning: '1 retard' } },
      { key: 'taux_completude_scans', value: 92, unit: '%', data_quality: {} },
      { key: 'taux_collecte_relais', value: 80, unit: '%', data_quality: {} },
    ],
    active_orders: [{
      reference: 'CMD-1', status: 'preparation', payment_status: 'paid', relais_name: 'Relais A',
      destination_island: 'Centre', parcels_count: 1, hours_since_last_event: 30,
    }],
    critical_delays: [{
      tracking_number: 'TRK-1', order_reference: 'CMD-2', status: 'in_transit', relais_name: 'Relais B', days_in_transit: 23,
    }],
    signals: [{
      signal_type: 'parcel_blocked', severity: 'critical', title: 'Colis bloqué',
      summary: 'Bloqué depuis plusieurs jours', recommendation: 'Vérifier le suivi',
    }],
    control_chain: {
      stages: [
        { key: 'ORDER', label: 'Commande' },
        { key: 'HUB_CONTROL', label: 'Contrôle HUB' },
        { key: 'RELAY', label: 'Relais' },
      ],
      structural_alerts: [{
        stage: 'HUB_CONTROL',
        health: 'RED',
        reason_code: 'hub_quarantine',
        summary: '3 commandes bloquées au contrôle HUB',
        owner_role: 'hub',
        order_count: 3,
        order_references: ['CMD-1', 'CMD-4', 'CMD-5'],
      }],
      by_stage: {
        ORDER: [],
        HUB_CONTROL: [{
          order_reference: 'CMD-1',
          health: 'RED',
          split: false,
          envelope: { type: 'HUB_UNIT', refs: ['HU-1'] },
          lineage: { purchase_orders: ['PO-1'], hub_units: ['HU-1'], parcels: [] },
        }],
        RELAY: [{
          order_reference: 'CMD-3',
          health: 'GREEN',
          split: false,
          envelope: { type: 'PARCEL', refs: ['P-3'] },
          lineage: { purchase_orders: ['PO-3'], hub_units: ['HU-3'], parcels: ['P-3'] },
        }],
      },
    },
  };
}

function globalContext() {
  return {
    actor: { id: 'hq-admin', role: 'admin' },
    access: { mode: 'global', allowedMarkets: ['CM', 'CG'], defaultMarket: null, capabilities: ['dashboard.global.read'] },
  };
}

function marketContext() {
  return {
    actor: { id: 'operator-cm', role: 'admin' },
    access: { mode: 'market', allowedMarkets: ['CM'], defaultMarket: 'CM', capabilities: ['dashboard.market.read'] },
  };
}

describe('LOT 2E-CANON — Operations vivant', () => {
  test('le schéma Operations respecte DashboardSchema', () => {
    const schema = schemaContract.validateDashboardSchema(operations.OPERATIONS_SCHEMA);
    expect(schema.id).toBe('operations');
    expect(schema.title).toBe('Commandes & logistique');
    expect(schema.description).toMatch(/client au relais/i);
    expect(schema.metrics.source).toBe('operations.metrics');
    expect(schema.alerts.source).toBe('operations.signals');
    expect(schema.sections.map(section => section.source)).toEqual([
      'operations.active-orders',
      'operations.critical-delays',
    ]);
  });

  test('projette les données backend sans recalcul métier', () => {
    const sources = operations.resolveSources(payloadFixture());
    expect(sources['operations.metrics']['retards-critiques']).toEqual(expect.objectContaining({ value: '1', tone: 'critical' }));
    expect(sources['operations.active-orders'][0]).toEqual(expect.objectContaining({ reference: 'CMD-1', attente: '30 h' }));
    expect(sources['operations.critical-delays'][0]).toEqual(expect.objectContaining({ tracking: 'TRK-1', transit: '23 j' }));
    expect(sources['operations.signals'][0]).toEqual({
      level: 'critical',
      title: 'Colis bloqué',
      message: 'Bloqué depuis plusieurs jours · Vérifier le suivi',
    });
  });

  test('la couche decision-first Operations reste limitée aux faits prouvés', () => {
    const payload = payloadFixture();
    const decisions = operationsDecision.decisionItems(payload, operations);

    expect(decisions.map(item => item.label)).toEqual([
      'Incidents critiques',
      'Retards critiques',
      'Paiements en attente',
    ]);
    expect(decisions.some(item => /cash|décisions terrain|dossiers douane|relais actifs/i.test(item.label))).toBe(false);

    expect(operationsDecision.workspaceSummary(payload, operations)).toHaveLength(4);
    expect(operationsDecision.networkProgress(payload, operations)).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Complétude scans', value: '92 %', percent: 92 }),
      expect.objectContaining({ label: 'Collecte relais', value: '80 %', percent: 80 }),
    ]));
    expect(operationsDecision.priorityOrders(payload, operations)[0]).toEqual(expect.objectContaining({
      title: 'CMD-1',
      priority: '30 h',
    }));
    expect(operationsDecision.delayItems(payload, operations)[0]).toEqual(expect.objectContaining({
      title: 'TRK-1',
      value: '23 j',
      tone: 'critical',
    }));
    expect(operationsDecision.controlChainColumns(payload)).toEqual([
      { key: 'ORDER', label: 'Commande', meta: { icon: '▤', accent: 'blue' }, alerts: [], orders: [] },
      {
        key: 'HUB_CONTROL',
        label: 'Contrôle HUB',
        meta: { icon: '✓', accent: 'violet' },
        alerts: [{
          health: 'RED',
          count: 3,
          code: 'hub_quarantine',
          summary: '3 commandes bloquées au contrôle HUB',
        }],
        orders: [{
          reference: 'CMD-1',
          health: 'RED',
          causes: [],
          envelope: { type: 'HUB_UNIT', label: 'Unité HUB', refs: ['HU-1'] },
          lineage: { purchase_orders: ['PO-1'], hub_units: ['HU-1'], parcels: [] },
          split: false,
          href: '/admin/orders/CMD-1',
        }],
      },
      {
        key: 'RELAY',
        label: 'Relais',
        meta: { icon: '●', accent: 'green' },
        alerts: [],
        orders: [{
          reference: 'CMD-3',
          health: 'GREEN',
          causes: [],
          envelope: { type: 'PARCEL', label: 'Colis', refs: ['P-3'] },
          lineage: { purchase_orders: ['PO-3'], hub_units: ['HU-3'], parcels: ['P-3'] },
          split: false,
          href: '/admin/orders/CMD-3',
        }],
      },
    ]);
    expect(operationsDecision.controlHealthSummary(payload)).toEqual({
      GREEN: 1,
      ORANGE: 0,
      RED: 1,
      UNKNOWN: 0,
    });
    expect(operationsDecision.controlStageMeta('CUSTOMS')).toEqual({ icon: '⌂', accent: 'red' });
    expect(operationsDecision.controlEnvelope({ envelope: { type: 'PURCHASE_ORDER', refs: ['PO-42'] } }))
      .toEqual({ type: 'PURCHASE_ORDER', label: 'PO fournisseur', refs: ['PO-42'] });
    expect(operationsDecision.controlLineage({ lineage: { purchase_orders: ['PO-42'], parcels: ['P-42'] } }))
      .toEqual({ purchase_orders: ['PO-42'], hub_units: [], parcels: ['P-42'] });
  });

  test('la vue d’ensemble ne rend aucun panneau secondaire non demandé', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'js', 'operations-decision.js'),
      'utf8'
    );
    expect(source).not.toContain("cardSection(doc, 'File d’exécution'");
    expect(source).not.toContain("cardSection(doc, 'Colis en retard critique'");
    expect(source).not.toContain("cardSection(doc, 'Approfondir'");
    expect(source).not.toContain('kmc-control-structural-alerts');
  });

  test('résout la source uniquement depuis AdminContext', () => {
    expect(operations.endpointForContext(globalContext(), adminContextContract))
      .toBe('/api/admin/dashboard/operations');
    expect(operations.endpointForContext(marketContext(), adminContextContract))
      .toBe('/api/admin/dashboard/operations/market/CM');
    expect(operations.endpointForContext(globalContext(), adminContextContract, 'CG'))
      .toBe('/api/admin/dashboard/operations/market/CG');
    expect(() => operations.endpointForContext(marketContext(), adminContextContract, 'CG'))
      .toThrow(/autorisés par le serveur/);
  });

  test('mount marché charge directement Operations CM', async () => {
    const root = {};
    const render = jest.fn();
    const renderer = { createRenderer: jest.fn(() => ({ render })) };
    const fetch = jest.fn().mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue(payloadFixture()) });

    const result = await operations.mount({
      root,
      document: {},
      ui: {},
      fetch,
      renderer,
      adminContext: marketContext(),
      contextContract: adminContextContract,
      user: { role: 'admin' },
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/api/admin/dashboard/operations/market/CM', expect.objectContaining({ method: 'GET', credentials: 'include' }));
    expect(result.endpoint).toBe('/api/admin/dashboard/operations/market/CM');
    expect(render).toHaveBeenNthCalledWith(1, root, operations.OPERATIONS_SCHEMA, expect.objectContaining({ state: 'loading' }));
    expect(render).toHaveBeenNthCalledWith(2, root, operations.OPERATIONS_SCHEMA, expect.objectContaining({
      data: expect.objectContaining({ 'operations.metrics': expect.any(Object) }),
    }));
  });
});

describe('Control Chain — UNKNOWN jamais GREEN, causes serveur affichées', () => {
  test('santé absente ou inconnue → UNKNOWN (classe is-unknown), jamais is-positive', () => {
    expect(operationsDecision.controlHealthClass('GREEN')).toBe('is-positive');
    expect(operationsDecision.controlHealthClass('ORANGE')).toBe('is-warning');
    expect(operationsDecision.controlHealthClass('RED')).toBe('is-critical');
    for (const value of ['UNKNOWN', undefined, null, '', 'green', 'OK']) {
      expect(operationsDecision.controlHealthClass(value)).toBe('is-unknown');
    }
    const columns = operationsDecision.controlChainColumns({
      control_chain: { stages: [{ key: 'ORDER', label: 'Commande' }], by_stage: { ORDER: [{ order_reference: 'CMD-9' }] } },
    });
    expect(columns[0].orders[0].health).toBe('UNKNOWN');
  });

  test('jusqu’à 3 causes du serveur sont projetées avec leur propriétaire', () => {
    const columns = operationsDecision.controlChainColumns({
      control_chain: {
        stages: [{ key: 'HUB_CONTROL', label: 'Contrôle HUB' }],
        by_stage: { 'HUB_CONTROL': [{
          order_reference: 'CMD-2', health: 'ORANGE',
          exceptions: [
            { code: 'observation_stale', summary: 'Observation métier trop ancienne', owner_role: 'hub' },
            { code: 'b' }, { code: 'c' }, { code: 'd' },
          ],
        }] },
      },
    });
    const causes = columns[0].orders[0].causes;
    expect(causes).toHaveLength(3);
    expect(causes[0]).toEqual({ code: 'observation_stale', summary: 'Observation métier trop ancienne', owner: 'hub' });
    expect(causes[1].owner).toBeNull();
  });
});

test('operations : la frontière Commerce / Commandes & logistique est énoncée dans le sous-titre', () => {
  expect(operations.OPERATIONS_SCHEMA.description).toContain('Ce qui s’exécute');
});

