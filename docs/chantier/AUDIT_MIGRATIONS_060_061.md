# A4 — Audit migrations 060/061

> Date : 2026-05-19  
> Scope : documentation uniquement  
> Branche de référence : `main`  
> Verdict : **dette réelle mais non bloquante au boot actuel**

---

## 1. Résumé exécutif

L'audit initial avait identifié deux collisions de préfixes dans `migrations/` :

```text
060.sql
060_add_pending_at_confirmed_at.sql
061.sql
061_boutique_categories.sql
```

Cette collision est une **dette réelle de gouvernance des migrations**, car elle peut provoquer une confusion lors d'exécutions manuelles ou si un futur runner SQL parcourt le dossier par préfixe numérique.

En revanche, elle n'est **pas bloquante pour le boot actuel** : le runner actif ne parcourt pas automatiquement les fichiers `.sql` de `migrations/` ou `db/migrations/`.

---

## 2. Sources vérifiées

### 2.1 Audit initial

`docs/BACKEND_AUDIT.md` signale explicitement :

```text
db/migrations/   : 10 fichiers, numérotés 004 → 013
migrations/      : 53 fichiers, numérotés 014 → 065
+ collision : 060.sql ET 060_add_pending_at_confirmed_at.sql
+ collision : 061.sql ET 061_boutique_categories.sql
```

Il classe ce point en cohérence DB faible/moyenne, avec risque si le runner tape dans les dossiers SQL.

### 2.2 A5 — clarification des dossiers migrations

`docs/chantier/MIGRATIONS_FOLDERS_A5.md` établit que :

- le runner de migration actif est `scripts/migrate.js` ;
- ce runner ne parcourt pas automatiquement les fichiers `.sql` des dossiers `migrations/` ou `db/migrations/` ;
- les fichiers SQL doivent être considérés comme historique / documentation de schéma tant qu'aucun runner ne les lit explicitement.

### 2.3 Runner actif

`scripts/migrate.js` exécute :

```js
await fixAdminHash();
await fixMissingSchema();
await runAllSeeds();
```

Il n'y a pas de boucle de lecture automatique de fichiers SQL dans ce runner.

### 2.4 Boot Railway observé

Le rapport P0 indique que Railway démarre correctement et que les migrations background visibles passent. Cela confirme que les collisions 060/061 ne cassent pas le boot actuel.

---

## 3. Classification A4

| Élément | Classification | Décision |
|--------|----------------|----------|
| `060.sql` + `060_add_pending_at_confirmed_at.sql` | Collision documentaire / dette future | Ne pas renommer sans preuve d'exécution/non-exécution |
| `061.sql` + `061_boutique_categories.sql` | Collision documentaire / dette future | Ne pas renommer sans preuve d'exécution/non-exécution |
| `db/migrations/` vs `migrations/` | Double historique | Ne pas fusionner maintenant |
| Runner JS actuel | Non bloquant | Garder inchangé |
| Boot Railway | OK | Aucun hotfix nécessaire |

---

## 4. Risque réel

Le risque n'est pas le boot actuel.

Le risque réel est futur :

1. un développeur exécute manuellement les fichiers SQL dans un ordre ambigu ;
2. un futur runner SQL trie les fichiers par préfixe numérique et rencontre deux `060` ou deux `061` ;
3. un agent croit que `060.sql` est la migration canonique alors que `060_add_pending_at_confirmed_at.sql` contient un correctif plus précis ;
4. une documentation ou un script de bootstrap se met à référencer le mauvais fichier.

---

## 5. Ce qu'il ne faut pas faire maintenant

Ne pas :

- supprimer `060.sql` ou `061.sql` ;
- renommer les fichiers déjà mergés ;
- fusionner les dossiers `db/migrations/` et `migrations/` ;
- créer un runner SQL automatique sans audit complet ;
- déplacer ces SQL dans une archive sans savoir lesquels ont été appliqués manuellement.

Raison : une migration peut avoir été appliquée manuellement hors runner. Renommer ou supprimer une migration historique peut détruire la traçabilité.

---

## 6. Recommandation opérationnelle

A4 est clôturable en **documentation uniquement** avec la règle suivante :

> Les collisions 060/061 sont reconnues comme dette non bloquante.  
> Le runner actuel ne les exécute pas automatiquement.  
> Toute future migration SQL doit éviter les préfixes déjà utilisés et documenter son mode d'exécution.

Pour une correction technique ultérieure, ouvrir un lot dédié :

```text
MIGRATIONS-RUNNER-1 — normaliser la stratégie migrations SQL
```

Ce futur lot devrait :

1. inventorier tous les fichiers `db/migrations/` et `migrations/` ;
2. vérifier côté base quelles migrations ont réellement été appliquées ;
3. créer une table `schema_migrations` si absente ;
4. choisir une seule convention de dossier ;
5. archiver les SQL purement historiques ;
6. empêcher les collisions par script CI.

---

## 7. Garde-fou recommandé avant toute nouvelle migration

Avant d'ajouter une nouvelle migration SQL :

```text
1. Ne pas utiliser un préfixe déjà existant.
2. Préférer un préfixe strictement supérieur au max existant.
3. Nommer explicitement le domaine : NNN_domain_action.sql.
4. Documenter si la migration est :
   - historique ;
   - manuelle ;
   - intégrée au runner JS ;
   - future runner SQL.
5. Ne jamais modifier une migration déjà mergée sans note explicite.
```

---

## 8. Verdict final A4

```text
A4 = ✅ clôturé côté diagnostic
A4 = pas de changement code
A4 = pas de changement DB
A4 = dette reconnue, non bloquante au boot actuel
```

La suite logique n'est pas de corriger 060/061 immédiatement, mais de traiter F1A ou H1 plan, sauf si P0 runtime révèle un incident lié aux migrations.
