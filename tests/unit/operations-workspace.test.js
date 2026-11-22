/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

const fs = require('fs');
const path = require('path');

describe('Hub Live direct COMBOX workspace', () => {
  const source = fs.readFileSync(path.join(__dirname,
    '../../public/dashboards/canonical/js/operations-workspace.js'), 'utf8');

  test('initialise, compose avec preuve explicite, puis ferme une COMBOX', () => {
    expect(source).toContain("endpointFor(context.marketCode, 'boxes')");
    expect(source).toContain("endpointFor(context.marketCode,'boxes/'+encodeURIComponent(box.unit_id)+'/fill')");
    expect(source).toContain("endpointFor(context.marketCode,'boxes/'+encodeURIComponent(box.unit_id)+'/close')");
    expect(source).toContain("boxScan.setAttribute('data-hub-box-scan','')");
    expect(source).toContain("evidence_method:'SCAN',evidence_code:code.value.trim()");
    expect(source).toContain("evidence_method:'MANUAL',evidence_ref:proofRef");
  });

  test('ne propose plus de sac numérique dans le parcours Hub', () => {
    expect(source).not.toContain('data-hub-bag-preparation');
    expect(source).not.toContain('bag_reference_scan');
    expect(source).toContain('Fermer la COMBOX');
  });
});
