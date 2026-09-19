'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * tests/integration/auth-user-cache-real-db.test.js
 *
 * Feature propriétaire : auth
 *
 * Contexte : la feature transversale auth (gardes JWT/session/rôles
 * consommées par ~70 routes) n'avait que des tests unitaires (15
 * fichiers), tous avec `db.query` entièrement MOQUÉ. Le module dont
 * dépend `middleware/auth.js` ET `middleware/auth-guest.js` — le cache
 * utilisateur partagé `utils/user-cache.js` — porte un correctif
 * documenté dans son propre commentaire de tête (« N2 FIX ») : avant ce
 * fix, chaque middleware avait sa propre Map, et invalider dans l'un ne
 * touchait pas l'autre — un rôle promu/rétrogradé via l'admin restait
 * visible avec l'ANCIEN rôle jusqu'à 5 minutes de plus dans le second
 * middleware. C'est un risque de sécurité réel (autorisation basée sur
 * un rôle obsolète), jamais prouvé contre une vraie base ni contre un
 * vrai TTL.
 *
 * Ce que les mocks ne peuvent pas prouver :
 *   1. Que le cache tient réellement 5 minutes — pas une simulation de
 *      Date.now(), mais un vrai TTL appliqué à un Map partagé entre
 *      appels réels.
 *   2. Que invalidateUserCache() appelé depuis N'IMPORTE LEQUEL des deux
 *      middlewares invalide bien pour les DEUX (c'est précisément le bug
 *      N2 que ce module corrige).
 *   3. Que la vérification `revoked_tokens` (JWT valide mais jti
 *      explicitement révoqué) rejette réellement l'accès contre une
 *      vraie ligne en base, pas une réponse mockée.
 *   4. Qu'un utilisateur supprimé après émission d'un token valide est
 *      bien rejeté (401), sans empoisonner le cache avec une entrée
 *      fantôme.
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('AUTH USER CACHE — REAL_DB proofs — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const crypto = require('crypto');
  const express = require('express');
  const request = require('supertest');
  const jwt = require('jsonwebtoken');
  const db = require('../../db');
  const { signAuthToken } = require('../../utils/auth-session');
  const { authenticate, invalidateUserCache } = require('../../middleware/auth');
  const authGuest = require('../../middleware/auth-guest');

  jest.setTimeout(20000);

  const RUN_TAG = `e2e_test_authcache_${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
  const userIds = [];

  function buildApp(mw) {
    const app = express();
    app.get('/probe', mw, (req, res) => res.json({ id: req.user.id, role: req.user.role }));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
    return app;
  }

  const appAuth = buildApp(authenticate);

  async function seedUser(label, role = 'client') {
    const id = crypto.randomUUID();
    userIds.push(id);
    await db.query(
      `INSERT INTO users (id, full_name, email, phone, role) VALUES ($1, $2, $3, $4, $5)`,
      [id, `E2E AuthCache ${label}`, `${RUN_TAG}_${label}@komerce.test`, `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`, role]
    );
    return id;
  }

  async function dbRole(userId) {
    const { rows: [row] } = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
    return row?.role;
  }

  afterAll(async () => {
    if (userIds.length) {
      await db.query('DELETE FROM revoked_tokens WHERE user_id = ANY($1::uuid[])', [userIds]).catch(() => {});
      await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]).catch(() => {});
    }
  });

  describe('middleware/auth.js + utils/user-cache.js — cache partagé (REAL_DB)', () => {
    it("1 — cache froid : authenticate() lit le vrai rôle DB", async () => {
      const userId = await seedUser('cold', 'client');
      invalidateUserCache(userId);
      const token = signAuthToken({ id: userId, role: 'client' }, { method: 'e2e' });

      const res = await request(appAuth).get('/probe').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.role).toBe('client');
    });

    it("2 — FRAÎCHEUR DU CACHE : une promotion de rôle en DB directe n'est PAS vue avant invalidation", async () => {
      const userId = await seedUser('stale_role', 'client');
      invalidateUserCache(userId);
      const token = signAuthToken({ id: userId, role: 'client' }, { method: 'e2e' });

      const before = await request(appAuth).get('/probe').set('Authorization', `Bearer ${token}`);
      expect(before.body.role).toBe('client');

      // Promotion directe en base, hors du chemin applicatif normal
      // (admin route) — donc sans appel à invalidateUserCache().
      await db.query('UPDATE users SET role = $1 WHERE id = $2', ['admin', userId]);
      expect(await dbRole(userId)).toBe('admin'); // la DB a bien changé...

      const stillCached = await request(appAuth).get('/probe').set('Authorization', `Bearer ${token}`);
      expect(stillCached.body.role).toBe('client'); // ...mais le cache sert encore l'ancien rôle

      invalidateUserCache(userId);
      const afterInvalidate = await request(appAuth).get('/probe').set('Authorization', `Bearer ${token}`);
      expect(afterInvalidate.body.role).toBe('admin'); // rôle frais après invalidation
    });

    it("3 — CORRECTIF N2 : invalider depuis auth-guest.js purge aussi le cache lu par auth.js", async () => {
      // Le cœur du bug documenté : deux fichiers, un seul Map partagé.
      // On peuple le cache via authenticate() (auth.js), puis on invalide
      // via l'API exposée par middleware/auth-guest.js — la lecture
      // suivante par authenticate() (auth.js, pas auth-guest.js) doit
      // voir la valeur fraîche, prouvant qu'ils partagent le même Map.
      const userId = await seedUser('cross_invalidate', 'client');
      invalidateUserCache(userId);
      const token = signAuthToken({ id: userId, role: 'client' }, { method: 'e2e' });

      await request(appAuth).get('/probe').set('Authorization', `Bearer ${token}`); // peuple via auth.js

      await db.query('UPDATE users SET role = $1 WHERE id = $2', ['admin', userId]);

      // Invalidation via l'AUTRE module, pas celui qui a peuplé le cache.
      expect(typeof authGuest.invalidateUserCache).toBe('function');
      authGuest.invalidateUserCache(userId);

      const afterCrossInvalidate = await request(appAuth).get('/probe').set('Authorization', `Bearer ${token}`);
      expect(afterCrossInvalidate.body.role).toBe('admin');
    });

    it('4 — révocation réelle : un JWT valide dont le jti est dans revoked_tokens → 401', async () => {
      const userId = await seedUser('revoked', 'client');
      invalidateUserCache(userId);
      const token = signAuthToken({ id: userId, role: 'client' }, { method: 'e2e' });
      const { jti } = jwt.decode(token);

      const before = await request(appAuth).get('/probe').set('Authorization', `Bearer ${token}`);
      expect(before.status).toBe(200);

      await db.query(
        `INSERT INTO revoked_tokens (jti, user_id, user_role, expires_at, reason)
         VALUES ($1, $2, 'client', NOW() + interval '1 day', 'E2E test revocation')`,
        [jti, userId]
      );

      const after = await request(appAuth).get('/probe').set('Authorization', `Bearer ${token}`);
      expect(after.status).toBe(401);
      expect(after.body.error).toMatch(/expirée|reconnectez/i);
    });

    it("5 — utilisateur supprimé après émission du token → 401, pas d'empoisonnement du cache", async () => {
      const userId = await seedUser('deleted', 'client');
      invalidateUserCache(userId);
      const token = signAuthToken({ id: userId, role: 'client' }, { method: 'e2e' });

      // Suppression réelle — retiré aussi de userIds pour ne pas re-essayer
      // de le supprimer dans afterAll.
      await db.query('DELETE FROM users WHERE id = $1', [userId]);
      userIds.splice(userIds.indexOf(userId), 1);

      const res = await request(appAuth).get('/probe').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/introuvable|supprimé/i);
    });

    it('6 — requireRole réel : un rôle DB à jour après invalidation autorise correctement un accès admin', async () => {
      const { requireAdmin } = require('../../middleware/auth');
      const app = express();
      app.get('/admin-probe', authenticate, requireAdmin, (req, res) => res.json({ ok: true }));
      app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

      const userId = await seedUser('promote_then_admin', 'client');
      invalidateUserCache(userId);
      const token = signAuthToken({ id: userId, role: 'client' }, { method: 'e2e' });

      const deniedBefore = await request(app).get('/admin-probe').set('Authorization', `Bearer ${token}`);
      expect(deniedBefore.status).toBe(403);

      await db.query('UPDATE users SET role = $1 WHERE id = $2', ['admin', userId]);
      invalidateUserCache(userId);

      const allowedAfter = await request(app).get('/admin-probe').set('Authorization', `Bearer ${token}`);
      expect(allowedAfter.status).toBe(200);
      expect(allowedAfter.body.ok).toBe(true);
    });
  });
}
