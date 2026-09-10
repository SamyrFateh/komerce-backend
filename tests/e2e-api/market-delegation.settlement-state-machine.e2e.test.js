'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * E2E-MARKET-DELEGATION — machine à états et immutabilité du règlement
 *
 * Ce scénario existe parce que rien de market-delegation n'avait jamais tourné
 * contre un vrai PostgreSQL. Les invariants de la migration 208 — CHECK de
 * cohérence par étape ET trigger enforce_market_settlement_invariants() —
 * étaient couverts uniquement par des tests unitaires qui mockent db.query et
 * par des assertions sur le TEXTE du fichier SQL. Autrement dit : leur syntaxe
 * n'avait jamais été compilée par Postgres, et leur comportement jamais
 * observé.
 *
 * La distinction est importante : ces garanties ne valent pas parce que le
 * service applicatif les respecte, mais parce que la base les REFUSE. Le seul
 * moyen de le prouver est de tenter la violation en SQL direct, en contournant
 * entièrement services/market-settlement-service.js. C'est ce que fait ce
 * fichier — chaque test attaque la base comme le ferait un script de
 * maintenance, une migration mal écrite ou un futur service distrait.
 *
 * Complémentarité avec market-delegation.client-finance.e2e.test.js (E2E-MA-03,
 * mergé depuis) : cette suite-là exerce le cycle NOMINAL à travers les vraies
 * routes HTTP (READY central -> REQUESTED pays -> PAID central -> RECEIVED
 * pays) et prouve que le chemin applicatif fonctionne. Celle-ci fait l'inverse :
 * elle tente les VIOLATIONS en SQL direct, sans jamais passer par un service,
 * et prouve que la base les refuse d'elle-même. Les deux sont nécessaires — un
 * chemin applicatif correct ne dit rien de ce qui arrive quand on l'ignore.
 *
 * Features traversées (ownership : market-delegation, cf. convention du runner
 * tests/e2e-api/<feature>.<scenario>.e2e.test.js) : settlement (table et
 * trigger), market (référentiel), auth-identity (users).
 */

const { describeE2E, createCleanup, tag, uuid } = require('../helpers/e2eDbKit');

jest.setTimeout(60000);

