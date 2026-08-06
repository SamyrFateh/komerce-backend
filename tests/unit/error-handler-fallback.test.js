'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/error-handler-fallback.test.js
 *
 * Tests des replis (fallbacks) de middleware/error-handler.js quand
 * require('../utils/logger') ou require('../services/monitoring') lèvent
 * une exception au chargement du module (dépendance manquante/HS).
 *
 * Fichier séparé de error-handler.test.js à dessein : ce dernier applique
 * un jest.mock() global sur ../../utils/logger et ../../services/monitoring
 * pour toute la durée du fichier, ce qui empêche un jest.doMock() local
 * (même via jest.isolateModules) de forcer un throw sur le même chemin —
 * la factory du jest.mock() global reste prioritaire pour ce fichier.
 * En isolant ces deux cas dans un fichier sans mock global concurrent,
 * jest.doMock() reprend la main normalement.
 */

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function makeReq(overrides = {}) {
  return {
    method: 'GET',
    originalUrl: '/api/test',
    headers: {},
    user: null,
    ...overrides,
  };
}

describe('errorHandler — repli si logger/monitoring indisponibles au chargement', () => {
  it("utilise un logger de repli (console) si require('../utils/logger') lève au chargement du module", () => {
    let freshErrorHandler;
    jest.isolateModules(() => {
      jest.doMock('../../utils/logger', () => { throw new Error('logger indisponible'); });
      jest.doMock('../../services/monitoring', () => ({ trackError: jest.fn(), trackMetric: jest.fn() }));
      freshErrorHandler = require('../../middleware/error-handler').errorHandler;
    });

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const req = makeReq();
    const res = makeRes();

    expect(() => freshErrorHandler(new Error('boom'), req, res, jest.fn())).not.toThrow();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("utilise .warn() du logger de repli pour une erreur 4xx (console.warn)", () => {
    let freshErrorHandler;
    jest.isolateModules(() => {
      jest.doMock('../../utils/logger', () => { throw new Error('logger indisponible'); });
      jest.doMock('../../services/monitoring', () => ({ trackError: jest.fn(), trackMetric: jest.fn() }));
      freshErrorHandler = require('../../middleware/error-handler').errorHandler;
    });

    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const req = makeReq();
    const res = makeRes();

    expect(() => freshErrorHandler({ status: 400, message: 'bad' }, req, res, jest.fn())).not.toThrow();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(consoleWarnSpy).toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
    // Note : la 3ᵉ méthode de repli (.info, console.log) n'est jamais invoquée par
    // errorHandler() — elle ne gère que les niveaux warn/error. Branche défensive
    // non testable via le comportement réel du module (cf. sourcing.js/ops-api.js).
  });

  it("utilise un monitor de repli no-op si require('../services/monitoring') lève au chargement du module", () => {
    let freshErrorHandler;
    jest.isolateModules(() => {
      jest.doMock('../../utils/logger', () => ({
        child: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }),
      }));
      jest.doMock('../../services/monitoring', () => { throw new Error('monitoring indisponible'); });
      freshErrorHandler = require('../../middleware/error-handler').errorHandler;
    });

    const req = makeReq();
    const res = makeRes();

    // Ne doit pas planter même si le monitor réel est indisponible (fallback no-op).
    expect(() => freshErrorHandler(new Error('boom'), req, res, jest.fn())).not.toThrow();
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
