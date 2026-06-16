# Blindage gouvernance — base 0 (2026-06-16)

> Suite à l'audit `AUDIT_BLINDAGE_GOUVERNANCE_2026-06-16.md`. Débloqué par l'arrivée du
> `pg_dump` live (`railway-live-schema-2026-06-16.sql`, 99 tables, PostgreSQL 18.4).

## 1. Principe

Le bruit n'est plus **budgété** : il est **éliminé à la source**, puis ce qui reste est du
signal réel, nommé, et ne peut que diminuer. Chaque règle de la doctrine a désormais un
contrôle qui **sort en code non nul** (principe directeur §4 de l'audit).

## 2. Ce que la confrontation au schéma live a prouvé

- **Fantômes SCHEMA.md : 0.** Les 47 « tables documentées absentes » du diff naïf étaient
  des vues (`v_*`), triggers (`trg_*`), ENUMs, fonctions et contraintes CHECK — comparés au
  bon type d'objet, ils existent tous. SCHEMA.md ne sur-déclare rien.
- **Dette DB réelle : 5 tables** vivantes non cataloguées, désormais ajoutées à `SCHEMA.md`
  depuis leur DDL live : `cost_benchmarks`, `paypal_events_processed`,
  `pickup_verify_attempts`, `revoked_tokens`, `shared_cart_estimations`.
- **`@unknown` en db-read/write : 0.** `wallet` (singulier, §2.2) : disparu.
- **2 vraies fictions sur du code paiement** (voir §5).

## 3. Le verrou : `scripts/arch-schema-drift-check.js`

Comble l'angle mort §2.6 : jusqu'ici rien ne comparait `SCHEMA.md` ni les headers `@db-*`
à la base réelle. Le contrôle confronte les **tokens de table des headers** et le
**catalogue SCHEMA.md** au **dump live** `docs/db/railway-live-schema.sql`. Trois tiers :

| Tier | Constat | Effet |
|---|---|---|
| **Fiction** | un header nomme une table absente de tout objet live | bloquant, sauf liste blanche nommée |
| **Fantôme** | SCHEMA.md catalogue un nom absent du live | bloquant (cible 0, atteinte) |
| **Cliquet** | table base live hors catalogue SCHEMA.md | plafond qui ne peut que baisser (à 0) |

Dépendance-zéro, `process.exit(1)` réel. Mode `--report` pour observation.

## 4. Budget v2 — `scripts/arch-debt-budget.json`

Fini le gel de bruit (`28 / 448 / 43`). Trois sections :

- **`knownDriftAllowlist`** — liste **nominative** (pas un compteur) des fictions connues,
  chacune avec preuve et chemin de résolution. Empêche la **substitution** d'un bug par un
  autre (un simple compteur `=2` ne le ferait pas). Une entrée périmée est elle-même
  bloquante → force le nettoyage. Objectif : liste vide.
- **`ratchet.liveTablesUndocumented: 0`** — refermé après ajout des 5 tables.
- **`observedOnly`** — `deadEdges`, `unknownDynamicSql`, `doctrineTxnPresence` : mesurés,
  jamais bloquants. (L'ancien « txn argent non résolue = 43 » était la **présence** d'un
  invariant doctrine = sain ; reclassé, ce n'était pas un défaut.)

## 5. Action humaine requise (2 vrais défauts — non corrigés, par doctrine)

Le contrôle a révélé deux divergences **code ↔ DB** sur des flux argent. La doctrine
interdit la correction silencieuse : elles sont **figées et nommées**, à arbitrer.

1. **`stripe_events_log`** (`services/shared-cart-queries.js`) — la table live est
   `stripe_events_processed` (mêmes colonnes). Le code fait en plus `SELECT id` alors que la
   PK est `stripe_event_id`. Le chemin d'idempotence Stripe est **cassé contre la DB live**.
   Correctif probable : renommer la table + corriger la colonne sélectionnée.
2. **`shared_cart_commitments`** (`services/shared-cart-commitment-service.js`) — table
   **absente** du dump live, mais `INSERT/UPDATE/SELECT` dessus. Soit la migration n'a jamais
   été appliquée, soit c'est du code mort. À trancher.

Dès qu'un défaut est résolu, retirer son entrée de `knownDriftAllowlist` : le contrôle
exigera alors que la fiction ait disparu.

## 6. Corrections secondaires

- **§2.5 (angles morts)** : `core/` et `validators/` ajoutés à `SCAN_ROOTS` ; parser durci
  pour ignorer un **shebang** en tête (un script CLI ne pouvait pas être vu) ; headers
  ajoutés à `validators/index.js` et `core/test-whatsapp-notifications.js` (db `none`).
- **`arch-db-check.js`** : recentré sur l'hygiène structurelle des headers ; tokens fantômes
  `the`/`machine` retirés de `SQL_NOISE` ; dettes-bruit converties en observé ; code mort
  supprimé ; son propre header rendu conforme.
- **CI** : étape « Schema drift vs live DB (bloquant) » ajoutée à `governance.yml`.

## 7. À ajouter à `package.json` (absent du zip)

```json
"arch:drift": "node scripts/arch-schema-drift-check.js",
"arch:drift:report": "node scripts/arch-schema-drift-check.js --report"
```

## 8. Maintenance

- Rafraîchir le schéma live : `pg_dump --schema-only > docs/db/railway-live-schema.sql`,
  commit. Le contrôle se recale automatiquement.
- Après tout changement de header : `npm run arch:gen` puis commit des `docs/komerce-arch-*`
  (la CI bloque sinon).

## 9. État final (vérifié)

```
Porte 1 (hygiène) : 237 scannés, 0 sans header, 0 lite sans owner, 0 mots-clefs SQL.
Porte 2 (drift)   : 0 fiction hors liste, 2 figées (nommées), 0 fantôme, 0 table non doc.
Les deux portes : EXIT 0.
```
