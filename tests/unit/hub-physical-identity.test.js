/** @test-kind unit @test-runner jest @test-requires none
 * H3 (#3998) — réception d'une PO regroupée : reçu unique (HB-06), verrou des lignes (HB-07), erreur lisible (HB-07).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../services/hub-physical-identity.js'), 'utf8');

describe('hub-physical-identity — réception regroupée', () => {
  test('HB-06 : le reçu des lignes vient de l\'unique fonction SQL, plus d\'un SUM local sur les placements RECEIVE', () => {
    expect(src).toMatch(/purchase_line_received_quantity\(pl\.id\) AS received/);
    expect(src).toMatch(/SELECT purchase_line_received_quantity\(\$1\) AS received/);
    expect(src).not.toMatch(/p\.operation_type = 'RECEIVE'\s*\n\s*\), 0\) AS received/);
  });

  test('HB-07 : les lignes de la variante sont verrouillées FOR UPDATE avant la lecture du reçu', () => {
    expect(src).toMatch(/FOR UPDATE OF pl FOR SHARE OF po/);
  });

  test('HB-07 : la garde base hub_allocation_overplaced devient HUB_ALLOCATION_OVERRECEIVED avec un message exploitable', () => {
    expect(src).toMatch(/hub_allocation_overplaced/);
    expect(src).toMatch(/fail\('HUB_ALLOCATION_OVERRECEIVED', 'Réception simultanée/);
  });
});
