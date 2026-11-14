/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

const fs = require('fs');
const path = require('path');

describe('HB-09 — suppression du writer colis Hub legacy (#4013)', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../routes/hub-dashboard.js'), 'utf8');

  test('l\'ancien endpoint ship est authentifié et répond 410, sans déclencher un writer de colis', () => {
    expect(source).toContain("router.post('/parcels/:id/ship', ...hubAuth, legacyHubWriterClosed);");
    expect(source).toContain("code: 'HUB_LEGACY_WRITER_CLOSED'");
    expect(source).not.toContain('appendParcelShipmentInfo(');
    expect(source).not.toContain('safeSyncScanToParcels(');
    expect(source).not.toContain("newStatus: 'shipped'");
  });

  test('incident, commentaire et escalade restent séparés et sécurisés', () => {
    for (const suffix of ['/incident', '/comment', '/escalate']) {
      expect(source).toContain("router.post('/orders/:id" + suffix + "', ...hubSupervise");
    }
  });
});
