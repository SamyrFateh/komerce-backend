/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : bootstrap/startup-migrations.js (Lot 0)
 *
 * `bootstrap/startup-migrations.js` était absent de `collectCoverageFrom`
 * (angle mort structurel, Lot 0). 644 lignes, ~32 migrations DDL séquentielles
 * exécutées au démarrage du serveur.
 *
 * On ne teste PAS le contenu SQL exhaustif de chaque migration (32 blocs
 * quasi identiques, faible valeur) mais le COMPORTEMENT du runner :
 *  - fixAdminHash / fixMissingSchema / runAllSeeds sont FATALES (pas de
 *    try/catch) — une erreur ici doit remonter, contrairement au reste.
 *  - les deux `db.query` de la ligne 152-153 (pending_at/confirmed_at) sont
 *    elles aussi HORS try/catch — donc fatales, seule exception dans le bloc
 *    des ~30 migrations "non-fatal" documentées.
 *  - chaque migration DDL est individuellement non-fatale : un échec ne doit
 *    JAMAIS empêcher les migrations suivantes de s'exécuter (c'est la seule
 *    garantie de robustesse du fichier).
 *  - les branches conditionnelles réelles : migration 028 (env var
 *    TRANSITAIRE_PASSWORD), migration 052 (seed charges si table vide).
 *
 * Run : npx jest tests/unit/bootstrap-startup-migrations.test.js
 */

'use strict';

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('../../utils/logger', () => ({ child: () => mockLog }));

const mockMigration037 = jest.fn();
jest.mock('../../scripts/migration-037-fix-products', () => (...args) => mockMigration037(...args));

const mockMigration038 = jest.fn();
jest.mock('../../scripts/migration-038-replace-products', () => (...args) => mockMigration038(...args));

const mockMigration039 = jest.fn();
jest.mock('../../scripts/migration-039-french-descriptions', () => (...args) => mockMigration039(...args));

const mockRunPendingSafe = jest.fn();
jest.mock('../../scripts/run-migrations', () => ({
  runPendingSafe: (...args) => mockRunPendingSafe(...args),
}));

const mockBcryptHash = jest.fn();
jest.mock('bcryptjs', () => ({ hash: (...args) => mockBcryptHash(...args) }));

const { runStartupMigrations } = require('../../bootstrap/startup-migrations');

