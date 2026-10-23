'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 *
 * L3 : Finance partage la définition de période de Commerce (jours civils du marché, UTC en global) et
 * ses buckets de tendance suivent le fuseau du marché. PostgreSQL réel.
 */
const { describeE2E, createCleanup, tag, uuid } = require('../helpers/e2eDbKit');

jest.setTimeout(30000);

describeE2E('Finance — journée commerciale du marché (L3)', ({ db }) => {
  const finance = require('../../services/dashboard-finance-canonical');
  const commerce = require('../../services/dashboard-commerce');
  const marketId = uuid(); const relaisId = uuid(); const userId = uuid();
  const now = new Date('2026-10-20T12:00:00Z');
  let cleanup;
  const rnd = () => `Q${Array.from({ length: 4 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('')}`;
  const mk = code => ({ id: marketId, code, name: 'E2E fin', currency: 'KMF', minor_unit: 0 });

  async function order(createdAt, total) {
    const id = uuid();
    await db.query(
      `INSERT INTO orders (id,user_id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur,created_at)
       VALUES ($1,$2,$3,$4,$5,'in_transit','paid','cash_relais',$6,2,$7)`,
      [id, userId, relaisId, marketId, `FB-${id.slice(0, 8)}`.toUpperCase(), total, createdAt]);
  }

  beforeAll(async () => {
    cleanup = createCleanup(db);
    cleanup.trackSql(`SET session_replication_role = replica;
      DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE market_id='${marketId}');
      DELETE FROM orders WHERE market_id='${marketId}';
      DELETE FROM relais WHERE id='${relaisId}';
      DELETE FROM markets WHERE id='${marketId}';
      DELETE FROM users WHERE id='${userId}';
      SET session_replication_role = origin;`);
    await db.query(`INSERT INTO markets (id,code,name,currency,minor_unit,is_active,lifecycle_status) VALUES ($1,$2,'E2E fin','KMF',0,true,'ACTIVE')`, [marketId, rnd()]);
    await db.query(`INSERT INTO relais (id,name,agent_name,phone,address,island,market_id) VALUES ($1,$2,'E2E','+269000559','E2E','Ngazidja',$3)`, [relaisId, `E2E Relais ${tag('r')}`, marketId]);
    await db.query(`INSERT INTO users (id,full_name,email,phone,role) VALUES ($1,'E2E',$2,$3,'client')`, [userId, `${tag('fb')}@komerce.test`, `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`]);
    await order('2026-10-17T22:30:00Z', 1000); // 18/10 à Moroni, 17/10 à Douala
    await order('2026-10-13T20:59:59Z', 500);  // hors fenêtre 7 j (KM et CM)
    await order('2026-10-13T21:00:00Z', 700);  // pile minuit KM : dans KM, hors CM
  });
  afterAll(async () => { if (cleanup) await cleanup.run(); });

  it.each(['KM', 'CM'])('%s : la période Finance = la période Commerce (mêmes bornes, même fuseau)', async code => {
    const f = await finance.buildFinance({ period: '7' }, { market: mk(code), now });
    const c = await commerce.buildCommerce({ period: '7' }, { market: mk(code), now });
    expect(f.business_timezone).toBe(c.business_timezone);
    expect(f.period_definition).toEqual(c.period_definition);
  });

  it('Global : UTC explicite, jours civils UTC', async () => {
    const f = await finance.buildFinance({ period: '7' }, { market: null, now });
    expect(f.business_timezone).toBe('UTC');
    expect(f.period_definition.from).toBe('2026-10-14T00:00:00.000Z');
  });

  it('KM vs CM : la commande de 21h00Z le 13/10 est dans la période KM seulement', async () => {
    const km = await finance.buildFinance({ period: '7' }, { market: mk('KM'), now });
    const cm = await finance.buildFinance({ period: '7' }, { market: mk('CM'), now });
    const caKm = km.kpis.find(k => k.id === 'ca_encaisse' || k.key === 'ca_encaisse');
    const caCm = cm.kpis.find(k => k.id === 'ca_encaisse' || k.key === 'ca_encaisse');
    expect(Number(caKm.value)).toBe(1700);
    expect(Number(caCm.value)).toBe(1000);
  });

  it('tendance : le bucket jour suit le fuseau du marché (18/10 Moroni, 17/10 Douala)', async () => {
    const km = await finance.getFinanceTrend({ market_id: marketId, from: '2026-10-13T21:00:00.000Z', to: now.toISOString() }, 7, 'Indian/Comoro');
    const cm = await finance.getFinanceTrend({ market_id: marketId, from: '2026-10-13T23:00:00.000Z', to: now.toISOString() }, 7, 'Africa/Douala');
    expect(km.map(r => new Date(r.bucket).toISOString())).toEqual(['2026-10-13T21:00:00.000Z', '2026-10-17T21:00:00.000Z']);
    expect(cm.map(r => new Date(r.bucket).toISOString())).toEqual(['2026-10-16T23:00:00.000Z']);
  });
});
