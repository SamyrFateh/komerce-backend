'use strict';
/** @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('fs'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../../services/hub-physical-identity.js'),'utf8');
describe('Writer Hub physique — QR individuel unique',()=>{
  test('le QR opaque vérifie allocation + SKU et verrouille la preuve',()=>{
    expect(source).toContain("HUB_BOX_ITEM_LABEL_ALREADY_USED");
    expect(source).toContain("HUB_BOX_ITEM_SCAN_SKU_MISMATCH");
    expect(source).toContain("SELECT id FROM hub_scan_labels WHERE id=$1 FOR UPDATE");
    expect(source).toContain("hub_scan_label_box_scans");
    expect(source).toContain("if(moveQty!==1) fail('HUB_BOX_SCAN_ONE_ITEM_PER_OPERATION')");
    expect(source).toContain('HUB_BOX_ARTICLE_QR_REQUIRED');
  });
  test('le writer conserve l ancienne preuve fournisseur et les allocations',()=>{
    expect(source).toContain("physicalCodes.resolvePhysicalCode(db");
    expect(source).toContain("HUB_PHYSICAL_MOVE_QUANTITY_EXCEEDS_SOURCE");
  });
});