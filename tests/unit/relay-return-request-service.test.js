'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const returns = require('../../services/relay-return-request-service');
const mutation = require('../../services/dispute-mutation-service');

const RELAY='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const OTHER='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const ITEM='cccccccc-cccc-4ccc-cccc-cccccccccccc';
const ORDER='dddddddd-dddd-4ddd-dddd-dddddddddddd';
const USER='eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee';
const agent = { id:USER, role:'agent_relais', relais_id:RELAY };

function makeDb({ order=true, collected=2, requested=0, active=0, badItem=false }={}) {
  const ops=[];
  const client={
    release:jest.fn(),
    query:jest.fn(async (sql,params=[]) => {
      ops.push({sql,params});
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {rows:[]};
      if (/SELECT o.id, o.reference/.test(sql)) return {rows:order ? [{id:ORDER,reference:'KOM-00458',relais_id:RELAY,status:'collected'}]:[]};
      if (/SELECT oi.id, oi.qty_collected/.test(sql))return {rows:badItem?[]:[{id:ITEM,qty_collected:collected}]};
      if (/COALESCE\(SUM\(return_quantity\)/.test(sql))return {rows:[{requested,active}]};
      if (/INSERT INTO disputes/.test(sql))return {rows:[{id:OTHER,order_id:ORDER,status:'open',return_order_item_id:ITEM,return_quantity:params[3]}]};
      throw Error('Unhandled SQL in test: '+sql);
    }),
  };
  return {db:{getClient:jest.fn(async()=>client)},client,ops};
}
const args = (db,more={}) => ({
  actor:agent,reference:'KOM-00458',orderItemId:ITEM,
  quantity:1,reason:'defective',note:'Batterie défectueuse',db,...more,
});

afterEach(() => jest.restoreAllMocks());

test('refuse tout acteur hors relais/admin et tout rattachement relais absent', async () => {
  const db=makeDb().db;
  await expect(returns.createReturnRequest(args(db,{actor:{id:USER,role:'market_operator'}})))
    .rejects.toMatchObject({code:'RETURN_ROLE_FORBIDDEN',status:403});
  await expect(returns.createReturnRequest(args(db,{actor:{id:USER,role:'agent_relais'}})))
    .rejects.toMatchObject({code:'RETURN_RELAY_MISSING',status:403});
  expect(db.getClient).not.toHaveBeenCalled();
});

test('refuse quantités hors limites, motif non prévu et autre sans explication', async () => {
  const db=makeDb().db;
  await expect(returns.createReturnRequest(args(db,{quantity:0})))
    .rejects.toMatchObject({code:'RETURN_QUANTITY_INVALID'});
  await expect(returns.createReturnRequest(args(db,{quantity:1.5})))
    .rejects.toMatchObject({code:'RETURN_QUANTITY_INVALID'});
  await expect(returns.createReturnRequest(args(db,{reason:'refund_now'})))
    .rejects.toMatchObject({code:'RETURN_REASON_INVALID'});
  await expect(returns.createReturnRequest(args(db,{reason:'other',note:''})))
    .rejects.toMatchObject({code:'RETURN_NOTE_INVALID'});
  expect(db.getClient).not.toHaveBeenCalled();
});

test('refuse un item hors commande ou non remis, transaction rollback', async () => {
  const {db,client,ops}=makeDb({collected:0});
  await expect(returns.createReturnRequest(args(db)))
    .rejects.toMatchObject({code:'RETURN_ITEM_NOT_COLLECTED',status:409});
  expect(ops.map(x=>x.sql)).toContain('ROLLBACK');
  expect(client.release).toHaveBeenCalledTimes(1);
});

test('isolation : la recherche verrouillée reste scoped au relais serveur', async () => {
  const {db,client,ops}=makeDb({order:false});
  await expect(returns.createReturnRequest(args(db)))
    .rejects.toMatchObject({code:'RETURN_ORDER_NOT_FOUND',status:404});
  const query=ops.find(x=>/SELECT o.id, o.reference/.test(x.sql));
  expect(query.params).toEqual(['KOM-00458',RELAY]);
  expect(query.sql).toMatch(/o\.relais_id = \$2::uuid/);
  expect(client.release).toHaveBeenCalled();
});

test('refuse une demande active déjà ouverte', async () => {
  const {db,ops}=makeDb({active:1});
  await expect(returns.createReturnRequest(args(db)))
    .rejects.toMatchObject({code:'RETURN_ALREADY_OPEN',status:409});
  expect(ops.some(x=>/INSERT INTO disputes/.test(x.sql))).toBe(false);
});

test('refuse une quantité cumulée supérieure aux unités déjà remises', async () => {
  const {db}=makeDb({collected:2,requested:2});
  await expect(returns.createReturnRequest(args(db)))
    .rejects.toMatchObject({code:'RETURN_EXCEEDS_COLLECTED',status:409});
});

test('création une seule fois via le writer disputes, sans argent ni stock', async () => {
  const {db,client,ops}=makeDb();
  const spy=jest.spyOn(mutation,'createProductReturnRequest');
  const result=await returns.createReturnRequest(args(db));
  expect(result.request.order_reference).toBe('KOM-00458');
  expect(spy).toHaveBeenCalledTimes(1);
  expect(ops.map(x=>x.sql)).toContain('COMMIT');
  expect(ops.some(x=>/wallet|refund|inventory|stock|parcel/i.test(x.sql))).toBe(false);
  expect(client.release).toHaveBeenCalledTimes(1);
});

test('retour partiel possible alors que commande parente non terminée', async () => {
  const {db,ops}=makeDb({collected:2});
  await returns.createReturnRequest(args(db,{quantity:2}));
  expect(ops.some(x=>/qty_collected/.test(x.sql))).toBe(true);
  expect(ops.some(x=>/o.status = 'collected'/.test(x.sql))).toBe(false);
});

test('consultation admissible : expose seulement les unités réellement retirées', async () => {
  const queries=[];
  const executor={query:jest.fn(async(sql,params)=>{
    queries.push({sql,params});
    if(/SELECT o.id, o.reference/.test(sql))return {rows:[{id:ORDER,reference:'KOM-00458',status:'available'}]};
    return {rows:[{id:ITEM,product_name:'Chargeur',qty_collected:2,qty_already_requested:1}]};
  })};
  const result=await returns.eligibleOrder({actor:agent,reference:'KOM-00458',executor});
  expect(result.items[0]).toEqual({id:ITEM,product_name:'Chargeur',qty_collected:2,remaining_returnable:1});
  expect(queries[0].params).toEqual(['KOM-00458',RELAY]);
  expect(queries[1].sql).toMatch(/oi.qty_collected > 0/);
});

test('consultation des dossiers limitée au relais de l’agent, pas de montants', async () => {
  const executor={query:jest.fn(async()=>({rows:[{id:OTHER,order_reference:'KOM-00458'}]}))};
  const result=await returns.listReturnRequests({actor:agent,executor});
  expect(result.requests).toHaveLength(1);
  expect(executor.query.mock.calls[0][1]).toEqual([RELAY,50]);
  expect(executor.query.mock.calls[0][0]).not.toMatch(/refund_kmf|refund_eur/);
});
