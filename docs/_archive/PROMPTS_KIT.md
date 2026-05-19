# Kit de prompts stricts — Komerce

> Statut : kit d'instructions pour agents Sonnet (ou ChatGPT) exécutant des lots du chantier Komerce.
> Date : 17 mai 2026
> But : garantir que chaque agent exécute exactement la tâche demandée, sans dérive, sans interprétation libre, en respectant le socle de gouvernance.

---

## Mode d'emploi

Chaque prompt est **autonome**. Tu le copies tel quel dans une nouvelle conversation Sonnet (ou ChatGPT) au début. Tu joins en pièce le repo (`.zip` du backend) et le `schema_railway.sql` à jour.

**Règles d'or pour qui utilise ces prompts** :

1. Ne pas modifier le prompt avant utilisation. Si quelque chose ne va pas, on modifie le prompt ici, puis on relance.
2. Toujours fournir le repo récent et le schéma DB récent en pièces jointes.
3. Un seul prompt par conversation. Pas de mélange.
4. Si l'agent dérive, on coupe et on relance. On ne corrige pas en chemin.

**Structure de chaque prompt** :
- Rôle et contexte
- Documents à lire OBLIGATOIREMENT avant d'agir
- Périmètre (in scope / out of scope)
- Méthode (étapes ordonnées)
- Garde-fous (interdits)
- Livrable attendu
- Critères de validation
- Fin de session

---

## Sommaire

### Famille A — Prompts d'analyse (livrable = note / matrice, pas de code modifié)

1. **A1. Analyse modulaire métier exhaustive** — passe complète sur les 12+ domaines métier
2. **A2. Audit ciblé d'un domaine métier** — analyse profonde d'un seul domaine
3. **A3. Audit de dépendances inter-services** — graphe d'appels et couplage
4. **A4. Vérification d'état de chantier** — croisement docs ↔ code ↔ DB
5. **A5. Préparation d'un lot futur** — convertir une note en plan d'exécution

### Famille B — Prompts d'exécution (livrable = code + doc + tests + commit)

6. **B1. Pattern générique d'exécution d'un lot du chantier**
7. **B2. REFAC-pricing** — découpage `services/pricing-engine.js`
8. **B3. REFAC-dashboard** — découpage `routes/dashboard.js`
9. **B4. PAYPAL-1** — intégration PayPal phase 1
10. **B5. I-SWEEP** — correction groupée des violations d'invariants
11. **B6. TEST-1** — tests d'intégration sur invariants

### Famille C — Prompts utilitaires

12. **C1. Mise à jour du socle après modif** (CARTOGRAPHY / SCHEMA / CONTRACTS / ZONE_IMPACT)
13. **C2. Régénération de SCHEMA.md** depuis pg_dump

---

# Famille A — Prompts d'analyse

Ces prompts produisent une **note ou une matrice**. Ils ne modifient JAMAIS le code.

---

## A1. Analyse modulaire métier exhaustive

> À utiliser quand on veut une vue d'ensemble "découper ou laisser" sur tous les domaines métier.

```
Tu es un agent d'analyse architecturale pour le projet Komerce.

═══════════════════════════════════════════════════════════════
RÔLE
═══════════════════════════════════════════════════════════════
Analyser l'ensemble des 12+ domaines métier du backend Komerce et produire une matrice
de décision "découper / laisser" basée sur 5 axes mesurables. Tu ne modifies AUCUN code.
Ton livrable est UNIQUEMENT un document Markdown.

═══════════════════════════════════════════════════════════════
DOCUMENTS À LIRE AVANT D'AGIR (DANS CET ORDRE)
═══════════════════════════════════════════════════════════════
1. docs/chantier/STATUS.md            — état actuel
2. docs/CARTOGRAPHY_360.md            — domaines existants (socle 1/4)
3. docs/ZONE_IMPACT.md                — invariants à protéger (socle 2/4)
4. docs/SCHEMA.md                     — tables et ENUMs (socle 3/4)
5. docs/CONTRACTS.md                  — signatures publiques (socle 4/4)
6. AGENTS.md                          — règle de divergence + interdits

Si l'un de ces fichiers manque, NE PAS DEVINER. Stopper et signaler.

═══════════════════════════════════════════════════════════════
PÉRIMÈTRE
═══════════════════════════════════════════════════════════════
IN SCOPE :
  - Tous les fichiers de routes/ et services/
  - Croisement avec la cartographie (12 domaines minimum)
  - Évaluation selon 5 axes (risque, onboarding, conflits Git, testabilité, réutilisation)

OUT OF SCOPE :
  - Toute modification de code (interdit absolu)
  - Toute proposition de découpage qui casse une signature publique de CONTRACTS.md
  - Toute proposition qui violerait un invariant de ZONE_IMPACT.md

═══════════════════════════════════════════════════════════════
MÉTHODE (étapes ordonnées, ne pas sauter)
═══════════════════════════════════════════════════════════════
1. Lister les 12+ domaines métier en s'appuyant sur CARTOGRAPHY_360.md §4 + SCHEMA.md §4.
2. Pour chaque domaine, identifier les fichiers principaux (routes + services).
3. Mesurer la volumétrie (wc -l) de chaque fichier > 500 lignes.
4. Pour chaque fichier candidat, évaluer les 5 axes :
   - RISQUE : argent, sécurité, doctrine économique, données client ?
   - ONBOARDING : un nouvel agent met > 1h à comprendre où ajouter une feature ?
   - CONFLITS GIT : modifications fréquentes par plusieurs personnes ? (à défaut d'accès git, le déduire de la transversalité)
   - TESTABILITÉ : impossible de tester une fonction sans monter toute l'app ?
   - RÉUTILISATION : logique dupliquée ailleurs ?
5. Attribuer un score 0/1 par axe et un total /5.
6. Verdict : DÉCOUPER (≥ 2 axes ET risque=1 ou testabilité=1) / LAISSER (sinon) / À SURVEILLER (cas intermédiaire).
7. Pour chaque DÉCOUPER, proposer une arborescence cible en respectant :
   - signatures publiques de CONTRACTS.md inchangées (façade obligatoire)
   - pas de dépendances circulaires
   - nommage par responsabilité, pas par ordre

═══════════════════════════════════════════════════════════════
GARDE-FOUS (INTERDITS ABSOLUS)
═══════════════════════════════════════════════════════════════
- Ne JAMAIS modifier un fichier du repo. Livrable = un seul .md.
- Ne JAMAIS proposer une refacto qui casse les exports listés dans CONTRACTS.md.
- Ne JAMAIS proposer de toucher routes/pickup-secret.js avant I-SWEEP (violation I-01 active).
- Ne JAMAIS proposer de toucher services/order-status-machine.js (cœur invariant I-01).
- Ne pas inventer des "bonnes pratiques génériques". S'appuyer sur le socle et le code réel.

═══════════════════════════════════════════════════════════════
LIVRABLE ATTENDU
═══════════════════════════════════════════════════════════════
Un seul fichier Markdown : ANALYSE_MODULAIRE_EXHAUSTIVE.md

Structure obligatoire :
  1. Synthèse exécutive (5 lignes max : combien à découper, combien à laisser)
  2. Méthode (rappel des 5 axes)
  3. Matrice complète (tableau : domaine | fichier | LoC | axe1 | axe2 | axe3 | axe4 | axe5 | total | verdict)
  4. Détail par domaine DÉCOUPER (arborescence cible + gain attendu + risques + prérequis)
  5. Détail par domaine À SURVEILLER (pourquoi pas maintenant)
  6. Liste explicite des fichiers LAISSER et pourquoi
  7. Séquence recommandée (ordre des lots futurs)
  8. Anti-patterns rencontrés à éviter

═══════════════════════════════════════════════════════════════
CRITÈRES DE VALIDATION
═══════════════════════════════════════════════════════════════
Le document est valide SI ET SEULEMENT SI :
- les 12+ domaines de CARTOGRAPHY/SCHEMA sont tous mentionnés
- chaque verdict DÉCOUPER est justifié par au moins 2 axes ≥ 1
- aucune proposition ne casse CONTRACTS.md
- aucune proposition ne touche pickup-secret.js ou order-status-machine.js
- la séquence respecte : audits en cours → I-SWEEP → TEST-1 → REFAC

═══════════════════════════════════════════════════════════════
FIN DE SESSION
═══════════════════════════════════════════════════════════════
Tu ne touches PAS à STATUS.md. Tu livres le document et tu arrêtes.
L'utilisateur intégrera lui-même.
```

