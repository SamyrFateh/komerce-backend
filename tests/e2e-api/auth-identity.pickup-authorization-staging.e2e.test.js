'use strict';


/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * E2E-LOT7-PICKUP-AUTHORIZATION-STAGING
 *
 * Qualification métier du retrait exceptionnel sur PostgreSQL réel et routes
 * HTTP réellement exposées. Ce scénario traverse auth-identity et logistics,
 * mais l'ownership du fichier reste auth-identity : le cycle de vie de
 * l'autorisation du compte est le point d'entrée de la preuve.
 *
 * Invariants prouvés :
 *   - CRUD authentifié, versionné et immédiatement applicable ;
 *   - le relais ne reçoit jamais le nom attendu ;
 *   - contrôle visuel de pièce obligatoire ;
 *   - comparaison stricte après normalisation, compteur dédié et blocage ;
 *   - anti-fraude cross-relais ;
 *   - remise atomique, non rejouable, avec invalidation du code et des caches ;
 *   - audit minimal sans nom saisi/attendu ni donnée de pièce ;
 *   - notification déclenchée après la transaction et non bloquante.
 */

const mockNotifyText = jest.fn(() => new Promise(() => {}));

jest.mock('../../services/notifications/notification-service', () => ({
  notifyText: (...args) => mockNotifyText(...args),
}));

const request = require('supertest');
const express = require('express');
const { signAuthToken } = require('../../utils/auth-session');

const {
  describeE2E,
  createCleanup,
  tag,
  uuid,
} = require('../helpers/e2eDbKit');

const {
  generateAndStoreSecret,
  cacheCodeForReveal,
  issuePrintToken,
} = require('../../services/pickup-secret-service');

jest.setTimeout(60000);

