'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * Tarifs de vente transport par Market : chargement, révocation, isolation inter-marchés, contraintes.
 */
const dbUrl = process.env.DATABASE_URL || '';
const hasIntegrationEnv = /^postgres(ql)?:\/\//.test(dbUrl) && dbUrl.length > 20;

if (!hasIntegrationEnv) {
  describe.skip('market_transport_sale_rates (needs DATABASE_URL)', () => {
    test('skipped — DATABASE_URL not configured', () => {});
  });
} else {
  const db = require('../../db');
  const { loadMarketTransportSaleRates } = require('../../services/market-transport-sale-rates');
  let m1; let m2;

  beforeAll(async () => {
    const { rows } = await db.query("SELECT id FROM markets WHERE code IN ('CM','CG') ORDER BY code");
    [m1, m2] = rows.map(r => r.id);
    if (!m1 || !m2) throw new Error('markets CM/CG absents du schéma de test');
  });
  beforeEach(async () => { await db.query('DELETE FROM market_transport_sale_rates WHERE market_id = ANY($1::uuid[])', [[m1, m2]]); });
  afterAll(async () => { await db.query('DELETE FROM market_transport_sale_rates WHERE market_id = ANY($1::uuid[])', [[m1, m2]]); });

  const ins = (m, key, rate, ev = 'decision-locale-2026-10') => db.query(
    'INSERT INTO market_transport_sale_rates (market_id, rate_key, rate_kmf_per_kg, evidence_ref) VALUES ($1,$2,$3,$4)', [m, key, rate, ev]);

  test('aucun tarif : objet vide (fail-closed côté gate)', async () => {
    expect(await loadMarketTransportSaleRates(db, m1)).toEqual({});
    expect(await loadMarketTransportSaleRates(db, null)).toEqual({});
  });

  test('isolation : le tarif d’un Market n’est jamais lu par un autre', async () => {
    await ins(m1, 'SEA_KMF_PER_KG_COMMERCIAL', 90);
    expect(await loadMarketTransportSaleRates(db, m1)).toEqual({ SEA_KMF_PER_KG_COMMERCIAL: 90 });
    expect(await loadMarketTransportSaleRates(db, m2)).toEqual({});
  });

  test('tarif révoqué ou futur ignoré', async () => {
    await ins(m1, 'SEA_KMF_PER_KG_COMMERCIAL', 90);
    await db.query('UPDATE market_transport_sale_rates SET revoked_at = now() WHERE market_id = $1', [m1]);
    expect(await loadMarketTransportSaleRates(db, m1)).toEqual({});
    await db.query("INSERT INTO market_transport_sale_rates (market_id, rate_key, rate_kmf_per_kg, evidence_ref, valid_from) VALUES ($1,'AIR_KMF_PER_KG_TAXABLE',3000,'x', now() + interval '1 day')", [m1]);
    expect(await loadMarketTransportSaleRates(db, m1)).toEqual({});
  });

  test('contraintes : clé inconnue, tarif ≤ 0, pièce vide, doublon actif refusés', async () => {
    await expect(ins(m1, 'FREIGHT_COST', 10)).rejects.toThrow();
    await expect(ins(m1, 'SEA_KMF_PER_KG_COMMERCIAL', 0)).rejects.toThrow();
    await expect(ins(m1, 'SEA_KMF_PER_KG_COMMERCIAL', 10, '  ')).rejects.toThrow();
    await ins(m1, 'SEA_KMF_PER_KG_COMMERCIAL', 90);
    await expect(ins(m1, 'SEA_KMF_PER_KG_COMMERCIAL', 95)).rejects.toThrow();
  });
}
