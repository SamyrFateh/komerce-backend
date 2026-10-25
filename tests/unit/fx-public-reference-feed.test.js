'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db', () => ({ query: jest.fn(), withTransaction: jest.fn() }));
const { ECB_DAILY_URL, parseEcbDailyXml, fetchEcbDaily, ingestEcbDaily } =
  require('../../services/fx-public-reference-feed');

const fixture = (day = '2026-10-23') => `<?xml version="1.0"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01">
<gesmes:Sender><gesmes:name>European Central Bank</gesmes:name></gesmes:Sender>
<Cube><Cube time='${day}'>
${[
  ['USD','1.1193'], ['JPY','175.51'], ['CNY','7.4999'], ['GBP','0.83728'],
  ['PLN','4.3945'], ['AUD','1.5971'], ['CAD','1.5779'], ['CHF','0.9256'],
  ['INR','106.1265'], ['THB','37.718'], ['ZAR','18.393'],
].map(([c, r]) => `<Cube currency='${c}' rate='${r}'/>`).join('\n')}
</Cube></Cube></gesmes:Envelope>`;
const SUNDAY = new Date('2026-10-25T10:00:00Z');

describe('cotations officielles BCE — publication consultable 7 jours sur 7', () => {
  test('dimanche : conserve la dernière publication du vendredi, toutes les paires EUR/XXX sourcées', () => {
    const parsed = parseEcbDailyXml(fixture(), { now: SUNDAY });
    expect(parsed.asOf).toBe('2026-10-23');
    expect(parsed.quotes).toEqual(expect.arrayContaining([
      { currency: 'USD', rate: '1.1193' },
      { currency: 'CNY', rate: '7.4999' },
      { currency: 'PLN', rate: '4.3945' },
    ]));
    expect(parsed.quotes).toHaveLength(11);
    expect(parsed.quotes.map(x => x.currency)).not.toContain('KMF');
  });

  test('refuse dates futures, obsolètes, invalides, duplications ou USD absent', () => {
    expect(() => parseEcbDailyXml(fixture('2026-10-01'), { now: SUNDAY })).toThrow(/fraîcheur/);
    expect(() => parseEcbDailyXml(fixture('2026-10-30'), { now: SUNDAY })).toThrow(/fraîcheur/);
    expect(() => parseEcbDailyXml(fixture('2026-02-30'), { now: SUNDAY })).toThrow(/invalide/);
    expect(() => parseEcbDailyXml(fixture().replace("<Cube currency='USD' rate='1.1193'/>", ''), { now: SUNDAY }))
      .toThrow(/USD absent/);
    expect(() => parseEcbDailyXml(fixture().replace("</Cube></Cube></gesmes:Envelope>", "<Cube currency='USD' rate='1.2500'/></Cube></Cube></gesmes:Envelope>"), { now: SUNDAY }))
      .toThrow(/doublonnée/);
  });

  test('ne consomme ni faux XML ni taux numériques inventés', () => {
    expect(() => parseEcbDailyXml('invalid', { now: SUNDAY })).toThrow(/enveloppe/);
    expect(() => parseEcbDailyXml(fixture().replace('1.1193', '0'), { now: SUNDAY }))
      .toThrow(/invalide/);
    expect(() => parseEcbDailyXml(fixture().replace('1.1193', '123456789'), { now: SUNDAY }))
      .toThrow(/invalide/);
  });

  test('télécharge uniquement le flux officiel HTTPS avec borne de taille et délai', async () => {
    const fetchFn = jest.fn().mockResolvedValue({
      ok: true, headers: { get: () => null }, text: async () => fixture(),
    });
    const data = await fetchEcbDaily({ fetchFn, now: SUNDAY });
    expect(data.asOf).toBe('2026-10-23');
    expect(fetchFn).toHaveBeenCalledWith(ECB_DAILY_URL, expect.objectContaining({
      method: 'GET', redirect: 'error', signal: expect.anything(),
    }));
    const badResponse = jest.fn().mockResolvedValue({
      ok: true, headers: { get: () => '9999999' }, text: jest.fn(),
    });
    await expect(fetchEcbDaily({ fetchFn: badResponse, now: SUNDAY })).rejects.toThrow(/volumineuse/);
  });

  test('persiste toutes les devises publiques avec la date BCE et l’URL, sans inventer d’approbation humaine', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rowCount: 1, rows: [{ id: 'quote-id' }] }) };
    const fetchFn = jest.fn().mockResolvedValue({
      ok: true, headers: { get: () => null }, text: async () => fixture(),
    });
    const report = await ingestEcbDaily({ client, fetchFn, now: SUNDAY });
    expect(report).toEqual({ as_of: '2026-10-23', rates_received: 11, inserted: 11 });
    expect(client.query).toHaveBeenCalledTimes(11);
    for (const [sql, args] of client.query.mock.calls) {
      expect(sql).toContain('ON CONFLICT (base_ccy, quote_ccy, as_of) DO NOTHING');
      expect(sql).not.toMatch(/approved_by|entered_by/);
      expect(args[2]).toBe('2026-10-23');
      expect(args[3]).toBe(ECB_DAILY_URL);
    }
  });

  test('aucune écriture si le flux est invalide ou l’API indisponible', async () => {
    const client = { query: jest.fn() };
    const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    await expect(ingestEcbDaily({ client, fetchFn, now: SUNDAY })).rejects.toThrow(/HTTP 503/);
    expect(client.query).not.toHaveBeenCalled();
  });
});