describeE2E(
  'E2E-LOT7 — autorisation nominative et remise exceptionnelle [staging éphémère]',
  ({ db }) => {
    const buyerId = uuid();
    const relaisId = uuid();
    const foreignRelaisId = uuid();
    const agentId = uuid();
    const foreignAgentId = uuid();

    const successOrderId = uuid();
    const blockedOrderId = uuid();
    const revokeOrderId = uuid();

    const initialGiven = 'Éléonore';
    const initialFamily = 'Bacar';
    const currentGiven = 'Fatima Amina';
    const currentFamily = 'Said';

    let cleanup;
    let app;
    let buyerToken;
    let agentToken;
    let foreignAgentToken;
    let currentVersion;

    function auth(token) {
      return { Authorization: `Bearer ${token}` };
    }

    async function seedOrder(orderId, label) {
      await db.query(
        `INSERT INTO orders
           (id, reference, user_id, relais_id, market_id, total_kmf,
            payment_mode, payment_status, status)
         VALUES ($1, $2, $3, $4, (SELECT market_id FROM relais WHERE id = $4), 25000, 'cash_relais', 'paid', 'available')`,
        [orderId, `E2E-L7-${tag(label)}`, buyerId, relaisId]
      );
    }

    function putAuthorization(givenNames, familyName) {
      return request(app)
        .put('/api/auth/me/pickup-authorization')
        .set(auth(buyerToken))
        .send({ given_names: givenNames, family_name: familyName });
    }

    function getAuthorization() {
      return request(app)
        .get('/api/auth/me/pickup-authorization')
        .set(auth(buyerToken));
    }

    function availability(orderId, token = agentToken) {
      return request(app)
        .get(`/api/pickup/exceptional-pickup/${orderId}`)
        .set(auth(token));
    }

    function collect(orderId, {
      givenNames = currentGiven,
      familyName = currentFamily,
      documentChecked = true,
      token = agentToken,
    } = {}) {
      return request(app)
        .post(`/api/pickup/exceptional-pickup/${orderId}/collect`)
        .set(auth(token))
        .send({
          given_names: givenNames,
          family_name: familyName,
          document_checked: documentChecked,
        });
    }

    beforeAll(async () => {
      cleanup = createCleanup(db);

      // LIFO : parents enregistrés avant enfants.
      cleanup.trackSql(
        'DELETE FROM relais WHERE id IN ($1, $2)',
        [relaisId, foreignRelaisId]
      );
      cleanup.trackSql(
        'DELETE FROM users WHERE id IN ($1, $2, $3)',
        [buyerId, agentId, foreignAgentId]
      );
      cleanup.trackSql(
        'DELETE FROM user_pickup_authorizations WHERE user_id = $1',
        [buyerId]
      );
      cleanup.trackSql(
        'DELETE FROM orders WHERE id IN ($1, $2, $3)',
        [successOrderId, blockedOrderId, revokeOrderId]
      );
      cleanup.trackSql(
        `DELETE FROM alerts
          WHERE entity_id IN ($1, $2, $3, $4)`,
        [buyerId, successOrderId, blockedOrderId, revokeOrderId]
      );

      await db.query(
        `INSERT INTO relais (id, name, agent_name, phone, address, market_id)
         VALUES
           ($1, 'E2E Relais Lot 7', 'Agent Lot 7', $3, 'Moroni Test', (SELECT id FROM markets WHERE code = 'KM')),
           ($2, 'E2E Relais Étranger Lot 7', 'Agent Étranger', $4, 'Mutsamudu Test', (SELECT id FROM markets WHERE code = 'KM'))`,
        [
          relaisId,
          foreignRelaisId,
          `+2694${Math.floor(Math.random() * 9e6 + 1e6)}`,
          `+2694${Math.floor(Math.random() * 9e6 + 1e6)}`,
        ]
      );

      await db.query(
        `INSERT INTO users (id, full_name, email, phone, role)
         VALUES ($1, 'Acheteur Lot 7', $2, $3, 'client')`,
        [
          buyerId,
          `${tag('buyer-l7')}@komerce.test`,
          `+2695${Math.floor(Math.random() * 9e6 + 1e6)}`,
        ]
      );

      await db.query(
        `INSERT INTO users (id, full_name, email, phone, role, relais_id)
         VALUES
           ($1, 'Agent Relais Lot 7', $3, $5, 'agent_relais', $7),
           ($2, 'Agent Étranger Lot 7', $4, $6, 'agent_relais', $8)`,
        [
          agentId,
          foreignAgentId,
          `${tag('agent-l7')}@komerce.test`,
          `${tag('foreign-agent-l7')}@komerce.test`,
          `+2696${Math.floor(Math.random() * 9e6 + 1e6)}`,
          `+2696${Math.floor(Math.random() * 9e6 + 1e6)}`,
          relaisId,
          foreignRelaisId,
        ]
      );

      await seedOrder(successOrderId, 'success');
      await seedOrder(blockedOrderId, 'blocked');
      await seedOrder(revokeOrderId, 'revoke');

      buyerToken = signAuthToken(
        { id: buyerId, role: 'client' },
        { method: 'e2e' }
      );
      agentToken = signAuthToken(
        { id: agentId, role: 'agent_relais' },
        { method: 'e2e' }
      );
      foreignAgentToken = signAuthToken(
        { id: foreignAgentId, role: 'agent_relais' },
        { method: 'e2e' }
      );

      app = express();
      app.use(require('cookie-parser')());
      app.use(express.json());
      app.use('/api/auth', require('../../routes/auth'));
      app.use('/api/pickup', require('../../routes/pickup-secret'));
      app.use((err, _req, res, _next) => {
        res.status(err.status || 500).json({
          error: err.message || 'Erreur interne',
          ...(err.code ? { code: err.code } : {}),
        });
      });
    });

    afterAll(async () => {
      if (cleanup) await cleanup.run();
    });

    it('1 — CRUD HTTP : création, remplacement versionné et audit sans nom', async () => {
      const none = await getAuthorization();
      expect(none.status).toBe(200);
      expect(none.body).toEqual({ status: 'NONE' });

      const created = await putAuthorization(`  ${initialGiven}  `, initialFamily);
      expect(created.status).toBe(200);
      expect(created.body).toEqual(expect.objectContaining({
        status: 'ACTIVE',
        given_names: initialGiven,
        family_name: initialFamily,
        version: 1,
      }));

      const replaced = await putAuthorization(currentGiven, currentFamily);
      expect(replaced.status).toBe(200);
      expect(replaced.body).toEqual(expect.objectContaining({
        status: 'ACTIVE',
        given_names: currentGiven,
        family_name: currentFamily,
        version: 2,
      }));
      currentVersion = replaced.body.version;

      const active = await getAuthorization();
      expect(active.status).toBe(200);
      expect(active.body).toEqual(expect.objectContaining({
        status: 'ACTIVE',
        given_names: currentGiven,
        family_name: currentFamily,
        version: currentVersion,
      }));

      const { rows: [stored] } = await db.query(
        `SELECT normalized_given_names, normalized_family_name, version, is_active
         FROM user_pickup_authorizations
         WHERE user_id = $1`,
        [buyerId]
      );
      expect(stored).toEqual({
        normalized_given_names: 'fatima amina',
        normalized_family_name: 'said',
        version: currentVersion,
        is_active: true,
      });

      const { rows: auditRows } = await db.query(
        `SELECT type, title, description
         FROM alerts
         WHERE entity_id = $1
           AND type IN ('PICKUP_AUTHORIZATION_CREATED', 'PICKUP_AUTHORIZATION_UPDATED')
         ORDER BY created_at`,
        [buyerId]
      );
      expect(auditRows.map((row) => row.type)).toEqual([
        'PICKUP_AUTHORIZATION_CREATED',
        'PICKUP_AUTHORIZATION_UPDATED',
      ]);
      const auditText = JSON.stringify(auditRows);
      expect(auditText).not.toMatch(/Éléonore|Bacar|Fatima|Amina|Said/i);
    });

    it('2 — disponibilité aveugle, contrôle de pièce et anti-fraude cross-relais', async () => {
      const ownAvailability = await availability(successOrderId);
      expect(ownAvailability.status).toBe(200);
      expect(ownAvailability.body).toEqual({ available: true });
      expect(JSON.stringify(ownAvailability.body))
        .not.toMatch(/Fatima|Amina|Said|Éléonore|Bacar/i);

      const foreignAvailability = await availability(successOrderId, foreignAgentToken);
      expect(foreignAvailability.status).toBe(200);
      expect(foreignAvailability.body).toEqual({
        available: false,
        reason: 'CROSS_RELAIS',
      });

      const foreignCollect = await collect(successOrderId, {
        token: foreignAgentToken,
      });
      expect(foreignCollect.status).toBe(403);
      expect(foreignCollect.body.code).toBe('CROSS_RELAIS_BLOCKED');

      const unchecked = await collect(successOrderId, {
        documentChecked: false,
      });
      expect(unchecked.status).toBe(400);
      expect(JSON.stringify(unchecked.body)).not.toMatch(/Fatima|Amina|Said/i);
    });

    it('3 — autorisation courante, remise atomique, invalidation et notification non bloquante', async () => {
      const generated = await generateAndStoreSecret({
        orderId: successOrderId,
        relaisId,
        channel: 'cash_relais',
      });
      await cacheCodeForReveal(successOrderId, generated.code);
      await issuePrintToken({
        orderId: successOrderId,
        code: generated.code,
        payerName: 'Acheteur Lot 7',
      });

      // La commande existait avant le remplacement : l'ancien nom ne doit
      // plus gagner, preuve qu'aucun snapshot par commande n'est utilisé.
      const staleName = await collect(successOrderId, {
        givenNames: initialGiven,
        familyName: initialFamily,
      });
      expect(staleName.status).toBe(401);
      expect(staleName.body.code).toBe('NAME_MISMATCH');
      expect(JSON.stringify(staleName.body))
        .not.toMatch(/Fatima|Amina|Said|Éléonore|Bacar/i);

      const success = await collect(successOrderId);
      expect(success.status).toBe(200);
      expect(success.body.success).toBe(true);

      // notifyText retourne volontairement une Promise non résolue : la
      // réponse HTTP prouve que la notification n'est pas attendue dans la
      // transaction ni sur le chemin critique.
      expect(mockNotifyText).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('a été remis'),
        'exceptional_pickup_collected',
        successOrderId,
      );

      const { rows: [order] } = await db.query(
        `SELECT status, pickup_collected_via,
                pickup_secret_hash, pickup_secret_salt,
                pickup_secret_last4, pickup_secret_expires_at,
                pickup_secret_attempts, pickup_secret_blocked_until,
                exceptional_pickup_attempts,
                exceptional_pickup_blocked_until
         FROM orders WHERE id = $1`,
        [successOrderId]
      );
      expect(order.status).toBe('collected');
      expect(order.pickup_collected_via).toBe('AUTHORIZED_NAME_ID_CHECK');
      expect(order.pickup_secret_hash).toBeNull();
      expect(order.pickup_secret_salt).toBeNull();
      expect(order.pickup_secret_last4).toBeNull();
      expect(order.pickup_secret_expires_at).toBeNull();
      expect(order.pickup_secret_attempts).toBe(0);
      expect(order.pickup_secret_blocked_until).toBeNull();
      expect(order.exceptional_pickup_attempts).toBe(0);
      expect(order.exceptional_pickup_blocked_until).toBeNull();

      const { rows: scans } = await db.query(
        `SELECT pickup_method, authorization_version, document_checked,
                pickup_relais_id, scanned_by, notes
         FROM scans
         WHERE order_id = $1 AND step = 'collected'`,
        [successOrderId]
      );
      expect(scans).toHaveLength(1);
      expect(scans[0]).toEqual(expect.objectContaining({
        pickup_method: 'AUTHORIZED_NAME_ID_CHECK',
        authorization_version: currentVersion,
        document_checked: true,
      }));
      expect(String(scans[0].pickup_relais_id)).toBe(String(relaisId));
      expect(String(scans[0].scanned_by)).toBe(String(agentId));
      expect(scans[0].notes)
        .not.toMatch(/Fatima|Amina|Said|Éléonore|Bacar/i);

      const { rows: [proofCounts] } = await db.query(
        `SELECT
           (SELECT count(*)::int FROM scans
             WHERE order_id = $1 AND step = 'collected') AS scans,
           (SELECT count(*)::int FROM order_status_history
             WHERE order_id = $1 AND status = 'collected') AS transitions,
           (SELECT count(*)::int FROM pickup_reveal_codes
             WHERE order_id = $1) AS reveal_codes,
           (SELECT count(*)::int FROM pickup_print_tokens
             WHERE order_id = $1) AS print_tokens`,
        [successOrderId]
      );
      expect(proofCounts).toEqual({
        scans: 1,
        transitions: 1,
        reveal_codes: 0,
        print_tokens: 0,
      });

      const replay = await collect(successOrderId);
      expect(replay.status).toBe(409);
      expect(replay.body.code).toBe('ALREADY_COLLECTED');
    });

    it('4 — trois erreurs nominatives déclenchent le blocage dédié sans fuite de noms', async () => {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const mismatch = await collect(blockedOrderId, {
          givenNames: `Inconnu${attempt}`,
          familyName: 'Testeur',
        });
        expect(mismatch.status).toBe(401);
        expect(mismatch.body.code).toBe('NAME_MISMATCH');
        expect(mismatch.body.attempts).toBe(attempt);
        expect(JSON.stringify(mismatch.body))
          .not.toMatch(/Fatima|Amina|Said|Inconnu|Testeur/i);
      }

      const blocked = await collect(blockedOrderId);
      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe('BLOCKED');

      const { rows: [order] } = await db.query(
        `SELECT exceptional_pickup_attempts,
                exceptional_pickup_blocked_until,
                pickup_secret_attempts,
                pickup_secret_blocked_until
         FROM orders WHERE id = $1`,
        [blockedOrderId]
      );
      expect(order.exceptional_pickup_attempts).toBe(3);
      expect(order.exceptional_pickup_blocked_until).not.toBeNull();
      expect(order.pickup_secret_attempts).toBe(0);
      expect(order.pickup_secret_blocked_until).toBeNull();

      const { rows: mismatchAudits } = await db.query(
        `SELECT type, title, description
         FROM alerts
         WHERE entity_id = $1
           AND type = 'exceptional_pickup_name_mismatch'`,
        [blockedOrderId]
      );
      expect(mismatchAudits).toHaveLength(3);
      expect(JSON.stringify(mismatchAudits))
        .not.toMatch(/Fatima|Amina|Said|Inconnu|Testeur/i);
    });

    it('5 — révocation immédiate, idempotente et sans conservation de donnée de pièce', async () => {
      const revoked = await request(app)
        .delete('/api/auth/me/pickup-authorization')
        .set(auth(buyerToken));
      expect(revoked.status).toBe(200);
      expect(revoked.body).toEqual({ status: 'NONE' });

      const revokedAgain = await request(app)
        .delete('/api/auth/me/pickup-authorization')
        .set(auth(buyerToken));
      expect(revokedAgain.status).toBe(200);
      expect(revokedAgain.body).toEqual({ status: 'NONE' });

      const none = await getAuthorization();
      expect(none.body).toEqual({ status: 'NONE' });

      const noLongerAvailable = await availability(revokeOrderId);
      expect(noLongerAvailable.body).toEqual({
        available: false,
        reason: 'NO_ACTIVE_AUTHORIZATION',
      });

      const refused = await collect(revokeOrderId);
      expect(refused.status).toBe(404);
      expect(refused.body.code).toBe('NO_ACTIVE_AUTHORIZATION');
      expect(JSON.stringify(refused.body))
        .not.toMatch(/Fatima|Amina|Said/i);

      const { rows: [row] } = await db.query(
        `SELECT authorized_given_names, authorized_family_name,
                normalized_given_names, normalized_family_name,
                version, is_active, revoked_at
         FROM user_pickup_authorizations
         WHERE user_id = $1`,
        [buyerId]
      );
      expect(row.authorized_given_names).toBeNull();
      expect(row.authorized_family_name).toBeNull();
      expect(row.normalized_given_names).toBeNull();
      expect(row.normalized_family_name).toBeNull();
      expect(row.version).toBe(currentVersion + 1);
      expect(row.is_active).toBe(false);
      expect(row.revoked_at).not.toBeNull();

      const forbiddenColumns = [
        'document_number',
        'document_photo',
        'document_copy',
        'document_expiry',
        'document_address',
        'signature',
      ];
      const { rows: forbidden } = await db.query(
        `SELECT table_name, column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name IN ('user_pickup_authorizations', 'scans', 'orders')
           AND column_name = ANY($1::text[])`,
        [forbiddenColumns]
      );
      expect(forbidden).toEqual([]);
    });
  }
);