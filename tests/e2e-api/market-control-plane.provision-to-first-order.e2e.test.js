'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 *
 * H — base migrée vierge de données de scénario -> marché PROVISIONING
 * -> readiness verte -> ACTIVE -> première commande.
 * Toutes les mutations métier passent par les routes/services canoniques.
 */
const request=require('../helpers/supertest-order-key');
const express=require('express');
const { signAuthToken }=require('../../utils/auth-session');
const { describeE2E, createCleanup, activateLocalPrice, authorizeCentralCollectionForTest, tag, uuid }=require('../helpers/e2eDbKit');

jest.setTimeout(30000);

describeE2E('Market Control Plane H — provisioning -> première commande',({db})=>{
  const centralId=uuid(), leadId=uuid(), buyerId=uuid(), productId=uuid();
  const centralEmail=`${tag('central')}@komerce.test`;
  const leadEmail=`${tag('lead')}@komerce.test`;
  const buyerEmail=`${tag('buyer')}@komerce.test`;
  let cleanup, app, adminToken, buyerToken, marketCode, marketId, relayId, assignmentId;

  beforeAll(async()=>{
    cleanup=createCleanup(db);

    const {rows:used}=await db.query('SELECT code FROM markets');
    const occupied=new Set(used.map(r=>r.code));
    marketCode=['GA','SN','BJ','TG','GH','KE','TZ','UG','RW'].find(c=>!occupied.has(c));
    if(!marketCode) throw new Error('Aucun code marché E2E libre');

    for(const [id,name,email,phone,role] of [
      [centralId,'E2E Central',centralEmail,'+33600000001','admin'],
      [leadId,'E2E Lead',leadEmail,'+33600000002','client'],
      [buyerId,'E2E Buyer',buyerEmail,'+33600000003','client'],
    ]) {
      await db.query('INSERT INTO users (id,full_name,email,phone,role) VALUES ($1,$2,$3,$4,$5)',[id,name,email,phone,role]);
      cleanup.track('users','id',id);
    }

    await db.query(
      `INSERT INTO pricing_global_access_grants (user_id,granted_by,reason)
       VALUES ($1,$1,'E2E market provisioning central authority')
       ON CONFLICT (user_id) DO UPDATE SET revoked_at=NULL, granted_by=EXCLUDED.granted_by, reason=EXCLUDED.reason`,
      [centralId]
    );
    cleanup.track('pricing_global_access_grants','user_id',centralId);

    adminToken=signAuthToken({id:centralId,role:'admin'},{method:'e2e'});
    buyerToken=signAuthToken({id:buyerId,role:'client'},{method:'e2e'});

    app=express();
    app.use(require('cookie-parser')());
    app.use(express.json());
    app.use('/api/admin/markets',require('../../routes/admin-market-control-plane'));
    app.use('/api/orders',require('../../routes/orders'));
    app.use((err,_req,res,_next)=>res.status(err.status||err.statusCode||500).json({error:err.message,code:err.code}));
  });

  afterAll(async()=>{ if(cleanup) await cleanup.run(); });

  it('1 — provisionne un marché complet mais encore inactif',async()=>{
    const {rows:amountCaps}=await db.query(
      `SELECT cr.capability
         FROM ceiling_templates ct
         JOIN ceiling_template_capabilities ctc ON ctc.template_id=ct.id
         JOIN capability_registry cr ON cr.capability=ctc.capability
        WHERE ct.is_current=TRUE
          AND cr.authority_scope='MARKET'
          AND cr.delegation_mode='DELEGABLE'
          AND cr.amount_bearing=TRUE
        ORDER BY cr.capability`
    );
    const limits=Object.fromEntries(amountCaps.map(r=>[r.capability,500000]));

    const res=await request(app).post('/api/admin/markets')
      .set('Authorization',`Bearer ${adminToken}`)
      .send({
        code:marketCode,name:'E2E Nouveau Marché',currency:'KMF',minor_unit:0,
        central_referent_user_id:centralId,
        financial_limits:limits,
        lead:{email:leadEmail,channel:'EMAIL'},
        payment_provider:{provider:'mtn_momo',currency:'KMF',priority:10},
        cash_policy:{cash_enabled:true,confirmation_mode:'SINGLE'},
        initial_relais:{name:'E2E Relais',agent_name:'E2E Agent',phone:'+269000321',address:'E2E Address',island:'Ngazidja'},
        storefront_texts:{welcome:'Bienvenue E2E'},
      });

    if(res.status!==201) throw new Error(`PROVISION_FAILED:${res.status}:${JSON.stringify(res.body)}`);
    expect(res.status).toBe(201);
    expect(res.body.market.lifecycle_status).toBe('PROVISIONING');
    // Le relais initial actif suffit : aucune attestation transporteur ne conditionne l'ouverture.
    expect(res.body.readiness.ready_for_activation).toBe(true);
    expect(res.body.readiness.operations.blockers.map(b=>b.code)).toEqual([]);
    expect(res.body.lead.kind).toBe('membership');
    expect(res.body.initial_relais.id).toBeTruthy();

    marketId=res.body.market.id;
    assignmentId=res.body.assignment_id;
    relayId=res.body.initial_relais.id;

    // Parent d'abord, enfants ensuite : cleanup LIFO.
    cleanup.track('markets','id',marketId);
    cleanup.track('market_operating_assignments','id',assignmentId);
    cleanup.trackSql('DELETE FROM assignment_capability_ceiling WHERE assignment_id=$1',[assignmentId]);
    cleanup.trackSql('DELETE FROM assignment_memberships WHERE assignment_id=$1',[assignmentId]);
    cleanup.trackSql('DELETE FROM membership_capabilities WHERE membership_id IN (SELECT id FROM assignment_memberships WHERE assignment_id=$1)',[assignmentId]);
    cleanup.trackSql('DELETE FROM operator_market_scopes WHERE market_id=$1',[marketId]);
    cleanup.trackSql('DELETE FROM market_team_invitations WHERE assignment_id=$1',[assignmentId]);
    cleanup.trackSql('DELETE FROM market_cash_control_policies WHERE assignment_id=$1',[assignmentId]);
    cleanup.trackSql('DELETE FROM market_payment_providers WHERE market_id=$1',[marketId]);
    cleanup.track('relais','id',relayId);
    cleanup.trackSql('DELETE FROM market_delegation_audit WHERE market_id=$1 OR assignment_id=$2',[marketId,assignmentId]);

    const {rows:[stored]}=await db.query('SELECT lifecycle_status,is_active FROM markets WHERE id=$1',[marketId]);
    expect(stored).toEqual(expect.objectContaining({lifecycle_status:'PROVISIONING',is_active:false}));
  });

  it('1b — aucun contrat transporteur nécessaire quand un relais actif existe',async()=>{
    const view=await request(app).get(`/api/admin/markets/${marketCode}/control-plane`).set('Authorization',`Bearer ${adminToken}`);
    expect(view.status).toBe(200);
    expect(view.body.relaisActive).toBeGreaterThan(0);
    expect(view.body.deliveryProof.proven).toBe(false);
    expect(view.body.readiness.ready_for_activation).toBe(true);
  });

  it('2 — activation passe uniquement parce que les deux readiness sont vertes',async()=>{
    const res=await request(app)
      .post(`/api/admin/markets/${marketCode}/lifecycle`)
      .set('Authorization',`Bearer ${adminToken}`)
      .send({status:'ACTIVE'});
    expect(res.status).toBe(200);
    expect(res.body.after).toMatchObject({lifecycle_status:'ACTIVE',is_active:true});
  });

  it('3 — la première commande réelle est créée sur le nouveau marché',async()=>{
    await db.query(
      'INSERT INTO products (id,name,price_kmf,stock) VALUES ($1,$2,25000,50)',
      [productId,`E2E produit ${tag('product')}`]
    );
    cleanup.track('products','id',productId);
    await activateLocalPrice(db,cleanup,{marketId,productId,amount:25000,currency:'KMF'});

    const orderBody={
      items:[{product_id:productId,quantity:1}],
      relais_id:relayId,
      payment_mode:'stripe_eur',
      tracking_phone:'+269000999',
    };
    // Lot 3 : un nouveau marché n'a aucune autorisation d'encaissement central → refus fail-closed.
    const refused=await request(app).post('/api/orders')
      .set('Authorization',`Bearer ${buyerToken}`).send(orderBody);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('PAYMENT_MODE_NOT_ALLOWED_FOR_MARKET');
    await authorizeCentralCollectionForTest(db,cleanup,marketId,'stripe_eur');

    const res=await request(app).post('/api/orders')
      .set('Authorization',`Bearer ${buyerToken}`)
      .send(orderBody);

    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({status:'pending',payment_status:'pending'});
    const orderId=res.body.order.id;

    // Enregistrer le cleanup avant toute assertion DB afin qu'un échec n'abandonne
    // jamais la commande et ses enfants dans la base E2E.
    // createCleanup exécute en LIFO : enregistrer recipients AVANT orders
    // garantit enfants order -> order -> recipient -> relais au nettoyage.
    cleanup.trackSql('DELETE FROM recipients WHERE relais_id=$1',[relayId]);
    cleanup.track('orders','id',orderId);
    cleanup.trackSql('DELETE FROM invoices WHERE order_id=$1',[orderId]);
    cleanup.trackSql('DELETE FROM order_items WHERE order_id=$1',[orderId]);
    cleanup.trackSql('DELETE FROM order_status_history WHERE order_id=$1',[orderId]);

    const {rows:[stored]}=await db.query('SELECT market_id,relais_id,status,payment_status FROM orders WHERE id=$1',[orderId]);
    expect(stored).toMatchObject({market_id:marketId,relais_id:relayId,status:'pending',payment_status:'pending'});
  });

  // Les commandes créées par les scénarios marché sont toujours enregistrées
  // pour le cleanup LIFO, même si une assertion de tarification échoue ensuite.
  async function expectOrderWithoutMaritimeSurcharge(res) {
    const orderId = res.body?.order?.id;
    if (orderId) {
      cleanup.track('orders', 'id', orderId);
      cleanup.trackSql('DELETE FROM invoices WHERE order_id=$1', [orderId]);
      cleanup.trackSql('DELETE FROM order_items WHERE order_id=$1', [orderId]);
      cleanup.trackSql('DELETE FROM order_status_history WHERE order_id=$1', [orderId]);
    }
    expect(res.status).toBe(201);
    expect(orderId).toBeTruthy();
    const { rows: [stored] } = await db.query(
      'SELECT market_id, transport_price_kmf, transport_pricing_snapshot FROM orders WHERE id=$1',
      [orderId]
    );
    expect(stored.market_id).toBe(marketId);
    expect(Number(stored.transport_price_kmf)).toBe(0);
    expect(stored.transport_pricing_snapshot).toBeNull();
  }

  it('4 — marché XAF sans tarif maritime : commande admise sans supplément client', async () => {
    await db.query("UPDATE markets SET currency='XAF' WHERE id=$1", [marketId]);
    await db.query("UPDATE product_market_price_drafts SET currency='XAF' WHERE market_id=$1 AND product_id=$2", [marketId, productId]);
    try {
      const res = await request(app).post('/api/orders')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ items: [{ product_id: productId, quantity: 1 }], relais_id: relayId, payment_mode: 'stripe_eur', tracking_phone: '+269000999' });
      await expectOrderWithoutMaritimeSurcharge(res);
    } finally {
      await db.query("UPDATE markets SET currency='KMF' WHERE id=$1", [marketId]);
      await db.query("UPDATE product_market_price_drafts SET currency='KMF' WHERE market_id=$1 AND product_id=$2", [marketId, productId]);
    }
  });

  it('5 — tarif maritime historique externe ou local : aucune surfacturation client', async () => {
    await db.query("UPDATE markets SET currency='XAF' WHERE id=$1", [marketId]);
    await db.query("UPDATE product_market_price_drafts SET currency='XAF' WHERE market_id=$1 AND product_id=$2", [marketId, productId]);
    const orderBody = { items: [{ product_id: productId, quantity: 1 }], relais_id: relayId, payment_mode: 'stripe_eur', tracking_phone: '+269000999' };
    try {
      const { rows: [other] } = await db.query(
        "SELECT id FROM markets WHERE id<>$1 AND code IN ('KM','CM','CG') LIMIT 1", [marketId]
      );
      expect(other?.id).toBeTruthy();
      await db.query(
        "INSERT INTO market_transport_sale_rates (market_id,rate_key,rate_per_kg,currency,evidence_ref) VALUES ($1,'SEA_KMF_PER_KG_COMMERCIAL',90,'XAF','e2e-autre-marche')",
        [other.id]
      );
      const first = await request(app).post('/api/orders')
        .set('Authorization', `Bearer ${buyerToken}`).send(orderBody);
      await expectOrderWithoutMaritimeSurcharge(first);

      await db.query(
        "INSERT INTO market_transport_sale_rates (market_id,rate_key,rate_per_kg,currency,evidence_ref) VALUES ($1,'SEA_KMF_PER_KG_COMMERCIAL',90,'XAF','e2e-decision-locale')",
        [marketId]
      );
      const second = await request(app).post('/api/orders')
        .set('Authorization', `Bearer ${buyerToken}`).send(orderBody);
      await expectOrderWithoutMaritimeSurcharge(second);
    } finally {
      await db.query('DELETE FROM market_transport_sale_rates WHERE evidence_ref IN ($1,$2)', ['e2e-autre-marche', 'e2e-decision-locale']);
      await db.query("UPDATE markets SET currency='KMF' WHERE id=$1", [marketId]);
      await db.query("UPDATE product_market_price_drafts SET currency='KMF' WHERE market_id=$1 AND product_id=$2", [marketId, productId]);
    }
  });
});
