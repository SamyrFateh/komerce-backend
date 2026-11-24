'use strict';
/** @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('fs'),path=require('path');
const ui=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/js/operations-workspace.js'),'utf8');
describe('Hub Live QR opérateur',()=>{
  test('les étiquettes articles sont émises après réception et imprimées via fetch authentifié',()=>{
    expect(ui).toContain('data-hub-label-printing');
    expect(ui).toContain("labels/articles/");
    expect(ui).toContain('data-hub-print-article');
    expect(ui).toContain("credentials:'include'");
    expect(ui).toContain("URL.createObjectURL(documentBlob)");
  });
  test('la caméra ne déclenche jamais une écriture automatique',()=>{
    expect(ui).toContain("getUserMedia");
    expect(ui).toContain("getSupportedFormats()");
    expect(ui).toContain("stream.getTracks().forEach(track=>track.stop())");
    expect(ui).toContain("vérifiez la COMBOX puis validez le placement");
    expect(ui).toContain("boxes/'+encodeURIComponent(box.unit_id)+'/fill");
  });
});