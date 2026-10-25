'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * Preuve PostgreSQL : les cours publics arrivent append-only, sont datés
 * et participent au snapshot monétaire sans fausse approbation manuelle.
 */
const dbUrl = process.env.DATABASE_URL || '';
const available = /^postgres(ql)?:\/\//.test(dbUrl) && dbUrl.length > 20;

if (!available) {
  describe.skip('taux publics officiels (needs DATABASE_URL)', () => {
    test('skipped — DATABASE_URL not configured', () => {});
  });
} else {
  const db = require('../../db');
  const { resolveObservation, resolvePublishedQuote } = require('../../services/fx-chain-service');
  const { convert } = require('../../services/fx-authority');
  const SOURCE = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

  test('USD/CNY : conversion exacte via EUR, source/date/ids conservés et aucune approbation imaginaire', async () => {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO fx_public_reference_quotes
          (quote_ccy, rate, as_of, source_ref)
         VALUES ('USD', 1.25, CURRENT_DATE, $1),
                ('CNY', 7.50, CURRENT_DATE, $1)
         RETURNING id, quote_ccy`, [SOURCE]
      );
      const r = await convert({ amount:'100', from:'USD', to:'CNY', client });
      expect(r.amount_text).toBe('600.00');
      expect(r.legs.map(l => l.pair)).toEqual(['EUR/USD', 'EUR/CNY']);
      expect(new Set(r.legs.map(l => l.id))).toEqual(new Set(rows.map(x => x.id)));
      expect(r.legs.every(l => l.source === 'Banque centrale européenne')).toBe(true);
      const usd = await resolveObservation({ client });
      expect(usd.id).toBe(rows.find(x => x.quote_ccy === 'USD').id);
      const beforeIngest = new Date(Date.now() - 3600 * 1000);
      await expect(resolvePublishedQuote({ quote:'CNY', at:beforeIngest, client }))
        .rejects.toMatchObject({ code:'fx_rate_unavailable' });
      await expect(client.query('UPDATE fx_public_reference_quotes SET rate = 1.5 WHERE id = $1', [rows[0].id]))
        .rejects.toThrow(/append-only/);
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  });
}
