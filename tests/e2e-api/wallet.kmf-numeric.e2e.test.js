'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * E2E-WALLET-KMF-NUMERIC — LOT 3 du chantier currency debt
 *
 * Les 9 colonnes monétaires des 5 tables wallet/cash (migration 215) passent
 * de `integer` à `numeric(14,2)`. Aucun trigger, aucune vue ne dépend
 * d'elles (vérifié par pg_depend/pg_trigger) — structurellement plus simple
 * qu'orders/products sur ce plan.
 *
 * Risque propre à ce lot : services/wallet-service.js consommait les lots de
 * crédit en FIFO par SOUSTRACTION JS RÉPÉTÉE (remaining -= consume, à
 * travers plusieurs lots), avec le statut ('used'/'active') du lot décidé
 * par `newRemaining === 0` calculé AVANT tout arrondi. Avec des integer,
 * cette classe de dérive n'existe pas structurellement. Avec des décimales
 * réelles, une combinaison de montants peut laisser un résidu flottant non
 * nul sur le dernier lot consommé au lieu d'exactement zéro.
 *
 * Combinaison minimale vérifiée par calcul isolé, fidèle à l'algorithme
 * exact de la boucle (Math.min / soustraction / affectation) :
 *
 *   lots=[1, 1, 7.04], débit total=9.04
 *   -> le 3e lot laisse newRemaining = 8.881784197001252e-16, pas 0
 *   -> avec le bug : status reste 'active' (lot fantôme) alors que
 *      remaining_kmf s'affiche à 0 (Postgres arrondit à l'écriture) ;
 *      NUMERIC(14,2) masque donc la valeur mais pas le statut faux.
 *   -> corrigé : newRemaining = Math.round((lot.remaining_kmf - consume) * 100) / 100
 *      avant le test === 0, donne exactement 0 et status='used'.
 *
 * Cette combinaison n'a été vérifiée qu'en arithmétique JS isolée
 * (reproduisant exactement les opérations de la boucle), pas encore
 * exécutée à travers le vrai service sur Postgres dans cette session — ce
 * test ci-dessous est ce qui referme cette boucle : il passe par les VRAIES
 * fonctions credit()/debit(), pas une reproduction isolée.
 */

const { describeE2E, createCleanup, tag, uuid } = require('../helpers/e2eDbKit');
const walletService = require('../../services/wallet-service');

jest.setTimeout(30000);

