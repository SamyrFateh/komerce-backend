'use strict';
/** @test-kind unit @test-runner jest @test-requires none */

const db = { query: jest.fn() };
jest.mock('../../db', () => db);
const model = require('../../services/incident-traceability-projection');

const ORDER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const PO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const INCIDENT = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';

beforeEach(() => jest.clearAllMocks());

const item = overrides => ({
  id: INCIDENT, incident_type:'reconciliation_error',
  subtype:'hub_purchase_identity_conflict', physical_unit_id:'unit-1',
  purchase_order_id:PO, status:'open', severity:'high',
  origin_domain:'LOGISTICS', resolver_domain:'PURCHASING',resolution_class:'UPSTREAM_TRUTH',
  title:'Identité fournisseur incohérente',description:'Écart de réception',
  created_at:'2026-11-01T08:00:00Z',
  client_impact:'none', ...overrides
});

test('same persistent incident is returned for PO and order without creating a copy',async()=>{
  db.query.mockResolvedValue({rows:[item({order_reference:'CMD-KM-22'})]});
  const [poRows,orderRows]=await Promise.all([
    model.listForPurchaseOrder(PO),
    model.listForOrder({id:ORDER,reference:'CMD-KM-22'}),
  ]);
  expect(poRows[0].reference).toBe(orderRows[0].reference);
  expect(poRows[0]).toMatchObject({owner_role:'sourcing',business_blocking:true});
  expect(poRows[0].next_action).toContain('Achats');
  expect(JSON.stringify(poRows)).not.toContain(INCIDENT);
  expect(db.query.mock.calls[0][0]).toContain("i.details->>'purchase_order_id' = $1::text");
  expect(db.query.mock.calls[1][0]).toContain('pl.purchase_order_id = po.id');
});

test('À traiter ne remonte que les blocages prouvés, ouverts et traçables',async()=>{
  for(const [row,blocked] of [
    [item({status:'resolved'}),false],
    [item({severity:'medium',subtype:'status_scan_mismatch',client_impact:'none'}),false],
    [item({severity:'high',client_impact:'delayed',subtype:'status_scan_mismatch'}),false],
    [item({physical_unit_id:null,client_impact:'none'}),false],
    [item({client_impact:'blocked',severity:'critical',subtype:'status_scan_mismatch'}),true],
    [item(),true],
  ]){
    expect(model.isBusinessBlocker(row)).toBe(blocked);
  }
  db.query.mockResolvedValue({rows:[item()]});
  const results=await model.listGlobalOpen();
  expect(results).toHaveLength(1);
  expect(results[0].business_blocking).toBe(true);
  expect(results[0].purchase_order_link).toBe('/admin/workspaces/purchasing?po='+PO);
  const query=db.query.mock.calls[0][0];
  expect(query).toContain("i.client_impact IN ('blocked','partial_delivery')");
  expect(query).toContain("i.details->>'physical_unit_id'");
  expect(query).toContain("i.status IN ('open','investigating')");
});

test('aucun identifiant de marché ou de PO fourni par le navigateur ne pilote le scope',async()=>{
  await expect(model.listForPurchaseOrder('not-a-uuid')).rejects.toThrow('server_resolved');
  await expect(model.listForOrder({id:'bad',reference:'CMD-KM-22'})).rejects.toThrow('server_resolved');
  expect(db.query).not.toHaveBeenCalled();
});
