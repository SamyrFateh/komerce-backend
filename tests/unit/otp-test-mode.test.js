'use strict';

/**
 * tests/unit/otp-test-mode.test.js
 *
 * Fix FRESH-111 — Aucun test n'exerçait otp-test-mode.js malgré le risque
 * de bypass d'authentification si la garde production venait à régresser.
 *
 * Couverture :
 *   - isOtpTestMode() : activé hors prod, toujours false en prod
 *   - getMasterCode() : valeur par défaut + OTP_TEST_CODE custom + rejet invalide
 *   - isMasterCode()  : vrai en mode test, toujours false hors mode test
 *   - Garde production : OTP_TEST_MODE=true ignoré si NODE_ENV=production
 */

const { isOtpTestMode, getMasterCode, isMasterCode } = require('../../middleware/otp-test-mode');

// Helpers pour manipuler l'environnement proprement entre les tests
function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// isOtpTestMode doit être re-évalué à chaque test car il lit process.env en live.
// On réimporte le module via un reset de cache pour garantir l'isolation.
function freshModule() {
  delete require.cache[require.resolve('../../middleware/otp-test-mode')];
  return require('../../middleware/otp-test-mode');
}

describe('otp-test-mode — isOtpTestMode()', () => {
  test('retourne false quand OTP_TEST_MODE est absent', () => {
    withEnv({ NODE_ENV: 'test', OTP_TEST_MODE: undefined }, () => {
      const { isOtpTestMode: fn } = freshModule();
      expect(fn()).toBe(false);
    });
  });

  test('retourne true quand OTP_TEST_MODE=true et NODE_ENV != production', () => {
    withEnv({ NODE_ENV: 'test', OTP_TEST_MODE: 'true' }, () => {
      const { isOtpTestMode: fn } = freshModule();
      expect(fn()).toBe(true);
    });
  });

  test('retourne false quand OTP_TEST_MODE=true mais NODE_ENV=production (GARDE PROD)', () => {
    withEnv({ NODE_ENV: 'production', OTP_TEST_MODE: 'true' }, () => {
      const { isOtpTestMode: fn } = freshModule();
      expect(fn()).toBe(false);
    });
  });

  test('retourne false si NODE_ENV=production même sans OTP_TEST_MODE', () => {
    withEnv({ NODE_ENV: 'production', OTP_TEST_MODE: undefined }, () => {
      const { isOtpTestMode: fn } = freshModule();
      expect(fn()).toBe(false);
    });
  });

  test('retourne false si OTP_TEST_MODE vaut autre chose que "true"', () => {
    withEnv({ NODE_ENV: 'test', OTP_TEST_MODE: '1' }, () => {
      const { isOtpTestMode: fn } = freshModule();
      expect(fn()).toBe(false);
    });
  });
});

describe('otp-test-mode — getMasterCode()', () => {
  test('renvoie le code par défaut 424242 si OTP_TEST_CODE absent', () => {
    withEnv({ OTP_TEST_CODE: undefined }, () => {
      const { getMasterCode: fn } = freshModule();
      expect(fn()).toBe('424242');
    });
  });

  test('renvoie OTP_TEST_CODE custom si valide (6 chiffres)', () => {
    withEnv({ OTP_TEST_CODE: '123456' }, () => {
      const { getMasterCode: fn } = freshModule();
      expect(fn()).toBe('123456');
    });
  });

  test('replie sur 424242 si OTP_TEST_CODE invalide (< 6 chiffres)', () => {
    withEnv({ OTP_TEST_CODE: '123' }, () => {
      const { getMasterCode: fn } = freshModule();
      expect(fn()).toBe('424242');
    });
  });

  test('replie sur 424242 si OTP_TEST_CODE contient des lettres', () => {
    withEnv({ OTP_TEST_CODE: 'abc123' }, () => {
      const { getMasterCode: fn } = freshModule();
      expect(fn()).toBe('424242');
    });
  });

  test('replie sur 424242 si OTP_TEST_CODE vide', () => {
    withEnv({ OTP_TEST_CODE: '' }, () => {
      const { getMasterCode: fn } = freshModule();
      expect(fn()).toBe('424242');
    });
  });
});

describe('otp-test-mode — isMasterCode()', () => {
  test('retourne true pour le code maître en mode test', () => {
    withEnv({ NODE_ENV: 'test', OTP_TEST_MODE: 'true', OTP_TEST_CODE: undefined }, () => {
      const { isMasterCode: fn } = freshModule();
      expect(fn('424242')).toBe(true);
    });
  });

  test('retourne false pour un mauvais code en mode test', () => {
    withEnv({ NODE_ENV: 'test', OTP_TEST_MODE: 'true', OTP_TEST_CODE: undefined }, () => {
      const { isMasterCode: fn } = freshModule();
      expect(fn('000000')).toBe(false);
    });
  });

  test('retourne false hors mode test même avec le bon code', () => {
    withEnv({ NODE_ENV: 'test', OTP_TEST_MODE: undefined }, () => {
      const { isMasterCode: fn } = freshModule();
      expect(fn('424242')).toBe(false);
    });
  });

  test('retourne toujours false en production (GARDE PROD CRITIQUE)', () => {
    withEnv({ NODE_ENV: 'production', OTP_TEST_MODE: 'true' }, () => {
      const { isMasterCode: fn } = freshModule();
      expect(fn('424242')).toBe(false);
    });
  });

  test('gère null/undefined sans lever d\'exception', () => {
    withEnv({ NODE_ENV: 'test', OTP_TEST_MODE: 'true' }, () => {
      const { isMasterCode: fn } = freshModule();
      expect(fn(null)).toBe(false);
      expect(fn(undefined)).toBe(false);
      expect(fn('')).toBe(false);
    });
  });

  test('utilise OTP_TEST_CODE custom si défini', () => {
    withEnv({ NODE_ENV: 'test', OTP_TEST_MODE: 'true', OTP_TEST_CODE: '654321' }, () => {
      const { isMasterCode: fn } = freshModule();
      expect(fn('654321')).toBe(true);
      expect(fn('424242')).toBe(false); // l'ancien default ne doit plus marcher
    });
  });
});
