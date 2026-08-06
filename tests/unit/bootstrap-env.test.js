/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : bootstrap/env.js (Lot 0)
 *
 * `bootstrap/env.js` était absent de `collectCoverageFrom` (angle mort
 * structurel, Lot 0). Ce fichier porte deux garde-fous de sécurité critiques
 * en production (SEC-2/FRESH-010) : interdiction du bypass OTP et interdiction
 * de démarrer sur PayPal sandbox. Une régression ici est silencieuse jusqu'au
 * jour où elle laisse passer un déploiement prod dangereux.
 *
 * `process.exit` est mocké (sinon il tuerait le process de test). `dotenv`
 * est mocké pour ne jamais lire un vrai `.env` disque.
 *
 * Run : npx jest tests/unit/bootstrap-env.test.js
 */

'use strict';

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('../../utils/logger', () => ({ child: () => mockLog }));

const mockDotenvConfig = jest.fn();
jest.mock('dotenv', () => ({ config: (...args) => mockDotenvConfig(...args) }));

const { loadAndValidateEnv } = require('../../bootstrap/env');

const REQUIRED_KEYS = [
  'DATABASE_URL', 'JWT_SECRET', 'ADMIN_PASSWORD', 'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET', 'QR_SECRET', 'AUTHKEY_API_KEY',
  'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID',
  'META_WA_APP_SECRET',
];

const RECOMMENDED_KEYS = [
  'STRIPE_SHARED_CART_WEBHOOK_SECRET', 'STRIPE_PUBLISHABLE_KEY',
  'PAYPAL_ENV', 'TRANSITAIRE_PASSWORD', 'AUTHKEY_WEBHOOK_SECRET',
];

function setAllRequired(env) {
  REQUIRED_KEYS.forEach(k => { env[k] = `dummy-${k}`; });
}

function setAllRecommended(env) {
  RECOMMENDED_KEYS.forEach(k => { env[k] = `dummy-${k}`; });
}

