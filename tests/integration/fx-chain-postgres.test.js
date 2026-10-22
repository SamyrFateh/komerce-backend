'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * Chaîne EUR→USD→DJF : fail-closed, deux personnes, bande de plausibilité, append-only, figé par ids.
 */
const dbUrl = process.env.DATABASE_URL || '';
const hasIntegrationEnv = /^postgres(ql)?:\/\//.test(dbUrl) && dbUrl.length > 20;

if (!hasIntegrationEnv) {
  describe.skip('Chaîne FX DJF (needs DATABASE_URL)', () => {
    test('skipped — DATABASE_URL not configured', () => {});
  });
} else {
  const db = require('../../db');
  const { resolveChain, convertEurToDjf, FxChainUnavailableError } = require('../../services/fx-chain-service');
  const DAY = 24 * 3600 * 1000;

  async function insertObs({ rate, ageDays = 1, enteredBy = 'alice', approvedBy = 'bob' }) {
    const asOf = new Date(Date.now() - ageDays * DAY - 1000);
    const { rows: [r] } = await db.query(
      `INSERT INTO fx_rate_observations (rate, source_label, as_of, entered_by, approved_by, approved_at)
       VALUES ($1, 'test source', $2, $3, $4, CASE WHEN $4::text IS NULL THEN NULL ELSE now() END) RETURNING id`,
      [rate, asOf, enteredBy, approvedBy]
    );
    return r.id;
  }

  beforeEach(async () => {
    await db.query('ALTER TABLE fx_rate_observations DISABLE TRIGGER fx_rate_observations_append_only');
    await db.query('DELETE FROM fx_rate_observations');
    await db.query('ALTER TABLE fx_rate_observations ENABLE TRIGGER fx_rate_observations_append_only');
  });

  describe('fx-chain-service', () => {
    test('sans observation : refus fail-closed 503, aucun repli', async () => {
      await expect(resolveChain()).rejects.toMatchObject({ code: 'fx_rate_unavailable', statusCode: 503 });
      await expect(resolveChain()).rejects.toBeInstanceOf(FxChainUnavailableError);
    });

    test('observation non approuvée ignorée', async () => {
      await insertObs({ rate: 1.08, approvedBy: null });
      await expect(resolveChain()).rejects.toMatchObject({ code: 'fx_rate_unavailable' });
    });

    test('observation périmée (> 7 j) refusée', async () => {
      await insertObs({ rate: 1.08, ageDays: 8 });
      await expect(resolveChain()).rejects.toMatchObject({ code: 'fx_rate_unavailable' });
    });

    test('chaîne valide : EUR→USD × peg 177,721, ids figeables, arrondi unique', async () => {
      const id = await insertObs({ rate: 1.1 });
      const chain = await resolveChain();
      expect(chain.eur_to_djf).toBeCloseTo(1.1 * 177.721, 6);
      expect(chain.legs.map(l => l.kind)).toEqual(['observation', 'peg']);
      expect(chain.legs[0].id).toBe(id);
      expect(convertEurToDjf(10, chain)).toBe(Math.round(10 * 1.1 * 177.721));
    });

    test('transaction passée : une observation créée après n’est pas utilisée', async () => {
      await insertObs({ rate: 1.1 });
      await expect(resolveChain({ at: new Date(Date.now() - 2 * DAY) })).rejects.toMatchObject({ code: 'fx_rate_unavailable' });
    });

    test('la plus récente approuvée gagne', async () => {
      await insertObs({ rate: 1.05, ageDays: 3 });
      await insertObs({ rate: 1.12, ageDays: 1 });
      expect((await resolveChain()).legs[0].rate).toBeCloseTo(1.12, 6);
    });
  });

  describe('contraintes DB', () => {
    test('même personne ne saisit et n’approuve pas', async () => {
      await expect(insertObs({ rate: 1.1, enteredBy: 'alice', approvedBy: 'alice' })).rejects.toThrow();
    });
    test('bande de plausibilité EUR/USD', async () => {
      await expect(insertObs({ rate: 0.5 })).rejects.toThrow();
      await expect(insertObs({ rate: 3 })).rejects.toThrow();
    });
    test('append-only : modification du taux et suppression refusées ; approbation seule autorisée', async () => {
      const id = await insertObs({ rate: 1.1, approvedBy: null });
      await expect(db.query('UPDATE fx_rate_observations SET rate = 1.2 WHERE id = $1', [id])).rejects.toThrow(/append-only/);
      await db.query("UPDATE fx_rate_observations SET approved_by = 'bob', approved_at = now() WHERE id = $1", [id]);
      await expect(db.query('DELETE FROM fx_rate_observations WHERE id = $1', [id])).rejects.toThrow(/append-only/);
      await expect(db.query("UPDATE fx_rate_observations SET approved_by = 'eve' WHERE id = $1", [id])).rejects.toThrow(/append-only/);
    });
    test('seul le peg USD→DJF est admis, append-only, et DJF n’entre pas dans currency_parities', async () => {
      await expect(db.query("INSERT INTO fx_pegs (quote_ccy, rate, source_label, valid_from) VALUES ('XAF', 600, 'x', now())")).rejects.toThrow();
      await expect(db.query('UPDATE fx_pegs SET rate = 1')).rejects.toThrow(/append-only/);
      const { rows } = await db.query("SELECT rate FROM fx_pegs WHERE quote_ccy = 'DJF' ORDER BY valid_from DESC LIMIT 1");
      expect(Number(rows[0].rate)).toBeCloseTo(177.721, 3);
      const { rows: par } = await db.query("SELECT 1 FROM currency_parities WHERE currency = 'DJF'");
      expect(par).toHaveLength(0);
    });
  });
}
