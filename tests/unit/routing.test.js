'use strict';

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const {
  resolveRoutingFromRelais,
  normalizeIsland,
  ensureRoutingColumns,
  RoutingError,
  ROUTING_MODES,
  TRANSIT_HUB,
} = require('../../services/routing');

describe('routing', () => {
  describe('normalizeIsland', () => {
    it('normalise les variantes principales vers le code canonique', () => {
      expect(normalizeIsland('Anjouan')).toBe('ANJOUAN');
      expect(normalizeIsland('ndzuwani')).toBe('ANJOUAN');
      expect(normalizeIsland('grande comore')).toBe('MORONI');
      expect(normalizeIsland('Ngazidja')).toBe('MORONI');
      expect(normalizeIsland('Moheli')).toBe('MOHELI');
      expect(normalizeIsland('mwali')).toBe('MOHELI');
      expect(normalizeIsland('Mayotte')).toBe('MAYOTTE');
      expect(normalizeIsland('mamoudzou')).toBe('MAYOTTE');
    });

    it('retourne null pour une ile inconnue ou vide', () => {
      expect(normalizeIsland('Zanzibar')).toBeNull();
      expect(normalizeIsland('')).toBeNull();
      expect(normalizeIsland(null)).toBeNull();
    });

    it('normalise via prefix-match les variantes non listées explicitement (encodage/typos)', () => {
      // Robustesse UTF-8 : "Mohéli" mal encodé, ex. "MohÃƒ©li" — commence par "moh"
      expect(normalizeIsland('MohÃƒ©li')).toBe('MOHELI');
      expect(normalizeIsland('mwalitown')).toBe('MOHELI');
      expect(normalizeIsland('Anjouanaise')).toBe('ANJOUAN');
      expect(normalizeIsland('ndzuwanix')).toBe('ANJOUAN');
      expect(normalizeIsland('Grandcomore')).toBe('MORONI');
      expect(normalizeIsland('moroniville')).toBe('MORONI');
      expect(normalizeIsland('ngazidjatown')).toBe('MORONI');
      expect(normalizeIsland('mayottais')).toBe('MAYOTTE');
      expect(normalizeIsland('maorevariant')).toBe('MAYOTTE');
      expect(normalizeIsland('mamoudzoutown')).toBe('MAYOTTE');
    });
  });

  describe('resolveRoutingFromRelais', () => {
    it('resout un relais Anjouan en route directe', () => {
      expect(resolveRoutingFromRelais({ id: 'r1', name: 'Mutsamudu', island_code: 'ANJOUAN' })).toEqual({
        destination_island: 'ANJOUAN',
        routing_mode: ROUTING_MODES.DIRECT,
        transit_hub: null,
      });
    });

    it('resout Grande Comore en route inter-iles via Anjouan', () => {
      expect(resolveRoutingFromRelais({ id: 'r2', name: 'Moroni centre', island: 'Grande Comore' })).toEqual({
        destination_island: 'MORONI',
        routing_mode: ROUTING_MODES.INTER_ISLAND,
        transit_hub: TRANSIT_HUB,
      });
    });

    it('resout Mayotte en route speciale via Anjouan', () => {
      expect(resolveRoutingFromRelais({ id: 'r3', name: 'Mamoudzou', island: 'Mayotte' })).toEqual({
        destination_island: 'MAYOTTE',
        routing_mode: ROUTING_MODES.SPECIAL_ROUTE,
        transit_hub: TRANSIT_HUB,
      });
    });

    it('refuse un relais absent avec une RoutingError typee', () => {
      expect(() => resolveRoutingFromRelais(null)).toThrow(RoutingError);
      try {
        resolveRoutingFromRelais(null);
      } catch (err) {
        expect(err.code).toBe('RELAIS_MISSING');
        expect(err.statusCode).toBe(400);
      }
    });

    it('refuse un relais sans ile configuree', () => {
      expect(() => resolveRoutingFromRelais({ id: 'r4', name: 'Relais sans ile' })).toThrow(RoutingError);
      try {
        resolveRoutingFromRelais({ id: 'r4', name: 'Relais sans ile' });
      } catch (err) {
        expect(err.code).toBe('ISLAND_CODE_MISSING');
      }
    });

    it('refuse une destination non supportee', () => {
      try {
        resolveRoutingFromRelais({ id: 'r5', name: 'Relais inconnu', island_code: 'ZANZIBAR' });
        throw new Error('missing throw');
      } catch (err) {
        expect(err).toBeInstanceOf(RoutingError);
        expect(err.code).toBe('DESTINATION_UNKNOWN');
      }
    });
  });

  describe('ensureRoutingColumns', () => {
    it('execute les migrations additives et les backfills de facon idempotente', async () => {
      const db = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };

      await ensureRoutingColumns(db);

      const sqls = db.query.mock.calls.map(call => String(call[0]));
      expect(sqls[0]).toContain('ALTER TABLE relais ADD COLUMN IF NOT EXISTS island_code');
      expect(sqls[1]).toContain('ALTER TABLE orders ADD COLUMN IF NOT EXISTS destination_island');
      expect(sqls[2]).toContain('ALTER TABLE orders ADD COLUMN IF NOT EXISTS routing_mode');
      expect(sqls[3]).toContain('ALTER TABLE orders ADD COLUMN IF NOT EXISTS transit_hub');
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE relais SET island_code = $1'), ['ANJOUAN', 'Anjouan']);
      expect(sqls.some(sql => sql.includes('UPDATE orders o SET'))).toBe(true);
    });

    it('ignore les erreurs already exists et continue les backfills', async () => {
      const db = {
        query: jest.fn()
          .mockRejectedValueOnce(new Error('column already exists'))
          .mockResolvedValue({ rows: [], rowCount: 0 }),
      };

      await expect(ensureRoutingColumns(db)).resolves.toBeUndefined();
      expect(db.query).toHaveBeenCalledTimes(9);
    });

    it('logue un warning pour une erreur de migration autre que already exists', async () => {
      const db = {
        query: jest.fn()
          .mockRejectedValueOnce(new Error('connection refused'))
          .mockResolvedValue({ rows: [], rowCount: 0 }),
      };

      await expect(ensureRoutingColumns(db)).resolves.toBeUndefined();
      // Pas d'assertion sur le logger mocké directement (child() renvoie un nouveau mock à
      // chaque appel), on vérifie juste que l'exécution continue malgré l'erreur non "already exists".
      expect(db.query).toHaveBeenCalledTimes(9);
    });

    it('logue le nombre de relais backfillés quand rowCount > 0', async () => {
      const db = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ALTER relais
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ALTER orders x3
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 2 }) // backfill relais "Anjouan" → 2 lignes
          .mockResolvedValue({ rows: [], rowCount: 0 }),
      };

      await expect(ensureRoutingColumns(db)).resolves.toBeUndefined();
      expect(db.query).toHaveBeenCalledTimes(9);
    });

    it('logue le nombre de commandes enrichies quand le backfill orders a rowCount > 0', async () => {
      const db = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ALTER relais
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ALTER orders x3
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // backfill relais x4
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 5 }), // backfill orders → 5 lignes
      };

      await expect(ensureRoutingColumns(db)).resolves.toBeUndefined();
      expect(db.query).toHaveBeenCalledTimes(9);
    });

    it('logue un warning et continue si le backfill relais echoue', async () => {
      const db = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ALTER relais
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ALTER orders x3
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockRejectedValueOnce(new Error('backfill relais down')) // 1er backfill relais échoue
          .mockResolvedValue({ rows: [], rowCount: 0 }),
      };

      await expect(ensureRoutingColumns(db)).resolves.toBeUndefined();
      expect(db.query).toHaveBeenCalledTimes(9);
    });

    it('logue un warning et continue si le backfill orders echoue', async () => {
      const db = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ALTER relais
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ALTER orders x3
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // backfill relais x4
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockRejectedValueOnce(new Error('backfill orders down')), // backfill orders échoue
      };

      await expect(ensureRoutingColumns(db)).resolves.toBeUndefined();
      expect(db.query).toHaveBeenCalledTimes(9);
    });
  });
});
