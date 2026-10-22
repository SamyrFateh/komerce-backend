'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * Vérité monétaire unique de transaction (PR-B) : snapshot par marché (KM, CM, DJ), refus sans taux approuvé,
 * remboursements au prorata du capturé (partiel, cumulé, arrondis, solde exact, idempotence), réconciliation.
 */
const dbUrl = process.env.DATABASE_URL || '';
const hasIntegrationEnv = /^postgres(ql)?:\/\//.test(dbUrl) && dbUrl.length > 20;

if (!hasIntegrationEnv) {
  describe.skip('order-fx-snapshot (needs DATABASE_URL)', () => {
    test('skipped — DATABASE_URL not configured', () => {});
  });
} else {
  const db = require('../../db');
  const {
    buildOrderFxSnapshot, refundEurForKmf, assertRefundWithinCaptured, assertRefundRecordCompatible,
  } = require('../../services/order-fx-snapshot');
  const DAY = 24 * 3600 * 1000;

  async function resetObs() {
    await db.query('ALTER TABLE fx_rate_observations DISABLE TRIGGER fx_rate_observations_append_only');
    await db.query('DELETE FROM fx_rate_observations');
    await db.query('ALTER TABLE fx_rate_observations ENABLE TRIGGER fx_rate_observations_append_only');
  }
  async function approvedObs(rate) {
    const { rows: [o] } = await db.query(
      'INSERT INTO fx_rate_observations (rate, source_label, as_of, entered_by) VALUES ($1, $2, $3, $4) RETURNING id',
      [rate, 'BCE fixture test', new Date(Date.now() - DAY - 1000), 'alice']);
    await db.query("UPDATE fx_rate_observations SET approved_by = 'bob' WHERE id = $1", [o.id]);
  }
  beforeEach(resetObs);
  afterAll(resetObs);

  describe('buildOrderFxSnapshot par marché', () => {
    test('KM : devise commerciale KMF, EUR = total/492 (jambes sourcées)', async () => {
      const r = await buildOrderFxSnapshot({ totalKmf: 49196.775, marketId: 'm-km', marketCurrency: 'KMF', client: db });
      expect(r.snapshot.market).toMatchObject({ currency: 'KMF', amount: 49197, minor_unit: 0 });
      expect(r.totalEur).toBe(100);
      expect(r.snapshot.eur.amount).toBe(r.totalEur);
      expect(r.snapshot.origin).toMatchObject({ currency: 'KMF', amount: 49196.775 });
      expect(r.snapshot.eur.legs.length).toBeGreaterThan(0);
    });

    test('CM : XAF sans observation (parité fixe), un seul arrondi', async () => {
      const r = await buildOrderFxSnapshot({ totalKmf: 49196.775, marketId: 'm-cm', marketCurrency: 'XAF', client: db });
      expect(r.snapshot.market).toMatchObject({ currency: 'XAF', amount: 65596, minor_unit: 0 });
      expect(r.totalEur).toBe(100);
    });

    test('DJ : refus 503 sans observation EUR/USD approuvée ; avec observation, DJF figé', async () => {
      await expect(buildOrderFxSnapshot({ totalKmf: 10000, marketId: 'm-dj', marketCurrency: 'DJF', client: db }))
        .rejects.toMatchObject({ code: 'fx_rate_unavailable', statusCode: 503 });
      await approvedObs(1.25);
      const r = await buildOrderFxSnapshot({ totalKmf: 49196.775, marketId: 'm-dj', marketCurrency: 'DJF', client: db });
      // 100 EUR × 1,25 USD × 177,721 = 22215,125 DJF → 22215
      expect(r.snapshot.market).toMatchObject({ currency: 'DJF', amount: 22215, minor_unit: 0 });
      expect(r.snapshot.market.legs.map(l => l.source)).toEqual(expect.arrayContaining(['BCE fixture test']));
      expect(r.totalEur).toBe(100);
    });

    test('devise du marché absente ou non supportée : refus', async () => {
      await expect(buildOrderFxSnapshot({ totalKmf: 1000, marketCurrency: '', client: db }))
        .rejects.toMatchObject({ code: 'ORDER_MARKET_CURRENCY_MISSING' });
      await expect(buildOrderFxSnapshot({ totalKmf: 1000, marketCurrency: 'CNY', client: db }))
        .rejects.toMatchObject({ code: expect.stringMatching(/^fx_/) });
    });

    test('réconciliation : devise commerciale, montant confirmé, valeur économique, encaissement EUR', async () => {
      const r = await buildOrderFxSnapshot({ totalKmf: 24598.3875, marketId: 'm', marketCurrency: 'XAF', client: db });
      const s = r.snapshot;
      expect(s.origin.amount).toBe(24598.3875);               // valeur économique interne (base KMF)
      expect(s.market.currency).toBe('XAF');                  // devise commerciale
      expect(s.market.amount_text).toBe('32798');             // montant confirmé (Mobile Money, sans reconversion)
      expect(s.eur.amount).toBe(r.totalEur);                  // encaissement Stripe/PayPal
      expect(r.totalEur).toBe(50);
    });
  });

  describe('remboursements au montant encaissé', () => {
    const order = { id: 'o1', total_kmf: 10000, total_eur: 20.33 };

    test('prorata du capturé, jamais un taux du jour', () => {
      expect(refundEurForKmf({ order, refundKmf: 2500 })).toBe(5.08); // 20,33 × 0,25 = 5,0825
    });

    test('cumul : le remboursement du solde prend l\'EUR restant exact', () => {
      const first = refundEurForKmf({ order, refundKmf: 3333 });
      const last = refundEurForKmf({ order, refundKmf: 6667, prior: { kmf: '3333', eur: String(first) } });
      expect(Number((first + last).toFixed(2))).toBe(20.33);
    });

    test('dépassement du capturé refusé (KMF et EUR)', () => {
      expect(() => refundEurForKmf({ order, refundKmf: 10001 })).toThrow(expect.objectContaining({ code: 'REFUND_EXCEEDS_CAPTURED' }));
      expect(() => refundEurForKmf({ order, refundKmf: 5000, prior: { kmf: '6000', eur: '12' } }))
        .toThrow(expect.objectContaining({ code: 'REFUND_EXCEEDS_CAPTURED' }));
    });

    test('commande sans montant encaissé : refus, pas de repli 492', () => {
      expect(() => refundEurForKmf({ order: { id: 'x', total_kmf: 10000, total_eur: null }, refundKmf: 100 }))
        .toThrow(expect.objectContaining({ code: 'REFUND_ORDER_FX_MISSING' }));
    });

    function fake(rows) {
      return { query: jest.fn().mockResolvedValue({ rows }) };
    }

    test('garde cumul : refuse le dépassement', async () => {
      await expect(assertRefundWithinCaptured(fake([{ kmf: '9000', eur: '18' }]), order, 2000, 4, 'partial'))
        .rejects.toMatchObject({ code: 'REFUND_EXCEEDS_CAPTURED' });
      await expect(assertRefundWithinCaptured(fake([{ kmf: '1000', eur: '2' }]), order, 2000, 4, 'partial')).resolves.toBeUndefined();
    });

    test('idempotence : même montant rejouable, montant différent refusé explicitement (409)', async () => {
      await expect(assertRefundRecordCompatible(fake([{ kmf: '2500.00', eur: '5.08' }]), order, 2500, 5.08, 'partial')).resolves.toBeUndefined();
      await expect(assertRefundRecordCompatible(fake([{ kmf: '2500.00', eur: '5.08' }]), order, 3000, 6.1, 'partial'))
        .rejects.toMatchObject({ code: 'REFUND_ALREADY_RECORDED_DIFFERENT_AMOUNT', statusCode: 409 });
      await expect(assertRefundRecordCompatible(fake([]), order, 3000, 6.1, 'partial')).resolves.toBeUndefined();
    });
  });
}
