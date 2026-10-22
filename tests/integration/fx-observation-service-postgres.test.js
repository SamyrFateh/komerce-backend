'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * Observation EUR/USD à deux personnes : saisie, approbation, identités normalisées, refus du même opérateur,
 * append-only, alerte d'écart > 3 %, effet immédiat sur l'autorité FX (DJF/USD/AED).
 */
const dbUrl = process.env.DATABASE_URL || '';
const hasIntegrationEnv = /^postgres(ql)?:\/\//.test(dbUrl) && dbUrl.length > 20;

if (!hasIntegrationEnv) {
  describe.skip('fx-observation-service (needs DATABASE_URL)', () => {
    test('skipped — DATABASE_URL not configured', () => {});
  });
} else {
  const db = require('../../db');
  const svc = require('../../services/fx-observation-service');
  const { convert } = require('../../services/fx-authority');
  const H = 3600 * 1000;

  async function reset() {
    await db.query('ALTER TABLE fx_rate_observations DISABLE TRIGGER fx_rate_observations_append_only');
    await db.query('DELETE FROM fx_rate_observations');
    await db.query('ALTER TABLE fx_rate_observations ENABLE TRIGGER fx_rate_observations_append_only');
    await db.query("DELETE FROM alerts WHERE type = 'fx_observation_gap'");
  }
  beforeEach(reset);
  afterAll(reset);

  const asOf = (hoursAgo) => new Date(Date.now() - hoursAgo * H).toISOString();
  const enter = (rate, hoursAgo, by = 'Alice@Komerce.km') =>
    svc.enterObservation({ rate, sourceLabel: 'BCE fixture test', sourceRef: 'ecb:fixture', asOf: asOf(hoursAgo), enteredBy: by });

  test('saisie non approuvée : la conversion DJF reste refusée', async () => {
    await enter(1.1, 2);
    await expect(convert({ amount: 10, from: 'EUR', to: 'DJF' })).rejects.toMatchObject({ code: 'fx_rate_unavailable' });
  });

  test('le saisissant ne peut pas approuver, même avec une casse ou des espaces différents (identité normalisée)', async () => {
    const o = await enter(1.1, 2, 'Alice@Komerce.km');
    await expect(svc.approveObservation({ id: o.id, approvedBy: '  ALICE@komerce.km ' }))
      .rejects.toMatchObject({ code: 'fx_observation_two_person_required', statusCode: 409 });
  });

  test('approbation par une autre personne : la conversion devient possible immédiatement', async () => {
    const o = await enter(1.25, 2);
    const a = await svc.approveObservation({ id: o.id, approvedBy: 'bob@komerce.km' });
    expect(a.approved_by).toBe('bob@komerce.km');
    const r = await convert({ amount: 100, from: 'EUR', to: 'USD' });
    expect(r.amount_text).toBe('125.00');
    await expect(svc.approveObservation({ id: o.id, approvedBy: 'carol@komerce.km' }))
      .rejects.toMatchObject({ code: 'fx_observation_already_approved' });
  });

  test('validations : bande de plausibilité, source, date, doublon de date', async () => {
    await expect(enter(2.5, 1)).rejects.toMatchObject({ code: 'fx_observation_rate_invalid' });
    await expect(svc.enterObservation({ rate: 1.1, sourceLabel: ' ', asOf: asOf(1), enteredBy: 'a' }))
      .rejects.toMatchObject({ code: 'fx_observation_source_required' });
    await expect(svc.enterObservation({ rate: 1.1, sourceLabel: 's', asOf: new Date(Date.now() + 5 * H).toISOString(), enteredBy: 'a' }))
      .rejects.toMatchObject({ code: 'fx_observation_as_of_future' });
    await expect(svc.enterObservation({ rate: 1.1, sourceLabel: 's', asOf: asOf(1) }))
      .rejects.toMatchObject({ code: 'fx_observation_identity_required' });
    const when = asOf(3);
    await svc.enterObservation({ rate: 1.1, sourceLabel: 's', asOf: when, enteredBy: 'a' });
    await expect(svc.enterObservation({ rate: 1.11, sourceLabel: 's', asOf: when, enteredBy: 'a' }))
      .rejects.toMatchObject({ code: 'fx_observation_duplicate_as_of', statusCode: 409 });
  });

  test('append-only : un taux déjà saisi ne peut jamais être modifié', async () => {
    const o = await enter(1.1, 2);
    await expect(db.query('UPDATE fx_rate_observations SET rate = 1.2 WHERE id = $1', [o.id])).rejects.toThrow(/append-only/);
  });

  test('écart > 3 % avec la précédente approuvée : alerte créée, approbation conservée', async () => {
    const first = await enter(1.10, 48);
    await svc.approveObservation({ id: first.id, approvedBy: 'bob@komerce.km' });
    const second = await enter(1.20, 2);        // +9 %
    const a = await svc.approveObservation({ id: second.id, approvedBy: 'bob@komerce.km' });
    expect(a.gap_alert).toBe(true);
    expect(a.gap_pct).toBeGreaterThan(3);
    const { rows } = await db.query("SELECT entity_id FROM alerts WHERE type = 'fx_observation_gap'");
    expect(rows.map(r => r.entity_id)).toContain(second.id);
  });

  test("écart <= 3 % : pas d'alerte", async () => {
    const first = await enter(1.10, 48);
    await svc.approveObservation({ id: first.id, approvedBy: 'bob@komerce.km' });
    const second = await enter(1.11, 2);
    const a = await svc.approveObservation({ id: second.id, approvedBy: 'bob@komerce.km' });
    expect(a.gap_alert).toBe(false);
    const { rows } = await db.query("SELECT 1 FROM alerts WHERE type = 'fx_observation_gap'");
    expect(rows).toHaveLength(0);
  });
}
