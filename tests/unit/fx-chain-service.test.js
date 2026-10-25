'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db', () => ({ query: jest.fn() }));

const { resolveObservation, resolvePublishedQuote, resolvePeg, resolveChain, convertEurToDjf, FxChainUnavailableError } = require('../../services/fx-chain-service');

const client = (rowsByCall) => ({ query: jest.fn(async () => ({ rows: rowsByCall.shift() || [] })) });

describe('fx-chain-service — résolveurs (observation, peg)', () => {
  test('observation absente/non approuvée/périmée : refus typé fx_rate_unavailable 503', async () => {
    await expect(resolveObservation({ client: client([[]]) })).rejects.toMatchObject({ code: 'fx_rate_unavailable', statusCode: 503 });
  });

  test('requête observation : approuvée seulement, approuvée avant `at`, fraîche (jours)', async () => {
    const c = client([[{ id: 'o', rate: 1.1, rate_text: '1.10000000', as_of: 'x', source_label: 'BCE' }]]);
    const obs = await resolveObservation({ at: null, maxAgeDays: 7, client: c });
    expect(obs.rate_text).toBe('1.10000000');
    const [sql, params] = c.query.mock.calls[0];
    expect(sql).toMatch(/approved_by IS NOT NULL/);
    expect(sql).toMatch(/approved_at <= COALESCE/);
    expect(params).toEqual([null, 7]);
  });

  test('l’autorité FX choisit la cotation BCE publiée avant toute observation manuelle', async () => {
    const c = client([[{
      id: 'official-usd', rate: 1.1193, rate_text: '1.11930000',
      as_of: '2026-10-23', source_label: 'Banque centrale européenne',
    }]]);
    const o = await resolveObservation({ client: c });
    expect(o.id).toBe('official-usd');
    const sql = c.query.mock.calls[0][0];
    expect(sql).toContain('fx_public_reference_quotes');
    expect(sql).toContain("quote_ccy = 'USD'");
    expect(sql).toContain('approved_by IS NOT NULL');
    expect(sql).toContain('ingested_at <=');
    expect(sql).toContain('ORDER BY authority_rank ASC');
  });

  test('une cotation EUR/CNY nécessite une publication sourcée et fraîche', async () => {
    const c = client([[{
      id: 'published-cny', rate: 7.4999, rate_text: '7.49990000',
      as_of: '2026-10-23', source_label: 'Banque centrale européenne',
    }]]);
    const o = await resolvePublishedQuote({ quote: 'CNY', client: c });
    expect(o.rate_text).toBe('7.49990000');
    expect(c.query.mock.calls[0][1]).toEqual([null, 7, 'CNY']);
    expect(c.query.mock.calls[0][0]).toContain('ingested_at <=');
    await expect(resolvePublishedQuote({ quote: 'CNY', client: client([[]]) }))
      .rejects.toMatchObject({ code: 'fx_rate_unavailable' });
  });

  test('peg : filtré par devise cotée ; absent = refus nommant la paire', async () => {
    const c = client([[{ id: 'p', rate: 3.6725, rate_text: '3.67250000', valid_from: 'v', source_label: 'CBUAE' }]]);
    await resolvePeg({ quote: 'AED', client: c });
    expect(c.query.mock.calls[0][1]).toEqual([null, 'AED']);
    await expect(resolvePeg({ quote: 'AED', client: client([[]]) })).rejects.toThrow(/USD\/AED/);
  });

  test('chaîne DJF : jambes observation + peg ; EUR→DJF arrondi unique', async () => {
    const c = client([
      [{ id: 'o', rate: 1.25, rate_text: '1.25', as_of: 'a', source_label: 's' }],
      [{ id: 'p', rate: 177.721, rate_text: '177.721', valid_from: 'v', source_label: 'BCD' }],
    ]);
    const chain = await resolveChain({ client: c });
    expect(chain.legs.map(l => l.kind)).toEqual(['observation', 'peg']);
    expect(convertEurToDjf(100, chain)).toBe(22215);
    expect(new FxChainUnavailableError('x').code).toBe('fx_rate_unavailable');
  });
});
