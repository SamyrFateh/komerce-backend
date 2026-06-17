# Réconciliation & reprise automatique (2026-06-16)

> Réponse au point : *« il faut un processus de réconciliation et de reprise automatique
> quand la DB est corrigée ou que les fichiers sont taggés correctement, sinon ça bloque
> et la whitelist est compliquée. »* — c'était un vrai défaut : **résoudre** un bug obligeait
> à éditer le JSON à la main, et tant que ce n'était pas fait, la porte bloquait.

## 1. Le principe

**Résoudre est automatique ; supprimer reste un acte humain.** C'est l'asymétrie clé :

- Quand une fiction disparaît (table créée en base **ou** header re-taggé), ou qu'une table
  est documentée, le budget se **recale tout seul**.
- En revanche, *masquer* un nouveau bug (ajouter à l'allowlist, relever le cliquet) reste un
  geste humain explicite. La reprise auto ne peut donc **jamais** cacher une régression.

## 2. Ce qui a été ajouté

- **`scripts/lib/arch-drift-core.js`** — noyau partagé. La définition de
  *fiction / fantôme / non-documenté* vit désormais à **un seul endroit**, consommé par la
  porte ET le réconciliateur : ils ne peuvent plus diverger.
- **`scripts/arch-reconcile.js`** — le moteur de reprise :
  - élague les entrées d'allowlist dont la fiction a disparu ;
  - abaisse le cliquet `liveTablesUndocumented` à la mesure réelle (jamais ne le relève) ;
  - n'ajoute **jamais** d'entrée, ne masque **jamais** un nouveau bug ;
  - 3 modes : `dry-run` (montre le plan), `--write` (applique), `--check` (CI : échoue si
    le budget n'est pas à jour, avec le remède exact).
- **`scripts/arch-schema-drift-check.js`** — refactoré sur le noyau. Sur une entrée résolue,
  au lieu de bloquer sèchement sur « liste périmée », il **pointe vers reconcile**.
- **Hook `pre-commit`** (via `scripts/setup-hooks.sh`) — la reprise réellement automatique :
  à chaque commit, régénère le graphe, lance `arch-reconcile --write`, re-stage les
  artefacts, et ne bloque que sur un vrai problème non résoluble. Plus aucune édition JSON.
- **CI** (`governance.yml`) — étape « Budget reconcilié ? » (`arch-reconcile --check`) avant
  la porte de drift : si un correctif a oublié de réconcilier, message actionnable.
- **`package.json`** — `arch:drift`, `arch:reconcile`, `arch:reconcile:check`, `arch:gate`.

## 3. Les deux chemins de correction (tous deux auto-réconciliés)

1. **DB corrigée** : tu appliques la migration, tu rafraîchis le dump
   (`pg_dump --schema-only > docs/db/railway-live-schema.sql`). La table existe maintenant
   → la fiction disparaît → reconcile élague l'entrée. *(C'est ce que tu as fait pour
   `shared_cart_commitments`.)*
2. **Fichier re-taggé / code corrigé** : tu renommes la table dans le code+header, tu
   régénères le graphe. Le header ne nomme plus la table fictive → fiction disparue →
   reconcile élague. *(C'est ce que tu as fait pour `stripe_events_log` →
   `stripe_events_processed`.)*

## 4. Flux concret pour l'équipe

```
# Tu corriges un drift (DB ou header). Puis simplement :
git commit ...        # le hook pre-commit régénère + réconcilie + re-stage tout seul
# -> commit passe si tout est résolu ; bloque seulement s'il reste un vrai bug.

# Sans hook (ou en CI local), à la main mais en une commande :
npm run arch:reconcile          # dry-run : montre ce qui sera recalé
npm run arch:reconcile -- --write   # applique
npm run arch:gate               # gen + hygiène + drift, tout enchaîné
```

## 5. Garanties (vérifiées)

| Situation | Comportement |
|---|---|
| Fiction résolue, entrée non élaguée | reconcile l'élague ; commit passe automatiquement |
| Cliquet trop haut (ex. 5, réel 0) | reconcile l'abaisse à 0 |
| **Nouvelle** fiction hors liste | reconcile **ne l'ajoute pas** ; porte + hook bloquent |
| Cliquet réellement dépassé | reconcile **ne le relève pas** ; reste bloquant |
| Budget désynchronisé en CI | `arch-reconcile --check` échoue avec le remède exact |

## 6. La boucle complète — `npm run db:snapshot` / `db:sync`

La seule étape qui restait manuelle (rafraîchir le dump après une correction DB) est
maintenant outillée. `scripts/db-snapshot.js` régénère `docs/db/railway-live-schema.sql`
depuis `DATABASE_URL` via `pg_dump --schema-only`, avec trois garde-fous :

- **neutralise** les jetons aléatoires `\restrict`/`\unrestrict` de pg_dump ≥ 18 (sinon chaque
  snapshot produit un diff parasite) ;
- **refuse d'écraser** le dump committé si le nouveau a moins de `MIN_TABLES` tables (protège
  contre un dump partiel / une connexion coupée) ;
- écriture **atomique**, et affiche le **diff des tables** ajoutées / retirées.

```
npm run db:snapshot              # rafraîchit le dump (montre +/- tables)
npm run db:snapshot -- --dry-run # voir le diff sans écrire
npm run db:sync                  # LA BOUCLE : snapshot -> reconcile --write -> gate
```

Ainsi le cycle complet se referme sans quitter le terminal :

```
   migration appliquée en base
            │
            ▼
   npm run db:sync
            │
   ┌────────┴───────────────────────────────────────┐
   │ 1. db:snapshot    → dump live rafraîchi          │
   │ 2. arch:reconcile → budget recalé (auto)         │
   │ 3. arch:gate      → hygiène + drift vérifiés      │
   └────────┬───────────────────────────────────────┘
            ▼
   vert si tout est cohérent, sinon bloque sur le vrai reste
```

## 7. État final

```
1. hygiène headers      : VERT
2. drift SCHEMA<->live   : VERT   (101 tables live, 0 fiction, 0 fantôme, cliquet 0)
3. budget reconcilié     : VERT
Graphe : déterministe (md5 stable).
```
