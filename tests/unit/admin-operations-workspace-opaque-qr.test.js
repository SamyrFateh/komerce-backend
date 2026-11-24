'use strict';
/** @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('fs'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../../routes/admin-operations-workspace.js'),'utf8');
describe('Route Hub labels — autorité et séparation des gestes',()=>{
  test('les émissions sont des POST, les impressions des GET sous rôle et capability',()=>{
    for(const url of ['labels/articles/:allocationId/issue','labels/boxes/:unitId/issue',
      'labels/resolve']){
      expect(source).toContain(url);
    }
    expect(source).toContain("['ARTICLE','articles','execution.parcel.receive']");
    expect(source).toContain("['COMBOX','boxes','execution.parcel.ship']");
    expect(source).toContain("'/:id/print'");
    expect(source).toContain("requireHubWorkspaceAction");
    expect(source).toContain("private, no-store");
    expect(source).toContain("img-src data:");
  });
  test('relai de destination et COMBOX scannée contrôlés côté serveur',()=>{
    expect(source).toContain("HUB_LABEL_BOX_RELAY_MISMATCH");
    expect(source).toContain("boxScanMatches");
    expect(source).toContain("physical_unit_id");
    expect(source).toContain("relay/labels/resolve");
  });
});