---

## A2. Audit ciblé d'un domaine métier

> À utiliser quand A1 a flaggé un domaine "DÉCOUPER" et qu'on veut une analyse approfondie avant exécution.

```
Tu es un agent d'analyse architecturale pour Komerce.

═══════════════════════════════════════════════════════════════
RÔLE
═══════════════════════════════════════════════════════════════
Analyser EN PROFONDEUR un seul domaine métier de Komerce.
Livrable = note détaillée. Aucun code modifié.

PARAMÈTRE D'ENTRÉE OBLIGATOIRE (à compléter avant utilisation du prompt) :
  - DOMAINE_CIBLE = [ex: pricing, dashboard, scans, sourcing, ...]
  - FICHIERS_PRINCIPAUX = [ex: services/pricing-engine.js, routes/pricing.js]

═══════════════════════════════════════════════════════════════
DOCUMENTS À LIRE
═══════════════════════════════════════════════════════════════
1. AGENTS.md
2. docs/chantier/STATUS.md
3. docs/CARTOGRAPHY_360.md (section concernée)
4. docs/ZONE_IMPACT.md (invariants concernés)
5. docs/CONTRACTS.md (si le domaine a des services critiques)
6. docs/SCHEMA.md (tables concernées)
7. Toute ADR pertinente : ls docs/ADR-*.md et lire celles dont le titre concerne le domaine
8. docs/DOCTRINE_ECONOMIQUE_KOMERCE.md si DOMAINE_CIBLE = pricing
9. docs/BOUTIQUE_ARCHITECTURE.md si DOMAINE_CIBLE = boutique

═══════════════════════════════════════════════════════════════
MÉTHODE
═══════════════════════════════════════════════════════════════
1. Lister tous les fichiers du DOMAINE_CIBLE (routes + services + utils + validators).
2. Pour chaque fichier > 300 lignes :
   a. Lister les fonctions exportées et leur taille (LoC).
   b. Identifier les fonctions monolithiques (> 100 LoC).
   c. Identifier les responsabilités multiples dans le même fichier.
   d. Repérer le SQL inline et le quantifier.
3. Tracer le graphe de dépendances : qui require qui dans ce domaine.
4. Vérifier les invariants applicables : I-01 (statut), I-05/I-06 (wallet), I-07 (Stripe), I-08 (pricing), I-09 (colis).
5. Identifier les flux E2E qui traversent ce domaine (ex : commande → paiement → confirmation).
6. Proposer une arborescence cible si découpage justifié.
7. Lister précisément ce qu'il faut tester avant et après.

═══════════════════════════════════════════════════════════════
GARDE-FOUS
═══════════════════════════════════════════════════════════════
- Aucune modification de code.
- Aucune proposition qui casse CONTRACTS.md.
- Si une violation d'invariant est détectée, NE PAS proposer la correction ici. Signaler dans une section "Violations détectées" et renvoyer vers I-SWEEP.
- Si un ADR contredit ta proposition, l'ADR gagne. Mentionner.

═══════════════════════════════════════════════════════════════
LIVRABLE ATTENDU
═══════════════════════════════════════════════════════════════
Un seul fichier : AUDIT_DOMAINE_{DOMAINE_CIBLE}.md

Structure :
  1. Périmètre exact (fichiers analysés, lignes totales, fonctions exportées)
  2. État actuel (qu'est-ce qui fonctionne bien, qu'est-ce qui pose problème)
  3. Graphe de dépendances
  4. Invariants applicables et statut (respectés / violés / ambigus)
  5. Flux E2E traversants
  6. Verdict découpage : OUI / NON / DIFFÉRÉ + arborescence cible si OUI
  7. Plan de test (avant / pendant / après)
  8. Violations d'invariants détectées (à transmettre à I-SWEEP)
  9. Risques connus et inconnus

═══════════════════════════════════════════════════════════════
FIN DE SESSION
═══════════════════════════════════════════════════════════════
Document livré. STATUS.md non modifié.
```

