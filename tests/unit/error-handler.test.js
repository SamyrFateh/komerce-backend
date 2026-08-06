'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/error-handler.test.js
 *
 * Tests du middleware middleware/error-handler.js
 *
 * Couverture :
 *   ✓ classification d'erreurs (joi, 401, 403, codes pg 23xxx, 22P02, réseau, cors, unknown)
 *   ✓ status code dérivé de la classification (sauf si err.status/statusCode fourni)
 *   ✓ message utilisateur par classification
 *   ✓ monitor.trackError appelé seulement si statusCode >= 500
 *   ✓ log.error pour >=500, log.warn pour >=400, rien en dessous
 *   ✓ response.detail / stack uniquement hors production
 *   ✓ response.validation pour erreurs Joi
 *   ✓ notFoundHandler renvoie 404 structuré
 */

const mockLogError = jest.fn();
const mockLogWarn = jest.fn();
const mockLogInfo = jest.fn();
jest.mock('../../utils/logger', () => ({
  child: () => ({ error: (...a) => mockLogError(...a), warn: (...a) => mockLogWarn(...a), info: (...a) => mockLogInfo(...a) }),
}));

const mockTrackError = jest.fn();
jest.mock('../../services/monitoring', () => ({
  trackError: (...a) => mockTrackError(...a),
  trackMetric: jest.fn(),
}));

const { errorHandler, notFoundHandler } = require('../../middleware/error-handler');

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

const ORIGINAL_ENV = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_ENV;
});

