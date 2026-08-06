'use strict';


/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * tests/integration/otp-no-guest.test.js
 *
 * RÈGLE SANS EXCEPTION : aucune commande sans identité vérifiée par OTP.
 * Verrouille la fermeture de la faille guest (CAS 2 auth-guest + route guest-checkout).
 *
 *   - POST /api/orders SANS session        → 401 identity_required (plus de création auto)
 *   - POST /api/orders AVEC session valide  → n'est PAS rejeté en 401 (le tunnel légitime marche)
 *   - POST /api/auth/guest-checkout         → 410 (route retirée)
 *
 * Sans DATABASE_URL → skip propre.
 */

const hasEnv = Boolean(process.env.DATABASE_URL);

if (!hasEnv) {
  describe.skip('otp-no-guest (needs DATABASE_URL)', () => {
    test('skipped', () => {});
  });
} else {
  const request = require('supertest');
  const { createUser, cleanup } = require('./test-harness/seed-helpers');
  let app;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-secret-not-for-prod';
    app = require('../../server');
    await new Promise(r => setTimeout(r, 2000));
  });

  afterAll(async () => {
    if (app && app.get && app.get('httpServer')) { await new Promise((resolve) => app.get('httpServer').close(resolve)); }
    await cleanup();
    await new Promise(r => setTimeout(r, 300));
  });

  const ORDER_BODY = {
    items: [{ product_id: '00000000-0000-0000-0000-000000000000', quantity: 1 }],
    recipient_phone: '+2693999999',
    recipient_name: 'Tiers Test',
    tracking_phone: '+33600000000',
    payment_mode: 'cash_relais',
  };

  test('POST /api/orders SANS session → 401 identity_required (création guest fermée)', async () => {
    const res = await request(app).post('/api/orders').send(ORDER_BODY);
    expect(res.status).toBe(401);
    expect(res.body?.code).toBe('identity_required');
  });

  test('POST /api/orders avec session vérifiée → PAS de 401 (tunnel légitime intact)', async () => {
    const u = await createUser({ role: 'client' });
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${u.token}`)
      .send(ORDER_BODY);
    // Peut échouer en 400/404 (produit bidon), mais JAMAIS 401 : l'identité est acceptée.
    expect(res.status).not.toBe(401);
  });

  test('POST /api/auth/guest-checkout → 410 (route retirée)', async () => {
    const res = await request(app)
      .post('/api/auth/guest-checkout')
      .send({ phone: '+2693999999', full_name: 'X' });
    expect(res.status).toBe(410);
    expect(res.body?.code).toBe('guest_checkout_removed');
  });

  test('guest-checkout ne peut PAS prendre le contrôle d\'un compte existant', async () => {
    const victim = await createUser({ role: 'client' });
    const res = await request(app)
      .post('/api/auth/guest-checkout')
      .send({ phone: victim.phone || '+2693888888' });
    // Avant : 200 + cookie de session sur le compte victime. Maintenant : 410.
    expect(res.status).toBe(410);
  });
}