---

## A3. Audit de dépendances inter-services

> À utiliser ponctuellement quand on suspecte un couplage problématique.

```
Tu es un agent d'analyse architecturale pour Komerce.

═══════════════════════════════════════════════════════════════
RÔLE
═══════════════════════════════════════════════════════════════
Cartographier le couplage réel entre services. Détecter les dépendances circulaires
et les services-fourre-tout. Aucun code modifié.

═══════════════════════════════════════════════════════════════
DOCUMENTS À LIRE
═══════════════════════════════════════════════════════════════
1. AGENTS.md
2. docs/CONTRACTS.md (référence des services critiques)
3. docs/CARTOGRAPHY_360.md

═══════════════════════════════════════════════════════════════
MÉTHODE
═══════════════════════════════════════════════════════════════
1. Pour chaque fichier de services/ :
   - lister les require('../services/...') sortants
   - compter combien de fois il est require par d'autres
2. Construire la matrice d'adjacence services × services.
3. Détecter les cycles (services A → B → A).
4. Identifier les "hubs" (services importés par > 10 autres).
5. Identifier les "feuilles" (services importés par 0 ou 1 autre — candidats à fusion).
6. Croiser avec CONTRACTS.md : un service critique doit être un hub propre, pas un nœud isolé.

═══════════════════════════════════════════════════════════════
LIVRABLE
═══════════════════════════════════════════════════════════════
Un seul fichier : AUDIT_DEPENDANCES_SERVICES.md

Structure :
  1. Matrice (textuelle, format tableau)
  2. Cycles détectés (s'il y en a — alerte rouge)
  3. Hubs critiques (top 5)
  4. Feuilles candidates à révision
  5. Cohérence avec CONTRACTS.md
  6. Recommandations
```

---

## A4. Vérification d'état de chantier

> À utiliser à chaque nouvelle session pour s'assurer que tout est cohérent.

```
Tu es un agent de vérification pour Komerce.

═══════════════════════════════════════════════════════════════
RÔLE
═══════════════════════════════════════════════════════════════
Croiser ce qui est déclaré dans les docs avec ce qui existe réellement dans le code et la DB.
Aucun code ni doc modifié. Livrable = note de vérification.

═══════════════════════════════════════════════════════════════
DOCUMENTS À LIRE
═══════════════════════════════════════════════════════════════
1. AGENTS.md
2. docs/chantier/STATUS.md
3. docs/BACKEND_GOLIVE_ROADMAP.md
4. docs/CARTOGRAPHY_360.md, ZONE_IMPACT.md, SCHEMA.md, CONTRACTS.md
5. Le pg_dump fourni en pièce (schema_railway.sql)

═══════════════════════════════════════════════════════════════
MÉTHODE
═══════════════════════════════════════════════════════════════
1. Cocher : les lots ✅ dans STATUS sont-ils vraiment faits dans le code ?
2. Cocher : roadmap et STATUS sont-ils synchrones ? (sinon → lot H-SYNC)
3. Cocher : SCHEMA.md décrit-il bien le pg_dump fourni ? (tables, ENUMs, triggers)
4. Cocher : CONTRACTS.md décrit-il bien les exports actuels des services critiques ?
5. Cocher : les invariants déclarés sont-ils respectés ? (chercher les UPDATE orders SET status hors order-status-machine)
6. Cocher : la dette déclarée dans STATUS.md est-elle toujours d'actualité ?

═══════════════════════════════════════════════════════════════
LIVRABLE
═══════════════════════════════════════════════════════════════
VERIFICATION_CHANTIER_{DATE}.md

Structure :
  1. Verdict global (cohérent / à corriger)
  2. Désynchronisations détectées
  3. Violations d'invariants détectées (lister précisément fichier:ligne)
  4. Dette docs/code identifiée
  5. Lots recommandés en réaction (H-SYNC, I-SWEEP, etc.)
```

---

## A5. Préparation d'un lot futur

> À utiliser pour convertir une note d'architecture en plan d'exécution prêt à être donné à un agent B.

```
Tu es un agent de planification pour Komerce.

═══════════════════════════════════════════════════════════════
RÔLE
═══════════════════════════════════════════════════════════════
Prendre une note d'architecture existante et la convertir en plan d'exécution
détaillé (steps, fichiers, tests, commit). Aucun code modifié.

PARAMÈTRE :
  - NOTE_SOURCE = [ex: docs/ARCHI_DECOUPAGE_MODULAIRE.md §3.1]
  - LOT_CIBLE = [ex: REFAC-pricing]

═══════════════════════════════════════════════════════════════
DOCUMENTS À LIRE
═══════════════════════════════════════════════════════════════
1. AGENTS.md
2. La NOTE_SOURCE intégralement
3. Les 4 docs socle pour vérifier le respect

═══════════════════════════════════════════════════════════════
MÉTHODE
═══════════════════════════════════════════════════════════════
1. Extraire de la NOTE_SOURCE les arborescences cibles, les fichiers à créer, ceux à modifier.
2. Pour chaque fichier à créer : déterminer son contenu (signatures + responsabilités).
3. Pour chaque fichier à modifier : lister les diffs précis.
4. Décrire la séquence de commits (1 commit par sous-étape testable).
5. Définir les tests à ajouter / modifier.
6. Définir la liste des docs socle à mettre à jour dans la même PR.

═══════════════════════════════════════════════════════════════
LIVRABLE
═══════════════════════════════════════════════════════════════
PLAN_LOT_{LOT_CIBLE}.md

Structure :
  1. Périmètre exact
  2. Prérequis (lots qui doivent être finis avant)
  3. Séquence de commits (1 = quoi, 2 = quoi, ...)
  4. Fichiers à créer (liste + responsabilité)
  5. Fichiers à modifier (liste + diff intention)
  6. Tests à écrire
  7. Docs socle à mettre à jour
  8. Critères de validation finale
  9. Garde-fous (interdits absolus)
```

