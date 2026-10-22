'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 *
 * Commerce : la journée commerciale est celle du marché (jamais du navigateur/serveur) ; série, bornes de
 * période et KPI se réconcilient sur le même périmètre, sur PostgreSQL réel.
 */
const { describeE2E, createCleanup, tag, uuid } = require('../helpers/e2eDbKit');

jest.setTimeout(30000);

describeE2E('Commerce — journée commerciale du marché', ({ db }) => {
  const commerce = require('../../services/dashboard-commerce');
  const { projectCommerceMarketPayload } = require('../../services/dashboard-metrics/market-currency');
  const relaisId = uuid(); const otherRelaisId = uuid(); const userId = uuid(); const marketId = uuid(); const otherMarketId = uuid();
  const now = new Date('2026-10-20T12:00:00Z');
  let cleanup;
  const rndCode = () => `Q${Array.from({ length: 4 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('')}`;

  async function order(createdAt, { paid = true, status = 'in_transit', total = 1000, wallet = 0, market = marketId } = {}) {
    const id = uuid();
    await db.query(
      `INSERT INTO orders (id,user_id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur,wallet_applied_kmf,created_at)
       VALUES ($1,$2,$10,$3,$4,$5,$6,'cash_relais',$7,2,$8,$9)`,
      [id, userId, market, `BD-${id.slice(0, 8)}`.toUpperCase(), status, paid ? 'paid' : 'pending', total, wallet, createdAt, market === marketId ? relaisId : otherRelaisId]);
  }
  const view = (code, period = '7', id = marketId) => commerce.buildCommerce({ period }, { market: { id, code, name: 'E2E bd', currency: 'KMF', minor_unit: 0 }, now });

  beforeAll(async () => {
    cleanup = createCleanup(db);
    cleanup.trackSql(`SET session_replication_role = replica;
      DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE market_id IN ('${marketId}','${otherMarketId}'));
      DELETE FROM orders WHERE market_id IN ('${marketId}','${otherMarketId}');
      DELETE FROM relais WHERE id IN ('${relaisId}','${otherRelaisId}');
      DELETE FROM markets WHERE id IN ('${marketId}','${otherMarketId}');
      DELETE FROM users WHERE id='${userId}';
      SET session_replication_role = origin;`);
    for (const [id, c] of [[marketId, rndCode()], [otherMarketId, rndCode()]]) {
      await db.query(`INSERT INTO markets (id,code,name,currency,minor_unit,is_active,lifecycle_status) VALUES ($1,$2,'E2E bd','KMF',0,true,'ACTIVE')`, [id, c]);
    }
    for (const [rid, mid] of [[relaisId, marketId], [otherRelaisId, otherMarketId]]) {
      await db.query(`INSERT INTO relais (id,name,agent_name,phone,address,island,market_id) VALUES ($1,$2,'E2E','+269000557','E2E','Ngazidja',$3)`, [rid, `E2E Relais ${tag('r')}`, mid]);
    }
    await db.query(`INSERT INTO users (id,full_name,email,phone,role) VALUES ($1,'E2E',$2,$3,'client')`,
      [userId, `${tag('bd')}@komerce.test`, `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`]);

    await order('2026-10-17T22:30:00Z', { total: 1000, wallet: 100 }); // 18/10 KM, 17/10 CM
    await order('2026-10-17T22:45:00Z', { total: 2000 });              // même jour : groupées
    await order('2026-10-13T20:59:59Z', { total: 500 });               // 1 s avant le 1er jour KM (7 j) et CM
    await order('2026-10-13T21:00:00Z', { total: 700 });               // pile minuit KM = dans KM, hors CM
    await order('2026-10-18T10:00:00Z', { paid: false, total: 9999 }); // non payée : exclue
    await order('2026-10-18T11:00:00Z', { status: 'cancelled', total: 8888 }); // annulée : exclue
    await order('2026-10-18T10:00:00Z', { total: 7777, market: otherMarketId }); // autre marché : jamais visible
  });
  afterAll(async () => { if (cleanup) await cleanup.run(); });

  it('Comores : 17/10 22h30 UTC = 18/10 ; bornes 7 jours civils exactes ; groupées sans doublon', async () => {
    const r = await view('KM');
    expect(r.business_timezone).toBe('Indian/Comoro');
    expect(r.period_definition).toMatchObject({ kind: 'civil_days_including_today', days: 7, from: '2026-10-13T21:00:00.000Z' });
    expect(r.sales_series).toEqual([
      { day: '2026-10-14', sales_kmf: 700, orders: 1 },
      { day: '2026-10-18', sales_kmf: 3100, orders: 2 },
    ]);
    expect(r.recent_orders.map(o => o.business_day)).toEqual(expect.arrayContaining(['2026-10-18', '2026-10-14']));
  });

  it('Cameroun, mêmes commandes : 17/10 ; la commande de 21h00Z le 13/10 est hors période', async () => {
    const r = await view('CM');
    expect(r.business_timezone).toBe('Africa/Douala');
    expect(r.sales_series).toEqual([{ day: '2026-10-17', sales_kmf: 3100, orders: 2 }]);
  });

  it('réconciliation : somme de la série = KPI Ventes payées, commandes de la série = effectif du KPI', async () => {
    for (const code of ['KM', 'CM']) {
      const r = await view(code);
      const ca = r.kpis.find(k => k.key === 'ca_encaisse');
      expect(r.sales_series.reduce((s, d) => s + d.sales_kmf, 0)).toBe(ca.value);
      expect(r.sales_series.reduce((s, d) => s + d.orders, 0)).toBe(ca.data_quality.items_total);
    }
  });

  it('aucune vente payée : série vide explicite, rien d\'inventé', async () => {
    const r = await view('KM', '7', uuid());
    expect(r.sales_series).toEqual([]);
  });

  it('autre marché : aucune fuite entre périmètres', async () => {
    const r = await view('KM', '7', otherMarketId);
    expect(r.sales_series).toEqual([{ day: '2026-10-18', sales_kmf: 7777, orders: 1 }]);
  });

  it('vue globale : journées UTC explicites (17/10 22h30Z reste le 17/10)', async () => {
    const { filters } = commerce.buildPeriodFilters({ period: '7' }, marketId, now);
    expect(filters.from).toBe('2026-10-14T00:00:00.000Z');
    const global = await commerce.buildCommerce({ period: '7' }, { now });
    expect(global.business_timezone).toBe('UTC');
    expect(global.period_definition.timezone_source).toBe('global_utc');
  });

  it('la projection de marché conserve fuseau et définition de période', async () => {
    const market = { id: marketId, code: 'KM', name: 'E2E bd', currency: 'KMF', minor_unit: 0 };
    const p = await projectCommerceMarketPayload(await commerce.buildCommerce({ period: '7' }, { market, now }), market);
    expect(p.business_timezone).toBe('Indian/Comoro');
    expect(p.period_definition.timezone).toBe('Indian/Comoro');
  });
});