describe('errorHandler — classification & status code', () => {
  it('erreur Joi → validation → 400', () => {
    const req = makeReq();
    const res = makeRes();
    const err = { isJoi: true, message: 'Champ requis', details: [{ path: ['name'], message: 'requis' }] };

    errorHandler(err, req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe('validation');
    expect(body.error).toBe('Champ requis');
    expect(body.validation).toEqual([{ field: 'name', message: 'requis' }]);
  });

  it('UnauthorizedError → auth → 401', () => {
    const req = makeReq();
    const res = makeRes();
    errorHandler({ name: 'UnauthorizedError', message: 'nope' }, req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0].code).toBe('auth');
  });

  it('status 403 explicite → forbidden → 403', () => {
    const req = makeReq();
    const res = makeRes();
    errorHandler({ status: 403, message: 'no' }, req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].code).toBe('forbidden');
  });

  it('code pg 23505 → duplicate → 409', () => {
    const req = makeReq();
    const res = makeRes();
    errorHandler({ code: '23505', message: 'dup' }, req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].code).toBe('duplicate');
  });

  it('code pg 23503 → foreign_key → 400', () => {
    const req = makeReq();
    const res = makeRes();
    errorHandler({ code: '23503' }, req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('foreign_key');
  });

  it('code pg 23502 → not_null → 400', () => {
    const req = makeReq();
    const res = makeRes();
    errorHandler({ code: '23502' }, req, res, jest.fn());
    expect(res.json.mock.calls[0][0].code).toBe('not_null');
  });

  it('autre code pg 23xxx → db_constraint → 400', () => {
    const req = makeReq();
    const res = makeRes();
    errorHandler({ code: '23999' }, req, res, jest.fn());
    expect(res.json.mock.calls[0][0].code).toBe('db_constraint');
  });

  it('code 22P02 → invalid_input → 400 (pas 500)', () => {
    const req = makeReq();
    const res = makeRes();
    errorHandler({ code: '22P02' }, req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('invalid_input');
  });

  it('ECONNREFUSED → network → 502', () => {
    const req = makeReq();
    const res = makeRes();
    errorHandler({ code: 'ECONNREFUSED' }, req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json.mock.calls[0][0].code).toBe('network');
  });

  it('message contenant CORS → cors → 403', () => {
    const req = makeReq();
    const res = makeRes();
    errorHandler({ message: 'Blocked by CORS policy' }, req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].code).toBe('cors');
  });

  it('erreur inconnue → unknown → 500', () => {
    const req = makeReq();
    const res = makeRes();
    errorHandler(new Error('boom'), req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe('unknown');
    expect(res.json.mock.calls[0][0].error).toBe('Erreur interne du serveur');
  });

  it('err.status explicite prime sur la classification dérivée', () => {
    const req = makeReq();
    const res = makeRes();
    errorHandler({ status: 418, code: '23505' }, req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(418);
  });

  it('err.statusCode explicite est aussi respecté', () => {
    const req = makeReq();
    const res = makeRes();
    errorHandler({ statusCode: 422 }, req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(422);
  });

  it("classification 'forbidden' (ForbiddenError, sans status explicite) → 403 via le switch", () => {
    const req = makeReq();
    const res = makeRes();
    errorHandler({ name: 'ForbiddenError', message: 'no' }, req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].code).toBe('forbidden');
  });
});

describe('errorHandler — monitoring & logging', () => {
  it('appelle monitor.trackError pour les erreurs >= 500', () => {
    const req = makeReq({ user: { id: 'u1' } });
    const res = makeRes();
    const err = new Error('crash');
    errorHandler(err, req, res, jest.fn());

    expect(mockTrackError).toHaveBeenCalledWith(
      err,
      expect.objectContaining({ module: 'http', method: 'GET', url: '/api/test', userId: 'u1' })
    );
    expect(mockLogError).toHaveBeenCalled();
  });

  it("n'appelle pas monitor.trackError pour les erreurs < 500", () => {
    const req = makeReq();
    const res = makeRes();
    errorHandler({ status: 400, message: 'bad' }, req, res, jest.fn());

    expect(mockTrackError).not.toHaveBeenCalled();
    expect(mockLogWarn).toHaveBeenCalled();
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it('ne plante pas si monitor.trackError lève une exception', () => {
    mockTrackError.mockImplementationOnce(() => { throw new Error('monitoring down'); });
    const req = makeReq();
    const res = makeRes();
    expect(() => errorHandler(new Error('boom'), req, res, jest.fn())).not.toThrow();
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('inclut le requestId depuis req.requestId en priorité sur le header', () => {
    const req = makeReq({ requestId: 'req-from-middleware', headers: { 'x-request-id': 'req-from-header' } });
    const res = makeRes();
    errorHandler(new Error('x'), req, res, jest.fn());
    expect(res.json.mock.calls[0][0].requestId).toBe('req-from-middleware');
  });

  it('utilise le header x-request-id si req.requestId est absent', () => {
    const req = makeReq({ headers: { 'x-request-id': 'req-from-header' } });
    const res = makeRes();
    errorHandler(new Error('x'), req, res, jest.fn());
    expect(res.json.mock.calls[0][0].requestId).toBe('req-from-header');
  });
});

describe('errorHandler — environnement', () => {
  it('inclut detail et stack hors production', () => {
    process.env.NODE_ENV = 'development';
    const req = makeReq();
    const res = makeRes();
    const err = new Error('dev error');
    errorHandler(err, req, res, jest.fn());

    const body = res.json.mock.calls[0][0];
    expect(body.detail).toBe('dev error');
    expect(Array.isArray(body.stack)).toBe(true);
  });

  it("n'inclut pas detail ni stack en production", () => {
    process.env.NODE_ENV = 'production';
    const req = makeReq();
    const res = makeRes();
    errorHandler(new Error('prod error'), req, res, jest.fn());

    const body = res.json.mock.calls[0][0];
    expect(body.detail).toBeUndefined();
    expect(body.stack).toBeUndefined();
  });
});

describe('notFoundHandler', () => {
  it('renvoie 404 avec le path et le requestId', () => {
    const req = makeReq({ originalUrl: '/api/inexistant', requestId: 'req-xyz' });
    const res = makeRes();

    notFoundHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Route introuvable',
      code: 'not_found',
      path: '/api/inexistant',
      requestId: 'req-xyz',
    });
  });

  it('requestId est null si absent', () => {
    const req = makeReq({ originalUrl: '/x' });
    const res = makeRes();
    notFoundHandler(req, res);
    expect(res.json.mock.calls[0][0].requestId).toBeNull();
  });
});