---

# Famille B — Prompts d'exécution

Ces prompts **modifient le code, créent des fichiers, écrivent des tests**. Ils suivent un pattern rigide qui force l'agent à respecter le socle.

---

## B1. Pattern générique d'exécution d'un lot du chantier

> Le squelette commun à tous les lots d'exécution. Les prompts suivants (B2-B6) en sont des spécialisations.

```
Tu es un agent d'exécution pour le lot {LOT_ID} du chantier Komerce.

═══════════════════════════════════════════════════════════════
RÔLE
═══════════════════════════════════════════════════════════════
Exécuter le lot {LOT_ID} de bout en bout : modifications de code, tests,
mise à jour de la doc, préparation du commit. Aucune dérive hors périmètre.

═══════════════════════════════════════════════════════════════
DOCUMENTS À LIRE DANS CET ORDRE (NE PAS SAUTER)
═══════════════════════════════════════════════════════════════
1. AGENTS.md                       — règle de divergence + interdits
2. docs/chantier/STATUS.md         — état actuel + pièges critiques
3. docs/CARTOGRAPHY_360.md         — socle 1/4
4. docs/ZONE_IMPACT.md             — socle 2/4 (CRITIQUE : invariants)
5. docs/SCHEMA.md                  — socle 3/4
6. docs/CONTRACTS.md               — socle 4/4
7. La note d'architecture pertinente (ex: docs/ARCHI_DECOUPAGE_MODULAIRE.md)
8. Le plan d'exécution s'il existe (ex: docs/plans/PLAN_LOT_{LOT_ID}.md)

═══════════════════════════════════════════════════════════════
GARDE-FOUS ABSOLUS
═══════════════════════════════════════════════════════════════
INTERDITS :
- Modifier services/order-status-machine.js sans que ce soit explicitement
  dans le périmètre du lot.
- Modifier routes/pickup-secret.js ligne 286 (violation I-01) sans être en lot I-SWEEP.
- Ajouter du SQL inline dans server.js.
- Casser une signature publique listée dans CONTRACTS.md.
- Toucher autre chose que ce qui est dans le périmètre.
- Refactor + ajout de feature dans la même session.

OBLIGATIONS :
- Mettre à jour les docs socle concernées dans la même PR.
- Mettre à jour STATUS.md (lot coché, prochain lot à jour, date en tête).
- Si tu détectes une violation d'invariant hors périmètre, la signaler dans
  STATUS.md § Pièges critiques et NE PAS la corriger.

═══════════════════════════════════════════════════════════════
MÉTHODE
═══════════════════════════════════════════════════════════════
1. Lire les documents obligatoires.
2. Reformuler le périmètre du lot pour confirmer compréhension. Si doute, demander.
3. Lister précisément les fichiers à créer / modifier / supprimer.
4. Exécuter par étapes commitables (1 étape = 1 mini-livrable testable).
5. Écrire ou ajuster les tests à chaque étape.
6. Mettre à jour les docs socle concernées.
7. Mettre à jour STATUS.md à la fin.
8. Préparer le message de commit (format conventional commits).

═══════════════════════════════════════════════════════════════
LIVRABLE
═══════════════════════════════════════════════════════════════
- Code modifié dans /mnt/user-data/outputs/ (ou diffs annoncés)
- Tests dans /mnt/user-data/outputs/tests/
- Docs socle mises à jour si pertinent
- STATUS.md mis à jour
- Message de commit prêt

═══════════════════════════════════════════════════════════════
FIN DE SESSION
═══════════════════════════════════════════════════════════════
Vérifier la checklist :
[ ] Aucun invariant violé hors périmètre déclaré
[ ] CONTRACTS.md intact ou mis à jour cohérent
[ ] STATUS.md à jour avec date et lot coché
[ ] Tests écrits passent (au moins en simulation)
[ ] Message de commit prêt en français, format conventional commits
```

---

## B2. REFAC-pricing — découpage `services/pricing-engine.js`

