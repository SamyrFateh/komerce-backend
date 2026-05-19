# Kit de prompts stricts — Komerce post-cycle critique

> Statut : kit opérationnel pour agents Sonnet / ChatGPT après clôture du cycle critique backend.  
> Date : 19 mai 2026 (révision : ajout C1 et C2 récupérés de l'archive).  
> Source : dérivé et actualisé depuis `_archive/PROMPTS_KIT.md` v1.0 du 17 mai 2026.  
> But : fournir des prompts prêts à copier pour les prochains lots non bloquants, sans rouvrir les corrections I-SWEEP déjà terminées.

---

## 0. État de référence à ne plus rediscuter

Avant tout nouveau lot, considérer comme acquis sur `main` :

| Bloc | État |
|------|------|
| I-SWEEP-1 → I-SWEEP-6C | ✅ terminé |
| TEST-1A | ✅ terminé |
| TEST-1B | ✅ terminé |
| Clôture cycle critique backend | ✅ documentée dans `docs/chantier/CLOTURE_CYCLE_CRITIQUE_BACKEND.md` |

Conséquence :

- Ne pas relancer B5 I-SWEEP sauf découverte d'une nouvelle violation documentée.
- Ne pas relancer B6 TEST-1 générique sauf extension ciblée.
- Les prochains lots sont des lots de finition, validation, refacto ou industrialisation.

---

## 1. Règles communes pour tous les prompts post-critiques

À copier en tête de tout prompt si besoin :

```text
Tu travailles sur le backend Komerce après clôture du cycle critique.

Lis obligatoirement dans cet ordre :
1. docs/chantier/STATUS.md
2. docs/chantier/CLOTURE_CYCLE_CRITIQUE_BACKEND.md
3. AGENTS.md
4. docs/CARTOGRAPHY_360.md
5. docs/ZONE_IMPACT.md
6. docs/SCHEMA.md
7. docs/CONTRACTS.md

Règles :
- I-SWEEP est déjà terminé : ne pas le rouvrir sans preuve.
- TEST-1A/1B sont déjà terminés : ne pas les remplacer, seulement les compléter.
- Toute modification métier doit garder les invariants I-01 à I-10.
- Pas de refacto opportuniste hors périmètre.
- Pas de modification de `orders.status` hors machine.
- Pas de SQL inline ajouté dans `server.js`.
- Toute PR met à jour `docs/chantier/STATUS.md` uniquement si elle change réellement l'état du chantier.
```

---

# Prompt P0 — Validation finale staging / Railway

À utiliser avant PRICE-1 ou gros refacto.

```text
Tu es un agent de validation staging pour Komerce.

RÔLE
Valider que le backend boot et que les flows critiques corrigés par I-SWEEP fonctionnent en staging/Railway.
Aucun code modifié sauf si une erreur bloquante est identifiée et confirmée.

DOCUMENTS À LIRE
1. docs/chantier/STATUS.md
2. docs/chantier/CLOTURE_CYCLE_CRITIQUE_BACKEND.md
3. docs/ZONE_IMPACT.md
4. docs/CONTRACTS.md
5. package.json
6. tests/integration/

PÉRIMÈTRE
IN SCOPE :
- Lancer les tests Jest existants.
- Vérifier le boot Railway / `npm start`.
- Vérifier les variables d'env critiques documentées.
- Exécuter ou simuler les flows :
  1. cash pickup
  2. QR verify
  3. Stripe intent
  4. purchasing trigger / receive
  5. collective repairs dry-run
  6. refund admin dry-run
  7. pricing apply dry-run ou équivalent sécurisé
  8. product publication guard

OUT OF SCOPE :
- Refacto.
- Ajout de feature.
- Modification de pricing doctrine.
- Modification de `server.js` sauf bug boot prouvé.

LIVRABLE
Un document : `docs/chantier/VALIDATION_STAGING_{YYYY-MM-DD}.md`

Structure :
1. Verdict global : PASS / PARTIAL / FAIL
2. Commandes lancées
3. Résultats tests
4. Résultats boot
5. Résultats flows
6. Bugs bloquants
7. Bugs non bloquants
8. Prochain lot recommandé

FIN
Si tout est PASS, ne pas modifier le code.
```

---

# Prompt P1 — PRICE-1 : ajustements pricing/catalogue après tests

```text
Tu es un agent d'exécution pour PRICE-1.

RÔLE
Traiter uniquement les ajustements pricing/catalogue révélés par TEST-1A/1B ou staging.
Ce lot est un follow-up ciblé, pas une refonte du pricing.

PRÉREQUIS
- I-SWEEP-6C ✅ dans STATUS.md
- TEST-1A ✅ dans STATUS.md
- TEST-1B ✅ dans STATUS.md
- Avoir une note de validation ou un bug précis à corriger.

DOCUMENTS À LIRE
1. docs/chantier/STATUS.md
2. docs/chantier/CLOTURE_CYCLE_CRITIQUE_BACKEND.md
3. docs/ZONE_IMPACT.md — invariant I-08
4. docs/CONTRACTS.md — pricing engine
5. docs/DOCTRINE_ECONOMIQUE_KOMERCE.md si présent
6. services/apply-pricing-updates.js
7. services/product-price-audit.js
8. services/product-publication-guard.js
9. routes/pricing.js
10. routes/products.js
11. tests/integration/isweep-invariants.test.js
12. tests/integration/isweep-services.test.js

PÉRIMÈTRE
IN SCOPE :
- Corriger une incohérence précise sur :
  - survival server-side ;
  - `price_history` ;
  - `apply-price` ;
  - `apply-all` ;
  - publication produit ;
  - audit stock minimal.
- Ajouter ou ajuster les tests correspondants.
- Mettre à jour STATUS.md uniquement si le lot est réellement clôturé.

OUT OF SCOPE :
- Refactor complet `pricing-engine.js`.
- Nouveau modèle économique.
- Nouvelle table DB sans justification.
- Frontend boutique.
- Sourcing fournisseurs.

GARDE-FOUS
- Ne jamais hardcoder un coefficient pricing.
- Ne jamais faire confiance au body client pour un seuil survival critique.
- Ne jamais supprimer l'audit `price_history`.
- Ne jamais bloquer une opération catalogue uniquement parce que l'audit non critique échoue.

LIVRABLE
- Code minimal.
- Test ciblé.
- STATUS.md si nécessaire.
- Message commit : `fix(pricing): ...` ou `test(pricing): ...`.
```

---

# Prompt P2 — A4 : vérification migrations 060/061

```text
Tu es un agent de vérification migrations pour Komerce.

RÔLE
Analyser les collisions ou ambiguïtés autour des migrations 060/061.
Aucune modification DB en production. Aucun changement applicatif.

DOCUMENTS À LIRE
1. docs/chantier/STATUS.md
2. docs/SCHEMA.md
3. docs/chantier/MIGRATIONS_FOLDERS_A5.md
4. server.js — uniquement la partie runner/migrations/DDL inline
5. dossier migrations/ complet

MÉTHODE
1. Lister toutes les migrations 060/061 et variantes proches.
2. Vérifier lesquelles sont réellement exécutées par le runner actuel.
3. Vérifier si des migrations concurrentes créent/modifient les mêmes tables, colonnes, indexes ou enums.
4. Classer :
   - collision réelle bloquante ;
   - collision documentaire ;
   - doublon inoffensif ;
   - fichier mort.
5. Proposer une correction documentaire ou technique, mais ne l'appliquer que si elle est sans risque.

GARDE-FOUS
- Ne pas renommer/supprimer une migration déjà potentiellement appliquée en production sans preuve.
- Ne pas toucher au schéma Railway.
- Ne pas modifier `server.js` sauf conclusion explicite et limitée.

LIVRABLE
Un document : `docs/chantier/AUDIT_MIGRATIONS_060_061.md`

STATUS.md peut être mis à jour si A4 est clôturé.
```

---

# Prompt P3 — F1 : logger structuré progressif

```text
Tu es un agent d'industrialisation logging pour Komerce.

RÔLE
Préparer puis appliquer progressivement un logger structuré à la place des `console.log` dispersés.
Le lot doit être découpé. Ne pas remplacer 365 occurrences en une seule PR.

DOCUMENTS À LIRE
1. docs/chantier/STATUS.md
2. docs/chantier/CLOTURE_CYCLE_CRITIQUE_BACKEND.md
3. server.js
4. package.json
5. fichiers contenant le plus de console.*

MÉTHODE
1. Compter les `console.log`, `console.warn`, `console.error` par fichier.
2. Proposer une stratégie : logger central + migration par domaine.
3. Créer `utils/logger.js` ou `services/logger.js` selon convention existante.
4. Migrer un domaine pilote seulement, par exemple pricing ou purchasing.
5. Ajouter tests ou snapshot minimal si pertinent.
6. Documenter la convention.

GARDE-FOUS
- Ne pas masquer les erreurs critiques.
- Ne pas changer la sémantique des logs utilisés pour debug Railway.
- Pas de dépendance externe lourde sans justification.
- Pas de refacto métier.

LIVRABLE
- Logger central.
- 1 domaine pilote migré.
- Doc courte `docs/chantier/LOGGER_GUIDELINES.md`.
- STATUS.md : F1 partiel ou F1A fait, pas F1 complet si le reste reste à migrer.
```

---

# Prompt P4 — H1 : refacto server.js, plan avant code

```text
Tu es un agent d'architecture backend pour Komerce.

RÔLE
Préparer le refactor de `server.js` sans le coder immédiatement.
Livrable = plan d'exécution strict.

PRÉREQUIS
- Cycle critique backend clôturé.
- Tests TEST-1A/1B présents.

DOCUMENTS À LIRE
1. docs/chantier/STATUS.md
2. docs/chantier/CLOTURE_CYCLE_CRITIQUE_BACKEND.md
3. docs/ZONE_IMPACT.md § server.js
4. docs/CARTOGRAPHY_360.md
5. docs/CONTRACTS.md
6. server.js complet

MÉTHODE
1. Découper les responsabilités actuelles de `server.js` : env, raw webhooks, middleware, routes, DDL inline, boot.
2. Identifier les blocs intouchables ou dangereux : webhooks raw avant `express.json`, REQUIRED_ENV, Railway boot.
3. Proposer une arborescence cible :
   - `bootstrap/env.js`
   - `bootstrap/middleware.js`
   - `bootstrap/routes.js`
   - `bootstrap/webhooks.js`
   - `scripts/fix-schema.js`
   - etc.
4. Définir une séquence de PRs de moins de 300 lignes de diff.
5. Définir les tests boot nécessaires.

GARDE-FOUS
- Aucun code modifié dans ce lot.
- Ne pas déplacer les webhooks raw sans test précis.
- Ne pas retirer les DDL inline avant d'avoir un script équivalent prouvé.

LIVRABLE
`docs/chantier/PLAN_H1_REFACTO_SERVER.md`
```

---

# Prompt P5 — H1A : extraction manifest routes uniquement

```text
Tu es un agent d'exécution backend pour H1A.

RÔLE
Extraire uniquement le montage des routes de `server.js` vers un module dédié.
Ne pas toucher aux webhooks raw, à `express.json`, aux DDL inline ni au boot.

PRÉREQUIS
- `docs/chantier/PLAN_H1_REFACTO_SERVER.md` existe.
- TEST-1A/1B présents.

PÉRIMÈTRE
IN SCOPE :
- Créer `bootstrap/routes.js` ou `server/routes-manifest.js`.
- Déplacer les `app.use('/api/...')` standards.
- Laisser dans `server.js` : raw webhooks, middleware global, DDL inline, listen.

OUT OF SCOPE :
- Webhooks.
- `express.json`.
- DDL inline.
- REQUIRED_ENV.
- Refactor middleware.

VALIDATION
- Boot inchangé.
- Tous les chemins API montés comme avant.
- Test ou grep comparatif des routes montées.
```

---

# Prompt P6 — H3 : déplacer audits/scripts backend arch

```text
Tu es un agent de rangement technique pour Komerce.

RÔLE
Déplacer les scripts/audits backend arch vers un dossier clair `scripts/` ou `tools/`, sans changer leur comportement.

DOCUMENTS À LIRE
1. docs/chantier/STATUS.md
2. package.json
3. scripts/ existant
4. docs/_archive/ si pertinent

PÉRIMÈTRE
IN SCOPE :
- Identifier les scripts d'audit actuellement mal placés.
- Les déplacer dans un dossier cohérent.
- Mettre à jour package.json si un script npm les appelle.
- Mettre à jour docs qui pointent vers eux.

OUT OF SCOPE :
- Modifier leur logique.
- Ajouter des audits.
- Modifier server.js.

LIVRABLE
- Déplacements propres.
- Chemins mis à jour.
- STATUS.md si H3 clôturé.
```

---

## Prompts obsolètes ou à archiver mentalement

Dans le kit v1.0 :

| Prompt | Statut post-cycle |
|--------|-------------------|
| B5 I-SWEEP | Remplacé par corrections I-SWEEP déjà mergées. Ne plus utiliser tel quel. |
| B6 TEST-1 | Remplacé par TEST-1A/1B déjà faits. Ne l'utiliser que pour extensions ciblées. |
| B2 REFAC-pricing | Toujours possible, mais seulement après validation staging et avec tests comparatifs stricts. |
| B3 REFAC-dashboard | Toujours possible, mais après H1/P0 si besoin. |
| B4 PAYPAL-1 | Possible plus tard, mais nécessite décision produit et variables sandbox. |

---

## Recommandation d'ordre

Ordre recommandé après clôture critique :

1. P0 — validation staging/Railway.
2. PRICE-1 seulement si P0 révèle un ajustement pricing/catalogue.
3. A4 — migrations 060/061.
4. F1A — logger pilote.
5. H1 plan — pas code direct.
6. H1A — extraction routes seulement.
7. H3 — rangement scripts/audits.

C1 et C2 ci-dessous sont des prompts **utilitaires transversaux** : à utiliser à la demande, pas dans la séquence.

---

# Prompt C1 — Mise à jour ciblée du socle après modification

À utiliser quand une PR modifie le code ou la DB et qu'il faut aligner les 4 docs socle dans la même PR.

```text
Tu es un agent de maintenance documentaire pour Komerce.

RÔLE
Mettre à jour les 4 docs socle (CARTOGRAPHY_360, ZONE_IMPACT, SCHEMA, CONTRACTS)
après une modification de code livrée dans la session précédente. Aucun code modifié.

PARAMÈTRES OBLIGATOIRES (à compléter avant lancement)
- TYPE_MODIF : [route_ajoutée | route_supprimée | service_ajouté | service_modifié |
                table_ajoutée | table_modifiée | ENUM_modifié | invariant_modifié |
                source_paiement_ajoutée]
- DETAILS : description précise de la modification (fichiers, lignes, intention)

DOCUMENTS À METTRE À JOUR (selon TYPE_MODIF)
- route_ajoutée/supprimée   → docs/CARTOGRAPHY_360.md §3
- service_ajouté/modifié    → docs/CONTRACTS.md
- table_ajoutée/modifiée    → docs/SCHEMA.md (régénération depuis pg_dump si dispo,
                              sinon édition ciblée)
- ENUM_modifié              → docs/SCHEMA.md §3 + docs/CARTOGRAPHY_360.md si visible API
- invariant_modifié         → docs/ZONE_IMPACT.md §2
- source_paiement_ajoutée   → docs/CARTOGRAPHY_360.md §6 + docs/ZONE_IMPACT.md §4
                              + docs/CONTRACTS.md §3

RÈGLES
- Mettre à jour la date de consolidation et la note de méthode en tête de chaque
  document modifié : « Mis à jour le YYYY-MM-DD : <résumé> ».
- Ne JAMAIS modifier le code dans cette session.
- Si une divergence doc ↔ code est détectée pendant l'opération, la signaler dans
  STATUS.md § Pièges critiques et ne pas la corriger.

LIVRABLE
- 1 à 4 docs socle mis à jour.
- 1 ligne ajoutée dans docs/chantier/STATUS.md uniquement si la mise à jour acte
  un lot précis (sinon pas de touche STATUS).
- Message commit : « docs(socle): aligner {DOCS} sur {DETAILS} ».

CRITÈRES DE VALIDATION
- Aucune divergence laissée non signalée.
- Chaque doc modifié a sa date de consolidation à jour.
- Aucune modification de code.
```

---

# Prompt C2 — Régénération de SCHEMA.md depuis pg_dump

À utiliser après une migration appliquée en production ou en staging, quand un nouveau `pg_dump` est disponible.

```text
Tu es un agent de génération de doc DB pour Komerce.

RÔLE
Régénérer docs/SCHEMA.md à partir d'un pg_dump fourni en pièce jointe
(typiquement schema_railway.sql à la racine du repo). Aucun code applicatif modifié.

PRÉREQUIS
- Un pg_dump à jour est fourni.
- Une version précédente de docs/SCHEMA.md existe pour comparaison.

DOCUMENTS À LIRE
1. docs/chantier/STATUS.md
2. docs/SCHEMA.md (version actuelle, pour structure et style)
3. Le pg_dump fourni (schema_railway.sql ou équivalent)
4. AGENTS.md §2.1 (la DB live fait foi sur le schéma)

MÉTHODE
1. Lire le pg_dump intégralement. Si encodage UTF-16 LE, convertir d'abord :
   iconv -f UTF-16LE -t UTF-8 schema_railway.sql > schema_railway.utf8.sql
2. Extraire : tables, ENUMs, triggers, FK, vues, fonctions, contraintes CHECK.
3. Croiser avec la version précédente de SCHEMA.md.
4. Identifier les NOUVEAUTÉS et SUPPRESSIONS depuis la précédente régénération.
5. Produire un SCHEMA.md à jour en respectant la structure existante :
   §1 Règle d'usage
   §2 Vue d'ensemble
   §3 ENUMs
   §4 Tables par domaine
   §5 Vues
   §6 Triggers
   §7 Contraintes CHECK
   §8 Conventions
   §9 Liens autres docs
   §10 Règle divergence
   §11 Procédure régénération
   §12 Dette
6. Mettre à jour la date de consolidation en tête : « Régénéré depuis pg_dump
   du YYYY-MM-DD ».
7. Si des tables existaient avant et ne sont plus dans le dump : les signaler
   dans §12 Dette plutôt que de les supprimer silencieusement.

GARDE-FOUS
- Ne pas inventer de tables qui ne sont pas dans le dump.
- Ne pas supprimer silencieusement une table absente du nouveau dump : la
  signaler dans §12 Dette pour arbitrage.
- Conserver le format des tableaux existants.
- Ne pas toucher au code applicatif.
- Ne pas toucher aux autres docs socle dans cette session (CARTOGRAPHY,
  ZONE_IMPACT, CONTRACTS). Si une modif de schéma impose une mise à jour
  ailleurs, la signaler dans STATUS.md § Pièges critiques.

LIVRABLE
- docs/SCHEMA.md régénéré.
- 1 ligne ajoutée dans docs/chantier/STATUS.md actant la régénération.
- Message commit : « docs(schema): régénérer SCHEMA.md depuis pg_dump du YYYY-MM-DD ».

CRITÈRES DE VALIDATION
- Toutes les tables, ENUMs, vues, triggers du pg_dump sont représentés.
- §12 Dette mentionne explicitement chaque suppression observée.
- La date de consolidation est à jour.
- Aucun code applicatif modifié.
```

---

## Note sur le pattern générique d'exécution

Pour un futur lot qui ne serait pas couvert par P0–P6 ni C1/C2, le squelette générique reste disponible dans `docs/_archive/PROMPTS_KIT.md` (prompt **B1**). Il est verbeux mais complet : RÔLE, PRÉREQUIS, DOCUMENTS À LIRE, PÉRIMÈTRE IN/OUT, GARDE-FOUS, MÉTHODE, LIVRABLE, CRITÈRES DE VALIDATION, FIN DE SESSION. Le récupérer à la demande, pas par défaut.
