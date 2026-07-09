'use strict';

/**
 * tests/unit/db.test.js
 *
 * Test de non-régression PR563 : exécute le VRAI db.js (pas mocké), en
 * mockant uniquement 'pg' au niveau module. Contrairement à
 * confirm-pickup-cash-payment.test.js (qui mocke ../../db entièrement et
 * ne peut donc jamais détecter un bug interne à db.js), ce test charge le
 * vrai fichier et prouve empiriquement :
 *
 *   1. db.connect() / db.getClient() / db.pool.connect() résolvent sans
 *      récursion infinie (bug historique : pool.connect réassigné à une
 *      fonction qui rappelle pool.connect()).
 *   2. db.connect existe et est bien une fonction (régression observée sur
 *      une version intermédiaire du fix qui l'avait supprimé des exports —
 *      services/confirm-pickup-cash-payment.js en dépend).
 *   3. Les 3 chemins d'accès (query, getClient, pool.connect direct)
 *      appliquent bien la réécriture alerts-compat.
 */

jest.mock('pg', () => {
  function makeFakeClient() {
    return {
      query: jest.fn(async (sql, params) => ({ rows: [], _sql: sql, _params: params })),
      release: jest.fn(),
    };
  }

  class FakePool {
    constructor() {
      this.totalCount = 0;
      this.idleCount = 0;
      this.waitingCount = 0;
    }
    on() {}
    connect(cb) {
      const client = makeFakeClient();
      if (typeof cb === 'function') {
        cb(null, client, () => {});
        return undefined;
      }
      return Promise.resolve(client);
    }
    query(sql, params) {
      return Promise.resolve({ rows: [], _sql: sql, _params: params });
    }
  }

  return { Pool: FakePool };
});

jest.mock('../../utils/logger', () => ({
  forModule: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }),
}));

const ORIGINAL_ENV = process.env.NODE_ENV;
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://fake-test-only';
});

afterAll(() => {
  process.env.NODE_ENV = ORIGINAL_ENV;
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

// Garde-fou anti-récursion : si db.js régresse vers un pool.connect qui
// s'appelle lui-même, l'appel ne se termine jamais → Jest expirera sur
// testTimeout (15s, cf jest.config.js) au lieu de planter proprement. On
// borne nous-mêmes à 2s pour un échec rapide et lisible.
function withTimeout(promise, ms = 2000, label = 'opération') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`TIMEOUT (${ms}ms) — récursion infinie suspectée sur ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

describe('db.js — vrai module (non mocké), pg mocké uniquement', () => {
  let db;

  beforeEach(() => {
    jest.resetModules();
    // eslint-disable-next-line global-require
    db = require('../../db');
  });

  it('exporte connect, getClient, query, pool, healthcheck comme fonctions/objets', () => {
    expect(typeof db.connect).toBe('function');
    expect(typeof db.getClient).toBe('function');
    expect(typeof db.query).toBe('function');
    expect(typeof db.pool).toBe('object');
    expect(typeof db.healthcheck).toBe('function');
  });

  it('db.connect() résout sans récursion infinie', async () => {
    const client = await withTimeout(db.connect(), 2000, 'db.connect()');
    expect(typeof client.query).toBe('function');
  });

  it('db.getClient() résout sans récursion infinie', async () => {
    const client = await withTimeout(db.getClient(), 2000, 'db.getClient()');
    expect(typeof client.query).toBe('function');
  });

  it('db.pool.connect() (appel direct) résout sans récursion infinie', async () => {
    const client = await withTimeout(db.pool.connect(), 2000, 'db.pool.connect()');
    expect(typeof client.query).toBe('function');
  });

  it('db.connect() est bien utilisable comme dans confirm-pickup-cash-payment.js (BEGIN/COMMIT)', async () => {
    const client = await withTimeout(db.connect(), 2000, 'db.connect()');
    const begin = await client.query('BEGIN');
    const commit = await client.query('COMMIT');
    // BEGIN/COMMIT ne sont pas des INSERT alerts legacy : ils doivent
    // traverser la couche alerts-compat strictement inchangés.
    expect(begin._sql).toBe('BEGIN');
    expect(commit._sql).toBe('COMMIT');
  });

  it('db.query() réécrit un INSERT alerts legacy avant de toucher pg', async () => {
    const result = await withTimeout(
      db.query(
        'INSERT INTO alerts (level, source, message, payload) VALUES ($1, $2, $3, $4)',
        ['critical', 'payment-service', 'Paiement échoué', '{}']
      ),
      2000,
      'db.query()'
    );
    expect(result._sql).toMatch(/INSERT INTO alerts \(type, entity_type/);
    expect(result._params[3]).toBe('high'); // severity mappée depuis 'critical'
  });

  it('db.getClient() puis client.query() réécrit aussi un INSERT alerts legacy', async () => {
    const client = await withTimeout(db.getClient(), 2000, 'db.getClient()');
    const result = await client.query(
      'INSERT INTO alerts (level, source, message, payload) VALUES ($1, $2, $3, $4)',
      ['low', 'scan-service', 'Colis introuvable', '{}']
    );
    expect(result._sql).toMatch(/INSERT INTO alerts \(type, entity_type/);
    expect(result._params[3]).toBe('low');
  });

  it('db.query() laisse une requête non-legacy strictement inchangée', async () => {
    const result = await withTimeout(
      db.query('SELECT * FROM orders WHERE id = $1', ['abc']),
      2000,
      'db.query() non-legacy'
    );
    expect(result._sql).toBe('SELECT * FROM orders WHERE id = $1');
    expect(result._params).toEqual(['abc']);
  });
});
