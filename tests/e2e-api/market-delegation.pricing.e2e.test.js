'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * E2E-MA-06 — Atelier Pricing et décision locale
 *
 * Feature propriétaire : market-delegation
 * Features traversées  : economic-engine, market-autonomy, catalog, market
 *
 * Prouve sur routes réelles + PostgreSQL réel :
 * - manager et viewer ouvrent l'Atelier de leur Market ID ;
 * - la simulation viewer est réellement sans écriture ;
 * - le manager surcharge puis reset un coût local sans toucher au modèle global ;
 * - la politique de décision et l'observation marché sont market-scopées ;
 * - la décision locale conserve products.price_kmf et la devise vient du marché ;
 * - l'activation passe uniquement par le gate économique ;
 * - le viewer et le navigateur ne peuvent créer aucune autorité implicite.
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

describeE2E('E2E-MA-06 — market-delegation · pricing pays', ({ db }) => {
  let fx;
  let app;
  let product;
  let component;

  beforeAll(async () => {
    fx = await createMarketDelegationFixture(db);
    app = makeApp([
      { mount: '/api/admin/workspaces/pricing', modulePath: '../../routes/admin-pricing-workspace' },
    ]);

    const productId = uuid();
    const productRef = `KPR-E2E-${tag('pricing').replace(/[^A-Za-z0-9]/g, '').slice(-12).toUpperCase()}`;
    await db.query(
      `INSERT INTO products (id, product_ref, name, category, price_kmf, cost_kmf, stock, is_active)
       VALUES ($1,$2,$3,'E2E',100000,25000,20,TRUE)`,
      [productId, productRef, `E2E ${tag('pricing-product')}`]
    );
    product = { id: productId, ref: productRef, global_price_kmf: 100000 };

    const { rows } = await db.query(
      `SELECT id, key, default_value
         FROM cost_components
        WHERE is_active = TRUE
        ORDER BY display_order NULLS LAST, key
        LIMIT 1`
    );
    if (!rows[0]) throw new Error('E2E pricing requires at least one active cost component');
    component = rows[0];
  });

  afterAll(async () => {
    if (!fx) return;
    if (product) {
      fx.cleanup.track('products', 'id', product.id);
      fx.cleanup.trackSql('DELETE FROM market_price_observation_events WHERE product_id=$1', [product.id]);
      fx.cleanup.trackSql('DELETE FROM market_price_observations WHERE product_id=$1', [product.id]);
      fx.cleanup.trackSql('DELETE FROM product_market_price_draft_events WHERE product_id=$1', [product.id]);
      fx.cleanup.trackSql('DELETE FROM product_market_price_drafts WHERE product_id=$1', [product.id]);
    }
    if (component) {
      fx.cleanup.trackSql(
        'DELETE FROM cost_component_market_override_events WHERE market_id IN ($1,$2) AND component_id=$3',
        [fx.marketA.id, fx.marketB.id, component.id]
      );
      fx.cleanup.trackSql(
        'DELETE FROM cost_component_market_overrides WHERE market_id IN ($1,$2) AND component_id=$3',
        [fx.marketA.id, fx.marketB.id, component.id]
      );
    }
    fx.cleanup.trackSql(
      'DELETE FROM pricing_market_decision_policy_events WHERE market_id IN ($1,$2)',
      [fx.marketA.id, fx.marketB.id]
    );
    await fx.cleanup.run();
  });

  it('1 — manager et viewer ouvrent réellement l’Atelier de A', async () => {
    const manager = await request(app)
      .get(`/api/admin/workspaces/pricing/market/${fx.marketA.code}`)
      .set('Authorization', fx.managerA.token);
    expect(manager.status).toBe(200);
    expect(manager.body.access.role).toBe('manager');
    expect(manager.body.access.read_only).toBe(false);

    const viewer = await request(app)
      .get(`/api/admin/workspaces/pricing/market/${fx.marketA.code}`)
      .set('Authorization', fx.viewerA.token);
    expect(viewer.status).toBe(200);
    expect(viewer.body.access.role).toBe('viewer');
    expect(viewer.body.access.read_only).toBe(true);
  });

  it('2 — le viewer simule sans modifier la vérité catalogue', async () => {
    const before = await db.query('SELECT price_kmf FROM products WHERE id=$1', [product.id]);

    const res = await request(app)
      .post(`/api/admin/workspaces/pricing/market/${fx.marketA.code}/simulate-impact`)
      .set('Authorization', fx.viewerA.token)
      .send({ product_ref: product.ref, overrides: [] });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe('simulate_impact');
    const after = await db.query('SELECT price_kmf FROM products WHERE id=$1', [product.id]);
    expect(Number(after.rows[0].price_kmf)).toBe(Number(before.rows[0].price_kmf));
  });

  it('3 — viewer ne peut muter ni coûts, ni politique, ni prix local', async () => {
    const cost = await request(app)
      .post(`/api/admin/workspaces/pricing/market/${fx.marketA.code}/cost-components/${component.key}/update`)
      .set('Authorization', fx.viewerA.token)
      .send({ default_value: Number(component.default_value) + 1 });
    expect(cost.status).toBe(403);

    const policy = await request(app)
      .post(`/api/admin/workspaces/pricing/market/${fx.marketA.code}/decision-policy`)
      .set('Authorization', fx.viewerA.token)
      .send({ version: 'VIEWER-FORBIDDEN' });
    expect(policy.status).toBe(403);

    const price = await request(app)
      .post(`/api/admin/workspaces/pricing/market/${fx.marketA.code}/products/${product.ref}/local-price`)
      .set('Authorization', fx.viewerA.token)
      .send({ amount: 1000, reason: 'viewer interdit' });
    expect(price.status).toBe(403);
  });

  it('4 — manager surcharge puis reset un coût uniquement dans A', async () => {
    const baseValue = Number(component.default_value);
    const localValue = baseValue + 37;

    const updated = await request(app)
      .post(`/api/admin/workspaces/pricing/market/${fx.marketA.code}/cost-components/${component.key}/update`)
      .set('Authorization', fx.managerA.token)
      .send({ default_value: localValue, notes: 'E2E marché A' });
    expect(updated.status).toBe(200);
    expect(Number(updated.body.result.default_value)).toBe(localValue);

    const stored = await db.query(
      `SELECT o.market_id, o.default_value, c.default_value AS global_value
         FROM cost_component_market_overrides o
         JOIN cost_components c ON c.id=o.component_id
        WHERE o.component_id=$1`,
      [component.id]
    );
    expect(stored.rows.some((row) => row.market_id === fx.marketA.id && Number(row.default_value) === localValue)).toBe(true);
    expect(stored.rows.some((row) => row.market_id === fx.marketB.id)).toBe(false);
    expect(Number(stored.rows.find((row) => row.market_id === fx.marketA.id).global_value)).toBe(baseValue);

    const reset = await request(app)
      .post(`/api/admin/workspaces/pricing/market/${fx.marketA.code}/cost-components/${component.key}/reset`)
      .set('Authorization', fx.managerA.token)
      .send({});
    expect(reset.status).toBe(200);
    expect(reset.body.result.inherited).toBe(true);

    const remaining = await db.query(
      'SELECT 1 FROM cost_component_market_overrides WHERE market_id=$1 AND component_id=$2',
      [fx.marketA.id, component.id]
    );
    expect(remaining.rows).toHaveLength(0);
  });

  it('5 — politique et observation marché s’écrivent dans A, jamais dans B', async () => {
    const version = `E2E-${Date.now()}`;
    const policy = await request(app)
      .post(`/api/admin/workspaces/pricing/market/${fx.marketA.code}/decision-policy`)
      .set('Authorization', fx.managerA.token)
      .send({
        version,
        window_days: 30,
        maturity_threshold: 0.9,
        coverage_threshold: 1,
        max_disposition_ratio: 0.05,
        source: 'e2e-market-autonomy',
        evidence_ref: `e2e://${version}`,
        rationale: 'Politique E2E du responsable pays pour vérifier le périmètre serveur.',
      });
    expect(policy.status).toBe(201);

    const observation = await request(app)
      .post(`/api/admin/workspaces/pricing/market/${fx.marketA.code}/price-observations`)
      .set('Authorization', fx.managerA.token)
      .send({
        product_ref: product.ref,
        competitor_name: 'E2E Concurrent local',
        amount: 500000,
        source: 'e2e-terrain',
        notes: 'Observation locale E2E',
      });
    expect(observation.status).toBe(201);

    const persistedPolicy = await db.query(
      'SELECT market_id FROM pricing_market_decision_policy_events WHERE version=$1',
      [version]
    );
    expect(persistedPolicy.rows).toHaveLength(1);
    expect(persistedPolicy.rows[0].market_id).toBe(fx.marketA.id);

    const persistedObservation = await db.query(
      'SELECT market_id FROM market_price_observations WHERE observation_ref=$1',
      [observation.body.result.observation_ref]
    );
    expect(persistedObservation.rows).toHaveLength(1);
    expect(persistedObservation.rows[0].market_id).toBe(fx.marketA.id);
  });

  it('6 — décision locale + activation ne touchent jamais products.price_kmf', async () => {
    const before = await db.query('SELECT price_kmf FROM products WHERE id=$1', [product.id]);

    const draft = await request(app)
      .post(`/api/admin/workspaces/pricing/market/${fx.marketA.code}/products/${product.ref}/local-price`)
      .set('Authorization', fx.managerA.token)
      .send({ amount: 1000000, reason: 'Décision prix locale E2E', source: 'e2e-market-manager' });
    expect(draft.status).toBe(200);
    expect(draft.body.result.decision_status).toBe('DRAFT_PENDING_GATE');
    expect(draft.body.result.currency).toBe(fx.marketA.currency);

    const preview = await request(app)
      .get(`/api/admin/workspaces/pricing/market/${fx.marketA.code}/products/${product.ref}/local-price/activation-preview`)
      .set('Authorization', fx.managerA.token);
    expect(preview.status).toBe(200);
    expect(preview.body.activation.allowed).toBe(true);

    const activated = await request(app)
      .post(`/api/admin/workspaces/pricing/market/${fx.marketA.code}/products/${product.ref}/local-price/activate`)
      .set('Authorization', fx.managerA.token)
      .send({ reason: 'Activation E2E après gate', source: 'e2e-market-manager' });
    expect(activated.status).toBe(200);
    expect(activated.body.result.decision.decision_status).toBe('LOCAL_ACTIVE');
    expect(activated.body.result.decision.buyer_effective).toBe(true);

    const after = await db.query('SELECT price_kmf FROM products WHERE id=$1', [product.id]);
    expect(Number(after.rows[0].price_kmf)).toBe(Number(before.rows[0].price_kmf));

    const local = await db.query(
      'SELECT market_id, amount, currency, status FROM product_market_price_drafts WHERE product_id=$1',
      [product.id]
    );
    expect(local.rows).toHaveLength(1);
    expect(local.rows[0].market_id).toBe(fx.marketA.id);
    expect(local.rows[0].currency).toBe(fx.marketA.currency);
    expect(local.rows[0].status).toBe('LOCAL_ACTIVE');
  });

  it('7 — market_id navigateur et marché B restent hors autorité de A', async () => {
    const injected = await request(app)
      .post(`/api/admin/workspaces/pricing/market/${fx.marketA.code}/products/${product.ref}/local-price`)
      .set('Authorization', fx.managerA.token)
      .send({ market_id: fx.marketB.id, amount: 1, reason: 'injection' });
    expect(injected.status).toBe(400);
    expect(injected.body.code).toBe('pricing_internal_authority_forbidden');

    const foreign = await request(app)
      .get(`/api/admin/workspaces/pricing/market/${fx.marketB.code}`)
      .set('Authorization', fx.managerA.token);
    expect(foreign.status).toBe(403);

    const bDraft = await db.query(
      'SELECT 1 FROM product_market_price_drafts WHERE product_id=$1 AND market_id=$2',
      [product.id, fx.marketB.id]
    );
    expect(bDraft.rows).toHaveLength(0);
  });
});