'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const deny = require('../../middleware/deny-transitaire-hub');
const fs = require('fs');
const path = require('path');

function invoke(user) {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  const next = jest.fn();
  deny({ user }, res, next);
  return { res, next };
}
describe('frontière Hub vs Transitaire central', () => {
  test('refuse agent_transitaire persistant', () => {
    const { res, next } = invoke({ role: 'agent_transitaire' });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code:'HUB_TRANSITAIRE_SCOPE_DENIED' }));
    expect(next).not.toHaveBeenCalled();
  });
  test('refuse même si une membership héritée le projette market_operator', () => {
    const { res, next } = invoke({ role: 'market_operator', persisted_role: 'agent_transitaire', role_source: 'market_delegation_projection' });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
  test('ne change pas les rôles autorisés', () => {
    for (const role of ['admin', 'agent_hub', 'market_operator']) {
      const { res, next } = invoke({ role });
      expect(res.status).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    }
  });
  test('protège toutes les lectures et supervisions Hub avant projection de rôle', () => {
    const file = fs.readFileSync(path.join(__dirname, '../../routes/hub-dashboard.js'),'utf8');
    expect(file).toMatch(/const hubRead = \[\s*authenticate,\s*denyTransitaireHub,\s*attachMarketDelegatedRoleFor/);
    expect(file).toMatch(/const hubSupervise = \[\s*authenticate,\s*denyTransitaireHub,\s*attachMarketDelegatedRoleFor/);
    expect(file).not.toMatch(/const hubAuth = \[authenticate, denyTransitaireHub/);
    const terrain = fs.readFileSync(path.join(__dirname, '../../routes/hub.js'),'utf8');
    expect(terrain).toMatch(/const hubRead = \[\s*authenticate,\s*denyTransitaireHub,\s*attachMarketDelegatedRoleFor/);
    expect(terrain).toMatch(/const hubBoardRead = \[\s*authenticate,\s*denyTransitaireHub,\s*attachMarketDelegatedRoleFor/);
  });
  test('le refus est indépendant du marché ou de permissions de membre', () => {
    const a = invoke({ role: 'agent_transitaire', market_id:'CM' });
    const b = invoke({ role: 'agent_transitaire', market_id:'CG' });
    expect(a.res.json).toHaveBeenCalledWith(expect.objectContaining({code:'HUB_TRANSITAIRE_SCOPE_DENIED'}));
    expect(b.res.json).toHaveBeenCalledWith(expect.objectContaining({code:'HUB_TRANSITAIRE_SCOPE_DENIED'}));
  });
});
