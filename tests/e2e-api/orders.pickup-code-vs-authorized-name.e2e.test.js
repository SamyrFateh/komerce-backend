'use strict';


/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * E2E-LOT5-PICKUP-RACE
 *
 * Prouve sur PostgreSQL réel que les deux méthodes de remise :
 *
 *   - code secret normal ;
 *   - autorisation nominative exceptionnelle avec contrôle de pièce ;
 *
 * sont sérialisées par le même verrou orders ... FOR UPDATE.
 *
 * Invariants :
 *   - exactement un gagnant ;
 *   - un seul scan collected ;
 *   - une seule transition collected ;
 *   - cohérence orders.pickup_collected_via / scans.pickup_method ;
 *   - preuve nominative minimale seulement si cette méthode gagne ;
 *   - secret et caches en clair supprimés avant COMMIT ;
 *   - les deux méthodes sont définitivement inutilisables après la remise.
 */

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
  collectByPickupCode,
  collectByAuthorizedName,
} = require('../../services/pickup-secret-service');

const {
  setMyAuthorization,
} = require('../../services/pickup-authorization-service');

jest.setTimeout(60000);

describeE2E(
  'E2E-LOT5-PICKUP-RACE — code vs autorisation nominative',
  ({ db }) => {
    const relaisId = uuid();
    const buyerId = uuid();
    const agentId = uuid();
    const orderId = uuid();

    const authorizedGivenNames = 'Fatima Amina';
    const authorizedFamilyName = 'Said';

    const agent = {
      id: agentId,
      role: 'agent_relais',
    };

    let cleanup;
    let pickupCode;
    let authorizationVersion;
    let orderReference;

    function collectWithCode() {
      return collectByPickupCode({
        code: pickupCode,
        user: agent,
        ip: '127.0.0.1',
        userAgent: 'e2e-lot5-pickup-race',
      });
    }

    function collectWithAuthorizedName() {
      return collectByAuthorizedName({
        orderId,
        agentId,
        role: 'agent_relais',
        givenNames: authorizedGivenNames,
        familyName: authorizedFamilyName,
        documentChecked: true,
      });
    }

    beforeAll(async () => {
      cleanup = createCleanup(db);

      /*
       * createCleanup dépile en LIFO.
       * Les parents sont donc enregistrés avant leurs enfants.
       */
      cleanup.trackSql(
        'DELETE FROM relais WHERE id = $1',
        [relaisId]
      );

      cleanup.trackSql(
        'DELETE FROM users WHERE id IN ($1, $2)',
        [buyerId, agentId]
      );

      cleanup.trackSql(
        'DELETE FROM orders WHERE id = $1',
        [orderId]
      );

      cleanup.trackSql(
        'DELETE FROM user_pickup_authorizations WHERE user_id = $1',
        [buyerId]
      );

      cleanup.trackSql(
        `DELETE FROM alerts
          WHERE entity_id IN ($1, $2)
             OR description LIKE $3`,
        [buyerId, orderId, `%${agentId}%`]
      );

      cleanup.trackSql(
        'DELETE FROM scans WHERE order_id = $1',
        [orderId]
      );

      // order_status_history référence scans (FK scan_id) : enregistré après
      // scans pour être dépilé (supprimé) avant, sans quoi la suppression de
      // scans viole order_status_history_scan_id_fkey.
      cleanup.trackSql(
        'DELETE FROM order_status_history WHERE order_id = $1',
        [orderId]
      );

      cleanup.trackSql(
        'DELETE FROM pickup_reveal_codes WHERE order_id = $1',
        [orderId]
      );

      cleanup.trackSql(
        'DELETE FROM pickup_print_tokens WHERE order_id = $1',
        [orderId]
      );

      // Refus explicite si la migration 121 n'est pas appliquée.
      const { rows: [schema] } = await db.query(`
        SELECT
          to_regclass(
            'public.user_pickup_authorizations'
          ) IS NOT NULL AS authorization_table,

          EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'orders'
              AND column_name = 'pickup_collected_via'
          ) AS order_method,

          EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'scans'
              AND column_name = 'pickup_method'
          ) AS scan_method,

          EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'scans'
              AND column_name = 'authorization_version'
          ) AS authorization_version,

          EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'scans'
              AND column_name = 'document_checked'
          ) AS document_checked,

          EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'scans'
              AND column_name = 'pickup_relais_id'
          ) AS pickup_relais_id
      `);

      const missing = Object.entries(schema)
        .filter(([, present]) => !present)
        .map(([name]) => name);

      if (missing.length) {
        throw new Error(
          `Migration 121 absente ou incomplète : ${missing.join(', ')}`
        );
      }

      orderReference = `E2E-LOT5-${tag('pickup-race')}`;

      await db.query(
        `INSERT INTO relais (id, name, agent_name, phone, address, market_id)
         VALUES
           ($1, $2, $3, $4, $5, (SELECT id FROM markets WHERE code = 'KM'))`,
        [
          relaisId,
          'E2E Relais Lot 5',
          'E2E Agent Lot 5',
          `+2694${Math.floor(Math.random() * 9e6 + 1e6)}`,
          'Moroni Test',
        ]
      );

      await db.query(
        `INSERT INTO users
           (id, full_name, email, phone, role)
         VALUES
           ($1, $2, $3, $4, 'client')`,
        [
          buyerId,
          'E2E Buyer Lot 5',
          `${tag('buyer')}@komerce.test`,
          `+2695${Math.floor(Math.random() * 9e6 + 1e6)}`,
        ]
      );

      await db.query(
        `INSERT INTO users
           (id, full_name, email, phone, role, relais_id)
         VALUES
           ($1, $2, $3, $4, 'agent_relais', $5)`,
        [
          agentId,
          'E2E Agent Pickup Lot 5',
          `${tag('agent')}@komerce.test`,
          `+2696${Math.floor(Math.random() * 9e6 + 1e6)}`,
          relaisId,
        ]
      );

      await db.query(
        `INSERT INTO orders
           (
             id,
             reference,
             user_id,
             relais_id,
             market_id,
             total_kmf,
             payment_mode,
             payment_status,
             status
           )
         VALUES
           (
             $1,
             $2,
             $3,
             $4,
             (SELECT market_id FROM relais WHERE id = $4),
             25000,
             'cash_relais',
             'paid',
             'available'
           )`,
        [
          orderId,
          orderReference,
          buyerId,
          relaisId,
        ]
      );

      const authorizationResult = await setMyAuthorization({
        userId: buyerId,
        givenNames: authorizedGivenNames,
        familyName: authorizedFamilyName,
      });

      expect([200, 201]).toContain(authorizationResult.status);

      const { rows: [authorization] } = await db.query(
        `SELECT version, is_active
         FROM user_pickup_authorizations
         WHERE user_id = $1`,
        [buyerId]
      );

      expect(authorization.is_active).toBe(true);

      authorizationVersion = authorization.version;

      const generated = await generateAndStoreSecret({
        orderId,
        relaisId,
        channel: 'cash_relais',
      });

      pickupCode = generated.code;

      expect(typeof pickupCode).toBe('string');
      expect(pickupCode.length).toBeGreaterThan(0);

      // Deux endroits contenant encore volontairement le code en clair.
      await cacheCodeForReveal(orderId, pickupCode);

      const printToken = await issuePrintToken({
        orderId,
        code: pickupCode,
        payerName: 'E2E Buyer Lot 5',
      });

      expect(typeof printToken).toBe('string');

      const { rows: [before] } = await db.query(
        `SELECT
           pickup_secret_hash IS NOT NULL AS has_hash,
           pickup_secret_salt IS NOT NULL AS has_salt,
           pickup_secret_last4 IS NOT NULL AS has_last4
         FROM orders
         WHERE id = $1`,
        [orderId]
      );

      expect(before).toEqual({
        has_hash: true,
        has_salt: true,
        has_last4: true,
      });

      const { rows: [cacheBefore] } = await db.query(
        `SELECT
           (
             SELECT count(*)::int
             FROM pickup_reveal_codes
             WHERE order_id = $1
           ) AS reveal_count,
           (
             SELECT count(*)::int
             FROM pickup_print_tokens
             WHERE order_id = $1
           ) AS print_count`,
        [orderId]
      );

      expect(cacheBefore).toEqual({
        reveal_count: 1,
        print_count: 1,
      });
    });

    afterAll(async () => {
      if (cleanup) {
        await cleanup.run();
      }
    });

    it(
      'un seul gagnant, une seule preuve et aucun secret résiduel',
      async () => {
        /*
         * Les deux services ouvrent chacun leur transaction et tentent de
         * verrouiller la même ligne orders. Jamais d'exécution en série.
         */
        const [codeResult, authorizedNameResult] = await Promise.all([
          collectWithCode(),
          collectWithAuthorizedName(),
        ]);

        const attempts = [
          {
            method: 'PICKUP_CODE',
            result: codeResult,
          },
          {
            method: 'AUTHORIZED_NAME_ID_CHECK',
            result: authorizedNameResult,
          },
        ];

        const winners = attempts.filter(
          ({ result }) => result.status === 200
        );

        const losers = attempts.filter(
          ({ result }) => result.status !== 200
        );

        expect(winners).toHaveLength(1);
        expect(losers).toHaveLength(1);

        const winningMethod = winners[0].method;
        const losingAttempt = losers[0];

        expect([404, 409]).toContain(
          losingAttempt.result.status
        );

        if (winningMethod === 'PICKUP_CODE') {
          expect(authorizedNameResult.status).toBe(409);
          expect(authorizedNameResult.body.code)
            .toBe('ALREADY_COLLECTED');
        } else {
          expect(codeResult.status).toBe(404);
          expect(codeResult.body.error)
            .toMatch(/introuvable|déjà utilisé/i);
        }

        const { rows: [order] } = await db.query(
          `SELECT
             status,
             pickup_collected_via,
             pickup_secret_hash,
             pickup_secret_salt,
             pickup_secret_last4,
             pickup_secret_expires_at,
             pickup_secret_attempts,
             pickup_secret_blocked_until,
             exceptional_pickup_attempts,
             exceptional_pickup_blocked_until
           FROM orders
           WHERE id = $1`,
          [orderId]
        );

        expect(order.status).toBe('collected');
        expect(order.pickup_collected_via)
          .toBe(winningMethod);

        expect(order.pickup_secret_hash).toBeNull();
        expect(order.pickup_secret_salt).toBeNull();
        expect(order.pickup_secret_last4).toBeNull();
        expect(order.pickup_secret_expires_at).toBeNull();
        expect(order.pickup_secret_attempts).toBe(0);
        expect(order.pickup_secret_blocked_until).toBeNull();
        expect(order.exceptional_pickup_attempts).toBe(0);
        expect(order.exceptional_pickup_blocked_until).toBeNull();

        const { rows: scans } = await db.query(
          `SELECT
             pickup_method,
             authorization_version,
             document_checked,
             pickup_relais_id,
             scanned_by,
             notes
           FROM scans
           WHERE order_id = $1
             AND step = 'collected'`,
          [orderId]
        );

        expect(scans).toHaveLength(1);

        const scan = scans[0];

        expect(scan.pickup_method).toBe(winningMethod);
        expect(String(scan.pickup_relais_id))
          .toBe(String(relaisId));
        expect(String(scan.scanned_by))
          .toBe(String(agentId));

        expect(scan.notes)
          .not.toMatch(/Fatima|Amina|Said/i);

        if (winningMethod === 'AUTHORIZED_NAME_ID_CHECK') {
          expect(scan.authorization_version)
            .toBe(authorizationVersion);
          expect(scan.document_checked).toBe(true);
        } else {
          expect(scan.authorization_version).toBeNull();
          expect(scan.document_checked).toBe(false);
        }

        const { rows: [history] } = await db.query(
          `SELECT count(*)::int AS count
           FROM order_status_history
           WHERE order_id = $1
             AND status = 'collected'`,
          [orderId]
        );

        expect(history.count).toBe(1);

        const { rows: [cleartextCaches] } = await db.query(
          `SELECT
             (
               SELECT count(*)::int
               FROM pickup_reveal_codes
               WHERE order_id = $1
             ) AS reveal_count,
             (
               SELECT count(*)::int
               FROM pickup_print_tokens
               WHERE order_id = $1
             ) AS print_count`,
          [orderId]
        );

        expect(cleartextCaches).toEqual({
          reveal_count: 0,
          print_count: 0,
        });

        /*
         * Preuve de non-réutilisation après COMMIT, pour les deux voies.
         */
        const codeReplay = await collectWithCode();
        const authorizedNameReplay =
          await collectWithAuthorizedName();

        expect(codeReplay.status).toBe(404);
        expect(authorizedNameReplay.status).toBe(409);
        expect(authorizedNameReplay.body.code)
          .toBe('ALREADY_COLLECTED');

        const { rows: [finalCounts] } = await db.query(
          `SELECT
             (
               SELECT count(*)::int
               FROM scans
               WHERE order_id = $1
                 AND step = 'collected'
             ) AS scans,
             (
               SELECT count(*)::int
               FROM order_status_history
               WHERE order_id = $1
                 AND status = 'collected'
             ) AS transitions`,
          [orderId]
        );

        expect(finalCounts).toEqual({
          scans: 1,
          transitions: 1,
        });
      }
    );
  }
);