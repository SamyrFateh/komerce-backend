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

describe('Hub V1 — sac client physique / KOM-BOX / relais',()=>{
  test('Hub Live crée et remplit un sac par commande avant scan de la KOM-BOX',()=>{
    expect(workspace).toContain("data-hub-bag-preparation");
    expect(workspace).toContain("create-customer-bag");
    expect(workspace).toContain("scan-bag-deposit");
    expect(workspace).toContain("close-customer-bag");
    expect(workspace).toContain("body: {order_id:order.order_id,bag_plan:bagPlan}");
    expect(workspace).toContain("evidence_method:'SCAN'");
    expect(workspace).toContain("data-hub-box-scan");
    expect(workspace).toContain("data-hub-bag-scan");
    expect(workspace).toContain("put-bag-in-box");
    expect(workspace).not.toContain("'fill-box'");
    expect(workspace).not.toContain("'Ajouter au carton'");
  });
  test('le relais scanne le même sac sans présumer réception',()=>{
    expect(workspace).toContain("data-relay-bag-scanner");
    expect(workspace).toContain("relay-lookup-bag");
    expect(workspace).toContain("/bags/'+encodeURIComponent(code)");
    expect(workspace).toContain("Attester la réception");
    expect(routes).toContain("'/market/:marketCode/relay-shipments/:reference/bags/:bagRef'");
    expect(routes).toContain("requireRelayPhysicalMarket");
    expect(routes).toContain("req.relayMarketAuthority ? req.relayMarketAuthority.relais_id");
  });
  test('POST de préparation autorisé seulement par le marché serveur et le rôle Hub',()=>{
    const i=routes.indexOf("'/market/:marketCode/bags',");
    expect(i).toBeGreaterThan(0);
    const block=routes.slice(i,i+1300);
    expect(block).toContain("attachHubExecutionCapability('execution.parcel.ship')");
    expect(block).toContain('requireHubWorkspaceAction');
    expect(block).toContain('market_id=$2');
    expect(block).toContain('createOperatorUnitCommand');
  });
  test('scan du sac au relais résout commande, colis et contenu authentique',async()=>{
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
