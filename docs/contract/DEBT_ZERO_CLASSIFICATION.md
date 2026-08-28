# Debt Zero — Feature Classification

Date: 2026-08-27

## Objectif

Fermer l'intégralité des warnings `feature-classification-check` sans modifier le runtime métier et sans contredire l'ontologie O2 du Business Feature Graph.

## Résultat

Avant ce lot :

- 27 manifests analysés ;
- 19 classifiés ;
- 8 non classifiés ;
- 12 warnings de classification dans `GATE_FINDINGS`.

Après ce lot :

- **27/27 manifests classifiés** ;
- **0 erreur** ;
- **0 warning** ;
- **0 non-classifié** ;
- **0 finding `gate:feature-classification-check`** dans `docs/GATE_FINDINGS.json`.

## Classifications ajoutées

- `auth` → `technical-transversal`
- `customs` → `business-feature`
- `economic-engine` → `business-feature`
- `inventory` → `business-feature`
- `logistics` → `business-feature`
- `payments` → `business-feature`
- `refunds` → `business-transversal`
- `sourcing` → `business-feature`

Les rationales trop courtes de `auth-identity`, `auth-passkey` et `catalog` ont été complétées. Les effets externes de `payments`, `purchasing` et `refunds` disposent désormais d'un invariant textuel explicite d'idempotence / rejeu.

## Réconciliation Auth / Infrastructure

La doctrine Feature cite explicitement `auth` comme `technical-transversal` et réserve `technical-foundation` au socle qui possède le DDL et les migrations techniques.

Les migrations suivantes créent la primitive technique `revoked_tokens` utilisée par les gardes de session :

- `migrations/072_jwt_revocation.sql`
- `migrations/084_jwt_revocation.sql`

Elles étaient historiquement déclarées dans `auth`, ce qui rendait impossible de satisfaire simultanément le checker de classification et la baseline O2. Leur ownership de fichier est désormais rattaché à `infrastructure`, tandis que `auth` reste consommateur de la primitive de révocation.

Aucune migration SQL n'est modifiée ni rejouée par ce lot : seul son ownership dans les manifests change.

## Preuve dédiée

Workflow `Debt Zero classification v2`, run `33088765427` :

- Feature Classification : **27/27, 0 erreur, 0 warning** ;
- Business Feature Graph : **0 contradiction O2, 0 debt/drift** ;
- `GATE_FINDINGS` : 18/18 sources attribuables, **0 finding classification** ;
- Feature Registry : propre ;
- Feature Guard : 0 erreur / 0 warning ;
- Feature 360 : check vert ;
- Quality Gate : vert ;
- Contract Check : vert ;
- Security 360 freshness : vert ;
- `git diff --check` : vert.

## Non-changement runtime

Ce lot ne modifie aucune route HTTP, requête SQL, migration SQL, logique métier, règle UI ou autorité de mutation. Il ferme exclusivement une dette d'ontologie et de gouvernance.