describeE2E('E2E-WALLET-KMF-NUMERIC — conversion integer -> numeric', ({ db }) => {
  let cleanup;

  beforeAll(async () => {
    cleanup = createCleanup(db);
  });

  afterAll(async () => {
    if (cleanup) await cleanup.run();
  });

  async function insertUser() {
    const id = uuid();
    await db.query(
      `INSERT INTO users (id, full_name, email, password_hash, role)
       VALUES ($1, $2, $3, 'e2e-not-a-real-hash', 'client')`,
      [id, tag('E2E User'), tag('user') + '@e2e.invalid']
    );
    cleanup.track('users', 'id', id);
    return id;
  }

  test('wallets.balance_kmf décode en number et conserve ses centimes (mouvement en base, pas en JS)', async () => {
    const userId = await insertUser();
    const { transaction } = await walletService.credit(db, {
      userId, amountKmf: 1234.56, reason: 'e2e_test',
    });
    // FK : wallet_credit_lots -> wallet_transactions -> wallets. LIFO pop
    // dans l'ordre INVERSE du push : on pousse donc wallets d'abord, puis
    // transactions, puis credit_lots en dernier — pour que credit_lots soit
    // supprimé en premier à l'exécution, avant ses parents.
    cleanup.trackSql('DELETE FROM wallets WHERE user_id = $1', [userId]);
    cleanup.trackSql('DELETE FROM wallet_transactions WHERE id = $1', [transaction.id]);
    cleanup.trackSql('DELETE FROM wallet_credit_lots WHERE transaction_id = $1', [transaction.id]);

    const balance = await walletService.getBalance(userId);
    expect(typeof balance).toBe('number');
    expect(balance).toBe(1234.56);
  });

  test('cash_reconciliation conserve ses centimes sur les 3 colonnes', async () => {
    const id = uuid();
    const agentId = await insertUser();
    await db.query(
      `INSERT INTO cash_reconciliation (id, agent_id, period_start, period_end, expected_kmf, declared_kmf, deposited_kmf)
       VALUES ($1, $2, CURRENT_DATE, CURRENT_DATE, $3, $4, $5)`,
      [id, agentId, 10000.5, 9999.99, 9500.25]
    );
    cleanup.track('cash_reconciliation', 'id', id);

    const { rows: [row] } = await db.query(
      'SELECT expected_kmf, declared_kmf, deposited_kmf FROM cash_reconciliation WHERE id = $1',
      [id]
    );
    expect(row.expected_kmf).toBe(10000.5);
    expect(row.declared_kmf).toBe(9999.99);
    expect(row.deposited_kmf).toBe(9500.25);
  });

  describe('consommation FIFO — dérive flottante sur soustraction répétée', () => {
    let userId;
    let lotIds;

    beforeAll(async () => {
      userId = await insertUser();
      lotIds = [];

      // FK : wallet_consumptions -> wallet_transactions -> wallet_credit_lots
      // -> wallets. Poussé ICI, avant toute écriture, pour que le nettoyage
      // final (LIFO) supprime dans l'ordre correct quel que soit le nombre
      // de transactions créées ensuite par les tests de ce bloc : un seul
      // point de vérité sur l'ordre, plutôt que des track() dispersés à
      // travers beforeAll et chaque test.
      cleanup.trackSql('DELETE FROM wallets WHERE user_id = $1', [userId]);
      cleanup.trackSql(
        `DELETE FROM wallet_transactions WHERE wallet_id = (SELECT id FROM wallets WHERE user_id = $1)`,
        [userId]
      );
      cleanup.trackSql('DELETE FROM wallet_credit_lots WHERE wallet_id = (SELECT id FROM wallets WHERE user_id = $1)', [userId]);
      cleanup.trackSql(
        `DELETE FROM wallet_consumptions WHERE transaction_id IN
           (SELECT id FROM wallet_transactions WHERE wallet_id = (SELECT id FROM wallets WHERE user_id = $1))`,
        [userId]
      );

      // Trois crédits séparés = trois lots FIFO distincts. Montants
      // reproduisant la combinaison minimale qui dérive en JS (vérifiée par
      // calcul isolé fidèle à l'algorithme — voir en-tête du fichier).
      for (const amount of [1, 1, 7.04]) {
        const { lot } = await walletService.credit(db, {
          userId, amountKmf: amount, reason: 'e2e_fifo_drift_setup',
        });
        lotIds.push(lot.id);
      }
    });

    test('un débit qui vide exactement les 3 lots laisse remaining_kmf à zéro EXACT, jamais un résidu flottant', async () => {
      const total = 1 + 1 + 7.04;
      const { consumptions } = await walletService.debit(db, {
        userId, amountKmf: total, reason: 'e2e_fifo_drift_consume', referenceId: uuid(),
      });

      expect(consumptions).toHaveLength(3);

      const { rows: lots } = await db.query(
        'SELECT id, remaining_kmf, status FROM wallet_credit_lots WHERE id = ANY($1)',
        [lotIds]
      );
      for (const lot of lots) {
        // C'est l'assertion qui compte : pas "proche de zéro", exactement
        // zéro. Un résidu de 1e-13 laisserait un lot 'active' fantôme.
        expect(lot.remaining_kmf).toBe(0);
        expect(lot.status).toBe('used');
      }
    });

    test('la somme des consommations égale exactement le montant débité, au centime', async () => {
      const balance = await walletService.getBalance(userId);
      // Les 3 lots ont été intégralement consommés par le test précédent :
      // le solde doit être exactement 0, pas un résidu.
      expect(balance).toBe(0);
    });
  });

  describe('consommation PARTIELLE — dérive sur le reste d\'un lot entamé', () => {
    // Complète le bloc précédent, qui vide intégralement ses lots : ici le
    // lot est ENTAMÉ, pas vidé. 3870.70 - 2089.67 vaut 1781.0299999999997 en
    // flottant JS, pas 1781.03 — la soustraction dérive réellement.
    //
    // Ce que la mutation a établi sur les DEUX arrondis de debitInTransaction :
    //   - `remaining = Math.round(remaining * 100) / 100` (accumulateur) est
    //     porteur : le neutraliser fait échouer le bloc précédent.
    //   - `newRemaining = Math.round(...)` ne l'est pas, et ne PEUT pas
    //     l'être : sa valeur n'est utilisée que pour (a) l'écriture en base,
    //     où numeric(14,2) arrondit de toute façon à 1781.03, et (b) le test
    //     `=== 0`, qui n'est atteint que sur un lot intégralement vidé — cas
    //     où la soustraction porte sur deux opérandes égaux, donc toujours
    //     exacte en IEEE 754. C'est de la défense en profondeur non
    //     observable, pas une ligne non testée : aucun test ne peut la
    //     distinguer, et en écrire un qui le prétendrait serait malhonnête.
    //
    // Ce bloc couvre donc ce qu'il peut réellement couvrir : qu'une
    // consommation partielle conserve un reste exact au centime et laisse le
    // lot actif.
    let partialUserId;
    let partialLotId;

    beforeAll(async () => {
      partialUserId = await insertUser();

      cleanup.trackSql('DELETE FROM wallets WHERE user_id = $1', [partialUserId]);
      cleanup.trackSql(
        'DELETE FROM wallet_transactions WHERE wallet_id = (SELECT id FROM wallets WHERE user_id = $1)',
        [partialUserId]
      );
      cleanup.trackSql(
        'DELETE FROM wallet_credit_lots WHERE wallet_id = (SELECT id FROM wallets WHERE user_id = $1)',
        [partialUserId]
      );
      cleanup.trackSql(
        `DELETE FROM wallet_consumptions WHERE transaction_id IN
           (SELECT id FROM wallet_transactions WHERE wallet_id = (SELECT id FROM wallets WHERE user_id = $1))`,
        [partialUserId]
      );

      const { lot } = await walletService.credit(db, {
        userId: partialUserId, amountKmf: 3870.70, reason: 'e2e_partial_drift_setup',
      });
      partialLotId = lot.id;
    });

    test('un lot partiellement consommé garde un reste exact et reste actif', async () => {
      await walletService.debit(db, {
        userId: partialUserId, amountKmf: 2089.67, reason: 'e2e_partial_drift_consume',
        referenceId: uuid(),
      });

      const { rows: [lot] } = await db.query(
        'SELECT remaining_kmf, status FROM wallet_credit_lots WHERE id = $1',
        [partialLotId]
      );
      // Sans arrondi sur newRemaining, la colonne stockerait bien 1781.03
      // (Postgres arrondit à l'écriture) — mais le JS aurait manipulé
      // 1781.0299999999997, et c'est cette valeur-là qui est écrite puis
      // relue. L'assertion porte donc sur l'exactitude au centime.
      expect(lot.remaining_kmf).toBe(1781.03);
      expect(lot.status).toBe('active');
    });

    test('le solde wallet après consommation partielle est exact au centime', async () => {
      const balance = await walletService.getBalance(partialUserId);
      expect(balance).toBe(1781.03);
    });
  });
});
