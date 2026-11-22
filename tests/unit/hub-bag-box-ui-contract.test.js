'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('fs');
const path=require('path');
const workspace=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/js/operations-workspace.js'),'utf8');
const routes=fs.readFileSync(path.join(__dirname,'../../routes/admin-operations-workspace.js'),'utf8');
const service=require('../../services/hub-bag-box-service');

describe('Hub V1 — COMBOX directe / relais',()=>{
  test('Hub Live compose et ferme une COMBOX directement depuis les quantités réceptionnées',()=>{
    expect(workspace).not.toContain("data-hub-bag-preparation");
    expect(workspace).not.toContain("create-customer-bag");
    expect(workspace).not.toContain("data-hub-bag-scan");
    expect(workspace).not.toContain("put-bag-in-box");
    expect(workspace).toContain("Initialiser une COMBOX");
    expect(workspace).toContain("data-hub-box-scan");
    expect(workspace).toContain("'fill-box'");
    expect(workspace).toContain("'close-box'");
    expect(workspace).toContain("from_unit_id:line.from_unit_id,allocation_id:line.allocation_id,quantity");
    expect(workspace).toContain("box_reference_scan:boxScan.value.trim()");
    expect(workspace).toContain("evidence_method:'SCAN',evidence_code:code.value.trim()");
    expect(workspace).toContain("evidence_method:'MANUAL',evidence_ref:proofRef");
  });
  test('la route de remplissage exige le scan COMBOX et la preuve de chaque article',()=>{
    const i=routes.indexOf("'/market/:marketCode/boxes/:unitId/fill'");
    expect(i).toBeGreaterThan(0);
    const block=routes.slice(i,i+1800);
    expect(block).toContain('box_reference_scan');
    expect(block).toContain('HUB_BOX_SCAN_MISMATCH');
    expect(block).toContain('HUB_BOX_ITEM_EVIDENCE_REQUIRED');
    expect(block).toContain('evidence_method: body.evidence_method');
    expect(routes).toContain("'/market/:marketCode/boxes/:unitId/close'");
    expect(routes).toContain("operator_action: 'close_combox'");
  });

  test('le relais lit les articles de la COMBOX sans interface de sac',()=>{
    expect(workspace).not.toContain("data-relay-bag-scanner");
    expect(workspace).not.toContain("relay-lookup-bag");
    expect(workspace).toContain("data-relay-item");
    expect(workspace).toContain("Attester la réception");
    expect(routes).toContain("'/market/:marketCode/relay-shipments/:reference/bags/:bagRef'");
    expect(routes).toContain("requireRelayPhysicalMarket");
    expect(routes).toContain("req.relayMarketAuthority ? req.relayMarketAuthority.relais_id");
  });
  test('POST de préparation autorisé seulement par le marché serveur et le rôle Hub',()=>{
    const i=routes.indexOf("'/market/:marketCode/bags',");
    expect(i).toBeGreaterThan(0);
    const block=routes.slice(i,i+3200);
    expect(block).toContain("attachHubExecutionCapability('execution.parcel.ship')");
    expect(block).toContain('requireHubWorkspaceAction');
    expect(block).toContain('market_id=$2');
    expect(block).toContain('createOperatorUnitCommand');
  });
  test('lecture historique d’un sac résout encore commande, colis et contenu authentique',async()=>{
    const fake={
      query:jest.fn()
        .mockResolvedValueOnce({rows:[{
          bag_unit_id:'bag',bag_reference:'KOM-SAC-1',order_reference:'KOM-101',
          parcel_reference:'KOM-PARCEL-1',shipment_reference:'EXP-1'
        }]})
        .mockResolvedValueOnce({rows:[{order_item_id:'item',product_sku_id:'sku',quantity:2}]}),
    };
    const MARKET='11111111-1111-4111-8111-111111111111';
    const result=await service.getBagAtRelay({
      bagReference:'KOM-SAC-1',shipmentReference:'EXP-1',expectedMarketId:MARKET,
    },fake);
    expect(result.order_reference).toBe('KOM-101');
    expect(result.contents).toEqual([{order_item_id:'item',product_sku_id:'sku',quantity:2}]);
    expect(fake.query).toHaveBeenCalledTimes(2);
  });
});