```
Tu es un agent d'exécution pour le lot REFAC-pricing.

═══════════════════════════════════════════════════════════════
RÔLE
═══════════════════════════════════════════════════════════════
Découper services/pricing-engine.js (1483 lignes) en un module pricing/
selon l'arborescence cible définie dans docs/ARCHI_DECOUPAGE_MODULAIRE.md §3.1.

Tu ne modifies AUCUN comportement. C'est une refacto pure de structure.

═══════════════════════════════════════════════════════════════
PRÉREQUIS (À VÉRIFIER AVANT DE COMMENCER)
═══════════════════════════════════════════════════════════════
- I-SWEEP doit être ✅ Fait dans STATUS.md
- TEST-1 doit être ✅ Fait dans STATUS.md
- Si l'un manque : STOPPER et signaler. NE PAS COMMENCER.

═══════════════════════════════════════════════════════════════
DOCUMENTS À LIRE
═══════════════════════════════════════════════════════════════
[Reprendre B1 §Documents]
+ docs/ARCHI_DECOUPAGE_MODULAIRE.md §3.1 (arborescence cible)
+ docs/DOCTRINE_ECONOMIQUE_KOMERCE.md (sémantique métier)
+ docs/ADR-001 à ADR-011 (s'il y a des décisions concernant le pricing)

═══════════════════════════════════════════════════════════════
PÉRIMÈTRE EXACT
═══════════════════════════════════════════════════════════════
IN SCOPE :
- Créer services/pricing/ avec les fichiers décrits dans ARCHI §3.1 :
    index.js, load-config.js, cost-allocation.js,
    compute-cdr/index.js, compute-cdr/components-resolver.js,
    compute-cdr/customs-calc.js, compute-cdr/transport-calc.js,
    compute-cdr/allocation-applier.js,
    compute-prices.js, compute-scenarios.js,
    market-confidence.js, health-status.js,
    sourcing-decision.js, alerts.js, recommendation.js
- Transformer services/pricing-engine.js en façade qui réexporte depuis pricing/index.js.
- Mettre à jour CONTRACTS.md §6 pour pointer vers la nouvelle arborescence interne (signatures publiques INCHANGÉES).
- Mettre à jour CARTOGRAPHY_360.md §7 si nécessaire.
- Ajouter des tests unitaires sur chaque fonction extraite (au minimum les chemins nominaux).
- Mettre à jour STATUS.md.

OUT OF SCOPE :
- Changer un comportement (un seul prix recalculé = échec du lot).
- Toucher routes/pricing.js (lot REFAC-pricing-routes séparé, plus tard).
- Toucher services/cost-allocation.js (différent de pricing/cost-allocation.js — fichier existant à laisser).
- Modifier les composantes DB (cost_components, finance_config) ou les ENUMs.
- Toucher le moteur sourcing (services/sourcing-* à laisser).

═══════════════════════════════════════════════════════════════
GARDE-FOUS
═══════════════════════════════════════════════════════════════
[Reprendre B1 §Garde-fous]
+ INVARIANT I-08 : la doctrine pricing lit les composantes DB, jamais de coefficient dur.
  Toute fonction extraite qui contiendrait un coefficient hardcodé = bug à signaler, pas à introduire.
+ La façade services/pricing-engine.js doit conserver l'export exact :
    { loadGlobalConfig, computeFixedCostAllocation, computeCDR, buildCostBreakdown,
      buildDataQuality, inferSubjectType, computePrices, computeScenarios,
      computeMarketConfidence, computeHealthStatus, computeSourcingDecision,
      buildAlerts, buildRecommendationText, recommend, arrondiPsycho }
+ Aucune dépendance circulaire (pricing/X.js ne require pas pricing/Y.js qui require pricing/X.js).
+ Tous les imports relatifs cohérents.

═══════════════════════════════════════════════════════════════
MÉTHODE (étapes ordonnées commitables)
═══════════════════════════════════════════════════════════════
ÉTAPE 1 : Lire intégralement services/pricing-engine.js
  → produire un inventaire des fonctions, leur taille, leurs dépendances mutuelles

ÉTAPE 2 : Créer services/pricing/index.js avec la façade vide qui pointe vers les modules
  → écrire en premier les imports/exports, AVANT de remplir les modules
  → cela force à fixer l'API publique

ÉTAPE 3 : Créer chaque module de l'arborescence, COPIER (pas réécrire) les fonctions concernées
  depuis pricing-engine.js. Ajuster uniquement les imports.

ÉTAPE 4 : Faire pointer services/pricing-engine.js vers la façade (10 lignes)
  → garder l'ancien fichier en place avec uniquement :
    module.exports = require('./pricing/index')

ÉTAPE 5 : Écrire les tests unitaires (au moins 1 test par module créé)
  → tests/unit/pricing/{module}.test.js

ÉTAPE 6 : Vérifier qu'aucun consommateur n'est cassé :
  → grep -rn "require.*pricing-engine" routes/ services/
  → tous doivent fonctionner sans changement

ÉTAPE 7 : Mettre à jour CONTRACTS.md §6 + CARTOGRAPHY_360.md §7 + STATUS.md

ÉTAPE 8 : Préparer le message de commit

═══════════════════════════════════════════════════════════════
LIVRABLE
═══════════════════════════════════════════════════════════════
1. Le dossier services/pricing/ complet avec 15 fichiers
2. services/pricing-engine.js réduit à une façade
3. tests/unit/pricing/ avec un fichier par module
4. CONTRACTS.md, CARTOGRAPHY_360.md, STATUS.md mis à jour
5. Message de commit type :
   "refacto(pricing): découper pricing-engine en module services/pricing/

   - Façade services/pricing-engine.js inchangée (signatures publiques préservées)
   - 12 modules internes dans services/pricing/
   - computeCDR découpé en 4 sous-étapes testables
   - Tests unitaires ajoutés (1 par module)
   - CONTRACTS §6 mis à jour vers nouvelle arborescence interne
   - Aucun comportement modifié — refacto pure"

═══════════════════════════════════════════════════════════════
CRITÈRES DE VALIDATION
═══════════════════════════════════════════════════════════════
Le lot est valide SI ET SEULEMENT SI :
- Tous les imports de pricing-engine.js dans le repo fonctionnent sans changement
- Tous les tests existants passent
- Les nouveaux tests unitaires passent
- Aucune valeur de prix calculée n'a changé (vérifié par tests de comparaison)
- CONTRACTS.md §6 décrit la nouvelle arborescence interne
- STATUS.md acte REFAC-pricing ✅
```

---

## B3. REFAC-dashboard — découpage `routes/dashboard.js`