describe('bootstrap/env — loadAndValidateEnv', () => {
  const ORIGINAL_ENV = process.env;
  let exitSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {}; // repart de zéro à chaque test — aucune fuite entre tests
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test('appelle toujours dotenv.config() en premier', () => {
    setAllRequired(process.env);
    loadAndValidateEnv();
    expect(mockDotenvConfig).toHaveBeenCalledTimes(1);
  });

  describe('variables requises', () => {
    test('toutes présentes → ok:true, pas de log.error, pas de process.exit', () => {
      setAllRequired(process.env);
      const result = loadAndValidateEnv();
      expect(result.ok).toBe(true);
      expect(result.missingRequired).toEqual([]);
      expect(mockLog.error).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    test('une variable manquante → log.error FATAL dédié + process.exit(1) (comportement par défaut)', () => {
      setAllRequired(process.env);
      delete process.env.JWT_SECRET;
      const result = loadAndValidateEnv();
      expect(result.ok).toBe(false);
      expect(result.missingRequired).toEqual(['JWT_SECRET']);
      expect(mockLog.error).toHaveBeenCalledWith(expect.stringMatching(/JWT_SECRET manquant/));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    test('plusieurs variables manquantes → un log.error PAR variable', () => {
      setAllRequired(process.env);
      delete process.env.STRIPE_SECRET_KEY;
      delete process.env.QR_SECRET;
      const result = loadAndValidateEnv();
      expect(result.missingRequired).toEqual(['STRIPE_SECRET_KEY', 'QR_SECRET']);
      expect(mockLog.error).toHaveBeenCalledWith(expect.stringMatching(/STRIPE_SECRET_KEY manquant/));
      expect(mockLog.error).toHaveBeenCalledWith(expect.stringMatching(/QR_SECRET manquant/));
    });

    test('exitOnMissing: false → log.error toujours émis mais process.exit PAS appelé', () => {
      setAllRequired(process.env);
      delete process.env.DATABASE_URL;
      const result = loadAndValidateEnv({ exitOnMissing: false });
      expect(result.ok).toBe(false);
      expect(mockLog.error).toHaveBeenCalledWith(expect.stringMatching(/DATABASE_URL manquant/));
      expect(exitSpy).not.toHaveBeenCalled();
    });

    test('toutes les clés requises documentées sont bien vérifiées (pas de désynchro avec le header)', () => {
      // Si une seule clé requise manque, elle doit apparaître — vérifie la liste complète d'un coup.
      const result = loadAndValidateEnv({ exitOnMissing: false }); // rien n'est set → tout manque
      expect(result.missingRequired.sort()).toEqual([...REQUIRED_KEYS].sort());
      expect(result.requiredEnv).toEqual(REQUIRED_KEYS);
    });
  });

  describe('variables recommandées', () => {
    test('toutes présentes → pas de log.warn', () => {
      setAllRequired(process.env);
      setAllRecommended(process.env);
      loadAndValidateEnv();
      expect(mockLog.warn).not.toHaveBeenCalled();
    });

    test('une variable recommandée manquante → log.warn dédié, mais ok:true et pas de process.exit', () => {
      setAllRequired(process.env);
      setAllRecommended(process.env);
      delete process.env.STRIPE_PUBLISHABLE_KEY;
      const result = loadAndValidateEnv();
      expect(result.ok).toBe(true);
      expect(result.missingRecommended).toEqual(['STRIPE_PUBLISHABLE_KEY']);
      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringMatching(/STRIPE_PUBLISHABLE_KEY non défini/));
      expect(exitSpy).not.toHaveBeenCalled();
    });

    test('recommandées manquantes n’affectent jamais missingRequired/ok', () => {
      setAllRequired(process.env); // aucune recommandée définie
      const result = loadAndValidateEnv();
      expect(result.ok).toBe(true);
      expect(result.missingRecommended).toEqual(RECOMMENDED_KEYS);
    });
  });

  describe('garde-fou production — bypass OTP interdit', () => {
    test('OTP_TEST_MODE=true en production → FATAL + process.exit(1)', () => {
      setAllRequired(process.env);
      process.env.NODE_ENV = 'production';
      process.env.PAYPAL_ENV = 'production'; // évite de déclencher l'autre garde-fou dans ce test
      process.env.OTP_TEST_MODE = 'true';
      loadAndValidateEnv();
      expect(mockLog.error).toHaveBeenCalledWith(expect.stringMatching(/OTP_TEST_MODE\/BOUTIQUE_TEST_OTP_BYPASS interdit en production/));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    test('BOUTIQUE_TEST_OTP_BYPASS=true en production → FATAL + process.exit(1)', () => {
      setAllRequired(process.env);
      process.env.NODE_ENV = 'production';
      process.env.PAYPAL_ENV = 'production';
      process.env.BOUTIQUE_TEST_OTP_BYPASS = 'true';
      loadAndValidateEnv();
      expect(mockLog.error).toHaveBeenCalledWith(expect.stringMatching(/OTP_TEST_MODE\/BOUTIQUE_TEST_OTP_BYPASS interdit en production/));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    test("OTP_TEST_MODE='1' (pas la string 'true') → PAS considéré comme un bypass actif", () => {
      setAllRequired(process.env);
      process.env.NODE_ENV = 'production';
      process.env.PAYPAL_ENV = 'production';
      process.env.OTP_TEST_MODE = '1';
      loadAndValidateEnv();
      expect(mockLog.error).not.toHaveBeenCalledWith(expect.stringMatching(/OTP_TEST_MODE/));
    });

    test('OTP_TEST_MODE=true HORS production → toléré, pas de FATAL', () => {
      setAllRequired(process.env);
      process.env.NODE_ENV = 'development';
      process.env.OTP_TEST_MODE = 'true';
      loadAndValidateEnv();
      expect(mockLog.error).not.toHaveBeenCalledWith(expect.stringMatching(/OTP_TEST_MODE/));
    });

    test('exitOnMissing:false en production avec bypass actif → FATAL loggé mais pas de process.exit', () => {
      setAllRequired(process.env);
      process.env.NODE_ENV = 'production';
      process.env.PAYPAL_ENV = 'production';
      process.env.OTP_TEST_MODE = 'true';
      loadAndValidateEnv({ exitOnMissing: false });
      expect(mockLog.error).toHaveBeenCalledWith(expect.stringMatching(/OTP_TEST_MODE/));
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  describe('garde-fou production — PayPal doit être en mode production', () => {
    test("PAYPAL_ENV absent en production → FATAL '(absent)' + process.exit(1)", () => {
      setAllRequired(process.env);
      process.env.NODE_ENV = 'production';
      delete process.env.PAYPAL_ENV;
      loadAndValidateEnv();
      expect(mockLog.error).toHaveBeenCalledWith(expect.stringMatching(/PAYPAL_ENV=\(absent\) en production/));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    test("PAYPAL_ENV='sandbox' en production → FATAL explicite avec la valeur, + exit", () => {
      setAllRequired(process.env);
      process.env.NODE_ENV = 'production';
      process.env.PAYPAL_ENV = 'sandbox';
      loadAndValidateEnv();
      expect(mockLog.error).toHaveBeenCalledWith(expect.stringMatching(/PAYPAL_ENV=sandbox en production/));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    test("PAYPAL_ENV='production' en production → ce garde-fou ne déclenche rien", () => {
      setAllRequired(process.env);
      process.env.NODE_ENV = 'production';
      process.env.PAYPAL_ENV = 'production';
      loadAndValidateEnv();
      expect(mockLog.error).not.toHaveBeenCalledWith(expect.stringMatching(/PAYPAL_ENV/));
    });

    test('PAYPAL_ENV=sandbox HORS production → toléré, pas de FATAL (usage dev normal)', () => {
      setAllRequired(process.env);
      process.env.NODE_ENV = 'development';
      process.env.PAYPAL_ENV = 'sandbox';
      loadAndValidateEnv();
      expect(mockLog.error).not.toHaveBeenCalledWith(expect.stringMatching(/PAYPAL_ENV/));
    });
  });

  describe('cumul des deux garde-fous production', () => {
    test('bypass OTP actif ET PayPal sandbox en même temps → les deux FATAL sont loggés', () => {
      setAllRequired(process.env);
      process.env.NODE_ENV = 'production';
      process.env.OTP_TEST_MODE = 'true';
      process.env.PAYPAL_ENV = 'sandbox';
      loadAndValidateEnv({ exitOnMissing: false }); // false pour observer les deux logs sans early-exit réel
      expect(mockLog.error).toHaveBeenCalledWith(expect.stringMatching(/OTP_TEST_MODE/));
      expect(mockLog.error).toHaveBeenCalledWith(expect.stringMatching(/PAYPAL_ENV=sandbox/));
    });
  });

  test('valeur de retour complète en run nominal', () => {
    setAllRequired(process.env);
    setAllRecommended(process.env);
    const result = loadAndValidateEnv();
    expect(result).toEqual({
      ok: true,
      requiredEnv: REQUIRED_KEYS,
      recommendedEnv: RECOMMENDED_KEYS,
      missingRequired: [],
      missingRecommended: [],
    });
  });
});
