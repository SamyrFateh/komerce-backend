'use strict';

/**
 * tests/unit/db.test.js
 *
 * Test de non-régression HOTFIX V2.10 (rollback ciblé PR563) : exécute le
 * VRAI db.js (pas mocké), en mockant uniquement 'pg' au niveau module.
 * Contrairement à confirm-pickup-cash-payment.test.js (qui mocke ../../db
 * entièrement et ne peut donc jamais détecter un bug interne à db.js), ce
 * test charge le vrai fichier et prouve empiriquement :
 *
 *   1. db.connect() / db.getClient() / db.pool.connect() résolvent sans
 *      récursion infinie (bug historique PR563 : pool.connect réassigné à
 *      une fonction qui rappelle pool.connect()).
 *   2. db.connect existe et est bien une fonction (régression observée sur
 *      une version intermédiaire du fix qui l'avait supprimé des exports —
 *      services/confirm-pickup-cash-payment.js en dépend).
 *   3. db.pool.connect n'est plus remplacé par une couche custom
 *      (alerts-compat) : c'est la méthode native de node-pg (Pool.prototype
 *      .connect), directement — c'est précisément ce que ce hotfix retire.
 *   4. Le pool ne se sature pas sur des cycles getClient/release répétés,
 *      et BEGIN/ROLLBACK/release rendent bien le client au pool.
 *
 * Les tests de réécriture alerts (INSERT legacy → schéma réel) ont été
 * retirés d'ici : ce mécanisme est retiré de db.js par ce hotfix. La
 * couche de compat utils/alerts-compat.js (et ses tests dédiés
 * verify-rewrite.test.js / alerts-compat.test.js) a depuis été archivée
 * (mission ALERTS_CONTRACT_RECOVERY, 2026-07-14) : plus aucun writer
 * runtime ne dépend du schéma legacy — voir utils/alerts.js et
 * docs/ALERTS_CONTRACT_RECOVERY_AUDIT.md.
 */

jest.mock('pg', () => {
  const MAX_CLIENTS = 20;

  class FakePool {
    constructor() {
      this.totalCount = 0; // clients actuellement prêtés (non release())
      this.idleCount = 0;
      this.waitingCount = 0;
      this._inTransaction = new WeakSet();
    }
    on() {}
    connect(cb) {
      if (this.totalCount >= MAX_CLIENTS) {
        const err = new Error('pool saturé (simulation) : trop de clients non release()');
        if (typeof cb === 'function') return cb(err);
        return Promise.reject(err);
      }
      this.totalCount += 1;
      const pool = this;
      const client = {
        query: jest.fn(async (sql, params) => {
          if (sql === 'BEGIN') pool._inTransaction.add(client);
          if (sql === 'ROLLBACK' || sql === 'COMMIT') pool._inTransaction.delete(client);
          return { rows: [], _sql: sql, _params: params };
        }),
        release: jest.fn(() => {
          pool.totalCount -= 1;
        }),
      };
      if (typeof cb === 'function') {
        cb(null, client, client.release);
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
    expect(begin._sql).toBe('BEGIN');
    expect(commit._sql).toBe('COMMIT');
  });

  it('db.query() laisse toute requête strictement inchangée (plus de réécriture alerts)', async () => {
    const result = await withTimeout(
      db.query(
        'INSERT INTO alerts (level, source, message, payload) VALUES ($1, $2, $3, $4)',
        ['critical', 'payment-service', 'Paiement échoué', '{}']
      ),
      2000,
      'db.query()'
    );
    // HOTFIX V2.10 : db.js ne réécrit plus rien — la requête legacy part
    // telle quelle vers pg (la vraie correction passera par un helper
    // métier createAlert(), pas par un monkey-patch dans db.js).
    expect(result._sql).toBe('INSERT INTO alerts (level, source, message, payload) VALUES ($1, $2, $3, $4)');
    expect(result._params).toEqual(['critical', 'payment-service', 'Paiement échoué', '{}']);
  });

  it("db.pool.connect n'est pas remplacé par une couche custom (alerts-compat retirée)", () => {
    // Avant le hotfix, pool.connect était réassigné à patchedConnect (une
    // closure définie dans db.js). On vérifie ici qu'il s'agit bien de la
    // méthode native du prototype FakePool (donc, en production, du
    // prototype pg.Pool), et non d'une fonction wrapper créée par db.js.
    const Client = require('pg').Pool;
    expect(db.pool.connect).toBe(Client.prototype.connect);
  });

  it('20 cycles getClient()/release() successifs ne saturent pas le pool', async () => {
    for (let i = 0; i < 20; i += 1) {
      const client = await withTimeout(db.getClient(), 2000, `getClient() #${i}`);
      expect(typeof client.query).toBe('function');
      client.release();
    }
    expect(db.pool.totalCount).toBe(0);
  });

  it('BEGIN/ROLLBACK puis release() remet bien le client au pool', async () => {
    const client = await withTimeout(db.getClient(), 2000, 'getClient()');
    expect(db.pool.totalCount).toBe(1);
    await client.query('BEGIN');
    await client.query('ROLLBACK');
    client.release();
    expect(db.pool.totalCount).toBe(0);

    // Le client suivant doit pouvoir être obtenu sans blocage : preuve que
    // le pool n'est pas resté marqué occupé après le ROLLBACK.
    const next = await withTimeout(db.getClient(), 2000, 'getClient() après rollback');
    expect(typeof next.query).toBe('function');
    next.release();
  });
});