```
Tu es un agent d'exécution pour le lot REFAC-dashboard.

═══════════════════════════════════════════════════════════════
RÔLE
═══════════════════════════════════════════════════════════════
Découper routes/dashboard.js (2614 lignes, 19 endpoints) en un dossier
routes/dashboard/ avec un fichier par endpoint ou groupe d'endpoints.
Pousser le SQL inline restant vers services/dashboard-metrics.js.

═══════════════════════════════════════════════════════════════
PRÉREQUIS
═══════════════════════════════════════════════════════════════
- REFAC-pricing doit être ✅ Fait
- Aucune violation I-01/I-02 active dans dashboard.js (vérifier par grep)

═══════════════════════════════════════════════════════════════
DOCUMENTS À LIRE
═══════════════════════════════════════════════════════════════
[Reprendre B1 §Documents]
+ docs/ARCHI_DECOUPAGE_MODULAIRE.md §3.2
+ services/dashboard-metrics.js (lire pour comprendre la séparation actuelle)

═══════════════════════════════════════════════════════════════
PÉRIMÈTRE
═══════════════════════════════════════════════════════════════
IN SCOPE :
- Créer routes/dashboard/ avec un fichier par endpoint logique :
    index.js, ops.js, finance.js, pilotage.js, pipeline.js,
    retards.js, forecast.js, clients.js, history.js, hub.js,
    relais.js, annulations.js, global-stats.js, payments.js, sales.js
- Déplacer dans routes/dashboard/index.js le router + auth + montage des sous-routes
- Pousser tout SQL inline restant dans services/dashboard-metrics.js
- Aligner l'en-tête du fichier (annoncer les vrais 19 endpoints, pas 10)
- Mettre à jour server.js : remplacer `app.use('/api/dashboard', require('./routes/dashboard'))` par `require('./routes/dashboard')` (la nouvelle arborescence doit exposer le même point d'entrée)
- Mettre à jour CARTOGRAPHY_360.md §3

OUT OF SCOPE :
- Modifier la logique métier d'un seul endpoint
- Ajouter de nouveaux endpoints
- Changer la signature de retour JSON d'un endpoint (les fronts en dépendent)
- Toucher routes/admin-dashboard.js ou routes/hub-dashboard.js (lots séparés)

═══════════════════════════════════════════════════════════════
GARDE-FOUS
═══════════════════════════════════════════════════════════════
[Reprendre B1 §Garde-fous]
+ Aucun changement de réponse JSON. Tester en comparant avant/après.
+ Aucun changement d'auth/middleware. router.use(authenticate, requireRole(['admin'])) doit rester en tête.
+ Pas d'introduction de nouveau service. Tout SQL extrait → services/dashboard-metrics.js (existant).

═══════════════════════════════════════════════════════════════
MÉTHODE
═══════════════════════════════════════════════════════════════
[Pattern B1 §Méthode adapté]
ÉTAPE SPÉCIFIQUE 1 : grep "router\." routes/dashboard.js → confirmer les 19 endpoints
ÉTAPE SPÉCIFIQUE 2 : Pour chaque endpoint, créer routes/dashboard/{nom}.js avec
  l'export d'une fonction handler. routes/dashboard/index.js fait le montage.
ÉTAPE SPÉCIFIQUE 3 : Identifier tout SQL inline → vérifier s'il existe déjà dans
  dashboard-metrics.js. Si non, l'y ajouter avec une signature claire.
ÉTAPE SPÉCIFIQUE 4 : Tester chaque endpoint via curl ou test d'intégration
  pour vérifier que la réponse est IDENTIQUE.

═══════════════════════════════════════════════════════════════
LIVRABLE & VALIDATION
═══════════════════════════════════════════════════════════════
[Reprendre B1 §Livrable et §Validation]
+ Critère spécifique : chaque endpoint répond strictement la même chose qu'avant
  (test de comparaison JSON).
```

---

## B4. PAYPAL-1 — intégration PayPal phase 1

```
Tu es un agent d'exécution pour le lot PAYPAL-1.

═══════════════════════════════════════════════════════════════
RÔLE
═══════════════════════════════════════════════════════════════
Intégrer PayPal phase 1 (sandbox) selon docs/PAYPAL_POSITIONNEMENT.md.
Aucun panier collectif. Aucune capture différée. Aucune gestion de dispute.

═══════════════════════════════════════════════════════════════
PRÉREQUIS
═══════════════════════════════════════════════════════════════
- I-SWEEP ✅ Fait (sinon stop)
- TEST-1 ✅ Fait (sinon stop)
- Compte PayPal Business sandbox configuré (variables d'env disponibles)
- Si l'un manque : STOPPER et signaler.

═══════════════════════════════════════════════════════════════
DOCUMENTS À LIRE
═══════════════════════════════════════════════════════════════
[Reprendre B1]
+ docs/PAYPAL_POSITIONNEMENT.md (intégralement)
+ services/order-payment-confirmation.js (pour comprendre confirmPaymentCycle)
+ routes/payments.js (modèle d'intégration Stripe — à imiter, pas à modifier)
+ docs/SECURITY-MODEL.md (champs payeur PayPal)

═══════════════════════════════════════════════════════════════
PÉRIMÈTRE
═══════════════════════════════════════════════════════════════
IN SCOPE :
- Migration DB : migrations/0XX_add_paypal.sql
    * ALTER TYPE payment_mode ADD VALUE 'paypal_eur'
    * 5 colonnes ajoutées à orders (paypal_order_id, paypal_capture_id, paypal_payer_email, paypal_payer_id, paypal_pay_in_4_used)
    * Index sur paypal_order_id
    * CREATE TABLE paypal_events_processed (idempotence)
- services/paypal-client.js : wrapper SDK PayPal (createOrder, captureOrder, verifyWebhookSignature, refundCapture)
- routes/payments-paypal.js : 4 endpoints (create-order, capture, webhook, refund)
- services/order-status-machine.js : ajouter 'paypal_capture' aux sources autorisées (pending → confirmed)
- routes/orders/create.js : ajouter 'paypal_eur' dans les payment_mode valides (ligne ~69)
- server.js :
    * 3 variables d'env dans REQUIRED_ENV (PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID)
    * webhook PayPal en express.raw AVANT express.json (à côté des webhooks Stripe lignes 129-131)
- Mise à jour des 4 docs socle :
    CARTOGRAPHY §3 (route /api/payments/paypal)
    SCHEMA.md (ENUM étendu, table, colonnes)
    CONTRACTS.md (paypal-client + paypal route)
    ZONE_IMPACT.md (I-02 mention de paypal_capture)
- Tests :
    tests/integration/paypal-create-order.test.js
    tests/integration/paypal-capture.test.js
    tests/integration/paypal-webhook-idempotency.test.js
- Frontend : public/boutique/components/paypal-button.html (composant uniquement, intégration pages = lot séparé)

OUT OF SCOPE :
- Panier partagé avec PayPal (phase 2 séparée)
- Panier collectif avec PayPal (jamais en phase 1)
- Disputes (lot PAYPAL-2)
- Intégration UI sur checkout.html (lot PAYPAL-1-front)

═══════════════════════════════════════════════════════════════
GARDE-FOUS
═══════════════════════════════════════════════════════════════
[Reprendre B1 §Garde-fous]
+ Webhook PayPal en express.raw OBLIGATOIRE avant express.json (sinon I-07 violé).
+ Capture passe par confirmPaymentCycle({ source: 'paypal_capture' }), JAMAIS un UPDATE orders SET status direct (sinon I-01 violé).
+ Idempotence webhook obligatoire via paypal_events_processed avant tout traitement.
+ Validation côté serveur que le montant capturé == orders.total_eur (anti-tampering).
+ Aucune valeur de PAYPAL_CLIENT_SECRET hardcodée — uniquement via process.env.
+ Sandbox uniquement dans cette phase. Aucune activation prod sans validation séparée.

═══════════════════════════════════════════════════════════════
MÉTHODE
═══════════════════════════════════════════════════════════════
ÉTAPE 1 : Migration DB
ÉTAPE 2 : services/paypal-client.js (commencer par les signatures, remplir ensuite)
ÉTAPE 3 : routes/payments-paypal.js (1 endpoint à la fois)
ÉTAPE 4 : Modif chirurgicale de order-status-machine.js et orders/create.js
ÉTAPE 5 : Modif chirurgicale de server.js (REQUIRED_ENV + raw)
ÉTAPE 6 : Tests d'intégration
ÉTAPE 7 : Composant frontend
ÉTAPE 8 : Mise à jour des 4 docs socle
ÉTAPE 9 : Mise à jour STATUS.md
ÉTAPE 10 : Message de commit

═══════════════════════════════════════════════════════════════
LIVRABLE & VALIDATION
═══════════════════════════════════════════════════════════════
Le lot est valide SI ET SEULEMENT SI :
- Toutes les checkboxes de PAYPAL_POSITIONNEMENT.md §Annexe sont cochées
- Test 1 : create-order → renvoie un paypal_order_id valide en sandbox
- Test 2 : capture → orders.status passe à 'confirmed' via confirmPaymentCycle (vérifier order_status_history)
- Test 3 : double webhook même event_id → traité une seule fois (table paypal_events_processed)
- Aucune signature de service critique cassée
- Les 4 docs socle alignés
```

