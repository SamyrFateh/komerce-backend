/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

const fs = require('fs');
const path = require('path');

describe('Hub Live COMBOX workspace routes', () => {
  const source = fs.readFileSync(path.join(__dirname,
    '../../routes/admin-operations-workspace.js'), 'utf8');

  test('la composition impose le scan cible et la preuve article', () => {
    expect(source).toContain("'/market/:marketCode/boxes/:unitId/fill'");
    expect(source).toContain("'/market/:marketCode/boxes/:unitId/close'");
    expect(source).toContain('body.box_reference_scan');
    expect(source).toContain('evidence_method: body.evidence_method, evidence_code: body.evidence_code, evidence_ref: body.evidence_ref');
  });

  test('la fermeture exige une référence concordante et un contenu non vide', () => {
    expect(source).toContain("SELECT id, reference, state FROM hub_physical_units WHERE id=$1 AND unit_type='MARKET_PARCEL' FOR UPDATE");
    expect(source).toContain("if (Number(contents.count) < 1)");
    expect(source).toContain("toState: sequence[i]");
  });
});
