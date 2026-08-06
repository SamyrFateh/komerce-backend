'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/request-id.test.js
 *
 * Tests du middleware middleware/request-id.js
 *
 * Couverture :
 *   ✓ génère un requestId si aucun header x-request-id n'est fourni
 *   ✓ réutilise le header x-request-id du client s'il est présent
 *   ✓ attache req.requestId
 *   ✓ renvoie le header x-request-id dans la réponse
 *   ✓ appelle next()
 *   ✓ generateRequestId() produit un format stable et des valeurs uniques
 */

const { requestIdMiddleware, generateRequestId } = require('../../middleware/request-id');

function makeReqRes(headers = {}) {
  const req = { headers };
  const res = { setHeader: jest.fn() };
  const next = jest.fn();
  return { req, res, next };
}

describe('generateRequestId', () => {
  it('produit un id au format req_<timestamp36>_<8hex>', () => {
    const id = generateRequestId();
    expect(id).toMatch(/^req_[0-9a-z]+_[0-9a-f]{8}$/);
  });

  it('produit des ids différents à chaque appel', () => {
    const id1 = generateRequestId();
    const id2 = generateRequestId();
    expect(id1).not.toBe(id2);
  });
});

describe('requestIdMiddleware', () => {
  it("génère un requestId quand le header x-request-id est absent", () => {
    const { req, res, next } = makeReqRes({});
    requestIdMiddleware(req, res, next);

    expect(req.requestId).toMatch(/^req_/);
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', req.requestId);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("réutilise le header x-request-id fourni par le client", () => {
    const { req, res, next } = makeReqRes({ 'x-request-id': 'client-supplied-id' });
    requestIdMiddleware(req, res, next);

    expect(req.requestId).toBe('client-supplied-id');
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'client-supplied-id');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('appelle next() sans argument (pas de propagation d\'erreur)', () => {
    const { req, res, next } = makeReqRes({});
    requestIdMiddleware(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });
});
