'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../services/market-delegation-team-service',()=>({resolveAuthorization:jest.fn()}));
const {resolveAuthorization}=require('../../services/market-delegation-team-service');
const {listMarketCustomsShipments}=require('../../services/market-delegation-customs-service');
beforeEach(()=>jest.clearAllMocks());
test('A1 admin sans membership : lecture bornée au marché serveur, sans ACT',async()=>{
 const db={query:jest.fn().mockResolvedValueOnce({rows:[{market_id:'m-cm',market_code:'CM',assignment_id:'a-cm'}]}).mockResolvedValueOnce({rows:[]})};
 const result=await listMarketCustomsShipments(db,{marketCode:'CM',actorUserId:'admin1',actorRole:'admin'});
 expect(result.market_code).toBe('CM');
 expect(resolveAuthorization).not.toHaveBeenCalled();
 expect(db.query).toHaveBeenCalledTimes(2);
 expect(db.query.mock.calls[0][1]).toEqual(['CM']);
 expect(db.query.mock.calls[1][1][0]).toBe('m-cm');
 expect(db.query.mock.calls[1][0]).toMatch(/s\.market_id = \$1/);
 expect(db.query.mock.calls[1][0]).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
});
test('opérateur étranger: refus avant lecture de données',async()=>{
 const db={query:jest.fn()};
 resolveAuthorization.mockRejectedValueOnce(Object.assign(new Error('refus'),{code:'MARKET_MEMBERSHIP_REQUIRED',status:403}));
 await expect(listMarketCustomsShipments(db,{marketCode:'CG',actorUserId:'operator',actorRole:'market_operator'})).rejects.toMatchObject({status:403});
 expect(resolveAuthorization).toHaveBeenCalledWith(db,{userId:'operator',marketCode:'CG',requiredCapability:'operations.read'});
 expect(db.query).not.toHaveBeenCalled();
});