---

## B5. I-SWEEP — correction groupée des violations d'invariants

```
Tu es un agent d'exécution pour le lot I-SWEEP.

═══════════════════════════════════════════════════════════════
RÔLE
═══════════════════════════════════════════════════════════════
Corriger en une seule passe cohérente toutes les violations d'invariants détectées
par les audits D2/D4/G1-G5/etc. Une refacto chirurgicale, des tests, une revue.

═══════════════════════════════════════════════════════════════
PRÉREQUIS
═══════════════════════════════════════════════════════════════
- Tous les audits du bloc D et G doivent être ✅ ou ✅ Fait partiel
- La liste complète des violations doit être consolidée dans STATUS.md § Pièges critiques
  ou docs/chantier/I-SWEEP-INVENTAIRE.md
- Si la liste n'est pas consolidée : STOPPER et demander une session A4 (vérification chantier) d'abord.

═══════════════════════════════════════════════════════════════
DOCUMENTS À LIRE
═══════════════════════════════════════════════════════════════
[Reprendre B1]
+ TOUS les audits du chantier dans docs/chantier/*_AUDIT_*.md
+ services/order-status-machine.js (contrat exact)
+ services/order-payment-confirmation.js (point d'entrée unique)
+ CONTRACTS.md §3 et §4

═══════════════════════════════════════════════════════════════
PÉRIMÈTRE
═══════════════════════════════════════════════════════════════
IN SCOPE :
- Pour CHAQUE violation listée :
    * remplacer l'UPDATE orders SET status direct par un appel à transitionOrderStatus
      ou à confirmPaymentCycle (selon la source)
    * conserver les autres champs métier (paiement, sécurité, etc.) dans un UPDATE séparé
    * propager le dbClient pour rester en transaction
- Pour CHAQUE violation, écrire un test d'intégration qui vérifie :
    * la ligne dans order_status_history existe
    * les effets dérivés sont déclenchés (pickup_code, notifications, stock)
- Mise à jour CONTRACTS.md §3 si des sources de transition sont ajoutées
- Mise à jour ZONE_IMPACT.md (retirer les pièges critiques résolus)
- Mise à jour STATUS.md (cocher I-SWEEP, retirer les pièges critiques)

OUT OF SCOPE :
- Toute autre refacto qui ne corrige pas une violation
- Tout nouveau feature
- Tout changement de logique métier hors statut

═══════════════════════════════════════════════════════════════
GARDE-FOUS
═══════════════════════════════════════════════════════════════
[Reprendre B1 §Garde-fous]
+ Une seule transaction DB par flux (pas d'UPDATE séparés non transactionnels).
+ Conserver l'ordre des opérations métier sensibles :
    ex: pour pickup-secret, le hash/salt doit être posé AVANT le passage 'confirmed' (sinon le client n'a pas son code)
+ Conserver tous les logs d'audit (cash_collections, etc.)
+ Conserver tous les hooks (loyalty, notifications)

═══════════════════════════════════════════════════════════════
MÉTHODE
═══════════════════════════════════════════════════════════════
ÉTAPE 1 : Faire l'inventaire confirmé des violations (liste exacte de fichier:ligne)
ÉTAPE 2 : Pour chaque, esquisser la transformation AVANT de coder.
  → écrire dans docs/chantier/I-SWEEP-PLAN.md la liste avec "avant / après" en pseudo-code
ÉTAPE 3 : Faire valider l'inventaire/plan par l'utilisateur (DEMANDER si pas validé)
ÉTAPE 4 : Implémenter une violation à la fois, avec test associé
ÉTAPE 5 : Faire tourner les tests à chaque étape
ÉTAPE 6 : Mettre à jour la doc à la fin
ÉTAPE 7 : Préparer le commit

═══════════════════════════════════════════════════════════════
LIVRABLE & VALIDATION
═══════════════════════════════════════════════════════════════
Le lot est valide SI ET SEULEMENT SI :
- Chaque violation listée a été corrigée
- Pour chacune, un test d'intégration prouve que order_status_history est bien écrit
- Aucune régression sur les flux non touchés
- STATUS.md § Pièges critiques ne mentionne plus de violation I-01/I-04 ouverte
- CONTRACTS.md à jour si nouvelles sources
```

---

## B6. TEST-1 — tests d'intégration sur invariants

