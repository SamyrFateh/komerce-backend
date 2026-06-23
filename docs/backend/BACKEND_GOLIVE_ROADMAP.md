# Komerce Backend — Roadmap de Consolidation Pré-Go-Live

> **Document maître marquable.** Chaque case ☐ devient ☑️ (ou ✅) une fois la tâche
> validée en prod (PR mergée + tests verts + audit passe).
>
> **Mode d'emploi pour Sonnet (ou tout agent IA)** :
> 1. Choisir un seul lot (jamais plus) parmi ceux non cochés
> 2. Vérifier qu'aucun lot prérequis n'est en cours
> 3. Lire la fiche complète du lot avant de coder
> 4. Produire UNE PR par lot, suivant le `commit_template` ci-dessous
> 5. Cocher la case dans ce document **dans la même PR** que le code
> 6. Si le scope déborde : créer un nouveau lot, ne pas étendre celui en cours
>
> **Mode d'emploi pour relire l'état** :
> Cherche `☐` (non fait), `🚧` (en cours, PR ouverte), `✅` (validé en prod).
> Le score global est en §0.
>
> **Cible** : être prêt pour un go-live serein, avec le sourcing comme moteur
> central des évolutions futures (gestion des stocks, allocation des marges,
> intelligence portefeuille).

---

## §0 — Score global d'avancement

> **Mis à jour 17 mai 2026 — lot H-SYNC** : synchronisation avec `docs/chantier/STATUS.md` et vérification dans le code.

| Bloc | Lots ☐ | Lots 🚧 | Lots ✅ | % |
|---|---:|---:|---:|---:|
| A — Hygiène code & DB | 0 | 0 | 7 | 100 % |
| B — Architecture modulaire | 6 | 0 | 0 | 0 % |
| C — Sourcing & offre (cible business) | 7 | 0 | 0 | 0 % |
| D — Sécurité & secrets | 0 | 0 | 8 | 100 % |
| E — Tests & couverture | 6 | 0 | 0 | 0 % |
| F — Observabilité & ops | 2 | 0 | 5 | 71 % |
| G — Flows business critiques | 5 | 0 | 0 | 0 % |
| H — Gouvernance & garde-fous | 4 | 1 | 0 | 0 % (H3 en cours) |
| **TOTAL** | **30** | **1** | **20** | **39 %** |

Mettre à jour ce tableau à chaque PR mergée. **Règle (lot H-SYNC) : ce tableau et `docs/chantier/STATUS.md` doivent être mis à jour dans la même PR que le code.**

Lots ✅ détaillés : A1, A3, A5, A6, A7, D1 (audit), D3 (audit), D4 (audit), D5 (audit partiel), D6 (audit) + hotfix D0 hors roadmap initiale.

Lots socle hors numérotation initiale : SOCLE-1 (4 docs socle), SOCLE-2 (CARTOGRAPHY aligné), SOCLE-3 (server.js documenté) — voir `STATUS.md`.

---

## §0bis — Conventions communes à tous les lots

### Format de PR

```
Branche : chore/backend-{bloc}{numéro}-{kebab-slug}    (ex: chore/backend-A1-orphan-files)
        ou fix/backend-{bloc}{numéro}-{kebab-slug}     (selon nature)
        ou refacto/backend-{bloc}{numéro}-{kebab-slug}

Titre   : {type}(backend): {résumé court} ({bloc}{numéro})

Body    : ## Quoi
          ## Pourquoi
          ## ZONE_IMPACT (les 6 questions du protocole)
          ## Tests effectués
          ## Coche associée dans BACKEND_GOLIVE_ROADMAP.md
```

### Règles non-négociables (à rappeler à chaque session)

- 🔒 **NE JAMAIS** modifier `services/order-status-machine.js` sans review explicite humain
- 🔒 **NE JAMAIS** modifier les migrations déjà mergées sur main (ajouter une nouvelle migration)
- 🔒 **NE JAMAIS** désactiver une règle d'audit pour "faire passer le test" — créer une allowlist justifiée à la place
- 🔒 **NE JAMAIS** étendre le scope d'un lot en cours — créer un nouveau lot
- 🔒 **TOUJOURS** lancer `npm test` avant de pousser
- 🔒 **TOUJOURS** mettre à jour ce document dans la même PR que le code

### Vérifications post-PR (par l'humain qui valide)

Pour chaque PR mergée, vérifier que :
1. La case a bien été cochée dans ce document
2. Les tests existants passent toujours
3. Aucune régression visible sur staging
4. Le delta d'audit (avant/après) est cohérent avec l'intention du lot

---

## §A — Hygiène code & DB (priorité immédiate, zéro risque métier)

**Pourquoi en premier** : ces lots suppriment des **pièges existants** sans toucher au comportement. Doublons fantômes, collisions migrations, fichiers orphelins. Un agent qui modifie le fantôme au lieu du vrai fichier croit avoir corrigé un bug en prod. C'est arrivé sur le boutique CSS, on ne refait pas l'erreur côté backend.

---

### ✅ A1 — Supprimer le fantôme `routes/orders/order-api-v2.js`

> **Fait le 17 mai 2026.** Le fichier `routes/orders/order-api-v2.js` n'existe plus dans le repo. Seul `routes/order-api-v2.js` (28 153 octets) subsiste et reste monté dans `server.js`.