function makeDeps(overrides = {}) {
  return {
    db: { query: (...args) => mockDbQuery(...args) },
    fixAdminHash: jest.fn().mockResolvedValue(undefined),
    fixMissingSchema: jest.fn().mockResolvedValue(undefined),
    runAllSeeds: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('bootstrap/startup-migrations', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.TRANSITAIRE_PASSWORD;
    mockDbQuery.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('SELECT COUNT(*) as c FROM charges')) {
        return Promise.resolve({ rows: [{ c: '0' }] });
      }
      return Promise.resolve({ rowCount: 0, rows: [] });
    });
    mockMigration037.mockResolvedValue(undefined);
    mockMigration038.mockResolvedValue(undefined);
    mockMigration039.mockResolvedValue(undefined);
    mockRunPendingSafe.mockResolvedValue({ applied: [] });
    mockBcryptHash.mockResolvedValue('hashed-password');
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  // ── Étapes fatales initiales ────────────────────────────────────────────
  describe('fixAdminHash / fixMissingSchema / runAllSeeds — fatales, dans l’ordre', () => {
    test('les trois sont appelées dans l’ordre avant toute migration DDL', async () => {
      const deps = makeDeps();
      const callOrder = [];
      deps.fixAdminHash.mockImplementation(async () => { callOrder.push('fixAdminHash'); });
      deps.fixMissingSchema.mockImplementation(async () => { callOrder.push('fixMissingSchema'); });
      deps.runAllSeeds.mockImplementation(async () => { callOrder.push('runAllSeeds'); });
      mockDbQuery.mockImplementation(async (sql) => {
        callOrder.push('db.query');
        if (typeof sql === 'string' && sql.includes('SELECT COUNT(*) as c FROM charges')) {
          return { rows: [{ c: '0' }] };
        }
        return { rowCount: 0, rows: [] };
      });

      await runStartupMigrations(deps);

      expect(callOrder[0]).toBe('fixAdminHash');
      expect(callOrder[1]).toBe('fixMissingSchema');
      expect(callOrder[2]).toBe('runAllSeeds');
      expect(callOrder.slice(3)).toContain('db.query');
    });

    test('une erreur dans fixAdminHash remonte (fatale) et bloque toute migration', async () => {
      const deps = makeDeps({ fixAdminHash: jest.fn().mockRejectedValue(new Error('hash fix failed')) });
      await expect(runStartupMigrations(deps)).rejects.toThrow('hash fix failed');
      expect(deps.fixMissingSchema).not.toHaveBeenCalled();
      expect(deps.runAllSeeds).not.toHaveBeenCalled();
      expect(mockDbQuery).not.toHaveBeenCalled();
    });

    test('une erreur dans fixMissingSchema remonte (fatale)', async () => {
      const deps = makeDeps({ fixMissingSchema: jest.fn().mockRejectedValue(new Error('schema fix failed')) });
      await expect(runStartupMigrations(deps)).rejects.toThrow('schema fix failed');
      expect(deps.runAllSeeds).not.toHaveBeenCalled();
      expect(mockDbQuery).not.toHaveBeenCalled();
    });

    test('une erreur dans runAllSeeds remonte (fatale)', async () => {
      const deps = makeDeps({ runAllSeeds: jest.fn().mockRejectedValue(new Error('seeds failed')) });
      await expect(runStartupMigrations(deps)).rejects.toThrow('seeds failed');
      expect(mockDbQuery).not.toHaveBeenCalled();
    });
  });

  // ── pending_at / confirmed_at (lignes 152-153) : seules requêtes fatales du bloc migrations ──
  describe('colonnes pending_at / confirmed_at — hors try/catch, fatales', () => {
    test('une erreur sur ALTER TABLE orders ADD pending_at fait échouer runStartupMigrations', async () => {
      mockDbQuery.mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('ADD COLUMN IF NOT EXISTS pending_at')) {
          return Promise.reject(new Error('pending_at alter failed'));
        }
        if (typeof sql === 'string' && sql.includes('SELECT COUNT(*) as c FROM charges')) {
          return Promise.resolve({ rows: [{ c: '0' }] });
        }
        return Promise.resolve({ rowCount: 0, rows: [] });
      });
      const deps = makeDeps();
      await expect(runStartupMigrations(deps)).rejects.toThrow('pending_at alter failed');
      // La migration 052 (charges) et le runner final, exécutés après, ne doivent jamais tourner.
      expect(mockRunPendingSafe).not.toHaveBeenCalled();
    });

    test('une erreur sur confirmed_at fait aussi échouer (même comportement)', async () => {
      mockDbQuery.mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('ADD COLUMN IF NOT EXISTS confirmed_at')) {
          return Promise.reject(new Error('confirmed_at alter failed'));
        }
        if (typeof sql === 'string' && sql.includes('SELECT COUNT(*) as c FROM charges')) {
          return Promise.resolve({ rows: [{ c: '0' }] });
        }
        return Promise.resolve({ rowCount: 0, rows: [] });
      });
      const deps = makeDeps();
      await expect(runStartupMigrations(deps)).rejects.toThrow('confirmed_at alter failed');
    });

    test('en l’absence d’erreur, les deux colonnes sont bien migrées et loguées', async () => {
      const deps = makeDeps();
      await runStartupMigrations(deps);
      const queries = mockDbQuery.mock.calls.map(c => c[0]);
      expect(queries.some(q => typeof q === 'string' && q.includes('pending_at'))).toBe(true);
      expect(queries.some(q => typeof q === 'string' && q.includes('confirmed_at'))).toBe(true);
      expect(mockLog.info).toHaveBeenCalledWith(
        expect.stringMatching(/pending_at \+ confirmed_at columns ensured/)
      );
    });
  });

  // ── Résilience non-fatale des migrations DDL individuelles ──────────────
  describe('résilience — un échec de migration n’empêche jamais les suivantes', () => {
    test('un échec sur la toute première migration (Phase1) n’empêche pas les suivantes de tourner', async () => {
      let firstCall = true;
      mockDbQuery.mockImplementation((sql) => {
        if (firstCall) {
          firstCall = false;
          return Promise.reject(new Error('Phase1 boom'));
        }
        if (typeof sql === 'string' && sql.includes('SELECT COUNT(*) as c FROM charges')) {
          return Promise.resolve({ rows: [{ c: '0' }] });
        }
        return Promise.resolve({ rowCount: 0, rows: [] });
      });
      const deps = makeDeps();
      await runStartupMigrations(deps);

      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringMatching(/Phase1 migration \(non-fatal\)/)
      );
      // La suite (ex. migration 023 invoices) s'est bien exécutée malgré l'échec initial.
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringMatching(/Migration 023/));
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringMatching(/Migrations et seeds terminées/));
    });

    test('runStartupMigrations se résout normalement même si TOUTES les migrations non-fatales échouent', async () => {
      mockDbQuery.mockImplementation((sql) => {
        if (typeof sql === 'string' &&
            (sql.includes('ADD COLUMN IF NOT EXISTS pending_at') ||
             sql.includes('ADD COLUMN IF NOT EXISTS confirmed_at'))) {
          return Promise.resolve({ rowCount: 0, rows: [] }); // les deux seules requêtes fatales doivent réussir
        }
        return Promise.reject(new Error('db down'));
      });
      mockMigration037.mockRejectedValue(new Error('037 down'));
      mockMigration038.mockRejectedValue(new Error('038 down'));
      mockMigration039.mockRejectedValue(new Error('039 down'));
      mockRunPendingSafe.mockRejectedValue(new Error('runner down'));

      const deps = makeDeps();
      await expect(runStartupMigrations(deps)).resolves.toBeUndefined();
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringMatching(/Migrations et seeds terminées/));
      // Un warn par bloc non-fatal en échec (au moins un paquet significatif).
      expect(mockLog.warn.mock.calls.length).toBeGreaterThan(20);
    });
  });

  // ── Migration 028 — user transitaire, conditionnée par env var ──────────
  describe('migration 028 — seed utilisateur transitaire (TRANSITAIRE_PASSWORD)', () => {
    test('sans TRANSITAIRE_PASSWORD : skip, avertissement, pas de bcrypt ni INSERT', async () => {
      delete process.env.TRANSITAIRE_PASSWORD;
      const deps = makeDeps();
      await runStartupMigrations(deps);

      expect(mockBcryptHash).not.toHaveBeenCalled();
      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.stringMatching(/TRANSITAIRE_PASSWORD non défini/)
      );
      const queries = mockDbQuery.mock.calls.map(c => c[0]);
      expect(queries.some(q => typeof q === 'string' && q.includes('agent_transitaire'))).toBe(false);
    });

    test('avec TRANSITAIRE_PASSWORD : hash bcrypt puis INSERT ... ON CONFLICT avec le hash', async () => {
      process.env.TRANSITAIRE_PASSWORD = 'secret123';
      mockBcryptHash.mockResolvedValue('$2a$10$hashedvalue');
      const deps = makeDeps();
      await runStartupMigrations(deps);

      expect(mockBcryptHash).toHaveBeenCalledWith('secret123', 10);
      const transitCall = mockDbQuery.mock.calls.find(
        c => typeof c[0] === 'string' && c[0].includes('agent_transitaire')
      );
      expect(transitCall).toBeDefined();
      expect(transitCall[1]).toEqual(['$2a$10$hashedvalue']);
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringMatching(/Migration 028: transitaire user seeded/));
    });

    test('erreur bcrypt sur la migration 028 est non-fatale', async () => {
      process.env.TRANSITAIRE_PASSWORD = 'secret123';
      mockBcryptHash.mockRejectedValue(new Error('bcrypt failed'));
      const deps = makeDeps();
      await expect(runStartupMigrations(deps)).resolves.toBeUndefined();
      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringMatching(/Migration 028 \(non-fatal\)/)
      );
    });
  });

  // ── Migrations 037/038/039 — scripts externes ────────────────────────────
  describe('migrations 037/038/039 — scripts externes requis dynamiquement', () => {
    test('migration037 est appelée avec db, migration038 avec db, migration039 sans argument', async () => {
      const deps = makeDeps();
      await runStartupMigrations(deps);
      expect(mockMigration037).toHaveBeenCalledWith(deps.db);
      expect(mockMigration038).toHaveBeenCalledWith(deps.db);
      expect(mockMigration039).toHaveBeenCalledWith();
    });

    test('un échec de migration037 est non-fatal et n’empêche pas 038/039', async () => {
      mockMigration037.mockRejectedValue(new Error('037 crashed'));
      const deps = makeDeps();
      await runStartupMigrations(deps);
      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringMatching(/Migration 037 \(non-fatal\)/)
      );
      expect(mockMigration038).toHaveBeenCalled();
      expect(mockMigration039).toHaveBeenCalled();
    });
  });

  // ── Migration 052 — seed des charges (table vide uniquement) ────────────
  describe('migration 052 — seed des 5 charges par défaut', () => {
    test('table charges vide (count=0) : INSERT exécuté et loggé', async () => {
      mockDbQuery.mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('SELECT COUNT(*) as c FROM charges')) {
          return Promise.resolve({ rows: [{ c: '0' }] });
        }
        return Promise.resolve({ rowCount: 0, rows: [] });
      });
      const deps = makeDeps();
      await runStartupMigrations(deps);

      const insertCall = mockDbQuery.mock.calls.find(
        c => typeof c[0] === 'string' && c[0].includes('INSERT INTO charges')
      );
      expect(insertCall).toBeDefined();
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringMatching(/5 charges seeded with defaults/));
    });

    test('table charges déjà peuplée (count>0) : INSERT sauté, log "already seeded"', async () => {
      mockDbQuery.mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('SELECT COUNT(*) as c FROM charges')) {
          return Promise.resolve({ rows: [{ c: '5' }] });
        }
        return Promise.resolve({ rowCount: 0, rows: [] });
      });
      const deps = makeDeps();
      await runStartupMigrations(deps);

      const insertCall = mockDbQuery.mock.calls.find(
        c => typeof c[0] === 'string' && c[0].includes('INSERT INTO charges')
      );
      expect(insertCall).toBeUndefined();
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringMatching(/charges already seeded, skipping/));
    });

    test('erreur sur le SELECT COUNT charges est non-fatale', async () => {
      mockDbQuery.mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('SELECT COUNT(*) as c FROM charges')) {
          return Promise.reject(new Error('charges table missing'));
        }
        return Promise.resolve({ rowCount: 0, rows: [] });
      });
      const deps = makeDeps();
      await expect(runStartupMigrations(deps)).resolves.toBeUndefined();
      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringMatching(/Migration 052 \(non-fatal\)/)
      );
    });
  });

  // ── Runner de migrations fichier (migrations/NNN*.sql) ──────────────────
  describe('runner de migrations fichier (scripts/run-migrations)', () => {
    test('runPendingSafe est appelé en dernier ; applied[] non vide → loggé', async () => {
      mockRunPendingSafe.mockResolvedValue({ applied: ['090_foo.sql', '091_bar.sql'] });
      const deps = makeDeps();
      await runStartupMigrations(deps);
      expect(mockRunPendingSafe).toHaveBeenCalledTimes(1);
      expect(mockLog.info).toHaveBeenCalledWith(
        expect.objectContaining({ applied: ['090_foo.sql', '091_bar.sql'] }),
        expect.stringMatching(/migrations fichier appliquées/)
      );
    });

    test('applied[] vide → pas de log spécifique, mais pas d’erreur', async () => {
      mockRunPendingSafe.mockResolvedValue({ applied: [] });
      const deps = makeDeps();
      await expect(runStartupMigrations(deps)).resolves.toBeUndefined();
    });

    test('échec de runPendingSafe est non-fatal', async () => {
      mockRunPendingSafe.mockRejectedValue(new Error('runner crashed'));
      const deps = makeDeps();
      await expect(runStartupMigrations(deps)).resolves.toBeUndefined();
      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringMatching(/Runner migrations fichier \(non-fatal\)/)
      );
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringMatching(/Migrations et seeds terminées/));
    });
  });

  // ── Run complet nominal ──────────────────────────────────────────────────
  test('run nominal complet : toutes les étapes réussissent, log de fin émis', async () => {
    process.env.TRANSITAIRE_PASSWORD = 'secret123';
    const deps = makeDeps();
    await runStartupMigrations(deps);

    expect(deps.fixAdminHash).toHaveBeenCalledTimes(1);
    expect(deps.fixMissingSchema).toHaveBeenCalledTimes(1);
    expect(deps.runAllSeeds).toHaveBeenCalledTimes(1);
    expect(mockMigration037).toHaveBeenCalledTimes(1);
    expect(mockMigration038).toHaveBeenCalledTimes(1);
    expect(mockMigration039).toHaveBeenCalledTimes(1);
    expect(mockRunPendingSafe).toHaveBeenCalledTimes(1);
    expect(mockLog.error).not.toHaveBeenCalled(); // ce fichier n'utilise que warn/info, jamais error
    expect(mockLog.info).toHaveBeenLastCalledWith(expect.stringMatching(/Migrations et seeds terminées/));
  });
});
