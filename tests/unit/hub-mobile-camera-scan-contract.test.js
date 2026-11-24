'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @brief Webcam scan is an optional scanner input for the existing PO-code
 * identifier, not a substitute for authorized physical receipt.
 */
const fs = require('fs');
const path = require('path');
const ui = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/operations-workspace.js'), 'utf8');
const doctrine = fs.readFileSync(path.join(__dirname, '../../docs/doctrine/DOCTRINE_HUB_PHYSICAL_IDENTITY.md'), 'utf8');

describe('Hub mobile scan — physical evidence remains canonical', () => {
  test('mobile camera uses BarcodeDetector and rear camera on HTTPS-capable browser', () => {
    expect(ui).toContain("data-hub-mobile-camera");
    expect(ui).toContain('navigator.mediaDevices');
    expect(ui).toContain('getUserMedia');
    expect(ui).toContain("facingMode: { ideal: 'environment' }");
    expect(ui).toContain("'qr_code'");
    expect(ui).toContain('cameraVideo.setAttribute(\'playsinline\'');
    expect(ui).toContain('cameraVideo.srcObject = null');
    expect(ui).toContain('hubCameraStream.getTracks().forEach(track => track.stop())');
  });
  test('camera detects only, then uses the existing authenticated physical-code identification', () => {
    expect(ui).toContain("await identify(value)");
    expect(ui).toContain("supply/physical-code");
    expect(ui).toContain("scannerInput.value = value");
    expect(ui).toContain('Saisie manuelle (sans scanner)');
    expect(ui).toContain('proof_ref');
    expect(ui).not.toContain('cameraAutoReceive');
  });
  test('minimal label doctrine never treats a QR as pickup authority', () => {
    expect(doctrine).toContain('Étiquette opérationnelle minimale');
    expect(doctrine).toContain('identifiant opaque');
    expect(doctrine).toContain('petit code de secours opaque');
    expect(doctrine).toContain("Le QR n'est **pas un secret ni une preuve de remise**");
    expect(doctrine).toContain('référence commerciale');
  });
});
