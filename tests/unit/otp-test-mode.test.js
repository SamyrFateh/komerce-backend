/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * Tests unitaires — services/otp-test-mode.js
 * FRESH-071 / FRESH-111
 *
 * Objectif : garantir que le bypass OTP n'est JAMAIS actif en production,
 * quelle que soit la valeur de OTP_TEST_MODE dans l'env.
 */

'use strict';

describe('otp-test-mode', () => {
  let otpTestMode;

  // Sauvegarder/restaurer l'env et le module entre chaque test
  const origEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    // Restaurer l'env exactement
    for (const key of Object.keys(process.env)) {
      if (!(key in origEnv)) delete process.env[key];
    }
    Object.assign(process.env, origEnv);
  });

  // ── Cas 1 : prod + OTP_TEST_MODE=true → JAMAIS de bypass ────────────────
  it('isOtpTestMode() renvoie false en NODE_ENV=production, même si OTP_TEST_MODE=true', () => {
    process.env.NODE_ENV = 'production';
    process.env.OTP_TEST_MODE = 'true';
    otpTestMode = require('../../services/otp-test-mode');
    expect(otpTestMode.isOtpTestMode()).toBe(false);
  });

  // ── Cas 2 : prod + env absent → false ───────────────────────────────────
  it('isOtpTestMode() renvoie false en production sans OTP_TEST_MODE', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.OTP_TEST_MODE;
    otpTestMode = require('../../services/otp-test-mode');
    expect(otpTestMode.isOtpTestMode()).toBe(false);
  });

  // ── Cas 3 : dev + env absent → false ────────────────────────────────────
  it('isOtpTestMode() renvoie false en dev sans OTP_TEST_MODE', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.OTP_TEST_MODE;
    otpTestMode = require('../../services/otp-test-mode');
    expect(otpTestMode.isOtpTestMode()).toBe(false);
  });

  // ── Cas 4 : dev + OTP_TEST_MODE=true → activé ───────────────────────────
  it('isOtpTestMode() renvoie true en développement avec OTP_TEST_MODE=true', () => {
    process.env.NODE_ENV = 'development';
    process.env.OTP_TEST_MODE = 'true';
    otpTestMode = require('../../services/otp-test-mode');
    expect(otpTestMode.isOtpTestMode()).toBe(true);
  });

  // ── Cas 5 : isMasterCode → false hors mode test ─────────────────────────
  it('isMasterCode() renvoie false en production même avec le code maître', () => {
    process.env.NODE_ENV = 'production';
    process.env.OTP_TEST_MODE = 'true';
    otpTestMode = require('../../services/otp-test-mode');
    expect(otpTestMode.isMasterCode('424242')).toBe(false);
  });

  // ── Cas 6 : isMasterCode → true en dev ──────────────────────────────────
  it('isMasterCode() renvoie true en dev avec le code par défaut 424242', () => {
    process.env.NODE_ENV = 'development';
    process.env.OTP_TEST_MODE = 'true';
    delete process.env.OTP_TEST_CODE;
    otpTestMode = require('../../services/otp-test-mode');
    expect(otpTestMode.isMasterCode('424242')).toBe(true);
  });

  // ── Cas 7 : OTP_TEST_CODE custom ────────────────────────────────────────
  it('getMasterCode() utilise OTP_TEST_CODE si valide (6 chiffres)', () => {
    process.env.NODE_ENV = 'development';
    process.env.OTP_TEST_MODE = 'true';
    process.env.OTP_TEST_CODE = '123456';
    otpTestMode = require('../../services/otp-test-mode');
    expect(otpTestMode.getMasterCode()).toBe('123456');
  });

  // ── Cas 8 : OTP_TEST_CODE invalide → fallback 424242 ────────────────────
  it('getMasterCode() retombe sur 424242 si OTP_TEST_CODE invalide', () => {
    process.env.NODE_ENV = 'development';
    process.env.OTP_TEST_MODE = 'true';
    process.env.OTP_TEST_CODE = 'abc'; // non numérique → invalide
    otpTestMode = require('../../services/otp-test-mode');
    expect(otpTestMode.getMasterCode()).toBe('424242');
  });
});
