/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const counts={purchase_lines:0,purchase_orders:0,hub_allocations:0,hub_units:0,shipment_receipts:0,shipped_scans:0,
 shipped_scan_events:0,shipping_history:0,relay_receipts:0,available_history:0,collected_history:0,consumed_allocations:0,cash_collections:0};
let mockSnap;
jest.mock('../../scripts/recette/staging-local-stock-real-relay-cert',()=>({snapshot:async()=>mockSnap}));
const {assertNoHubOrTransport}=require('../../scripts/recette/canonical/local-stock-oracles');
const db={query:async()=>({rows:[{shipments:0,po_lines:0}]})};
describe('M02 oracle phase any',()=>{
 it("juste après l'achat (commande en attente, sans réception) : 'any' ne contrôle que zéro Hub/PO/transport",async()=>{
  mockSnap={order:{status:'pending'},parcels:[{status:'pending',shipment_id:null}],lines:[{quantity:1,fulfillment_source:'LOCAL_STOCK',qty_received:0,qty_collected:0}],counts:{...counts}};
  await expect(assertNoHubOrTransport(db,'o','any')).resolves.toMatchObject({phase:'any',purchase_orders:0});
 });
 it("'any' échoue toujours si un PO apparaît",async()=>{
  mockSnap={order:{status:'pending'},parcels:[],lines:[{quantity:1,fulfillment_source:'LOCAL_STOCK'}],counts:{...counts,purchase_orders:1}};
  await expect(assertNoHubOrTransport(db,'o','any')).rejects.toThrow(/purchase_orders/);
 });
 it("'available' exige toujours la mise à disposition",async()=>{
  mockSnap={order:{status:'pending'},parcels:[{status:'pending',shipment_id:null}],lines:[{quantity:1,fulfillment_source:'LOCAL_STOCK',qty_received:0,qty_collected:0}],counts:{...counts,cash_collections:1}};
  await expect(assertNoHubOrTransport(db,'o','available')).rejects.toThrow(/status_not_available/);
 });
});
