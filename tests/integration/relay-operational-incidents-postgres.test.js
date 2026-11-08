'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration relay-operational-incidents-postgres.test.js
 * @brief Incidents canoniques -> relais : isolation, incidences avant expedition, references contradictoires.
 *
 * Fixture transactionnelle : ROLLBACK total, aucun incident ou compte de test persiste.
 */
if (!process.env.DATABASE_URL) {
  describe.skip('relay operational incidents (requires PostgreSQL)', () => { test('DATABASE_URL absent', () => {}); });
} else {
  const crypto = require('crypto');
  const db = require('../../db');
  const relay = require('../../services/relay-dashboard-queries');
  const { resolveGovernanceOrThrow, computeDueAt } = require('../../services/incident-governance');
  const id = () => crypto.randomUUID();
  const tag = `ROI-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const originalQuery = db.query;
  let client; let marketId; let relayA; let relayB;
  let orderA; let orderB; let itemA; let itemB;
  let incidentA; let incidentB; let inconsistentId; let orderOnlyId; let itemOnlyId;

  jest.setTimeout(60000);

  beforeAll(async () => {
    client = await db.getClient();
    await client.query('BEGIN');
    // Service et fixture voient la meme transaction; ROLLBACK nettoie sans contourner les triggers.
    db.query = client.query.bind(client);
    const market = (await db.query("SELECT id FROM markets WHERE code='KM'")).rows[0];
    if (!market) throw new Error('KM_MARKET_REQUIRED');
    marketId = market.id;
    relayA = id(); relayB = id();
    await db.query(`INSERT INTO relais (id, name, agent_name, phone, address, market_id)
                    VALUES ($1,$2,'Agent A','+2696011111','A',$3),($4,$5,'Agent B','+2696022222','B',$3)`,
      [relayA, `${tag}-A`, marketId, relayB, `${tag}-B`]);

    orderA = id(); orderB = id();
    const productA = id(); const productB = id();
    await db.query('INSERT INTO products (id,name,price_kmf,stock) VALUES ($1,$2,1000,10),($3,$4,1000,10)',
      [productA, `${tag}-A`, productB, `${tag}-B`]);
    await db.query(`INSERT INTO orders (id,reference,relais_id,market_id,status,total_kmf,payment_status,payment_mode)
                    VALUES ($1,$2,$3,$4,'confirmed',1000,'paid','stripe_eur'),
                           ($5,$6,$7,$4,'confirmed',1000,'paid','stripe_eur')`,
      [orderA, `${tag}-ORDER-A`, relayA, marketId, orderB, `${tag}-ORDER-B`, relayB]);
    itemA = id(); itemB = id();
    await db.query(`INSERT INTO order_items (id,order_id,product_id,quantity,price_kmf,fulfillment_source)
                    VALUES ($1,$2,$3,1,1000,'IMPORT'),($4,$5,$6,1,1000,'LOCAL_STOCK')`,
      [itemA, orderA, productA, itemB, orderB, productB]);

    incidentA = id(); incidentB = id(); inconsistentId = id(); orderOnlyId = id(); itemOnlyId = id();
    const incidents = [
      [incidentA, orderA, itemA, 'missing_item', 'partial_delivery'],
      [incidentB, orderB, itemB, 'delay', 'delayed'],
      [inconsistentId, orderA, itemB, 'missing_item', 'wrong_item'],
      [orderOnlyId, orderA, null, 'delay', 'delayed'],
      [itemOnlyId, null, itemA, 'missing_item', 'partial_delivery'],
    ];
    for (const [incidentId, orderId, itemId, type, impact] of incidents) {
      const governance = resolveGovernanceOrThrow({ incident_type: type });
      await db.query(`INSERT INTO incidents (
                        id,order_id,order_item_id,incident_type,title,severity,client_impact,
                        origin_domain,resolver_domain,resolution_class,due_at
                      ) VALUES ($1,$2,$3,$4,$5,'high',$6,$7,$8,$9,$10)`,
        [incidentId, orderId, itemId, type, `${tag}-${type}`, impact,
          governance.origin_domain, governance.resolver_domain, governance.resolution_class,
          computeDueAt(governance.resolution_class)]);
    }
  });

  afterAll(async () => {
    try {
      if (client) await client.query('ROLLBACK');
    } finally {
      db.query = originalQuery;
      if (client) client.release();
      await db.pool.end();
    }
  });

  test('avant expedition : le relais A voit seulement ses anomalies (import et rattachements simples)', async () => {
    const a = await relay.getRelayOperationalIncidents({ role: 'agent_relais', relais_id: relayA });
    const mine = a.incidents.filter(x => x.order_reference.startsWith(tag));
    expect(mine.map(x => x.id).sort()).toEqual([incidentA, orderOnlyId, itemOnlyId].sort());
    expect(mine.every(x => x.order_id === orderA)).toBe(true);
  });

  test('un autre relais ne voit jamais les incidents du premier, ni les contradictions inter-commandes', async () => {
    const b = await relay.getRelayOperationalIncidents({ role: 'agent_relais', relais_id: relayB });
    const mine = b.incidents.filter(x => x.order_reference.startsWith(tag));
    expect(mine.map(x => x.id)).toEqual([incidentB]);
    expect(mine).not.toContainEqual(expect.objectContaining({ id: inconsistentId }));
  });

  test('le marche sans delegation ne voit aucun incident ; le marche autorise voit les deux relais', async () => {
    const operator = { role: 'market_operator' };
    const none = await relay.getRelayOperationalIncidents(operator);
    expect(none.incidents).toEqual([]);
    const km = await relay.getRelayOperationalIncidents(operator, { authorizedMarkets: new Set([marketId]) });
    const matched = km.incidents.filter(x => x.order_reference.startsWith(tag)).map(x => x.id);
    expect(matched).toEqual(expect.arrayContaining([incidentA, incidentB, orderOnlyId, itemOnlyId]));
    expect(matched).not.toContain(inconsistentId);
  });

  test('les compteurs par commande ecartent les references contradictoires', async () => {
    const a = await relay.getOrders({ role: 'agent_relais', relais_id: relayA }, { status: 'confirmed' });
    const own = a.orders.find(x => x.id === orderA);
    expect(own).toBeDefined();
    expect(Number(own.incidents_ouverts)).toBe(3);
    const b = await relay.getOrders({ role: 'agent_relais', relais_id: relayB }, { status: 'confirmed' });
    expect(Number(b.orders.find(x => x.id === orderB).incidents_ouverts)).toBe(1);
  });

  test('un incident resolu disparait de la file active, sans effet sur les autres', async () => {
    await db.query("UPDATE incidents SET status='resolved' WHERE id=$1", [incidentA]);
    const a = await relay.getRelayOperationalIncidents({ role: 'agent_relais', relais_id: relayA });
    const ids = a.incidents.filter(x => x.order_reference.startsWith(tag)).map(x => x.id);
    expect(ids).not.toContain(incidentA);
    expect(ids).toEqual(expect.arrayContaining([orderOnlyId, itemOnlyId]));
  });
  test('signalements locaux : visibles en file SAV avec cloisonnement relais/marché et résolution',async()=>{
    const localA=id(),localB=id();
    await db.query("INSERT INTO order_incidents (id,order_id,type,description,priority,status) VALUES ($1,$2,'colis_endommage',$3,'high','open'),($4,$5,'autre',$6,'normal','open')",
      [localA,orderA,tag+'-endommage',localB,orderB,tag+'-autre']);
    const a=await relay.getRelayOperationalIncidents({role:'agent_relais',relais_id:relayA});
    expect(a.incidents.find(x=>x.id===localA)).toMatchObject({
      order_id:orderA,source:'relay_report',incident_type:'colis_endommage',severity:'high'
    });
    expect(a.incidents.map(x=>x.id)).not.toContain(localB);
    const b=await relay.getRelayOperationalIncidents({role:'agent_relais',relais_id:relayB});
    expect(b.incidents.map(x=>x.id)).toContain(localB);
    expect(b.incidents.map(x=>x.id)).not.toContain(localA);
    const operator={role:'market_operator'};
    const none=await relay.getRelayOperationalIncidents(operator);
    expect(none.incidents.map(x=>x.id)).not.toContain(localA);
    const km=await relay.getRelayOperationalIncidents(operator,{authorizedMarkets:new Set([marketId])});
    expect(km.incidents.map(x=>x.id)).toEqual(expect.arrayContaining([localA,localB]));
    await db.query("UPDATE order_incidents SET status='resolved' WHERE id=$1",[localA]);
    const later=await relay.getRelayOperationalIncidents({role:'agent_relais',relais_id:relayA});
    expect(later.incidents.map(x=>x.id)).not.toContain(localA);
  });

}
