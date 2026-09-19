'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * tests/integration/business-rules-cache-real-db.test.js
 *
 * Feature propriétaire : business-rules
 *
 * Contexte : cette feature transversale ("Detenir le referentiel des
 * regles metier parametrables, versionner chaque changement, et servir a
 * toute feature la valeur en vigueur avec un repli garanti sur la valeur
 * codee en dur") n'avait que 2 fichiers de test, tous deux avec un
 * `db.query` entièrement MOQUÉ (tests/unit/rules-engine.test.js,
 * tests/unit/admin-rules.test.js — 33 + ~15 cas, bien construits mais
 * mockés). Utile pour la logique JS, structurellement incapable de
 * prouver le comportement du seul élément vraiment risqué de ce module :
 * le cache mémoire AU NIVEAU DU PROCESS (`_cache`/`_cacheAt`, variables de
 * module, pas par-requête).
 *
 * Ce que les mocks ne peuvent pas prouver :
 *   1. Que le cache tient réellement 60s — un mock peut simuler
 *      Date.now() ; il ne peut pas prouver que deux appels consécutifs à
 *      travers une vraie fenêtre temporelle voient la même valeur en
 *      mémoire malgré un changement DB concurrent.
 *   2. Que `updateRule()` invalide bien le cache pour DE VRAI (pas
 *      seulement que `invalidateCache` a été appelé côté mock).
 *   3. Que les contraintes min/max de `updateRule()` sont vérifiées
 *      contre de vraies colonnes numeric (pas un objet JS simulé).
 *   4. Que `business_rules_history` est réellement peuplé avec les bonnes
 *      valeurs old/new après un UPDATE réel.
 *
 * Chaque scénario utilise une clé dédiée e2e_test_* pour ne jamais
 * toucher les vraies règles seedées par les migrations (033/095/098/115/
 * 118) ni par un autre run parallèle.
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('BUSINESS_RULES CACHE — REAL_DB proofs — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const crypto = require('crypto');
  const db = require('../../db');

  jest.setTimeout(20000);

  const RUN_TAG = `e2e_test_${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
  const insertedRuleIds = [];

  async function seedRule({ suffix, category = 'system', valueType = 'number', value, min = null, max = null }) {
    const key = `${RUN_TAG}_${suffix}`;
    const { rows: [row] } = await db.query(
      `INSERT INTO business_rules (category, key, value, value_type, label_fr, min_value, max_value, is_active)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, TRUE)
       RETURNING id, key`,
      [category, key, JSON.stringify({ value }), valueType, `E2E ${suffix}`, min, max]
    );
    insertedRuleIds.push(row.id);
    return { key, id: row.id };
  }

  async function directDbValue(key) {
    const { rows: [row] } = await db.query('SELECT value FROM business_rules WHERE key = $1', [key]);
    return row?.value?.value;
  }

  afterAll(async () => {
    if (insertedRuleIds.length) {
      await db.query(
        'DELETE FROM business_rules_history WHERE rule_id = ANY($1::uuid[])',
        [insertedRuleIds]
      ).catch(() => {});
      await db.query(
        'DELETE FROM business_rules WHERE id = ANY($1::uuid[])',
        [insertedRuleIds]
      ).catch(() => {});
    }
  });

  describe('utils/rules.js — cache mémoire process + fallback (REAL_DB)', () => {
    it('1 — cache froid : getRule() lit la vraie valeur DB, pas le defaultValue', async () => {
      const { invalidateCache, getRule } = require('../../utils/rules');
      invalidateCache(); // point de départ déterministe, indépendant de l'ordre des tests

      const { key } = await seedRule({ suffix: 'cold_read', value: 42 });

      const result = await getRule(key, 999);
      expect(result).toBe(42);
    });

    it("2 — FRAÎCHEUR DU CACHE : un changement DB direct n'est PAS vu tant que le cache n'est pas invalidé", async () => {
      const { invalidateCache, getRule } = require('../../utils/rules');
      invalidateCache();

      const { key } = await seedRule({ suffix: 'stale_window', value: 10 });

      const firstRead = await getRule(key, 0);
      expect(firstRead).toBe(10);

      // Modification DIRECTE en base, hors du chemin updateRule() — donc
      // sans invalidation de cache. Le cache mémoire du process ne peut
      // pas "deviner" ce changement.
      await db.query(
        `UPDATE business_rules SET value = $1::jsonb WHERE key = $2`,
        [JSON.stringify({ value: 20 }), key]
      );
      expect(await directDbValue(key)).toBe(20); // la DB a bien changé...

      const secondRead = await getRule(key, 0);
      expect(secondRead).toBe(10); // ...mais le cache process sert encore l'ancienne valeur

      invalidateCache();
      const thirdRead = await getRule(key, 0);
      expect(thirdRead).toBe(20); // après invalidation explicite, valeur fraîche
    });

    it('3 — clé inexistante avec DB parfaitement joignable → fallback sur defaultValue', async () => {
      const { invalidateCache, getRule } = require('../../utils/rules');
      invalidateCache();

      const result = await getRule(`${RUN_TAG}_never_seeded`, 'DEFAULT_MARKER');
      expect(result).toBe('DEFAULT_MARKER');
    });

    it('4 — updateRule() : transaction réelle, historique peuplé, cache auto-invalidé', async () => {
      const { invalidateCache, getRule, updateRule } = require('../../utils/rules');
      invalidateCache();

      const { key, id } = await seedRule({ suffix: 'update_cycle', value: 100 });

      // Peuple le cache AVANT le update, pour prouver que updateRule()
      // invalide vraiment (sinon ce test passerait même si l'invalidation
      // interne à updateRule() était supprimée par erreur).
      expect(await getRule(key, 0)).toBe(100);

      const updated = await updateRule(key, 250, null, 'E2E test change');
      expect(updated.value.value).toBe(250);

      // Sans appel manuel à invalidateCache() : la seule garantie vient de
      // updateRule() lui-même.
      const afterUpdate = await getRule(key, 0);
      expect(afterUpdate).toBe(250);

      const { rows: history } = await db.query(
        'SELECT old_value, new_value, change_reason FROM business_rules_history WHERE rule_id = $1',
        [id]
      );
      expect(history).toHaveLength(1);
      expect(history[0].old_value.value).toBe(100);
      expect(history[0].new_value.value).toBe(250);
      expect(history[0].change_reason).toBe('E2E test change');
    });

    it('5 — updateRule() applique réellement les contraintes min/max numeric de la colonne', async () => {
      const { invalidateCache, updateRule } = require('../../utils/rules');
      invalidateCache();

      const { key } = await seedRule({ suffix: 'bounded', value: 50, min: 10, max: 100 });

      await expect(updateRule(key, 5, null, 'trop bas')).rejects.toThrow(/minimum/i);
      await expect(updateRule(key, 500, null, 'trop haut')).rejects.toThrow(/maximum/i);

      // La valeur n'a pas bougé en base malgré les deux tentatives rejetées.
      expect(await directDbValue(key)).toBe(50);
    });

    it('6 — updateRule() rejette un type incohérent avec value_type de la vraie colonne', async () => {
      const { invalidateCache, updateRule } = require('../../utils/rules');
      invalidateCache();

      const { key } = await seedRule({ suffix: 'typed_bool', valueType: 'boolean', value: true });

      await expect(updateRule(key, 'pas un booleen', null, 'type invalide')).rejects.toThrow(/boolean/i);
      expect(await directDbValue(key)).toBe(true);
    });

    it('7 — resetRule() restaure la toute première valeur historisée via updateRule() réel', async () => {
      const { invalidateCache, updateRule, resetRule, getRule } = require('../../utils/rules');
      invalidateCache();

      const { key } = await seedRule({ suffix: 'resettable', value: 7 });

      await updateRule(key, 77, null, 'premier changement');
      await updateRule(key, 777, null, 'second changement');
      expect(await getRule(key, 0)).toBe(777);

      await resetRule(key, null);
      // La toute première ligne d'historique porte old_value = 7 (valeur
      // d'origine, avant le tout premier updateRule()).
      expect(await getRule(key, 0)).toBe(7);
    });

    it('8 — appels concurrents sur cache froid : aucune erreur, valeur cohérente pour tous', async () => {
      const { invalidateCache, getRule } = require('../../utils/rules');
      invalidateCache();

      const { key } = await seedRule({ suffix: 'concurrent_cold', value: 999 });

      // Trois lectures concurrentes qui partent toutes avant que la
      // première n'ait fini de peupler le cache — aucune ne doit
      // planter, et toutes doivent converger vers la même valeur.
      const results = await Promise.all([
        getRule(key, -1),
        getRule(key, -1),
        getRule(key, -1),
      ]);
      expect(results).toEqual([999, 999, 999]);
    });
  });
}