**Charge** : 30 min  
**Risque** : nul (le fichier n'est pas chargé)

**Contexte** :
- `routes/order-api-v2.js` (28 153 octets) → monté dans `server.js` ligne ~X ✅
- `routes/orders/order-api-v2.js` (23 644 octets) → **jamais référencé** ❌

Quasi-identiques, diffèrent seulement sur l'encodage (BOM/latin-1 vs UTF-8 propre).

**Actions** :
1. Confirmer une dernière fois qu'aucun import ne pointe vers le fantôme :
   ```bash
   grep -rn "routes/orders/order-api-v2" --include="*.js"
   ```
2. Supprimer `routes/orders/order-api-v2.js`
3. Vérifier `npm test` passe
4. Cocher A1 ci-dessus

**PR** : `chore/backend-A1-remove-ghost-order-api-v2`

---

### ✅ A2 — Identifier et supprimer le doublon `parcels.js` *(audit 2026-06-23 — pas de doublon)*

**Audit 2026-06-23 — Conclusion : ce ne sont PAS des doublons, aucune suppression requise.**

Les deux fichiers ont des rôles distincts et sont montés à des préfixes différents :

- `routes/parcels.js` (569L) → monté `/api/parcels` via `bootstrap/api-routes.js` — CRUD colis (création, scan, poids, scellement, items, labels)
- `routes/orders/parcels.js` (156L) → monté `/api/orders/*` via `routes/orders.js` — actions colis liées à une commande (partial-ship, mark-availability, cancel-backorder)

La confusion vient du nom identique, pas du contenu.

---

### ✅ A3 — Déplacer `test_groupe_paiement.js` dans `tests/`

> **Fait le 17 mai 2026.** Déplacé vers `tests/integration/groupe-paiement.manual.js`. Script manuel, non intégré à Jest (suffixe `.manual.js` explicite).

**Charge** : 15 min  
**Risque** : nul

**Contexte** : `test_groupe_paiement.js` traîne à la racine du repo (10 472 octets, 30 avril). Ce devrait être dans `tests/integration/`.

**Actions** :
1. Vérifier comment il est exécuté (script ad-hoc ou via jest ?)
2. Si script ad-hoc : déplacer vers `tests/integration/groupe-paiement.test.js` et adapter au format Jest
3. Si déjà Jest-compatible : juste `git mv`
4. Vérifier qu'il tourne via `npm test`
5. Cocher A3

**PR** : `chore/backend-A3-move-groupe-paiement-test`

---

### ✅ A4 — Résoudre les collisions de migrations `060.sql` et `061.sql` *(audit 2026-06-23 — pas de collision)*

**Charge** : 1 h  
**Risque** : moyen — toucher aux migrations exige soin

**Contexte** :
```
migrations/060.sql                          ←  collision
migrations/060_add_pending_at_confirmed_at.sql

migrations/061.sql                          ←  collision
migrations/061_boutique_categories.sql
```

**Actions** :
1. Lire les 4 fichiers, comprendre si ce sont des duplicatas ou des migrations différentes
2. Identifier l'ordre de run du runner (probablement alphabétique → `060.sql` avant `060_add...`)
3. Vérifier sur staging si les deux ont été appliquées historiquement (regarder la table `schema_migrations` ou équivalent)
4. Renommer les collisions selon convention `NNN_description.sql` unique :
   - `060.sql` → `060a_xxx.sql` (selon contenu)
   - `061.sql` → `061a_xxx.sql`
5. **NE PAS** modifier le contenu, juste le nom
6. Tester la migration sur une DB vierge locale
7. Cocher A4

**PR** : `fix/backend-A4-migration-collisions-060-061`

⚠️ **Approbation humaine obligatoire avant merge.**

---

### ✅ A5 — Documenter / archiver `db/migrations/`

> **Fait le 17 mai 2026.** Livrable : `docs/chantier/MIGRATIONS_FOLDERS_A5.md`. Runner actif documenté : `scripts/migrate.js` ne parcourt pas les `.sql` automatiquement, exécute `fixAdminHash` + `fixMissingSchema` + `runAllSeeds`.

**Charge** : 45 min  
**Risque** : nul (juste de la doc)

**Contexte** : Tu as **deux dossiers de migrations**, `db/migrations/` (10 fichiers, 004-013) et `migrations/` (53 fichiers, 014-065).

**Actions** :
1. Identifier le runner de migrations dans le code (regarder `db.js`, `scripts/seed.js`, `scripts/fix-schema.js`, `package.json`)
2. Vérifier quel dossier est lu réellement par le runner
3. Cas 1 — `db/migrations/` est mort :
   - Renommer en `db/migrations.archive/` ou déplacer dans `docs/legacy/migrations/`
   - Ajouter un README.md dans le dossier archive expliquant l'historique
4. Cas 2 — `db/migrations/` est vivant :
   - Documenter pourquoi deux dossiers (séparation legacy vs nouvelle génération ?)
   - Ajouter une note dans `ARCHITECTURE.md`
5. Cocher A5

**PR** : `docs/backend-A5-clarify-migrations-folders`

---

### ✅ A6 — Nettoyer les 14 TODO en issues GitHub

> **Fait le 17 mai 2026.** Issue GitHub #387 créée comme backlog central. TODO backend principaux rattachés sans changement métier.

**Charge** : 30 min  
**Risque** : nul

**Actions** :
1. Lister les 14 TODO :
   ```bash
   grep -rEn "(TODO|FIXME|HACK|XXX|@todo)" --include="*.js" routes services utils middleware server.js
   ```
2. Pour chaque TODO :
   - Soit créer une issue GitHub avec le contexte et la référence fichier:ligne
   - Soit le supprimer si obsolète
   - Soit le résoudre directement si trivial
3. Ne laisser dans le code que des TODO avec référence à une issue (`TODO #143 : ...`)
4. Cocher A6

**PR** : `chore/backend-A6-todo-cleanup`

---

### ✅ A7 — Archiver les docs parasites et corriger `AGENTS.md`

> **Fait le 17 mai 2026.** Docs archivées dans `docs/_archive/` (GOVERNANCE.md, REPRISE_SESSION.md, ROADMAP_KOMERCE.md, etc.). `AGENTS.md` corrigé. Enrichi ultérieurement par lots SOCLE-1/2/3.

**Charge** : 20 min  
**Risque** : nul  
**Prérequis** : DOC-0 ✅ (référentiels figés avant d'archiver ce qui les contredit)

**Contexte** :  
Audit `docs/` du 2026-05-17 — 9 fichiers créent du bruit ou contredisent les référentiels. Un agent qui les lit peut croire reprendre un chantier d'avril, suivre un workflow Tasklet incompatible, ou utiliser des chiffres d'audit périmés.

**Parasites à archiver** :

| Fichier | Pourquoi |
|---------|----------|
| `docs/REPRISE_SESSION.md` | Point de reprise 7 avril — Parcel-Centric v15.13, obsolète |
| `docs/GOVERNANCE.md` | Workflow Tasklet (commit/10 min, autocommit) — incompatible avec le chantier |
| `docs/GOVERNANCE_BOOTSTRAP.md` | Bootstrap sous-agent Tasklet — inutilisable |
| `docs/AGENT_SUBAGENTS.md` | Instructions sous-agents Tasklet — inutilisable |
| `docs/AUDIT_REPORT.md` | Audit 06/04/2026 — chiffres dépassés |
| `docs/AUDIT_CONFORMITE_GOUVERNANCE.md` | Conformité AGENTS_PROTOCOL.md v1.5 — protocole disparu |
| `docs/ROADMAP_KOMERCE.md` | Roadmap v17.0 avril — remplacée par BACKEND_GOLIVE_ROADMAP.md |
| `docs/ROADMAP_KOMERCE_PROD_FINALE.md` | Go-live 8 mai — remplacée par BACKEND_GOLIVE_ROADMAP.md |
| `docs/INSTRUCTIONS.md` | Patch server.js — déjà appliqué dans le code |

**Actions** :

1. Créer le dossier d'archive :
   ```bash
   mkdir -p docs/_archive
   ```

2. Déplacer les 9 fichiers :
   ```bash
   git mv docs/REPRISE_SESSION.md              docs/_archive/
   git mv docs/GOVERNANCE.md                   docs/_archive/
   git mv docs/GOVERNANCE_BOOTSTRAP.md         docs/_archive/
   git mv docs/AGENT_SUBAGENTS.md              docs/_archive/
   git mv docs/AUDIT_REPORT.md                 docs/_archive/
   git mv docs/AUDIT_CONFORMITE_GOUVERNANCE.md docs/_archive/
   git mv docs/ROADMAP_KOMERCE.md              docs/_archive/
   git mv docs/ROADMAP_KOMERCE_PROD_FINALE.md  docs/_archive/
   git mv docs/INSTRUCTIONS.md                 docs/_archive/
   ```

3. Créer `docs/_archive/README.md` :
   ```markdown
   # Archive
   Documents retirés de l'index actif le 2026-05-17.
   Conservés pour historique uniquement — ne pas utiliser comme source de vérité.
   Sources de vérité actives :
   - docs/chantier/STATUS.md
   - docs/CARTOGRAPHY_360.md
   - docs/ZONE_IMPACT.md
   ```

4. Corriger `AGENTS.md` à la racine — ajouter en tête, avant toute autre règle :
   ```diff
   + ## 🚨 Point d'entrée backend — lire en premier
   +
   + 1. `docs/chantier/STATUS.md` — état du jour et prochain lot à exécuter
   + 2. `docs/CARTOGRAPHY_360.md` — architecture canonique
   + 3. `docs/ZONE_IMPACT.md` — 10 invariants absolus + checklist
   +
   + ---
   +
   ```

5. Vérifier `npm test` passe
6. Cocher A7 ci-dessus

**PR** : `chore/backend-A7-archive-parasitic-docs`

---

## §B — Architecture modulaire (extraire les "engines" des routes)

**Pourquoi** : tous tes "engines" (sourcing, economic, dashboard) vivent dans `routes/` avec leur logique métier inline. C'est non-testable, non-réutilisable. Cible : passer toutes les `routes/X-engine.js` → `services/X-engine.js`.

**Prérequis bloc A** : oui (sinon on travaille sur un repo avec des pièges).

---

### ☐ B1 — Extraire `routes/sourcing-engine.js` → `services/sourcing/`

**Charge** : 1-2 j  
**Risque** : moyen (extraction métier, à tester)

**Contexte** : 960 lignes, 8 routes, 7 fonctions métier inline, 31 requêtes DB. C'est le **point central** des évolutions sourcing.

**Actions** :
1. Lire les 960 lignes, identifier les responsabilités :
   - Analyse portefeuille (`analyzeProduct`, `getSales30d`)
   - Lecture config (`loadSourcingConfig`)
   - Enrichissement métadonnées (PUT routes)
   - Bulk-rail assignment
   - Variantes (Vague 3)
   - Normalisation cost/weight (helpers LOT I)
2. Créer la structure :
   ```
   services/sourcing/
     ├── index.js          # exports publics
     ├── analyzer.js       # analyzeProduct, getSales30d
     ├── reader.js         # loadSourcingConfig
     ├── enricher.js       # update metadata, bulk-rail
     ├── variants.js       # Vague 3
     └── normalizer.js     # helpers cost/weight
   ```
3. Migrer la logique fonction par fonction, en gardant la signature exacte
4. Réécrire `routes/sourcing-engine.js` en mode "mince" : chaque handler ~20 lignes, appelle un service
5. Lancer `npm test` (devrait passer car aucune route ne change)
6. Tester manuellement les 8 endpoints sur staging
7. Cocher B1

**PR** : `refacto/backend-B1-extract-sourcing-engine`

⚠️ **Le fichier `services/sourcing/` est le futur cœur des évolutions sourcing.** Soigner l'architecture interne.

---

### ☐ B2 — Extraire `routes/economic-engine.js` → `services/economic-engine.js`

**Charge** : 1 j  
**Risque** : moyen

**Contexte** : 808 lignes, même anti-pattern que sourcing.

**Actions** : reproduire B1 sur economic-engine. Le service final doit être testable indépendamment.

**PR** : `refacto/backend-B2-extract-economic-engine`

---

### ☐ B3 — Découper `routes/dashboard.js` (2 614 lignes)

**Charge** : 2-3 j  
**Risque** : moyen-élevé (gros fichier, beaucoup de routes admin)

**Contexte** : C'est le **plus gros fichier du repo**. Probablement composé de plusieurs sections : pilotage, stats, KPIs admin.

**Actions** :
1. Identifier les sections internes (lecture des en-têtes de routes)
2. Déterminer une stratégie de découpage :
   - Soit par responsabilité métier : `dashboard/{pilotage,stats,kpis,alertes}.js`
   - Soit suivre le pattern `orders/` (un fichier par sous-route)
3. Extraire les sections une par une, en gardant `dashboard.js` comme agrégateur mince (comme `routes/orders.js` qui fait 42 lignes)
4. Vérifier que `services/dashboard-metrics.js` (1 052 lignes) est bien utilisé partout, pas du code dupliqué

**PR** : `refacto/backend-B3-split-dashboard-route` (peut être plusieurs sous-PRs)

---

### ☐ B4 — Découper `routes/admin.js` (1 207 lignes)

**Charge** : 1-2 j  
**Risque** : moyen

**Contexte** : Suivre le pattern `routes/orders/`.

**Actions** :
1. Lister les sections internes
2. Créer `routes/admin/{rules,products,users,reset,…}.js`
3. `routes/admin.js` devient un agrégateur mince
4. Vérifier que la sécurité (`requireAdmin`) est bien appliquée à chaque sous-router

**PR** : `refacto/backend-B4-split-admin-route`

---

### ☐ B5 — Découper `routes/pricing.js` (1 316 lignes)

**Charge** : 1 j  
**Risque** : moyen

**Contexte** : Fortement couplé à `services/pricing-engine.js` (1 483 lignes).

**Actions** :
1. La route doit devenir mince et appeler le service
2. Si `pricing-engine.js` lui-même est trop gros, créer un lot B5b dédié pour le découper (par exemple `pricing/{rules,computation,benchmarks,history}.js`)

**PR** : `refacto/backend-B5-pricing-route-minimization`

---

### ☐ B6 — Découper `routes/pickup-secret.js` (1 122 lignes)

**Charge** : 1 j  
**Risque** : moyen — **flow client critique** (retrait commande)

**Contexte** : Gestion du secret de retrait au relais. Flow sécurité-sensible.

**Actions** :
1. Extraire la logique métier dans `services/pickup-secret-service.js`
2. Routes deviennent minces
3. **Tests à écrire en même temps** (le secret de retrait ne peut pas avoir de régression)

**PR** : `refacto/backend-B6-pickup-secret-extraction`

⚠️ Approbation humaine obligatoire.

---

## §C — Sourcing & offre (point central futur)

**Pourquoi prioritaire** : tu m'as explicitement dit que le sourcing est la cible. Tous les développements futurs (gestion catalogue, allocation marge, intelligence portefeuille) vont s'appuyer dessus. Si la base est bancale, chaque feature dessus le sera.

**Prérequis** : B1 (extraction sourcing-engine) **doit être fait avant** C2-C7. C1 est indépendant.

---

### ☐ C1 — Inventorier les connecteurs fournisseurs et leur état

**Charge** : 1 j  
**Risque** : nul (audit + doc)

**Contexte** : Tu as `services/suppliers/connectors/` avec :
- `api-connector.base.js` (157 l) — interface de base
- `manual-connector.js` (95 l) — saisie manuelle
- `csv-connector.js` (172 l) — import CSV
- `noon-connector.js` (81 l) — connecteur Noon (marketplace)

**Actions** :
1. Documenter chaque connecteur dans `docs/SUPPLIERS_CONNECTORS.md` :
   - Interface attendue (méthodes, retours)
   - État (production ready / en dev / abandonné)
   - Données réelles importées (volume, fraîcheur)
2. Vérifier que `api-connector.base.js` est bien la **seule** interface étendue par les autres
3. Vérifier que `services/supplier-catalog-scanner.js` (295 l) utilise les connecteurs proprement
4. Lister les fournisseurs additionnels prévus (Aliexpress ? Amazon ? Locaux ?)

**Livrable** : `docs/SUPPLIERS_CONNECTORS.md`

---

### ☐ C2 — Tests unitaires de `services/sourcing/analyzer.js`

**Charge** : 1 j  
**Risque** : nul (tests purs)  
**Prérequis** : B1 ✅

**Actions** :
1. Tester `analyzeProduct()` avec des cas typiques :
   - Produit avec toutes les métadonnées
   - Produit avec données partielles
   - Produit sans ventes
   - Produit avec ventes anormales
2. Tester `getSales30d()`
3. Mocker la DB, isoler le pur calcul
4. Cible : 80 % de couverture sur `services/sourcing/analyzer.js`

**PR** : `test/backend-C2-sourcing-analyzer`

---

### ☐ C3 — Tests unitaires de `services/sourcing/reader.js` et `enricher.js`

**Charge** : 1 j  
**Risque** : nul  
**Prérequis** : B1 ✅

**Actions** : reproduire C2 sur les autres modules sourcing.

---

### ☐ C4 — Audit du schéma sourcing en DB

**Charge** : 1 j  
**Risque** : nul (lecture)

**Contexte** : Vérifier que le schéma DB supporte les évolutions prévues.

**Actions** :
1. Auditer les tables touchées par le sourcing :
   - `products` (colonnes metadata, cost_kmf, cost_price_kmf, weight_kg, weight_g — dédoublement)
   - `sourcing_candidates` (migration 041)
   - `partners` (migrations 035, 035b, 035c)
   - `pricing_components` (migration 037)
   - `cost_components` (migration 043)
2. Identifier :
   - Les colonnes redondantes (cost_kmf vs cost_price_kmf)
   - Les ENUM trop rigides
   - Les FK manquantes
   - Les indexes manquants (`migration 016` les a ajoutés ?)
3. Produire `docs/_work/SOURCING_DB_AUDIT.md` avec recommandations

---

### ☐ C5 — Plan de normalisation des doublons cost_kmf / cost_price_kmf

**Charge** : 2-3 j  
**Risque** : élevé (impact financier)  
**Prérequis** : C4 ✅

**Contexte** : Le commentaire en-tête de `routes/sourcing-engine.js` mentionne "Helpers LOT I : normalisation des doublons cost_kmf/cost_price_kmf et weight_kg/weight_g". Donc la dette est connue.

**Actions** :
1. Décider la source de vérité (cost_kmf ou cost_price_kmf ?)
2. Créer une migration qui :
   - Copie les valeurs manquantes
   - Marque l'ancienne colonne comme DEPRECATED en commentaire SQL
   - **Ne supprime PAS** la colonne (rollback safe)
3. Mettre à jour le code pour utiliser la nouvelle colonne uniquement
4. Une fois stable sur prod pendant N jours, lot C5b pour drop la colonne

**PR** : `refacto/backend-C5-cost-column-normalization`

⚠️ Approbation humaine obligatoire.

---

### ☐ C6 — Documentation du moteur sourcing (philosophie & invariants)

**Charge** : 1 j  
**Risque** : nul

**Contexte** : Le commentaire en-tête de `sourcing-engine.js` est très bon, à pérenniser.

**Actions** :
1. Créer `docs/SOURCING_ENGINE.md` avec :
   - La philosophie (le moteur n'invente rien, il éclaire)
   - Les invariants protégés (ex: tout produit a un cost_kmf ou un fallback explicite)
   - Le mapping endpoints → services
   - Les seuils variabilisés (depuis finance_config)
   - Les évolutions prévues (vague 3, vague 4...)

---

### ☐ C7 — Garde-fou sourcing exécutable

**Charge** : 1 j  
**Risque** : nul  
**Prérequis** : C4, C6

**Actions** :
1. Créer `scripts/audit-sourcing.js` qui plante si :
   - Un produit a un cost_kmf et un cost_price_kmf qui diffèrent
   - Un produit n'a aucun cost ni fallback
   - Un produit a un weight négatif ou aberrant
   - Un partner sans partner_type valide
2. Lancer automatiquement avant chaque déploiement
3. Intégrer à la CI

**PR** : `chore/backend-C7-sourcing-audit-guardrail`

---

## §D — Sécurité & secrets (bloquant go-live)

**Pourquoi obligatoire** : tu touches à l'argent et à des données clients. Aucun go-live n'est possible sans cette validation.

---

### ✅ D1 — Audit complet des routes admin (vérifier `authenticate + requireAdmin`)

> **Fait le 17 mai 2026 — audit uniquement.** Livrable : `docs/chantier/ADMIN_AUTH_AUDIT_D1.md` (138L). Aucun oubli évident d'authentification admin trouvé sur routes inspectées. Aucune correction métier appliquée.

**Charge** : 1 j  
**Risque** : élevé si trou trouvé

**Actions** :
1. Lister toutes les routes `/admin/*` :
   ```bash
   grep -rn "app\.use('/api/admin" server.js
   grep -rn "router\.\(get\|post\|put\|delete\|patch\)" routes/admin*.js routes/admin/*.js 2>/dev/null
   ```
2. Pour chaque route, vérifier qu'elle a `authenticate, requireAdmin` en middleware
3. Lister les exceptions (s'il y en a) et les justifier
4. Produire `docs/_work/ADMIN_AUTH_AUDIT.md`

**PR** : `fix/backend-D1-admin-auth-coverage` (s'il y a des trous)

---

### ✅ D2 — Audit du webhook Stripe (idempotency + signature) *(audit 2026-06-23)*

**Charge** : 1 j  
**Risque** : critique (paiement)

**Actions** :
1. Vérifier dans `routes/payments.js` (et autres webhooks Stripe) :
   - Signature vérifiée avec `stripe.webhooks.constructEvent` ?
   - Idempotency key sur les UPDATE DB ?
   - Pas de double-confirmation possible ?
   - Logs structurés avec request_id ?
2. Tester un webhook rejoué (même payload deux fois)
3. Tester un webhook avec mauvaise signature
4. Documenter le flow dans `docs/STRIPE_WEBHOOK.md`

⚠️ **Approbation humaine obligatoire.**

---

### ✅ D3 — Audit `auth-guest.js` (262 lignes)

> **Fait le 17 mai 2026 — audit uniquement.** Livrable : `docs/chantier/AUTH_GUEST_AUDIT_D3.md` (95L). Risques suivis sans changement métier.

**Charge** : 1 j  
**Risque** : élevé

**Contexte** : Les branches `hotfix/fix-auth-guest-uuid-final` etc. dans Git suggèrent que ce module a beaucoup buggé.

**Actions** :
1. Lire `middleware/auth-guest.js` ligne par ligne
2. Identifier les invariants attendus (uniqueness UUID, expiration, etc.)
3. Vérifier qu'aucune route ne suppose qu'un guest est forcément authentifié sans vérif
4. Lister les routes qui acceptent un guest token et auditer

---

### ✅ D4 — Audit des tokens QR (pickup-secret + qr.js)

> **Fait le 17 mai 2026 — audit uniquement.** Livrable : `docs/chantier/QR_PICKUP_SECRET_AUDIT_D4.md` (91L). **A détecté une violation I-01 active en prod : `routes/pickup-secret.js:286` modifie directement `orders.status = 'confirmed'` au lieu de passer par `transitionOrderStatus()`. Lot dédié à programmer (`G1-fix` ou `D2bis`).**

**Charge** : 1 j  
**Risque** : critique (retrait commande)

**Actions** :
1. Lire `routes/orders/qr.js` et `routes/pickup-secret.js`
2. Vérifier :
   - Expiration des tokens
   - Usage unique (pas de replay)
   - Rotation périodique
   - Logs des tentatives échouées
3. Tester un token expiré
4. Tester un replay
5. Documenter dans `docs/PICKUP_SECURITY.md`

---

### ✅ D5 — Audit des secrets (.env.example vs prod)

> **Fait partiellement le 17 mai 2026.** Livrable : `docs/chantier/ENV_AUDIT_D5.md` (139L). Modification `.env.example` bloquée par le connecteur, à reprendre localement. Validation pre-start volontairement non réactivée pour ne pas recasser le boot Railway.

**Charge** : 1/2 j  
**Risque** : élevé

**Actions** :
1. Lister toutes les variables d'env utilisées (`grep "process.env\." -r`)
2. Vérifier qu'aucune valeur sensible n'est en clair dans le code ou les commits Git
3. Vérifier que `.env.example` documente toutes les vars sans secrets
4. Vérifier Railway env vars (depuis le dashboard Railway, pas le repo)
5. Documenter la procédure de rotation des secrets

---

### ✅ D6 — Rate limiting — couverture exhaustive

> **Fait le 17 mai 2026 — audit uniquement.** Livrable : `docs/chantier/RATE_LIMIT_AUDIT_D6.md` (103L). Aucun quota modifié.

**Charge** : 1/2 j  
**Risque** : moyen

**Contexte** : `middleware/rate-limit.js` existe, mais est-il appliqué partout où il faut ?

**Actions** :
1. Lister les rate limiters configurés (auth, cash, scan, admin, dashboard, global)
2. Identifier les endpoints qui devraient être limités mais ne le sont pas :
   - `/api/auth/forgot-password` ?
   - `/api/auth/verify-otp` ?
   - `/api/payments/*` autres que webhook ?
3. Compléter

---

### ✅ D7 — CORS — restriction des origines *(audit 2026-06-23)*

**Charge** : 1/2 j  
**Risque** : moyen

**Actions** :
1. Lire la config CORS dans `server.js`
2. Vérifier que les origines acceptées sont explicites en prod (pas de `*`)
3. Vérifier que les méthodes/headers sont restreints

---

### ✅ D8 — Helmet — config production *(audit 2026-06-23)*

**Charge** : 1/2 j  
**Risque** : faible

**Actions** :
1. Lire la config helmet dans `server.js`
2. Vérifier CSP (Content Security Policy)
3. Vérifier HSTS, X-Frame-Options, etc.
4. Documenter les choix

---

## §E — Tests & couverture (passer de 2 % à 20 %)

**Pourquoi** : 2,2 % de couverture sur un backend qui touche à l'argent est dangereux. Cible go-live : 20 % minimum, avec **100 % sur les flows critiques** (paiement, retrait).

**Prérequis** : B1, B2 pour C2/C3. Les autres lots E peuvent partir en parallèle de B.

---

### ☐ E1 — Tests `services/pricing-engine.js`

**Charge** : 2-3 j  
**Risque** : nul

**Contexte** : 1 483 lignes, cœur de la marge. Aucun test.

**Actions** :
1. Identifier les fonctions publiques exposées
2. Couvrir au moins :
   - Calcul de prix avec config standard
   - Calcul avec catégorie sans config
   - Calcul avec promo
   - Calcul avec marge négative (cas limite)
3. Mocker `finance_config`
4. Cible : 60 % de couverture

---

### ☐ E2 — Tests `services/shared-cart-engine.js`

**Charge** : 2 j  
**Risque** : nul

**Contexte** : 1 037 lignes, panier partagé.

---

### ☐ E3 — Tests `services/collective-payment-orchestrator.js`

**Charge** : 2-3 j  
**Risque** : nul

**Contexte** : 942 lignes, paiement groupé. Branches `fix/collective-*` dans Git → zone bugogène.

**Actions** : tester en particulier :
- Somme contributions vs total commande
- Race conditions (contribution simultanées)
- Confirmation finale 100%
- Annulation après contributions partielles

---

### ☐ E4 — Tests d'intégration des flows paiement

**Charge** : 3-4 j  
**Risque** : nul

**Actions** : étendre `tests/integration/api.test.js` :
- Paiement Stripe complet (avec mock webhook)
- Paiement cash complet (création + confirmation relais)
- Paiement collectif complet
- Refund Stripe
- Annulation commande après paiement

---

### ☐ E5 — Mesure de couverture (jest --coverage)

**Charge** : 1/2 j  
**Risque** : nul

**Actions** :
1. Configurer `jest.config.js` pour générer un rapport de couverture
2. Le publier dans la CI
3. Ajouter un seuil minimum (commencer à 10 %, monter progressivement)

---

### ☐ E6 — Tests pour les flows sourcing

**Charge** : 1-2 j  
**Risque** : nul  
**Prérequis** : B1, C2, C3

**Actions** : tests d'intégration pour les 8 endpoints sourcing-engine après extraction.

---

## §F — Observabilité & ops (bloquant go-live)

**Pourquoi** : sans observabilité, un bug en prod = client mécontent + 4h de debug à l'aveugle.

---

### ✅ F1 — Remplacer les 112 `console.log` par le logger structuré *(2026-06-23)*

**Charge** : 1 j  
**Risque** : nul

**Actions** :
1. `grep -rn "console\.\(log\|debug\)" --include="*.js"` pour la liste
2. Remplacer par `logger.info/debug/warn` (utils/logger.js)
3. Ajouter une règle d'audit qui plante si nouveau `console.log` introduit

**PR** : `chore/backend-F1-replace-console-with-logger`

---

### ✅ F2 — Health check enrichi `/api/health` *(déjà implémenté V3.2, audit 2026-06-23)*

**Charge** : 1/2 j  
**Risque** : nul

**Actions** :
1. Le health check doit vérifier :
   - DB joignable
   - Redis joignable (rate-limit-redis)
   - Stripe joignable (ping API)
   - WhatsApp Meta joignable
2. Retourner un détail par service
3. Tester sur Railway

---

### ☐ F3 — Métriques business exposées

**Charge** : 1-2 j  
**Risque** : nul

**Actions** :
1. Identifier les métriques business critiques :
   - Commandes par jour
   - Taux de conversion cash vs Stripe
   - Délai moyen paiement → expédition
   - Stock par produit
2. Exposer un endpoint `/api/admin/metrics` ou métriques Prometheus

---

### ☐ F4 — Alerting

**Charge** : 1 j  
**Risque** : nul

**Actions** :
1. Configurer des alertes sur :
   - Webhook Stripe en erreur (5xx)
   - DB lente (> 1s sur queries critiques)
   - Taux d'erreur > N%
2. Email/Slack/WhatsApp pour l'admin

---

### ✅ F5 — Plan de rollback documenté et testé *(2026-06-23)*

**Charge** : 1 j  
**Risque** : nul

**Actions** :
1. Documenter le plan dans `docs/ROLLBACK_PLAN.md` :
   - Comment redéployer la version N-1 sur Railway
   - Comment rollback une migration DB (si possible)
   - Quels signaux déclenchent un rollback automatique
2. Tester un rollback sur staging

---

### ✅ F6 — Backup DB automatique vérifié *(audit 2026-06-23 — vérification prod requise)*

**Charge** : 1/2 j  
**Risque** : critique

**Actions** :
1. Vérifier que Railway fait des backups DB
2. Tester une restauration sur une DB de test
3. Documenter la fréquence et la rétention

---

### ✅ F7 — Request IDs propagés dans les logs *(déjà implémenté, audit 2026-06-23)*

**Charge** : 1/2 j  
**Risque** : nul

**Contexte** : `middleware/request-id.js` existe. Vérifier qu'il est utilisé partout.

**Actions** :
1. Vérifier que tous les logs incluent le request_id
2. Vérifier que les services internes propagent le request_id
3. Tester un trace cross-service

---

## §G — Flows business critiques (audit bout-en-bout)

**Pourquoi** : pour chaque flow argent ou logistique, tracer du HTTP entrant jusqu'à la DB et vérifier qu'aucun invariant ne peut être violé.

**Prérequis** : la plupart des autres blocs. Ces lots sont **les derniers avant go-live**.

---

### ☐ G1 — Flow : création commande → paiement cash → retrait relais

**Charge** : 2 j  
**Risque** : nul (audit)

**Actions** :
1. Tracer chaque étape :
   - POST /api/orders → status=pending
   - Confirmation cash → cash-confirm → status=confirmed
   - Hub mark-ordered → status=ordered
   - Préparation → shipped → in_transit → available
   - Retrait avec QR/pickup-secret → collected
2. Pour chaque étape, vérifier :
   - Authent + authz OK
   - Transition de statut via order-status-machine
   - Notification client envoyée
   - Logs structurés
   - Pas de race condition possible
3. Produire `docs/_work/FLOW_AUDIT_CASH.md`

---

### ☐ G2 — Flow : création commande → paiement Stripe → préparation hub

**Charge** : 2 j  
**Risque** : nul

**Actions** : reproduire G1 sur le flow Stripe.

---

### ☐ G3 — Flow : panier collectif → contributions → confirmation

**Charge** : 2-3 j  
**Risque** : nul

**Actions** : tracer le flow complet. Vérifier en particulier que la somme des contributions ne peut jamais dépasser le total.

---

### ☐ G4 — Flow : annulation commande après paiement

**Charge** : 1-2 j  
**Risque** : nul

**Actions** : tracer les chemins de cancel + refund Stripe + refund cash.

---

### ☐ G5 — Flow : sourcing → ajout produit → mise en vente

**Charge** : 2 j  
**Risque** : nul  
**Prérequis** : B1 ✅

**Actions** : tracer le flow d'enrichissement d'un produit via le moteur sourcing.

---

## §H — Gouvernance & garde-fous (consolidation)

**Pourquoi** : pour que tout le travail des blocs A-G ne dérive pas dans 3 mois.

---

### ☐ H1 — Réconcilier `.cursorrules` et `AGENTS.md`

**Charge** : 1/2 j  
**Risque** : nul

**Actions** :
1. Décider une source de vérité unique (probablement `AGENT_CONFIG.md`)
2. Réécrire les deux fichiers pour pointer vers la même source
3. Documenter la procédure pour tout futur agent IA

---

### ☐ H2 — Créer `BACKEND_ARCHITECTURE.md` normatif

**Charge** : 1 j  
**Risque** : nul

**Actions** : suivre le pattern boutique. Court, opinionné, normatif. Les invariants déclarés du §5 de `BACKEND_AUDIT.md`.

---

### 🚧 H3 — Finaliser `audit-backend-arch.js` (garde-fou exécutable)

**Charge** : 30 min *(script déjà écrit — juste déplacer et brancher)*  
**Risque** : nul

**État actuel** : le script existe à `docs/chantier/scripts/audit-backend-arch.js` (464 lignes, créé le 2026-05-17). Les 10 invariants sont implémentés avec allowlists pour les violations connues :

| Invariant | Implémenté | Allowlist |
|-----------|-----------|-----------|
| I-BACK-1 — Aucun fichier doublon actif | ✅ | — |
| I-BACK-2 — Aucun nouveau fichier > 800 l (warn) / > 1500 l (erreur) | ✅ | Lots B prévus |
| I-BACK-3 — `UPDATE orders SET status` hors order-status-machine.js | ✅ | — |
| I-BACK-4 — `UPDATE orders SET payment_status` hors owners légitimes | ✅ | — |
| I-BACK-5 — Toute route /admin/* avec authenticate + requireRole/requireAdmin | ✅ | — |
| I-BACK-6 — Aucun routes/X-engine.js non autorisé | ✅ | Lots B prévus |
| I-BACK-7 — Aucun console.log dans de NOUVEAUX fichiers | ✅ | Snapshot 365 existants |
| I-BACK-8 — Aucune query SQL avec interpolation `${variable}` | ✅ | Savepoints/DDL légitimes |
| I-BACK-9 — Aucun fichier test à la racine | ✅ | — |
| I-BACK-10 — Aucune collision de numéro dans migrations/ | ✅ | — |

**Ce qui reste à faire** :

1. Déplacer le script à sa place définitive :
   ```bash
   mkdir -p scripts
   git mv docs/chantier/scripts/audit-backend-arch.js scripts/audit-backend-arch.js
   ```
2. Vérifier qu'il tourne depuis la racine :
   ```bash
   node scripts/audit-backend-arch.js
   ```
3. Cocher H3 ci-dessus

**PR** : `chore/backend-H3-audit-arch-script`

---

### ☐ H4 — Créer `gen-backend-arch-live.js` (photo réelle auto-générée)

**Charge** : 1 j  
**Risque** : nul  
**Prérequis** : H3 ✅

**Contexte** : même pattern que `gen-boutique-arch-live.js`. Produit un fichier `docs/BACKEND_ARCHITECTURE_LIVE.md` régénérable à tout moment qui remplace CARTOGRAPHY_360 pour les comptages (CARTOGRAPHY_360 reste le doc normatif de règles).

**Actions** :
1. Créer `scripts/gen-backend-arch-live.js` qui produit `docs/BACKEND_ARCHITECTURE_LIVE.md` avec :
   - Inventaire routes/ : fichier, taille, nombre de routes détectées
   - Inventaire services/ : fichier, taille, responsabilité déclarée
   - REQUIRED_ENV détecté dans server.js
   - Snapshot console.log par fichier (alimente l'allowlist de H3)
   - Collisions migrations détectées
   - Score architecture (violations connues vs résolues)
   - Date de génération
2. Vérifier que `node scripts/gen-backend-arch-live.js` tourne sans erreur
3. Ajouter `docs/BACKEND_ARCHITECTURE_LIVE.md` au `.gitignore` ou le commiter selon préférence
4. Cocher H4 ci-dessus

**PR** : `chore/backend-H4-gen-arch-live`

---

### ☐ H5 — Brancher audit + gen en CI

**Charge** : 1/2 j  
**Risque** : nul  
**Prérequis** : H3 ✅, H4 ✅

**Actions** :
1. Ajouter à `package.json` :
   ```json
   "backend:audit": "node scripts/audit-backend-arch.js",
   "backend:arch":  "node scripts/gen-backend-arch-live.js",
   "pretest": "npm run backend:audit"
   ```
2. Vérifier que `npm test` déclenche l'audit en premier
3. Tester en CI (Railway / GitHub Actions selon config)
4. Documenter dans le README principal : `npm run backend:audit` et `npm run backend:arch`
5. Cocher H5 ci-dessus

**PR** : `chore/backend-H5-ci-audit-gen`

---

## §I — Ordre d'exécution recommandé

Pour optimiser le ratio valeur/risque, voici l'ordre suggéré :

### Phase 1 — Hygiène (1 semaine)
A1 → A2 → A3 → A6 → A4 → A5

### Phase 2 — Sécurité bloquante (1 semaine)
D1 → D2 → D3 → D4 → D5 → D6 → D7 → D8

### Phase 3 — Observabilité bloquante (1 semaine)
F1 → F2 → F5 → F6 → F7 → F3 → F4

### Phase 4 — Garde-fous (1 semaine)
H1 → H2 → H3 → H4 → H5

### Phase 5 — Architecture (2-3 semaines)
B1 (sourcing extract — priorité absolue) → B2 → B6 (pickup secret) → B4 → B5 → B3

### Phase 6 — Sourcing consolidation (1-2 semaines)
C1 → C4 → C6 → C2 → C3 → C5 → C7

### Phase 7 — Tests métier (2 semaines)
E1 → E3 → E2 → E4 → E5 → E6

### Phase 8 — Audit flows pré-go-live (1 semaine)
G1 → G2 → G3 → G4 → G5

**Total : ~10-12 semaines de travail focus** pour un go-live blindé.

Avec un go-live progressif (soft launch sur sous-ensemble clients), tu peux mettre en prod après **Phase 1 + 2 + 3 + H3** (~4 semaines) et continuer les phases suivantes en parallèle.

---

## §J — Pour Sonnet : comment cocher

À chaque PR mergée qui complète un lot, dans le **même commit que le code** :

```diff
- ### ☐ A1 — Supprimer le fantôme `routes/orders/order-api-v2.js`
+ ### ✅ A1 — Supprimer le fantôme `routes/orders/order-api-v2.js` *(PR #XXX, 2026-MM-DD)*
```

Et mettre à jour le tableau du §0 :

```diff
- | A — Hygiène code & DB | 6 | 0 | 0 | 0 % |
+ | A — Hygiène code & DB | 5 | 0 | 1 | 17 % |
```

**Convention** :
- ☐ = pas commencé
- 🚧 *(PR #XXX en cours)* = PR ouverte mais pas mergée
- ✅ *(PR #XXX, date)* = mergée sur main, validé en prod

Ne jamais cocher un lot avant que sa PR soit mergée.

---

## §K — Pour le propriétaire (toi) : règles de session

### Avant de confier un lot à Sonnet
1. Vérifier que les prérequis sont cochés ✅
2. Coller la fiche du lot complète dans le prompt
3. Rappeler les règles non-négociables (§0bis)
4. Spécifier "une seule PR, ne dépasse pas le scope"

### Après réception du travail
1. Relire la PR (diff)
2. Vérifier que la case correspondante a bien été cochée
3. Lancer les tests
4. Si bon → merge
5. Si problème → ne pas merger, demander rectification

### Garder ce document à jour
1. Le commit qui valide un lot doit toujours inclure la mise à jour de ce MD
2. Ajouter `BACKEND_GOLIVE_ROADMAP.md` à `.cursorrules` et `AGENTS.md` comme document obligatoire à lire

---

*Document maître généré le 2026-05-16 à partir de `BACKEND_AUDIT.md`.*
*À placer dans `docs/BACKEND_GOLIVE_ROADMAP.md` du repo.*
*Régénérer la photo réelle à tout moment avec `npm run backend:arch` (une fois H4 fait).*

<!-- A2-AUDIT-2026-06-23 -->
