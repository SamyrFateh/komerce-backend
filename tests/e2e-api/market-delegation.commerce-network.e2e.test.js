'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * E2E-MA-02 — Commerce local, catalogue et providers
 *
 * Feature propriétaire : market-delegation
 * Features traversées  : catalog, providers-services, market
 *
 * Prouve :
 * - l'exposition catalogue est product × market, pas globale ;
 * - provider.manage reste borné au Market ID et suspend au lieu de supprimer ;
 * - local_offer.manage n'agit que sur les services/offres du marché courant ;
 * - les payloads ne peuvent jamais injecter market_id.
 */

const request = require('supertest');
const { describeE2E } = require('../helpers/e2eDbKit');
const {
  createMarketDelegationFixture,
  makeApp,
  uuid,
  tag,
} = require('../helpers/marketDelegationE2EKit');

jest.setTimeout(30000);

describeE2E('E2E-MA-02 — market-delegation · commerce et providers', ({ db }) => {
  let fx;
  let app;
  const products = [];
  const providers = [];
  const services = [];
  const physicalOffers = [];

  beforeAll(async () => {
    fx = await createMarketDelegationFixture(db);
    app = makeApp([
      { modulePath: '../../routes/market-delegation-provider' },
      { modulePath: '../../routes/market-delegation-catalog' },
      { modulePath: '../../routes/market-delegation-local-offer' },
    ]);

    const productId = uuid();
    await db.query(
      `INSERT INTO products (id, name, price_kmf, stock)
       VALUES ($1,$2,15000,20)`,
      [productId, `E2E ${tag('catalog-product')}`]
    );
    products.push(productId);
  });

  afterAll(async () => {
    // createCleanup est LIFO : parents d'abord, enfants ensuite, afin que
    // l'exécution supprime les enfants avant leurs FK parentes.
    for (const id of products) fx.cleanup.track('products', 'id', id);
    fx.cleanup.trackSql('DELETE FROM product_market_exposure WHERE product_id = ANY($1::uuid[])', [products]);
    for (const id of providers) fx.cleanup.track('providers', 'id', id);
    for (const id of services) fx.cleanup.track('services', 'id', id);
    for (const id of physicalOffers) fx.cleanup.track('physical_offers', 'id', id);
    if (fx) await fx.cleanup.run();
  });

  it('1 — le même produit peut être exposé dans A sans devenir visible dans B', async () => {
    const productId = products[0];

    const a = await request(app)
      .put(`/api/market-delegation/markets/${fx.marketA.code}/catalog/exposure/${productId}`)
      .set('Authorization', fx.managerA.token)
      .set('x-correlation-id', 'e2e-ma-02-catalog-a')
      .send({ commercial_exposure: 'ENABLED' });
    expect(a.status).toBe(200);
    expect(a.body.exposure.market_id).toBe(fx.marketA.id);
    expect(a.body.exposure.commercial_exposure).toBe('ENABLED');

    const rowsAfterA = await db.query(
      `SELECT market_id, commercial_exposure
         FROM product_market_exposure
        WHERE product_id=$1
        ORDER BY market_id`,
      [productId]
    );
    expect(rowsAfterA.rows).toHaveLength(1);
    expect(rowsAfterA.rows[0].market_id).toBe(fx.marketA.id);

    const listB = await request(app)
      .get(`/api/market-delegation/markets/${fx.marketB.code}/catalog/exposure`)
      .set('Authorization', fx.managerB.token);
    expect(listB.status).toBe(200);
    const bRow = (listB.body.exposure || []).find((row) => row.product_id === productId);
    expect(!bRow || bRow.commercial_exposure === 'DISABLED').toBe(true);

    const b = await request(app)
      .put(`/api/market-delegation/markets/${fx.marketB.code}/catalog/exposure/${productId}`)
      .set('Authorization', fx.managerB.token)
      .send({ commercial_exposure: 'ENABLED' });
    expect(b.status).toBe(200);

    const rowsAfterB = await db.query(
      'SELECT market_id FROM product_market_exposure WHERE product_id=$1 ORDER BY market_id',
      [productId]
    );
    expect(new Set(rowsAfterB.rows.map((row) => row.market_id))).toEqual(new Set([fx.marketA.id, fx.marketB.id]));
  });

  it('2 — une tentative d’imposer le marché depuis le body est fail-closed', async () => {
    const productId = products[0];
    const before = await db.query(
      'SELECT commercial_exposure FROM product_market_exposure WHERE product_id=$1 AND market_id=$2',
      [productId, fx.marketA.id]
    );

    const res = await request(app)
      .put(`/api/market-delegation/markets/${fx.marketA.code}/catalog/exposure/${productId}`)
      .set('Authorization', fx.managerA.token)
      .send({ market_id: fx.marketB.id, commercial_exposure: 'DISABLED' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MARKET_ID_FORBIDDEN');
    const after = await db.query(
      'SELECT commercial_exposure FROM product_market_exposure WHERE product_id=$1 AND market_id=$2',
      [productId, fx.marketA.id]
    );
    expect(after.rows[0].commercial_exposure).toBe(before.rows[0].commercial_exposure);
  });

  it('3 — provider.manage crée, active et suspend un provider sans hard-delete', async () => {
    const created = await request(app)
      .post(`/api/market-delegation/markets/${fx.marketA.code}/network/providers`)
      .set('Authorization', fx.managerA.token)
      .send({ name: 'Provider A E2E', phone: '+269000010' });
    expect(created.status).toBe(201);
    const providerId = created.body.provider.id;
    providers.push(providerId);
    expect(created.body.provider.market_id).toBe(fx.marketA.id);

    const activated = await request(app)
      .post(`/api/market-delegation/markets/${fx.marketA.code}/network/providers/${providerId}/activate`)
      .set('Authorization', fx.managerA.token)
      .send({});
    expect(activated.status).toBe(200);
    expect(activated.body.provider.status).toBe('active');

    const suspended = await request(app)
      .post(`/api/market-delegation/markets/${fx.marketA.code}/network/providers/${providerId}/suspend`)
      .set('Authorization', fx.managerA.token)
      .send({});
    expect(suspended.status).toBe(200);
    expect(suspended.body.provider.status).toBe('suspended');

    const persisted = await db.query('SELECT id, market_id, status FROM providers WHERE id=$1', [providerId]);
    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0].market_id).toBe(fx.marketA.id);
    expect(persisted.rows[0].status).toBe('suspended');
  });

  it('4 — local_offer.manage expose une offre A et masque une ressource B derrière un 404', async () => {
    const providerA = providers[0];
    await db.query("UPDATE providers SET status='active' WHERE id=$1", [providerA]);

    const providerB = uuid();
    await db.query(
      `INSERT INTO providers (id,name,phone,market_id,status)
       VALUES ($1,'Provider B E2E','+269000011',$2,'active')`,
      [providerB, fx.marketB.id]
    );
    providers.push(providerB);

    const serviceA = uuid();
    const serviceB = uuid();
    const offerA = uuid();
    const offerB = uuid();
    await db.query(
      `INSERT INTO services (id,provider_id,title,market_id,status,commercial_exposure)
       VALUES ($1,$2,'Service A E2E',$3,'active','DISABLED'),
              ($4,$5,'Service B E2E',$6,'active','DISABLED')`,
      [serviceA, providerA, fx.marketA.id, serviceB, providerB, fx.marketB.id]
    );
    services.push(serviceA, serviceB);
    await db.query(
      `INSERT INTO physical_offers (id,provider_id,title,market_id,status,commercial_exposure)
       VALUES ($1,$2,'Offre A E2E',$3,'active','DISABLED'),
              ($4,$5,'Offre B E2E',$6,'active','DISABLED')`,
      [offerA, providerA, fx.marketA.id, offerB, providerB, fx.marketB.id]
    );
    physicalOffers.push(offerA, offerB);

    const serviceEnabled = await request(app)
      .put(`/api/market-delegation/markets/${fx.marketA.code}/local-offer/services/${serviceA}`)
      .set('Authorization', fx.managerA.token)
      .send({ commercial_exposure: 'ENABLED' });
    expect(serviceEnabled.status).toBe(200);
    expect(serviceEnabled.body.service.commercial_exposure).toBe('ENABLED');

    const offerEnabled = await request(app)
      .put(`/api/market-delegation/markets/${fx.marketA.code}/local-offer/physical-offers/${offerA}`)
      .set('Authorization', fx.managerA.token)
      .send({ commercial_exposure: 'ENABLED' });
    expect(offerEnabled.status).toBe(200);
    expect(offerEnabled.body.physical_offer.commercial_exposure).toBe('ENABLED');

    const hiddenService = await request(app)
      .put(`/api/market-delegation/markets/${fx.marketA.code}/local-offer/services/${serviceB}`)
      .set('Authorization', fx.managerA.token)
      .send({ commercial_exposure: 'ENABLED' });
    expect(hiddenService.status).toBe(404);

    const hiddenOffer = await request(app)
      .put(`/api/market-delegation/markets/${fx.marketA.code}/local-offer/physical-offers/${offerB}`)
      .set('Authorization', fx.managerA.token)
      .send({ commercial_exposure: 'ENABLED' });
    expect(hiddenOffer.status).toBe(404);

    const stored = await db.query(
      `SELECT id, market_id, commercial_exposure FROM services WHERE id=ANY($1::uuid[])
       UNION ALL
       SELECT id, market_id, commercial_exposure FROM physical_offers WHERE id=ANY($2::uuid[])`,
      [[serviceA, serviceB], [offerA, offerB]]
    );
    expect(stored.rows.find((row) => row.id === serviceA).commercial_exposure).toBe('ENABLED');
    expect(stored.rows.find((row) => row.id === offerA).commercial_exposure).toBe('ENABLED');
    expect(stored.rows.find((row) => row.id === serviceB).commercial_exposure).toBe('DISABLED');
    expect(stored.rows.find((row) => row.id === offerB).commercial_exposure).toBe('DISABLED');
  });
});
