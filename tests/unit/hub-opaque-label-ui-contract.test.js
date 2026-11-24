'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @brief Contracts of label API, scan evidence, protected printing and mobile UI.
 */
const fs=require('fs'),path=require('path');
const from=p=>fs.readFileSync(path.join(__dirname,'../../',p),'utf8');
const ui=from('public/dashboards/canonical/js/operations-workspace.js');
const routes=from('routes/admin-operations-workspace.js');
const physical=from('services/hub-physical-identity.js');
const migration=from('migrations/427_hub_opaque_scan_labels.sql');

describe('Hub mobile labels — secure UI and writers',()=>{
  test('the phone scans QR but never moves stock without explicit operator action',()=>{
    expect(ui).toContain('data-hub-label-printing');
    expect(ui).toContain('data-hub-print-article');
    expect(ui).toContain('data-hub-print-box');
    expect(ui).toContain('labels/articles/');
    expect(ui).toContain('labels/boxes/');
    expect(ui).toContain('BarcodeDetector');
    expect(ui).toContain('getUserMedia');
    expect(ui).toContain("facingMode:{ideal:'environment'}");
    expect(ui).toContain("stream.getTracks().forEach(track=>track.stop())");
    expect(ui).toContain('QR non autorisé ou non disponible');
    expect(ui).toContain('vérifiez la COMBOX puis validez le placement');
    expect(ui).toContain("url:endpointFor(context.marketCode,'boxes/'+encodeURIComponent(box.unit_id)+'/fill')");
    expect(ui).not.toContain('autoConfirmQRScan');
  });
  test('the print action uses authenticated fetch; scanner is not a public tracking URL',()=>{
    expect(ui).toContain("context.fetch(href,{method:'GET',credentials:'include'");
    expect(ui).toContain('URL.createObjectURL(documentBlob)');
    expect(routes).toContain('hubLabels.printHtml');
    expect(routes).toContain("res.set('Cache-Control','private, no-store')");
    expect(routes).toContain("img-src data:");
    expect(routes).toContain("requireHubWorkspaceAction");
    expect(routes).toContain('attachHubExecutionCapability');
  });
  test('the COMBOX scan cannot bypass verified relay assignment',()=>{
    expect(routes).toContain('HUB_LABEL_BOX_RELAY_MISMATCH');
    expect(routes).toContain("label.target_type==='COMBOX'");
    expect(routes).toContain('boxScanMatches');
    expect(routes).toContain("labels/resolve");
  });
  test('COMBOX final label is issued after PACKED; scan and pose guard dispatch in canonical writer',()=>{
    const service=from('services/hub-opaque-labels.js');
    expect(service).toContain('HUB_LABEL_BOX_NOT_CLOSED');
    expect(ui).toContain("['PACKED','DISPATCHED'].includes(box.state)");
    expect(ui).toContain('data-hub-final-box-scan');
    expect(ui).toContain('data-hub-box-label-applied');
    expect(routes).toContain('label_applied_confirmed:body.label_applied_confirmed');
    expect(physical).toContain('HUB_BOX_FINAL_QR_REQUIRED');
    expect(physical).toContain('HUB_BOX_LABEL_APPLIED_REQUIRED');
    expect(physical).toContain('HUB_BOX_FINAL_QR_MISMATCH');
  });
  test('one article QR proves only a single BOX_PACK, within the canonical transaction',()=>{
    expect(physical).toContain('HUB_BOX_ITEM_LABEL_ALREADY_USED');
    expect(physical).toContain('hub_scan_label_box_scans');
    expect(physical).toContain('SELECT id FROM hub_scan_labels WHERE id=$1 FOR UPDATE');
    expect(physical).toContain('HUB_BOX_ITEM_SCAN_SKU_MISMATCH');
    expect(migration).toContain('label_id uuid PRIMARY KEY');
    expect(migration).toContain('uq_hub_label_article');
    expect(migration).toContain('uq_hub_label_combox');
  });
});