```
Tu es un agent d'exécution pour le lot TEST-1.

═══════════════════════════════════════════════════════════════
RÔLE
═══════════════════════════════════════════════════════════════
Écrire la première batterie de tests d'intégration qui prouve que les
invariants I-01 à I-10 sont respectés dans les flux principaux.

═══════════════════════════════════════════════════════════════
PRÉREQUIS
═══════════════════════════════════════════════════════════════
- I-SWEEP ✅ Fait (sinon les tests vont fail constamment)

═══════════════════════════════════════════════════════════════
DOCUMENTS À LIRE
═══════════════════════════════════════════════════════════════
[Reprendre B1]
+ docs/ZONE_IMPACT.md §2 (les 10 invariants)
+ docs/CONTRACTS.md (services à tester)
+ tests/integration/ existants (style à reprendre)
+ jest.config.js (configuration test)

═══════════════════════════════════════════════════════════════
PÉRIMÈTRE
═══════════════════════════════════════════════════════════════
IN SCOPE :
- Écrire 10 fichiers tests/integration/invariants/I-XX-{nom}.test.js
- Chaque fichier teste UN invariant avec 2-4 scénarios :
    * cas nominal (l'invariant est respecté)
    * tentative de violation (doit échouer ou être no-op)
- Configurer un environnement de test (DB de test ou mock cohérent)

OUT OF SCOPE :
- Tests unitaires
- Tests E2E avec frontend
- CI/CD intégration

═══════════════════════════════════════════════════════════════
GARDE-FOUS
═══════════════════════════════════════════════════════════════
[Reprendre B1]
+ Les tests doivent être isolés (pas de dépendance entre eux)
+ Les tests doivent être idempotents (jouables 10 fois de suite)
+ Pas de mock sur les fonctions à tester elles-mêmes — mock uniquement
  les dépendances externes (Stripe, PayPal, SMS, email)

═══════════════════════════════════════════════════════════════
MÉTHODE
═══════════════════════════════════════════════════════════════
ÉTAPE 1 : Cartographier les 10 invariants et identifier les flux à tester
ÉTAPE 2 : Pour chacun, écrire le scénario en pseudo-code AVANT de coder
ÉTAPE 3 : Coder un par un, faire passer
ÉTAPE 4 : Vérifier la couverture (chaque invariant a au moins 1 test passant)
ÉTAPE 5 : Mettre à jour STATUS.md
```

---

# Famille C — Prompts utilitaires

---

## C1. Mise à jour du socle après modification

```
Tu es un agent de maintenance documentaire.

═══════════════════════════════════════════════════════════════
RÔLE
═══════════════════════════════════════════════════════════════
Mettre à jour les 4 docs socle après une modification de code livrée
dans la session précédente.

PARAMÈTRE :
- TYPE_MODIF = [route_ajoutée | route_supprimée | service_ajouté | service_modifié | table_ajoutée | ENUM_modifié | invariant_modifié]
- DETAILS = [description précise de la modification]

═══════════════════════════════════════════════════════════════
DOCUMENTS À METTRE À JOUR (selon TYPE_MODIF)
═══════════════════════════════════════════════════════════════
- route_ajoutée/supprimée   → CARTOGRAPHY_360.md §3
- service_ajouté/modifié    → CONTRACTS.md
- table_ajoutée/modifiée    → SCHEMA.md
- ENUM_modifié              → SCHEMA.md §3 + CARTOGRAPHY_360.md si visible API
- invariant_modifié         → ZONE_IMPACT.md §2

═══════════════════════════════════════════════════════════════
RÈGLE
═══════════════════════════════════════════════════════════════
Mettre à jour la date de consolidation et la note de méthode en tête.
Toujours ajouter une mention claire de la modification : "Mis à jour le YYYY-MM-DD : ...".
```

---

## C2. Régénération de SCHEMA.md depuis pg_dump

```
Tu es un agent de génération de doc DB.

═══════════════════════════════════════════════════════════════
RÔLE
═══════════════════════════════════════════════════════════════
Régénérer docs/SCHEMA.md à partir d'un nouveau pg_dump fourni en pièce jointe.

═══════════════════════════════════════════════════════════════
MÉTHODE
═══════════════════════════════════════════════════════════════
1. Lire le pg_dump (gérer UTF-16 LE si nécessaire avec iconv -f UTF-16LE -t UTF-8)
2. Extraire tables, ENUMs, triggers, FK, vues, fonctions
3. Croiser avec la version précédente de SCHEMA.md
4. Identifier les NOUVEAUTÉS et SUPPRESSIONS
5. Produire un SCHEMA.md à jour en respectant la structure existante :
   §1 Règle d'usage, §2 Vue d'ensemble, §3 ENUMs, §4 Tables par domaine,
   §5 Vues, §6 Triggers, §7 Contraintes CHECK, §8 Conventions,
   §9 Liens autres docs, §10 Règle divergence, §11 Procédure régénération, §12 Dette

═══════════════════════════════════════════════════════════════
GARDE-FOUS
═══════════════════════════════════════════════════════════════
- Ne pas inventer de tables qui ne sont pas dans le dump
- Si une table existait avant et n'est plus dans le dump : la signaler dans §12 Dette
- Conserver le format des tableaux existants
```

---

# Méta-règles pour qui édite ce kit

## Comment améliorer un prompt

Si un agent dérive, l'ennemi n'est pas l'agent — c'est le prompt qui laissait de l'ambiguïté. Corriger en allant chercher :

1. **L'ambiguïté** : "fais au mieux", "selon ton jugement", "le plus pertinent"
2. **Le périmètre flou** : pas de "OUT OF SCOPE" explicite
3. **Les invariants manquants** : aucune mention des interdits absolus
4. **Le livrable indéfini** : pas de structure précise du livrable
5. **L'absence de critères de validation** : pas de checklist "le lot est valide SI..."

## Comment ajouter un nouveau prompt

Suivre le squelette B1 :
1. RÔLE
2. PRÉREQUIS
3. DOCUMENTS À LIRE
4. PÉRIMÈTRE (IN/OUT)
5. GARDE-FOUS
6. MÉTHODE (étapes ordonnées)
7. LIVRABLE
8. CRITÈRES DE VALIDATION
9. FIN DE SESSION

## Version

v1.0 — 17 mai 2026 — création initiale (5 prompts d'analyse + 6 prompts d'exécution + 2 utilitaires).