describeE2E('E2E-MARKET-DELEGATION — settlement state machine (SQL direct)', ({ db }) => {
  const marketId = uuid();
  const otherMarketId = uuid();
  const assignmentId = uuid();
  const centralUserId = uuid();
  const operatorUserId = uuid();

  let cleanup;

  // Deux codes marché distincts, dérivés aléatoirement pour ne pas entrer en
  // collision avec un run concurrent sur la même base de test (markets.code
  // est UNIQUE). Deux lettres pour rester réaliste vis-à-vis de la convention
  // ISO alpha-2 du référentiel.
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const pick = () => LETTERS[Math.floor(Math.random() * 26)] + LETTERS[Math.floor(Math.random() * 26)];
  const marketCode = pick();
  let otherMarketCode = pick();
  while (otherMarketCode === marketCode) otherMarketCode = pick();

  /** Insère une attestation READY valide et renvoie son id. */
  async function insertReady(overrides = {}) {
    const id = overrides.id || uuid();
    const {
      amount = 1500.5,
      currency = 'XAF',
      market = marketId,
      assignment = assignmentId,
    } = overrides;

    await db.query(
      `INSERT INTO market_settlements
         (id, market_id, assignment_id, amount, currency, attested_by, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'READY')`,
      [id, market, assignment, amount, currency, centralUserId]
    );
    // market_settlements est non-destructif par conception : le trigger
    // trg_prevent_market_settlement_delete refuse tout DELETE, y compris en
    // SQL direct — un registre financier ne se rature pas. Le teardown d'un
    // E2E doit donc désactiver explicitement la réplication de trigger le
    // temps de la suppression, sinon la base conserverait à jamais les
    // fixtures de test. C'est le seul endroit où ce contournement est
    // légitime : nettoyage d'une base de test, jamais un chemin applicatif.
    cleanup.trackSql(
      `SET session_replication_role = replica;
       DELETE FROM market_settlement_events WHERE settlement_id = '${id}';
       DELETE FROM market_settlements WHERE id = '${id}';
       SET session_replication_role = origin;`
    );
    return id;
  }

  beforeAll(async () => {
    cleanup = createCleanup(db);

    // Référentiel minimal. Chaque identifiant est unique par run (uuid()) :
    // deux exécutions concurrentes sur la même base de test ne peuvent pas se
    // marcher dessus.
    await db.query(
      `INSERT INTO markets (id, code, name, currency, minor_unit, is_active)
       VALUES ($1, $2, $3, 'XAF', 0, TRUE)`,
      [marketId, marketCode, tag('marche-e2e')]
    );
    cleanup.track('markets', 'id', marketId);

    await db.query(
      `INSERT INTO markets (id, code, name, currency, minor_unit, is_active)
       VALUES ($1, $2, $3, 'XAF', 0, TRUE)`,
      [otherMarketId, otherMarketCode, tag('marche-e2e-autre')]
    );
    cleanup.track('markets', 'id', otherMarketId);

    for (const [id, email] of [[centralUserId, tag('central') + '@e2e.invalid'], [operatorUserId, tag('operateur') + '@e2e.invalid']]) {
      await db.query(
        `INSERT INTO users (id, full_name, email, password_hash, role)
         VALUES ($1, $2, $3, 'e2e-not-a-real-hash', 'admin')`,
        [id, tag('E2E User'), email]
      );
      cleanup.track('users', 'id', id);
    }

    await db.query(
      `INSERT INTO market_operating_assignments (id, market_id, status, granted_by)
       VALUES ($1, $2, 'ACTIVE', $3)`,
      [assignmentId, marketId, centralUserId]
    );
    cleanup.track('market_operating_assignments', 'id', assignmentId);
  });

  afterAll(async () => {
    if (cleanup) await cleanup.run();
  });

  describe('création — une ligne ne peut naître qu’en READY, sans étape future préremplie', () => {
    test('une attestation READY valide est acceptée', async () => {
      const id = await insertReady();
      const { rows } = await db.query('SELECT status, source FROM market_settlements WHERE id = $1', [id]);
      expect(rows[0]).toMatchObject({ status: 'READY', source: 'CENTRAL_ATTESTATION' });
    });

    test('naître directement en PAID est refusé par la base', async () => {
      // Sans ce refus, un script de maintenance pourrait fabriquer un
      // règlement « déjà payé » sans qu'aucune demande n'ait eu lieu.
      await expect(db.query(
        `INSERT INTO market_settlements
           (market_id, assignment_id, amount, currency, attested_by, status,
            requested_by, requested_at, paid_by, paid_at, payment_reference)
         VALUES ($1, $2, 100, 'XAF', $3, 'PAID', $3, NOW(), $3, NOW(), 'VIR-1')`,
        [marketId, assignmentId, centralUserId]
      )).rejects.toThrow(/market_settlement_must_start_ready/);
    });

    test('préremplir un champ d’étape future à la création est refusé', async () => {
      await expect(db.query(
        `INSERT INTO market_settlements
           (market_id, assignment_id, amount, currency, attested_by, status, receipt_note)
         VALUES ($1, $2, 100, 'XAF', $3, 'READY', 'reçu par avance')`,
        [marketId, assignmentId, centralUserId]
      )).rejects.toThrow(/market_settlement_future_stage_fields_forbidden/);
    });

    test('un montant nul ou négatif est refusé', async () => {
      await expect(db.query(
        `INSERT INTO market_settlements
           (market_id, assignment_id, amount, currency, attested_by)
         VALUES ($1, $2, 0, 'XAF', $3)`,
        [marketId, assignmentId, centralUserId]
      )).rejects.toThrow();
    });

    test('une devise qui ne correspond pas à celle du marché est refusée', async () => {
      // Garde-fou multi-pays : le règlement ne peut pas être libellé dans une
      // devise étrangère à son propre marché.
      await expect(db.query(
        `INSERT INTO market_settlements
           (market_id, assignment_id, amount, currency, attested_by)
         VALUES ($1, $2, 100, 'EUR', $3)`,
        [marketId, assignmentId, centralUserId]
      )).rejects.toThrow(/market_settlement_currency_mismatch/);
    });

    test('un assignment appartenant à un autre marché est refusé', async () => {
      // Empêche qu'un règlement soit rattaché au marché A tout en pointant le
      // mandat d'exploitation du marché B.
      await expect(db.query(
        `INSERT INTO market_settlements
           (market_id, assignment_id, amount, currency, attested_by)
         VALUES ($1, $2, 100, 'XAF', $3)`,
        [otherMarketId, assignmentId, centralUserId]
      )).rejects.toThrow(/market_settlement_assignment_market_mismatch/);
    });
  });

  describe('immutabilité — la vérité monétaire attestée ne se réécrit jamais', () => {
    test('modifier le montant après attestation est refusé', async () => {
      const id = await insertReady({ amount: 900 });
      await expect(
        db.query('UPDATE market_settlements SET amount = 950 WHERE id = $1', [id])
      ).rejects.toThrow(/market_settlement_attestation_immutable/);
    });

    test('modifier la devise après attestation est refusé', async () => {
      const id = await insertReady();
      await expect(
        db.query(`UPDATE market_settlements SET currency = 'EUR' WHERE id = $1`, [id])
      ).rejects.toThrow(/market_settlement_attestation_immutable/);
    });

    test('changer de marché après attestation est refusé', async () => {
      const id = await insertReady();
      await expect(
        db.query('UPDATE market_settlements SET market_id = $2 WHERE id = $1', [id, otherMarketId])
      ).rejects.toThrow(/market_settlement_attestation_immutable/);
    });

    test('changer l’auteur de l’attestation est refusé', async () => {
      const id = await insertReady();
      await expect(
        db.query('UPDATE market_settlements SET attested_by = $2 WHERE id = $1', [id, operatorUserId])
      ).rejects.toThrow(/market_settlement_attestation_immutable/);
    });
  });

  describe('transitions — aucune étape ne peut être sautée', () => {
    test('READY -> REQUESTED est accepté', async () => {
      const id = await insertReady();
      await db.query(
        `UPDATE market_settlements
            SET status = 'REQUESTED', requested_by = $2, requested_at = NOW()
          WHERE id = $1`,
        [id, operatorUserId]
      );
      const { rows } = await db.query('SELECT status FROM market_settlements WHERE id = $1', [id]);
      expect(rows[0].status).toBe('REQUESTED');
    });

    test('READY -> RECEIVED (double saut) est refusé', async () => {
      const id = await insertReady();
      await expect(db.query(
        `UPDATE market_settlements
            SET status = 'RECEIVED', requested_by = $2, requested_at = NOW(),
                paid_by = $2, paid_at = NOW(), payment_reference = 'VIR-X',
                received_by = $2, received_at = NOW()
          WHERE id = $1`,
        [id, operatorUserId]
      )).rejects.toThrow();
    });

    test('REQUESTED -> RECEIVED (saut par-dessus PAID) est refusé', async () => {
      // Invariant central du lot : un opérateur pays ne peut jamais confirmer
      // la réception d'un règlement que le central n'a pas déclaré payé.
      const id = await insertReady();
      await db.query(
        `UPDATE market_settlements
            SET status = 'REQUESTED', requested_by = $2, requested_at = NOW()
          WHERE id = $1`,
        [id, operatorUserId]
      );
      await expect(db.query(
        `UPDATE market_settlements
            SET status = 'RECEIVED', received_by = $2, received_at = NOW()
          WHERE id = $1`,
        [id, operatorUserId]
      )).rejects.toThrow();
    });

    test('REQUESTED -> PAID sans référence de paiement est refusé', async () => {
      // Le passage à PAID doit toujours laisser une trace vérifiable du
      // virement : un statut payé sans référence est invérifiable.
      const id = await insertReady();
      await db.query(
        `UPDATE market_settlements
            SET status = 'REQUESTED', requested_by = $2, requested_at = NOW()
          WHERE id = $1`,
        [id, operatorUserId]
      );
      await expect(db.query(
        `UPDATE market_settlements
            SET status = 'PAID', paid_by = $2, paid_at = NOW(), payment_reference = '   '
          WHERE id = $1`,
        [id, centralUserId]
      )).rejects.toThrow();
    });

    test('cycle complet READY -> REQUESTED -> PAID -> RECEIVED', async () => {
      const id = await insertReady({ amount: 2400 });

      await db.query(
        `UPDATE market_settlements
            SET status = 'REQUESTED', requested_by = $2, requested_at = NOW()
          WHERE id = $1`,
        [id, operatorUserId]
      );
      await db.query(
        `UPDATE market_settlements
            SET status = 'PAID', paid_by = $2, paid_at = NOW(), payment_reference = $3
          WHERE id = $1`,
        [id, centralUserId, tag('VIR')]
      );
      await db.query(
        `UPDATE market_settlements
            SET status = 'RECEIVED', received_by = $2, received_at = NOW(), receipt_note = 'reçu'
          WHERE id = $1`,
        [id, operatorUserId]
      );

      const { rows } = await db.query(
        'SELECT status, amount, currency FROM market_settlements WHERE id = $1',
        [id]
      );
      expect(rows[0].status).toBe('RECEIVED');
      // La vérité monétaire a traversé tout le cycle sans bouger d'un centime.
      expect(Number(rows[0].amount)).toBe(2400);
      expect(rows[0].currency).toBe('XAF');
    });
  });
});
